import { skills } from '../skills/index.mjs';
import { startRun, listRuns } from './runner.mjs';
import { dayKey } from './jsonl.mjs';

const TICK_MS = 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

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

export function startScheduler({ log = console.log } = {}) {
  if (process.env.AGENTIC_OS_NO_SCHEDULE) {
    log('[scheduler] disabled via AGENTIC_OS_NO_SCHEDULE');
    return null;
  }
  let prev = Date.now();
  const timer = setInterval(async () => {
    const now = Date.now();
    try {
      const runs = await listRuns({ limit: 100 });
      for (const skill of dueSkills(skills, prev, now, runs)) {
        log(`[scheduler] firing ${skill.id}`);
        await startRun(skill, '').catch((err) =>
          log(`[scheduler] ${skill.id} failed to start: ${err.message}`),
        );
      }
    } catch (err) {
      log(`[scheduler] tick error: ${err.message}`);
    }
    prev = now;
  }, TICK_MS);
  timer.unref?.();
  const scheduled = skills.filter((s) => s.schedule);
  log(
    `[scheduler] armed: ${scheduled
      .map((s) => `${s.id}@${String(s.schedule.hour).padStart(2, '0')}:${String(s.schedule.minute || 0).padStart(2, '0')}${s.schedule.weekday != null ? '/wd' + s.schedule.weekday : ''}`)
      .join(', ') || 'none'}`,
  );
  return timer;
}
