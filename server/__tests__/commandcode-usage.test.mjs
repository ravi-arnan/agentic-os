import { describe, test, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { scanCommandcodeUsage } from '../lib/commandcode-usage.mjs';
import { detectProvider, summarizeUsage, seedProviders } from '../lib/usage.mjs';

function makeRunFile(dir, name, lines) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

describe('commandcode usage scan', () => {
  test('parses model_request_end usage from a persisted run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-usage-'));
    const now = Date.now();
    makeRunFile(dir, 'abc123.ndjson', [
      { type: 'event', event: { type: 'run_start', sessionId: 's1', timestamp: new Date(now).toISOString() } },
      { type: 'event', event: { type: 'model_request_end', model: 'deepseek/deepseek-v4-flash', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0 } } },
      { type: 'event', event: { type: 'message_update', content: [{ type: 'tool_use', name: 'read_file', input: { file_path: '/tmp/x' } }] } },
      { type: 'event', event: { type: 'run_end', result: { finalText: 'ok' }, nextState: { sessionId: 's1' } } },
      { type: 'result', subtype: 'success', finalText: 'ok' },
    ]);

    const aggs = await scanCommandcodeUsage({ runsDir: dir });
    expect(aggs).toHaveLength(1);
    const agg = aggs[0];
    expect(agg.slug).toBe('commandcode:abc123');
    const day = Object.values(agg.days)[0];
    expect(day.in).toBe(100);
    expect(day.out).toBe(20);
    expect(day.cacheRead).toBe(5);
    expect(day.byModel['deepseek/deepseek-v4-flash'].in).toBe(100);
    expect(agg.toolCalls).toBe(1);
  });

  test('ignores runs without usage frames (opencode/claude raw output)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-usage-'));
    makeRunFile(dir, 'plain.ndjson', [
      { type: 'event', event: { type: 'run_start', sessionId: 's2' } },
      { type: 'event', event: { type: 'text_delta', delta: 'hello' } },
    ]);
    expect(await scanCommandcodeUsage({ runsDir: dir })).toEqual([]);
  });

  test('detectProvider maps commandcode slugs and PROVIDER_INFO has an entry', async () => {
    expect(detectProvider('commandcode:abc', 'deepseek/deepseek-v4-flash')).toBe('commandcode');
    const aggs = [{ slug: 'commandcode:abc', days: { '2026-08-30': { byModel: { 'deepseek/deepseek-v4-flash': { in: 1, out: 1, cost: 0 } } } } }];
    const usage = summarizeUsage(aggs);
    const prov = usage.providers.find((p) => p.id === 'commandcode');
    expect(prov).toBeTruthy();
    expect(prov.name).toBe('Command Code');
  });

  test('detectProvider maps cursor and copilot slugs', () => {
    expect(detectProvider('cursor:sess1', 'gpt-5.5')).toBe('cursor');
    expect(detectProvider('copilot:sess1', 'gpt-5.5')).toBe('copilot');
  });

  test('seedProviders fills zero rows so every known provider always shows', () => {
    const usage = summarizeUsage([]);
    expect(usage.providers).toEqual([]);
    const seeded = seedProviders(usage, new Date('2026-08-30T12:00:00').getTime());
    const ids = seeded.providers.map((p) => p.id).sort();
    expect(ids).toEqual(
      ['9router', 'agy', 'claude', 'codebuff', 'commandcode', 'copilot', 'cursor', 'opencode'],
    );
    for (const p of seeded.providers) {
      expect(p.in + p.out).toBe(0);
      expect(Array.isArray(p.models)).toBe(true);
    }
    // seeded ids also land in today's daily rollup
    const today = seeded.daily.find((d) => d.date === '2026-08-30');
    expect(today.byModel.cursor).toEqual({ in: 0, out: 0, cost: 0 });
    expect(today.byModel.copilot).toEqual({ in: 0, out: 0, cost: 0 });
  });
});
