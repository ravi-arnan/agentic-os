import { describe, test, expect } from 'vitest';
import { scheduledRunHealth, isoWeekLabel } from '../skills/index.mjs';

// 2026-07-03 is a Friday, 2026-07-04 a Saturday.
const FRI = new Date(2026, 6, 4).getTime(); // "now" = Sat -> yesterday = Fri
const at = (y, mo, d, h) => new Date(y, mo - 1, d, h, 0, 0).getTime();

const SKILLS = [
  { id: 'journaler', schedule: { hour: 21, minute: 30 }, needsInput: false },
  { id: 'sweep', schedule: { hour: 17, weekday: 5 }, needsInput: false }, // Fri only
  { id: 'capture', needsInput: true }, // not scheduled
];

describe('scheduledRunHealth', () => {
  test('reports OK when a due skill succeeded yesterday', () => {
    const runs = [{ skillId: 'journaler', startedAt: at(2026, 7, 3, 21), ok: true }];
    const { lines } = scheduledRunHealth(SKILLS, runs, FRI);
    expect(lines).toContain('- journaler: OK');
  });

  test('flags a due skill that never ran', () => {
    const { lines } = scheduledRunHealth(SKILLS, [], FRI);
    expect(lines.some((l) => l.startsWith('- journaler: TIDAK JALAN'))).toBe(true);
  });

  test('flags a failed run distinctly from a missing one', () => {
    const runs = [{ skillId: 'journaler', startedAt: at(2026, 7, 3, 21), ok: false }];
    const { lines } = scheduledRunHealth(SKILLS, runs, FRI);
    expect(lines.some((l) => l.startsWith('- journaler: GAGAL'))).toBe(true);
  });

  test('weekday-only sweep IS checked when yesterday was its weekday (Fri)', () => {
    const { lines } = scheduledRunHealth(SKILLS, [], FRI);
    expect(lines.some((l) => l.startsWith('- sweep:'))).toBe(true);
  });

  test('weekday-only sweep is SKIPPED when yesterday was not its weekday', () => {
    // now = Sunday 2026-07-05 -> yesterday = Sat, sweep (Fri) not due
    const SUN = new Date(2026, 6, 5).getTime();
    const { lines } = scheduledRunHealth(SKILLS, [], SUN);
    expect(lines.some((l) => l.startsWith('- sweep:'))).toBe(false);
    expect(lines.some((l) => l.startsWith('- journaler:'))).toBe(true); // daily still checked
  });

  test('input skills are never treated as scheduled', () => {
    const { lines } = scheduledRunHealth(SKILLS, [], FRI);
    expect(lines.some((l) => l.includes('capture'))).toBe(false);
  });
});

describe('isoWeekLabel', () => {
  test('formats ISO week with zero-padding', () => {
    // 2026-07-04 is a Saturday in ISO week 27
    expect(isoWeekLabel(new Date(2026, 6, 4))).toBe('2026-W27');
    // early January belongs to the correct ISO year/week
    expect(isoWeekLabel(new Date(2026, 0, 5))).toMatch(/^2026-W0[12]$/);
  });

  test('Thursday and its Monday share the same ISO week', () => {
    const mon = isoWeekLabel(new Date(2026, 6, 6)); // Mon 2026-07-06
    const thu = isoWeekLabel(new Date(2026, 6, 9)); // Thu 2026-07-09
    expect(mon).toBe(thu);
    expect(mon).toBe('2026-W28');
  });
});
