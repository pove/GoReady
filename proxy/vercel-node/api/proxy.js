// Minimal reverse proxy that lets the GoReady front-end reach the
// intervals.icu API without running into browser CORS restrictions.
//
// It holds no credentials of its own: it simply forwards the Authorization
// header and body it receives, as-is, to https://intervals.icu/api/v1/<path>.
//
// Deploy: create a Vercel project with this folder (proxy/vercel-node) as its
// Root Directory - Vercel auto-detects api/proxy.js as a serverless function,
// no build step or config needed. Point the app's "Proxy URL" setting at
// https://<your-project>.vercel.app/api/proxy
//
// CommonJS on purpose, not ESM: it lets this run with zero package.json at
// all, matching proxy.php's "just deploy the one file" simplicity.

const INTERVALS_API_BASE = 'https://intervals.icu/api/v1/';
const ALLOWED_METHODS = ['GET', 'PUT'];
// Restrict this to your own domain in production, e.g. 'https://your-site.example'.
const ALLOWED_ORIGIN = '*';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!ALLOWED_METHODS.includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const path = typeof req.query.path === 'string' ? req.query.path : '';
  if (!isValidApiPath(path)) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const authorization = req.headers['authorization'] || '';
  if (!authorization) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  // Vercel auto-parses a JSON body into an object when Content-Type is
  // application/json; re-serialize it rather than assuming either shape, since
  // that parsing behavior has changed across Vercel Node runtime versions.
  let body;
  if (req.method === 'PUT') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(INTERVALS_API_BASE + path, {
      method: req.method,
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.status(upstream.status).send(text);
  } catch (error) {
    res.status(502).json({ error: String(error) });
  }
};

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
