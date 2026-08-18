import { skills } from '../skills/index.mjs';
import { startRun, listRuns, recordFailedStart } from './runner.mjs';
import { dayKey } from './jsonl.mjs';

const TICK_MS = 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
// How far back a tick will reach for a slot it missed, so a server that was
// started late (or a laptop waking from sleep) still runs today's schedule.
// Bounded on purpose: a briefing fired eight hours late is noise, not a catch-up.
const CATCHUP_MS = 6 * 3600 * 1000;
// A scheduled skill is stale once it has missed two of its own cycles.
const STALE_CYCLES = 2;

/**
 * True when schedule {hour, minute?, weekday?} fires inside (prevMs, nowMs].
 * Checks today's and yesterday's target so a tick straddling midnight
 * still catches a late-evening schedule. weekday uses JS getDay() (0=Sun).
 */
export function isDue(schedule, prevMs, nowMs) {
  if (!schedule || typeof schedule.hour !== 'number') return false;
  for (const dayOffset of [0, -1]) {
    const target = new Date(nowMs + dayOffset * DAY_MS);
    target.setHours(schedule.hour, schedule.minute || 0, 0, 0);
    if (schedule.weekday != null && target.getDay() !== schedule.weekday) continue;
    const t = target.getTime();
    if (t > prevMs && t <= nowMs) return true;
  }
  return false;
}

/** True if a schedule should run on the given calendar day (weekday-aware). */
export function wasDueOnDay(schedule, date) {
  if (!schedule || typeof schedule.hour !== 'number') return false;
  return schedule.weekday == null || date.getDay() === schedule.weekday;
}

/** Pure selection of which skills should fire, given run history. */
export function dueSkills(allSkills, prevMs, nowMs, runsToday) {
  const ranToday = new Set(
    runsToday
      .filter((r) => dayKey(r.startedAt) === dayKey(nowMs) && r.status !== 'error')
      .map((r) => r.skillId),
  );
  return allSkills.filter(
    (s) => s.schedule && !s.needsInput && !ranToday.has(s.id) && isDue(s.schedule, prevMs, nowMs),
  );
}

function firstLine(text) {
  return String(text || '').trim().split('\n')[0].slice(0, 140);
}

/**
 * Scheduled skills that are not healthy right now: last run failed, never ran,
 * or nothing has run for two cycles (server down / asleep). Pure over
 * (skills, lastRunsBySkill, now) so the dashboard and tests share one answer.
 */
export function skillAlerts(allSkills, lastRuns = {}, now = Date.now()) {
  const alerts = [];
  for (const skill of allSkills) {
    if (!skill.schedule || skill.needsInput) continue;
    const last = lastRuns[skill.id];
    if (!last) {
      alerts.push({ skillId: skill.id, level: 'warn', message: 'never run' });
      continue;
    }
    if (last.ok === false) {
      alerts.push({
        skillId: skill.id,
        level: 'error',
        message: `last run failed: ${firstLine(last.summary) || 'no detail'}`,
      });
      continue;
    }
    const cycleMs = (skill.schedule.weekday == null ? 1 : 7) * DAY_MS;
    const ageMs = now - (last.endedAt || last.startedAt || 0);
    if (ageMs > STALE_CYCLES * cycleMs) {
      alerts.push({
        skillId: skill.id,
        level: 'warn',
        message: `no run for ${Math.floor(ageMs / DAY_MS)}d, scheduler was probably not running`,
      });
    }
  }
  return alerts;
}

export function startScheduler({ log = console.log } = {}) {
  if (process.env.AGENTIC_OS_NO_SCHEDULE) {
    log('[scheduler] disabled via AGENTIC_OS_NO_SCHEDULE');
    return null;
  }
  let prev = 0; // first tick reaches back CATCHUP_MS, see the clamp below

  async function tick() {
    const now = Date.now();
    const from = Math.max(prev, now - CATCHUP_MS);
    try {
      const runs = await listRuns({ limit: 100 });
      for (const skill of dueSkills(skills, from, now, runs)) {
        log(`[scheduler] firing ${skill.id}`);
        try {
          await startRun(skill, '');
        } catch (err) {
          const msg = String(err.message || err);
          log(`[scheduler] ${skill.id} could not start: ${msg}`);
          // stdout alone is not a channel anyone reads, so put it in the run index
          await recordFailedStart(skill.id, msg).catch((e) =>
            log(`[scheduler] could not record failed start for ${skill.id}: ${e.message || e}`),
          );
        }
      }
    } catch (err) {
      log(`[scheduler] tick error: ${err.message || err}`);
    }
    prev = now;
  }

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick(); // catch up immediately instead of waiting out the first interval
  const scheduled = skills.filter((s) => s.schedule);
  log(
    `[scheduler] armed: ${scheduled
      .map((s) => `${s.id}@${String(s.schedule.hour).padStart(2, '0')}:${String(s.schedule.minute || 0).padStart(2, '0')}${s.schedule.weekday != null ? '/wd' + s.schedule.weekday : ''}`)
      .join(', ') || 'none'}`,
  );
  return timer;
}
