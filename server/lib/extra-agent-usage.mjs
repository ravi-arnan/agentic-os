import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { dayKey } from './jsonl.mjs';

const LOG_FILE = path.join(config.dataDir, 'extra-agent-sessions.jsonl');

/**
 * Append a Cursor or Copilot session to the log.
 *
 * Neither CLI exposes token usage in its output (cursor emits the Claude
 * stream-json envelope without per-token totals; copilot reports premium
 * requests), so the dashboard tracks these agents via manually logged
 * sessions — same pattern as codebuff. Call this from the API or a script
 * after a session ends.
 *
 * @param {object} session
 * @param {string} session.provider     - 'cursor' | 'copilot'
 * @param {string} session.sessionId    - unique session id
 * @param {string} session.title        - short title of what was done
 * @param {string} session.project      - project path or name
 * @param {string} session.model        - model used
 * @param {number} session.messages     - total message count
 * @param {number} session.toolCalls    - tool calls made
 * @param {number} session.inputTokens  - input tokens (optional, 0 if unknown)
 * @param {number} session.outputTokens - output tokens (optional, 0 if unknown)
 * @param {number} session.costUSD      - cost in dollars (0 for free)
 * @param {number} session.startedAt    - epoch ms when session started
 * @param {number} session.endedAt      - epoch ms when session ended
 */
export async function logExtraAgentSession(session) {
  const provider = session.provider === 'copilot' ? 'copilot' : 'cursor';
  const entry = {
    ts: Date.now(),
    provider,
    sessionId: session.sessionId || `${provider}-${Date.now()}`,
    title: session.title || '',
    project: session.project || null,
    model: session.model || 'unknown',
    messages: session.messages || 0,
    toolCalls: session.toolCalls || 0,
    inputTokens: session.inputTokens || 0,
    outputTokens: session.outputTokens || 0,
    costUSD: session.costUSD || 0,
    startedAt: session.startedAt || null,
    endedAt: session.endedAt || Date.now(),
  };
  await fsp.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fsp.appendFile(LOG_FILE, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Scan logged Cursor/Copilot sessions and return fileAggs compatible
 * with summarizeUsage() — same shape as Claude/opencode/agy/codebuff aggs.
 */
export async function scanExtraAgentUsage() {
  let raw;
  try {
    raw = await fsp.readFile(LOG_FILE, 'utf8');
  } catch {
    return [];
  }

  const entries = raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  if (entries.length === 0) return [];

  // Group by provider, then by session id within each provider
  const byProviderSession = new Map();
  for (const e of entries) {
    const prov = e.provider === 'copilot' ? 'copilot' : 'cursor';
    const sid = e.sessionId || `${prov}-${e.ts}`;
    const key = `${prov}:${sid}`;
    if (!byProviderSession.has(key)) byProviderSession.set(key, []);
    byProviderSession.get(key).push(e);
  }

  const fileAggs = [];
  for (const [key, records] of byProviderSession) {
    const [provider, sid] = key.split(':');
    const merged = {
      slug: `${provider}:${sid}`,
      project: null,
      sessionId: sid,
      firstTs: null,
      lastTs: null,
      messages: 0,
      userPrompts: 0,
      toolCalls: 0,
      costUSD: 0,
      days: {},
    };

    for (const r of records) {
      if (r.project && !merged.project) merged.project = r.project;

      const started = r.startedAt || r.ts;
      const ended = r.endedAt || r.ts;
      if (started && (!merged.firstTs || started < merged.firstTs)) merged.firstTs = started;
      if (ended && (!merged.lastTs || ended > merged.lastTs)) merged.lastTs = ended;

      if (r.messages) merged.messages = r.messages;
      if (r.toolCalls) merged.toolCalls = r.toolCalls;
      if (r.costUSD) merged.costUSD = r.costUSD;

      const day = dayKey(ended || started);
      if (!day) continue;

      const model = r.model || `${provider}/unknown`;
      const inp = r.inputTokens || 0;
      const outp = r.outputTokens || 0;

      const d = (merged.days[day] ||= {
        cost: r.costUSD || 0,
        in: inp,
        out: outp,
        cacheRead: 0,
        cacheCreate: 0,
        messages: r.messages || 0,
        toolCalls: r.toolCalls || 0,
        byModel: {},
      });
      d.messages = r.messages || d.messages;
      d.toolCalls = r.toolCalls || d.toolCalls;
      d.cost = r.costUSD || d.cost;
      d.in = inp || d.in;
      d.out = outp || d.out;

      const m = (d.byModel[model] ||= { in: 0, out: 0, cost: 0 });
      m.in = inp || m.in;
      m.out = outp || m.out;
      m.cost = r.costUSD || m.cost;
    }

    if (Object.keys(merged.days).length > 0) fileAggs.push(merged);
  }

  return fileAggs;
}
