import { describe, expect, it } from 'vitest';
import { classify, computeReadiness, computeZScoreSeries, READINESS_LEGEND, ZONE_COLORS } from './score';
import { ZONES } from './gauge';
import { mean, populationStd } from './stats';
import { wellnessRow } from './testFixtures';
import type { ReadinessCode, WellnessRow } from './types';

function row(date: string, rhr: number, rmssd: number, trainingAdvice = ''): WellnessRow {
  return wellnessRow({ date, rhr, rmssd, trainingAdvice });
}

// classify(hrvZ, rhrZ) is ported 1:1 from the original MATLAB getScore()
// decision tree; these tests pin down each branch (order matters - several
// branches are only reachable once earlier ones are ruled out) plus the
// boundaries between them.
describe('classify', () => {
  it('HIT when rhrZ is within (-1, 1] and hrvZ > 1', () => {
    expect(classify(1.5, 0)).toMatchObject({ code: 1, label: 'HIT' });
  });

  it('falls through to Normal right at the hrvZ > 1 boundary', () => {
    expect(classify(1, 0)).toMatchObject({ code: 4, label: 'Normal' });
  });

  it('LIT when rhrZ <= -2 and hrvZ is in [-1, 0)', () => {
    expect(classify(-0.5, -2.5)).toMatchObject({ code: 2, label: 'LIT' });
  });

  it('LIT! when rhrZ <= -2 and hrvZ >= 0', () => {
    expect(classify(0.2, -2.5)).toMatchObject({ code: 3, label: 'LIT!' });
  });

  it('Normal when rhrZ < 1.7 and hrvZ >= -1', () => {
    expect(classify(-0.5, 1)).toMatchObject({ code: 4, label: 'Normal' });
  });

  it('LIT (fallback) when hrvZ >= -1 but rhrZ is too high for Normal', () => {
    expect(classify(-0.5, 2)).toMatchObject({ code: 2, label: 'LIT' });
  });

  it('Rest when hrvZ < -1 and rhrZ <= -2', () => {
    expect(classify(-1.5, -2.5)).toMatchObject({ code: 5, label: 'Rest' });
  });

  it('LIT (recovery incomplete) when hrvZ < -1 and rhrZ is in (-2, 1.7]', () => {
    const result = classify(-1.5, 0);
    expect(result).toMatchObject({ code: 3, label: 'LIT' });
    expect(result.detail[1]).toBe('Recovery is not complete');
  });

  it('REST! when hrvZ < -1 and rhrZ > 1.7', () => {
    expect(classify(-1.5, 2)).toMatchObject({ code: 6, label: 'REST!' });
  });

  it('is "no data" when either z-score is NaN', () => {
    expect(classify(NaN, 0)).toMatchObject({ code: 7 });
    expect(classify(0, NaN)).toMatchObject({ code: 7 });
    expect(classify(NaN, NaN)).toMatchObject({ code: 7 });
  });
});

describe('computeReadiness', () => {
  it('returns the no-data result for an empty history', () => {
    const result = computeReadiness([]);
    expect(result.code).toBe(7);
    expect(result.adviceCode).toBeNull();
  });

  it('flags a distinct message when rMSSD was measured but the trailing window has no variability', () => {
    const rows = [row('2026-08-03', 50, 70), row('2026-08-02', 50, 70), row('2026-08-01', 50, 70)];

    const result = computeReadiness(rows);

    expect(result.code).toBe(7);
    expect(result.detail[0]).toBe('No variability in last 30 days');
  });

  it('reports genuinely missing data separately from a flat trailing window', () => {
    const rows = [row('2026-08-03', 50, NaN), row('2026-08-02', 50, 70), row('2026-08-01', 50, 65)];

    const result = computeReadiness(rows);

    expect(result.code).toBe(7);
    expect(result.detail[0]).toBe('No HRV data today');
  });

  it('classifies today from its z-score against the trailing window, and colors it accordingly', () => {
    const rows = [row('2026-08-03', 50, 90), row('2026-08-02', 60, 70), row('2026-08-01', 55, 80)];

    const hrvValues = rows.map((r) => 20 * Math.log(r.rmssd));
    const rhrValues = rows.map((r) => r.rhr);
    const hrvZ = (hrvValues[0] - mean(hrvValues)) / populationStd(hrvValues);
    const rhrZ = (rhrValues[0] - mean(rhrValues)) / populationStd(rhrValues);
    const expected = classify(hrvZ, rhrZ);

    const result = computeReadiness(rows);

    expect(result.code).toBe(expected.code);
    expect(result.label).toBe(expected.label);
    expect(result.color).toBe(ZONE_COLORS[expected.code]);
  });

  it('only looks at the trailing 30 days, ignoring anything older', () => {
    const flatWindow = Array.from({ length: 29 }, (_, i) => row(`2026-06-${i + 1}`, 50, 70));
    const rows = [row('2026-08-03', 50, 70), ...flatWindow, row('2026-01-01', 999, 999)];

    const result = computeReadiness(rows);

    // The 30-day trailing window (today + the 29 flat days) has no
    // variability at all; the day-31 outlier must not leak into it.
    expect(result.detail[0]).toBe('No variability in last 30 days');
  });
});

describe('computeZScoreSeries', () => {
  it('returns one entry (today) when trailDays is 0', () => {
    const rows = [row('2026-08-03', 50, 70), row('2026-08-02', 55, 72)];
    expect(computeZScoreSeries(rows, 0)).toHaveLength(1);
  });

  it('caps the series length at the available history', () => {
    const rows = [row('2026-08-03', 50, 70), row('2026-08-02', 55, 72)];
    expect(computeZScoreSeries(rows, 10)).toHaveLength(2);
  });

  it('returns an empty series for no history', () => {
    expect(computeZScoreSeries([], 6)).toEqual([]);
  });

  it('orders entries most-recent-first, matching computeReadiness for index 0', () => {
    const rows = [row('2026-08-03', 50, 90), row('2026-08-02', 60, 70), row('2026-08-01', 55, 80)];

    const series = computeZScoreSeries(rows, 6);
    const todayResult = computeReadiness(rows);

    expect(classify(series[0].hrvZ, series[0].rhrZ).code).toBe(todayResult.code);
  });
});

// The legend explains the gauge's colored bands, so it has to stay in sync
// with what the gauge actually paints and with what a result badge can show.
// These guard against the whole class of "legend says something the chart
// doesn't show" bugs: a row whose color appears nowhere, two rows the reader
// can't tell apart, or a result color missing from the legend entirely.
describe('READINESS_LEGEND', () => {
  const legendColors = READINESS_LEGEND.map((entry) => ZONE_COLORS[entry.code]);

  it('gives every row a distinct color, so no two rows look alike', () => {
    expect(new Set(legendColors).size).toBe(READINESS_LEGEND.length);
  });

  it('gives every row a distinct label', () => {
    const labels = READINESS_LEGEND.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('has a row for every color the gauge paints', () => {
    for (const color of new Set(ZONES.map((zone) => zone.color))) {
      expect(legendColors).toContain(color);
    }
  });

  it('has no row for a color the gauge never paints', () => {
    const paintedColors = new Set(ZONES.map((zone) => zone.color));
    for (const color of legendColors) {
      expect(paintedColors).toContain(color);
    }
  });

  it('has a row for every color a readiness result can be shown in', () => {
    const codes: ReadinessCode[] = [1, 2, 3, 4, 5, 6]; // 7 = no data, never drawn
    for (const code of codes) {
      expect(legendColors).toContain(ZONE_COLORS[code]);
    }
  });
});
