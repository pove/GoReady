import { describe, expect, it } from 'vitest';
import { renderGauge, zScoreToPoint } from './gauge';
import type { ReadinessResult, ZScorePoint } from './types';

const RESULT: ReadinessResult = {
  code: 4,
  label: 'Normal',
  detail: ['Go on!', 'Train as planned.'],
  color: '#b4f0b4',
  adviceCode: 3,
};

describe('zScoreToPoint', () => {
  it('keeps rhrZ = 0 points on a vertical line straight up from center, regardless of hrvZ', () => {
    const a = zScoreToPoint(0, -1);
    const b = zScoreToPoint(0, 0);
    const c = zScoreToPoint(0, 2);

    expect(a.x).toBeCloseTo(b.x, 6);
    expect(b.x).toBeCloseTo(c.x, 6);
  });

  it('mirrors symmetric RHR z-scores left/right of center at the same height', () => {
    const right = zScoreToPoint(3, 0);
    const left = zScoreToPoint(-3, 0);
    const center = zScoreToPoint(0, 0);

    expect(right.y).toBeCloseTo(left.y, 6);
    expect(right.x - center.x).toBeCloseTo(-(left.x - center.x), 6);
  });

  it('shrinks the radius as HRV z-score increases (better recovery sits closer to the pole)', () => {
    const low = zScoreToPoint(0, -2);
    const mid = zScoreToPoint(0, 0);
    const high = zScoreToPoint(0, 2);

    // All three share rhrZ = 0, so they lie on the same vertical line; the
    // radius shrinks monotonically as hrvZ increases, which on this line
    // means y increases monotonically (points move down, toward the pole).
    expect(mid.y).toBeGreaterThan(low.y);
    expect(high.y).toBeGreaterThan(mid.y);
  });

  it('clamps out-of-range z-scores to the edge of the chart instead of extrapolating', () => {
    expect(zScoreToPoint(10, 0)).toEqual(zScoreToPoint(3, 0));
    expect(zScoreToPoint(-10, 0)).toEqual(zScoreToPoint(-3, 0));
    expect(zScoreToPoint(0, 10)).toEqual(zScoreToPoint(0, 3));
    expect(zScoreToPoint(0, -10)).toEqual(zScoreToPoint(0, -3));
  });
});

describe('renderGauge', () => {
  it('renders an SVG labeled with the readiness result', () => {
    const svg = renderGauge(RESULT, { hrvZ: 0.5, rhrZ: -0.2 }, []);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Normal');
  });

  it('never emits NaN coordinates into the markup, even with a full 6-day trail', () => {
    const trail: ZScorePoint[] = [
      { hrvZ: 0.1, rhrZ: 0.2 },
      { hrvZ: -0.3, rhrZ: 1.1 },
      { hrvZ: 1.5, rhrZ: -0.5 },
      { hrvZ: -1.2, rhrZ: -1.8 },
      { hrvZ: 2.9, rhrZ: 2.9 },
      { hrvZ: -2.9, rhrZ: -2.9 },
    ];

    const svg = renderGauge(RESULT, { hrvZ: 0.4, rhrZ: 0.1 }, trail);

    expect(svg).not.toContain('NaN');
  });

  it('draws a trail dot for every valid trail day', () => {
    const trail: ZScorePoint[] = [
      { hrvZ: 0.1, rhrZ: 0.2 },
      { hrvZ: -0.3, rhrZ: 1.1 },
      { hrvZ: 1.5, rhrZ: -0.5 },
    ];

    const svg = renderGauge(RESULT, { hrvZ: 0.4, rhrZ: 0.1 }, trail);
    const dotCount = (svg.match(/class="gauge-trail-dot"/g) ?? []).length;

    expect(dotCount).toBe(3);
  });

  it('skips trail days with no HRV data instead of plotting a broken marker', () => {
    const trail: ZScorePoint[] = [
      { hrvZ: 0.1, rhrZ: 0.2 },
      { hrvZ: NaN, rhrZ: NaN },
      { hrvZ: 1.5, rhrZ: -0.5 },
    ];

    const svg = renderGauge(RESULT, { hrvZ: 0.4, rhrZ: 0.1 }, trail);
    const dotCount = (svg.match(/class="gauge-trail-dot"/g) ?? []).length;

    expect(dotCount).toBe(2);
    expect(svg).not.toContain('NaN');
  });

  it('omits today\'s marker entirely when there is no HRV data for today', () => {
    const svg = renderGauge(RESULT, { hrvZ: NaN, rhrZ: NaN }, []);

    expect(svg).not.toContain('gauge-today-dot');
    expect(svg).not.toContain('NaN');
  });
});
