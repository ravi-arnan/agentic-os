import { describe, test, expect } from 'vitest';
import { aggregateRecords, summarizeUsage, estimateCost } from '../lib/usage.mjs';
import { parseJsonl, dayKey } from '../lib/jsonl.mjs';

const asst = (over = {}) => ({
  type: 'assistant',
  timestamp: '2026-07-01T10:00:00.000Z',
  cwd: '/home/ravi/Projects/demo',
  sessionId: 's1',
  costUSD: 0.5,
  requestId: 'req_1',
  message: {
    id: 'msg_1',
    role: 'assistant',
    model: 'claude-fable-5',
    content: [{ type: 'text', text: 'hi' }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
  },
  ...over,
});

describe('aggregateRecords', () => {
  test('dedupes streamed assistant lines by message.id', () => {
    // same message written 3 times (streaming rewrite) — must count once
    const agg = aggregateRecords([asst(), asst(), asst()]);
    expect(agg.messages).toBe(1);
    expect(agg.costUSD).toBe(0.5);
    expect(agg.days['2026-07-01'].in).toBe(100);
    expect(agg.days['2026-07-01'].out).toBe(50);
  });

  test('counts distinct messages, tool calls, and user prompts', () => {
    const records = [
      { type: 'user', timestamp: '2026-07-01T09:59:00.000Z', message: { role: 'user', content: 'do it' } },
      asst(),
      asst({
        requestId: 'req_2',
        timestamp: '2026-07-02T11:00:00.000Z',
        costUSD: 1.25,
        message: {
          id: 'msg_2',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [
            { type: 'tool_use', name: 'Read', input: {} },
            { type: 'tool_use', name: 'Bash', input: {} },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
    ];
    const agg = aggregateRecords(records);
    expect(agg.userPrompts).toBe(1);
    expect(agg.messages).toBe(3); // 1 user + 2 assistant
    expect(agg.toolCalls).toBe(2);
    expect(agg.costUSD).toBeCloseTo(1.75);
    expect(Object.keys(agg.days).sort()).toEqual(['2026-07-01', '2026-07-02']);
    expect(agg.days['2026-07-02'].byModel['claude-haiku-4-5'].cost).toBeCloseTo(1.25);
  });

  test('ignores sidechain user records and malformed lines', () => {
    const records = parseJsonl(
      [
        'not json at all',
        JSON.stringify({ type: 'user', isSidechain: true, timestamp: '2026-07-01T10:00:00Z', message: { role: 'user' } }),
        JSON.stringify(asst()),
      ].join('\n'),
    );
    const agg = aggregateRecords(records);
    expect(agg.userPrompts).toBe(0);
    expect(agg.messages).toBe(1);
  });
});

describe('summarizeUsage', () => {
  test('rolls up per day, per project, per model', () => {
    const a = aggregateRecords([asst()]);
    const b = aggregateRecords([
      asst({
        cwd: '/home/ravi/Projects/other',
        requestId: 'req_9',
        costUSD: 2,
        message: { ...asst().message, id: 'msg_9', model: 'claude-opus-4-8' },
      }),
    ]);
    const sum = summarizeUsage([a, b], { days: 36500 });
    expect(sum.totals.cost).toBeCloseTo(2.5);
    expect(sum.totals.sessions).toBe(2);
    expect(sum.perProject).toHaveLength(2);
    expect(sum.perProject[0].cost).toBeGreaterThanOrEqual(sum.perProject[1].cost);
    expect(sum.models.map((m) => m.model).sort()).toEqual(['claude-fable-5', 'claude-opus-4-8']);
    const day = sum.daily.find((d) => d.date === '2026-07-01');
    expect(day.sessions).toBe(2);
    expect(day.cost).toBeCloseTo(2.5);
  });

  test('daily window filters old days but totals keep everything', () => {
    const old = aggregateRecords([asst({ timestamp: '2020-01-01T00:00:00Z' })]);
    const sum = summarizeUsage([old], { days: 30 });
    expect(sum.daily).toHaveLength(0);
    expect(sum.totals.cost).toBeCloseTo(0.5);
  });
});

describe('estimateCost', () => {
  test('prices tokens per model tier', () => {
    const usage = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    expect(estimateCost('claude-haiku-4-5', usage)).toBeCloseTo(6);
    expect(estimateCost('claude-opus-4-8', usage)).toBeCloseTo(90);
    expect(estimateCost('<synthetic>', usage)).toBe(0);
  });

  test('subscription records (costUSD=0) fall back to estimate', () => {
    const agg = aggregateRecords([asst({ costUSD: 0 })]);
    // 100 in + 50 out + 1000 cacheRead + 200 cacheWrite at fable/opus rates
    const expected = (100 * 15 + 50 * 75 + 1000 * 1.5 + 200 * 18.75) / 1e6;
    expect(agg.costUSD).toBeCloseTo(expected);
  });

  test('recorded costUSD wins over estimate', () => {
    const agg = aggregateRecords([asst()]);
    expect(agg.costUSD).toBe(0.5);
  });
});

describe('dayKey', () => {
  test('handles iso strings and epoch ms', () => {
    expect(dayKey('2026-07-04T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dayKey(Date.UTC(2026, 6, 4, 12))).toMatch(/^2026-07-0[45]$/);
    expect(dayKey('garbage')).toBeNull();
  });
});
