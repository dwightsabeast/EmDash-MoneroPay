# Spike: Coffer on EmDash's Cloudflare runner (phase 07, before the watch-list redesign)

Throwaway. Nothing here ships. Findings go to `docs/spike-findings.md`, and the redesign they decide goes to `docs/spec-changes.md`.

## Why

Coffer has only ever run on EmDash's Node runner (workerd as a child process), which enforces only a 30 s wall time.

On Cloudflare, each sandboxed plugin call is a Dynamic Worker, and Worker Loader enforces **50 ms CPU and 10 subrequests** per call (EmDash docs, "Configure the plugin sandbox"). Many EmDash sites run there, and the registry listing reaches them.

In phase 07 session 7a:
- **The watch-list scan reads up to 1,000 invoices per query,** and silently truncates beyond that.
- **A 15,000-invoice sync took 183–230 ms on the dev box.**
- **The docs don't say whether storage calls through the plugin bridge count as subrequests.** If they do, checkout (about a dozen storage and KV calls) and a 100-snapshot sync are already over 10.

## Questions

1. **Does a call through the plugin bridge count as a subrequest?**
   - storage `get`, `query` and `put`
   - KV `get` and `set`
   - `ctx.content.get`
   - settings
   - `ctx.http.fetch` (expected to count)
2. **CPU per operation** (`performance.now()` doesn't advance in Workers, so it's measured by finding the failure threshold):
   - a page of 100 invoices read and parsed
   - an invoice written
   - the core's `evaluate`
3. **Coffer as built, with ordinary data:** does each call pass? Checkout (tip), status, the admin page load, and syncs with 0, 10 and 100 snapshots.
4. **Coffer under a flood:** the watch scan with 1,000, 3,750 and 15,000 invoices.
5. **What the runner reports when a limit is hit:** the error text, and whether the route returns 500 or the call is retried.

## Method

- **A throwaway EmDash site on Cloudflare Workers** (a `workers.dev` hostname), deployed from `~/sites/xmr-cf-spike`:
  - D1 `DB`, R2 `MEDIA`, `worker_loaders` `LOADER`
  - `sandboxRunner: sandbox()`
  - the per-minute cron
- **Coffer** (the current `plugin/` build, `sandboxed: [coffer]`).
- **A tiny spike plugin, `spikes/cf-runner/limits/`:** public routes that each do N of one operation (KV get, storage query, put, content get, an empty `ctx.http.fetch` to an allowed host), plus a CPU loop. Questions 1 and 2 are answered by stepping N until the runner refuses.
- **A driver script on the dev box:**
  - It calls the routes over HTTPS.
  - It fills storage through a dev-only seeding route in the spike plugin, so Coffer is never changed.
  - It signs bridge syncs with the throwaway dev keys (the RFC 8032 test key, as the tests do).
  - **No wallet, no real money, no stagenet node:** the syncs are fake bridge requests.

## What Wyatt does (every account step is yours)

1. **A Cloudflare account on the Workers Paid plan** (Worker Loader needs it; USD 5 a month at the time of writing; check the current price).
2. **Choose how deploys are authorized:**
   - **(a, recommended)** A Cloudflare API token limited to this account, with Workers Scripts Edit, D1 Edit and R2 Edit only. You save it in `~/.config/xmr-pay-dev/cloudflare.env` (mode 600). I run `wrangler` through a wrapper like `scripts/with-shop-env.sh`, never printing it. You revoke it after the spike.
   - **(b)** You run `pnpm wrangler login` and `pnpm wrangler deploy` yourself in your tmux window when I ask.
3. **Close the throwaway site's setup:** a fresh EmDash site on a public hostname offers its setup wizard to whoever arrives first.
   - Either you finish the wizard right after the first deploy,
   - or put Cloudflare Access in front of the `workers.dev` hostname, except `/_emdash/api/plugins/*`, as with `dev.wyattdilley.com`.
4. **At the end:** delete the Worker, the D1 database and the R2 bucket, and revoke the token.

## Approvals (Wyatt, 2026-10-16: the working area and dependencies approved; deploys by option A; walkthrough in SETUP.md)

- **A new working area:** `~/sites/xmr-cf-spike` (outside the listed working areas).
- **Dependencies for that throwaway site only** (never shipped), exact pins and the 7-day age rule:
  - `wrangler` (Cloudflare, MIT/Apache-2.0)
  - `@astrojs/cloudflare` (Astro core team, MIT)
  - `@emdash-cms/cloudflare` (EmDash, MIT)
  - Plus EmDash's own template packages, if the site starts from `npm create emdash` with a Cloudflare template.
- The spike plugin's dev-only seeding route lives only in the spike plugin.

## Out of scope

Changing Coffer during the spike. Measuring real payments. Anything on `wyattdilley.com`.
