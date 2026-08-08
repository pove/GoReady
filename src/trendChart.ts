import { mean, populationStd } from './stats';
import type { Settings } from './types';

const DISPLAY_DAYS = 30;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 140;
const PADDING = { top: 18, right: 8, bottom: 18, left: 30 };
const BAND_COLOR = '#facc15';
const IN_BAND_COLOR = '#4ade80';
const OUT_OF_BAND_COLOR = '#f87171';

interface TrendDay {
  value: number;
  shortTermAvg: number;
  lowerBand: number;
  upperBand: number;
}

type PixelX = (index: number) => number;
type PixelY = (value: number) => number;

/** For each day, its short-term moving average and the expected-range band from the long-term trend. */
function computeTrend(valuesAscending: number[], settings: Settings): TrendDay[] {
  return valuesAscending.map((value, i) => {
    const longWindow = valuesAscending.slice(Math.max(0, i - settings.daysForLongTermTrend + 1), i + 1);
    const longTermAvg = mean(longWindow);
    const longTermStd = populationStd(longWindow);

    const shortWindow = valuesAscending.slice(Math.max(0, i - settings.daysForShortTermTrend + 1), i + 1);

    return {
      value,
      shortTermAvg: mean(shortWindow),
      lowerBand: longTermAvg - settings.stdDevMultiplier * longTermStd,
      upperBand: longTermAvg + settings.stdDevMultiplier * longTermStd,
    };
  });
}

function niceAxisRange(values: number[]): { min: number; max: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1 };

  const min = Math.max(0, 10 * Math.floor((Math.min(...finite) - 2) / 10));
  const max = Math.max(min + 10, 10 * Math.ceil((Math.max(...finite) + 1) / 10));
  return { min, max };
}

/** Renders the expected-range band as filled polygons, split at any gap in the data. */
function renderBand(days: TrendDay[], xFor: PixelX, yFor: PixelY): string {
  const points = days
    .map((d, i) => ({ i, lower: d.lowerBand, upper: d.upperBand }))
    .filter((p) => !Number.isNaN(p.lower) && !Number.isNaN(p.upper));

  const runs: (typeof points)[] = [];
  for (const p of points) {
    const run = runs[runs.length - 1];
    if (run && p.i === run[run.length - 1].i + 1) run.push(p);
    else runs.push([p]);
  }

  return runs
    .filter((run) => run.length > 1)
    .map((run) => {
      const top = run.map((p) => `${xFor(p.i).toFixed(1)},${yFor(p.upper).toFixed(1)}`);
      const bottom = [...run].reverse().map((p) => `${xFor(p.i).toFixed(1)},${yFor(p.lower).toFixed(1)}`);
      return `<polygon points="${[...top, ...bottom].join(' ')}" fill="${BAND_COLOR}" fill-opacity="0.25" />`;
    })
    .join('');
}

/** Renders the short-term moving-average line, lifting the pen across any gap in the data. */
function renderShortTermLine(days: TrendDay[], xFor: PixelX, yFor: PixelY): string {
  let d = '';
  let penDown = false;
  days.forEach((day, i) => {
    if (Number.isNaN(day.shortTermAvg)) {
      penDown = false;
      return;
    }
    d += `${penDown ? 'L' : 'M'} ${xFor(i).toFixed(1)} ${yFor(day.shortTermAvg).toFixed(1)} `;
    penDown = true;
  });
  return `<path d="${d.trim()}" fill="none" stroke="#1f2937" stroke-width="1.5" stroke-dasharray="4 3" />`;
}

function renderBars(days: TrendDay[], xFor: PixelX, yFor: PixelY, barWidth: number, floorY: number, showValues: boolean): string {
  return days
    .map((day, i) => {
      if (Number.isNaN(day.value)) return '';
      const x = xFor(i) - barWidth / 2;
      const y = yFor(day.value);
      const inBand = day.value >= day.lowerBand && day.value <= day.upperBand;
      const color = inBand ? IN_BAND_COLOR : OUT_OF_BAND_COLOR;
      const label = showValues
        ? `<text x="${xFor(i).toFixed(1)}" y="${(y - 4).toFixed(1)}" class="trend-value" text-anchor="middle">${Math.round(day.value)}</text>`
        : '';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(floorY - y).toFixed(1)}" fill="${color}" fill-opacity="0.55" />${label}`;
    })
    .join('');
}

/** Renders a bar chart of the last 30 days with a short-term trend line and long-term expected-range band. */
export function renderTrendChart(label: string, valuesNewestFirst: number[], settings: Settings): string {
  const ascending = [...valuesNewestFirst].reverse();
  const trend = computeTrend(ascending, settings);
  const visible = trend.slice(-DISPLAY_DAYS);

  const { min, max } = niceAxisRange(visible.flatMap((d) => [d.value, d.lowerBand, d.upperBand]));
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const floorY = PADDING.top + plotHeight;

  const xFor: PixelX = (i) => PADDING.left + (visible.length <= 1 ? plotWidth / 2 : (i / (visible.length - 1)) * plotWidth);
  const yFor: PixelY = (v) => floorY - ((v - min) / (max - min)) * plotHeight;
  const barWidth = Math.min(18, (plotWidth / visible.length) * 0.6);

  return `
    <div class="trend-chart">
      <div class="trend-chart-label">${label}</div>
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" class="trend-svg" role="img" aria-label="${label} trend, last ${visible.length} days">
        <text x="${PADDING.left - 4}" y="${(PADDING.top + 4).toFixed(1)}" class="trend-axis" text-anchor="end">${max}</text>
        <text x="${PADDING.left - 4}" y="${floorY.toFixed(1)}" class="trend-axis" text-anchor="end">${min}</text>
        ${renderBand(visible, xFor, yFor)}
        ${renderBars(visible, xFor, yFor, barWidth, floorY, settings.showValuesInTrendCharts)}
        ${renderShortTermLine(visible, xFor, yFor)}
      </svg>
    </div>
  `;
}

/** How many days of history to fetch so the long-term window is full for every displayed day. */
export function requiredHistoryDays(settings: Settings): number {
  return Math.max(settings.daysForLongTermTrend + DISPLAY_DAYS - 1, 89);
}
