import { describe, expect, it } from 'vitest';
import { parseWellnessCsv } from './csv';
import { DEFAULT_SETTINGS } from './settings';

const settings = DEFAULT_SETTINGS;

describe('parseWellnessCsv', () => {
  it('parses rows and maps the configured field names', () => {
    const csv = [
      'date,restingHR,hrv,hrvSDNN,TrainingAdvice',
      '2026-08-01,52,80,60,3',
      '2026-08-02,54,75,58,',
    ].join('\n');

    const rows = parseWellnessCsv(csv, settings);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-02', rhr: 54, rmssd: 75, sdnn: 58, trainingAdvice: '' });
    expect(rows[1]).toMatchObject({ date: '2026-08-01', rhr: 52, rmssd: 80, sdnn: 60, trainingAdvice: '3' });
  });

  it('sorts newest first regardless of input order', () => {
    const csv = [
      'date,restingHR,hrv,hrvSDNN,TrainingAdvice',
      '2026-08-01,50,70,55,',
      '2026-08-03,50,70,55,',
      '2026-08-02,50,70,55,',
    ].join('\n');

    const rows = parseWellnessCsv(csv, settings);

    expect(rows.map((r) => r.date)).toEqual(['2026-08-03', '2026-08-02', '2026-08-01']);
  });

  it('turns missing or non-numeric cells into NaN instead of dropping the row', () => {
    const csv = ['date,restingHR,hrv,hrvSDNN,TrainingAdvice', '2026-08-01,,--,60,'].join('\n');

    const rows = parseWellnessCsv(csv, settings);

    expect(rows).toHaveLength(1);
    expect(rows[0].rhr).toBeNaN();
    expect(rows[0].rmssd).toBeNaN();
    expect(rows[0].sdnn).toBe(60);
  });

  it('drops rows without a date', () => {
    const csv = ['date,restingHR,hrv,hrvSDNN,TrainingAdvice', ',50,70,55,'].join('\n');

    expect(parseWellnessCsv(csv, settings)).toHaveLength(0);
  });

  it('returns an empty array for a header-only or empty response', () => {
    expect(parseWellnessCsv('date,restingHR,hrv,hrvSDNN,TrainingAdvice', settings)).toEqual([]);
    expect(parseWellnessCsv('', settings)).toEqual([]);
  });

  it('respects custom wellness field names from settings', () => {
    const csv = ['date,rhr_custom,rmssd_custom,TrainingAdvice', '2026-08-01,48,65,'].join('\n');
    const customSettings = { ...settings, fieldRHR: 'rhr_custom', fieldRMSSD: 'rmssd_custom' };

    const rows = parseWellnessCsv(csv, customSettings);

    expect(rows[0].rhr).toBe(48);
    expect(rows[0].rmssd).toBe(65);
  });
});
