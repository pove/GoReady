# GoReady

A mobile-first daily training readiness dashboard for a single [intervals.icu](https://intervals.icu)
athlete. It's a TypeScript rewrite of a personal MATLAB script: it reads resting
heart rate and HRV (rMSSD/SDNN) from intervals.icu, scores how ready you are to
train today, shows that score on a gauge plus a 30-day trend for each metric,
and (optionally) writes the score back to intervals.icu as the `TrainingAdvice`
wellness field.

## Credits

The scoring algorithm and readiness gauge are based on a MATLAB script
originally written by **[@Inigo_Tolosa](https://forum.intervals.icu/u/Inigo_Tolosa)**
on the intervals.icu forum — see the
["How-to guide: ImReady4 app for HRV-guided training"](https://forum.intervals.icu/t/how-to-guide-imready4-app-for-hrv-guided-training/25778)
thread. All credit for the underlying method goes to them.

## How it works

```
Browser (SPA) ──fetch──▶ proxy.php ──fetch──▶ intervals.icu API
```

Browsers can't call intervals.icu's API directly with Basic Auth from a
different origin because of CORS. `proxy/proxy.php` is a small, stateless
reverse proxy: it forwards whatever `Authorization` header and body the app
sends, straight through to `https://intervals.icu/api/v1/...`, and forwards
the response back. It never stores or reads your API key itself.

There is no backend and no account system — it's a static single-page app.
Your intervals.icu API key is kept in the browser's `sessionStorage` only
(cleared when the tab closes) and is never sent anywhere except intervals.icu
itself, via the small PHP proxy described below.

## Readiness algorithm

For each of rMSSD and resting HR, today's value is turned into a z-score
against the trailing 30-day mean/standard deviation (rMSSD is first
log-transformed: `20 * ln(rMSSD)`, same as the original script). Those two
z-scores are run through the same decision tree as the MATLAB version to
produce one of: `HIT`, `Normal`, `LIT`, `LIT!`, `Rest`, `REST!`, or a seventh
"no data" state (shown on screen as `...?`, when today has no HRV
measurement or the trailing window has zero variability). Each of the six
real results maps to a `TrainingAdvice` code from 1 (worst) to 4 (best); "no
data" isn't one of them — it clears the field instead, sending an empty
value rather than a number. That value gets written back to intervals.icu
when "Write today's readiness back to intervals.icu" is enabled in settings.
If intervals.icu already has a `TrainingAdvice` value for today (e.g. from
an earlier refresh), GoReady leaves it alone instead of writing it again on
every page load.

The gauge plots today's HRV/RHR z-scores as a point on a polar chart (angle =
RHR z-score, radius = HRV z-score), the same geometry the original MATLAB
chart used, with a fading trail showing where the last several days sat on
the same chart. The chart paints five colored bands (not one per readiness
code — codes 2 and 3 both mean "train easy" and share the orange band). A
collapsed "What do the zones mean?" panel below the gauge names each band as
the reference chart itself does (Stress / illness, Rest, Limit intensity,
Train as planned, HIT), and a small ⓘ button opens that reference chart.

That reference chart also highlights three named regions — "optimum
pre-race", "not coping well during loading", and "coping well during
training blocks" — that don't map to a distinct `TrainingAdvice` code of
their own; they're refinements *within* the `HIT`/`Normal` zone. When
today's point falls in one of them, `src/insights.ts` adds a supplementary
sentence under the status detail text (e.g. "Resting HR is up but HRV is
still strong - this pattern looks like 'optimum pre-race'"). Those bands are
this app's own approximate reading of the reference chart's layout, not
part of the original algorithm, so they only ever add an extra sentence —
never change the readiness code, color, or the `TrainingAdvice` value.

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
which HRV metric(s) to display (rMSSD, SDNN, or both — resting HR is always
shown), custom wellness field names for rMSSD/SDNN/resting HR (for setups
using Snapshot fields instead of the defaults), and the trend chart windows
(short-term/long-term days, expected-range width in standard deviations).

The button to the left of the gear icon cycles the color theme: system
(default) → light → dark → system. The choice is kept in `sessionStorage`,
same as the rest of the settings.

Settings are stored in `sessionStorage`, scoped to the browser tab — closing
the tab clears them, so you'll re-enter them next visit. That's a deliberate
simplicity trade-off for a single-athlete personal tool, not an oversight.

## What changed from the MATLAB version

- Single athlete only — no coach/multi-athlete menu.
- No "yesterday's activity" panel (power/HR stream chart, RPE/feel/etc.).
- The polar readiness chart is an SVG port of the original, sized for a small
  screen, with a collapsed text legend added underneath (and the original
  chart available on demand via the ⓘ button) since the chart itself has no
  room for legible zone labels at mobile sizes.
- Time zone handling was dropped — the browser's local time is used directly.
- UI text is in English regardless of the browser locale.

## Running the tests

```bash
npm test
```

Unit tests (Vitest) cover the readiness scoring decision tree, the gauge's
z-score-to-pixel geometry, the supplementary training-phase notes, CSV
parsing, and the trend-chart windowing math.
