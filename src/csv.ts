import type { Settings, WellnessRow } from './types';

/** Parses a simple comma-separated table (as returned by intervals.icu) into header/row records. */
function parseTable(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function toNumber(value: string | undefined): number {
  if (!value) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parses intervals.icu's wellness.csv response into typed rows, sorted newest first.
 * Sorting is done explicitly rather than trusting API order.
 */
export function parseWellnessCsv(csvText: string, settings: Settings): WellnessRow[] {
  const rows = parseTable(csvText).map((row) => ({
    date: row.date ?? '',
    rhr: toNumber(row[settings.fieldRHR]),
    rmssd: toNumber(row[settings.fieldRMSSD]),
    sdnn: toNumber(row[settings.fieldSDNN]),
  }));

  return rows
    .filter((row) => row.date.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}
