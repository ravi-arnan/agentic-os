import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.mjs';
import { eachJsonlRecord, dayKey } from '../lib/jsonl.mjs';
import { scanUsage, summarizeUsage } from '../lib/usage.mjs';
import { sweepProjects } from '../lib/projects.mjs';
import { listRuns } from '../lib/runner.mjs';
import { wasDueOnDay } from '../lib/scheduler.mjs';

const run = promisify(execFile);
const VAULT = config.vaultDir;
const VAULT_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'];
const GIT_READ_TOOLS = ['Bash(git status:*)', 'Bash(git log:*)', 'Bash(git -C:*)', 'Bash(git diff:*)'];

function fmtDate(ms) {
  return ms ? new Date(ms).toISOString().slice(0, 10) : '?';
}

/**
 * afterRun step: commit the day's vault changes so automated writes don't
 * drift from the remote. The vault is docs, not code, so auto-commit is safe
 * (unlike code projects — see the commit-policy the user set). Best-effort
 * push; a push failure is reported but does not fail the run.
 */
async function commitVault() {
  const opts = { cwd: VAULT, timeout: 15000 };
  const { stdout: status } = await run('git', ['status', '--porcelain'], opts);
  if (!status.trim()) return 'vault: nothing to commit (clean)';
  const changed = status.trim().split('\n').length;
  const today = dayKey(Date.now());
  await run('git', ['add', '-A'], opts);
  await run('git', ['commit', '-m', `vault: auto-log ${today} (agentic-os)`], opts);
  let push = 'not pushed';
  try {
    await run('git', ['push'], { ...opts, timeout: 30000 });
    push = 'pushed';
  } catch (err) {
    push = `push failed (${String(err.message || err).split('\n')[0].slice(0, 80)})`;
  }
  return `vault: committed ${changed} change(s) for ${today}, ${push}`;
}

/**
 * Silent-failure guard: summarize how yesterday's scheduled skills went so the
 * morning briefing can flag a journaler/sweep that quietly failed or never ran.
 * Pure over (skills, runs, now) for testability.
 */
export function scheduledRunHealth(allSkills, runs, now = Date.now()) {
  const yKey = dayKey(now - 24 * 3600 * 1000);
  const yDate = new Date(now - 24 * 3600 * 1000);
  const scheduled = allSkills.filter((s) => s.schedule && !s.needsInput);
  const lines = [];
  for (const s of scheduled) {
    if (!wasDueOnDay(s.schedule, yDate)) continue; // e.g. weekday-only sweep
    const runsY = runs.filter((r) => r.skillId === s.id && dayKey(r.startedAt) === yKey);
    if (runsY.some((r) => r.ok)) lines.push(`- ${s.id}: OK`);
    else if (runsY.some((r) => r.ok === false)) lines.push(`- ${s.id}: GAGAL (cek journalctl / ops log)`);
    else lines.push(`- ${s.id}: TIDAK JALAN (server mati jam segitu?)`);
  }
  return { date: yKey, lines };
}

/** Compact digest of ~/Projects state for prompt injection. */
async function projectsDigest(limit = 14) {
  const projects = await sweepProjects();
  const lines = projects.slice(0, limit).map((p) => {
    const bits = [p.name];
    if (p.isGit) {
      bits.push(`branch=${p.branch}`, `dirty=${p.dirtyFiles}`);
      if (p.lastCommitAt) bits.push(`lastCommit=${fmtDate(p.lastCommitAt)} "${p.lastCommitMsg}"`);
    } else {
      bits.push('no-git');
    }
    if (p.staleDays != null) bits.push(`staleDays=${p.staleDays}`);
    if (p.memory) bits.push(`memo="${p.memory.title}: ${p.memory.note.slice(0, 90)}"`);
    return '- ' + bits.join(' | ');
  });
  return lines.join('\n');
}

/** What happened in Claude Code today: prompts per project + spend. */
async function todayDigest() {
  const today = dayKey(Date.now());
  const prompts = [];
  const perProject = new Map();
  try {
    await eachJsonlRecord(paths.historyFile, (rec) => {
      if (typeof rec.timestamp !== 'number') return;
      if (dayKey(rec.timestamp) !== today) return;
      const proj = rec.project || '?';
      const p = perProject.get(proj) || { count: 0, first: rec.timestamp, last: rec.timestamp };
      p.count += 1;
      p.first = Math.min(p.first, rec.timestamp);
      p.last = Math.max(p.last, rec.timestamp);
      perProject.set(proj, p);
      if (prompts.length < 40 && rec.display && !rec.display.startsWith('/')) {
        const hhmm = new Date(rec.timestamp).toTimeString().slice(0, 5);
        prompts.push(`  [${hhmm}] (${proj.split('/').pop()}) ${String(rec.display).replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    });
  } catch {
    // no history
  }

  let costLine = '';
  try {
    const usage = summarizeUsage(await scanUsage(), { days: 2 });
    const todayRow = usage.daily.find((d) => d.date === today);
    if (todayRow) {
      costLine = `Spend today: $${todayRow.cost.toFixed(2)}, ${todayRow.messages} messages, ${todayRow.toolCalls} tool calls, models: ${Object.keys(todayRow.byModel).join(', ')}`;
    }
  } catch (err) {
    // say it out loud in the prompt: a silently missing cost line looks like a zero-spend day
    costLine = `Spend today: (gagal dibaca: ${String(err.message || err).slice(0, 120)})`;
  }

  const projLines = [...perProject.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([proj, p]) => {
      const span = `${new Date(p.first).toTimeString().slice(0, 5)}-${new Date(p.last).toTimeString().slice(0, 5)}`;
      return `- ${proj}: ${p.count} prompts (${span})`;
    });

  return [
    `Date: ${today}`,
    costLine,
    'Projects touched today:',
    projLines.join('\n') || '- (none)',
    'Sample prompts:',
    prompts.join('\n') || '  (none)',
  ].filter(Boolean).join('\n');
}

/** ISO-8601 week label like 2026-W27 for a date. */
export function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Inventory of this week's daily/session files + current inbox, for the weekly review. */
async function weekInventory(now = Date.now()) {
  const days = Array.from({ length: 7 }, (_, i) => dayKey(now - i * 86400000)).reverse();
  const exists = async (dir, name) => {
    try {
      await fsp.access(path.join(VAULT, dir, name));
      return `${dir}/${name}`;
    } catch {
      return null;
    }
  };
  const dailies = (await Promise.all(days.map((d) => exists('daily', `${d}.md`)))).filter(Boolean);
  const sessions = (await Promise.all(days.map((d) => exists('AI/sessions', `${d}.md`)))).filter(Boolean);
  let inbox = [];
  try {
    inbox = (await fsp.readdir(path.join(VAULT, '00-Inbox')))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `00-Inbox/${f}`);
  } catch {
    // no inbox dir
  }
  return { label: isoWeekLabel(new Date(now)), days, dailies, sessions, inbox };
}

export const skills = [
  {
    id: 'morning-briefing',
    name: 'Morning briefing',
    tagline: 'Sweep projects + memory, write today\'s plan into the daily note',
    icon: 'Sunrise',
    cwd: VAULT,
    needsInput: false,
    schedule: { hour: 8, minute: 30 },
    permissionMode: 'acceptEdits',
    allowedTools: [...VAULT_TOOLS, ...GIT_READ_TOOLS],
    timeoutMs: 12 * 60 * 1000,
    async buildPrompt() {
      const digest = await projectsDigest();
      const today = dayKey(Date.now());
      const health = scheduledRunHealth(skills, await listRuns({ limit: 100 }).catch(() => []));
      const healthBlock = health.lines.length
        ? `Status run terjadwal kemarin (${health.date}):\n${health.lines.join('\n')}`
        : '';
      return [
        'Kamu lagi jalan sebagai skill "Morning briefing" dari dashboard Agentic OS.',
        'Ikuti protokol vault di CLAUDE.md (gaya bahasa, tanpa emoji, tanpa em-dash).',
        '',
        healthBlock,
        healthBlock ? '' : null,
        'Snapshot deterministik kondisi ~/Projects (sudah dihitung, jangan scan ulang git):',
        digest,
        '',
        'Tugas:',
        '0. Kalau ada run terjadwal yang GAGAL atau TIDAK JALAN di status di atas, sebut di baris pertama briefing sebagai peringatan (misal journaler kemarin gagal, streak bisa putus).',
        `1. Baca INDEX.md dan daily note kemarin (folder daily/) kalau ada.`,
        `2. Buat atau update daily note hari ini: daily/${today}.md (pakai Templates/daily.md kalau belum ada).`,
        '3. Isi bagian Prioritas dengan 3-5 item paling penting hari ini, berdasarkan snapshot di atas + open loops kemarin. Sebut project mana yang mulai basi (staleDays besar tapi masih penting).',
        '4. Isi bagian Konteks buat AI dengan 2-3 baris konteks yang berguna untuk sesi berikutnya.',
        '',
        'Setelah selesai nulis, balas dengan briefing singkat (maks 10 baris) supaya kelihatan di dashboard.',
      ].filter((l) => l !== null).join('\n');
    },
  },
  {
    id: 'status-sweep',
    name: 'Project status sweep',
    tagline: 'Per-project status + next action, saved to the vault',
    icon: 'Radar',
    cwd: VAULT,
    needsInput: false,
    schedule: { hour: 17, minute: 0, weekday: 5 }, // Fridays
    permissionMode: 'acceptEdits',
    allowedTools: [...VAULT_TOOLS, ...GIT_READ_TOOLS, `Read(${config.projectsRoot}/**)`],
    timeoutMs: 15 * 60 * 1000,
    async buildPrompt() {
      const digest = await projectsDigest(20);
      const today = dayKey(Date.now());
      return [
        'Kamu lagi jalan sebagai skill "Project status sweep" dari dashboard Agentic OS.',
        'Ikuti protokol vault di CLAUDE.md.',
        '',
        'Snapshot deterministik kondisi ~/Projects (sudah dihitung, jangan scan ulang git):',
        digest,
        '',
        'Tugas:',
        '1. Baca INDEX.md untuk lihat catatan project yang ada di vault (01-Projects/).',
        '2. Pilih maksimal 8 project yang paling aktif atau paling berisiko basi. Untuk tiap project, kalau ada catatannya di 01-Projects/ baca sekilas untuk konteks next action; kalau perlu detail, boleh baca PLAN.md / HANDOFF.md / README.md di folder projectnya langsung.',
        `3. Tulis laporan ke AI/status/${today}.md: per project satu blok pendek berisi status sekarang, blocker, dan next action konkret 1 kalimat.`,
        '4. Kalau ada project yang statusnya beda jauh dari catatan vault, update satu baris di catatan project terkait (jangan rombak).',
        '',
        'Balas dengan tabel ringkas project -> next action (maks 12 baris).',
      ].join('\n');
    },
  },
  {
    id: 'session-journaler',
    name: 'Session journaler',
    tagline: 'Summarize today\'s Claude Code work into the vault log, then commit',
    icon: 'NotebookPen',
    cwd: VAULT,
    needsInput: false,
    schedule: { hour: 21, minute: 30 },
    permissionMode: 'acceptEdits',
    allowedTools: VAULT_TOOLS,
    model: 'haiku',
    timeoutMs: 8 * 60 * 1000,
    // end-of-day roll-up: commit whatever the day's skills wrote to the vault
    afterRun: commitVault,
    async buildPrompt() {
      const digest = await todayDigest();
      const today = dayKey(Date.now());
      return [
        'Kamu lagi jalan sebagai skill "Session journaler" dari dashboard Agentic OS.',
        'Ikuti protokol vault di CLAUDE.md, terutama format log sesi di AI/sessions/.',
        '',
        'Digest aktivitas Claude Code hari ini (sudah dihitung dari history, jangan cari sumber lain):',
        digest,
        '',
        'Tugas:',
        `1. Tulis atau update AI/sessions/${today}.md: ringkasan 5-10 baris tentang apa saja yang dikerjakan hari ini, per project, dari digest di atas.`,
        `2. Append satu-dua bullet ke bagian Agent log di daily/${today}.md (buat filenya dari Templates/daily.md kalau belum ada).`,
        '',
        'Balas dengan ringkasan log yang kamu tulis.',
      ].join('\n');
    },
  },
  {
    id: 'capture',
    name: 'Quick capture',
    tagline: 'Route a thought to the right note in the vault',
    icon: 'Inbox',
    cwd: VAULT,
    needsInput: true,
    placeholder: 'Tulis ide, TODO, atau catatan cepat...',
    permissionMode: 'acceptEdits',
    allowedTools: VAULT_TOOLS,
    model: 'haiku',
    timeoutMs: 5 * 60 * 1000,
    async buildPrompt(input) {
      const text = String(input || '').trim();
      return [
        'Kamu lagi jalan sebagai skill "Quick capture" dari dashboard Agentic OS.',
        'Ikuti protokol vault di CLAUDE.md (frontmatter, wikilink, update INDEX.md kalau bikin note baru).',
        '',
        'Capture dari user:',
        `"""${text}"""`,
        '',
        'Tugas:',
        '1. Baca INDEX.md, tentukan tempat paling pas untuk capture ini: append ke note project/area yang sudah ada, atau kalau tidak jelas, bikin note baru di 00-Inbox/ dengan judul singkat.',
        '2. Tulis capturenya rapi (bukan mentah-mentah): satu-dua kalimat plus konteks tanggal.',
        '3. Kalau ini TODO yang jelas terkait hari ini, tambahkan juga ke daily note hari ini bagian Open loops.',
        '',
        'Balas satu kalimat: ditaruh di mana dan kenapa.',
      ].join('\n');
    },
  },
  {
    id: 'weekly-review',
    name: 'Weekly review',
    tagline: 'Roll up the week, carry open loops forward, empty the inbox',
    icon: 'CalendarCheck',
    cwd: VAULT,
    needsInput: false,
    schedule: { hour: 20, minute: 0, weekday: 0 }, // Minggu 20:00
    permissionMode: 'acceptEdits',
    allowedTools: VAULT_TOOLS,
    timeoutMs: 15 * 60 * 1000,
    afterRun: commitVault,
    async buildPrompt() {
      const inv = await weekInventory();
      return [
        'Kamu lagi jalan sebagai skill "Weekly review" dari dashboard Agentic OS.',
        'Ikuti protokol vault di CLAUDE.md (gaya bahasa santai, tanpa emoji, tanpa em-dash, wikilink, disiplin INDEX).',
        '',
        `Minggu ini: ${inv.label}.`,
        'File minggu ini yang perlu kamu baca (baca yang ada, lewati yang tidak):',
        `- Daily notes: ${inv.dailies.join(', ') || '(tidak ada)'}`,
        `- Log sesi: ${inv.sessions.join(', ') || '(tidak ada)'}`,
        `- Isi 00-Inbox sekarang: ${inv.inbox.join(', ') || '(kosong)'}`,
        '',
        'Tugas:',
        `1. Tulis AI/weekly/${inv.label}.md: rangkuman minggu ini dari daily + log sesi. Isi: apa yang selesai, keputusan penting, dan open loops yang MASIH terbuka (belum kelar). Kelompokkan per project kalau relevan. Bikin folder AI/weekly/ kalau belum ada.`,
        '2. Bawa open loops yang masih terbuka ke daily note hari ini bagian Open loops (jangan biarkan hilang ke masa lalu).',
        '3. KOSONGKAN 00-Inbox: untuk tiap file di 00-Inbox, proses satu-satu. Pindahkan isinya ke note project/area/resource yang pas (append, rapikan, kasih wikilink), atau kalau ternyata sudah tidak relevan, catat singkat di weekly review lalu hapus filenya. Setelah selesai 00-Inbox harus kosong. Update INDEX.md kalau ada note baru.',
        '4. Kalau ada project yang minggu ini nggak disentuh sama sekali padahal statusnya active, sebut di weekly review sebagai kandidat untuk di-pause atau diarsipkan.',
        '',
        'Balas dengan ringkasan weekly review (maks 12 baris): highlight minggu ini, berapa item inbox diproses, dan open loops yang dibawa ke depan.',
      ].join('\n');
    },
  },
];

export function getSkill(id) {
  return skills.find((s) => s.id === id) || null;
}

/** Public skill metadata for the frontend (no prompt builders). */
export function listSkills() {
  return skills.map(({ buildPrompt, ...meta }) => meta);
}
