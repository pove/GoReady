import {
  baselineConfidence,
  computeTrend,
  lnHrv,
  mad,
  median,
  outOfBandStreak,
  rollingCv,
  rollingMean,
  validCount,
  weakerConfidence,
  windowAt,
  type ReadinessConfidence,
} from './baseline';
import { READINESS_WINDOW_DAYS } from './score';
import { populationStd } from './stats';
import type { ReadinessCode, Settings, WellnessRow } from './types';

/**
 * Supplementary reads on today's wellness data, shown under the readiness
 * status. Everything here is DISPLAY-ONLY: the readiness code, its colour, the
 * gauge geometry and the TrainingAdvice value written back to intervals.icu all
 * still come solely from `classify()` in score.ts, whatever these rules say.
 *
 * Each rule is an independent pure function over the wellness history. Rules
 * stay quiet unless they have the data they need, and `buildInsights` ranks
 * whatever fired and keeps only the top few - a wall of hedged sentences is a
 * worse outcome than one clear one.
 *
 * Because these sit next to the readiness code and cannot change it, the wording
 * must never contradict it outright. A week-long slump and a strong single
 * morning genuinely co-occur (a rebound day inside a hard block), so a rule that
 * reads the week says what it sees and leaves the reader to weigh it against
 * today's score - it does not issue an instruction the score disagrees with.
 */

export type InsightTone = 'caution' | 'note' | 'positive';

export interface Insight {
  /** Stable identifier for the rule that produced this, for tests and styling. */
  id: string;
  tone: InsightTone;
  text: string;
}

export interface InsightInput {
  code: ReadinessCode;
  hrvZ: number;
  rhrZ: number;
  /** Wellness history, newest first (index 0 = today). */
  rows: WellnessRow[];
  settings: Settings;
  /**
   * How much history backs today's z-scores. Needed by exactly one rule - see
   * `buildInsights` - because every other rule measures its own window and
   * guards on that instead.
   */
  confidence: ReadinessConfidence;
}

/** Most insights the status card will show at once. */
const MAX_INSIGHTS = 3;

/** Plews & Buchheit: single mornings are noise; the 7-day rolling mean is the signal. */
const RECENT_WINDOW = 7;
/** Baseline the 7-day mean is judged against. The literature uses 60-90 days. */
const BASELINE_WINDOW = 60;
/** Smallest worthwhile change, as a fraction of the athlete's own baseline SD. */
const SWC_FACTOR = 0.5;

/** Fewest measurements the 7-day and baseline windows need before a rule may speak. */
const MIN_RECENT_DAYS = 4;
const MIN_BASELINE_DAYS = 21;

/** Consecutive out-of-band days before a streak is worth mentioning. */
const MIN_STREAK = 3;

/**
 * How far the last week's coefficient of variation must move against the
 * athlete's own typical CV before it means anything. Athlete-relative on
 * purpose - a fixed percentage would be wrong for everyone.
 */
const CV_WIDENED = 1.5;
const CV_COLLAPSED = 0.5;

/** Both metrics this far below baseline (in SDs) at once is the coupling pattern. */
const COUPLED_DEPRESSION_SD = 0.5;

/** CTL gain per week beyond which a block counts as a hard ramp. */
const ELEVATED_RAMP_RATE = 5;
/** Acute:chronic load ratio treated as elevated, used only when rampRate is absent. */
const HIGH_ACWR = 1.3;
/** Sleep below this many hours gets offered as context for a poor reading. */
const SHORT_SLEEP_HOURS = 6;

/** Iglewicz-Hoaglin: 0.6745 puts the MAD on the same footing as a standard deviation. */
const MODIFIED_Z_SCALE = 0.6745;
/** Their recommended cut-off for calling a point an outlier. */
const ARTIFACT_MODIFIED_Z = 3.5;
/**
 * A floor on top of that cut-off, in percent away from the recent median.
 * An unusually steady athlete has a tiny MAD, and against a tiny MAD an
 * ordinary poor morning clears 3.5 easily - "this looks like a bad capture" is
 * too strong a claim to make about a reading that is merely low. The point has
 * to be both a statistical outlier and a big move in absolute terms.
 */
const MIN_ARTIFACT_PERCENT = 25;

// ---------------------------------------------------------------------------
// Rule 1: where today's point sits inside the HIT / Normal zone
// ---------------------------------------------------------------------------

/**
 * Minimum |rhrZ| before "resting HR is up/calm" is a claim worth making at
 * all. A z-score of, say, 0.05 is noise around the 30-day baseline, not a
 * real deviation - without this floor, a day that's essentially sitting on
 * the baseline (visually right near the gauge's center) could still get
 * told its RHR is "up", which contradicts what the gauge itself shows.
 */
const MIN_ACTIVATION = 0.5;
/** Roughly matches the hatched regions' angular (RHR z-score) extent in the reference chart. */
const ACTIVATION_BAND = 1.3;
/** hrvZ threshold separating "HRV still holding up" from "HRV starting to slip". */
const STRONG_HRV = 0.5;

/**
 * Supplementary, qualitative read on *where* today's point sits within the
 * HIT/Normal zone, based on three named regions on the reference readiness
 * chart (see the forum thread credited in the README, and the in-app help
 * dialog which shows that chart): "optimum pre-race", "not coping well
 * during loading", and "coping well during training blocks".
 *
 * These bands are this app's own approximate reading of that diagram's
 * layout relative to its axis ticks - not part of Inigo Tolosa's original
 * scoring algorithm.
 */
export function trainingPhaseNote(code: ReadinessCode, hrvZ: number, rhrZ: number): string | null {
  if (code !== 1 && code !== 4) return null; // only refines HIT / Normal
  if (Number.isNaN(hrvZ) || Number.isNaN(rhrZ)) return null;

  if (rhrZ > MIN_ACTIVATION && rhrZ <= ACTIVATION_BAND) {
    return hrvZ >= STRONG_HRV
      ? 'Resting HR is up but HRV is still strong - this pattern looks like "optimum pre-race": primed, not fatigued.'
      : 'Resting HR is up and HRV is starting to slip - a sign you may not be coping well with recent loading.';
  }

  if (rhrZ < -MIN_ACTIVATION && rhrZ >= -ACTIVATION_BAND && hrvZ >= STRONG_HRV) {
    return 'Resting HR is calm and HRV is strong - a sign you\'re coping well with the current training block.';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared window summary
// ---------------------------------------------------------------------------

interface MetricSummary {
  /** Mean of the last `RECENT_WINDOW` days. */
  recentMean: number;
  baselineMean: number;
  baselineSd: number;
  /** How far the recent mean sits from baseline, in baseline SDs. */
  deltaSd: number;
  /** Smallest worthwhile change, in the series' own units. */
  swc: number;
  /** Whether both windows hold enough measurements for any of this to mean anything. */
  usable: boolean;
}

function summarize(valuesNewestFirst: number[]): MetricSummary {
  const baselineSlice = windowAt(valuesNewestFirst, BASELINE_WINDOW);
  const recentMean = rollingMean(valuesNewestFirst, RECENT_WINDOW);
  const baselineMean = rollingMean(valuesNewestFirst, BASELINE_WINDOW);
  const baselineSd = populationStd(baselineSlice);

  const usable =
    validCount(windowAt(valuesNewestFirst, RECENT_WINDOW)) >= MIN_RECENT_DAYS &&
    validCount(baselineSlice) >= MIN_BASELINE_DAYS &&
    baselineSd > 0;

  return {
    recentMean,
    baselineMean,
    baselineSd,
    deltaSd: (recentMean - baselineMean) / baselineSd,
    swc: SWC_FACTOR * baselineSd,
    usable,
  };
}

interface HrvMetric {
  label: string;
  /** Raw values, newest first. */
  values: number[];
  /** The same series log-transformed, which is the scale HRV is compared on. */
  ln: number[];
}

/**
 * Which HRV metric the insights should talk about. Honours the user's display
 * choice, and when they show both, picks whichever actually has the more
 * complete history - so an athlete whose device records SDNN but not rMSSD gets
 * insights about SDNN instead of silence.
 *
 * This never affects the readiness score, which stays rMSSD-only.
 */
function pickHrvMetric(rows: WellnessRow[], settings: Settings): HrvMetric {
  const rmssd = rows.map((r) => r.rmssd);
  const sdnn = rows.map((r) => r.sdnn);

  const useSdnn =
    settings.hrvMetricsToShow === 'sdnn' ||
    (settings.hrvMetricsToShow === 'both' &&
      validCount(windowAt(sdnn, BASELINE_WINDOW)) > validCount(windowAt(rmssd, BASELINE_WINDOW)));

  const values = useSdnn ? sdnn : rmssd;
  return { label: useSdnn ? 'SDNN' : 'rMSSD', values, ln: values.map(lnHrv) };
}

/**
 * A difference on the 20*ln scale back as a percentage change: the scaling means
 * `delta = 20 * ln(a / b)`, so the ratio is recoverable exactly.
 */
function lnDeltaToPercent(delta: number): number {
  return (Math.exp(delta / 20) - 1) * 100;
}

function round(value: number, places = 0): string {
  return value.toFixed(places);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Rule 0: today's reading looks like a bad capture rather than a real result.
 *
 * A single artifact does double damage - it mis-scores today, and then sits in
 * the trailing baseline for the next 30 days inflating the standard deviation,
 * which quietly compresses every subsequent z-score toward zero. The score
 * itself is left alone (excluding days from the baseline would change the
 * readiness code, which insights may not do), but the reader can be told, and
 * can retake the measurement.
 *
 * Uses the Iglewicz-Hoaglin modified z-score, built on the median and MAD so
 * that the very outlier being tested cannot inflate the spread it is judged
 * against - which is exactly what defeats a standard-deviation test here.
 */
function artifactRule(hrv: HrvMetric): Insight | null {
  const today = hrv.ln[0];
  if (Number.isNaN(today)) return null;

  const window = windowAt(hrv.ln, READINESS_WINDOW_DAYS);
  if (validCount(window) < MIN_BASELINE_DAYS) return null;

  const spread = mad(window);
  if (Number.isNaN(spread) || spread <= 0) return null;

  const baselineMedian = median(window);
  const deviation = today - baselineMedian;
  const modifiedZ = (MODIFIED_Z_SCALE * deviation) / spread;
  if (Math.abs(modifiedZ) <= ARTIFACT_MODIFIED_Z) return null;
  if (Math.abs(lnDeltaToPercent(deviation)) < MIN_ARTIFACT_PERCENT) return null;

  // An artifact is isolated by definition. If the rest of the week has moved
  // too, today is the continuation of a real shift - which the 7-day rules
  // below are the right ones to talk about, not this one.
  const restOfWeek = median(windowAt(hrv.ln, RECENT_WINDOW - 1, 1));
  if (Math.abs(lnDeltaToPercent(restOfWeek - baselineMedian)) >= MIN_ARTIFACT_PERCENT) return null;

  return {
    id: 'artifact',
    tone: 'caution',
    text:
      `Today's ${hrv.label} is far outside your recent range - far enough that a bad capture is worth ruling ` +
      'out before reading anything into today\'s score. It will also sit in your baseline for the next 30 days, ' +
      'so retake it if the measurement was poor.',
  };
}

/**
 * Rule 2: the 7-day rolling mean of ln-HRV against the 60-day baseline, with a
 * smallest-worthwhile-change band of half the baseline SD.
 *
 * This is the one rule that reads a trend rather than a single morning, which
 * is what the HRV literature actually rates: correlations with performance only
 * appear once several days are averaged (Plews & Buchheit, 2013).
 */
function swcRule(hrv: HrvMetric): Insight | null {
  // The rolling mean tolerates gaps elsewhere in the window, but not here: with
  // no reading today, "you are absorbing the recent work" reads as a claim
  // about today specifically, sitting right below a headline saying today has
  // no data at all.
  if (Number.isNaN(hrv.ln[0])) return null;

  const summary = summarize(hrv.ln);
  if (!summary.usable) return null;

  const delta = summary.recentMean - summary.baselineMean;
  const percent = Math.abs(lnDeltaToPercent(delta));

  if (delta < -summary.swc) {
    return {
      id: 'swc-below',
      tone: 'caution',
      text:
        `Your 7-day ${hrv.label} average is about ${round(percent)}% below your ${BASELINE_WINDOW}-day baseline, ` +
        'further than the smallest worthwhile change. That is a loading response rather than one bad night - ' +
        'worth weighing against today\'s score before committing to a hard session.',
    };
  }

  if (delta > summary.swc) {
    return {
      id: 'swc-above',
      tone: 'positive',
      text:
        `Your 7-day ${hrv.label} average is about ${round(percent)}% above your ${BASELINE_WINDOW}-day baseline, ` +
        'further than the smallest worthwhile change - a sign you are absorbing the recent work.',
    };
  }

  return {
    id: 'swc-stable',
    tone: 'positive',
    text: `Your 7-day ${hrv.label} average is sitting inside its normal range against the ${BASELINE_WINDOW}-day baseline.`,
  };
}

/**
 * Rule 3: the coefficient of variation of the last week's ln-HRV, against the
 * athlete's own typical week.
 *
 * Two patterns matter, and they point opposite ways. A CV that widens says the
 * day-to-day response has become erratic - often an earlier warning than the
 * mean moving. A CV that collapses *while the mean sits below its baseline* is
 * the pattern Plews' case studies associate with non-functional overreaching:
 * the system is not so much stable as unresponsive.
 */
function cvRule(hrv: HrvMetric): Insight | null {
  if (Number.isNaN(hrv.ln[0])) return null; // see the same guard in swcRule

  const recentCv = rollingCv(hrv.ln, RECENT_WINDOW);
  if (Number.isNaN(recentCv)) return null;
  if (validCount(windowAt(hrv.ln, RECENT_WINDOW)) < MIN_RECENT_DAYS) return null;

  // The athlete's typical week, not the spread of the whole baseline window -
  // that would mix day-to-day variation together with the slower drift of the
  // baseline itself.
  const weeklyCvs = Array.from({ length: BASELINE_WINDOW }, (_, i) => rollingCv(hrv.ln, RECENT_WINDOW, i));
  if (validCount(weeklyCvs) < MIN_BASELINE_DAYS) return null;

  const typicalCv = median(weeklyCvs);
  if (Number.isNaN(typicalCv) || typicalCv <= 0) return null;

  if (recentCv > typicalCv * CV_WIDENED) {
    return {
      id: 'cv-widened',
      tone: 'caution',
      text:
        `Your ${hrv.label} readings have swung around more than usual this week ` +
        `(${round(recentCv, 1)}% day-to-day variation against a typical ${round(typicalCv, 1)}%). ` +
        'An erratic response often shows up before the average moves.',
    };
  }

  const summary = summarize(hrv.ln);
  if (summary.usable && recentCv < typicalCv * CV_COLLAPSED && summary.recentMean - summary.baselineMean < -summary.swc) {
    return {
      id: 'cv-collapsed',
      tone: 'caution',
      text:
        `Your ${hrv.label} has been unusually flat this week (${round(recentCv, 1)}% variation against a typical ` +
        `${round(typicalCv, 1)}%) while its average sits below baseline. Steady-but-suppressed is worth taking ` +
        'seriously - it can mean the system has stopped responding rather than that it has settled.',
    };
  }

  return null;
}

/**
 * Rule 4: consecutive days outside the expected range.
 *
 * Uses the very same band the trend-chart bars are coloured by, so the sentence
 * and the chart underneath it can never disagree.
 */
function streakRules(hrv: HrvMetric, rows: WellnessRow[], settings: Settings): Insight[] {
  const insights: Insight[] = [];

  const check = (label: string, valuesNewestFirst: number[], concerning: 'above' | 'below') => {
    const trend = computeTrend([...valuesNewestFirst].reverse(), settings);
    const { days, direction } = outOfBandStreak(trend);
    if (days < MIN_STREAK || direction === null) return;

    const where = direction === 'above' ? 'above' : 'below';
    insights.push({
      id: `streak-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${where}`,
      tone: direction === concerning ? 'caution' : 'note',
      text: `${label} has been ${where} its expected range ${days} days running.`,
    });
  };

  check(hrv.label, hrv.values, 'below');
  check('Resting HR', rows.map((r) => r.rhr), 'above');

  return insights;
}

/**
 * Rule 5: HRV and resting HR read together rather than separately.
 *
 * The two are physiologically coupled, and HRV would normally rise as resting HR
 * falls. Both drifting down together over a week is the parasympathetic-
 * saturation pattern - a case where a healthy-looking low resting HR is not the
 * good news it appears to be. The original decision tree already encodes the
 * acute version of this (codes 2 and 3, "keep calm - acute fatigue signs"); this
 * catches the slower one.
 */
function couplingRule(hrv: HrvMetric, rows: WellnessRow[]): Insight | null {
  // Coupling is a same-day pattern by definition - both readings need to exist
  // today for a claim about how they relate today to mean anything.
  if (Number.isNaN(hrv.ln[0]) || Number.isNaN(rows[0]?.rhr)) return null;

  const hrvSummary = summarize(hrv.ln);
  const rhrSummary = summarize(rows.map((r) => r.rhr));
  if (!hrvSummary.usable || !rhrSummary.usable) return null;

  const bothDown =
    hrvSummary.deltaSd <= -COUPLED_DEPRESSION_SD && rhrSummary.deltaSd <= -COUPLED_DEPRESSION_SD;
  if (!bothDown) return null;

  const rampRate = rows[0]?.rampRate ?? NaN;
  const rampingHard = !Number.isNaN(rampRate) && rampRate > ELEVATED_RAMP_RATE;

  return {
    id: rampingHard ? 'coupling-under-load' : 'coupling',
    tone: 'caution',
    text: rampingHard
      ? `Both ${hrv.label} and resting HR have sat below baseline for the past week while your load is ramping ` +
        `at +${round(rampRate, 1)} per week. HRV would normally rise as resting HR falls, so both falling under ` +
        'load points at parasympathetic saturation - a low resting HR here is not the green light it looks like.'
      : `Both ${hrv.label} and resting HR have sat below baseline for the past week. They are worth reading ` +
        'together: HRV would normally rise as resting HR falls, so both moving down is a pattern to watch.',
  };
}

/**
 * Rule 6: what else about today might explain a poor reading. Purely
 * attributional - it never fires on its own account, only when something is
 * actually off, and never without the data to back it.
 */
function contextRules(rows: WellnessRow[], hrv: HrvMetric, somethingIsOff: boolean): Insight[] {
  if (!somethingIsOff) return [];
  const today = rows[0];
  if (!today) return [];

  const insights: Insight[] = [];

  const sleepHours = today.sleepSecs / 3600;
  if (!Number.isNaN(sleepHours) && sleepHours > 0 && sleepHours < SHORT_SLEEP_HOURS) {
    insights.push({
      id: 'context-sleep',
      tone: 'note',
      text: `You logged ${round(sleepHours, 1)} hours of sleep last night, which is likely part of today's reading.`,
    });
  }

  if (!Number.isNaN(today.rampRate) && today.rampRate > ELEVATED_RAMP_RATE) {
    insights.push({
      id: 'context-ramp',
      tone: 'note',
      text:
        `Your chronic load is climbing at +${round(today.rampRate, 1)} per week; some ${hrv.label} suppression ` +
        'is expected while a block is ramping that hard.',
    });
  } else if (Number.isNaN(today.rampRate) && today.ctl > 0 && !Number.isNaN(today.atl)) {
    const acwr = today.atl / today.ctl;
    if (acwr > HIGH_ACWR) {
      insights.push({
        id: 'context-acwr',
        tone: 'note',
        text: `Your acute load is running at ${round(acwr, 2)}x your chronic load, so recent days have been hard relative to what you are used to.`,
      });
    }
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const TONE_RANK: Record<InsightTone, number> = { caution: 0, note: 1, positive: 2 };

/**
 * Within a tone, the order rules earn a slot. Coupling and the 7-day trend say
 * more about the week than a single streak does, and the "nothing to report"
 * lines come last so they only ever fill space nothing else wanted.
 */
const RULE_PRIORITY = [
  // First: if today's number may not be real, everything else on screen is
  // suspect, so the reader should see that before any reading of it.
  'artifact',
  'coupling-under-load',
  'coupling',
  'swc-below',
  'cv-widened',
  'cv-collapsed',
  'streak-',
  'phase-note',
  'context-',
  'swc-above',
  'swc-stable',
];

function priorityOf(insight: Insight): number {
  const index = RULE_PRIORITY.findIndex((prefix) => insight.id.startsWith(prefix));
  return index === -1 ? RULE_PRIORITY.length : index;
}

/**
 * Runs every rule and returns the few that earned their place, worst news
 * first. Display-only - see the note at the top of this file.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const { code, hrvZ, rhrZ, rows, settings, confidence } = input;
  const hrv = pickHrvMetric(rows, settings);

  const candidates: (Insight | null)[] = [
    artifactRule(hrv),
    couplingRule(hrv, rows),
    swcRule(hrv),
    cvRule(hrv),
    ...streakRules(hrv, rows, settings),
  ];

  // The phase note is the only rule reading today's single-day z-scores, so it
  // is the only one that needs the readiness confidence. On an unusable
  // baseline those z-scores are arithmetically degenerate - two days cap them at
  // |z| = 1 - and "HRV is strong" would be an unsupported claim sitting directly
  // under a badge saying the baseline cannot support claims.
  const phase = confidence.overall.tier === 'unusable' ? null : trainingPhaseNote(code, hrvZ, rhrZ);
  if (phase) candidates.push({ id: 'phase-note', tone: 'note', text: phase });

  const fired = candidates.filter((insight): insight is Insight => insight !== null);
  const somethingIsOff = fired.some((insight) => insight.tone === 'caution');
  fired.push(...contextRules(rows, hrv, somethingIsOff));

  // There is deliberately no "nothing to report" fallback here. `swc-stable` is
  // already that message, and it only speaks when there is enough history for
  // the absence of a finding to mean something. Where even that stays quiet the
  // honest answer is silence plus the confidence badge, not a reassurance the
  // data does not support.
  return fired
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || priorityOf(a) - priorityOf(b))
    .slice(0, MAX_INSIGHTS);
}

/**
 * Confidence in today's readiness score, judged on how much history actually
 * backs the z-scores behind it. Both axes are kept, not just their combined
 * headline number: `unreachableBands` needs to reason about HRV and resting HR
 * separately, since a thin baseline on one axis does not restrict the other.
 */
export function readinessConfidence(rows: WellnessRow[], windowDays = READINESS_WINDOW_DAYS): ReadinessConfidence {
  const hrv = baselineConfidence(rows.map((r) => lnHrv(r.rmssd)), windowDays);
  const rhr = baselineConfidence(rows.map((r) => r.rhr), windowDays);
  return { hrv, rhr, overall: weakerConfidence(hrv, rhr) };
}
