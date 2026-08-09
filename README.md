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
Browser (SPA) ──fetch──▶ proxy ──fetch──▶ intervals.icu API
```

Browsers can't call intervals.icu's API directly with Basic Auth from a
different origin because of CORS. The [`proxy/`](proxy) folder holds four
drop-in options (PHP, JavaScript, Python) for a small, stateless reverse
proxy: it forwards whatever `Authorization` header and body the app sends,
straight through to `https://intervals.icu/api/v1/...`, and forwards the
response back. None of them store or read your API key themselves.

There is no backend and no account system — it's a static single-page app.
Your intervals.icu API key is kept in the browser's `localStorage` only
(so it survives closing the tab — you don't have to re-enter it every
visit) and is never sent anywhere except intervals.icu itself, via whichever
proxy you deploy. Use "clear site data" in your browser, or a
private/incognito window, if you don't want it kept around.

## Readiness algorithm

For each of rMSSD and resting HR, today's value is turned into a z-score
against the trailing 30-day mean/standard deviation (rMSSD is first
log-transformed: `20 * ln(rMSSD)`, same as the original script). Those two
z-scores are run through the same decision tree as the MATLAB version to
produce one of: `HIT`, `Normal`, `LIT`, `LIT!`, `Rest`, `REST!`, or a seventh
"no data" state (shown on screen as `...?`, when today has no HRV
measurement or the trailing window has zero variability). Each of the six
real results maps to a `TrainingAdvice` code from 1 (worst) to 4 (best); "no
data" isn't one of them, and nothing is written to intervals.icu on a
no-data day at all — whatever was already stored for today (nothing, or a
value from an earlier point in the day) is left untouched rather than
proactively cleared, since a blank write isn't guaranteed to round-trip
through intervals.icu as blank. This is written back to intervals.icu when
"Write today's readiness back to intervals.icu" is enabled in settings, and
only once a real code is available. If intervals.icu's stored value for
today already matches what GoReady would send, it's left alone instead of
being re-sent on every page load; if it differs — including a stale value
left over from earlier in the day — it's overwritten with the current code.

The gauge plots today's HRV/RHR z-scores as a point on a polar chart (angle =
RHR z-score, radius = HRV z-score), the same geometry the original MATLAB
chart used, with a fading trail showing where the last several days sat on
the same chart. The chart paints five colored bands (not one per readiness
code — codes 2 and 3 both mean "train easy" and share the orange band). A
small ⓘ button opens a dialog that names each band as the reference chart
itself does (Stress / illness, Rest, Limit intensity, Train as planned, HIT)
with a short description of the underlying RHR/HRV pattern, followed by the
reference chart itself for anyone who wants the full diagram.

## Insights

Under the readiness status the app shows up to three supplementary
observations, plus a confidence badge. **All of it is display-only**: the
readiness code, its color, the gauge, and the `TrainingAdvice` value written
back to intervals.icu come solely from `classify()` in `src/score.ts`,
whatever these say. Rules live in `src/insights.ts` and the statistics they
run on in `src/baseline.ts`.

### Baseline confidence

The z-scores behind the readiness code are measured against a trailing 30-day
window, and nothing in the original algorithm checks how much of that window
actually holds measurements. Because the standard deviation divides by N, the
largest `|z|` that N observations can produce is exactly `sqrt(N - 1)` — and
every threshold in `classify()` sits within `|z| <= 2`. So on a thin baseline
whole bands are not merely unlikely but arithmetically unreachable, if both
axes are equally thin:

| valid days (both axes) | max abs z | consequence |
|---|---|---|
| 2 | 1.00 | every band unreachable — **always** "Train as planned" |
| 3 | 1.41 | `Rest` and `Stress / illness` still unreachable; `Limit intensity` and `HIT` already are not |
| 4 | 1.73 | only `Rest` remains unreachable |
| 5 | 2.00 | every band reachable |
| 10 | 3.00 | the gauge's full ±3 range first reachable |

HRV and resting HR keep separate baselines, though, so a thin baseline on one
axis doesn't restrict the other: `HIT` needs a large HRV z-score but only a
small resting-HR one (within `(-1, 1]`), so a rich HRV history paired with
just two days of resting-HR history can still produce a genuine `HIT` — the
badge's `unreachableBands` check reasons about the two axes independently for
exactly this reason, rather than judging every band off whichever axis has
less history.

Below 5 measured days *on either axis* the badge says which bands cannot be
reached; below 21
(the three-week minimum the resting-HR literature works to) it marks the score
provisional. The score itself and the write-back are untouched either way — the
badge exists so a green "Train as planned" that really means "we cannot tell"
does not read as reassurance.

### What the rules look at

- **Readings that look like a bad capture.** A single artifact does double
  damage: it mis-scores today, and then sits in the trailing baseline for 30
  days inflating the standard deviation, quietly compressing every later
  z-score toward zero. Detected with the Iglewicz-Hoaglin modified z-score
  (median and MAD, so the outlier cannot inflate the spread it is judged
  against), plus a floor of 25% from the recent median so a very steady athlete
  doesn't get a merely-low morning called an artifact, and a check that the
  rest of the week is normal — a sustained shift is a real shift, not a bad
  capture. Ranked first when it fires, because it makes everything else on
  screen suspect. The day is still *shown*, and still counts toward the
  baseline; excluding it would change the readiness code.
- **The reference chart's named regions** — "optimum pre-race", "not coping
  well during loading", and "coping well during training blocks". These are
  refinements *within* the `HIT`/`Normal` zone with no `TrainingAdvice` code of
  their own, and are this app's own approximate reading of the reference
  chart's layout rather than part of the original algorithm. Suppressed on an
  unusable baseline, being the one rule that reads today's single-day z-scores.
- **7-day mean vs the 60-day baseline**, with a smallest-worthwhile-change band
  of half the baseline SD. Single mornings are noise; several days averaged is
  what tracks performance (Plews & Buchheit, 2013).
- **Coefficient of variation** of the last week's ln-HRV against the athlete's
  own typical week. A widening CV often moves before the average does; a CV
  that *collapses* while the mean sits below baseline is the pattern Plews'
  case studies associate with non-functional overreaching.
- **Streaks** outside the expected range, computed from the very same band the
  trend-chart bars are colored by, so the sentence and the chart cannot disagree.
- **HRV and resting HR read together.** HRV would normally rise as resting HR
  falls, so both sitting below baseline for a week is flagged — and when load
  data says a block is ramping hard, named as parasympathetic saturation, where
  a healthy-looking low resting HR is not the good news it appears to be.
- **Context** for a poor reading: a short night, or a hard CTL ramp. Never fires
  without the data, and never on a day when nothing is wrong.
- **This week's own measurement count.** The confidence badge answers a
  different question — whether the 30-day baseline behind *today's* score is
  thick enough. It says nothing about whether the last 7 days themselves have
  enough readings for the 7-day-mean, CV, and coupling rules above to mean
  anything; a good baseline and a week of missed syncs can coexist. Flags it
  by name when either metric falls short (Plews & Buchheit, 2013, require a
  minimum count of valid days before trusting a weekly average) — but stays
  quiet when the baseline itself is already unusable, since that badge is
  already the headline problem.

Rules that need HRV use rMSSD, or SDNN when that is the metric the athlete
actually records — so an SDNN-only setup gets insights instead of silence. The
readiness score stays rMSSD-only regardless.

Because insights sit beside a code they cannot change, they are worded not to
contradict it: a week-long slump and a strong single morning genuinely co-occur,
so a rule that reads the week reports what it sees and leaves the reader to
weigh it against today's score.

### What this score measures

A collapsed note under the insights, on every visit rather than only when
something fires: HRV and resting HR read autonomic recovery — not the
muscular, tendon, or joint recovery that follows previous training on its
own, often slower, timeline. An attempt to detect that from data the API
already exposes — elevation loss, pace variability, decoupling — was tested
against real activity history before writing any code, and didn't hold up:
on the exact hard session it was meant to catch, those metrics came in
*below* baseline, confounded by heat and workout type far more than by
accumulated fatigue. Rather than ship a rule that misses the case it exists
for, this just says the constructive thing plainly instead: weigh the score
alongside how your legs and joints actually feel, especially after a long or
hard session.

## Local development

```bash
npm install
npm run dev
```

This serves the SPA only — API calls will fail until you either run the PHP
proxy locally (`php -S localhost:8080 -t proxy/php`) and point the app's
"Proxy URL" setting at it, or deploy one of the proxy options below
somewhere reachable.

## Deploying the app (static hosting / GitHub Pages)

`npm run build` produces a fully static `dist/` folder — host it anywhere
(GitHub Pages, Netlify, a plain web host, a subfolder of your own domain).

A ready-to-use workflow is included at `.github/workflows/deploy.yml`: it
builds the app and publishes `dist/` to GitHub Pages on every push to `main`.
To enable it, go to the repo's **Settings → Pages** and set the source to
"GitHub Actions".

## Installing as an app

GoReady is a installable PWA: on Android, Chrome shows an "Install app" prompt
(or use the browser menu → "Install app"); on iPhone, use Safari's Share sheet
→ "Add to Home Screen". Either way it launches full-screen, without browser
chrome, and its icon/name follow whatever's set in `vite.config.ts`'s
`VitePWA({ manifest: ... })`.

The icon artwork lives in one place, `public/favicon.svg` — running
`npm run generate-pwa-assets` regenerates every derived size (192/512,
maskable, apple-touch-icon, favicon.ico) into `public/` from that one file via
[`@vite-pwa/assets-generator`](https://vite-pwa-org.netlify.app/assets-generator/).
Regenerate and commit the results whenever the source SVG changes; this isn't
run automatically as part of `npm run build`.

The generated service worker precaches only this build's own `dist/` output
(the app shell), so the app still opens offline. It never caches intervals.icu
requests through the proxy — those always hit the network and fail through to
the app's existing error screen when offline, the same as before this feature
existed. Serving a cached wellness reading as if it were today's would be
actively wrong, not just stale.

## Deploying the proxy

Four drop-in options, in [`proxy/`](proxy) — PHP (any PHP host), JavaScript
(Vercel or Netlify), and Python (Vercel), all doing exactly the same job. See
[`proxy/README.md`](proxy/README.md) for a comparison table and deploy steps
for each; the PHP one is `proxy/php/proxy.php` specifically, and has one
extra thing worth knowing:

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
- **Proxy URL** — where you deployed one of the [proxy options](proxy), e.g.
  `./proxy.php` if the PHP version sits next to the app, or a full URL (like
  `https://your-project.vercel.app/api/proxy`) if it's hosted elsewhere.
- **Write today's readiness back to intervals.icu** — mirrors the original
  script's `trainingAdviceMustBeSentToIntervals` setting.

An **Advanced** section exposes the same knobs the MATLAB config had:
which HRV metric(s) to display (rMSSD, SDNN, or both — resting HR is always
shown), custom wellness field names for rMSSD/SDNN/resting HR (for setups
using Snapshot fields instead of the defaults), and the trend chart windows
(short-term/long-term days, expected-range width in standard deviations).

Alongside those, the app also requests a few read-only wellness columns
(`ctl`, `atl`, `rampRate`, `sleepSecs`, `sleepScore`) so the insights can add
context like "HRV is down after a hard ramp". Sleep duration and score are
also shown as two extra rows in the stats table (duration as `7h30`); `ctl`,
`atl` and `rampRate` stay insight-only, since raw training-load numbers are a
different concern than recovery readiness. Nothing that drives the readiness
score reads any of them, and there is nothing to configure: any column your
account doesn't populate is simply treated as missing.

The button to the left of the gear icon cycles the color theme: system
(default) → light → dark → system. The choice is kept in `localStorage`,
same as the rest of the settings.

Settings (including your API key) are stored in `localStorage`, scoped to
the browser/origin — they survive closing the tab or the browser, so you
only enter them once. Clear them from the browser's site data settings, or
use a private/incognito window, if you'd rather they not persist.

## What changed from the MATLAB version

- Single athlete only — no coach/multi-athlete menu.
- No "yesterday's activity" panel (power/HR stream chart, RPE/feel/etc.).
- The polar readiness chart is an SVG port of the original, sized for a small
  screen, with the zone legend and the original chart both moved into an
  on-demand dialog (via the ⓘ button) since the chart itself has no room for
  legible zone labels at mobile sizes.
- Time zone handling was dropped — the browser's local time is used directly.
- UI text is in English regardless of the browser locale.
- The insights and the baseline-confidence badge (see above) are additions, not
  ports. The scoring itself is unchanged.
- Trend-chart bars outside the expected range are hatched as well as colored.
  In-range and out-of-range are green and red, which differ by only about
  4 ΔE under deuteranopia, so the hatch — not the color — is what actually
  carries that distinction for red-green colorblind readers and in print.
  Values are printed over the most recent, highest and lowest bars rather than
  all thirty, which collided into an unreadable smear at phone widths.

## Running the tests

```bash
npm test
```

Unit tests (Vitest) cover the readiness scoring decision tree, the gauge's
z-score-to-pixel geometry, the rolling-window statistics and baseline
confidence tiers, every insight rule, CSV parsing, and the trend-chart
windowing math.
