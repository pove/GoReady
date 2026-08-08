import { describe, expect, it } from 'vitest';
import { labelledIndices, requiredHistoryDays } from './trendChart';
import { DEFAULT_SETTINGS } from './settings';
import type { TrendDay } from './baseline';

describe('requiredHistoryDays', () => {
  it('fetches enough history for the long-term window to be full on every displayed day', () => {
    const settings = { ...DEFAULT_SETTINGS, daysForLongTermTrend: 60 };
    expect(requiredHistoryDays(settings)).toBe(60 + 30 - 1);
  });

  it('never asks for fewer than 89 days, even with a short long-term window', () => {
    const settings = { ...DEFAULT_SETTINGS, daysForLongTermTrend: 5 };
    expect(requiredHistoryDays(settings)).toBe(89);
  });
});

describe('labelledIndices', () => {
  /** Five measured days (40, 55, 50, 60, 45) then a gap - band fields are irrelevant here. */
  const days: TrendDay[] = [40, 55, 50, 60, 45, NaN].map((value) => ({
    value,
    shortTermAvg: NaN,
    lowerBand: NaN,
    upperBand: NaN,
  }));

  // Regression: an earlier pass silently replaced "every measured day" with
  // this 3-day set regardless of the setting, discarding what
  // `trendValueLabels: 'all'` is supposed to mean.
  it('labels every measured day in "all" mode, gaps excluded', () => {
    expect(labelledIndices(days, 'all')).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('labels nothing in "none" mode', () => {
    expect(labelledIndices(days, 'none')).toEqual(new Set());
  });

  it('labels only the most recent day plus the window high/low in "minimal" mode', () => {
    // index 3 (60) is the high, index 0 (40) is the low, index 4 (45) is most recent.
    expect(labelledIndices(days, 'minimal')).toEqual(new Set([4, 3, 0]));
  });

  it('labels nothing when nothing is measured, in any mode', () => {
    const empty: TrendDay[] = [NaN, NaN].map((value) => ({ value, shortTermAvg: NaN, lowerBand: NaN, upperBand: NaN }));
    expect(labelledIndices(empty, 'all')).toEqual(new Set());
    expect(labelledIndices(empty, 'minimal')).toEqual(new Set());
  });
});
