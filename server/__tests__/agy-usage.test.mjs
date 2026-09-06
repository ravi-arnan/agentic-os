import { describe, test, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseAgyTranscript, scanAgyUsage } from '../lib/agy-usage.mjs';
import { summarizeUsage } from '../lib/usage.mjs';

describe('parseAgyTranscript', () => {
  test('parses user prompts, planner responses, tool calls, and model tokens', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-test-'));
    const tFile = path.join(tmpDir, 'transcript.jsonl');

    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        created_at: '2026-08-30T10:00:00Z',
        content: '<USER_REQUEST>\nInvestigate link delay\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Claude Sonnet 4.6 (Thinking).\n</USER_SETTINGS_CHANGE>',
      }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-08-30T10:00:05Z',
        thinking: 'I need to check the xdg-open status and system logs.',
        tool_calls: [{ name: 'run_command', args: { CommandLine: 'which xdg-open' } }],
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'RUN_COMMAND',
        created_at: '2026-08-30T10:00:06Z',
        content: '/usr/bin/xdg-open',
      }),
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-08-30T10:00:10Z',
        content: 'Problem found and fixed.',
      }),
    ];

    await fsp.writeFile(tFile, lines.join('\n'));

    const agg = await parseAgyTranscript(tFile, 'test-conv-1', {
      project: '/home/ravi/Projects/test',
      title: 'Link delay fix',
    });

    expect(agg.sessionId).toBe('test-conv-1');
    expect(agg.project).toBe('/home/ravi/Projects/test');
    expect(agg.title).toBe('Link delay fix');
    expect(agg.userPrompts).toBe(1);
    expect(agg.messages).toBe(3); // 1 user + 2 planner
    expect(agg.toolCalls).toBe(1);
    expect(agg.costUSD).toBeGreaterThan(0);

    const day = agg.days['2026-08-30'];
    expect(day).toBeDefined();
    expect(day.messages).toBe(3);
    expect(day.toolCalls).toBe(1);
    expect(day.byModel['claude-sonnet-4.6']).toBeDefined();
    expect(day.byModel['claude-sonnet-4.6'].in).toBeGreaterThan(0);
    expect(day.byModel['claude-sonnet-4.6'].out).toBeGreaterThan(0);

    // summarize together
    const summary = summarizeUsage([agg], { days: 7 });
    expect(summary.totals.sessions).toBe(1);
    expect(summary.totals.toolCalls).toBe(1);
    expect(summary.models[0].model).toBe('claude-sonnet-4.6');

    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  test('handles missing or empty brain directory gracefully', async () => {
    const aggs = await scanAgyUsage({ brainDir: '/tmp/nonexistent-agy-brain-dir' });
    expect(aggs).toEqual([]);
  });
});
