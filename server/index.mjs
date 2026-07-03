import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { scanUsage, summarizeUsage } from './lib/usage.mjs';
import { getActivity, getStatsCache, getLiveSessions } from './lib/activity.mjs';
import { getVaultHealth } from './lib/vault.mjs';
import { sweepProjects } from './lib/projects.mjs';
import { startRun, getRun, serializeRun, killRun, listRuns, lastRunsBySkill } from './lib/runner.mjs';
import { getSkill, listSkills } from './skills/index.mjs';
import { startScheduler } from './lib/scheduler.mjs';
import { dayKey } from './lib/jsonl.mjs';

const app = express();
app.use(express.json({ limit: '256kb' }));

const asyncRoute = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[api] ${req.path}:`, err);
    res.status(500).json({ error: String(err.message || err) });
  });

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------

app.get('/api/overview', asyncRoute(async (req, res) => {
  const [liveSessions, stats, usage] = await Promise.all([
    getLiveSessions(),
    getStatsCache(),
    scanUsage().then((aggs) => summarizeUsage(aggs, { days: 2 })),
  ]);
  const today = usage.daily.find((d) => d.date === dayKey(Date.now())) || null;
  res.json({ liveSessions, stats, today, totals: usage.totals });
}));

app.get('/api/usage', asyncRoute(async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 45);
  const aggs = await scanUsage();
  res.json(summarizeUsage(aggs, { days }));
}));

app.get('/api/activity', asyncRoute(async (req, res) => {
  res.json(await getActivity({ weeks: Math.min(26, Number(req.query.weeks) || 8) }));
}));

app.get('/api/vault', asyncRoute(async (req, res) => {
  res.json(await getVaultHealth());
}));

app.get('/api/projects', asyncRoute(async (req, res) => {
  const aggs = await scanUsage();
  const byProject = new Map();
  for (const p of summarizeUsage(aggs, { days: 3650 }).perProject) {
    byProject.set(p.project, { lastActive: p.lastActive, cost: p.cost, sessions: p.sessions });
  }
  res.json(await sweepProjects(byProject));
}));

// --------------------------------------------------------------------------
// Skills & runs
// --------------------------------------------------------------------------

app.get('/api/skills', asyncRoute(async (req, res) => {
  res.json({ skills: listSkills(), lastRuns: await lastRunsBySkill() });
}));

app.post('/api/skills/:id/run', asyncRoute(async (req, res) => {
  const skill = getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: 'unknown skill' });
  const input = typeof req.body?.input === 'string' ? req.body.input.slice(0, 4000) : '';
  if (skill.needsInput && !input.trim()) {
    return res.status(400).json({ error: 'this skill needs input' });
  }
  const run = await startRun(skill, input);
  res.json({ runId: run.id });
}));

app.get('/api/runs', asyncRoute(async (req, res) => {
  res.json(await listRuns({ limit: Math.min(200, Number(req.query.limit) || 50) }));
}));

app.get('/api/runs/:id', asyncRoute(async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found (in-memory only)' });
  res.json(serializeRun(run));
}));

app.post('/api/runs/:id/kill', asyncRoute(async (req, res) => {
  res.json({ killed: killRun(req.params.id) });
}));

// Live event stream for a run (replays buffered events, then follows).
app.get('/api/runs/:id/stream', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
  for (const evt of run.events) send(evt);
  if (run.status !== 'running') {
    send({ t: 'end', status: run.status });
    return res.end();
  }
  const onEvent = (evt) => send(evt);
  const onEnd = (status) => {
    send({ t: 'end', status });
    cleanup();
    res.end();
  };
  const heartbeat = setInterval(() => res.write(': hb\n\n'), 15000);
  function cleanup() {
    clearInterval(heartbeat);
    run.emitter.off('event', onEvent);
    run.emitter.off('end', onEnd);
  }
  run.emitter.on('event', onEvent);
  run.emitter.on('end', onEnd);
  req.on('close', cleanup);
});

// --------------------------------------------------------------------------
// Static frontend (production build)
// --------------------------------------------------------------------------

if (fs.existsSync(config.distDir)) {
  app.use(express.static(config.distDir));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(config.distDir, 'index.html'));
  });
}

app.listen(config.port, config.host, () => {
  console.log(`agentic-os server on http://${config.host}:${config.port}`);
  console.log(`  transcripts: ${config.claudeDir}/projects`);
  console.log(`  vault:       ${config.vaultDir}`);
  startScheduler();
});
