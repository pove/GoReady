import { mean, populationStd } from './stats';
import type { ReadinessCode, ReadinessResult, WellnessRow, ZScorePoint } from './types';

/**
 * Readiness scoring ported from a MATLAB script originally written by
 * Inigo Tolosa (@Inigo_Tolosa on the intervals.icu forum); see the
 * "How-to guide: ImReady4 app for HRV-guided training" forum thread. See the
 * README's Credits section.
 */

/** Gauge zone / legend color per readiness code. */
export const ZONE_COLORS: Record<ReadinessCode, string> = {
  1: '#78f078', // HIT
  2: '#e6e6e6', // LIT
  3: '#ffa500', // LIT! / LIT (recovery incomplete)
  4: '#b4f0b4', // Normal
  5: '#dcdcdc', // Rest
  6: '#ff7878', // REST!
  7: '#ffffff', // no data
};

/** Value written to intervals.icu's "TrainingAdvice" wellness field for each readiness code. */
const ADVICE_CODE_BY_READINESS: Record<ReadinessCode, number | null> = {
  1: 4,
  2: 2,
  3: 2,
  4: 3,
  5: 1,
  6: 1,
  7: null,
};

interface LegendEntry {
  code: ReadinessCode;
  label: string;
  description: string;
}

/**
 * Meaning of each non-"no data" readiness code, worst to best, for the gauge
 * legend. Code 3 fires from two different branches of `classify()` (very low
 * RHR with acute-fatigue signs, labeled "LIT!"; or moderate RHR with
 * incomplete HRV recovery, labeled "LIT") that share a color, so the legend
 * shows both label variants in one row rather than picking just one.
 */
export const READINESS_LEGEND: LegendEntry[] = [
  { code: 6, label: 'REST!', description: 'Illness or stress detected' },
  { code: 5, label: 'Rest', description: 'Time to recover' },
  { code: 3, label: 'LIT / LIT!', description: 'Recovery is not complete' },
  { code: 2, label: 'LIT', description: 'Low intensity training' },
  { code: 4, label: 'Normal', description: 'Train as planned' },
  { code: 1, label: 'HIT', description: 'Ready for intensive training' },
];

/** z-scores of the rMSSD-derived HRV and RHR at `rows[index]` against its trailing 30-day window. */
function computeZScoresAt(rows: WellnessRow[], index: number): ZScorePoint {
  const window = rows.slice(index, Math.min(index + 30, rows.length));

  const hrvValues = window.map((row) => 20 * Math.log(row.rmssd));
  const rhrValues = window.map((row) => row.rhr);

  const hrvZ = (hrvValues[0] - mean(hrvValues)) / populationStd(hrvValues);
  const rhrZ = (rhrValues[0] - mean(rhrValues)) / populationStd(rhrValues);
  return { hrvZ, rhrZ };
}

export interface Classification {
  code: ReadinessCode;
  label: string;
  detail: [string, string];
}

/** Ported 1:1 from the MATLAB getScore() decision tree; order matters, first match wins. */
export function classify(hrvZ: number, rhrZ: number): Classification {
  if (Number.isNaN(rhrZ) || Number.isNaN(hrvZ)) {
    return { code: 7, label: '...?', detail: ['No HRV data today', 'Take a measurement.'] };
  }
  if (rhrZ <= 1 && rhrZ > -1 && hrvZ > 1) {
    return { code: 1, label: 'HIT', detail: ['Ready for', 'intensive training'] };
  }
  if (rhrZ <= -2 && hrvZ >= -1 && hrvZ < 0) {
    return { code: 2, label: 'LIT', detail: ['Low intensity training', ''] };
  }
  if (rhrZ <= -2 && hrvZ >= 0) {
    return { code: 3, label: 'LIT!', detail: ['Keep calm!', 'Acute fatigue signs'] };
  }
  if (rhrZ < 1.7 && hrvZ >= -1) {
    // Deliberately dropped the original script's "Go on!" lead-in here - it
    // read as filler, not information.
    return { code: 4, label: 'Normal', detail: ['Train as planned.', ''] };
  }
  if (hrvZ >= -1) {
    return { code: 2, label: 'LIT', detail: ['Low intensity training', ''] };
  }
  if (rhrZ <= -2) {
    return { code: 5, label: 'Rest', detail: ['Time to recover', 'Avoid overtraining'] };
  }
  if (rhrZ <= 1.7) {
    return { code: 3, label: 'LIT', detail: ['Low intensity training', 'Recovery is not complete'] };
  }
  return { code: 6, label: 'REST!', detail: ['Be careful!', 'Illness or stress detected'] };
}

const NO_DATA_RESULT: ReadinessResult = {
  code: 7,
  label: '...?',
  detail: ['No HRV data today', 'Take a measurement.'],
  color: ZONE_COLORS[7],
  adviceCode: null,
};

/** Computes today's readiness from wellness history sorted newest first. */
export function computeReadiness(rows: WellnessRow[]): ReadinessResult {
  if (rows.length === 0) return NO_DATA_RESULT;

  const { hrvZ, rhrZ } = computeZScoresAt(rows, 0);
  const { code, label, detail } = classify(hrvZ, rhrZ);

  // rMSSD was measured today but there's no variability in the trailing window
  // (population std = 0), which makes the z-score undefined rather than truly missing.
  const noVariability = code === 7 && !Number.isNaN(rows[0].rmssd);
  const finalDetail: [string, string] = noVariability
    ? ['No variability in last 30 days', 'Take more measurements']
    : detail;

  return { code, label, detail: finalDetail, color: ZONE_COLORS[code], adviceCode: ADVICE_CODE_BY_READINESS[code] };
}

/**
 * HRV/RHR z-scores for today and the `trailDays` days before it (index 0 =
 * today, 1 = yesterday, ...), for plotting the gauge's fading trail of past
 * positions against the same continuous scale as today's marker.
 */
export function computeZScoreSeries(rows: WellnessRow[], trailDays: number): ZScorePoint[] {
  const length = Math.min(trailDays + 1, rows.length);
  const series: ZScorePoint[] = [];
  for (let i = 0; i < length; i++) {
    series.push(computeZScoresAt(rows, i));
  }
  return series;
}
