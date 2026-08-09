// Minimal reverse proxy that lets the GoReady front-end reach the
// intervals.icu API without running into browser CORS restrictions.
//
// It holds no credentials of its own: it simply forwards the Authorization
// header and body it receives, as-is, to https://intervals.icu/api/v1/<path>.
//
// Deploy: create a Netlify site with this folder (proxy/netlify) as its Base
// directory - netlify.toml here points Netlify at netlify/functions/proxy.js.
// Point the app's "Proxy URL" setting at
// https://<your-site>.netlify.app/.netlify/functions/proxy
//
// CommonJS on purpose, not ESM: it's the classic Netlify Functions
// convention and needs no package.json at all, matching proxy.php's
// "just deploy the one file" simplicity.

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1/';
const ALLOWED_METHODS = ['GET', 'PUT'];
// Restrict this to your own domain in production, e.g. 'https://your-site.example'.
const ALLOWED_ORIGIN = '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (!ALLOWED_METHODS.includes(event.httpMethod)) {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const path = (event.queryStringParameters && event.queryStringParameters.path) || '';
  if (!isValidApiPath(path)) {
    return jsonResponse(400, { error: 'Invalid path' });
  }

  // Netlify lowercases incoming header names in event.headers.
  const authorization = event.headers['authorization'] || '';
  if (!authorization) {
    return jsonResponse(401, { error: 'Missing Authorization header' });
  }

  let body;
  if (event.httpMethod === 'PUT') {
    body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf-8') : event.body;
  }

  try {
    const upstream = await fetch(INTERVALS_API_BASE + path, {
      method: event.httpMethod,
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    return {
      statusCode: upstream.status,
      headers: { ...CORS_HEADERS, ...(contentType ? { 'Content-Type': contentType } : {}) },
      body: text,
    };
  } catch (error) {
    return jsonResponse(502, { error: String(error) });
  }
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * Rejects anything that isn't a plain relative path (optionally with a query
 * string) under the intervals.icu API base, so this proxy can't be turned into
 * an open relay to arbitrary hosts (SSRF).
 */
function isValidApiPath(path) {
  if (!path) return false;
  if (path.includes('..')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) return false; // absolute URL, e.g. "https://evil.example/..."
  if (path.startsWith('/')) return false; // protocol-relative ("//host/...") or absolute ("/...") path
  return true;
}
