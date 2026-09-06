import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths } from '../config.mjs';
import { eachJsonlRecord, dayKey } from './jsonl.mjs';
import { estimateCost } from './usage.mjs';

const exec = promisify(execFile);

/**
 * Scan Antigravity (agy) brain transcripts and conversation summaries database.
 * Returns array of fileAggs compatible with summarizeUsage().
 */
export async function scanAgyUsage({ brainDir = paths.agyBrain, dbPath = paths.agyDb } = {}) {
  let sessionDirs = [];
  try {
    sessionDirs = (await fsp.readdir(brainDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  if (sessionDirs.length === 0) return [];

  // 1. Query sqlite db for workspace URIs and session titles if available
  const metaMap = await loadAgySummaries(dbPath);

  // 2. Parse transcript for each session
  const fileAggs = [];
  for (const sid of sessionDirs) {
    const transcriptPath = path.join(brainDir, sid, '.system_generated', 'logs', 'transcript.jsonl');
    try {
      await fsp.access(transcriptPath);
    } catch {
      continue;
    }

    try {
      const meta = metaMap.get(sid) || {};
      const agg = await parseAgyTranscript(transcriptPath, sid, meta);
      if (agg && Object.keys(agg.days).length > 0) {
        fileAggs.push(agg);
      }
    } catch (err) {
      // unreadable or corrupt transcript
    }
  }

  return fileAggs;
}

async function loadAgySummaries(dbPath) {
  const map = new Map();
  if (!dbPath) return map;
  try {
    await fsp.access(dbPath);
  } catch {
    return map;
  }

  const sql = `SELECT conversation_id, title, workspace_uris FROM conversation_summaries;`;
  try {
    const { stdout } = await exec('sqlite3', ['-json', dbPath, sql], { maxBuffer: 10 * 1024 * 1024 });
    const rows = JSON.parse(stdout);
    if (Array.isArray(rows)) {
      for (const r of rows) {
        let project = null;
        try {
          const uris = typeof r.workspace_uris === 'string' ? JSON.parse(r.workspace_uris) : r.workspace_uris;
          if (Array.isArray(uris) && uris.length > 0) {
            project = String(uris[0]).replace(/^file:\/\//, '');
          }
        } catch {
          // ignore uri parse errors
        }
        map.set(r.conversation_id, {
          title: r.title || null,
          project,
        });
      }
    }
  } catch {
    // sqlite read failed or sqlite3 binary not in path
  }
  return map;
}

/**
 * Parses an AGY transcript.jsonl into a standard file aggregate.
 */
export async function parseAgyTranscript(filePath, sessionId, meta = {}) {
  const agg = {
    slug: `agy:${sessionId}`,
    project: meta.project || null,
    sessionId,
    title: meta.title || null,
    firstTs: null,
    lastTs: null,
    messages: 0,
    userPrompts: 0,
    toolCalls: 0,
    costUSD: 0,
    days: {},
  };

  let currentModel = 'gemini-3.7-flash';

  await eachJsonlRecord(filePath, (rec) => {
    const tsStr = rec.created_at;
    const ts = tsStr ? new Date(tsStr).getTime() : null;
    if (ts && !Number.isNaN(ts)) {
      if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
      if (!agg.lastTs || ts > agg.lastTs) agg.lastTs = ts;
    }

    const day = tsStr ? dayKey(ts) : null;
    if (!day) return;

    const d = (agg.days[day] ||= {
      cost: 0,
      in: 0,
      out: 0,
      cacheRead: 0,
      cacheCreate: 0,
      messages: 0,
      toolCalls: 0,
      byModel: {},
    });

    if (rec.type === 'USER_INPUT') {
      agg.userPrompts += 1;
      agg.messages += 1;
      d.messages += 1;

      const content = typeof rec.content === 'string' ? rec.content : '';
      // Detect model selection changes in user metadata
      if (content.includes('Model Selection')) {
        if (content.includes('Claude Sonnet')) currentModel = 'claude-sonnet-4.6';
        else if (content.includes('Claude Opus')) currentModel = 'claude-opus-4.6';
        else if (content.includes('Claude Haiku')) currentModel = 'claude-haiku-4.5';
        else if (content.includes('Gemini 3.7 Flash')) currentModel = 'gemini-3.7-flash';
        else if (content.includes('Gemini 3')) currentModel = 'gemini-3-flash';
        else if (content.includes('Gemini')) currentModel = 'gemini-2.5-flash';
      }

      const inpTokens = Math.ceil(content.length / 3.8);
      d.in += inpTokens;
      const m = (dEntryModel(d, currentModel));
      m.in += inpTokens;
    } else if (rec.type === 'PLANNER_RESPONSE') {
      agg.messages += 1;
      d.messages += 1;

      let toolCount = 0;
      let outTokens = 0;
      if (Array.isArray(rec.tool_calls)) {
        toolCount = rec.tool_calls.length;
        outTokens += Math.ceil(JSON.stringify(rec.tool_calls).length / 3.8);
      }
      if (typeof rec.thinking === 'string') {
        outTokens += Math.ceil(rec.thinking.length / 3.8);
      }
      if (typeof rec.content === 'string') {
        outTokens += Math.ceil(rec.content.length / 3.8);
      }

      if (toolCount > 0) {
        agg.toolCalls += toolCount;
        d.toolCalls += toolCount;
      }

      d.out += outTokens;
      const m = dEntryModel(d, currentModel);
      m.out += outTokens;
    } else if (
      rec.type === 'GENERIC' ||
      rec.type === 'VIEW_FILE' ||
      rec.type === 'RUN_COMMAND' ||
      rec.type === 'READ_URL_CONTENT' ||
      rec.type === 'GREP_SEARCH' ||
      rec.type === 'LIST_DIR'
    ) {
      // Tool responses feeding back into prompt context
      const content = typeof rec.content === 'string' ? rec.content : '';
      const inpTokens = Math.ceil(content.length / 3.8);
      d.in += inpTokens;
      const m = dEntryModel(d, currentModel);
      m.in += inpTokens;
    }
  });

  // Calculate costs per day and model
  for (const d of Object.values(agg.days)) {
    for (const [model, m] of Object.entries(d.byModel)) {
      const cost = estimateCost(model, { input_tokens: m.in, output_tokens: m.out });
      m.cost = cost;
      d.cost += cost;
      agg.costUSD += cost;
    }
  }

  return agg;
}

function dEntryModel(d, model) {
  return (d.byModel[model] ||= { in: 0, out: 0, cost: 0 });
}
