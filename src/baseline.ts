import { mean, populationStd } from './stats';
import type { Settings } from './types';

/**
 * Rolling-window statistics shared by the readiness score, the trend charts and
 * the insight engine, so all three read the same numbers off the same series.
 *
 * Series arguments are newest-first (index 0 = today), matching `WellnessRow[]`
 * everywhere else in the app - except `computeTrend`, which keeps the
 * oldest-first ordering the charts plot in.
 */

/**
 * The HRV transform used throughout: rMSSD is log-normal, so it is compared on
 * a log scale. The 20x scaling comes from the original MATLAB script and only
 * changes the units - it cancels out of both z-scores and coefficients of
 * variation.
 *
 * Non-positive input yields NaN rather than -Infinity. A raw `Math.log(0)`
 * poisons every statistic downstream of it (mean -> -Infinity, std -> NaN), so
 * one corrupt 0 in the history used to blank the whole app for as long as that
 * day stayed inside the 30-day window. NaN is what the rest of the pipeline
 * already means by "this day has no usable measurement".
 */
export function lnHrv(value: number): number {
  if (!(value > 0)) return NaN; // also catches NaN
  return 20 * Math.log(value);
}

export function validCount(values: number[]): number {
  return values.filter((v) => !Number.isNaN(v)).length;
}

/** The `window` values ending at (and including) `atIndex`, on a newest-first series. */
export function windowAt(valuesNewestFirst: number[], window: number, atIndex = 0): number[] {
  return valuesNewestFirst.slice(atIndex, atIndex + window);
}

/** Mean of the trailing `window` days at `atIndex`; NaN if that window holds no measurements. */
export function rollingMean(valuesNewestFirst: number[], window: number, atIndex = 0): number {
  return mean(windowAt(valuesNewestFirst, window, atIndex));
}

/**
 * Coefficient of variation (%) of the trailing `window` days.
 *
 * Computed on the ln-transformed series, matching the "Ln rMSSD CV" the HRV
 * literature reports. Because CV is a ratio, the 20x scaling in `lnHrv` cancels
 * and this equals the CV of plain ln(rMSSD).
 */
export function rollingCv(lnValuesNewestFirst: number[], window: number, atIndex = 0): number {
  const slice = windowAt(lnValuesNewestFirst, window, atIndex);
  const m = mean(slice);
  if (Number.isNaN(m) || m <= 0) return NaN;
  return (populationStd(slice) / m) * 100;
}

export function median(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (valid.length === 0) return NaN;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}

/** Median absolute deviation - a spread estimate that one artifact reading cannot inflate. */
export function mad(values: number[]): number {
  const m = median(values);
  if (Number.isNaN(m)) return NaN;
  return median(values.filter((v) => !Number.isNaN(v)).map((v) => Math.abs(v - m)));
}

// ---------------------------------------------------------------------------
// Baseline confidence
// ---------------------------------------------------------------------------

export type ConfidenceTier = 'unusable' | 'limited' | 'ok';

export interface BaselineConfidence {
  /** Days in the window that actually carry a measurement. */
  validDays: number;
  windowDays: number;
  tier: ConfidenceTier;
  /** Largest |z| this many observations can physically produce - see below. */
  maxReachableZ: number;
}

/**
 * With a population standard deviation (dividing by N, as `populationStd` and
 * the original MATLAB both do), the largest |z-score| N observations can
 * produce is exactly sqrt(N - 1): put one point anywhere and the rest together,
 * and that is the limit no matter how extreme the outlier is.
 *
 * Every threshold in `classify()` sits within |z| <= 2, so a short baseline does
 * not merely make the readiness score noisy - it makes whole zones physically
 * unreachable. With two days of history the score is pinned to "Train as
 * planned" however bad the morning was.
 */
export function maxReachableZ(validDays: number): number {
  return validDays >= 2 ? Math.sqrt(validDays - 1) : 0;
}

/** Below this, some readiness zones are unreachable outright (see `maxReachableZ`). */
const UNUSABLE_BELOW = 5;
/**
 * Below this the zones are reachable but the standard deviation behind them is
 * still a small-sample estimate. Three weeks is the minimum baseline the resting
 * HR literature works to.
 */
const LIMITED_BELOW = 21;

export function baselineConfidence(valuesNewestFirst: number[], windowDays: number): BaselineConfidence {
  const validDays = validCount(windowAt(valuesNewestFirst, windowDays));
  const tier: ConfidenceTier = validDays < UNUSABLE_BELOW ? 'unusable' : validDays < LIMITED_BELOW ? 'limited' : 'ok';
  return { validDays, windowDays, tier, maxReachableZ: maxReachableZ(validDays) };
}

/**
 * The weaker of two per-metric confidences - what the confidence badge's tier
 * and "N of M days measured" headline are based on, since a readiness zone
 * needs both the HRV and the resting HR z-score to reach it, so the thinner of
 * the two baselines is what actually limits the score.
 *
 * This single number is NOT what decides which specific bands are reachable,
 * though - see `unreachableBands`, which needs the two axes kept separate.
 */
export function weakerConfidence(a: BaselineConfidence, b: BaselineConfidence): BaselineConfidence {
  return a.maxReachableZ <= b.maxReachableZ ? a : b;
}

/** Per-metric confidence for both axes behind the readiness score, plus the weaker one for headline display. */
export interface ReadinessConfidence {
  hrv: BaselineConfidence;
  rhr: BaselineConfidence;
  /** The weaker of the two - see `weakerConfidence`. */
  overall: BaselineConfidence;
}

/**
 * Whether each gauge band is reachable, given how far each axis can move -
 * `hrvZ` up to `hrv.maxReachableZ`, `rhrZ` up to `rhr.maxReachableZ` - read
 * straight off the branch conditions in `classify()`. Listed worst band to
 * best, as the in-app legend lists them, and named the same way.
 *
 * The two axes come from independent wellness columns with their own separate
 * history, so a band is reachable exactly when SOME achievable hrvZ and SOME
 * achievable rhrZ together satisfy one of `classify()`'s branches for that
 * band - not when a single collapsed "weaker of the two" number clears every
 * band's threshold, which is what this used to do and which contradicted the
 * gauge: HIT needs a LARGE hrvZ but only a SMALL |rhrZ| (within (-1, 1]), so a
 * thin RHR baseline barely constrains it - even two days of RHR history can
 * land exactly on rhrZ = 1, which satisfies HIT's resting-HR condition
 * outright. A rich HRV baseline plus a 2-day RHR baseline can and does produce
 * a genuine HIT, so gating HIT's reachability on the RHR side's richness (as
 * "weaker of the two" did) had it backwards.
 *
 * Each predicate reflects that difference directly: a branch that needs a
 * LARGE |z| on some axis is gated on that axis's own richness (`maxZ` past the
 * branch's threshold), while a branch that only needs a value INSIDE a
 * moderate range - as HIT's rhrZ, or the "hrvZ >= -1" / "rhrZ in (-2, 1.7]"
 * sides of the Limit-intensity branches - is satisfiable from even the
 * thinnest non-empty baseline, so it is not gated on richness at all.
 */
const BAND_REACHABILITY: { label: string; reachable: (hrv: BaselineConfidence, rhr: BaselineConfidence) => boolean }[] = [
  {
    label: 'Stress / illness', // rhrZ > 1.7 and hrvZ < -1
    reachable: (hrv, rhr) => rhr.maxReachableZ > 1.7 && hrv.maxReachableZ > 1,
  },
  {
    label: 'Rest', // rhrZ <= -2 and hrvZ < -1
    reachable: (hrv, rhr) => rhr.maxReachableZ >= 2 && hrv.maxReachableZ > 1,
  },
  {
    label: 'Limit intensity', // via rhrZ >= 1.7 (hrvZ >= -1 asks nothing more of HRV) or hrvZ < -1 (rhrZ in (-2, 1.7] asks nothing more of RHR)
    reachable: (hrv, rhr) => rhr.maxReachableZ >= 1.7 || hrv.maxReachableZ > 1,
  },
  {
    label: 'HIT', // hrvZ > 1; rhrZ only has to land in (-1, 1], which any non-empty RHR baseline can do
    reachable: (hrv) => hrv.maxReachableZ > 1,
  },
];

/** Gauge bands the current baseline cannot produce, named as the in-app legend names them. */
export function unreachableBands(confidence: ReadinessConfidence): string[] {
  const { hrv, rhr } = confidence;

  // classify() needs a real z-score on BOTH axes to produce anything but "no
  // data" - with either axis empty (fewer than two valid days), none of these
  // bands, or any other, can actually appear.
  if (hrv.maxReachableZ < 1 || rhr.maxReachableZ < 1) {
    return BAND_REACHABILITY.map(({ label }) => label);
  }

  return BAND_REACHABILITY.filter(({ reachable }) => !reachable(hrv, rhr)).map(({ label }) => label);
}

// ---------------------------------------------------------------------------
// Trend windows
// ---------------------------------------------------------------------------

export interface TrendDay {
  value: number;
  shortTermAvg: number;
  lowerBand: number;
  upperBand: number;
}

/**
 * For each day, its short-term moving average and the expected-range band from
 * the long-term trend. Takes an OLDEST-first series, as plotted.
 *
 * Shared with the insight engine so a sentence about days "outside the expected
 * range" can never disagree with the bars the reader is looking at.
 */
export function computeTrend(valuesAscending: number[], settings: Settings): TrendDay[] {
  return valuesAscending.map((value, i) => {
    const longWindow = valuesAscending.slice(Math.max(0, i - settings.daysForLongTermTrend + 1), i + 1);
    const longTermAvg = mean(longWindow);
    const longTermStd = populationStd(longWindow);

    const shortWindow = valuesAscending.slice(Math.max(0, i - settings.daysForShortTermTrend + 1), i + 1);

    return {
      value,
      shortTermAvg: mean(shortWindow),
      lowerBand: longTermAvg - settings.stdDevMultiplier * longTermStd,
      upperBand: longTermAvg + settings.stdDevMultiplier * longTermStd,
    };
  });
}

export function isInBand(day: TrendDay): boolean {
  return day.value >= day.lowerBand && day.value <= day.upperBand;
}

export interface BandStreak {
  /** Consecutive most-recent days on the same side of the expected range. 0 when today is inside it. */
  days: number;
  direction: 'above' | 'below' | null;
}

/**
 * How many days in a row, counting back from the most recent one, sit on the
 * same side of the expected-range band. Takes the OLDEST-first trend, as
 * `computeTrend` returns it.
 *
 * Days with no measurement end the streak rather than being skipped over: a run
 * of readings is only evidence of a run if the readings are actually there.
 */
export function outOfBandStreak(trendAscending: TrendDay[]): BandStreak {
  let days = 0;
  let direction: BandStreak['direction'] = null;

  for (let i = trendAscending.length - 1; i >= 0; i--) {
    const day = trendAscending[i];
    if (Number.isNaN(day.value) || Number.isNaN(day.lowerBand) || Number.isNaN(day.upperBand)) break;
    if (isInBand(day)) break;

    const side = day.value > day.upperBand ? 'above' : 'below';
    if (direction === null) direction = side;
    else if (side !== direction) break;

    days++;
  }

  return { days, direction: days > 0 ? direction : null };
}
