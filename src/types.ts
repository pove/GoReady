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
  /** Which bars get their numeric value printed above them in the trend charts. */
  trendValueLabels: TrendValueLabels;
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

/**
 * `none` prints no values at all. `minimal` labels only the most recent day and
 * the window's high/low, since labelling all 30 bars collides into an
 * unreadable smear at phone widths. `all` labels every measured day, as the
 * original MATLAB chart did.
 */
export type TrendValueLabels = 'none' | 'minimal' | 'all';

/**
 * One day of wellness data as read from intervals.icu. Missing numeric values
 * are NaN - including the context fields below, which are optional extras the
 * insight engine uses when present and ignores when not.
 */
export interface WellnessRow {
  date: string; // 'YYYY-MM-DD'
  rhr: number;
  rmssd: number;
  sdnn: number;
  /** Raw "TrainingAdvice" field value already stored on intervals.icu for this day, if any. */
  trainingAdvice: string;
  /** Chronic training load (intervals.icu "Fitness"). */
  ctl: number;
  /** Acute training load (intervals.icu "Fatigue"). */
  atl: number;
  /** Change in CTL per week, as intervals.icu computes it. */
  rampRate: number;
  /** Total sleep for the night, in seconds. */
  sleepSecs: number;
  /** Sleep score (0-100) if the athlete's device supplies one. */
  sleepScore: number;
}

/**
 * Readiness codes. NOT ordered by quality - 1 is HIT (the best outcome) and 6
 * is REST! (the worst); see `classify()` in score.ts for what each one means.
 * 7 means "no data".
 */
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

/**
 * Outcome of trying to sync today's readiness to intervals.icu's "TrainingAdvice"
 * field. `cleared` is distinct from `sent`: on a "no data yet" day there is no
 * advice code to send, so the field is blanked instead (see `computeReadiness`'s
 * `adviceCode: null` for code 7) - a banner claiming advice was "sent" would be
 * announcing something that didn't happen.
 */
export type AdviceStatus =
  | { kind: 'disabled' }
  | { kind: 'already-set' }
  | { kind: 'sent' }
  | { kind: 'cleared' }
  | { kind: 'error'; message: string };
