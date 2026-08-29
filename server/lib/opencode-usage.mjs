import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dayKey } from './jsonl.mjs';

const exec = promisify(execFile);
const HOME = os.homedir();
const DBS = [
  path.join(HOME, '.local/share/opencode/opencode-stable.db'),
  path.join(HOME, '.local/share/opencode/opencode.db'),
];

function dbExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

/**
 * Scan opencode sqlite for today's usage.
 * Returns array of fileAggs shaped like Claude's scanUsage (for merging).
 * Each opencode session is treated as a "file" with slug = session id.
 */
export async function scanOpencodeUsage() {
  const dbs = DBS.filter(dbExists);
  if (dbs.length === 0) return [];

  const aggs = [];
  for (const db of dbs) {
    try {
      const rows = await queryOpencode(db);
      for (const r of rows) aggs.push(r);
    } catch (e) {
      // ignore unreadable db
      console.error(`[opencode-usage] ${db}:`, e.message || e);
    }
  }
  // dedupe by slug (session id) keeping newest
  const bySlug = new Map();
  for (const a of aggs) {
    const prev = bySlug.get(a.slug);
    if (!prev || (a.lastTs || 0) > (prev.lastTs || 0)) bySlug.set(a.slug, a);
  }
  return [...bySlug.values()];
}

async function queryOpencode(db) {
  // Pull all messages grouped by session, with time and tokens
  // We use sqlite3 CLI with -json for machine-readable output
  // Schema: message(id, session_id, time_created, time_updated, data JSON)
  // data contains {role, model:{providerID, modelID}, tokens:{input, output, total}}
  const sql = `
    SELECT session_id as sid, time_created as ts, data
    FROM message
    ORDER BY time_created;
  `;
  let out;
  try {
    const { stdout } = await exec('sqlite3', ['-json', db, sql], { maxBuffer: 20 * 1024 * 1024 });
    out = stdout;
  } catch (e) {
    // fallback to -csv if -json not available
    const { stdout } = await exec('sqlite3', [db, sql], { maxBuffer: 20 * 1024 * 1024 });
    out = stdout;
    return parseCsvFallback(out);
  }

  let rows;
  try {
    rows = JSON.parse(out);
  } catch {
    return parseCsvFallback(out);
  }
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // Group by session
  const bySession = new Map();
  for (const r of rows) {
    const sid = r.sid || r.session_id;
    if (!sid) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(r);
  }

  const fileAggs = [];
  for (const [sid, msgs] of bySession) {
    const agg = {
      slug: `opencode:${sid}`,
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
    let currentModel = null;
    for (const m of msgs) {
      const ts = Number(m.ts || m.time_created || 0);
      if (ts) {
        if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
        if (!agg.lastTs || ts > agg.lastTs) agg.lastTs = ts;
      }
      let data;
      try { data = typeof m.data === 'string' ? JSON.parse(m.data) : m.data; } catch { continue; }
      if (!data) continue;
      const role = data.role;
      if (role === 'user') {
        agg.userPrompts += 1;
        agg.messages += 1;
        if (data.model?.modelID) {
          const mid = data.model.providerID ? `${data.model.providerID}/${data.model.modelID}` : data.model.modelID;
          currentModel = mid;
        }
        // count tool calls from user? no
      } else if (role === 'assistant') {
        agg.messages += 1;
        const day = dayKey(ts);
        if (!day) continue;
        const d = (agg.days[day] ||= { cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0, byModel: {} });
        d.messages += 1;
        // tool calls
        const parts = data.parts || data.content || [];
        let toolCount = 0;
        if (Array.isArray(parts)) toolCount = parts.filter(p => p.type === 'tool' || p.type === 'tool_use').length;
        if (toolCount) { agg.toolCalls += toolCount; d.toolCalls += toolCount; }
        const tokens = data.tokens || {};
        const inp = Number(tokens.input || 0);
        const outp = Number(tokens.output || 0);
        const cacheRead = Number(tokens.cache?.read || 0);
        const cacheWrite = Number(tokens.cache?.write || 0);
        d.in += inp;
        d.out += outp;
        d.cacheRead += cacheRead;
        d.cacheCreate += cacheWrite;
        // cost is 0 for free models (handled in estimateCost), but track anyway
        const modelKey = currentModel || data.model?.modelID || 'unknown';
        const m = (d.byModel[modelKey] ||= { in: 0, out: 0, cost: 0 });
        m.in += inp;
        m.out += outp;
        // reset currentModel after use? keep for next assistant chunks in same turn
      }
    }
    // only keep sessions that had at least one assistant message with tokens
    if (Object.keys(agg.days).length > 0) fileAggs.push(agg);
  }
  return fileAggs;
}

function parseCsvFallback(text) {
  // very simple fallback, not expected to be used
  return [];
}
