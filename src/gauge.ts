import { ZONE_COLORS } from './score';
import type { ReadinessResult, ZScorePoint } from './types';

/**
 * Polar readiness chart geometry, ported from Inigo Tolosa's original MATLAB
 * `plotScore()` (see the intervals.icu forum thread "How-to guide: ImReady4
 * app for HRV-guided training", and ekr1/ImReady4Py's `plotting.py` for a
 * from-scratch Python port checked against the same geometry).
 *
 * Both HRV and RHR z-scores are clamped to +-Z_LIMIT and mapped to a point at
 * `radius = RADIUS_OFFSET - hrvZ` and `angle = (rhrZ / Z_LIMIT) * ANG_LIMIT`,
 * measured clockwise from straight up. That leaves a wedge missing at the
 * bottom of the circle (ANG_LIMIT is 135deg, so the two ends of the arc are
 * 270deg apart, not a full 360) and means better HRV recovery sits closer to
 * the center while a worse resting heart rate swings the point further
 * left/right.
 */
const Z_LIMIT = 3;
const ANG_LIMIT = (1.5 * Math.PI) / 2;
const RADIUS_OFFSET = 6;

const VIEWBOX_SIZE = 220;
const CENTER_X = VIEWBOX_SIZE / 2;
const CENTER_Y = VIEWBOX_SIZE / 2;
/** Pixels per z-score unit; the plotted radius ranges from (RADIUS_OFFSET - Z_LIMIT) to (RADIUS_OFFSET + Z_LIMIT) units. */
const SCALE = 11;

const TRAIL_OPACITY_RANGE: [number, number] = [0.15, 0.55];
const TRAIL_RADIUS_RANGE: [number, number] = [2, 4];

function clampZ(z: number): number {
  return Math.max(-Z_LIMIT, Math.min(Z_LIMIT, z));
}

/** Maps a (rhrZ, hrvZ) pair to an SVG point on the gauge. Out-of-range z-scores are clamped to the chart's edge rather than clipped out of view. */
export function zScoreToPoint(rhrZ: number, hrvZ: number): { x: number; y: number } {
  const radius = (RADIUS_OFFSET - clampZ(hrvZ)) * SCALE;
  const theta = (clampZ(rhrZ) / Z_LIMIT) * ANG_LIMIT;
  return {
    x: CENTER_X + radius * Math.sin(theta),
    y: CENTER_Y - radius * Math.cos(theta),
  };
}

interface ZoneRect {
  /** [min, max] RHR z-score, which controls angular position. */
  rhrRange: [number, number];
  /** [min, max] HRV z-score, which controls radial position. */
  hrvRange: [number, number];
  color: string;
}

/**
 * Approximate visual zones (not a literal rendering of the `classify()`
 * decision tree, same as the original chart) so the gauge reads at a glance:
 * good HRV recovery (top) is greener, a high resting heart rate (right) or
 * very low HRV (outer edge) shades toward orange/red.
 */
const ZONES: ZoneRect[] = [
  { rhrRange: [-3, 3], hrvRange: [-3, 3], color: ZONE_COLORS[5] }, // Rest (background)
  { rhrRange: [1.7, 3], hrvRange: [-3, -1], color: ZONE_COLORS[6] }, // REST!
  { rhrRange: [-2, 1.7], hrvRange: [-3, -1], color: ZONE_COLORS[3] }, // LIT!
  { rhrRange: [-3, -2], hrvRange: [0, 3], color: ZONE_COLORS[3] }, // LIT!
  { rhrRange: [-2, 1.7], hrvRange: [-1, 3], color: ZONE_COLORS[4] }, // Normal
  { rhrRange: [-1, 1], hrvRange: [1, 3], color: ZONE_COLORS[1] }, // HIT
];

/** Vertices per rectangle edge when sampling a zone's boundary; enough for the curved edges the polar mapping produces to look smooth. */
const ZONE_EDGE_STEPS = 12;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Samples a (rhr, hrv) rectangle's boundary and maps it through `zScoreToPoint`, producing the SVG points for a curved zone polygon. */
function zonePolygonPoints(rhrRange: [number, number], hrvRange: [number, number]): string {
  const [rhrLo, rhrHi] = rhrRange;
  const [hrvLo, hrvHi] = hrvRange;
  const points: { x: number; y: number }[] = [];

  const walk = (from: number, to: number, fixed: number, varyingRhr: boolean) => {
    for (let i = 0; i <= ZONE_EDGE_STEPS; i++) {
      const value = lerp(from, to, i / ZONE_EDGE_STEPS);
      points.push(varyingRhr ? zScoreToPoint(value, fixed) : zScoreToPoint(fixed, value));
    }
  };

  walk(rhrLo, rhrHi, hrvLo, true); // bottom edge, rhr increasing
  walk(hrvLo, hrvHi, rhrHi, false); // right edge, hrv increasing
  walk(rhrHi, rhrLo, hrvHi, true); // top edge, rhr decreasing
  walk(hrvHi, hrvLo, rhrLo, false); // left edge, hrv decreasing

  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

function renderZones(): string {
  return ZONES.map(
    (zone) => `<polygon points="${zonePolygonPoints(zone.rhrRange, zone.hrvRange)}" fill="${zone.color}" class="gauge-zone" />`,
  ).join('');
}

/** SVG arc path for the ring at a fixed HRV z-score, sweeping across the full RHR range. */
function ringPath(hrvZ: number): string {
  const radius = (RADIUS_OFFSET - clampZ(hrvZ)) * SCALE;
  const start = zScoreToPoint(-Z_LIMIT, hrvZ);
  const end = zScoreToPoint(Z_LIMIT, hrvZ);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/** Faint reference grid: concentric rings per HRV z-score integer, radial spokes per RHR z-score integer. Solid at -3/0/3, dashed in between. */
function renderGrid(): string {
  const steps = [-3, -2, -1, 0, 1, 2, 3];

  const rings = steps
    .map((hrvZ) => {
      const dashed = hrvZ !== -Z_LIMIT && hrvZ !== 0 && hrvZ !== Z_LIMIT;
      return `<path d="${ringPath(hrvZ)}" class="gauge-grid-line" fill="none" ${dashed ? 'stroke-dasharray="2 2"' : ''} />`;
    })
    .join('');

  const spokes = steps
    .map((rhrZ) => {
      const inner = zScoreToPoint(rhrZ, -Z_LIMIT);
      const outer = zScoreToPoint(rhrZ, Z_LIMIT);
      const dashed = rhrZ !== -Z_LIMIT && rhrZ !== 0 && rhrZ !== Z_LIMIT;
      return `<line x1="${inner.x.toFixed(2)}" y1="${inner.y.toFixed(2)}" x2="${outer.x.toFixed(2)}" y2="${outer.y.toFixed(2)}" class="gauge-grid-line" ${dashed ? 'stroke-dasharray="2 2"' : ''} />`;
    })
    .join('');

  return rings + spokes;
}

/**
 * Renders a fading trail of past days' positions, oldest (dimmest, smallest)
 * to most recent (brightest, largest), connected with a dashed line so
 * today's marker reads against where it came from. `trail` is ordered
 * most-recent-first (index 0 = yesterday); days with no HRV data are skipped.
 */
function renderTrail(trail: ZScorePoint[]): string {
  const oldestFirst = [...trail].reverse().filter((p) => !Number.isNaN(p.hrvZ) && !Number.isNaN(p.rhrZ));
  if (oldestFirst.length === 0) return '';

  const points = oldestFirst.map((p) => zScoreToPoint(p.rhrZ, p.hrvZ));
  const [minOpacity, maxOpacity] = TRAIL_OPACITY_RANGE;
  const [minRadius, maxRadius] = TRAIL_RADIUS_RANGE;

  const line = `<polyline points="${points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" class="gauge-trail-line" fill="none" />`;

  const dots = points
    .map((point, i) => {
      const t = points.length > 1 ? i / (points.length - 1) : 1;
      const opacity = minOpacity + t * (maxOpacity - minOpacity);
      const radius = minRadius + t * (maxRadius - minRadius);
      return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius.toFixed(2)}" class="gauge-trail-dot" fill-opacity="${opacity.toFixed(2)}" />`;
    })
    .join('');

  return line + dots;
}

/** Fills the gauge's empty pole (radius = 0 is unreachable, since z-scores are clamped) with today's result color and label, echoing the status badge below the chart. */
function renderCenterBadge(result: ReadinessResult): string {
  return `
    <circle cx="${CENTER_X}" cy="${CENTER_Y}" r="29" fill="${result.color}" class="gauge-center-badge" />
    <text x="${CENTER_X}" y="${CENTER_Y}" text-anchor="middle" dominant-baseline="central" class="gauge-center-label">${result.label}</text>
  `;
}

/** Renders today's marker at its true HRV/RHR position, or nothing if today has no HRV data (code 7). */
function renderToday(today: ZScorePoint, color: string): string {
  if (Number.isNaN(today.hrvZ) || Number.isNaN(today.rhrZ)) return '';

  const { x, y } = zScoreToPoint(today.rhrZ, today.hrvZ);
  return `
    <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="9" class="gauge-today-halo" />
    <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6" fill="${color}" class="gauge-today-dot" />
  `;
}

/**
 * Renders the readiness gauge: colored background zones, a faint reference
 * grid, a fading trail of past days, and today's marker — all positioned by
 * real HRV/RHR z-scores rather than a single discrete zone, so the chart
 * reflects how close to (or far from) a boundary each day actually was.
 *
 * `today` is this app's own z-score pair (kept separate from `result` so the
 * marker is placed on the same continuous scale as the trail). `trail` holds
 * up to a few previous days' z-scores, most-recent-first (index 0 = yesterday).
 */
export function renderGauge(result: ReadinessResult, today: ZScorePoint, trail: ZScorePoint[] = []): string {
  return `
    <svg viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}" class="gauge" role="img" aria-label="Readiness gauge: ${result.label}">
      ${renderZones()}
      ${renderGrid()}
      ${renderTrail(trail)}
      ${renderCenterBadge(result)}
      ${renderToday(today, result.color)}
    </svg>
  `;
}
