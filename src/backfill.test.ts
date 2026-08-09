import { describe, expect, it } from 'vitest';
import { planBackfill } from './backfill';
import { computeReadiness } from './score';
import { wellnessRow, wellnessSeries } from './testFixtures';
import type { WellnessRow } from './types';

const HISTORY_DAYS = 40;

/** Small deterministic wobble, so a series has a real standard deviation without being random. */
function wobble(daysAgo: number): number {
  return Math.sin(daysAgo * 1.7);
}

/**
 * A stable 40-day history, with per-day overrides keyed by daysAgo (0 = today).
 * The baseline wobble alone classifies as "Normal" (advice code 3), so
 * `trainingAdvice` defaults to that already being correctly stored - only days
 * with an explicit override are meant to need a write.
 */
function series(overridesByDay: Record<number, Partial<WellnessRow>> = {}): WellnessRow[] {
  return wellnessSeries(HISTORY_DAYS, (daysAgo) => ({
    rmssd: 50 + wobble(daysAgo),
    rhr: 50 + wobble(daysAgo),
    trainingAdvice: '3',
    ...(overridesByDay[daysAgo] ?? {}),
  }));
}

describe('planBackfill', () => {
  it('returns nothing for an empty history', () => {
    expect(planBackfill([], 7)).toEqual([]);
  });

  it('returns nothing when windowDays is 0', () => {
    expect(planBackfill(series(), 0)).toEqual([]);
  });

  it('returns nothing when history only has today', () => {
    const rows = [wellnessRow({ date: '2024-03-01', rmssd: 50, rhr: 50 })];
    expect(planBackfill(rows, 7)).toEqual([]);
  });

  it('plans a write only for a day whose stored value is stale, not for an already-correct or no-data day', () => {
    // Day 1 clearly deviates (a real HRV spike against a stable baseline) so it
    // has a definite, non-null advice code worth reasoning about.
    const rows = series({ 1: { rmssd: 95 }, 2: { rmssd: 95 }, 3: { rmssd: NaN } });
    const day1Target = computeReadiness(rows, 1).adviceCode;
    const day2Target = computeReadiness(rows, 2).adviceCode;
    expect(day1Target).not.toBeNull();
    expect(day2Target).not.toBeNull();

    rows[1] = { ...rows[1], trainingAdvice: String(day1Target) }; // already correct
    rows[2] = { ...rows[2], trainingAdvice: '' }; // stale/never set
    // rows[3] keeps rmssd: NaN -> code 7 -> adviceCode null, regardless of trainingAdvice

    const writes = planBackfill(rows, 7);
    const dates = writes.map((w) => w.date);

    expect(dates).not.toContain(rows[1].date);
    expect(dates).toContain(rows[2].date);
    expect(dates).not.toContain(rows[3].date);
    expect(writes.find((w) => w.date === rows[2].date)).toEqual({ date: rows[2].date, adviceCode: day2Target });
  });

  it('never includes today, only the days before it', () => {
    const rows = series({ 0: { rmssd: 95 } }); // today itself would need a write if considered
    const writes = planBackfill(rows, 7);
    expect(writes.map((w) => w.date)).not.toContain(rows[0].date);
  });

  it('caps at windowDays even when an earlier day would also need correcting', () => {
    const rows = series({ 10: { rmssd: 95, trainingAdvice: '' } }); // outside a 7-day window
    expect(planBackfill(rows, 7)).toEqual([]);
    // Sanity check it WOULD have been picked up with a wide enough window.
    expect(planBackfill(rows, 10).map((w) => w.date)).toContain(rows[10].date);
  });

  it('caps at the available history when windowDays exceeds it', () => {
    const rows = series().slice(0, 5); // only 5 days on hand
    // Should not throw or read past the end of the array.
    expect(() => planBackfill(rows, 30)).not.toThrow();
    expect(planBackfill(rows, 30).every((w) => rows.some((r) => r.date === w.date))).toBe(true);
  });
});
