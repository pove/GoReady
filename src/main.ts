import './style.css';
import { fetchWellness, GoReadyApiError, putTrainingAdvice } from './api';
import { computeReadiness, computeReadinessTrail } from './score';
import { isConfigured, loadSettings, saveSettings } from './settings';
import { requiredHistoryDays } from './trendChart';
import { renderDashboard, renderSettingsForm, showError, showLoading } from './ui';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element not found');

let settings = loadSettings();

/** How many previous days' needle positions to fade into the gauge as a trail. */
const GAUGE_TRAIL_DAYS = 6;

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
  renderSettingsForm(app!, settings, {
    firstRun,
    onSave: (updated) => {
      settings = updated;
      saveSettings(settings);
      void loadDashboard();
    },
    onCancel: firstRun ? undefined : () => void loadDashboard(),
  });
}

async function loadDashboard(): Promise<void> {
  showLoading(app!);

  const today = formatDate(new Date());
  const oldest = formatDate(daysAgo(requiredHistoryDays(settings)));

  try {
    const rows = await fetchWellness(settings, oldest, today);
    const result = computeReadiness(rows);
    const trail = computeReadinessTrail(rows, GAUGE_TRAIL_DAYS);

    let adviceError: string | null = null;
    if (settings.sendTrainingAdvice) {
      try {
        await putTrainingAdvice(settings, today, result.adviceCode);
      } catch (error) {
        adviceError = describeError(error);
      }
    }

    renderDashboard(
      app!,
      { settings, rows, result, trail, adviceError },
      { onSettings: () => openSettings(false), onRefresh: () => void loadDashboard() },
    );
  } catch (error) {
    showError(app!, describeError(error), { onRetry: () => void loadDashboard(), onSettings: () => openSettings(false) });
  }
}

if (!isConfigured(settings)) {
  openSettings(true);
} else {
  void loadDashboard();
}
