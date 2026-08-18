import { describe, test, expect } from 'vitest';
import { isDue, dueSkills, wasDueOnDay, skillAlerts } from '../lib/scheduler.mjs';

// local-time helper: ms for today's date at h:m
const at = (y, mo, d, h, m) => new Date(y, mo - 1, d, h, m, 0, 0).getTime();

describe('isDue', () => {
  test('fires when target falls inside the tick window', () => {
    const prev = at(2026, 7, 4, 8, 29);
    const now = at(2026, 7, 4, 8, 30);
    expect(isDue({ hour: 8, minute: 30 }, prev, now)).toBe(true);
  });

  test('does not fire before or after the window', () => {
    expect(isDue({ hour: 8, minute: 30 }, at(2026, 7, 4, 8, 27), at(2026, 7, 4, 8, 28))).toBe(false);
    expect(isDue({ hour: 8, minute: 30 }, at(2026, 7, 4, 8, 31), at(2026, 7, 4, 8, 32))).toBe(false);
  });

  test('catches a late-night schedule across midnight', () => {
    // tick straddles midnight; 23:59 target belongs to "yesterday" of now
    const prev = at(2026, 7, 4, 23, 58);
    const now = at(2026, 7, 5, 0, 1);
    expect(isDue({ hour: 23, minute: 59 }, prev, now)).toBe(true);
  });

  test('weekday filter: 2026-07-03 is a Friday (getDay 5)', () => {
    const prev = at(2026, 7, 3, 16, 59);
    const now = at(2026, 7, 3, 17, 0);
    expect(isDue({ hour: 17, minute: 0, weekday: 5 }, prev, now)).toBe(true);
    // Saturday same time: no fire
    expect(isDue({ hour: 17, minute: 0, weekday: 5 }, at(2026, 7, 4, 16, 59), at(2026, 7, 4, 17, 0))).toBe(false);
  });

  test('rejects malformed schedules', () => {
    expect(isDue(null, 0, 1)).toBe(false);
    expect(isDue({}, 0, 1)).toBe(false);
  });
});

describe('wasDueOnDay', () => {
  test('daily schedule is due any day', () => {
    expect(wasDueOnDay({ hour: 8 }, new Date(2026, 6, 4))).toBe(true); // Sat
    expect(wasDueOnDay({ hour: 8 }, new Date(2026, 6, 5))).toBe(true); // Sun
  });

  test('weekday schedule only on its weekday', () => {
    expect(wasDueOnDay({ hour: 17, weekday: 5 }, new Date(2026, 6, 3))).toBe(true); // Fri
    expect(wasDueOnDay({ hour: 17, weekday: 5 }, new Date(2026, 6, 4))).toBe(false); // Sat
  });

  test('malformed schedule is never due', () => {
    expect(wasDueOnDay(null, new Date())).toBe(false);
    expect(wasDueOnDay({}, new Date())).toBe(false);
  });
});

describe('dueSkills', () => {
  const skills = [
    { id: 'a', schedule: { hour: 8, minute: 30 }, needsInput: false },
    { id: 'b', schedule: { hour: 8, minute: 30 }, needsInput: true }, // input skills never auto-fire
    { id: 'c', needsInput: false }, // unscheduled
  ];
  const prev = at(2026, 7, 4, 8, 29);
  const now = at(2026, 7, 4, 8, 30);

  test('fires scheduled no-input skills only', () => {
    expect(dueSkills(skills, prev, now, []).map((s) => s.id)).toEqual(['a']);
  });

  test('a restart does not re-fire the slot it already served', () => {
    // The real restart case: the run happened AT the slot, then the process
    // came back inside the catch-up window and saw the same slot again.
    const runs = [{ skillId: 'a', startedAt: at(2026, 7, 4, 8, 30), status: 'done' }];
    expect(dueSkills(skills, prev, now, runs)).toEqual([]);
  });

  test('a manual run before the slot does not cancel the slot', () => {
    // Deliberate: an ad-hoc run at 08:00 is a different request from the
    // 08:30 schedule, and suppressing the schedule because of it was an
    // accident of the old calendar-day check.
    const runs = [{ skillId: 'a', startedAt: at(2026, 7, 4, 8, 0), status: 'done' }];
    expect(dueSkills(skills, prev, now, runs).map((s) => s.id)).toEqual(['a']);
  });

  test('an errored earlier run does not block a retry', () => {
    const runs = [{ skillId: 'a', startedAt: at(2026, 7, 4, 8, 0), status: 'error' }];
    expect(dueSkills(skills, prev, now, runs).map((s) => s.id)).toEqual(['a']);
  });

  test('a slot missed while the server was down is caught up within the window', () => {
    // server starts at 09:00; the 08:30 slot is inside the 6h catch-up reach
    const from = at(2026, 7, 4, 9, 0) - 6 * 3600 * 1000;
    expect(dueSkills(skills, from, at(2026, 7, 4, 9, 0), []).map((s) => s.id)).toEqual(['a']);
  });

  test('a restart after midnight does not re-fire last night slot', () => {
    // The live regression: service restarted 19 Aug 02:32, the 21:30 journaler
    // had already completed at 21:31 the evening before, and it ran again.
    const evening = [
      { id: 'j', schedule: { hour: 21, minute: 30 }, needsInput: false },
    ];
    const now = at(2026, 7, 5, 2, 32);
    const from = now - 6 * 3600 * 1000; // first tick reaches back CATCHUP_MS
    const runs = [{ skillId: 'j', startedAt: at(2026, 7, 4, 21, 31), status: 'done' }];

    expect(dueSkills(evening, from, now, [])).toHaveLength(1); // genuinely missed
    expect(dueSkills(evening, from, now, runs)).toEqual([]); // already served
  });

  test('a slot whose run failed last night is still retried after a restart', () => {
    const evening = [
      { id: 'j', schedule: { hour: 21, minute: 30 }, needsInput: false },
    ];
    const now = at(2026, 7, 5, 2, 32);
    const from = now - 6 * 3600 * 1000;
    const runs = [{ skillId: 'j', startedAt: at(2026, 7, 4, 21, 31), status: 'error' }];

    expect(dueSkills(evening, from, now, runs).map((s) => s.id)).toEqual(['j']);
  });

  test('a run from the cycle before does not serve this slot', () => {
    // Server was down all of the 4th. The run on the 3rd started a minute
    // after its OWN slot, which is exactly what a one-cycle-wide window would
    // have mistaken for this slot being done.
    const evening = [
      { id: 'j', schedule: { hour: 21, minute: 30 }, needsInput: false },
    ];
    const now = at(2026, 7, 5, 2, 32);
    const from = now - 6 * 3600 * 1000;
    const runs = [{ skillId: 'j', startedAt: at(2026, 7, 3, 21, 31), status: 'done' }];

    expect(dueSkills(evening, from, now, runs).map((s) => s.id)).toEqual(['j']);
  });

  test('a weekly slot dedupes over a week, not a day', () => {
    const weekly = [
      { id: 'w', schedule: { hour: 20, minute: 0, weekday: 0 }, needsInput: false },
    ];
    const now = at(2026, 7, 6, 1, 0); // Monday 01:00
    const from = now - 6 * 3600 * 1000;
    const runs = [{ skillId: 'w', startedAt: at(2026, 7, 5, 20, 1), status: 'done' }];

    expect(dueSkills(weekly, from, now, [])).toHaveLength(1);
    expect(dueSkills(weekly, from, now, runs)).toEqual([]);
  });

  test('a slot missed long ago is not resurrected', () => {
    const from = at(2026, 7, 4, 20, 0) - 6 * 3600 * 1000;
    expect(dueSkills(skills, from, at(2026, 7, 4, 20, 0), [])).toEqual([]);
  });
});

describe('skillAlerts', () => {
  const now = at(2026, 7, 29, 10, 0);
  const daily = { id: 'journaler', schedule: { hour: 21, minute: 30 }, needsInput: false };
  const weekly = { id: 'sweep', schedule: { hour: 17, weekday: 5 }, needsInput: false };
  const manual = { id: 'capture', needsInput: true };

  test('healthy recent run raises nothing', () => {
    const last = { journaler: { ok: true, endedAt: at(2026, 7, 28, 21, 31) } };
    expect(skillAlerts([daily, manual], last, now)).toEqual([]);
  });

  test('a failed last run is an error alert carrying the reason', () => {
    const last = {
      journaler: { ok: false, endedAt: at(2026, 7, 28, 21, 31), summary: 'Failed to authenticate: OAuth session expired\nmore' },
    };
    const [alert] = skillAlerts([daily], last, now);
    expect(alert.level).toBe('error');
    expect(alert.message).toContain('Failed to authenticate');
    expect(alert.message).not.toContain('more');
  });

  test('a stale success is flagged once it misses two cycles', () => {
    const last = { journaler: { ok: true, endedAt: at(2026, 7, 26, 21, 31) } };
    expect(skillAlerts([daily], last, now)).toMatchObject([{ skillId: 'journaler', level: 'warn' }]);
    // the weekly sweep gets a 7-day cycle, so the same gap is still fine
    expect(skillAlerts([weekly], { sweep: last.journaler }, now)).toEqual([]);
  });

  test('never-run scheduled skills are flagged, manual ones are not', () => {
    expect(skillAlerts([daily, manual], {}, now)).toEqual([
      { skillId: 'journaler', level: 'warn', message: 'never run' },
    ]);
  });
});
