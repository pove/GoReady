# GoReady

A mobile-first daily training readiness dashboard for a single [intervals.icu](https://intervals.icu)
athlete. It's a TypeScript rewrite of a personal MATLAB script: it reads resting
heart rate and HRV (rMSSD/SDNN) from intervals.icu, scores how ready you are to
train today, shows that score on a gauge plus a 30-day trend for each metric,
and (optionally) writes the score back to intervals.icu as the `TrainingAdvice`
wellness field.

There is no backend and no account system — it's a static single-page app.
Your intervals.icu API key is kept in the browser's `sessionStorage` only
(cleared when the tab closes) and is never sent anywhere except intervals.icu
itself, via the small PHP proxy described below.

## How it works

```
Browser (SPA) ──fetch──▶ proxy.php ──fetch──▶ intervals.icu API
```

Browsers can't call intervals.icu's API directly with Basic Auth from a
different origin because of CORS. `proxy/proxy.php` is a small, stateless
reverse proxy: it forwards whatever `Authorization` header and body the app
sends, straight through to `https://intervals.icu/api/v1/...`, and forwards
the response back. It never stores or reads your API key itself.

## Readiness algorithm

For each of rMSSD and resting HR, today's value is turned into a z-score
against the trailing 30-day mean/standard deviation (rMSSD is first
log-transformed: `20 * ln(rMSSD)`, same as the original script). Those two
z-scores are run through the same decision tree as the MATLAB version to
produce one of: `HIT`, `Normal`, `LIT`, `LIT!`, `Rest`, `REST!`, or "no data".
That result maps to a `TrainingAdvice` code (1-4) that gets written back to
intervals.icu when "Write today's readiness back to intervals.icu" is enabled
in settings.

## Local development

```bash
npm install
npm run dev
```

This serves the SPA only — API calls will fail until you either run
`proxy.php` locally (`php -S localhost:8080 -t proxy`) and point the app's
"Proxy URL" setting at it, or deploy the proxy somewhere reachable.

## Deploying the app (static hosting / GitHub Pages)

`npm run build` produces a fully static `dist/` folder — host it anywhere
(GitHub Pages, Netlify, a plain web host, a subfolder of your own domain).

A ready-to-use workflow is included at `.github/workflows/deploy.yml`: it
builds the app and publishes `dist/` to GitHub Pages on every push to `main`.
To enable it, go to the repo's **Settings → Pages** and set the source to
"GitHub Actions".

## Deploying the proxy (PHP hosting)

Copy `proxy/proxy.php` to any PHP host (requires PHP with the `curl`
extension, which is on by default almost everywhere). No configuration is
required, but two things are worth checking:

- **CORS**: `proxy.php` defaults to `Access-Control-Allow-Origin: *`. If the
  app and the proxy are hosted on the same domain this doesn't matter; if the
  app is on GitHub Pages and the proxy is on your own host (different
  origins), the wildcard is what makes that combination work. You can
  tighten it by editing the `ALLOWED_ORIGIN` constant at the top of the file.
- **Authorization header stripping**: some Apache + PHP-FPM setups drop the
  `Authorization` header before PHP ever sees it. If requests fail with
  "Missing Authorization header", add this to a `.htaccess` next to
  `proxy.php`:
  ```apache
  SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
  ```

## Configuring the app

On first load (or via the gear icon), the settings screen asks for:

- **Athlete ID** and **API key** — from intervals.icu: Settings → Developer.
- **Proxy URL** — where you deployed `proxy.php`, e.g. `./proxy.php` if it
  sits next to the app, or a full URL if it's hosted elsewhere.
- **Write today's readiness back to intervals.icu** — mirrors the original
  script's `trainingAdviceMustBeSentToIntervals` setting.

An **Advanced** section exposes the same knobs the MATLAB config had:
custom wellness field names for rMSSD/SDNN/resting HR (for setups using
Snapshot fields instead of the defaults), and the trend chart windows
(short-term/long-term days, expected-range width in standard deviations).

Settings are stored in `sessionStorage`, scoped to the browser tab — closing
the tab clears them, so you'll re-enter them next visit. That's a deliberate
simplicity trade-off for a single-athlete personal tool, not an oversight.

## What changed from the MATLAB version

- Single athlete only — no coach/multi-athlete menu.
- No "yesterday's activity" panel (power/HR stream chart, RPE/feel/etc.).
- The 3D polar readiness chart was replaced with a simpler semicircle gauge
  with the same color-coded zones, better suited to a small screen.
- Time zone handling was dropped — the browser's local time is used directly.
- UI text is in English regardless of the browser locale.
