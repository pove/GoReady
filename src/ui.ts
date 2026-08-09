import { unreachableBands, type ReadinessConfidence } from './baseline';
import { renderGauge } from './gauge';
import { buildInsights, type Insight } from './insights';
import { DEFAULT_SETTINGS } from './settings';
import { READINESS_LEGEND, ZONE_COLORS } from './score';
import type { ThemePreference } from './theme';
import { renderTrendChart, renderTrendLegend } from './trendChart';
import type {
  AdviceStatus,
  BackfillStatus,
  HrvMetricDisplay,
  ReadinessResult,
  Settings,
  TrendValueLabels,
  WellnessRow,
  ZScorePoint,
} from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--';
  return String(Math.round(value));
}

/** Formats a sleep duration as `7h30`, rounded to the nearest minute. */
function formatSleepDuration(secs: number | undefined): string {
  if (secs === undefined || Number.isNaN(secs) || secs < 0) return '--';
  const totalMinutes = Math.round(secs / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

/**
 * Inline SVGs, for the same reason as SETTINGS_ICON below: the Unicode glyphs
 * these replaced (U+25D0 "◐", U+2600 "☀", U+263E "☾") have no standard shape
 * and render inconsistently across font stacks - not just the settings gear,
 * this trio had the identical problem.
 */
const THEME_ICON: Record<ThemePreference, string> = {
  // Half-filled circle: follows the system preference.
  system: `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"></path>
    </svg>
  `,
  light: `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>
  `,
  dark: `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>
  `,
};

/** Describes what clicking the button does next, not the current state - clearer for screen readers. */
const THEME_NEXT_LABEL: Record<ThemePreference, string> = {
  system: 'Switch to light theme',
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
};

/**
 * An inline SVG rather than the Unicode gear (U+2699, "&#9881;") this used to
 * be: that glyph has no standard shape, and several common font stacks draw
 * it as a sparse starburst rather than a recognizable gear. An SVG path
 * renders identically everywhere, independent of whatever font is installed.
 */
const SETTINGS_ICON = `
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
`;

function renderHeader(theme: ThemePreference, showSettingsButton: boolean): string {
  return `
    <header class="app-header">
      <h1>GoReady</h1>
      <div class="header-actions">
        <button id="theme-btn" class="icon-btn" type="button" aria-label="${THEME_NEXT_LABEL[theme]}" title="${THEME_NEXT_LABEL[theme]}">${THEME_ICON[theme]}</button>
        ${showSettingsButton ? `<button id="settings-btn" class="icon-btn" type="button" aria-label="Settings" title="Settings">${SETTINGS_ICON}</button>` : ''}
      </div>
    </header>
  `;
}

function attachHeaderHandlers(container: HTMLElement, onToggleTheme: () => void, onSettings?: () => void): void {
  container.querySelector<HTMLButtonElement>('#theme-btn')!.addEventListener('click', onToggleTheme);
  if (onSettings) {
    container.querySelector<HTMLButtonElement>('#settings-btn')!.addEventListener('click', onSettings);
  }
}

/** Updates the theme button's icon/label in place, without re-rendering the current screen. */
export function updateThemeButton(container: HTMLElement, theme: ThemePreference): void {
  const btn = container.querySelector<HTMLButtonElement>('#theme-btn');
  if (!btn) return;
  btn.innerHTML = THEME_ICON[theme];
  btn.setAttribute('aria-label', THEME_NEXT_LABEL[theme]);
  btn.title = THEME_NEXT_LABEL[theme];
}

export function showLoading(container: HTMLElement, theme: ThemePreference, onToggleTheme: () => void): void {
  container.innerHTML = `
    <div class="screen loading-screen">
      ${renderHeader(theme, false)}
      <div class="loading-content">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading your readiness&hellip;</p>
      </div>
    </div>
  `;
  attachHeaderHandlers(container, onToggleTheme);
}

interface ErrorScreenHandlers {
  onRetry: () => void;
  onSettings: () => void;
  onToggleTheme: () => void;
}

export function showError(container: HTMLElement, message: string, theme: ThemePreference, handlers: ErrorScreenHandlers): void {
  container.innerHTML = `
    <div class="screen error-screen">
      ${renderHeader(theme, false)}
      <div class="error-content">
        <p class="error-message">${escapeHtml(message)}</p>
        <div class="form-actions">
          <button id="error-settings-btn" class="btn-secondary" type="button">Settings</button>
          <button id="retry-btn" class="btn-primary" type="button">Try again</button>
        </div>
      </div>
    </div>
  `;
  attachHeaderHandlers(container, handlers.onToggleTheme);
  container.querySelector<HTMLButtonElement>('#retry-btn')!.addEventListener('click', handlers.onRetry);
  container.querySelector<HTMLButtonElement>('#error-settings-btn')!.addEventListener('click', handlers.onSettings);
}

interface SettingsFormHandlers {
  firstRun: boolean;
  onSave: (settings: Settings) => void;
  onCancel?: () => void;
  onToggleTheme: () => void;
  /** Runs the last `days` days' worth of catch-up on demand. Undefined on first run - nothing to catch up on before the account is even connected. */
  onBackfillNow?: (days: number) => Promise<{ succeeded: number; failed: number }>;
}

export function renderSettingsForm(
  container: HTMLElement,
  settings: Settings,
  theme: ThemePreference,
  handlers: SettingsFormHandlers,
): void {
  container.innerHTML = `
    <div class="screen settings-screen">
      ${renderHeader(theme, false)}
      <form id="settings-form" class="settings-form">
        <p class="settings-intro">
          ${handlers.firstRun ? 'Connect your intervals.icu account to get started.' : 'Update your settings.'}
        </p>

        <fieldset>
          <legend>intervals.icu</legend>
          <label>Athlete ID
            <input type="text" name="athleteId" value="${escapeHtml(settings.athleteId)}" placeholder="i12345" required />
          </label>
          <label>API key
            <input type="password" name="apiKey" value="${escapeHtml(settings.apiKey)}" required autocomplete="off" />
          </label>
          <label>Proxy URL
            <input type="text" name="proxyUrl" value="${escapeHtml(settings.proxyUrl)}" placeholder="./proxy.php" required />
          </label>
        </fieldset>

        <fieldset>
          <legend>Training advice</legend>
          <label class="checkbox-row">
            <input type="checkbox" name="sendTrainingAdvice" ${settings.sendTrainingAdvice ? 'checked' : ''} />
            Write today's readiness back to intervals.icu ("TrainingAdvice" field)
          </label>
          <p class="settings-hint">
            Every load also quietly corrects the last 7 days automatically, in case
            you missed opening the app for a bit.
          </p>
          ${
            !handlers.firstRun
              ? `
          <div class="backfill-tool">
            <label>Update past days
              <input type="number" id="backfill-days" min="1" max="90" value="7" />
            </label>
            <button type="button" id="backfill-run" class="btn-secondary" ${settings.sendTrainingAdvice ? '' : 'disabled'}>Run</button>
            <span id="backfill-result" class="backfill-result"></span>
          </div>
          `
              : ''
          }
        </fieldset>

        <details class="advanced">
          <summary>Advanced</summary>

          <fieldset>
            <legend>Wellness field names</legend>
            <label>HRV metrics to show
              <select name="hrvMetricsToShow">
                <option value="both" ${settings.hrvMetricsToShow === 'both' ? 'selected' : ''}>Both rMSSD and SDNN</option>
                <option value="rmssd" ${settings.hrvMetricsToShow === 'rmssd' ? 'selected' : ''}>rMSSD only</option>
                <option value="sdnn" ${settings.hrvMetricsToShow === 'sdnn' ? 'selected' : ''}>SDNN only</option>
              </select>
            </label>
            <label>Resting HR field
              <input type="text" name="fieldRHR" value="${escapeHtml(settings.fieldRHR)}" />
            </label>
            <label>rMSSD field
              <input type="text" name="fieldRMSSD" value="${escapeHtml(settings.fieldRMSSD)}" />
            </label>
            <label>SDNN field
              <input type="text" name="fieldSDNN" value="${escapeHtml(settings.fieldSDNN)}" />
            </label>
          </fieldset>

          <fieldset>
            <legend>Trend charts</legend>
            <label>Short-term trend window (days)
              <input type="number" name="daysForShortTermTrend" min="1" value="${settings.daysForShortTermTrend}" />
            </label>
            <label>Long-term trend window (days)
              <input type="number" name="daysForLongTermTrend" min="1" value="${settings.daysForLongTermTrend}" />
            </label>
            <label>Expected-range width (&times; std dev)
              <input type="number" name="stdDevMultiplier" min="0" step="0.05" value="${settings.stdDevMultiplier}" />
            </label>
            <label>Values above bars
              <select name="trendValueLabels">
                <option value="all" ${settings.trendValueLabels === 'all' ? 'selected' : ''}>All days</option>
                <option value="minimal" ${settings.trendValueLabels === 'minimal' ? 'selected' : ''}>Latest, high, low only</option>
                <option value="none" ${settings.trendValueLabels === 'none' ? 'selected' : ''}>None</option>
              </select>
            </label>
          </fieldset>
        </details>

        <div class="form-actions">
          ${handlers.onCancel ? '<button type="button" id="settings-cancel" class="btn-secondary">Cancel</button>' : ''}
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector<HTMLFormElement>('#settings-form')!;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onSave(readSettingsForm(form));
  });

  container.querySelector<HTMLButtonElement>('#settings-cancel')?.addEventListener('click', () => handlers.onCancel?.());
  attachHeaderHandlers(container, handlers.onToggleTheme);
  attachBackfillTool(container, form, handlers);
}

/**
 * The "Update past days" tool is a deliberate, explicit action, unlike the
 * silent automatic catch-up in main.ts - so unlike that one, this always
 * reports what happened. Disabled alongside the "write advice back" checkbox
 * (live, not just at render time) since running it while that's off would
 * write intervals.icu data the rest of the settings say not to touch.
 */
function attachBackfillTool(container: HTMLElement, form: HTMLFormElement, handlers: SettingsFormHandlers): void {
  const runBtn = container.querySelector<HTMLButtonElement>('#backfill-run');
  const daysInput = container.querySelector<HTMLInputElement>('#backfill-days');
  const result = container.querySelector<HTMLSpanElement>('#backfill-result');
  const sendAdviceCheckbox = form.querySelector<HTMLInputElement>('input[name="sendTrainingAdvice"]');
  if (!runBtn || !daysInput || !result) return;

  sendAdviceCheckbox?.addEventListener('change', () => {
    runBtn.disabled = !sendAdviceCheckbox.checked;
  });

  runBtn.addEventListener('click', async () => {
    const days = Math.trunc(Number(daysInput.value));
    if (!handlers.onBackfillNow || !(days > 0)) return;

    runBtn.disabled = true;
    result.textContent = 'Running...';
    try {
      const { succeeded, failed } = await handlers.onBackfillNow(days);
      if (succeeded === 0 && failed === 0) {
        result.textContent = 'Already up to date.';
      } else if (failed === 0) {
        result.textContent = `Updated ${succeeded} day${succeeded === 1 ? '' : 's'}.`;
      } else {
        result.textContent = `Updated ${succeeded}; ${failed} failed.`;
      }
    } catch {
      result.textContent = 'Could not reach intervals.icu.';
    } finally {
      runBtn.disabled = !(sendAdviceCheckbox?.checked ?? true);
    }
  });
}

function readHrvMetricsToShow(value: FormDataEntryValue | null): HrvMetricDisplay {
  return value === 'rmssd' || value === 'sdnn' ? value : 'both';
}

function readTrendValueLabels(value: FormDataEntryValue | null): TrendValueLabels {
  return value === 'none' || value === 'minimal' ? value : 'all';
}

function readSettingsForm(form: HTMLFormElement): Settings {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? '').trim();
  const numberOr = (name: string, fallback: number) => {
    const parsed = Number(data.get(name));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    athleteId: text('athleteId'),
    apiKey: text('apiKey'),
    proxyUrl: text('proxyUrl'),
    sendTrainingAdvice: data.get('sendTrainingAdvice') === 'on',
    daysForShortTermTrend: numberOr('daysForShortTermTrend', DEFAULT_SETTINGS.daysForShortTermTrend),
    daysForLongTermTrend: numberOr('daysForLongTermTrend', DEFAULT_SETTINGS.daysForLongTermTrend),
    stdDevMultiplier: numberOr('stdDevMultiplier', DEFAULT_SETTINGS.stdDevMultiplier),
    trendValueLabels: readTrendValueLabels(data.get('trendValueLabels')),
    fieldRHR: text('fieldRHR') || DEFAULT_SETTINGS.fieldRHR,
    fieldRMSSD: text('fieldRMSSD') || DEFAULT_SETTINGS.fieldRMSSD,
    fieldSDNN: text('fieldSDNN') || DEFAULT_SETTINGS.fieldSDNN,
    hrvMetricsToShow: readHrvMetricsToShow(data.get('hrvMetricsToShow')),
  };
}

export interface DashboardData {
  settings: Settings;
  rows: WellnessRow[];
  result: ReadinessResult;
  /** Today's HRV/RHR z-scores, for placing today's marker on the gauge. */
  todayScores: ZScorePoint;
  /** Previous days' z-scores, most-recent-first, faded into the gauge as a trail. */
  trail: ZScorePoint[];
  /** Outcome of trying to sync today's readiness to intervals.icu. */
  adviceStatus: AdviceStatus;
  /** Outcome of the automatic catch-up for a few recent past days. */
  backfillStatus: BackfillStatus;
  /** How much history actually backs today's z-scores. Display-only. */
  confidence: ReadinessConfidence;
}

interface DashboardHandlers {
  onSettings: () => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
}

function showsMetric(metric: 'rmssd' | 'sdnn', settings: Settings): boolean {
  return settings.hrvMetricsToShow === 'both' || settings.hrvMetricsToShow === metric;
}

/**
 * Explains what each colored zone on the gauge means, since the chart itself
 * has no room for legible in-place labels at mobile sizes. Lives in the gauge's
 * info dialog (see `attachGaugeHelpDialog`) rather than inline on the
 * dashboard, alongside the reference chart image - one ⓘ button, one place
 * that explains the gauge, instead of splitting the explanation across a
 * panel on the page and a dialog.
 */
function renderGaugeLegend(): string {
  const items = READINESS_LEGEND.map(
    ({ code, label, description }) => `
      <li>
        <span class="legend-dot" style="--dot-color: ${ZONE_COLORS[code]}"></span>
        <span class="legend-label">${escapeHtml(label)}</span>
        <span class="legend-desc">${escapeHtml(description)}</span>
      </li>
    `,
  ).join('');
  return `<ul class="gauge-legend">${items}</ul>`;
}

/**
 * Says how much history is behind today's score, when that is little enough to
 * matter. Display-only: the readiness code, its colour and the value written
 * back to intervals.icu are unaffected by what this says.
 *
 * The `unusable` wording is specific on purpose. With very few measurements some
 * zones are not merely unlikely but arithmetically out of reach (see
 * `maxReachableZ`), and "we cannot reach the Rest zone from here" is a far more
 * useful thing to read than a vague low-confidence hedge.
 */
function renderConfidenceBadge(confidence: ReadinessConfidence): string {
  const { overall } = confidence;
  if (overall.tier === 'ok') return '';

  const counts = `Baseline: ${overall.validDays} of the last ${overall.windowDays} days measured.`;

  if (overall.tier === 'limited') {
    return `<p class="confidence-badge">${escapeHtml(`${counts} Today's score is provisional until there is more history.`)}</p>`;
  }

  const missing = unreachableBands(confidence);
  const consequence = missing.length
    ? ` With this little history the score cannot reach ${formatList(missing)}, whatever this morning's numbers are.`
    : '';
  return `<p class="confidence-badge confidence-badge-unusable">${escapeHtml(`${counts}${consequence}`)}</p>`;
}

function formatList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function renderInsights(insights: Insight[]): string {
  if (insights.length === 0) return '';
  const items = insights
    .map((insight) => `<li class="insight-${insight.tone}">${escapeHtml(insight.text)}</li>`)
    .join('');
  return `<ul class="insights">${items}</ul>`;
}

/**
 * A standing reminder of what this score cannot see, shown collapsed on every
 * visit rather than as a data-driven insight. HRV/RHR read autonomic recovery
 * only - not the muscular, tendon, or joint fatigue a hard or long session
 * leaves behind, which recovers on a different timescale entirely and often
 * outlasts the autonomic system's own bounce-back. An attempt to detect that
 * from the data (elevation loss, pace variability, decoupling) was tested
 * against real activity history and didn't hold up: the metrics that looked
 * promising in theory came in BELOW baseline on the exact hard session they
 * were meant to catch, contaminated by heat and workout type. Rather than
 * ship an auto-firing rule that misses the case it exists for, this just says
 * the honest thing plainly, every time - go by how your legs and joints
 * actually feel, not only by this score.
 */
function renderScoreLimitsNote(): string {
  return `
    <details class="score-limits-toggle">
      <summary>What this score measures</summary>
      <p>
        This score reflects autonomic recovery - how well your nervous
        system has bounced back, based on resting heart rate and HRV.
        Muscle, tendon, and joint recovery from previous training follow
        their own, often slower timeline. For the fullest picture, weigh
        this score alongside how your legs and joints actually feel,
        especially after a long or hard session.
      </p>
    </details>
  `;
}

function renderAdviceBanner(status: AdviceStatus): string {
  switch (status.kind) {
    case 'sent':
      return '<p class="banner banner-ok">Training advice sent to intervals.icu.</p>';
    case 'already-set':
      return '<p class="banner banner-info">Training advice already set for today.</p>';
    case 'error':
      return `<p class="banner banner-warning">Could not update intervals.icu: ${escapeHtml(status.message)}</p>`;
    case 'disabled':
    case 'no-data':
      // "No HRV data today" is already the headline above this banner's spot -
      // nothing was sent, so nothing more needs saying here.
      return '';
  }
}

/**
 * Silent on success, same as the automatic catch-up itself (see `BackfillStatus`) -
 * only a persistent failure is worth a banner, since it would otherwise fail
 * the same way on every load with nothing on screen to explain why.
 */
function renderBackfillBanner(status: BackfillStatus): string {
  if (status.kind === 'ok') return '';
  const day = status.count === 1 ? 'day' : 'days';
  return `<p class="banner banner-warning">Could not update ${status.count} previous ${day} on intervals.icu.</p>`;
}

export function renderDashboard(
  container: HTMLElement,
  data: DashboardData,
  theme: ThemePreference,
  handlers: DashboardHandlers,
): void {
  const { settings, rows, result, todayScores, trail, adviceStatus, backfillStatus, confidence } = data;
  const [todayRow, yesterdayRow] = rows;
  const showRmssd = showsMetric('rmssd', settings);
  const showSdnn = showsMetric('sdnn', settings);

  const statsRows = [
    showRmssd
      ? `<tr><th scope="row">rMSSD</th><td>${formatValue(todayRow?.rmssd)}</td><td>${formatValue(yesterdayRow?.rmssd)}</td></tr>`
      : '',
    showSdnn
      ? `<tr><th scope="row">SDNN</th><td>${formatValue(todayRow?.sdnn)}</td><td>${formatValue(yesterdayRow?.sdnn)}</td></tr>`
      : '',
    `<tr><th scope="row">RHR</th><td>${formatValue(todayRow?.rhr)}</td><td>${formatValue(yesterdayRow?.rhr)}</td></tr>`,
    `<tr><th scope="row">Sleep</th><td>${formatSleepDuration(todayRow?.sleepSecs)}</td><td>${formatSleepDuration(yesterdayRow?.sleepSecs)}</td></tr>`,
    `<tr><th scope="row">Sleep score</th><td>${formatValue(todayRow?.sleepScore)}</td><td>${formatValue(yesterdayRow?.sleepScore)}</td></tr>`,
  ].join('');

  const trendCharts = [
    showRmssd ? renderTrendChart('rMSSD', rows.map((r) => r.rmssd), settings) : '',
    showSdnn ? renderTrendChart('SDNN', rows.map((r) => r.sdnn), settings) : '',
    renderTrendChart('RHR', rows.map((r) => r.rhr), settings),
  ].join('');

  const insights = buildInsights({
    code: result.code,
    hrvZ: todayScores.hrvZ,
    rhrZ: todayScores.rhrZ,
    rows,
    settings,
    confidence,
  });

  container.innerHTML = `
    <div class="screen dashboard-screen">
      ${renderHeader(theme, true)}

      <main>
        <section class="status-card">
          <button id="gauge-help-btn" class="icon-btn gauge-help-btn" type="button" aria-label="What does the gauge mean?" title="What does the gauge mean?">&#9432;</button>
          ${renderGauge(result, todayScores, trail)}
          <div class="status-detail">
            <div>${escapeHtml(result.detail[0])}</div>
            <div>${escapeHtml(result.detail[1])}</div>
          </div>
          ${renderConfidenceBadge(confidence)}
          ${renderInsights(insights)}
          ${renderScoreLimitsNote()}
        </section>

        <dialog id="gauge-help-dialog" class="gauge-help-dialog">
          <button id="gauge-help-close" class="icon-btn gauge-help-close" type="button" aria-label="Close">&#10005;</button>
          <h2 class="gauge-help-title">What do the zones mean?</h2>
          ${renderGaugeLegend()}
          <img id="gauge-help-image" class="gauge-help-image" alt="Reference readiness chart: resting heart rate (activation) around the arc, HRV (recovery) as distance from the center, with named zones for HIT, train as planned, limit intensity, rest, and stress/illness." />
        </dialog>

        ${renderAdviceBanner(adviceStatus)}
        ${renderBackfillBanner(backfillStatus)}

        <section class="stats-card">
          <table class="stats-table">
            <thead>
              <tr><th scope="col"></th><th scope="col">Today</th><th scope="col">Yesterday</th></tr>
            </thead>
            <tbody>
              ${statsRows}
            </tbody>
          </table>
        </section>

        <section class="trends">
          ${renderTrendLegend()}
          ${trendCharts}
        </section>

        <button id="refresh-btn" class="btn-secondary refresh-btn" type="button">Refresh</button>
      </main>
    </div>
  `;

  attachHeaderHandlers(container, handlers.onToggleTheme, handlers.onSettings);
  container.querySelector<HTMLButtonElement>('#refresh-btn')!.addEventListener('click', handlers.onRefresh);
  attachGaugeHelpDialog(container);
}

/** Wires up the "what does the gauge mean?" dialog, loading its (fairly large) reference image only once the user actually opens it. */
function attachGaugeHelpDialog(container: HTMLElement): void {
  const dialog = container.querySelector<HTMLDialogElement>('#gauge-help-dialog')!;
  const image = container.querySelector<HTMLImageElement>('#gauge-help-image')!;

  container.querySelector<HTMLButtonElement>('#gauge-help-btn')!.addEventListener('click', () => {
    if (!image.src) image.src = `${import.meta.env.BASE_URL}readiness-chart-reference.jpg`;
    dialog.showModal();
  });
  container.querySelector<HTMLButtonElement>('#gauge-help-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
