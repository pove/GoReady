import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

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
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

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
});
