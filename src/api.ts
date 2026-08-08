import { TRAINING_ADVICE_FIELD } from './constants';
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

/** Fetches resting HR / rMSSD / SDNN / TrainingAdvice for the given date range (inclusive), newest first. */
export async function fetchWellness(settings: Settings, oldest: string, newest: string): Promise<WellnessRow[]> {
  const cols = [settings.fieldRHR, settings.fieldRMSSD, settings.fieldSDNN, TRAINING_ADVICE_FIELD].join(',');
  const athleteId = encodeURIComponent(settings.athleteId);
  const apiPath = `athlete/${athleteId}/wellness.csv?oldest=${oldest}&newest=${newest}&cols=${cols}`;

  const response = await proxyRequest(settings, apiPath);
  const csvText = await response.text();
  return parseWellnessCsv(csvText, settings);
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
