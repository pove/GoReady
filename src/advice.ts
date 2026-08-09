import type { AdviceStatus } from './types';

/**
 * What to do about today's `TrainingAdvice` field, given the readiness code's
 * advice value and whatever intervals.icu currently has stored for today.
 * Pure and side-effect-free on purpose: `main.ts` does the actual network call
 * for `write`, so this logic can be tested without a DOM or a live proxy.
 */
export type AdviceDecision =
  | { action: 'skip'; status: AdviceStatus }
  | { action: 'write'; status: AdviceStatus };

/**
 * On a no-data day (`adviceCode === null`) there is nothing correct to send,
 * so this skips the write entirely rather than clearing the field - a blank
 * write isn't guaranteed to round-trip through intervals.icu as blank, and
 * doing nothing at least never masks a real value with an incorrect clear.
 *
 * Otherwise, this compares against what is ACTUALLY stored rather than just
 * checking whether something is stored: a value only counts as "already set"
 * when it matches what would be sent. That is what lets a stale value - from
 * an earlier point in the day, or from before this logic existed - get
 * corrected once real data arrives, instead of permanently blocking every
 * future write because "something" was already there.
 */
export function decideAdviceAction(adviceCode: number | null, storedTrainingAdvice: string | undefined): AdviceDecision {
  if (adviceCode === null) {
    return { action: 'skip', status: { kind: 'no-data' } };
  }
  if (Number(storedTrainingAdvice) === adviceCode) {
    return { action: 'skip', status: { kind: 'already-set' } };
  }
  return { action: 'write', status: { kind: 'sent' } };
}
