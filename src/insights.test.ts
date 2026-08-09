import { describe, expect, it } from 'vitest';
import { buildInsights, readinessConfidence, trainingPhaseNote, type Insight } from './insights';
import { DEFAULT_SETTINGS } from './settings';
import { wellnessSeries } from './testFixtures';
import type { ReadinessCode, Settings, WellnessRow } from './types';

describe('trainingPhaseNote', () => {
  it('flags "optimum pre-race" when RHR is mildly up and HRV is still strong', () => {
    expect(trainingPhaseNote(4, 0.8, 0.7)).toMatch(/optimum pre-race/);
    expect(trainingPhaseNote(1, 1.2, 0.6)).toMatch(/optimum pre-race/);
  });

  it('flags "not coping well" when RHR is mildly up but HRV has slipped', () => {
    expect(trainingPhaseNote(4, 0.2, 0.7)).toMatch(/may not be coping well/);
  });

  it('flags "coping well during training blocks" when RHR is calm and HRV is strong', () => {
    expect(trainingPhaseNote(4, 0.8, -0.7)).toMatch(/coping well/);
  });

  it('gives no note when RHR is exactly at baseline (neither activated nor calm)', () => {
    expect(trainingPhaseNote(4, 2, 0)).toBeNull();
  });

  // Regression: a barely-positive rhrZ (statistical noise, not a real
  // deviation) used to still trigger "Resting HR is up" - a claim that
  // contradicted the gauge, which shows a point sitting right on the
  // baseline. Any |rhrZ| at or below MIN_ACTIVATION must give no note,
  // regardless of how low hrvZ is.
  it('gives no note when RHR is only trivially off baseline, even with weak HRV', () => {
    expect(trainingPhaseNote(4, 0.1, 0.05)).toBeNull();
    expect(trainingPhaseNote(4, 0.1, -0.05)).toBeNull();
    expect(trainingPhaseNote(4, 0.1, 0.5)).toBeNull(); // exactly at the floor, not past it
    expect(trainingPhaseNote(4, 2, -0.5)).toBeNull();
  });

  it('gives no note when RHR is calm but HRV has not recovered', () => {
    expect(trainingPhaseNote(4, 0.1, -0.7)).toBeNull();
  });

  it('gives no note once RHR is past the hatched band, even if still classified Normal', () => {
    expect(trainingPhaseNote(4, 2, 1.6)).toBeNull();
  });

  it('only refines HIT (1) and Normal (4); every other code is left alone', () => {
    for (const code of [2, 3, 5, 6, 7] as const) {
      expect(trainingPhaseNote(code, 2, 0.5)).toBeNull();
    }
  });

  it('gives no note when either z-score is NaN', () => {
    expect(trainingPhaseNote(4, NaN, 0.5)).toBeNull();
    expect(trainingPhaseNote(4, 0.5, NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const HISTORY_DAYS = 90;

/** Small deterministic wobble, so a series has a real standard deviation without being random. */
function wobble(daysAgo: number, amplitude = 1): number {
  return Math.sin(daysAgo * 1.7) * amplitude;
}

interface SeriesOptions {
  /** rMSSD for the most recent 7 days; older days sit at `baselineRmssd`. */
  recentRmssd?: number;
  baselineRmssd?: number;
  recentRhr?: number;
  baselineRhr?: number;
  recentAmplitude?: number;
  extras?: Partial<WellnessRow>;
}

function series(options: SeriesOptions = {}): WellnessRow[] {
  const {
    recentRmssd = 50,
    baselineRmssd = 50,
    recentRhr = 50,
    baselineRhr = 50,
    recentAmplitude = 1,
    extras = {},
  } = options;

  return wellnessSeries(HISTORY_DAYS, (daysAgo) => {
    const recent = daysAgo < 7;
    return {
      rmssd: (recent ? recentRmssd : baselineRmssd) + wobble(daysAgo, recent ? recentAmplitude : 1),
      rhr: (recent ? recentRhr : baselineRhr) + wobble(daysAgo, recent ? recentAmplitude : 1),
      ...(recent ? extras : {}),
    };
  });
}

function insightsFor(rows: WellnessRow[], code: ReadinessCode = 4, settings: Settings = DEFAULT_SETTINGS): Insight[] {
  return buildInsights({ code, hrvZ: 0, rhrZ: 0, rows, settings, confidence: readinessConfidence(rows) });
}

const idsOf = (insights: Insight[]) => insights.map((i) => i.id);
const find = (insights: Insight[], id: string) => insights.find((i) => i.id === id);

describe('buildInsights: the 7-day mean against the smallest worthwhile change', () => {
  it('cautions when the weekly average drops below the baseline by more than the SWC', () => {
    const insight = find(insightsFor(series({ recentRmssd: 38 })), 'swc-below');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('caution');
    expect(insight!.text).toMatch(/7-day rMSSD average is about \d+% below your 60-day baseline/);
    // The point of the rule: it separates a trend from a single bad morning.
    expect(insight!.text).toMatch(/loading response rather than one bad night/);
  });

  it('reports a rise above the SWC as good news, not a warning', () => {
    const insight = find(insightsFor(series({ recentRmssd: 68 })), 'swc-above');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('positive');
  });

  it('says the week is normal when it sits inside the band', () => {
    const insight = find(insightsFor(series()), 'swc-stable');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('positive');
  });

  it('stays quiet without enough history to have a baseline', () => {
    const short = wellnessSeries(12, (daysAgo) => ({ rmssd: 50 + wobble(daysAgo), rhr: 50 + wobble(daysAgo) }));
    expect(idsOf(insightsFor(short))).not.toContain('swc-stable');
  });

  // The percentage is recoverable exactly, because the 20x ln scaling means the
  // difference of two means is 20 * ln(ratio).
  it('reports a percentage that matches the underlying ratio', () => {
    const insight = find(insightsFor(series({ recentRmssd: 25, baselineRmssd: 50 })), 'swc-below');
    expect(insight!.text).toMatch(/about 4[0-9]% below/);
  });
});

describe('buildInsights: coefficient of variation', () => {
  it('cautions when the week swings around far more than the athlete usually does', () => {
    const insight = find(insightsFor(series({ recentAmplitude: 14 })), 'cv-widened');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('caution');
    expect(insight!.text).toMatch(/before the average moves/);
  });

  it('cautions when the week is unusually flat AND suppressed', () => {
    const insight = find(insightsFor(series({ recentRmssd: 32, recentAmplitude: 0.02 })), 'cv-collapsed');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('caution');
  });

  // Flat on its own is not a finding - it is the normal state of a settled athlete.
  it('says nothing about a flat week whose average is where it should be', () => {
    expect(idsOf(insightsFor(series({ recentAmplitude: 0.02 })))).not.toContain('cv-collapsed');
  });
});

describe('buildInsights: streaks outside the expected range', () => {
  it('counts consecutive days and names the metric', () => {
    const insight = find(insightsFor(series({ recentRhr: 62 })), 'streak-resting-hr-above');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('caution');
    expect(insight!.text).toMatch(/Resting HR has been above its expected range \d+ days running/);
  });

  it('treats a run in the reassuring direction as a note, not a caution', () => {
    const insight = find(insightsFor(series({ recentRhr: 40 })), 'streak-resting-hr-below');
    expect(insight?.tone).toBe('note');
  });
});

describe('buildInsights: reading HRV and resting HR together', () => {
  // Altini: HRV would normally rise as resting HR falls, so both falling is a
  // pattern in its own right - a low resting HR here is not the good news it looks.
  it('flags both metrics sitting below baseline at once', () => {
    const insight = find(insightsFor(series({ recentRmssd: 42, recentRhr: 46 })), 'coupling');
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe('caution');
    expect(insight!.text).toMatch(/HRV would normally rise as resting HR falls/);
  });

  it('only names parasympathetic saturation when load is actually ramping', () => {
    const withRamp = insightsFor(series({ recentRmssd: 42, recentRhr: 46, extras: { rampRate: 9 } }));
    const insight = find(withRamp, 'coupling-under-load');
    expect(insight!.text).toMatch(/\+9\.0 per week/);
    expect(insight!.text).toMatch(/parasympathetic saturation/);

    // Without the load data the claim is not made.
    const withoutRamp = find(insightsFor(series({ recentRmssd: 42, recentRhr: 46 })), 'coupling');
    expect(withoutRamp!.text).not.toMatch(/parasympathetic saturation/);
  });

  it('says nothing when only one of the two has moved', () => {
    expect(idsOf(insightsFor(series({ recentRhr: 46 })))).not.toContain('coupling');
  });
});

// Regression: the readiness code goes to 7 ("No HRV data today") specifically
// when today's own reading is missing, but swcRule/cvRule/couplingRule computed
// their 7-day windows tolerating gaps ANYWHERE in the window - including at
// today - so they could still fire right below that headline. artifactRule
// already guarded on today's own value; the other three didn't.
describe('buildInsights: no reading yet today', () => {
  /** A week that would clearly trigger swc/cv/coupling insights, except today's HRV is missing. */
  const missingToday = (overrides: SeriesOptions = {}) => {
    const rows = series({ recentRmssd: 30, recentRhr: 44, recentAmplitude: 14, ...overrides });
    return rows.map((row, i) => (i === 0 ? { ...row, rmssd: NaN } : row));
  };

  it('withholds the 7-day-average insight without today\'s own reading', () => {
    const ids = idsOf(insightsFor(missingToday()));
    expect(ids).not.toContain('swc-below');
    expect(ids).not.toContain('swc-above');
    expect(ids).not.toContain('swc-stable');
  });

  it('withholds the coefficient-of-variation insight without today\'s own reading', () => {
    const ids = idsOf(insightsFor(missingToday()));
    expect(ids).not.toContain('cv-widened');
    expect(ids).not.toContain('cv-collapsed');
  });

  it('withholds the HRV/RHR coupling insight without today\'s own HRV reading', () => {
    expect(idsOf(insightsFor(missingToday()))).not.toContain('coupling');
  });

  it('still fires normally once today has a reading', () => {
    expect(idsOf(insightsFor(series({ recentRmssd: 30 })))).toContain('swc-below');
  });
});

describe('buildInsights: context for a poor reading', () => {
  it('offers a short night as context', () => {
    const rows = series({ recentRmssd: 38, extras: { sleepSecs: 4.5 * 3600 } });
    expect(find(insightsFor(rows), 'context-sleep')!.text).toMatch(/4\.5 hours of sleep/);
  });

  it('offers a hard ramp as context', () => {
    const rows = series({ recentRmssd: 38, extras: { rampRate: 8.4 } });
    expect(find(insightsFor(rows), 'context-ramp')!.text).toMatch(/\+8\.4 per week/);
  });

  it('falls back to the acute:chronic ratio only when rampRate is absent', () => {
    const rows = series({ recentRmssd: 38, extras: { ctl: 50, atl: 80 } });
    expect(find(insightsFor(rows), 'context-acwr')!.text).toMatch(/1\.60x your chronic load/);
  });

  // Context explains bad news; on a good day it would just be noise.
  it('stays quiet when nothing is wrong', () => {
    const rows = series({ extras: { sleepSecs: 4.5 * 3600, rampRate: 8.4 } });
    expect(idsOf(insightsFor(rows)).filter((id) => id.startsWith('context-'))).toEqual([]);
  });

  it('stays quiet when the fields are absent', () => {
    expect(idsOf(insightsFor(series({ recentRmssd: 38 }))).filter((id) => id.startsWith('context-'))).toEqual([]);
  });
});

describe('buildInsights: ranking', () => {
  it('caps the list and puts the worst news first', () => {
    const rows = series({
      recentRmssd: 34,
      recentRhr: 44,
      recentAmplitude: 12,
      extras: { rampRate: 9, sleepSecs: 4 * 3600 },
    });
    const insights = insightsFor(rows);

    expect(insights.length).toBeLessThanOrEqual(3);
    expect(insights[0].tone).toBe('caution');
    expect(insights[0].id).toBe('coupling-under-load');
    expect(insights.map((i) => i.tone)).toEqual([...insights.map((i) => i.tone)].sort());
  });
});

describe('buildInsights: which HRV metric it talks about', () => {
  const sdnnOnly = wellnessSeries(HISTORY_DAYS, (daysAgo) => ({
    rhr: 50 + wobble(daysAgo),
    sdnn: (daysAgo < 7 ? 38 : 50) + wobble(daysAgo),
  }));

  // An SDNN-only setup used to show healthy trend charts beside a permanent
  // "No HRV data today". The score is still rMSSD-only, but the insights are not.
  it('talks about SDNN when rMSSD is the metric that is missing', () => {
    const insight = find(insightsFor(sdnnOnly, 7), 'swc-below');
    expect(insight!.text).toMatch(/7-day SDNN average/);
  });

  it('honours an explicit rMSSD-only display choice even so', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, hrvMetricsToShow: 'rmssd' };
    expect(idsOf(insightsFor(sdnnOnly, 7, settings))).not.toContain('swc-below');
  });
});

describe('buildInsights: a reading that looks like a bad capture', () => {
  /**
   * A month of realistic day-to-day variation (about 8% CV, as the HRV
   * literature reports), with `bad` implausible mornings at the front.
   */
  const withArtifacts = (todayRmssd: number, bad = 1) =>
    wellnessSeries(HISTORY_DAYS, (daysAgo) => ({
      rhr: 50 + wobble(daysAgo),
      rmssd: daysAgo < bad ? todayRmssd : 50 + wobble(daysAgo, 4),
    }));

  it('flags a reading far outside the recent range, and ranks it first', () => {
    const insights = insightsFor(withArtifacts(6));
    expect(insights[0].id).toBe('artifact');
    expect(insights[0].text).toMatch(/sit in your baseline for the next 30 days/);
  });

  it('flags an implausibly high reading too, not just a low one', () => {
    expect(idsOf(insightsFor(withArtifacts(400)))).toContain('artifact');
  });

  it('leaves an ordinary bad morning alone', () => {
    expect(idsOf(insightsFor(withArtifacts(44)))).not.toContain('artifact');
  });

  // A steady athlete has a tiny spread, and against a tiny spread even a modest
  // dip clears the outlier cut-off. "Bad capture" is too strong a claim there,
  // which is what the absolute floor is for.
  it('does not call a modest dip an artifact just because the athlete is steady', () => {
    const steady = wellnessSeries(HISTORY_DAYS, (daysAgo) => ({
      rhr: 50 + wobble(daysAgo),
      rmssd: daysAgo === 0 ? 44 : 50 + wobble(daysAgo, 0.4),
    }));
    expect(idsOf(insightsFor(steady))).not.toContain('artifact');
  });

  // An artifact is an isolated bad capture. A week that has genuinely moved is
  // a real shift, and the 7-day rules are the ones that should describe it.
  it('does not call a sustained shift an artifact', () => {
    const ids = idsOf(insightsFor(withArtifacts(30, 7)));
    expect(ids).not.toContain('artifact');
    expect(ids).toContain('swc-below');
  });
});

describe('buildInsights: the phase note against a thin baseline', () => {
  const twoDays = wellnessSeries(2, (daysAgo) => ({
    rmssd: daysAgo === 0 ? 95 : 40,
    rhr: daysAgo === 0 ? 44 : 52,
  }));

  // With two days the z-scores are pinned to +-1 whatever the readings are, so
  // "HRV is strong" would be an unsupported claim sitting right under a badge
  // saying the baseline cannot support claims.
  it('withholds the note entirely when the baseline is unusable', () => {
    const insights = buildInsights({
      code: 4,
      hrvZ: 1,
      rhrZ: -1,
      rows: twoDays,
      settings: DEFAULT_SETTINGS,
      confidence: readinessConfidence(twoDays),
    });
    expect(idsOf(insights)).not.toContain('phase-note');
  });

  it('still makes the note on a baseline that can support it', () => {
    const rows = series();
    const insights = buildInsights({
      code: 4,
      hrvZ: 1,
      rhrZ: -1,
      rows,
      settings: DEFAULT_SETTINGS,
      confidence: readinessConfidence(rows),
    });
    expect(idsOf(insights)).toContain('phase-note');
  });
});

describe('readinessConfidence', () => {
  it('keeps both metrics, and reports the weaker one as `overall`', () => {
    const rows = wellnessSeries(30, (daysAgo) => ({
      rhr: 50 + wobble(daysAgo),
      rmssd: daysAgo < 3 ? 50 : NaN, // plenty of RHR, almost no HRV
    }));
    const confidence = readinessConfidence(rows);
    expect(confidence.hrv).toMatchObject({ validDays: 3, tier: 'unusable' });
    expect(confidence.rhr).toMatchObject({ validDays: 30, tier: 'ok' });
    expect(confidence.overall).toMatchObject({ validDays: 3, tier: 'unusable' });
  });

  it('is satisfied by a full month of both', () => {
    expect(readinessConfidence(series()).overall).toMatchObject({ validDays: 30, tier: 'ok' });
  });
});
