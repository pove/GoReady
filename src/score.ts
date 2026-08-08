import { mean, populationStd } from './stats';
import type { ReadinessCode, ReadinessResult, WellnessRow } from './types';

/** Background / needle color per readiness code. */
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

/** z-scores of the rMSSD-derived HRV and RHR at `rows[index]` against its trailing 30-day window. */
function computeZScoresAt(rows: WellnessRow[], index: number): { hrvZ: number; rhrZ: number } {
  const window = rows.slice(index, Math.min(index + 30, rows.length));

  const hrvValues = window.map((row) => 20 * Math.log(row.rmssd));
  const rhrValues = window.map((row) => row.rhr);

  const hrvZ = (hrvValues[0] - mean(hrvValues)) / populationStd(hrvValues);
  const rhrZ = (rhrValues[0] - mean(rhrValues)) / populationStd(rhrValues);
  return { hrvZ, rhrZ };
}

interface Classification {
  code: ReadinessCode;
  label: string;
  detail: [string, string];
}

/** Ported 1:1 from the MATLAB getScore() decision tree; order matters, first match wins. */
function classify(hrvZ: number, rhrZ: number): Classification {
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
    return { code: 4, label: 'Normal', detail: ['Go on!', 'Train as planned.'] };
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
 * Readiness codes for the days before today (index 0 = yesterday, 1 = the day
 * before, ...), for drawing a fading trail of past needle positions on the gauge.
 */
export function computeReadinessTrail(rows: WellnessRow[], days: number): ReadinessCode[] {
  const trailLength = Math.min(days, Math.max(rows.length - 1, 0));
  const codes: ReadinessCode[] = [];
  for (let i = 1; i <= trailLength; i++) {
    const { hrvZ, rhrZ } = computeZScoresAt(rows, i);
    codes.push(classify(hrvZ, rhrZ).code);
  }
  return codes;
}
