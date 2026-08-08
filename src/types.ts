/** User-configurable settings, persisted in localStorage (single athlete, no server-side account). */
export interface Settings {
  athleteId: string;
  apiKey: string;
  /** URL of the PHP (or other) reverse proxy that forwards requests to intervals.icu. */
  proxyUrl: string;
  /** Whether to PUT today's readiness code back to intervals.icu as the "TrainingAdvice" wellness field. */
  sendTrainingAdvice: boolean;
  /** Window (days) for the short-term moving average shown in trend charts. */
  daysForShortTermTrend: number;
  /** Window (days) for the long-term moving average / expected-range band. */
  daysForLongTermTrend: number;
  /** How many standard deviations wide the long-term expected-range band is. */
  stdDevMultiplier: number;
  /** Show the numeric value above each bar in the trend charts. */
  showValuesInTrendCharts: boolean;
  /** intervals.icu wellness field name to read resting HR from. */
  fieldRHR: string;
  /** intervals.icu wellness field name to read rMSSD from. */
  fieldRMSSD: string;
  /** intervals.icu wellness field name to read SDNN from. */
  fieldSDNN: string;
  /** Which HRV metric(s) to show in the stats table and trend charts. RHR is always shown. */
  hrvMetricsToShow: HrvMetricDisplay;
}

export type HrvMetricDisplay = 'rmssd' | 'sdnn' | 'both';

/** One day of wellness data as read from intervals.icu. Missing numeric values are NaN. */
export interface WellnessRow {
  date: string; // 'YYYY-MM-DD'
  rhr: number;
  rmssd: number;
  sdnn: number;
  /** Raw "TrainingAdvice" field value already stored on intervals.icu for this day, if any. */
  trainingAdvice: string;
}

/** Readiness codes, ordered worst (1) to best (6). 7 means "no data". */
export type ReadinessCode = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** HRV/RHR z-scores for one day, as plotted on the readiness gauge. NaN when that day has no HRV data. */
export interface ZScorePoint {
  hrvZ: number;
  rhrZ: number;
}

export interface ReadinessResult {
  code: ReadinessCode;
  label: string;
  detail: [string, string];
  /** CSS color for the status card / gauge needle. */
  color: string;
  /** Value to PUT to intervals.icu's "TrainingAdvice" field, or null when there is nothing to send. */
  adviceCode: number | null;
}

/** Outcome of trying to sync today's readiness to intervals.icu's "TrainingAdvice" field. */
export type AdviceStatus =
  | { kind: 'disabled' }
  | { kind: 'already-set' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string };
