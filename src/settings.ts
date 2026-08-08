import type { HrvMetricDisplay, Settings } from './types';

const STORAGE_KEY = 'goready.settings';
const HRV_METRIC_DISPLAY_VALUES: HrvMetricDisplay[] = ['rmssd', 'sdnn', 'both'];

export const DEFAULT_SETTINGS: Settings = {
  athleteId: '',
  apiKey: '',
  proxyUrl: './proxy.php',
  sendTrainingAdvice: true,
  daysForShortTermTrend: 7,
  daysForLongTermTrend: 60,
  stdDevMultiplier: 0.75,
  showValuesInTrendCharts: true,
  fieldRHR: 'restingHR',
  fieldRMSSD: 'hrv',
  fieldSDNN: 'hrvSDNN',
  hrvMetricsToShow: 'both',
};

/** Required fields without which the app cannot call intervals.icu. */
const REQUIRED_FIELDS: (keyof Settings)[] = ['athleteId', 'apiKey', 'proxyUrl'];

export function loadSettings(): Settings {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };

  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (!HRV_METRIC_DISPLAY_VALUES.includes(merged.hrvMetricsToShow)) {
      merged.hrvMetricsToShow = DEFAULT_SETTINGS.hrvMetricsToShow;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearSettings(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function isConfigured(settings: Settings): boolean {
  return REQUIRED_FIELDS.every((field) => settings[field].toString().trim().length > 0);
}
