/** intervals.icu custom wellness field GoReady reads from and writes readiness to. Fixed, not user-configurable. */
export const TRAINING_ADVICE_FIELD = 'TrainingAdvice';

/**
 * Optional intervals.icu wellness columns used only to add context to insights
 * ("HRV is down after a hard ramp", "...after a short night"). Nothing that
 * drives the readiness score reads them.
 *
 * If an athlete's account does not populate one, it parses to NaN and every
 * rule that needs it simply stays quiet.
 */
export const CONTEXT_FIELDS = {
  ctl: 'ctl',
  atl: 'atl',
  rampRate: 'rampRate',
  sleepSecs: 'sleepSecs',
  sleepScore: 'sleepScore',
} as const;
