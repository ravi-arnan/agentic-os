import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.mjs';
import { eachJsonlRecord, dayKey } from './jsonl.mjs';

const CACHE_VERSION = 4;

// Base $/MTok as [input, output], straight off the Anthropic price list.
// Transcripts carry no cost field at all, so dashboard cost is estimated from
// tokens. Cache rates are derived rather than listed: a read costs 0.1x input,
// a write 1.25x input at the 5-minute TTL and 2x at the 1-hour TTL.
const PRICING = [
  [/fable|mythos/i, [10, 50]],
  [/opus/i, [5, 25]],
  [/sonnet/i, [3, 15]],
  [/haiku/i, [1, 5]],
];

const CACHE_READ = 0.1;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

// Fallback for a Claude model this table has not learned yet. Opus is the
// dearest tier, so an unknown one is over-counted rather than hidden.
const UNKNOWN_CLAUDE = [5, 25];

export function estimateCost(model, usage) {
  if (!usage) return 0;
  const name = model || '';
  const base = PRICING.find(([re]) => re.test(name))?.[1]
    || (/^claude-/i.test(name) ? UNKNOWN_CLAUDE : null);
  // Everything else is served by a free provider through 9router or opencode
  // (nemotron, gemini, deepseek, minimax). The old table fell back to Sonnet
  // rates for these, inventing spend that never happened.
  if (!base) return 0;
  const [input, output] = base;

  const write = usage.cache_creation_input_tokens || 0;
  // Records predating the per-TTL breakdown carry only the total; charging
  // those at the 5-minute rate keeps the old behaviour for them.
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  const write5m = Math.max(0, write - write1h);

  return (
    ((usage.input_tokens || 0) * input +
      (usage.output_tokens || 0) * output +
      (usage.cache_read_input_tokens || 0) * input * CACHE_READ +
      write5m * input * CACHE_WRITE_5M +
      write1h * input * CACHE_WRITE_1H) /
    1e6
  );
}

function emptyDay() {
  return { cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0, byModel: {} };
}

/**
 * Fold one transcript record into a file-level aggregate.
 * Assistant usage lines are deduped by message.id (falling back to
 * requestId) because streaming rewrites the same message across lines.
 */
export function foldRecord(agg, record) {
  const ts = record.timestamp;
  if (ts) {
    if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
    if (!agg.lastTs || ts > agg.lastTs) agg.lastTs = ts;
  }
  if (record.cwd && !agg.project) agg.project = record.cwd;
  if (record.sessionId && !agg.sessionId) agg.sessionId = record.sessionId;

  if (record.type === 'user' && !record.isSidechain && record.message?.role === 'user') {
    agg.userPrompts += 1;
    agg.messages += 1;
    return agg;
  }
  if (record.type !== 'assistant') return agg;

  const key = record.message?.id || record.requestId || record.uuid;
  if (key && agg.seen.has(key)) return agg;
  if (key) agg.seen.add(key);

  agg.messages += 1;
  const day = dayKey(ts);
  if (!day) return agg;
  const d = (agg.days[day] ||= emptyDay());
  d.messages += 1;

  const content = record.message?.content;
  if (Array.isArray(content)) {
    const uses = content.filter((c) => c?.type === 'tool_use').length;
    agg.toolCalls += uses;
    d.toolCalls += uses;
  }

  const usage = record.message?.usage;
  const model = record.message?.model || 'unknown';
  const recorded = typeof record.costUSD === 'number' ? record.costUSD : 0;
  const cost = recorded > 0 ? recorded : estimateCost(model, usage);
  agg.costUSD += cost;
  d.cost += cost;
  if (usage) {
    d.in += usage.input_tokens || 0;
    d.out += usage.output_tokens || 0;
    d.cacheRead += usage.cache_read_input_tokens || 0;
    d.cacheCreate += usage.cache_creation_input_tokens || 0;
    const m = (d.byModel[model] ||= { in: 0, out: 0, cost: 0 });
    m.in += usage.input_tokens || 0;
    m.out += usage.output_tokens || 0;
    m.cost += cost;
  }
  return agg;
}

export function newFileAgg(slug) {
  return {
    slug,
    project: null,
    sessionId: null,
    firstTs: null,
    lastTs: null,
    messages: 0,
    userPrompts: 0,
    toolCalls: 0,
    costUSD: 0,
    days: {},
    seen: new Set(),
  };
}

/** Aggregate a list of parsed records (used by tests). */
export function aggregateRecords(records, slug = 'test') {
  const agg = newFileAgg(slug);
  for (const r of records) foldRecord(agg, r);
  return finishAgg(agg);
}

function finishAgg(agg) {
  const { seen, ...rest } = agg;
  return rest;
}

// ---------------------------------------------------------------------------
// Cached directory scan
// ---------------------------------------------------------------------------

let cache = null; // { version, files: { relPath: { mtimeMs, size, agg } } }
let scanPromise = null;

async function loadCache() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fsp.readFile(paths.usageCache, 'utf8'));
    cache = raw.version === CACHE_VERSION ? raw : { version: CACHE_VERSION, files: {} };
  } catch {
    cache = { version: CACHE_VERSION, files: {} };
  }
  return cache;
}

async function saveCache() {
  await fsp.mkdir(path.dirname(paths.usageCache), { recursive: true });
  await fsp.writeFile(paths.usageCache, JSON.stringify(cache));
}

async function parseTranscript(filePath, slug) {
  const agg = newFileAgg(slug);
  await eachJsonlRecord(filePath, (record) => foldRecord(agg, record));
  return finishAgg(agg);
}

/**
 * Scan all transcripts, reusing cached per-file aggregates when the file
 * is unchanged (mtime + size). Returns array of file aggregates.
 */
export async function scanUsage() {
  if (scanPromise) return scanPromise; // coalesce concurrent requests
  scanPromise = doScan().finally(() => {
    scanPromise = null;
  });
  return scanPromise;
}

async function doScan() {
  await loadCache();
  const root = paths.transcripts;
  let dirs = [];
  try {
    dirs = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const results = [];
  const liveKeys = new Set();
  let dirty = false;

  for (const dir of dirs) {
    const dirPath = path.join(root, dir);
    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, entry.name);
      const relPath = `${dir}/${entry.name}`;
      liveKeys.add(relPath);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      const cached = cache.files[relPath];
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        results.push(cached.agg);
        continue;
      }
      try {
        const agg = await parseTranscript(filePath, dir);
        cache.files[relPath] = { mtimeMs: stat.mtimeMs, size: stat.size, agg };
        results.push(agg);
        dirty = true;
      } catch {
        // unreadable file — skip
      }
    }
  }

  // drop cache entries for deleted transcripts
  for (const key of Object.keys(cache.files)) {
    if (!liveKeys.has(key)) {
      delete cache.files[key];
      dirty = true;
    }
  }
  if (dirty) await saveCache().catch(() => {});
  return results;
}

// ---------------------------------------------------------------------------
// Summaries for the dashboard
// ---------------------------------------------------------------------------

export function detectProvider(slug, model) {
  if (typeof slug === 'string' && slug.startsWith('codebuff:')) return 'codebuff';
  if (typeof slug === 'string' && slug.startsWith('agy:')) return 'agy';
  if (typeof slug === 'string' && slug.startsWith('opencode:')) return 'opencode';
  if (typeof slug === 'string' && slug.startsWith('commandcode:')) return 'commandcode';
  if (typeof slug === 'string' && slug.startsWith('cursor:')) return 'cursor';
  if (typeof slug === 'string' && slug.startsWith('copilot:')) return 'copilot';
  const m = String(model || '').toLowerCase();
  if (m.startsWith('opencode/')) return 'opencode';
  if (m.startsWith('9router/')) return '9router';
  if (m.includes('gemini')) return 'agy';
  if (m.includes('nvidia') || m.includes('nemotron') || m.includes('qwen') || m.includes('deepseek') || m.includes('big-pickle') || m.includes('north-mini') || m.includes('devstral') || m.includes('minimax') || m.includes('mistral')) return 'opencode';
  if (m.startsWith('claude-') || m.includes('fable') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) return 'claude';
  return 'claude';
}

export const PROVIDER_INFO = {
  claude: {
    id: 'claude',
    name: 'Anthropic Claude Code',
    badge: 'API / Plan',
    tier: 'Subscription / API Tokens',
    quotaInfo: 'Weekly plan rollover',
    color: 'var(--color-cyan)',
    isPaid: true,
  },
  agy: {
    id: 'agy',
    name: 'Google Antigravity (AGY)',
    badge: 'Google Code Assist',
    tier: 'Free / Preview Tier & Multi-Model',
    quotaInfo: 'Gemini 3.7 Flash & Claude Bridge',
    color: '#38bdf8',
    isPaid: false,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    badge: 'Free Tier',
    tier: '100% Free / Contributor Models',
    quotaInfo: 'Free Unlimited (Muse, DeepSeek, Pickle, etc.)',
    color: '#a78bfa',
    isPaid: false,
  },
  '9router': {
    id: '9router',
    name: '9router Local Router',
    badge: 'Local :20128',
    tier: 'Multi-provider local proxy',
    quotaInfo: 'Local failover routing',
    color: '#34d399',
    isPaid: false,
  },
  codebuff: {
    id: 'codebuff',
    name: 'Buffy (Codebuff)',
    badge: 'Freebuff.com',
    tier: 'Free AI Coding Agent',
    quotaInfo: 'Free via freebuff.com',
    color: '#f472b6',
    isPaid: false,
  },
  commandcode: {
    id: 'commandcode',
    name: 'Command Code',
    badge: 'Command Code',
    tier: 'Free / Paid API',
    quotaInfo: 'Token usage per run (no per-request cost tracked)',
    color: '#fbbf24',
    isPaid: false,
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    badge: 'Cursor Agent',
    tier: 'Free / Pro',
    quotaInfo: 'Cursor Agent CLI (account quota)',
    color: '#94a3b8',
    isPaid: false,
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    badge: 'Copilot CLI',
    tier: 'Free / Pro',
    quotaInfo: 'Premium requests quota',
    color: '#c084fc',
    isPaid: false,
  },
};

/**
 * Force the known providers to always show in the dashboard, even when they
 * have no usage yet (e.g. an agent whose account is out of quota). Pure over
 * (usage, now) for testability: today's rows are zero-filled with the current
 * date so the card renders instead of disappearing.
 */
export function seedProviders(usage, now = Date.now()) {
  const seen = new Set(usage.providers.map((p) => p.id));
  const today = dayKey(now);
  const zeroRow = { in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0 };
  const seeded = [...usage.providers];
  const added = [];
  for (const meta of Object.values(PROVIDER_INFO)) {
    if (seen.has(meta.id)) continue;
    const prov = {
      ...meta,
      ...zeroRow,
      cost: 0,
      sessions: 0,
      models: [],
    };
    seeded.push(prov);
    added.push(meta.id);
  }
  if (added.length > 0) {
    // make sure today's daily rollup exists so the chart/overview include the
    // seeded providers instead of dropping them
    let roll = usage.daily.find((d) => d.date === today);
    if (!roll) {
      roll = {
        date: today,
        cost: 0,
        in: 0,
        out: 0,
        cacheRead: 0,
        cacheCreate: 0,
        messages: 0,
        toolCalls: 0,
        sessions: 0,
        byModel: {},
      };
      usage.daily.push(roll);
    }
    for (const id of added) {
      roll.byModel[id] = { in: 0, out: 0, cost: 0 };
    }
    usage.daily.sort((a, b) => a.date.localeCompare(b.date));
  }
  return { ...usage, providers: seeded };
}

export function summarizeUsage(fileAggs, { days = 45 } = {}) {
  const daily = new Map(); // day -> rollup
  const perProject = new Map();
  const models = new Map();
  const providersMap = new Map();
  const totals = { cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0, sessions: fileAggs.length };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = dayKey(cutoff.getTime());

  for (const f of fileAggs) {
    totals.cost += f.costUSD;
    totals.messages += f.messages;
    totals.toolCalls += f.toolCalls;

    const projKey = f.project || f.slug;
    const p = perProject.get(projKey) || {
      project: projKey, cost: 0, in: 0, out: 0, sessions: 0, messages: 0, lastActive: null,
    };
    p.cost += f.costUSD;
    p.sessions += 1;
    p.messages += f.messages;
    if (f.lastTs && (!p.lastActive || f.lastTs > p.lastActive)) p.lastActive = f.lastTs;
    perProject.set(projKey, p);

    for (const [day, d] of Object.entries(f.days)) {
      totals.in += d.in;
      totals.out += d.out;
      totals.cacheRead += d.cacheRead;
      totals.cacheCreate += d.cacheCreate;
      p.in += d.in;
      p.out += d.out;
      for (const [model, m] of Object.entries(d.byModel)) {
        const mm = models.get(model) || { model, in: 0, out: 0, cost: 0 };
        mm.in += m.in;
        mm.out += m.out;
        mm.cost += m.cost;
        models.set(model, mm);

        // Group by provider
        const provId = detectProvider(f.slug, model);
        const meta = PROVIDER_INFO[provId] || { id: provId, name: provId, badge: provId, tier: 'Custom', quotaInfo: '', color: 'var(--color-faint)' };
        const prov = providersMap.get(provId) || {
          ...meta,
          in: 0,
          out: 0,
          cacheRead: 0,
          cacheCreate: 0,
          cost: 0,
          messages: 0,
          toolCalls: 0,
          sessions: new Set(),
          models: new Map(),
        };
        prov.in += m.in;
        prov.out += m.out;
        prov.cost += m.cost;
        prov.messages += d.messages;
        prov.toolCalls += d.toolCalls;
        prov.sessions.add(f.slug);
        const pModel = prov.models.get(model) || { model, in: 0, out: 0, cost: 0 };
        pModel.in += m.in;
        pModel.out += m.out;
        pModel.cost += m.cost;
        prov.models.set(model, pModel);
        providersMap.set(provId, prov);
      }
      if (day < cutoffKey) continue;
      const roll = daily.get(day) || {
        date: day, cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0,
        messages: 0, toolCalls: 0, sessions: 0, byModel: {},
      };
      roll.cost += d.cost;
      roll.in += d.in;
      roll.out += d.out;
      roll.cacheRead += d.cacheRead;
      roll.cacheCreate += d.cacheCreate;
      roll.messages += d.messages;
      roll.toolCalls += d.toolCalls;
      roll.sessions += 1;
      for (const [model, m] of Object.entries(d.byModel)) {
        const bm = (roll.byModel[model] ||= { in: 0, out: 0, cost: 0 });
        bm.in += m.in;
        bm.out += m.out;
        bm.cost += m.cost;
      }
      daily.set(day, roll);
    }
  }

  const providers = [...providersMap.values()].map((p) => ({
    ...p,
    sessions: p.sessions.size,
    models: [...p.models.values()].sort((a, b) => b.cost - a.cost || b.out - a.out),
  })).sort((a, b) => b.cost - a.cost || (b.in + b.out) - (a.in + a.out));

  return {
    totals,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    perProject: [...perProject.values()].sort((a, b) => b.cost - a.cost),
    models: [...models.values()].sort((a, b) => b.cost - a.cost || b.out - a.out),
    providers,
  };
}
