import './style.css';
import { decideAdviceAction } from './advice';
import { fetchWellness, GoReadyApiError, putTrainingAdvice } from './api';
import { planBackfill } from './backfill';
import { readinessConfidence } from './insights';
import { computeReadiness, computeZScoreSeries, READINESS_WINDOW_DAYS } from './score';
import { isConfigured, loadSettings, saveSettings } from './settings';
import { requiredHistoryDays } from './trendChart';
import { applyTheme, cycleTheme, loadTheme } from './theme';
import { renderDashboard, renderSettingsForm, showError, showLoading, updateThemeButton } from './ui';
import type { AdviceStatus, BackfillStatus, WellnessRow } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element not found');

let settings = loadSettings();
let theme = loadTheme();
applyTheme(theme);

/** How many previous days' needle positions to fade into the gauge as a trail. */
const GAUGE_TRAIL_DAYS = 6;

/**
 * How many days before today the automatic catch-up checks/corrects on every
 * load, in case the app wasn't opened for a bit. Hardcoded rather than a
 * Settings field, same treatment as GAUGE_TRAIL_DAYS: bounds worst-case PUT
 * volume on every single load (this reruns forever, not just once) and keeps
 * a first-time install from rewriting a large stretch of pre-existing
 * TrainingAdvice history. The Settings screen's manual tool covers catching
 * up further than this on demand.
 */
const BACKFILL_WINDOW_DAYS = 7;

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

/**
 * Writes whatever `planBackfill` decides the last `windowDays` days need,
 * sequentially and awaited one at a time - never `Promise.all` - since this is
 * a burst-avoidance requirement, not a correctness one (each PUT targets a
 * different date and none depend on another's result). One day's failure
 * doesn't stop the rest; it's just counted.
 */
async function runBackfill(rows: WellnessRow[], windowDays: number): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const write of planBackfill(rows, windowDays)) {
    try {
      await putTrainingAdvice(settings, write.date, write.adviceCode);
      succeeded++;
    } catch {
      failed++;
    }
  }
  return { succeeded, failed };
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
    onBackfillNow: firstRun
      ? undefined
      : async (days) => {
          // Every one of the `days` days being backfilled needs its OWN full
          // 30-day trailing window to compute a real z-score (planBackfill
          // calls computeReadiness per day, same as everywhere else) - fetch
          // that much extra buffer, or the days nearest the edge of the
          // requested range get a near-empty window that defaults to
          // "Normal" regardless of the true reading, which could overwrite
          // an already-correct stored value with a wrong one.
          const oldest = daysAgo(days + READINESS_WINDOW_DAYS);
          const rows = await fetchWellness(settings, formatDate(oldest), formatDate(new Date()));
          return runBackfill(rows, days);
        },
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
    let backfillStatus: BackfillStatus = { kind: 'ok' };
    if (settings.sendTrainingAdvice) {
      const decision = decideAdviceAction(result.adviceCode, rows[0]?.trainingAdvice);
      if (decision.action === 'skip') {
        adviceStatus = decision.status;
      } else {
        try {
          await putTrainingAdvice(settings, today, result.adviceCode);
          adviceStatus = decision.status;
        } catch (error) {
          adviceStatus = { kind: 'error', message: describeError(error) };
        }
      }

      // Uses the history already fetched above - no extra API reads. Silent
      // on success, same as today's own write when nothing needed changing;
      // a failure gets its own small banner rather than stomping on
      // adviceStatus, which by now already reflects today's real outcome.
      const { failed } = await runBackfill(rows, BACKFILL_WINDOW_DAYS);
      backfillStatus = failed > 0 ? { kind: 'error', count: failed } : { kind: 'ok' };
    }

    renderDashboard(
      app!,
      { settings, rows, result, todayScores, trail, adviceStatus, backfillStatus, confidence },
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
