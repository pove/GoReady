import { renderGauge } from './gauge';
import { DEFAULT_SETTINGS } from './settings';
import { renderTrendChart } from './trendChart';
import type { HrvMetricDisplay, ReadinessCode, ReadinessResult, Settings, WellnessRow } from './types';

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

export function showLoading(container: HTMLElement): void {
  container.innerHTML = `
    <div class="screen loading-screen">
      <div class="spinner" aria-hidden="true"></div>
      <p>Loading your readiness&hellip;</p>
    </div>
  `;
}

interface ErrorScreenHandlers {
  onRetry: () => void;
  onSettings: () => void;
}

export function showError(container: HTMLElement, message: string, handlers: ErrorScreenHandlers): void {
  container.innerHTML = `
    <div class="screen error-screen">
      <p class="error-message">${escapeHtml(message)}</p>
      <div class="form-actions">
        <button id="error-settings-btn" class="btn-secondary" type="button">Settings</button>
        <button id="retry-btn" class="btn-primary" type="button">Try again</button>
      </div>
    </div>
  `;
  container.querySelector<HTMLButtonElement>('#retry-btn')!.addEventListener('click', handlers.onRetry);
  container.querySelector<HTMLButtonElement>('#error-settings-btn')!.addEventListener('click', handlers.onSettings);
}

interface SettingsFormHandlers {
  firstRun: boolean;
  onSave: (settings: Settings) => void;
  onCancel?: () => void;
}

export function renderSettingsForm(container: HTMLElement, settings: Settings, handlers: SettingsFormHandlers): void {
  container.innerHTML = `
    <div class="screen settings-screen">
      <header class="app-header">
        <h1>GoReady</h1>
      </header>
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
  /** Previous days' readiness codes, most-recent-first, faded into the gauge as a trail. */
  trail: ReadinessCode[];
  /** Set when sendTrainingAdvice was on but the write to intervals.icu failed. */
  adviceError: string | null;
}

interface DashboardHandlers {
  onSettings: () => void;
  onRefresh: () => void;
}

function showsMetric(metric: 'rmssd' | 'sdnn', settings: Settings): boolean {
  return settings.hrvMetricsToShow === 'both' || settings.hrvMetricsToShow === metric;
}

export function renderDashboard(container: HTMLElement, data: DashboardData, handlers: DashboardHandlers): void {
  const { settings, rows, result, trail, adviceError } = data;
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

  container.innerHTML = `
    <div class="screen dashboard-screen">
      <header class="app-header">
        <h1>GoReady</h1>
        <button id="settings-btn" class="icon-btn" type="button" aria-label="Settings">&#9881;</button>
      </header>

      <main>
        <section class="status-card">
          ${renderGauge(result, trail)}
          <div class="status-badge" style="--status-color: ${result.color}">${escapeHtml(result.label)}</div>
          <div class="status-detail">
            <div>${escapeHtml(result.detail[0])}</div>
            <div>${escapeHtml(result.detail[1])}</div>
          </div>
        </section>

        ${adviceError ? `<p class="banner banner-warning">Could not update intervals.icu: ${escapeHtml(adviceError)}</p>` : ''}
        ${settings.sendTrainingAdvice && !adviceError ? '<p class="banner banner-ok">Training advice sent to intervals.icu.</p>' : ''}

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

  container.querySelector<HTMLButtonElement>('#settings-btn')!.addEventListener('click', handlers.onSettings);
  container.querySelector<HTMLButtonElement>('#refresh-btn')!.addEventListener('click', handlers.onRefresh);
}
