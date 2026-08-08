import { describe, expect, it } from 'vitest';
import {
  baselineConfidence,
  computeTrend,
  lnHrv,
  mad,
  maxReachableZ,
  median,
  outOfBandStreak,
  rollingCv,
  rollingMean,
  unreachableBands,
  validCount,
  weakerConfidence,
} from './baseline';
import { computeReadiness } from './score';
import { DEFAULT_SETTINGS } from './settings';
import { populationStd, mean } from './stats';
import { wellnessRow, wellnessSeries } from './testFixtures';

describe('lnHrv', () => {
  it('is the original 20 * ln transform for real measurements', () => {
    expect(lnHrv(50)).toBeCloseTo(20 * Math.log(50), 10);
  });

  // Regression: Math.log(0) is -Infinity, which propagates into the mean and
  // then into the standard deviation as NaN. One corrupt 0 in the history used
  // to blank the readiness score for as long as that day stayed in the window.
  it('treats a non-positive reading as missing rather than -Infinity', () => {
    expect(lnHrv(0)).toBeNaN();
    expect(lnHrv(-5)).toBeNaN();
    expect(lnHrv(NaN)).toBeNaN();
  });

  it('keeps one corrupt 0 from blanking the whole 30-day window', () => {
    const rows = wellnessSeries(30, (daysAgo) => ({
      rhr: 50 + (daysAgo % 3),
      rmssd: daysAgo === 10 ? 0 : 40 + (daysAgo % 5),
    }));
    expect(computeReadiness(rows).code).not.toBe(7);
  });
});

describe('maxReachableZ', () => {
  // The whole reason the confidence badge exists. With a population standard
  // deviation the largest z-score N observations can produce is sqrt(N - 1),
  // and every threshold in classify() sits within |z| <= 2.
  it('is sqrt(N - 1), matching what populationStd can actually produce', () => {
    for (const n of [2, 3, 4, 5, 10, 30]) {
      const values = [1000, ...Array(n - 1).fill(50)];
      const observed = (values[0] - mean(values)) / populationStd(values);
      expect(maxReachableZ(n)).toBeCloseTo(Math.sqrt(n - 1), 10);
      expect(observed).toBeCloseTo(maxReachableZ(n), 10);
    }
  });

  it('is zero below two observations, where a z-score is undefined', () => {
    expect(maxReachableZ(1)).toBe(0);
    expect(maxReachableZ(0)).toBe(0);
  });
});

describe('baselineConfidence', () => {
  const withValidDays = (n: number) =>
    baselineConfidence([...Array(n).fill(50), ...Array(30 - n).fill(NaN)], 30);

  it('tiers on how many days actually carry a measurement', () => {
    expect(withValidDays(2).tier).toBe('unusable');
    expect(withValidDays(4).tier).toBe('unusable');
    expect(withValidDays(5).tier).toBe('limited');
    expect(withValidDays(20).tier).toBe('limited');
    expect(withValidDays(21).tier).toBe('ok');
    expect(withValidDays(30).tier).toBe('ok');
  });

  it('counts only the requested window', () => {
    const confidence = baselineConfidence([...Array(40).fill(50)], 30);
    expect(confidence.validDays).toBe(30);
    expect(confidence.windowDays).toBe(30);
  });

  it('takes the weaker of two metrics, since a zone needs both to reach it', () => {
    const thin = withValidDays(3);
    const thick = withValidDays(30);
    expect(weakerConfidence(thin, thick)).toBe(thin);
    expect(weakerConfidence(thick, thin)).toBe(thin);
  });
});

describe('unreachableBands', () => {
  /** Both axes equally thin/rich, for cases that aren't about the asymmetric bug below. */
  const symmetric = (n: number) => {
    const confidence = baselineConfidence(Array(n).fill(50), 30);
    return { hrv: confidence, rhr: confidence, overall: confidence };
  };

  it('reports every band when two days cap both axes at |z| = 1', () => {
    // At maxReachableZ = 1 nothing but "Train as planned" is reachable.
    expect(unreachableBands(symmetric(2))).toEqual(['Stress / illness', 'Rest', 'Limit intensity', 'HIT']);
  });

  it('frees the bands up as history accumulates on both axes', () => {
    // sqrt(3) = 1.73 clears HIT/Limit intensity (> 1) and Stress (> 1.7), not Rest (>= 2).
    expect(unreachableBands(symmetric(4))).toEqual(['Rest']);
    // sqrt(4) = 2 reaches everything.
    expect(unreachableBands(symmetric(5))).toEqual([]);
  });

  it('reports every band when either axis alone has no z-score at all', () => {
    const rich = baselineConfidence(Array(30).fill(50), 30);
    const empty = baselineConfidence([NaN, NaN], 30); // classify() would return "no data" regardless of the other axis
    expect(unreachableBands({ hrv: rich, rhr: empty, overall: empty })).toEqual([
      'Stress / illness',
      'Rest',
      'Limit intensity',
      'HIT',
    ]);
    expect(unreachableBands({ hrv: empty, rhr: rich, overall: empty })).toEqual([
      'Stress / illness',
      'Rest',
      'Limit intensity',
      'HIT',
    ]);
  });

  // Regression: this used to collapse both axes into whichever was weaker and
  // apply a single-axis test to that one number. HIT needs a LARGE hrvZ but
  // only a SMALL |rhrZ| (within (-1, 1]), so a thin RHR baseline barely
  // constrains it - the collapsed version wrongly reported HIT unreachable
  // here even though computeReadiness (see the test below) genuinely returns
  // it, a direct contradiction between the badge and the gauge next to it.
  it('does not let a thin RHR baseline hide a HIT that a rich HRV baseline can reach', () => {
    const richHrv = baselineConfidence(Array(30).fill(50), 30);
    const thinRhr = baselineConfidence([60, 50], 30); // exactly 2 valid days
    expect(unreachableBands({ hrv: richHrv, rhr: thinRhr, overall: thinRhr })).not.toContain('HIT');
  });

  // And the mirror image: a thin HRV baseline genuinely does rule HIT out,
  // regardless of how much RHR history exists, since HIT needs hrvZ > 1.
  it('still rules out HIT when it is the HRV baseline that is thin', () => {
    const thinHrv = baselineConfidence([60, 50], 30);
    const richRhr = baselineConfidence(Array(30).fill(50), 30);
    expect(unreachableBands({ hrv: thinHrv, rhr: richRhr, overall: thinHrv })).toContain('HIT');
  });
});

// The scenario the regression test above is built from: a genuine HIT produced
// from a rich HRV baseline and a bare two-day RHR baseline, checked end to end
// against the actual score - not just the reachability table in isolation.
describe('a HIT produced from an asymmetric baseline', () => {
  const rows = wellnessSeries(30, (daysAgo) => ({
    rhr: daysAgo === 0 ? 60 : daysAgo === 1 ? 50 : NaN, // only 2 valid RHR days
    rmssd: daysAgo === 0 ? 95 : 50, // rich HRV baseline, today's HRV comfortably elevated
  }));

  it('computeReadiness genuinely returns HIT', () => {
    expect(computeReadiness(rows)).toMatchObject({ code: 1, label: 'HIT' });
  });

  it('unreachableBands agrees that HIT is reachable', () => {
    const hrv = baselineConfidence(rows.map((r) => lnHrv(r.rmssd)), 30);
    const rhr = baselineConfidence(rows.map((r) => r.rhr), 30);
    expect(unreachableBands({ hrv, rhr, overall: weakerConfidence(hrv, rhr) })).not.toContain('HIT');
  });
});

// The case that motivated the whole confidence feature: two days of history
// pin the readiness code to "Train as planned" no matter what the morning
// looked like, and nothing about that result says so on its own.
describe('a two-day baseline', () => {
  const rows = [
    wellnessRow({ date: '2024-03-01', rhr: 80, rmssd: 8 }), // a dreadful morning
    wellnessRow({ date: '2024-02-29', rhr: 45, rmssd: 95 }),
  ];

  it('still returns "Train as planned" however bad today is', () => {
    expect(computeReadiness(rows)).toMatchObject({ code: 4, label: 'Normal' });
  });

  it('is reported as an unusable baseline, so the score is not read as reassurance', () => {
    const confidence = baselineConfidence(rows.map((r) => r.rhr), 30);
    expect(confidence.tier).toBe('unusable');
    expect(confidence.maxReachableZ).toBe(1);
  });
});

describe('rolling windows', () => {
  const newestFirst = [10, 20, 30, 40, 50];

  it('averages the trailing window at an index', () => {
    expect(rollingMean(newestFirst, 3)).toBe(20);
    expect(rollingMean(newestFirst, 3, 2)).toBe(40);
  });

  it('shrinks the window rather than running off the end of the series', () => {
    expect(rollingMean(newestFirst, 10)).toBe(30);
    expect(rollingMean(newestFirst, 3, 4)).toBe(50);
  });

  it('ignores missing days, and is NaN when the window holds none at all', () => {
    expect(rollingMean([NaN, 20, NaN, 40], 4)).toBe(30);
    expect(rollingMean([NaN, NaN], 2)).toBeNaN();
  });

  it('reports the coefficient of variation as a percentage', () => {
    const values = [90, 100, 110];
    expect(rollingCv(values, 3)).toBeCloseTo((populationStd(values) / 100) * 100, 10);
  });

  // CV is a ratio, so the 20x in lnHrv cancels: the number matches the CV of
  // plain ln(rMSSD), which is what the literature reports.
  it('is unaffected by the 20x scaling in lnHrv', () => {
    const raw = [40, 55, 48, 60, 44];
    expect(rollingCv(raw.map(lnHrv), 5)).toBeCloseTo(rollingCv(raw.map(Math.log), 5), 10);
  });

  it('refuses a coefficient of variation around a non-positive mean', () => {
    expect(rollingCv([-5, 5], 2)).toBeNaN();
  });
});

describe('median and mad', () => {
  it('takes the middle value, averaging the two middles when even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([NaN, 1, NaN, 3])).toBe(2);
    expect(median([NaN])).toBeNaN();
  });

  it('measures spread without letting one artifact inflate it', () => {
    expect(mad([10, 10, 10, 10, 10])).toBe(0);
    // The 1000 shifts the standard deviation enormously but barely moves the MAD.
    expect(mad([9, 10, 11, 10, 1000])).toBe(1);
  });
});

describe('validCount', () => {
  it('counts only real measurements', () => {
    expect(validCount([1, NaN, 3, NaN])).toBe(2);
    expect(validCount([])).toBe(0);
  });
});

describe('outOfBandStreak', () => {
  const settings = { ...DEFAULT_SETTINGS, daysForLongTermTrend: 10, stdDevMultiplier: 1 };
  /** Ten steady days followed by `tail`, oldest first, as computeTrend expects. */
  const trendWith = (...tail: number[]) => computeTrend([...Array(10).fill(50), ...tail], settings);

  it('counts consecutive days on the same side of the band', () => {
    expect(outOfBandStreak(trendWith(80, 80, 80))).toEqual({ days: 3, direction: 'above' });
    expect(outOfBandStreak(trendWith(20, 20))).toEqual({ days: 2, direction: 'below' });
  });

  it('is zero once the most recent day is back inside the band', () => {
    expect(outOfBandStreak(trendWith(80, 80, 50))).toEqual({ days: 0, direction: null });
  });

  it('stops at a change of side rather than counting through it', () => {
    expect(outOfBandStreak(trendWith(20, 80, 80))).toEqual({ days: 2, direction: 'above' });
  });

  // A run of readings is only evidence of a run if the readings are there.
  it('stops at a missing day rather than counting across the gap', () => {
    expect(outOfBandStreak(trendWith(80, NaN, 80))).toEqual({ days: 1, direction: 'above' });
  });

  it('is zero for an empty series', () => {
    expect(outOfBandStreak([])).toEqual({ days: 0, direction: null });
  });
});
