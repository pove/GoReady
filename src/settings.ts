import type { HrvMetricDisplay, Settings, TrendValueLabels } from './types';

const STORAGE_KEY = 'goready.settings';
const HRV_METRIC_DISPLAY_VALUES: HrvMetricDisplay[] = ['rmssd', 'sdnn', 'both'];
const TREND_VALUE_LABELS_VALUES: TrendValueLabels[] = ['none', 'minimal', 'all'];

export const DEFAULT_SETTINGS: Settings = {
  athleteId: '',
  apiKey: '',
  proxyUrl: './proxy.php',
  sendTrainingAdvice: true,
  daysForShortTermTrend: 7,
  daysForLongTermTrend: 60,
  stdDevMultiplier: 0.75,
  trendValueLabels: 'all',
  fieldRHR: 'restingHR',
  fieldRMSSD: 'hrv',
  fieldSDNN: 'hrvSDNN',
  hrvMetricsToShow: 'both',
};

/** Required fields without which the app cannot call intervals.icu. */
const REQUIRED_FIELDS: (keyof Settings)[] = ['athleteId', 'apiKey', 'proxyUrl'];

export function loadSettings(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };

  try {
    // `showValuesInTrendCharts` was this setting's old shape, a plain checkbox -
    // read it for anyone with that still in storage, so an explicit "off"
    // survives becoming the new picker's "none" instead of silently resetting.
    // Checked against `parsed` (what was actually stored), not `merged` (which
    // the spread below has already back-filled with a VALID default even when
    // the key was missing, so a validity check against `merged` alone can
    // never tell "absent" from "present and fine").
    const parsed = JSON.parse(raw) as Partial<Settings> & { showValuesInTrendCharts?: boolean };
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (!HRV_METRIC_DISPLAY_VALUES.includes(merged.hrvMetricsToShow)) {
      merged.hrvMetricsToShow = DEFAULT_SETTINGS.hrvMetricsToShow;
    }
    if (parsed.trendValueLabels === undefined) {
      merged.trendValueLabels = parsed.showValuesInTrendCharts === false ? 'none' : DEFAULT_SETTINGS.trendValueLabels;
    } else if (!TREND_VALUE_LABELS_VALUES.includes(merged.trendValueLabels)) {
      merged.trendValueLabels = DEFAULT_SETTINGS.trendValueLabels;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isConfigured(settings: Settings): boolean {
  return REQUIRED_FIELDS.every((field) => settings[field].toString().trim().length > 0);
}
