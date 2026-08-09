import { isInBand, type TrendDay } from './baseline';
import type { Settings, TrendValueLabels } from './types';

const DISPLAY_DAYS = 30;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 140;
/* Right padding leaves room for the value label over the final bar, which is
   centred on it and would otherwise run off the edge of the viewBox. */
const PADDING = { top: 18, right: 14, bottom: 18, left: 30 };

/**
 * Band membership is a two-state status, and the two states are red and green -
 * the one pair colour cannot carry on its own. Measured against both of this
 * app's surfaces, the two differ by only ΔE 4.1 under deuteranopia (against a
 * floor of 8), so out-of-band bars are additionally hatched. The colour is the
 * quick read for everyone; the hatch is what actually carries the distinction
 * for red-green colourblind readers, in print, and under forced-colors.
 *
 * Fills and strokes are set through CSS classes rather than inline attributes so
 * they follow the theme - the short-term line used to be a hardcoded #1f2937,
 * which is exactly the dark theme's card colour, and vanished in dark mode.
 */
type PixelX = (index: number) => number;
type PixelY = (value: number) => number;

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
      return `<polygon points="${[...top, ...bottom].join(' ')}" class="trend-band" />`;
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
  return `<path d="${d.trim()}" class="trend-average-line" fill="none" stroke-dasharray="4 3" />`;
}

/**
 * The 45-degree hatch laid over out-of-band bars, inked tone-on-tone. Each chart
 * needs its own copy: SVG ids share one namespace across the page, so three
 * charts declaring the same id would all resolve to the first one's pattern.
 */
function renderHatchPattern(id: string): string {
  return `
    <defs>
      <pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" class="trend-hatch-line" />
      </pattern>
    </defs>
  `;
}

/**
 * Which bars get a number printed over them, per the `trendValueLabels`
 * setting. `all` labels every measured day - `minimal` exists because
 * labelling all thirty at once collides into an unreadable smear at phone
 * widths, so it picks just the days worth naming: the most recent, and the
 * window's high and low.
 */
export function labelledIndices(days: TrendDay[], mode: TrendValueLabels): Set<number> {
  const measured = days.map((d, i) => ({ i, value: d.value })).filter((d) => !Number.isNaN(d.value));
  if (mode === 'none' || measured.length === 0) return new Set();
  if (mode === 'all') return new Set(measured.map((d) => d.i));

  const highest = measured.reduce((best, d) => (d.value > best.value ? d : best));
  const lowest = measured.reduce((best, d) => (d.value < best.value ? d : best));
  return new Set([measured[measured.length - 1].i, highest.i, lowest.i]);
}

function renderBars(
  days: TrendDay[],
  xFor: PixelX,
  yFor: PixelY,
  barWidth: number,
  floorY: number,
  valueLabels: TrendValueLabels,
  hatchId: string,
): string {
  const labelled = labelledIndices(days, valueLabels);

  return days
    .map((day, i) => {
      if (Number.isNaN(day.value)) return '';
      const x = xFor(i) - barWidth / 2;
      const y = yFor(day.value);
      const inBand = isInBand(day);
      const label = labelled.has(i)
        ? `<text x="${xFor(i).toFixed(1)}" y="${(y - 4).toFixed(1)}" class="trend-value" text-anchor="middle">${Math.round(day.value)}</text>`
        : '';
      const geometry = `x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(floorY - y).toFixed(1)}"`;
      // Out-of-band bars get the hatch painted over the fill, so the state reads
      // without relying on the red/green difference.
      const hatch = inBand ? '' : `<rect ${geometry} fill="url(#${hatchId})" />`;
      return `<rect ${geometry} class="${inBand ? 'trend-bar-in' : 'trend-bar-out'}" />${hatch}${label}`;
    })
    .join('');
}

/** A stable, document-unique id fragment for a chart's SVG defs. */
function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Describes the chart in words, for readers who get the `aria-label` instead of
 * the picture. The out-of-band count is the thing the colours are there to
 * convey, so it belongs in the text too rather than only in the paint.
 */
function describeChart(label: string, visible: TrendDay[]): string {
  const measured = visible.filter((d) => !Number.isNaN(d.value));
  if (measured.length === 0) return `${label} trend: no measurements in the last ${visible.length} days`;

  const outOfBand = measured.filter((d) => !isInBand(d)).length;
  return (
    `${label} trend, last ${visible.length} days: ${measured.length} measurements, ` +
    `${outOfBand} outside the expected range`
  );
}

/**
 * Renders a bar chart of the last 30 days with a short-term trend line and
 * long-term expected-range band. Takes the already-computed trend rather
 * than raw values, so the caller can share one `computeTrend` result between
 * this chart and the insight engine's streak rule instead of each computing
 * it separately over the same rows/settings.
 */
export function renderTrendChart(label: string, trend: TrendDay[], settings: Settings): string {
  const visible = trend.slice(-DISPLAY_DAYS);
  const hatchId = `trend-hatch-${slugify(label)}`;

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
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" class="trend-svg" role="img" aria-label="${describeChart(label, visible)}">
        ${renderHatchPattern(hatchId)}
        <text x="${PADDING.left - 4}" y="${(PADDING.top + 4).toFixed(1)}" class="trend-axis" text-anchor="end">${max}</text>
        <text x="${PADDING.left - 4}" y="${floorY.toFixed(1)}" class="trend-axis" text-anchor="end">${min}</text>
        ${renderBand(visible, xFor, yFor)}
        ${renderBars(visible, xFor, yFor, barWidth, floorY, settings.trendValueLabels, hatchId)}
        ${renderShortTermLine(visible, xFor, yFor)}
      </svg>
    </div>
  `;
}

/**
 * One shared key for all three trend charts, naming what the paint means. A
 * status encoding has to ship with a label - the colours alone are not allowed
 * to be the only thing carrying "inside" versus "outside the expected range".
 */
export function renderTrendLegend(): string {
  return `
    <ul class="trend-legend">
      <li><span class="trend-key trend-key-in" aria-hidden="true"></span>Inside range</li>
      <li><span class="trend-key trend-key-out" aria-hidden="true"></span>Outside range</li>
      <li><span class="trend-key trend-key-band" aria-hidden="true"></span>Expected range</li>
      <li><span class="trend-key trend-key-avg" aria-hidden="true"></span>Short-term average</li>
    </ul>
  `;
}

/** How many days of history to fetch so the long-term window is full for every displayed day. */
export function requiredHistoryDays(settings: Settings): number {
  return Math.max(settings.daysForLongTermTrend + DISPLAY_DAYS - 1, 89);
}
