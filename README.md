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
produce one of: `HIT`, `Normal`, `LIT`, `LIT!`, `Rest`, `REST!`, or "no data".
That result maps to a `TrainingAdvice` code (1-4) that gets written back to
intervals.icu when "Write today's readiness back to intervals.icu" is enabled
in settings. If intervals.icu already has a `TrainingAdvice` value for today
(e.g. from an earlier refresh), GoReady leaves it alone instead of writing it
again on every page load.

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
whole zones are not merely unlikely but arithmetically unreachable:

| valid days | max abs z | consequence |
|---|---|---|
| 2 | 1.00 | every branch unreachable — **always** "Train as planned" |
| 3 | 1.41 | no `LIT`, `Rest` or `REST!` |
| 5 | 2.00 | all branches first reachable |
| 10 | 3.00 | the gauge's full ±3 range first reachable |

Below 5 measured days the badge says which bands cannot be reached; below 21
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

Rules that need HRV use rMSSD, or SDNN when that is the metric the athlete
actually records — so an SDNN-only setup gets insights instead of silence. The
readiness score stays rMSSD-only regardless.

Because insights sit beside a code they cannot change, they are worded not to
contradict it: a week-long slump and a strong single morning genuinely co-occur,
so a rule that reads the week reports what it sees and leaves the reader to
weigh it against today's score.

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

Alongside those, the app also requests a few read-only wellness columns
(`ctl`, `atl`, `rampRate`, `sleepSecs`, `sleepScore`) purely so the insights
can add context like "HRV is down after a hard ramp". Nothing that drives
the readiness score reads them, and there is nothing to configure: any
column your account doesn't populate is simply treated as missing.

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
