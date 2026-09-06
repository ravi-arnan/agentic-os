import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.mjs';
import { dayKey } from './jsonl.mjs';
import { estimateCost } from './usage.mjs';

/**
 * Scan Command Code usage from the runs agentic-os itself persisted.
 *
 * `cmd -p --output-format json` prints per-run usage (model_request_end /
 * turn_end / run_end frames) but the CLI does not store token totals in its
 * own transcripts, so the only complete source is the raw NDJSON agentic-os
 * saves to data/runs/<runId>.ndjson. Each run becomes one fileAgg shaped
 * like scanUsage's output so summarizeUsage() can merge it.
 */
export async function scanCommandcodeUsage({ runsDir = paths.runsDir } = {}) {
  let files;
  try {
    files = (await fsp.readdir(runsDir)).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return [];
  }

  const aggs = [];
  for (const f of files) {
    const filePath = path.join(runsDir, f);
    try {
      const agg = await parseRunFile(filePath, f.slice(0, -'.ndjson'.length));
      if (agg && Object.keys(agg.days).length > 0) aggs.push(agg);
    } catch {
      // unreadable or partial run file
    }
  }
  return aggs;
}

async function parseRunFile(filePath, runId) {
  const agg = {
    slug: `commandcode:${runId}`,
    project: null,
    sessionId: runId,
    firstTs: null,
    lastTs: null,
    messages: 0,
    userPrompts: 0,
    toolCalls: 0,
    costUSD: 0,
    days: {},
  };

  let foundUsage = false;
  let runStartTs = null;
  let lastModel = null;
  let toolCalls = 0;

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const frame = JSON.parse(line);
          const evt = frame && frame.type === 'event' ? frame.event : null;
          if (!evt) continue;

          if (evt.type === 'run_start') {
            runStartTs = evt.timestamp ? new Date(evt.timestamp).getTime() : Date.now();
          } else if (evt.type === 'model_request_end') {
            lastModel = evt.model || lastModel || 'unknown';
            const u = evt.usage || {};
            const ts = evt.timestamp
              ? new Date(evt.timestamp).getTime()
              : runStartTs || Date.now();
            const day = dayKey(ts);
            if (!day) continue;
            foundUsage = true;
            const d = (agg.days[day] ||= {
              cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0, byModel: {},
            });
            const inp = Number(u.inputTokens || 0);
            const outp = Number(u.outputTokens || 0);
            const cacheRead = Number(u.cacheReadTokens || 0);
            const cacheWrite = Number(u.cacheWriteTokens || 0);
            d.in += inp;
            d.out += outp;
            d.cacheRead += cacheRead;
            d.cacheCreate += cacheWrite;
            d.messages += 1;
            const m = (d.byModel[lastModel] ||= { in: 0, out: 0, cost: 0 });
            m.in += inp;
            m.out += outp;
          } else if (evt.type === 'message_update') {
            const content = evt.content;
            if (Array.isArray(content)) {
              for (const c of content) {
                if (c?.type === 'tool_use') {
                  toolCalls += 1;
                  agg.toolCalls += 1;
                }
              }
            }
          } else if (evt.type === 'run_end') {
            if (evt.timestamp) agg.lastTs = new Date(evt.timestamp).getTime();
          }
        } catch {
          // skip malformed lines
        }
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (buf.trim()) {
        // trailing line without newline
        try {
          const frame = JSON.parse(buf);
          const evt = frame && frame.type === 'event' ? frame.event : null;
          if (evt && evt.type === 'model_request_end') {
            const u = evt.usage || {};
            const day = dayKey(runStartTs || Date.now());
            if (day) {
              foundUsage = true;
              const d = (agg.days[day] ||= {
                cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0, byModel: {},
              });
              d.in += Number(u.inputTokens || 0);
              d.out += Number(u.outputTokens || 0);
              d.cacheRead += Number(u.cacheReadTokens || 0);
              d.cacheCreate += Number(u.cacheWriteTokens || 0);
              d.messages += 1;
              const m = (d.byModel[lastModel || 'unknown'] ||= { in: 0, out: 0, cost: 0 });
              m.in += Number(u.inputTokens || 0);
              m.out += Number(u.outputTokens || 0);
            }
          }
        } catch {
          // ignore
        }
      }
      resolve();
    });
  });

  if (!foundUsage) return null;
  if (runStartTs) agg.firstTs = runStartTs;

  // tool calls are counted in agg.toolCalls; spread them into days
  for (const d of Object.values(agg.days)) {
    d.toolCalls = agg.toolCalls;
    for (const [model, m] of Object.entries(d.byModel)) {
      const cost = estimateCost(model, { input_tokens: m.in, output_tokens: m.out });
      m.cost = cost;
      d.cost += cost;
      agg.costUSD += cost;
    }
  }
  return agg;
}
