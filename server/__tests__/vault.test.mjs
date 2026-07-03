import { describe, test, expect } from 'vitest';
import { extractWikilinks, findOrphans, computeStreak } from '../lib/vault.mjs';

describe('extractWikilinks', () => {
  test('extracts plain, aliased, and heading links', () => {
    const content = 'lihat [[habitgrid]] dan [[My Note|alias]] plus [[deep/Note#Section]] tapi bukan [tautan](biasa.md)';
    expect(extractWikilinks(content)).toEqual(['habitgrid', 'My Note', 'deep/Note']);
  });

  test('returns empty array when no links', () => {
    expect(extractWikilinks('plain text')).toEqual([]);
  });
});

describe('findOrphans', () => {
  const note = (relPath, content = '') => ({ relPath, content });

  test('flags unlinked knowledge notes, spares linked and structural ones', () => {
    const notes = [
      note('INDEX.md', 'daftar: [[habitgrid]]'),
      note('01-Projects/habitgrid.md', 'terkait [[nexus]]'),
      note('01-Projects/nexus.md'),
      note('01-Projects/lonely.md'), // nobody links here
      note('daily/2026-07-04.md'),   // daily notes never orphans
      note('Templates/daily.md'),
      note('Dashboard.md'),
    ];
    expect(findOrphans(notes)).toEqual(['01-Projects/lonely.md']);
  });

  test('link matching is case-insensitive on basename', () => {
    const notes = [
      note('INDEX.md', '[[HabitGrid]]'),
      note('01-Projects/habitgrid.md'),
    ];
    expect(findOrphans(notes)).toEqual([]);
  });
});

describe('computeStreak', () => {
  test('counts consecutive days ending today', () => {
    expect(computeStreak(['2026-07-02', '2026-07-03', '2026-07-04'], '2026-07-04')).toBe(3);
  });

  test('missing today does not break the streak (grace day)', () => {
    expect(computeStreak(['2026-07-02', '2026-07-03'], '2026-07-04')).toBe(2);
  });

  test('gap resets the streak', () => {
    expect(computeStreak(['2026-07-01', '2026-07-03', '2026-07-04'], '2026-07-04')).toBe(2);
  });

  test('empty vault has zero streak', () => {
    expect(computeStreak([], '2026-07-04')).toBe(0);
  });
});
