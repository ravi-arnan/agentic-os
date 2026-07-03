import { describe, test, expect } from 'vitest';
import { distillEvent } from '../lib/runner.mjs';

describe('distillEvent', () => {
  test('system init becomes init event', () => {
    expect(distillEvent({ type: 'system', subtype: 'init', model: 'claude-fable-5', session_id: 'abc' }))
      .toEqual({ t: 'init', model: 'claude-fable-5', sessionId: 'abc' });
  });

  test('assistant text + tool_use are compacted', () => {
    const evt = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'oke, ' },
          { type: 'text', text: 'nulis file' },
          { type: 'tool_use', name: 'Write', input: { file_path: '/vault/daily/2026-07-04.md' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'git status' } },
        ],
      },
    };
    expect(distillEvent(evt)).toEqual({
      t: 'assistant',
      text: 'oke, nulis file',
      tools: [
        { name: 'Write', target: '/vault/daily/2026-07-04.md' },
        { name: 'Bash', target: 'git status' },
      ],
    });
  });

  test('thinking-only assistant messages are dropped', () => {
    expect(distillEvent({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } })).toBeNull();
  });

  test('success result carries cost and session', () => {
    const out = distillEvent({
      type: 'result', subtype: 'success', result: 'done',
      total_cost_usd: 0.12, num_turns: 4, duration_ms: 9000, session_id: 'xyz',
    });
    expect(out).toMatchObject({ t: 'result', ok: true, text: 'done', costUSD: 0.12, turns: 4, error: null });
  });

  test('error result flags subtype', () => {
    const out = distillEvent({ type: 'result', subtype: 'error_max_turns' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('error_max_turns');
  });

  test('irrelevant events return null', () => {
    expect(distillEvent({ type: 'user' })).toBeNull();
    expect(distillEvent(null)).toBeNull();
  });
});
