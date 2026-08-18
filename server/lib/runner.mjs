import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config, paths } from '../config.mjs';
import { parseJsonl } from './jsonl.mjs';
import { getAgent, distillClaudeEvent } from './agents.mjs';

const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_FINISHED_RUNS = 20; // finished runs kept in memory for console replay
const runs = new Map(); // runId -> run state (in-memory, this process)

/** Drop the oldest finished runs so memory doesn't grow forever. */
function evictOldRuns() {
  const finished = [...runs.values()]
    .filter((r) => r.status !== 'running')
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  for (const run of finished.slice(MAX_FINISHED_RUNS)) runs.delete(run.id);
}

/**
 * Compact a raw stream-json event into what the UI needs.
 * Returns null for events not worth showing. Lives in agents.mjs now that
 * every CLI has its own parser; re-exported here for existing callers.
 */
export const distillEvent = distillClaudeEvent;

function newRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Push a system note into a run's event stream (post-run steps, warnings). */
function emitNote(run, text) {
  const evt = { t: 'note', text: String(text) };
  run.events.push(evt);
  run.emitter.emit('event', evt);
}

export function getRun(runId) {
  return runs.get(runId) || null;
}

export function serializeRun(run) {
  return {
    id: run.id,
    skillId: run.skillId,
    agent: run.agent || 'claude',
    input: run.input || null,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt || null,
    result: run.result || null,
    events: run.events,
  };
}

export async function startRun(skill, input) {
  const prompt = await skill.buildPrompt(input);
  const id = newRunId();
  const agent = getAgent(skill.agent);
  const args = agent.args(skill, prompt);

  const run = {
    id,
    skillId: skill.id,
    agent: skill.agent || 'claude',
    input: input || null,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    events: [],
    rawLines: [],
    stderrTail: [],
    result: null,
    emitter: new EventEmitter(),
    child: null,
  };
  run.emitter.setMaxListeners(50);
  runs.set(id, run);

  const child = spawn(agent.bin(config), args, {
    cwd: skill.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  run.child = child;

  const timeout = setTimeout(() => {
    if (run.status === 'running') {
      run.stderrTail.push(`[agentic-os] timed out after ${skill.timeoutMs || DEFAULT_TIMEOUT_MS}ms`);
      child.kill('SIGTERM');
    }
  }, skill.timeoutMs || DEFAULT_TIMEOUT_MS);

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      run.rawLines.push(line);
      let compact;
      if (agent.mode === 'ndjson') {
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        compact = agent.parse(evt);
      } else {
        compact = agent.parse(line);
      }
      if (compact) {
        if (compact.t === 'result') {
          run.result = compact;
        }
        run.events.push(compact);
        run.emitter.emit('event', compact);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    run.stderrTail.push(String(chunk));
    if (run.stderrTail.length > 20) run.stderrTail.shift();
  });
  child.on('error', (err) => {
    run.stderrTail.push(String(err.message || err));
  });
  child.on('close', async (code) => {
    clearTimeout(timeout);
    run.endedAt = Date.now();
    // text-only agents (agy, opencode) never print a result event: build one
    // from what they said, otherwise every run of theirs reads as a failure.
    if (!run.result && typeof agent.result === 'function') {
      run.result = agent.result(run, code);
      run.events.push(run.result);
      run.emitter.emit('event', run.result);
    }
    run.status = run.result?.ok ? 'done' : 'error';
    if (!run.result) {
      run.result = {
        t: 'result',
        ok: false,
        text: null,
        error: `exited ${code}: ${run.stderrTail.join('').trim().slice(-400) || 'no output'}`,
        costUSD: null,
        turns: null,
        durationMs: run.endedAt - run.startedAt,
        sessionId: null,
      };
      run.events.push(run.result);
      run.emitter.emit('event', run.result);
    }
    // deterministic post-run step (e.g. journaler commits the vault) — runs
    // only on success, its result shown as a console note before we close.
    if (run.status === 'done' && typeof skill.afterRun === 'function') {
      try {
        const note = await skill.afterRun(run);
        if (note) emitNote(run, note);
      } catch (err) {
        emitNote(run, `afterRun failed: ${err.message || err}`);
      }
    }
    run.emitter.emit('end', run.status);
    // a run missing from the index is invisible everywhere else, so say so loudly
    await persistRun(run).catch((err) =>
      console.error(`[runner] could not persist run ${run.id}:`, err),
    );
    run.rawLines = []; // full transcript is on disk now — free the heap copy
    evictOldRuns();
  });

  return serializeRun(run);
}

export function killRun(runId) {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') return false;
  run.stderrTail.push('[agentic-os] cancelled by user');
  run.child?.kill('SIGTERM');
  return true;
}

async function appendSummary(summary) {
  await fsp.mkdir(paths.runsDir, { recursive: true });
  await fsp.appendFile(paths.runsIndex, JSON.stringify(summary) + '\n');
}

/**
 * Record a run that never got off the ground (scheduler could not spawn it).
 * Without this the failure would only exist in the server's stdout, so the
 * dashboard and the morning briefing would both report "never ran".
 */
export async function recordFailedStart(skillId, message) {
  const now = Date.now();
  await appendSummary({
    id: newRunId(),
    skillId,
    input: null,
    status: 'error',
    startedAt: now,
    endedAt: now,
    costUSD: null,
    turns: null,
    durationMs: 0,
    sessionId: null,
    ok: false,
    summary: `failed to start: ${message}`.slice(0, 500),
  });
}

async function persistRun(run) {
  await fsp.mkdir(paths.runsDir, { recursive: true });
  await fsp.writeFile(
    path.join(paths.runsDir, `${run.id}.ndjson`),
    run.rawLines.join('\n') + '\n',
  );
  const summary = {
    id: run.id,
    skillId: run.skillId,
    agent: run.agent || 'claude',
    input: run.input,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    costUSD: run.result?.costUSD ?? null,
    turns: run.result?.turns ?? null,
    durationMs: run.result?.durationMs ?? (run.endedAt - run.startedAt),
    sessionId: run.result?.sessionId ?? null,
    ok: run.result?.ok ?? false,
    summary: (run.result?.text || run.result?.error || '').slice(0, 500),
  };
  await appendSummary(summary);
}

/** Run history (newest first), from disk plus any in-memory active runs. */
export async function listRuns({ limit = 50 } = {}) {
  let persisted = [];
  try {
    persisted = parseJsonl(await fsp.readFile(paths.runsIndex, 'utf8'));
  } catch (err) {
    // no runs yet is normal; anything else means the scheduler is flying blind
    if (err.code !== 'ENOENT') throw err;
  }
  const active = [...runs.values()]
    .filter((r) => r.status === 'running')
    .map((r) => ({
      id: r.id,
      skillId: r.skillId,
      input: r.input,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: null,
      costUSD: null,
      turns: null,
      durationMs: Date.now() - r.startedAt,
      ok: null,
      summary: '',
    }));
  return [...active, ...persisted.reverse()].slice(0, limit);
}

/** Latest finished run per skill id, for the skill cards. */
export async function lastRunsBySkill() {
  const all = await listRuns({ limit: 500 });
  const bySkill = {};
  for (const run of all) {
    if (run.status === 'running') continue;
    if (!bySkill[run.skillId]) bySkill[run.skillId] = run;
  }
  return bySkill;
}
