import { CONTEXT_FIELDS, TRAINING_ADVICE_FIELD } from './constants';
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
  // Any column the response happens not to carry parses to NaN, which is how the
  // rest of the app already spells "no measurement". That is what lets the
  // optional context columns be requested optimistically.
  const rows = parseTable(csvText).map((row) => ({
    date: row.date ?? '',
    rhr: toNumber(row[settings.fieldRHR]),
    rmssd: toNumber(row[settings.fieldRMSSD]),
    sdnn: toNumber(row[settings.fieldSDNN]),
    trainingAdvice: (row[TRAINING_ADVICE_FIELD] ?? '').trim(),
    ctl: toNumber(row[CONTEXT_FIELDS.ctl]),
    atl: toNumber(row[CONTEXT_FIELDS.atl]),
    rampRate: toNumber(row[CONTEXT_FIELDS.rampRate]),
    sleepSecs: toNumber(row[CONTEXT_FIELDS.sleepSecs]),
    sleepScore: toNumber(row[CONTEXT_FIELDS.sleepScore]),
  }));

  return rows
    .filter((row) => row.date.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}
