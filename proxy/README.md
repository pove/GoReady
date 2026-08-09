# GoReady proxy

Browsers can't call intervals.icu's API directly with Basic Auth from a
different origin because of CORS. Every option here is the same tiny,
stateless reverse proxy — it forwards whatever `Authorization` header and
body the app sends, straight through to `https://intervals.icu/api/v1/...`,
and forwards the response back. None of them store or read your API key;
they just relay it.

Pick whichever fits where you're already hosting the app, or whichever free
tier you'd rather use:

| Folder | Language | Where it runs | Requires |
|---|---|---|---|
| [`php/`](php) | PHP | Any PHP host (shared hosting, etc.) | PHP with the `curl` extension |
| [`vercel-node/`](vercel-node) | JavaScript | Vercel (free tier) | Nothing — no build step |
| [`vercel-python/`](vercel-python) | Python | Vercel (free tier) | Nothing — standard library only |
| [`netlify/`](netlify) | JavaScript | Netlify (free tier) | Nothing — no build step |


Once deployed, point the app's **Proxy URL** setting at wherever you put it
(see each folder for the exact URL shape) — that's the only wiring needed;
nothing else in the app changes based on which proxy you pick.

## Deploying to Vercel or Netlify (dashboard, no CLI needed)

Both platforms support deploying a subdirectory of a repo as its own project,
which is what lets all of these live side by side in one repo:

1. Push this repo to GitHub (or your own fork of it).
2. On Vercel or Netlify, "Import" / "Add new site" from that repo.
3. Set **Root Directory** (Vercel) or **Base directory** (Netlify) to the
   folder for the option you want, e.g. `proxy/vercel-node`.
4. Deploy. No build command or environment variables are needed for any of
   these — they're all zero-dependency.

Prefer the CLI? `vercel --cwd proxy/vercel-node` / `vercel --cwd
proxy/vercel-python`, or `netlify deploy --dir=proxy/netlify` (add `--prod`
once you're happy with a preview), run from the repo root.

## CORS

Every variant defaults to `Access-Control-Allow-Origin: *`. If the app and
the proxy end up on the same origin this doesn't matter; if they're on
different origins (e.g. the app on GitHub Pages, the proxy on Vercel), the
wildcard is what makes that combination work. Tighten it by editing the
`ALLOWED_ORIGIN` constant near the top of whichever file you deployed.

## Security note

Each variant validates the `path` query parameter before forwarding it, so
the proxy can't be turned into an open relay to arbitrary hosts (no absolute
URLs, no `..`, no protocol-relative paths). It's the same check in every
language — see `isValidApiPath` / `is_valid_api_path` in whichever file you're
looking at.
