import { decideAdviceAction } from './advice';
import { computeReadiness } from './score';
import type { WellnessRow } from './types';

export interface BackfillWrite {
  date: string;
  adviceCode: number;
}

/**
 * Which of the `windowDays` days immediately before today (`rows[1..windowDays]`
 * - never `rows[0]`, today's own write is handled separately in `main.ts`) need
 * their `TrainingAdvice` corrected on intervals.icu, and what to send for each.
 *
 * Reuses `computeReadiness`/`decideAdviceAction` exactly as today's write does,
 * so a backfilled day is corrected under the identical no-data / already-set /
 * stale-value rules - this is not a separate policy, just today's policy
 * applied to a handful of yesterdays.
 *
 * `windowDays` is a hard cap, not a target: regardless of how much history
 * `rows` holds, this only ever looks at the most recent `windowDays` of it.
 * That bounds worst-case write volume on every call and keeps a first-time
 * install from rewriting TrainingAdvice values that predate GoReady.
 */
export function planBackfill(rows: WellnessRow[], windowDays: number): BackfillWrite[] {
  const writes: BackfillWrite[] = [];
  const limit = Math.min(windowDays, rows.length - 1);

  for (let i = 1; i <= limit; i++) {
    const result = computeReadiness(rows, i);
    const decision = decideAdviceAction(result.adviceCode, rows[i].trainingAdvice);
    if (decision.action === 'write') {
      writes.push({ date: rows[i].date, adviceCode: result.adviceCode as number });
    }
  }

  return writes;
}
