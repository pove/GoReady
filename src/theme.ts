export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'goready.theme';

/** system -> light -> dark -> system */
const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

export function loadTheme(): ThemePreference {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

function saveTheme(theme: ThemePreference): void {
  if (theme === 'system') {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

/** Applies the theme to the document. 'system' clears the override and lets prefers-color-scheme decide. */
export function applyTheme(theme: ThemePreference): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

/** Advances to the next theme in the cycle, persisting and applying it. */
export function cycleTheme(current: ThemePreference): ThemePreference {
  const next = NEXT_THEME[current];
  saveTheme(next);
  applyTheme(next);
  return next;
}
