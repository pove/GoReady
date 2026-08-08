import { ZONE_COLORS } from './score';
import type { ReadinessCode, ReadinessResult } from './types';

/** Readiness codes placed left (worst) to right (best) along the gauge arc. */
const GAUGE_ORDER: ReadinessCode[] = [6, 5, 3, 2, 4, 1];

const CENTER_X = 110;
const CENTER_Y = 112;
const ARC_RADIUS = 82;
const ARC_STROKE_WIDTH = 26;
const NEEDLE_LENGTH = 66;
const SEGMENT_GAP_DEG = 1.2;

function polarPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: CENTER_X + radius * Math.cos(angleRad), y: CENTER_Y + radius * Math.sin(angleRad) };
}

/** The gauge sweeps a half-circle: 180deg (left) through 270deg (top) to 360deg (right). */
function segmentAngles(index: number, total: number): { start: number; end: number } {
  return { start: 180 + (index / total) * 180, end: 180 + ((index + 1) / total) * 180 };
}

function arcPath(startAngle: number, endAngle: number, radius: number): string {
  const start = polarPoint(startAngle, radius);
  const end = polarPoint(endAngle, radius);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function renderZones(): string {
  return GAUGE_ORDER.map((code, i) => {
    const { start, end } = segmentAngles(i, GAUGE_ORDER.length);
    const path = arcPath(start + SEGMENT_GAP_DEG, end - SEGMENT_GAP_DEG, ARC_RADIUS);
    return `<path d="${path}" stroke="${ZONE_COLORS[code]}" stroke-width="${ARC_STROKE_WIDTH}" fill="none" stroke-linecap="round" />`;
  }).join('');
}

function renderNeedle(code: ReadinessCode): string {
  const index = GAUGE_ORDER.indexOf(code);
  if (index === -1) return ''; // code 7 (no data): omit the needle entirely.

  const { start, end } = segmentAngles(index, GAUGE_ORDER.length);
  const tip = polarPoint((start + end) / 2, NEEDLE_LENGTH);
  return `
    <line x1="${CENTER_X}" y1="${CENTER_Y}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}"
          stroke="#1f2937" stroke-width="4" stroke-linecap="round" />
    <circle cx="${CENTER_X}" cy="${CENTER_Y}" r="7" fill="#1f2937" />
  `;
}

export function renderGauge(result: ReadinessResult): string {
  return `
    <svg viewBox="0 0 220 130" class="gauge" role="img" aria-label="Readiness gauge: ${result.label}">
      ${renderZones()}
      ${renderNeedle(result.code)}
    </svg>
  `;
}
