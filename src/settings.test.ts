import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSettings,
  DEFAULT_SETTINGS,
  isApiKeyEncrypted,
  isApiKeyLocked,
  loadSettings,
  saveSettings,
  settingsEqual,
  unlockApiKey,
} from './settings';

/**
 * Vitest's default (non-browser) environment has no `localStorage` global.
 * A minimal in-memory stand-in is enough for these tests and avoids pulling in
 * a DOM environment (jsdom) as a dependency just for this one file.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

globalThis.localStorage ??= new MemoryStorage();

describe('loadSettings', () => {
  beforeEach(() => clearSettings());
  afterEach(() => clearSettings());

  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips whatever was saved', () => {
    const settings = { ...DEFAULT_SETTINGS, athleteId: 'i123', trendValueLabels: 'minimal' as const };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  // Regression: `trendValueLabels` replaced the old boolean
  // `showValuesInTrendCharts` checkbox. A first attempt at this migration
  // checked the ALREADY-DEFAULTED merged value rather than what was actually
  // in storage - since the default ('all') is itself a valid value, that
  // check could never tell "key absent" from "key present and fine", so the
  // migration silently never ran and an explicit "off" was lost.
  describe('migrating the old showValuesInTrendCharts checkbox', () => {
    it('carries an explicit "off" over as "none"', () => {
      localStorage.setItem('goready.settings', JSON.stringify({ showValuesInTrendCharts: false }));
      expect(loadSettings().trendValueLabels).toBe('none');
    });

    it('defaults to "all" when the old setting was on', () => {
      localStorage.setItem('goready.settings', JSON.stringify({ showValuesInTrendCharts: true }));
      expect(loadSettings().trendValueLabels).toBe('all');
    });

    it('defaults to "all" when neither the old nor new field was ever stored', () => {
      localStorage.setItem('goready.settings', JSON.stringify({ athleteId: 'i123' }));
      expect(loadSettings().trendValueLabels).toBe('all');
    });

    it('leaves an explicitly stored value alone rather than re-migrating it', () => {
      localStorage.setItem(
        'goready.settings',
        JSON.stringify({ trendValueLabels: 'minimal', showValuesInTrendCharts: false }),
      );
      expect(loadSettings().trendValueLabels).toBe('minimal');
    });

    it('falls back to the default on a corrupted value', () => {
      localStorage.setItem('goready.settings', JSON.stringify({ trendValueLabels: 'bogus' }));
      expect(loadSettings().trendValueLabels).toBe('all');
    });
  });

  it('falls back to the default HRV metric display on a corrupted value', () => {
    localStorage.setItem('goready.settings', JSON.stringify({ hrvMetricsToShow: 'bogus' }));
    expect(loadSettings().hrvMetricsToShow).toBe('both');
  });

  it('falls back to the defaults entirely on unparsable JSON', () => {
    localStorage.setItem('goready.settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  // Regression: `readSettingsForm` (ui.ts, the save path) already coerced these
  // three fields to real numbers, but `loadSettings` (the load path) trusted
  // whatever JSON.parse handed back - a hand-edited or corrupted localStorage
  // value flowed straight into an HTML attribute unescaped.
  describe('numeric field coercion', () => {
    it('falls back to defaults when the trend/std-dev fields are not usable numbers', () => {
      localStorage.setItem(
        'goready.settings',
        JSON.stringify({ daysForShortTermTrend: 'nope', daysForLongTermTrend: -5, stdDevMultiplier: '<img>' }),
      );
      const settings = loadSettings();
      expect(settings.daysForShortTermTrend).toBe(DEFAULT_SETTINGS.daysForShortTermTrend);
      expect(settings.daysForLongTermTrend).toBe(DEFAULT_SETTINGS.daysForLongTermTrend);
      expect(settings.stdDevMultiplier).toBe(DEFAULT_SETTINGS.stdDevMultiplier);
    });

    it('keeps a legitimately stored numeric value', () => {
      localStorage.setItem('goready.settings', JSON.stringify({ daysForShortTermTrend: 14, stdDevMultiplier: 1.5 }));
      const settings = loadSettings();
      expect(settings.daysForShortTermTrend).toBe(14);
      expect(settings.stdDevMultiplier).toBe(1.5);
    });
  });
});

describe('API key encryption', () => {
  beforeEach(() => clearSettings());
  afterEach(() => clearSettings());

  it('is not locked and not encrypted when nothing is stored', () => {
    expect(isApiKeyEncrypted()).toBe(false);
    expect(isApiKeyLocked()).toBe(false);
  });

  it('stores the key encrypted, locked until unlocked with the right passphrase', async () => {
    const settings = { ...DEFAULT_SETTINGS, athleteId: 'i1', apiKey: 'plaintext-key' };
    await saveSettings(settings, 'my-passphrase');

    expect(isApiKeyEncrypted()).toBe(true);
    expect(isApiKeyLocked()).toBe(true);
    expect(loadSettings().apiKey).toBe('');

    await unlockApiKey('my-passphrase');
    expect(isApiKeyLocked()).toBe(false);
    expect(loadSettings().apiKey).toBe('plaintext-key');
  });

  it('never writes the plaintext key to storage once encryption is on', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'plaintext-key' }, 'my-passphrase');
    expect(localStorage.getItem('goready.settings')).not.toContain('plaintext-key');
  });

  it('stays locked on a wrong passphrase, and does not throw from isApiKeyLocked', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'plaintext-key' }, 'right-passphrase');
    await expect(unlockApiKey('wrong-passphrase')).rejects.toThrow('Incorrect passphrase.');
    expect(isApiKeyLocked()).toBe(true);
  });

  it('saving without a passphrase stores the key as plain text again', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'plaintext-key' }, 'a-passphrase');
    await saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'plaintext-key' });
    expect(isApiKeyEncrypted()).toBe(false);
    expect(loadSettings().apiKey).toBe('plaintext-key');
  });
});

describe('settingsEqual', () => {
  it('is true for two structurally identical settings objects', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(true);
  });

  it('is false when any single field differs', () => {
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, athleteId: 'changed' })).toBe(false);
    expect(settingsEqual(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, stdDevMultiplier: 9 })).toBe(false);
  });
});
