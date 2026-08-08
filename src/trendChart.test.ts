import { describe, expect, it } from 'vitest';
import { requiredHistoryDays } from './trendChart';
import { DEFAULT_SETTINGS } from './settings';

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
