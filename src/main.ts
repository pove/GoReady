import './style.css';
import { fetchWellness, GoReadyApiError, putTrainingAdvice } from './api';
import { readinessConfidence } from './insights';
import { computeReadiness, computeZScoreSeries } from './score';
import { isConfigured, loadSettings, saveSettings } from './settings';
import { requiredHistoryDays } from './trendChart';
import { applyTheme, cycleTheme, loadTheme } from './theme';
import { renderDashboard, renderSettingsForm, showError, showLoading, updateThemeButton } from './ui';
import type { AdviceStatus } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element not found');

let settings = loadSettings();
let theme = loadTheme();
applyTheme(theme);

/** How many previous days' needle positions to fade into the gauge as a trail. */
const GAUGE_TRAIL_DAYS = 6;

function handleThemeToggle(): void {
  theme = cycleTheme(theme);
  updateThemeButton(app!, theme);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function describeError(error: unknown): string {
  if (error instanceof GoReadyApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function openSettings(firstRun: boolean): void {
  renderSettingsForm(app!, settings, theme, {
    firstRun,
    onSave: (updated) => {
      settings = updated;
      saveSettings(settings);
      void loadDashboard();
    },
    onCancel: firstRun ? undefined : () => void loadDashboard(),
    onToggleTheme: handleThemeToggle,
  });
}

async function loadDashboard(): Promise<void> {
  showLoading(app!, theme, handleThemeToggle);

  const today = formatDate(new Date());
  const oldest = formatDate(daysAgo(requiredHistoryDays(settings)));

  try {
    const rows = await fetchWellness(settings, oldest, today);
    const result = computeReadiness(rows);
    const [todayScores = { hrvZ: NaN, rhrZ: NaN }, ...trail] = computeZScoreSeries(rows, GAUGE_TRAIL_DAYS);
    const confidence = readinessConfidence(rows);

    // Confidence is shown, never acted on: the advice sent to intervals.icu is
    // exactly what it would have been before the badge existed.
    let adviceStatus: AdviceStatus = { kind: 'disabled' };
    if (settings.sendTrainingAdvice) {
      // intervals.icu already has a value for today: sending it again on every
      // refresh would just be a redundant write, so leave it alone.
      if (rows[0]?.trainingAdvice) {
        adviceStatus = { kind: 'already-set' };
      } else {
        try {
          await putTrainingAdvice(settings, today, result.adviceCode);
          // No data yet blanks the field rather than sending a real code (see
          // `AdviceStatus`) - "sent" would misreport that as advice going out.
          adviceStatus = result.adviceCode === null ? { kind: 'cleared' } : { kind: 'sent' };
        } catch (error) {
          adviceStatus = { kind: 'error', message: describeError(error) };
        }
      }
    }

    renderDashboard(
      app!,
      { settings, rows, result, todayScores, trail, adviceStatus, confidence },
      theme,
      { onSettings: () => openSettings(false), onRefresh: () => void loadDashboard(), onToggleTheme: handleThemeToggle },
    );
  } catch (error) {
    showError(app!, describeError(error), theme, {
      onRetry: () => void loadDashboard(),
      onSettings: () => openSettings(false),
      onToggleTheme: handleThemeToggle,
    });
  }
}

if (!isConfigured(settings)) {
  openSettings(true);
} else {
  void loadDashboard();
}
