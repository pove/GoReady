import type { WellnessRow } from './types';

/**
 * Builds a `WellnessRow` with everything absent by default, so a test only
 * states the fields it actually cares about and new optional columns do not
 * ripple through every fixture.
 */
export function wellnessRow(overrides: Partial<WellnessRow> = {}): WellnessRow {
  return {
    date: '',
    rhr: NaN,
    rmssd: NaN,
    sdnn: NaN,
    trainingAdvice: '',
    ctl: NaN,
    atl: NaN,
    rampRate: NaN,
    sleepSecs: NaN,
    sleepScore: NaN,
    ...overrides,
  };
}

/**
 * `count` days of wellness data ending today, newest first, with dates counting
 * back from 2024-03-01. `valueAt` receives the day's offset from today (0 =
 * today) and returns that day's rMSSD and resting HR.
 */
export function wellnessSeries(
  count: number,
  valueAt: (daysAgo: number) => Partial<WellnessRow>,
): WellnessRow[] {
  return Array.from({ length: count }, (_, daysAgo) => {
    const date = new Date(Date.UTC(2024, 2, 1) - daysAgo * 86400000).toISOString().slice(0, 10);
    return wellnessRow({ date, ...valueAt(daysAgo) });
  });
}
