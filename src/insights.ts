import type { ReadinessCode } from './types';

/**
 * Supplementary, qualitative read on *where* today's point sits within the
 * HIT/Normal zone, based on three named regions on the reference readiness
 * chart (see the forum thread credited in the README, and the in-app help
 * dialog which shows that chart): "optimum pre-race", "not coping well
 * during loading", and "coping well during training blocks".
 *
 * These bands are this app's own approximate reading of that diagram's
 * layout relative to its axis ticks - not part of Inigo Tolosa's original
 * scoring algorithm - so this only ever adds a supplementary sentence. It
 * never changes the readiness code, color, or the TrainingAdvice value sent
 * to intervals.icu; those still come solely from `classify()` in score.ts.
 */

/** Roughly matches the hatched regions' angular (RHR z-score) extent in the reference chart. */
const ACTIVATION_BAND = 1.3;
/** hrvZ threshold separating "HRV still holding up" from "HRV starting to slip". */
const STRONG_HRV = 0.5;

export function trainingPhaseNote(code: ReadinessCode, hrvZ: number, rhrZ: number): string | null {
  if (code !== 1 && code !== 4) return null; // only refines HIT / Normal
  if (Number.isNaN(hrvZ) || Number.isNaN(rhrZ)) return null;

  if (rhrZ > 0 && rhrZ <= ACTIVATION_BAND) {
    return hrvZ >= STRONG_HRV
      ? 'Resting HR is up but HRV is still strong - this pattern looks like "optimum pre-race": primed, not fatigued.'
      : 'Resting HR is up and HRV is starting to slip - a sign you may not be coping well with recent loading.';
  }

  if (rhrZ < 0 && rhrZ >= -ACTIVATION_BAND && hrvZ >= STRONG_HRV) {
    return 'Resting HR is calm and HRV is strong - a sign you\'re coping well with the current training block.';
  }

  return null;
}
