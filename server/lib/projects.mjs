import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.mjs';

const run = promisify(execFile);
const GIT_TIMEOUT = 5000;
const CONCURRENCY = 8;

async function gitInfo(dir) {
  const opts = { cwd: dir, timeout: GIT_TIMEOUT };
  try {
    const [status, log, branch] = await Promise.all([
      run('git', ['status', '--porcelain'], opts),
      run('git', ['log', '-1', '--format=%ct\t%s'], opts).catch(() => null),
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).catch(() => null),
    ]);
    const dirtyFiles = status.stdout.split('\n').filter(Boolean).length;
    let lastCommitAt = null;
    let lastCommitMsg = null;
    if (log?.stdout) {
      const [ct, ...msg] = log.stdout.trim().split('\t');
      lastCommitAt = Number(ct) * 1000 || null;
      lastCommitMsg = msg.join('\t') || null;
    }
    return {
      isGit: true,
      dirtyFiles,
      lastCommitAt,
      lastCommitMsg,
      branch: branch?.stdout.trim() || null,
    };
  } catch {
    return { isGit: false };
  }
}

/** Map memory hooks from MEMORY.md index lines onto project dir names. */
async function loadMemoryHooks() {
  const hooks = new Map();
  try {
    const raw = await fsp.readFile(path.join(config.memoryDir, 'MEMORY.md'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^- \[(.+?)\]\((.+?)\)\s*(?:—|-)?\s*(.*)$/);
      if (!m) continue;
      const hook = { title: m[1], note: m[3] || '' };
      const text = `${m[1]} ${m[3]}`;
      // match "Projects/<dir>" mentions to a directory name
      const dirMatch = text.match(/Projects\/([A-Za-z0-9._-]+)/);
      if (dirMatch) hooks.set(dirMatch[1].toLowerCase(), hook);
    }
  } catch {
    // no memory index — fine
  }
  return hooks;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Sweep ~/Projects top-level dirs: git state, staleness, memory hook.
 * usageByProject (optional): Map of cwd path -> { lastActive, cost } from
 * transcript aggregation, used to show Claude activity per project.
 */
export async function sweepProjects(usageByProject = new Map()) {
  let entries;
  try {
    entries = await fsp.readdir(config.projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  const memoryHooks = await loadMemoryHooks();

  const projects = await mapLimit(dirs, CONCURRENCY, async (entry) => {
    const dir = path.join(config.projectsRoot, entry.name);
    const [git, stat] = await Promise.all([gitInfo(dir), fsp.stat(dir).catch(() => null)]);
    const usage = usageByProject.get(dir) || null;
    const lastTouch = Math.max(
      git.lastCommitAt || 0,
      usage?.lastActive ? new Date(usage.lastActive).getTime() : 0,
      stat?.mtimeMs || 0,
    );
    return {
      name: entry.name,
      path: dir,
      ...git,
      memory: memoryHooks.get(entry.name.toLowerCase()) || null,
      claude: usage
        ? { lastActive: usage.lastActive, cost: usage.cost, sessions: usage.sessions }
        : null,
      lastTouch: lastTouch || null,
      staleDays: lastTouch ? Math.floor((Date.now() - lastTouch) / 86400000) : null,
    };
  });

  return projects.sort((a, b) => (b.lastTouch || 0) - (a.lastTouch || 0));
}
