import { decryptApiKey, encryptApiKey, type EncryptedApiKey } from './crypto';
import { numberOr } from './settingsCoercion';
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

/**
 * The API key, once unlocked with its passphrase for this browser tab's
 * session. Never written to disk - only ever held here in memory, and only
 * when the stored key is encrypted at all (see `saveSettings`/`unlockApiKey`).
 */
let unlockedApiKey: string | null = null;

interface StoredSettingsJson extends Partial<Omit<Settings, 'apiKey'>> {
  apiKey?: string;
  apiKeyEncrypted?: EncryptedApiKey;
  /** Old shape of `trendValueLabels`, a plain checkbox - migrated below. */
  showValuesInTrendCharts?: boolean;
}

function readStoredJson(): StoredSettingsJson | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSettingsJson;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const parsed = readStoredJson();
  if (!parsed) return { ...DEFAULT_SETTINGS };

  // `showValuesInTrendCharts` was this setting's old shape, a plain checkbox -
  // read it for anyone with that still in storage, so an explicit "off"
  // survives becoming the new picker's "none" instead of silently resetting.
  // Checked against `parsed` (what was actually stored), not `merged` (which
  // the spread below has already back-filled with a VALID default even when
  // the key was missing, so a validity check against `merged` alone can
  // never tell "absent" from "present and fine").
  const merged = { ...DEFAULT_SETTINGS, ...parsed };
  if (!HRV_METRIC_DISPLAY_VALUES.includes(merged.hrvMetricsToShow)) {
    merged.hrvMetricsToShow = DEFAULT_SETTINGS.hrvMetricsToShow;
  }
  if (parsed.trendValueLabels === undefined) {
    merged.trendValueLabels = parsed.showValuesInTrendCharts === false ? 'none' : DEFAULT_SETTINGS.trendValueLabels;
  } else if (!TREND_VALUE_LABELS_VALUES.includes(merged.trendValueLabels)) {
    merged.trendValueLabels = DEFAULT_SETTINGS.trendValueLabels;
  }

  // `JSON.parse` gives no runtime guarantee these are actually numbers - a
  // hand-edited or corrupted localStorage value would otherwise flow straight
  // into an HTML attribute later. Same rule the settings form's save path
  // already applies (see `readSettingsForm` in ui.ts).
  merged.daysForShortTermTrend = numberOr(parsed.daysForShortTermTrend, DEFAULT_SETTINGS.daysForShortTermTrend);
  merged.daysForLongTermTrend = numberOr(parsed.daysForLongTermTrend, DEFAULT_SETTINGS.daysForLongTermTrend);
  merged.stdDevMultiplier = numberOr(parsed.stdDevMultiplier, DEFAULT_SETTINGS.stdDevMultiplier);

  if (parsed.apiKeyEncrypted) {
    merged.apiKey = unlockedApiKey ?? '';
  }

  return merged;
}

/** True once per browser tab session until `unlockApiKey` succeeds, if and only if the stored key is encrypted at all. */
export function isApiKeyLocked(): boolean {
  return Boolean(readStoredJson()?.apiKeyEncrypted) && unlockedApiKey === null;
}

/** Whether the currently stored API key is encrypted, regardless of whether it's unlocked yet - used to preset the settings form's checkbox. */
export function isApiKeyEncrypted(): boolean {
  return Boolean(readStoredJson()?.apiKeyEncrypted);
}

/** Decrypts the stored API key with `passphrase` and caches it in memory for the rest of this browser tab's session. Throws on an incorrect passphrase. */
export async function unlockApiKey(passphrase: string): Promise<void> {
  const encrypted = readStoredJson()?.apiKeyEncrypted;
  if (!encrypted) return;
  unlockedApiKey = await decryptApiKey(encrypted, passphrase);
}

/**
 * Saves settings to localStorage. When `passphrase` is given, the API key is
 * encrypted at rest with it instead of stored as plain text; otherwise
 * everything is stored as before. The passphrase itself is never persisted.
 */
export async function saveSettings(settings: Settings, passphrase?: string): Promise<void> {
  if (passphrase) {
    const apiKeyEncrypted = await encryptApiKey(settings.apiKey, passphrase);
    const stored: StoredSettingsJson = { ...settings, apiKeyEncrypted };
    delete stored.apiKey;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    unlockedApiKey = null;
  }
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
  unlockedApiKey = null;
}

export function isConfigured(settings: Settings): boolean {
  return REQUIRED_FIELDS.every((field) => settings[field].toString().trim().length > 0);
}

/** Field-by-field equality, used to skip an unnecessary dashboard refetch when Settings is closed without any real change. */
export function settingsEqual(a: Settings, b: Settings): boolean {
  return (Object.keys(a) as (keyof Settings)[]).every((key) => a[key] === b[key]);
}
