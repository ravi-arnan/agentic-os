import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { dayKey } from './jsonl.mjs';

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', '.claude', 'node_modules']);
// Structural notes that shouldn't count as orphans
const STRUCTURAL = new Set(['INDEX', 'Dashboard', 'README', 'CLAUDE']);

/** Extract wikilink targets from note content: [[target|alias]] / [[target#heading]]. */
export function extractWikilinks(content) {
  const links = [];
  const re = /\[\[([^\[\]]+?)\]\]/g;
  let m;
  while ((m = re.exec(content))) {
    const target = m[1].split('|')[0].split('#')[0].trim();
    if (target) links.push(target);
  }
  return links;
}

/**
 * Orphan detection over {relPath, content} notes: a note is an orphan when
 * nothing links to it. Daily notes, templates, and structural notes are
 * excluded (they're navigational, not knowledge notes).
 */
export function findOrphans(notes) {
  const linkedTo = new Set();
  for (const note of notes) {
    for (const target of extractWikilinks(note.content)) {
      linkedTo.add(path.basename(target).toLowerCase());
    }
  }
  const orphans = [];
  for (const note of notes) {
    const base = path.basename(note.relPath, '.md');
    const top = note.relPath.split('/')[0];
    if (STRUCTURAL.has(base)) continue;
    if (top === 'daily' || top === 'Templates' || top === 'AI' || top === 'docs') continue;
    if (!linkedTo.has(base.toLowerCase())) orphans.push(note.relPath);
  }
  return orphans.sort();
}

/**
 * Daily-note streak from filenames like 2026-07-04.md. Counts consecutive
 * days ending today or yesterday (today not written yet doesn't break it).
 */
export function computeStreak(dayNames, today = dayKey(Date.now())) {
  const days = new Set(dayNames);
  const cursor = new Date(`${today}T12:00:00`);
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1); // grace for today
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function walkVault(dir, rel = '', out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && rel === '' && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkVault(abs, relPath, out);
    } else if (entry.name.endsWith('.md')) {
      out.push({ abs, relPath });
    }
  }
  return out;
}

export async function getVaultHealth() {
  const root = config.vaultDir;
  const files = await walkVault(root);
  if (files.length === 0) {
    return { ok: false, error: `vault not found or empty: ${root}` };
  }

  const notes = [];
  const editedPerDay = new Map();
  const byFolder = new Map();
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;

  for (const f of files) {
    let stat;
    try {
      stat = await fsp.stat(f.abs);
    } catch {
      continue;
    }
    const folder = f.relPath.includes('/') ? f.relPath.split('/')[0] : '(root)';
    byFolder.set(folder, (byFolder.get(folder) || 0) + 1);
    if (stat.mtimeMs >= cutoff) {
      const day = dayKey(stat.mtimeMs);
      editedPerDay.set(day, (editedPerDay.get(day) || 0) + 1);
    }
    let content = '';
    try {
      content = await fsp.readFile(f.abs, 'utf8');
    } catch {
      // unreadable, treat as empty
    }
    notes.push({ relPath: f.relPath, content });
  }

  const dailyNames = files
    .filter((f) => f.relPath.startsWith('daily/'))
    .map((f) => path.basename(f.relPath, '.md'))
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));

  const today = dayKey(Date.now());
  const orphans = findOrphans(notes);
  const inboxCount = files.filter((f) => f.relPath.startsWith('00-Inbox/')).length;

  return {
    ok: true,
    root,
    noteCount: notes.length,
    byFolder: [...byFolder.entries()]
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => b.count - a.count),
    dailyStreak: computeStreak(dailyNames, today),
    hasTodayDaily: dailyNames.includes(today),
    hasTodaySessionLog: files.some((f) => f.relPath === `AI/sessions/${today}.md`),
    inboxCount,
    orphanCount: orphans.length,
    orphans: orphans.slice(0, 15),
    editedPerDay: [...editedPerDay.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
