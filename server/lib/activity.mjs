import fsp from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.mjs';
import { eachJsonlRecord, dayKey } from './jsonl.mjs';

/**
 * Prompt-level activity from ~/.claude/history.jsonl:
 * hour x weekday heatmap, prompts per day, per-project prompt counts,
 * top slash commands.
 */
export async function getActivity({ weeks = 8 } = {}) {
  const since = Date.now() - weeks * 7 * 24 * 3600 * 1000;
  // heatmap[weekday][hour], weekday 0 = Monday
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const perDay = new Map();
  const perProject = new Map();
  const commands = new Map();
  let total = 0;

  try {
    await eachJsonlRecord(paths.historyFile, (rec) => {
      const ts = rec.timestamp;
      if (typeof ts !== 'number' || ts < since) return;
      total += 1;
      const d = new Date(ts);
      const weekday = (d.getDay() + 6) % 7; // Mon-first
      heatmap[weekday][d.getHours()] += 1;
      const day = dayKey(ts);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      if (rec.project) {
        perProject.set(rec.project, (perProject.get(rec.project) || 0) + 1);
      }
      const display = String(rec.display || '');
      if (display.startsWith('/')) {
        const cmd = display.split(/\s+/)[0];
        commands.set(cmd, (commands.get(cmd) || 0) + 1);
      }
    });
  } catch {
    // no history file — return empty shape
  }

  return {
    weeks,
    totalPrompts: total,
    heatmap,
    perDay: [...perDay.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    perProject: [...perProject.entries()]
      .map(([project, count]) => ({ project, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    topCommands: [...commands.entries()]
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  };
}

/** Lifetime stats from Claude Code's own stats cache (may lag a few days). */
export async function getStatsCache() {
  try {
    const raw = JSON.parse(await fsp.readFile(paths.statsCache, 'utf8'));
    return {
      firstSessionDate: raw.firstSessionDate ?? null,
      totalSessions: raw.totalSessions ?? null,
      totalMessages: raw.totalMessages ?? null,
      lastComputedDate: raw.lastComputedDate ?? null,
      longestSession: raw.longestSession ?? null,
    };
  } catch {
    return null;
  }
}

/** Currently running Claude Code sessions (from ~/.claude/sessions/*.json). */
export async function getLiveSessions() {
  let files = [];
  try {
    files = await fsp.readdir(paths.liveSessions);
  } catch {
    return [];
  }
  const sessions = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(paths.liveSessions, file), 'utf8'));
      if (!raw.pid) continue;
      try {
        process.kill(raw.pid, 0); // liveness probe, doesn't signal
      } catch {
        continue; // stale file, process gone
      }
      sessions.push({
        pid: raw.pid,
        sessionId: raw.sessionId,
        cwd: raw.cwd,
        name: raw.name || null,
        status: raw.status || 'unknown',
        startedAt: raw.startedAt || null,
        updatedAt: raw.updatedAt || null,
      });
    } catch {
      // unreadable — skip
    }
  }
  return sessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}
