import { describe, test, expect } from 'vitest';
import { isDue, dueSkills, wasDueOnDay } from '../lib/scheduler.mjs';

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

  test('skips a skill that already ran today (restart safety)', () => {
    const runs = [{ skillId: 'a', startedAt: at(2026, 7, 4, 8, 0), status: 'done' }];
    expect(dueSkills(skills, prev, now, runs)).toEqual([]);
  });

  test('an errored earlier run does not block a retry', () => {
    const runs = [{ skillId: 'a', startedAt: at(2026, 7, 4, 8, 0), status: 'error' }];
    expect(dueSkills(skills, prev, now, runs).map((s) => s.id)).toEqual(['a']);
  });
});
