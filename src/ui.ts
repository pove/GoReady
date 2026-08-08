import { renderGauge } from './gauge';
import { trainingPhaseNote } from './insights';
import { DEFAULT_SETTINGS } from './settings';
import { READINESS_LEGEND, ZONE_COLORS } from './score';
import type { ThemePreference } from './theme';
import { renderTrendChart } from './trendChart';
import type { AdviceStatus, HrvMetricDisplay, ReadinessResult, Settings, WellnessRow, ZScorePoint } from './types';

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

const THEME_ICON: Record<ThemePreference, string> = {
  system: '&#9680;', // ◐ follows the system preference
  light: '&#9728;', // ☀
  dark: '&#9790;', // ☾
};

/** Describes what clicking the button does next, not the current state - clearer for screen readers. */
const THEME_NEXT_LABEL: Record<ThemePreference, string> = {
  system: 'Switch to light theme',
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
};

function renderHeader(theme: ThemePreference, showSettingsButton: boolean): string {
  return `
    <header class="app-header">
      <h1>GoReady</h1>
      <div class="header-actions">
        <button id="theme-btn" class="icon-btn" type="button" aria-label="${THEME_NEXT_LABEL[theme]}" title="${THEME_NEXT_LABEL[theme]}">${THEME_ICON[theme]}</button>
        ${showSettingsButton ? '<button id="settings-btn" class="icon-btn" type="button" aria-label="Settings">&#9881;</button>' : ''}
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
            <label class="checkbox-row">
              <input type="checkbox" name="showValuesInTrendCharts" ${settings.showValuesInTrendCharts ? 'checked' : ''} />
              Show values above bars
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
}

function readHrvMetricsToShow(value: FormDataEntryValue | null): HrvMetricDisplay {
  return value === 'rmssd' || value === 'sdnn' ? value : 'both';
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
    showValuesInTrendCharts: data.get('showValuesInTrendCharts') === 'on',
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
 * has no room for legible in-place labels at mobile sizes. Tucked behind a
 * `<details>` toggle, closed by default, so it doesn't push the rest of the
 * dashboard down every time - most visits, the badge and detail text below
 * the gauge already say what today's zone means.
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
  return `
    <details class="gauge-legend-toggle">
      <summary>What do the zones mean?</summary>
      <ul class="gauge-legend">${items}</ul>
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
      return '';
  }
}

export function renderDashboard(
  container: HTMLElement,
  data: DashboardData,
  theme: ThemePreference,
  handlers: DashboardHandlers,
): void {
  const { settings, rows, result, todayScores, trail, adviceStatus } = data;
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
  ].join('');

  const trendCharts = [
    showRmssd ? renderTrendChart('rMSSD', rows.map((r) => r.rmssd), settings) : '',
    showSdnn ? renderTrendChart('SDNN', rows.map((r) => r.sdnn), settings) : '',
    renderTrendChart('RHR', rows.map((r) => r.rhr), settings),
  ].join('');

  const phaseNote = trainingPhaseNote(result.code, todayScores.hrvZ, todayScores.rhrZ);

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
          ${phaseNote ? `<p class="status-note">${escapeHtml(phaseNote)}</p>` : ''}
          ${renderGaugeLegend()}
        </section>

        <dialog id="gauge-help-dialog" class="gauge-help-dialog">
          <button id="gauge-help-close" class="icon-btn gauge-help-close" type="button" aria-label="Close">&#10005;</button>
          <img id="gauge-help-image" class="gauge-help-image" alt="Reference readiness chart: resting heart rate (activation) around the arc, HRV (recovery) as distance from the center, with named zones for HIT, train as planned, limit intensity, rest, and stress/illness." />
        </dialog>

        ${renderAdviceBanner(adviceStatus)}

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
