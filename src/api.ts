import { CONTEXT_FIELDS, TRAINING_ADVICE_FIELD } from './constants';
import { parseWellnessCsv } from './csv';
import type { Settings, WellnessRow } from './types';

export class GoReadyApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GoReadyApiError';
    this.status = status;
  }
}

/** intervals.icu authenticates API access with a fixed "API_KEY" username and the key as password. */
function buildAuthHeader(apiKey: string): string {
  return `Basic ${btoa(`API_KEY:${apiKey}`)}`;
}

/**
 * Calls intervals.icu through the configured reverse proxy, which forwards the
 * Authorization header and body as-is. See proxy/proxy.php.
 */
async function proxyRequest(
  settings: Settings,
  apiPath: string,
  init: { method: 'GET' | 'PUT'; body?: unknown } = { method: 'GET' },
): Promise<Response> {
  const url = `${settings.proxyUrl}?path=${encodeURIComponent(apiPath)}`;
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(settings.apiKey),
  };

  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(url, { method: init.method, headers, body });
  } catch {
    throw new GoReadyApiError('Could not reach the proxy. Check the proxy URL in settings.');
  }

  if (!response.ok) {
    throw new GoReadyApiError(`intervals.icu request failed (HTTP ${response.status})`, response.status);
  }
  return response;
}

/**
 * Fetches resting HR / rMSSD / SDNN / TrainingAdvice for the given date range
 * (inclusive), newest first, plus the optional context columns.
 *
 * The column list stays explicit rather than being dropped to fetch everything:
 * `parseTable` splits on bare commas, so pulling in free-text fields like
 * `notes` would shift every column after them.
 *
 * If intervals.icu rejects the request because it does not recognise one of the
 * context columns, this retries once with the core columns alone. Context is a
 * bonus - it must never be the reason the dashboard fails to load.
 */
export async function fetchWellness(settings: Settings, oldest: string, newest: string): Promise<WellnessRow[]> {
  const coreCols = [settings.fieldRHR, settings.fieldRMSSD, settings.fieldSDNN, TRAINING_ADVICE_FIELD];
  const allCols = [...coreCols, ...Object.values(CONTEXT_FIELDS)];

  const fetchWith = async (cols: string[]): Promise<WellnessRow[]> => {
    const athleteId = encodeURIComponent(settings.athleteId);
    const apiPath = `athlete/${athleteId}/wellness.csv?oldest=${oldest}&newest=${newest}&cols=${cols.join(',')}`;
    const response = await proxyRequest(settings, apiPath);
    return parseWellnessCsv(await response.text(), settings);
  };

  try {
    return await fetchWith(allCols);
  } catch (error) {
    const rejectedTheColumns = error instanceof GoReadyApiError && error.status !== undefined && error.status < 500;
    if (!rejectedTheColumns) throw error;
    return fetchWith(coreCols);
  }
}

/** Writes today's readiness code to intervals.icu's "TrainingAdvice" wellness field. */
export async function putTrainingAdvice(settings: Settings, date: string, adviceCode: number | null): Promise<void> {
  const athleteId = encodeURIComponent(settings.athleteId);
  const apiPath = `athlete/${athleteId}/wellness/${date}`;
  await proxyRequest(settings, apiPath, {
    method: 'PUT',
    body: { [TRAINING_ADVICE_FIELD]: adviceCode ?? '' },
  });
}
