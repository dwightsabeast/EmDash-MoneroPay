# Progress log

Newest entry at the bottom. Each session appends one entry:

```text
## YYYY-MM-DD · Phase NN · short title
Done:
Tests: (commands run and results)
Open issues:
Next step:
```

## 2026-10-01 · Starter kit

Done: Starter kit assembled outside Claude Code: spec snapshot, decisions, ground rules, phase prompts, proof of concept, EmDash reference. Dev box set up per the runbook (stagenet node syncing, dev site running).
Tests: none yet.
Open issues: license and repository visibility to choose in phase 00. The repository exists (`dwightsabeast/EmDash-MoneroPay`, one commit with `.gitattributes`).
Next step: Phase 00, `docs/phases/00-repo-bootstrap.md`.

## 2026-10-02 · Phase 00 · Repo bootstrap

Done: Preflight passed (user `dev`, real noreply git identity, `git ls-remote origin` OK over SSH, dev site owned by `dev`, `kit-setup/` gone). Scripts made executable. Exact tool versions recorded in `docs/dev-environment.md` (local only). Wyatt chose MIT (copyright Wyatt Dilley) and a public repository from now; both recorded in `docs/decisions.md`. Added `LICENSE` and a public `README.md`. Removed the dev box's LAN address from `docs/phases/05-setup-test.md` (it now points to `docs/dev-environment.md`). Committed the kit after a staged-file scan (no LAN address, no key-like strings, local-only files not staged). `emdash-docs` MCP answers `search_docs`.
Tests: `scripts/check-env.sh`: all `[ok]`. Node v24.21.0, pnpm 12.8.1, Go 1.27.1, git 2.47.3, jq 1.7, Claude Code 2.1.288, Monero v0.18.5.1, `monerod-stagenet` active and synced at height 2220727, `stagenet.env` mode 600, workerd 2026-10-02, sandboxRunner configured, dev site answering on localhost:4321. No code tests yet (no code).
Open issues: The spec's manifest still reads `<SPDX id>`. Wyatt to set it to `MIT` in the live spec and refresh `docs/spec.md`. The repo's initial commit (`bd94c9e`) carries Wyatt's personal email; Wyatt chose not to rewrite history and turned on GitHub's email privacy settings instead. Wyatt switches the repository to public on GitHub himself.
Pushed: `bd94c9e..242f82e` to `origin/main`, with Wyatt's approval; `git ls-remote origin` matched local HEAD.
Next step: Phase 01, `docs/phases/01-spike.md`.

## 2026-10-03 · Phase 01 · Reminder: delete the release-age excludes on 2026-10-08

**Done 2026-10-08, 23:10 UTC (session 3j):** both blocks deleted (`plugin/`, `spikes/xmr-spike/`); `pnpm install` in each passed the supply-chain check with `pnpm-lock.yaml` unchanged; plugin tests 122/122.

Done: `spikes/xmr-spike/` installed with `minimumReleaseAge: 10080` (7 days) and 12 exact-version `minimumReleaseAgeExclude` entries for the EmDash 1.1.0 release (published 2026-10-01), approved by Wyatt: `emdash@1.1.0`, `@emdash-cms/blocks@1.1.0`, `plugin-types@0.5.0`, `plugin-test@0.2.7`, `plugin-cli@0.13.2`, `cloudflare@1.1.0`, `admin@1.1.0`, `auth@1.1.0`, `gutenberg-to-portable-text@1.1.0`, `registry-client@0.7.0`, `registry-lexicons@0.7.0`, `registry-verification@0.3.3`. Nine match `~/sites/xmr-dev-site/package-lock.json` exactly; `plugin-test`, `plugin-cli` and `cloudflare` aren't in the site and were accepted on provenance (same release commit `913cb1bb9b7f` of `emdash-cms/emdash` as the site's `emdash@1.1.0`). All 12 carry verified registry signatures and SLSA v1 provenance from `emdash-cms/emdash` `.github/workflows/release.yml`; `npm audit signatures` in the dev site: 698 verified signatures, 253 verified attestations, none invalid or missing.
Tests: `pnpm install` (clean) and the scaffold's `pnpm test` (1 passed).
Open issues: none for this item.
Next step: **On or after 2026-10-08**, delete the whole `minimumReleaseAgeExclude` block from `spikes/xmr-spike/pnpm-workspace.yaml` (and from any other package that copied it), run `pnpm install`, confirm it succeeds and `pnpm-lock.yaml` doesn't change, and commit, noting it in that day's entry. The exception list never grows.

## 2026-10-03 · Phase 01 · Spike

Done: Spike plugin `spikes/xmr-spike/` (slug `xmr-spike`, fake publisher DID) and `spikes/wallet/`, with dependency guardrails (exact pins, install-script allowlist, 7-day release age with 12 dated EmDash excludes). `docs/spike-findings.md` has a verdict and evidence for every question, plus recommendations. Gates: Q1 Ed25519 pass in the test host, `astro dev` and the built workerd server; Q2 no-`Origin` POST pass through the SSH tunnel and `dev.wyattdilley.com` behind Cloudflare Access; Q3 per-minute cron accurate (16/16 runs, 12–55 ms late; survives a restart), but config-managed plugins never get `plugin:install` or `plugin:activate` at startup. Q4: `ctx.settings` with encrypted secrets (secrets need `EMDASH_ENCRYPTION_KEY`, plain values don't). Q5: `requestMeta.ip` is `null` on Node unless trusted proxy headers are configured (then spoofable from outside Cloudflare). Q6: `updateIf` claims correct, concurrency not really exercised, PostgreSQL untested. Q7: `unlock_time` marks time locks, `locked` is the 10-block spendable age; time-locked sends are gone in Monero 0.18.5.1. Q8 skipped (Wyatt: no second `monerod` on this box). Q9: `backend.js` 4 KB. Spec changes: 1 accepted (bytes body, Wyatt's four bridge terms), 2–4 proposed. Also: `check-env.sh` nesting-depth check for `sandboxRunner` and a memory line; CLAUDE.md sections "Dependency tiers", "Working with Wyatt's PC" (SSH alias, scp a script and its output) and "Memory" (the box ran out of RAM; 8 GB is the maximum); decisions.md dependency-tiers row; phases 02/04/06 drop zod, `@emdash-cms/blocks` and QR packages; setup-friction rows for the misplaced `sandboxRunner`, the out-of-memory crash, astro's agent auto-background, and the PC command and output snags.
Tests: `cd spikes/xmr-spike && pnpm test`: manifest valid, 4 files, 21 tests passing; `tsc --noEmit` clean; `emdash-plugin bundle --validate-only` passed (9.5 KB across 3 files). Dev-site scripts: `send-vectors.mjs` all as expected on `astro dev` and the built server; `claim-race.mjs` 10/10 rounds on both; cron 15 min on `astro dev`, restart check, 5 min on the built server. `scripts/check-env.sh` all `[ok]` after cleanup. Not covered: real concurrent claims, PostgreSQL, a time-locked transfer, regtest, Cloudflare Workers limits.
Cleanup: dev site restored to the morning baseline (`astro.config.mjs`, `package.json`, `package-lock.json` byte-identical; `dist/` removed); the spike's 10 rows deleted from `data.db` (`_plugin_storage` 7, `_plugin_indexes` 2, `_emdash_cron_tasks` 1; backup in `~/xmr-pay-dev-data/baseline/data.db.before-spike-cleanup`); view-only wallet files and the wallet-rpc log deleted; dev site, built copy and wallet-rpc stopped. `~/xmr-pay-dev-data/q2-output-round{1,2}.txt` (Wyatt's unredacted IP) and `q2.ps1` are still there, local only.
Open issues: none blocking; Wyatt has read `docs/spike-findings.md` (2026-10-03), so phase 01's "done when" is met. Spec changes 1–5 are accepted and in live spec revision 69 and `docs/spec.md` (CLAUDE.md now says "raw bytes body"; regtest is "No, for now" in decisions.md). The snapshot's manifest `"license"` briefly read `"<SPDX id>"`; Wyatt set `MIT` in the live spec and `docs/spec.md` the same day. `dev.wyattdilley.com` removed; the unredacted Q2 output files deleted. Wyatt to remove the `dev.wyattdilley.com` hostname if not done. Delete the `minimumReleaseAgeExclude` list on or after 2026-10-08 (reminder above). The decisions.md "Still to decide" row on regtest stays open.
Next step: Phase 02, `docs/phases/02-plugin-core.md`, session 2a.

## 2026-10-03 · Phase 02 · Session 2a: scaffold

Done: `plugin/` scaffolded with `pnpm dlx @emdash-cms/plugin-cli@0.13.2 init xmr-pay --dir plugin --yes` (Wyatt's DID `did:plc:cmbxrwdt4hdl43g67bd6xegk`, the repo's GitHub security-advisory URL as security contact, MIT). Manifest = the spec's trust contract (revision 69), with the admin page at `/payments` because EmDash rejects `/` (spec change 6, accepted; Wyatt updates the live spec). A private `admin` route serves a placeholder page and the `xmr-status` widget (the bundle check requires it). Exact pins and the spike's guardrails, with the same 12 dated excludes (approved); the lockfile is identical to the spike's. Dev site: `products` collection and three test products from the committed `scripts/dev-products.seed.json` (`emdash seed`, no login; backup `~/xmr-pay-dev-data/baseline/data.db.before-products-seed`); the plugin installed as `file:../../xmr-pay/plugin` and listed in `sandboxed: [xmrPay]` (this replaces the spike's baseline as the site's normal state). Phase file updated to match spec changes 1–6; three setup-friction rows and a lesson; two CLAUDE.md command rows.
Tests: `cd plugin && pnpm test`: manifest valid, 2 tests passing (built manifest equals the trust contract; admin page and widget load through the runtime host's admin path); `tsc --noEmit` clean; `emdash-plugin bundle --validate-only` passed (2.7 KB). Dev site: log shows `Loaded sandboxed plugin xmr-pay:0.1.0 with capabilities: [content:read, network:request]`; `ec_products` has the three products (price stored as SQLite `REAL`). `scripts/check-env.sh` sandboxRunner depth check `[ok]`.
Open issues: Wyatt updates the live spec's admin page path to `/payments` and copies `docs/spec.md`. Excludes in `spikes/xmr-spike/` and `plugin/` to delete on or after 2026-10-08. Price conversion from `REAL` is a 2b/2d task (shortest decimal string, integer minor units). Dev site is stopped.
Next step: Session 2b, the pure core (money math, presets, counted / on-time / classify / evaluate, watch-list rules), with unit tests ported from the POC.

## 2026-10-03 · Phase 02 · Session 2b: pure core

Done: `plugin/src/core/` (no `ctx`, no clock, no I/O): `constants.ts` (the spec's tunables and presets), `money.ts` (`ceilDiv`, `expectedAtomic`, `paidThreshold`, exact XMR strings, decimal and stored-float price to minor units through the shortest decimal string), `presets.ts` (integer tier boundaries, raise-only `raiseRequired`), `invoice.ts` (invoice and transfer types ready for tip and order, `newInvoice`, `counted`, `onTime`, `totals`, `classify`, `evaluate` returning the new invoice plus events), `watch.ts` (`isWatched`). Follows the spec where the proof of concept differs: any-one on-time evidence (spec change 5), integer preset boundaries, no float price math. Wyatt's five answers and one new rule (an undecided unmined transfer waits while it can still be mined by `expiresHeight`) are in `docs/spec-changes.md` entry 7. Not wired into routes yet (2c/2d).
Tests: `cd plugin && pnpm test`: manifest valid, 4 files, 49 tests passing (47 core: money, presets, every POC scenario through a small chain-and-bridge simulator, core-level attacks, expire on evidence, spec change 5, inclusive boundaries, reopen, underpaid after expiry, watch list). Mutation check: removing the undecided wait, setting the tolerance to 100%, or counting time-locked transfers each fails exactly the tests aimed at it (2 each). `tsc --noEmit` clean; `bundle --validate-only` passed (2.7 KB; the core isn't imported yet).
Open issues: Wyatt to fold spec-changes entry 7 (and entry 6, `/payments`) into the live spec. Excludes to delete on or after 2026-10-08.
Next step: Session 2c, the sync protocol: `"bytes"` body, signature over the exact bytes, strict UTF-8 with a BOM rejected, freshness, protocol version, `seq`, pairing, pool top-up, watch-list response, and `contract/test-vectors/sync-signature.json`.

## 2026-10-03 · Phase 02 · Session 2c: sync protocol

Done: `plugin/src/sync/`: `protocol.ts` (version 1 plus the previous one flagged outdated, 300 s freshness, caps: 256 KiB body, 100 addresses, 100 snapshots, 32 transfers per snapshot; header checks; Ed25519 over ts + "\n" + exact bytes with WebCrypto; strict UTF-8 with a BOM refused; hand-written body validation), `merge.ts` (seq ordering, seenAt/poolTs kept, snapshot overwrite, then `evaluate`), `pairing.ts` (128-bit code as 22 base64url chars, stored only as a SHA-256 hash, 15-minute expiry, burned on use), `handle.ts` (`handleSync` against a `SyncStore` interface, in the spec's order; returns the response and lifecycle events). Error codes as agreed with Wyatt. One deviation from what Claude told Wyatt, to keep the spec's rule that a body is parsed before verification only while a code is active: a used or expired code fails as `NOT_PAIRED` or `BAD_SIGNATURE`, not `PAIRING_REJECTED` (documented in `contract/test-vectors/README.md`). Shared vectors: `contract/test-vectors/sync-signature.json` (9 cases, RFC 8032 TEST 1 and TEST 2) generated by `make-sync-signature.mjs`, which checks both keys against the RFC's own signatures first. Not wired into the route or storage yet (2d).
Tests: `cd plugin && pnpm test`: 7 files, 85 tests passing (36 new: every vector through the protocol functions and `handleSync`; headers and freshness; strict decoding; body validation, versions and caps; pairing: success, wrong code, wrong signer, expired, reused, pair without a code, over 4 KiB, a new pairing replacing the key; forged, tampered, stale and BOM requests changing nothing; pool top-up; snapshots; replays and idempotent retries; the watch list; pairing to settled end to end). Mutation check: strict decoding off, expired codes accepted, or the seq check removed each fails the tests aimed at it. `tsc --noEmit` clean; `bundle --validate-only` passed (2.7 KB; not wired yet).
Open issues: none new. Excludes to delete on or after 2026-10-08; spec changes 6 and 7 to fold into the live spec.
Next step: Session 2d, routes and storage: the `checkout`, `status` and `bridge/sync` routes, a `SyncStore` on `ctx.storage` and `ctx.kv`, the housekeeping batches in `bridge/sync`, backup cron scheduling, `plugin:uninstall`, rate fetch (after checking the price APIs' terms), pool claims, spam limits.

## 2026-10-03 · Phase 02 · Session 2d-1: bridge/sync on real storage

Done: Price sources decided (spec change 8, accepted: Kraken first, CoinGecko keyless as fallback, USD and EUR only; decisions.md updated). `plugin/src/store.ts`: `CtxSyncStore` (bridge key and settings in `ctx.settings`, pairing and bridge state and alerts in KV, pool and invoices in storage with bounded paged queries; pool rows created only when absent so a claimed row is never reset) and `deletePluginData`. `plugin/src/housekeeping.ts`: the 30-day buyer-data purge in batches of 25 with a KV cursor, and `ensureCron` (hourly `housekeeping` task, idempotent). `plugin/src/plugin.ts`: the `bridge/sync` route exactly as the spec declares it (public, POST, `"bytes"`, the two headers, 256 KiB), alerts recorded in KV, a purge batch after each successful sync; hooks `plugin:install` and `plugin:activate` (schedule the cron), `cron` (purge), `plugin:uninstall` (deletes data only with `deleteData`); the admin route's first page load schedules the cron for config-managed installs. Contract README: the `{ success, data }` envelope, EmDash's 413 for bodies over 256 KiB, and a snapshot for every watched index each sync.
Tests: `cd plugin && pnpm test`: 9 files, 95 tests passing (10 new: route tests in the runtime host for NOT_PAIRED, pool top-up, a claimed row never reset, settling from signed snapshots, a reversal alert, state across `restart()`, pairing through the route, forged requests, EmDash's 413 for an oversized body (`INVALID_PLUGIN_REQUEST`), the purge after a sync and from the cron, the cron scheduled by the first admin page load and idempotently by activation; the manifest test now expects `bridge/sync` exactly as declared; `deletePluginData` against a fake context, since the test hosts can't both seed this state and invoke uninstall). `tsc --noEmit` clean; `bundle --validate-only` passed (14.4 KB). Dev site: the live route answers `MISSING_SIGNATURE` unsigned and `NOT_PAIRED` signed but unpaired.
Open issues: the uninstall hook's host wiring is untested (logic only). Concurrent writes to one invoice (a sync and a status read) are last-writer-wins for now; revisit in 2d-2 with `status`.
Next step: Session 2d-2: `checkout` (products, rate fetch Kraken then CoinGecko, spam limits, pool claims) and `status`.

## 2026-10-03 · Phase 02 · Session 2d-2: checkout and status

Done: `plugin/src/rates.ts` (Kraken Ticker first, CoinGecko keyless as the fallback, USD and EUR; prices parsed from decimal text, CoinGecko's JSON number read from the response text, not a float; rounded down to the cent so the XMR amount is never lower; 60 s KV cache; 5 s timeout; sanity bounds; never a stale price). `plugin/src/checkout.ts` (products only; hand-written validation that ignores any client-sent price or amount; product by entry id, or by slug among published products, scanned in memory because EmDash's plugin content API can't filter by slug, bounded at 1,000 products; site-wide cap of 40 open invoices counted until `expiresAt`; per-client hashed buckets with a per-site salt only when `requestMeta.ip` is known; pool claim by `updateIf` in a bounded loop, a refused invoice write (the unique `subaddress` index) treated as a lost claim; the exact `monero:` URI). `plugin/src/status.ts` (by token; evaluates for display but never writes, so it can't race a sync). Routes `checkout` (POST, public, JSON, 4 KiB) and `status` (GET, public, `private, no-store`); the manifest test now pins all four routes. Domain errors added beyond the spec's list: `INVALID_REQUEST` (checkout input) and `INVOICE_NOT_FOUND` (status).
Tests: `cd plugin && pnpm test`: 10 files, 108 tests passing (13 new route tests in the runtime host: an invoice from the product's price and the Kraken rate on a pool address with the exact URI; slug and id lookups; a client-sent price ignored; PRODUCT_NOT_FOUND for unknown, draft, zero and over-precise prices; the CoinGecko fallback; RATE_UNAVAILABLE with nothing claimed; the EUR setting; NO_ADDRESS_AVAILABLE; INVALID_REQUEST cases; the site-wide cap and invoices past their deadline no longer counting; the per-client cap (through `transport.invokeRoute`, which passes an IP like a Cloudflare site; the real request path gives `ip: null` off Cloudflare, as the spike found); status fields, `no-store`, INVOICE_NOT_FOUND, pendingExpiry without writing; checkout to signed sync to settled). `tsc --noEmit` clean; bundle valid, `backend.js` 19,698 bytes of 128 KB.
Open issues: the POC's `HOST_NOT_ALLOWED` attack isn't exercised here (the plugin never fetches another host; EmDash enforces `allowedHosts`, which the manifest test pins). Concurrency of claims on PostgreSQL remains untested (spike Q6).
Next step: Session 2e: the minimal `admin` route (settings: currency USD or EUR and speed; Connect wallet host: pairing code and install command).

## 2026-10-03 · Phase 02 · Session 2e: minimal admin route

Done: `plugin/src/admin.ts`, served by the private `admin` route (Block Kit as plain JSON). Page `/payments`: status fields (paired, last sync, free addresses of 50), the silent-bridge banner when the last sync is over 5 minutes old (worked out at load time, spec change 2), an update banner for an outdated bridge protocol, **Connect wallet host** (a 22-character code valid once for 15 minutes; only its SHA-256 hash is stored; shown once with the install command `curl -fsSL <install URL> | sh -s -- --site <site URL> --pair <code>` and the cautious `xmr-bridge install --site … --pair …`; a confirm dialog before replacing a paired host), and the settings form (currency USD or EUR, speed Fast / Standard / Strict, "changes apply to new invoices only"). Widget `xmr-status`: one health line. The install URL is a deliberate non-resolving placeholder, `https://REPLACE-RELEASE-HOST.invalid/install.sh`, until phase 09, so a premature copy fails instead of running. Any admin load schedules the backup cron if it isn't yet.
Tests: `cd plugin && pnpm test`: 11 files, 114 tests passing (6 new through the runtime host's admin helpers, which also validate Block Kit: page defaults; settings saved and invalid values refused; the code shown once, its hash stored, not the code, a reload not showing it, a second press replacing it; the page's code pairing a bridge through `bridge/sync`, then "Paired" and a confirm before replacing; silent, outdated and healthy states on the page and in the widget; an unknown action). `tsc --noEmit` clean; bundle valid (27.0 KB).
Verified before pushing (Wyatt's four checks):
1. An admin page load schedules the backup cron: `handleAdmin` calls `ensureCron` when `state:cronScheduled` isn't set; test "activation and the first admin page load schedule the backup cron" (`tests/routes/sync-route.test.ts`) loads `/payments` on a fresh host and finds the hourly `housekeeping` task.
2. The install command uses the site URL, not `request.url`: it uses `ctx.site.url`, which EmDash fills from the site's configuration (`siteUrl` / `EMDASH_SITE_URL`) or the address stored at setup (`emdash:site_url`), never from the request (EmDash's `api/site-url.ts`: "A configured or stored value always beats the request"). Fixed while checking: with no site URL the page used to fall back to `ctx.url("/")` (giving `--site /`); now it shows an error banner and creates no code. The page also says which address the wallet host will connect to, since a site set up under one address keeps it (the dev site's stored URL is `http://localhost:4321`, written by the dev-bypass login). Tests: a configured `https://shop.example` appears in the command; no site URL means no command and no code.
3. The pairing code is never logged or stored in plain text: only its SHA-256 hash goes to KV; the code appears only in the one admin response that creates it (not in the toast); the plugin's only log call is the invoice status change. The test now checks KV, settings and both storage collections for the code.
4. A new code cancels the old one: it overwrites the stored hash. New test: after a second code, the first is refused (`PAIRING_REJECTED`) and the second pairs.
Tests after the fixes: 11 files, 117 passing; `tsc --noEmit` clean; bundle valid (27.5 KB).
Open issues: Wyatt hasn't seen the page rendered in the admin yet (2f, through the SSH tunnel). The dev site's stored site URL is `http://localhost:4321`; fine for a bridge on this box, wrong for a separate wallet host.
Next step: Session 2f: dev-site run scripted end to end with a fake bridge (pair from the admin code, top up, checkout, signed syncs, settle, status), the site-level checks the test host skips (401 for an invalid Bearer, 403 for a cross-origin Origin), the bundle check, and the CI workflow (ask first).


## 2026-10-03 · Phase 02 · Session 2f: dev-site end to end, CI

Done: `scripts/dev-e2e.mjs`, a fake bridge against the running dev site (Node standard library only; the bridge key is generated in memory per run and never written; pool addresses are well-formed fakes). Pairing through the KV shortcut Wyatt approved (dev only, no plugin change: the script writes its code's SHA-256 hash to the plugin's `__kv` row `state:pairing` in `_plugin_storage`, where the sandbox runner keeps a sandboxed plugin's KV), or `--pair <code>` with a code from the admin page. It refuses non-loopback sites and a plugin that already has a pool, invoices or a bridge key, and removes what it created afterwards (`--keep`, `--cleanup-only`); Wyatt's settings, the salt and the cron flag stay. `.github/workflows/ci.yml` (approved: `contents: read`, no `pull_request_target`, `persist-credentials: false`, `--frozen-lockfile`): pushes to `main` and pull requests, `ubuntu-24.04`, `actions/checkout` v7.0.1 and `actions/setup-node` v7.0.0 pinned to commit SHAs (both GitHub's own, released 2026-07), its automatic cache off, Node 24.21.0, pnpm 12.8.1 from corepack (no third-party setup action), then typecheck, validate, tests and the bundle check. Both decisions in `docs/decisions.md`; two command rows in CLAUDE.md. Dev-site database backed up first to `~/xmr-pay-dev-data/baseline/data.db.before-2f`.
Tests: `node scripts/dev-e2e.mjs` on `astro dev` with a fresh plugin build: 30 of 30 as expected (`~/xmr-pay-dev-data/2f-e2e-run3.txt`). Host checks the test hosts skip: invalid `Bearer` → 401 `INVALID_TOKEN` (bridge/sync and admin), cross-origin `Origin` → 403 `CSRF_REJECTED` (bridge/sync and checkout), admin with no session → 401, bridge/sync over 256 KiB → 413. Protocol on the live route: unsigned `MISSING_SIGNATURE`, unpaired `NOT_PAIRED`, wrong code `PAIRING_REJECTED`, pairing with 10 addresses, the code burned and refused for another key, top-up to 50, another key and a changed byte `BAD_SIGNATURE`, 10-minute-old timestamp `STALE_TIMESTAMP`, a BOM `INVALID_ENCODING`. Payment: checkout of `test-sticker` at the live Kraken rate (1.00 USD → 1807305128 atomic) on a pool address with the exact URI; a client-sent price ignored (same amount as a checkout without it); new → seen (half, unmined) → still seen with a time-locked full-amount transfer beside it → confirming (rest arrives) → confirming at 1 of 2 → settled at 2 of 2; an older `seq` with the payment gone changes nothing. Runs 1 and 2 failed on the script's own mistakes (96-character fake addresses, which the plugin rightly skipped; expecting `seen` for a full payment the spec sends straight to `confirming`); one extra run started by mistake with its output discarded also cleaned up after itself. Plugin, unchanged this session: 11 files, 117 tests passing; `tsc --noEmit` clean; manifest valid; bundle valid (27.5 KB). CI rehearsed locally from a clean clone: corepack pnpm 12.8.1, `pnpm install --frozen-lockfile`, then the four checks, all passing. Not covered: the workflow on GitHub itself (needs a push), the built workerd copy (only `astro dev` this session), PostgreSQL.
Open issues: Wyatt's hand pairing from the admin page (`--pair`) still to run. `deletePluginData` doesn't remove the rate cache (`cache:rate:USD` / `EUR` in KV): harmless, but uninstall with "delete data" leaves those rows; a small plugin fix for phase 04 or a later 2x session. Excludes to delete on or after 2026-10-08; spec changes 6 and 7 to fold into the live spec. Dev site left running for the hand pairing.
Next step: Wyatt runs the hand pairing and Claude reads `~/xmr-pay-dev-data/2f-hand-pair-output.txt`; then, with Wyatt's approval, push so CI runs on GitHub, and check phase 02's "done when" list.

## 2026-10-03 · Phase 02 · Session 2f addendum: hand pairing

Done: `dev-e2e.mjs --pair` first refused the admin page's own active code (fixed in `39d3d2f`; setup-friction row). Wyatt then paired by hand from the admin page: `~/xmr-pay-dev-data/2f-hand-pair-output.txt`, 30 of 30 as expected, run with `--keep`. The admin page showed "48 of 50" free addresses, matching the database: 50 pool rows, 2 claimed (indexes 1 and 2), 2 invoices (the settled test payment, and the second checkout used to prove a client-sent price is ignored, still `new`), each claimed row pointing at its invoice and back, no free row carrying an invoice id. Wyatt read "Free addresses" as linked wallets: wording note added to `docs/phases/04-admin-page.md`, setup-friction row added.
Open issues: Wyatt runs `--cleanup-only` after this. Not pushed yet; CI hasn't run on GitHub. Rate cache not removed by uninstall (from the 2f entry).
Next step: with Wyatt's approval, push so CI runs on GitHub, then check phase 02's "done when" list.

## 2026-10-03 · Phase 02 · Session 2f: where it stands at end of day

Done: everything in 2f except CI's first run on GitHub. Dev-site end to end with a fake bridge: 30 of 30, by the KV shortcut and by Wyatt's hand pairing from the admin page (`~/xmr-pay-dev-data/2f-e2e-run3.txt`, `2f-pair-fix-run.txt`, `2f-hand-pair-output.txt`). Host checks (401, 403, 413) confirmed on the site. Bundle valid (27.5 KB). CI workflow committed and rehearsed from a clean clone. decisions.md: the hosted bridge row (still to decide) now records Wyatt's pricing direction: tiers by monthly checkouts, soft limits, the plugin stays tier-free.
Tests: no new runs since the addendum above.
Open issues: Wyatt's `--cleanup-only` hadn't run at the time of this entry (the dev database still held the hand run's 50 pool rows, 2 invoices, `state:bridge`, `state:pairing` and the bridge key); the dev site was stopped at the end of the day. `deletePluginData` leaves the rate cache (`cache:rate:*`). Excludes to delete on or after 2026-10-08. Spec changes 6 and 7 to fold into the live spec. Phase 04 wording note ("Free addresses").
Next step: (1) If not done, `node ~/xmr-pay/scripts/dev-e2e.mjs --cleanup-only` and confirm it reports 52 pool and invoice rows, 2 KV rows and 1 bridge key removed. (2) Open the repository's Actions tab on GitHub and confirm the "CI" run for the pushed `main` passed all six steps (install, typecheck, validate, tests, bundle caps); if it failed, Claude reads the log and fixes it. (3) Then Claude checks phase 02's "done when" list against `docs/phases/02-plugin-core.md` and, if everything holds, writes phase 02's closing entry; the next phase is 03 (`docs/phases/03-bridge-and-installer.md`).

## 2026-10-04 · Phase 02 · Session 2f close

Done:
- Dev-site cleanup: `data.db` backed up to `~/xmr-pay-dev-data/baseline/data.db.before-2f-cleanup`, then `dev-e2e.mjs --cleanup-only`: "removed 52 pool and invoice rows, 2 KV rows, 1 bridge key". Left: `cache:rate:USD` and `state:cronScheduled` (KV), plus Wyatt's settings.
- CI on GitHub: the "CI" run for `5e9fe26` completed with success (read from the public Actions API; `gh` isn't installed).
- `deletePluginData` now also removes the rate cache (`cache:rate:USD` and `cache:rate:EUR`): `a882711`, test first.
- Done-when check, test by test against "Tests (minimum)" in `docs/phases/02-plugin-core.md`. One gap: spec change 3's "a second invoice with an address already used is refused and checkout retries" had no test. The route-level attempt showed that the runtime test host **doesn't apply `uniqueIndexes`**: a duplicate was stored without complaint. On a real site EmDash does: the dev DB has `CREATE UNIQUE INDEX uidx_plugin_xmr-pay_invoices_subaddress … json_extract(data, '$.subaddress')`, and a scratch copy refused a second invoice with the same address (`UNIQUE constraint failed`, `~/xmr-pay-dev-data/2f-unique-index-check.txt`). Added `tests/routes/claim.test.ts`: the exported `claimAndStore` against a fake store that refuses duplicates. The refused row stays claimed and another free address is used; with every free address taken it returns `NO_ADDRESS_AVAILABLE`. Mutation (rethrow on refusal) fails both tests. Commit `3d9b3c0`.
- Spec change 9 proposed (Wyatt's request): the shop's wallet app may miss payments after 200 or more unpaid addresses in a row (subaddress lookahead). Notes added:
  - phase 03: a stagenet test of the gap, a default-settings wallet as the shop's app, and a reinstalled bridge
  - phase 04: a gap warning from a constant threshold, beside "a run of unpaid expired invoices"
  - phase 05: the test tip must show up in the shop's wallet app, as a timing-sheet row and a pass criterion
  - commit `6b5bba4`

Phase 02 "done when":
- all tests pass in the test hosts: yes
- the plugin runs in the dev site: yes, since 2a
- a signed sync sent by a script settles an invoice: yes (2f run 3 and Wyatt's hand run)
- the bundle is under its caps: 27.5 KB
- CI runs the tests: yes (run on `5e9fe26`)

Phase 02 is done, with the open items below.

Tests:
- `cd plugin && pnpm test`: 12 files, 119 tests passing
- `tsc --noEmit` clean
- manifest valid
- `bundle --validate-only` passed (27.5 KB across 3 files)

Not covered:
- unique-index enforcement through the plugin's own storage API on a live site (shown on the SQL index directly, and on the plugin's logic with a fake)
- real concurrent claims and PostgreSQL (spike Q6)
- the built workerd copy in 2f
- the uninstall hook's host wiring

Open issues:
- The dev DB still has two SQL indexes from the phase 01 spike (`idx_plugin_xmr-spike_pool_status`, `uidx_plugin_xmr-spike_pool_addrIndex`; their `_plugin_indexes` rows were removed then, the indexes weren't). They're harmless. Ask Wyatt before dropping them.
- Delete the excludes on or after 2026-10-08 (both packages).
- Spec changes 6 and 7 are still to fold into the live spec; spec change 9 is for Wyatt to decide.
- Commits `a882711`, `3d9b3c0`, `6b5bba4` and this entry are local, not pushed.

Next step: with Wyatt's approval, push (CI should pass: same checks run locally). Then phase 03, session 3a, from `docs/phases/03-bridge-and-installer.md`. If Wyatt has decided spec change 9 by then, fold it into the 3a plan.

## 2026-10-04 · Phase 02 · After the close

Done:
- Pushed `5e9fe26..0cf425c` to `origin/main` with Wyatt's approval; `git ls-remote` matches.
- Spec change 9 accepted. Wyatt's open question (how an admin raises the wallet app's lookahead, and whether that manual step fits the admin budget) is recorded in the entry and as a "Still to decide" row in `docs/decisions.md`: settle it after phase 03's stagenet test, before phase 04.
- Dropped the phase 01 spike's two leftover SQL indexes from the dev DB, with Wyatt's approval. Backup first: `~/xmr-pay-dev-data/baseline/data.db.before-spike-index-drop`. Afterwards: no `xmr-spike` indexes or `_plugin_indexes` rows, xmr-pay's 7 indexes intact, `PRAGMA integrity_check` ok (`~/xmr-pay-dev-data/spike-index-drop-output.txt`).
Tests: no code changes.
Open issues: Wyatt folds spec changes 6, 7 and 9 into the live spec. Delete the excludes on or after 2026-10-08. This entry and the spec change 9 acceptance are local, not pushed.
Next step: phase 03, session 3a (`docs/phases/03-bridge-and-installer.md`).

## 2026-10-04 · Phase 03 · Session 3a: bridge module, config, wallet-rpc client

Correction to the "After the close" entry above: the spec change 9 acceptance (`7715fb8`) was pushed the same day, at Wyatt's request.

Done:
- **Plan and decisions.**
  - Spec revision 70 snapshot committed with the matching `docs/decisions.md` row: the hash-list verifier is our own, standard library only, `4cb6ddd`.
  - Wyatt approved all six plan items, `98f30a4`:
    - `go-crypto` only in the separate test module `bridge/oracle/`
    - `actions/setup-go` in CI
    - the release-signature scheme
    - dev release mode
    - `CLAUDE.md`: no standard-library exception for the bridge
    - 3b split into 3b-1 (verifier) and 3b-2 (download and supervise)
- **`bridge/`**, Go module, no dependencies, `go 1.27`, built with `GOTOOLCHAIN=local`, commit `c5acc27`:
  - `internal/secret`: values that format, log and marshal as `[redacted]`; only `Reveal` returns them; never unmarshalled.
  - `internal/config`: one JSON file, mode 600 enforced on load, 64 KiB cap, unknown fields and trailing data refused, atomic save.
    - The site must be https, or http on loopback only, with no path, query or login.
    - The same-machine flag is allowed on stagenet only.
    - No secrets in the file. `ReleaseURL` stays out until 3g, behind the `devrelease` build tag.
  - `internal/walletrpc`: JSON-RPC client with hand-written digest auth.
    - Real wallet-rpc 0.18.5.1 offers two challenges with one nonce, `algorithm=MD5` and `algorithm=MD5-sess`; MD5 with `qop=auth` is used.
    - A stale nonce is retried once and a wrong password gives `ErrUnauthorized`, never a loop.
    - Responses capped at 16 MiB; trailing data refused.
    - Methods: `get_version`, `get_height`, `create_address` (account 0, label), and `get_transfers` (in and pool, account 0, `subaddr_indices`, no call for an empty list).
    - Amounts and unlock times are read as `uint64` and returned as decimal strings; `locked` is ignored.
    - Malformed txids and transfers for indexes that weren't asked for are refused.
  - `cmd/xmr-bridge`: `version` and `run --config`. `run` loads the config, logs to stderr without timestamps (the journal adds them) and stops on SIGTERM; the sync loop is 3d.
- **CI**, commit `4a06612`:
  - A `bridge` job: gofmt, vet, tests, static build. `actions/setup-go` v7.0.0 pinned to `b7ad1dad31e06c5925ef5d2fc7ad053ef454303e` (released 2026-07-16), Go 1.27.1, cache off, `GOTOOLCHAIN=local`, `GOFLAGS=-mod=readonly`.
  - Three `CLAUDE.md` command rows (bridge tests, static build, the live wallet-rpc test).

Tests:
- `cd bridge && go vet ./... && go test ./...`: 4 packages, 25 top-level tests (41 with subtests) passing, 1 skipped (the live test, without its variables). `gofmt -l .` empty.
- `CGO_ENABLED=0 go build`: a static ELF of 4.5 MB.
- **Live test** against a real `monero-wallet-rpc` 0.18.5.1 (stagenet, random login, no wallet; `~/xmr-pay-dev-data/3a-live-walletrpc.txt`): `get_version` 1.31 four times on one challenge, `get_height` returned wallet-rpc's `-13 No wallet file` after a successful login, and a wrong password gave `ErrUnauthorized`. The probe was stopped and its login and files deleted.
- **Mutation checks**, each caught: a constant `nc` (2 failing), any digest algorithm accepted (3), the index check removed (3), the txid check removed (3), and the secret's `Format` or `LogValue` removed (1 each). Removing the JSON methods changed nothing because `MarshalText` covers JSON, so they were dropped.
- CI rehearsed from a clean clone: all four bridge steps pass. The workflow parses (2 jobs). Not run on GitHub yet (needs a push).

Not covered:
- digest `opaque` and `qop` lists with `auth-int` against a real server (wallet-rpc sends neither)
- concurrent use of one client (it's mutex-safe, not stress-tested)

Open issues:
- In the real install, wallet-rpc's `--rpc-login` on the command line is visible in the process list. Decide in 3b-2 how the supervised wallet-rpc gets its login (for example `--rpc-login` with the password fed another way, or `--rpc-login-file` if 0.18.5.1 has one; check `--help`).
- Delete the excludes on or after 2026-10-08.
- Wyatt folds spec changes 6, 7 and 9 into the live spec.
- Commits `4cb6ddd` through this entry are local, not pushed.

Next step: session 3b-1, the `hashes.txt` verifier. First download binaryFate's public key (monero-project repository) and the current `hashes.txt` (getmonero.org), confirm the fingerprint `81AC 591F E9C4 B65C 5806 AFC3 F0AF 4D46 2A0B DF92` with `gpg --show-keys` (no import), and record the key's algorithm before writing code; stop and tell Wyatt if it isn't RSA.

## 2026-10-04 · Phase 03 · Session 3b-1 (part 1): hashes.txt verifier

Done:
- Pushed `7715fb8..9f2515c` with Wyatt's approval. CI on GitHub passed for `9f2515c`, both jobs (the bridge job's first run).
- **Key confirmed before any code**, from `utils/gpg_keys/binaryfate.asc` (monero-project repository) and `getmonero.org/downloads/hashes.txt`, with `gpg --show-keys` in a temporary home (no import):
  - primary key RSA 4096 (algorithm 1), fingerprint `81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92`, created 2019-12-12
  - one RSA 4096 subkey that can also sign, `AD564CDA8F1665ACE78B5DFD2593838EABB1F655`
  - `hashes.txt` is signed by the **primary** key: `gpgv` `VALIDSIG` signing and primary fingerprints are equal; v4, RSA, SHA-256, class 0x01, made 2026-07-20; hashed subpackets 33 (issuer fingerprint) and 2 (creation time), unhashed 16 (issuer key ID); armor checksum present, no armor headers
  - the list covers CLI 0.18.5.1 and GUI 0.18.5.2
- **`bridge/internal/hashsig`** (standard library only), commits `9e5c861` and `296601e`:
  - `Verify` accepts exactly revision 70's shape and returns the canonical verified text.
  - `ParseHashes` reads `<sha256>  <name>` lines from that text only.
  - `pinned.go` holds the key as constants. `init` checks them against the fingerprint, and a test checks them against the published key.
  - Errors are separate, for the health check: `ErrUnknownSigner` (keep the current wallet-rpc, ask for a bridge update), `ErrExpired`, `ErrBadSignature`.
  - A signature by the subkey is refused as an unknown signer. If Monero ever signs with the subkey, the bridge treats it like a key change.
- **Test files** (`testdata/make-corpus.sh`): two throwaway RSA 3072 keys made in a temporary gpg home, deleted on exit; only their public keys and the signed files are committed. 3 good files and 6 bad ones: wrong signer, subkey signer, two signatures, SHA-384, expired (signed with a faked 2020 time), and a mismatched `Hash:` header.
- **Fuzzing**:
  - `FuzzVerify`: no input verifies with text other than what that key actually signed. Changes to line endings, trailing whitespace and armor wrapping may verify, because they don't change the canonical text; that is how revision 70's "no generated input ever verifies" is read here.
  - `FuzzSignaturePacket` and `FuzzParseHashes`: no panics.
- **`bridge/oracle`**, a separate test-only module, compares our verdicts with `gpgv`'s (commit `fa26968`). Spec change 10 proposed (below). CI runs it.

Tests:
- `cd bridge && go test ./...`: 5 packages pass. `hashsig` has 14 tests plus 3 fuzz targets on their seeds. `gofmt` and `vet` clean.
- **Mutation checks** (each removes one protection):
  - Caught: RSA check, prefix check, issuer fingerprint check, issuer key ID check, expiry, extra packets allowed, text before BEGIN, other message headers, no trailing-whitespace canonicalization, armor checksum, signature older than its key, dash-escape not undone, non-minimal MPI.
  - Three needed new tests, which were added: the signature value changed with the right prefix, the unsigned issuer key ID changed, an understated MPI bit count.
  - Two are redundant by construction: the `Hash:` header check (the digest uses the header's algorithm, so a mismatch fails anyway) and END-must-be-last (text after END lands where the checksum must be).
- **Fuzz runs** (`~/xmr-pay-dev-data/3b1-fuzz-*.txt`), 2 workers, no failures, no failing inputs saved: `FuzzVerify` 4 min, about 8.7M inputs; `FuzzSignaturePacket` 2 min, about 0.6M; `FuzzParseHashes` 2 min, about 8.2M.
- **`gpgv` comparison** (`~/xmr-pay-dev-data/3b1-oracle-gpgv.txt`): 26 inputs × 3 keys = 78 comparisons with 8 acceptances. 73 match. Ours never accepted what `gpgv` refused, and accepted texts were identical. The 5 differences are our refusals by name (spec change 10).
- Clean-clone rehearsal of the CI steps: passes.

Not covered: the `go-crypto` comparison (waiting on a dependency answer), and long fuzz runs (minutes, not hours).

Open issues, for Wyatt:
1. `go-crypto` v1.5.2 (2026-09-25, 9 days old) requires `cloudflare/circl` v1.6.3 **and** `golang.org/x/crypto` v0.41.0 and `golang.org/x/sys` v0.35.0. The approval covered `go-crypto` and `circl` only. Approve the two `golang.org/x` modules (Go team, BSD-3) for `bridge/oracle` only?
2. Spec change 10: approve the verdict definition, and choose strict (current) or RFC 9580-tolerant handling of a missing armor checksum and signature-block armor headers.

Also open: delete the excludes on or after 2026-10-08; spec changes 6, 7 and 9 to fold into the live spec. Commits `9e5c861`, `296601e`, `fa26968` and this entry are local.

Next step: with Wyatt's answers, add `go-crypto` to `bridge/oracle` (exact versions, committed `go.sum`) as a third verdict in the same comparison, finish 3b-1, then 3b-2.

## 2026-10-04 · Phase 03 · Session 3b-1 (part 2): comparison checks, 3b-1 done

Done:
- **Wyatt's answers.** Spec change 10 accepted, strict. `golang.org/x/crypto` and `golang.org/x/sys` approved for `bridge/oracle` only. Both recorded in `docs/spec-changes.md` and `docs/decisions.md`.
- **`go-crypto` v1.5.2 added to `bridge/oracle`** (`go.sum` committed; `go mod verify`: all modules verified).
  - Indirect: `circl` v1.6.3, `x/crypto` v0.41.0, `x/sys` v0.35.0, all far past 7 days old.
  - `bridge/go.mod` is unchanged and has no `go.sum`.
- **The second comparison** asks `go-crypto` the same question as `gpgv`: one signature packet, valid at the test time, issued by the primary key, and the text it returns. The CI step runs both. Commit `d8f2769`.
- **Found by the comparison:**
  - `go-crypto` refused the test-key files as "signature expired". They had been signed at 17:43 UTC, after the tests' fixed 12:00 "now", and `go-crypto` refuses future-dated signatures.
  - Our verifier accepted them, which spec change 10 forbids. `Verify` now refuses a signature dated after "now" (test plus mutation check).
  - The generator now signs at a fixed 2026-01-01 (expired case 2020), so the files don't depend on when they were made. Regenerated with new throwaway keys, public halves only. Commit `1ce6f68`.
- **`go-crypto` is more lenient than `gpgv` in four ways:** it ignores the `Hash:` header (missing or mismatched), ignores a changed armor checksum, and reads only the first of two signed blocks. `gpgv` refuses all of these, as we do.

Tests:
- `cd bridge && go test ./...`: 5 packages pass (`hashsig` 15 tests plus 3 fuzz targets on their seeds); `gofmt`, `vet` clean.
- **Comparison** (`~/xmr-pay-dev-data/3b1-oracle-both.txt`): 26 inputs × 3 keys × 2 oracles = 156 comparisons, 8 acceptances by ours, all three verifiers agreeing on each.
  - Ours never accepted what an oracle refused, and accepted texts were identical.
  - 10 rows where ours refuses and an oracle accepts, each named in the test with its policy: SHA-384; text outside the signed block (before, after, the file twice); a missing or mismatched `Hash:` header (3); armor checksum changed or removed; signature-block armor header.
- `FuzzVerify` again for 90 s on the new seeds: about 3.4M inputs, no failures.
- Clean-clone rehearsal of the whole CI bridge job, including the module download and `go mod verify`: passes.

Not covered: hour-long fuzz runs; Monero's previous signing keys (none pinned, by design).

Phase 03 so far: 3a and 3b-1 done. Revision 70's verifier tests (fuzzing, tampered files, two comparison oracles in CI) are all in place.

Open issues:
- Wyatt folds spec changes 6, 7, 9 and 10 into the live spec.
- Delete the excludes on or after 2026-10-08.
- From 3a: how the supervised wallet-rpc gets its login without showing it in the process list (3b-2).
- Commits `9e5c861` through this entry are local.

Next step: session 3b-2.
1. Check `monero-wallet-rpc --help` for how a login can be passed without the command line.
2. Plan the download path: `hashes.txt` from getmonero.org, verify with `hashsig`, the archive for the CPU (linux64 or linuxarm8), its SHA-256 checked against the verified list, extract only `monero-wallet-rpc` (`compress/bzip2`, `archive/tar`), and supervision (localhost bind, generated login, `--tx-notify`).

## 2026-10-04 · Phase 03 · Session 3b-2: download, verify and supervise wallet-rpc

Done:
- Pushed `9f2515c..b33c514` with Wyatt's approval. Plan approved as written: `xmr-bridge notify` for `--tx-notify`, the two download hosts fixed in code, wallet-rpc in `<dataDir>/bin/`.
- **Research.** wallet-rpc 0.18.5.1 has no login-file option, but `--config-file` takes `rpc-login=user:password`. A probe confirmed the login works that way and the password appears nowhere in the process list. Archives are direct downloads: linux-x64 0.18.5.1 is 84,575,716 bytes, linux-armv8 74,269,877.
- **`internal/monerodl`**, commit `6388886`:
  - `Latest`: `hashes.txt` over https from `www.getmonero.org`, verified with `hashsig` and the pinned key, then exactly one CLI archive for this CPU (x64 or armv8).
  - `Install`: downloads from `downloads.getmonero.org/cli/` with a 256 MB cap, checks the SHA-256 against the verified list, then extracts only `<dir>/monero-wallet-rpc` (a regular file, exactly one, 128 MB cap, decompression bounded at 2 GB).
  - Writes the binary (0755) and `installed.json` (version, archive and binary hashes) by temporary file and rename. A failure leaves the previous install untouched.
  - Redirects only over https and only between the two hosts.
  - Fixtures from `testdata/make-fixtures.sh`: tiny archives made with system `tar` and `bzip2`, lists signed by a throwaway key deleted on exit (public key and its parameters only).
- **`internal/supervise`**, commit `0696c53`:
  - wallet-rpc runs as a child, bound to 127.0.0.1 on a free port.
  - A new random login each start, in a mode-600 `--config-file` that is removed once wallet-rpc answers.
  - Empty environment, its own process group; wallet, ringdb and log (2 × 10 MB) under the data folder.
  - Network flag, `--daemon-address` and `--daemon-ssl` from the node URL; `--tx-notify "<bridge> notify --pid <pid> %s"`.
  - Ready when `get_version` answers. Restart backoff 1 s to 60 s, reset after 5 minutes of stable running. Stop: SIGTERM, then SIGKILL after 30 s.
  - The parent-death signal is sent from a locked OS thread, so the child dies with the bridge. `Status` is ready for health and `xmr-bridge status`.
- **`xmr-bridge notify --pid <pid> [txid]`** sends SIGUSR1. `run` takes SIGUSR1 from the start (Go's default for it is to exit) and logs it; the sync loop in 3d will act on it.

Tests:
- `cd bridge && go test ./...`: 7 packages pass. `gofmt` and `vet` clean, static build, `oracle` passes.
  - `monerodl`: 9 top-level tests.
  - `supervise`: 10 tests, using the test binary re-run as a fake wallet-rpc, or as a fake bridge.
  - `cmd`: 3 new tests.
- **`supervise` repeated 10 times:** no flakiness, no leftover processes. The race detector couldn't run: there's no C compiler on this box (see open issues).
- **Mutation checks, all caught:**
  - `monerodl`: archive hash check, redirect host check, https requirement, redirect scheme check, signature check, second entry, links, any depth, several releases, download size cap.
  - `supervise`: login file kept, environment inherited, no SIGKILL fallback, ready without an answer, bind on all interfaces, backoff never resets.
  - Redundant by construction: the binary's header size cap and its copy cap back each other up.
  - Three test fixes were needed to catch these: a real plain-http server, a two-entry archive at the normal depth, and asserting the size-cap error.
- **Live, download** (`~/xmr-pay-dev-data/3b2-live-download.txt`): the real list verified with the pinned key, the 85 MB archive matched `22a7dda7…c9958`, and the extracted binary is byte-identical to `/opt/monero/monero-wallet-rpc`. 48 s.
- **Live, supervise** (`~/xmr-pay-dev-data/3b2-live-supervise.txt`), real wallet-rpc 0.18.5.1 against the stagenet node: ready with RPC 1.31, no `rpc-login` on its command line, login file gone, log written. After `kill -9` it was back about 1 s later with a new pid, port and login. Stop left nothing running. 8.4 s.
- **Child dies with the bridge:** passed 5 of 5 times.

Not covered:
- `--tx-notify` actually firing (needs a wallet and a payment: 3c and 3h)
- wallet-rpc's own behaviour under `systemd` hardening (3f)
- the race detector (no `gcc`)

Notes:
- The parent-death signal is SIGTERM, so wallet-rpc can save its wallet. A child that ignored SIGTERM would survive a hard kill of the bridge; the real wallet-rpc honours it.
- One leftover fake process, from the "no SIGKILL fallback" mutation run, was found and killed. Normal runs leave none.
- `run` doesn't install or supervise yet: wiring belongs with the wallet (3c) and the sync loop (3d).

Open issues:
- **For Wyatt:** add a `go test -race ./...` step to CI? GitHub's Ubuntu runners have `gcc`, so it needs no new dependency. Locally it would need `gcc` installed (a system package).
- Delete the excludes on or after 2026-10-08.
- Wyatt folds spec changes 6, 7, 9 and 10 into the live spec.
- The downloaded wallet-rpc stays in `~/xmr-pay-dev-data/3b2-live-download/` for 3c.
- Commits `6388886`, `0696c53` and this entry are local.

Next step: session 3c, wallet from keys.
- `generate_from_keys` with the shop's address and view key, no spend key.
- Restore height from the node's current height unless set.
- The network check: the address prefix must match the node's network.
- Wire install-if-missing and supervise into `run`.
- Spec change 9's lookahead test needs a wallet, so it fits here or in 3h.

## 2026-10-04 · Phase 03 · Session 3c: view-only wallet from keys, network checks, run wiring

Done:
- Pushed `b33c514..0590403` with Wyatt's approval. Added a race-detector step to CI (`ae5d394`, approved; it needs cgo, and the runner has `gcc`). Not runnable on the dev box; first run on the next push.
- Plan approved:
  - the wallet password saved mode 600
  - restore height = the node's height
  - the live test with a view-only copy of the stagenet shop wallet, deleted afterwards
  - item 3, relying on wallet-rpc to refuse a mismatched view key, was reversed (below)
- **Research.** `scripts/with-shop-env.sh` refuses `sh`, `printf` and similar, so the live test is a Go test run under it, reading `SHOP_*` from its environment. The shipped binary has no dev path for keys. The node's `get_info` gives `nettype`, `height`, `synchronized` and `offline`.
- **Code**, commit `c9fa692`:
  - `internal/moneroaddr`: Monero base58, address prefixes, the two public keys.
  - `internal/shopkeys`: reads the installer's two lines; view-key format checks (64 hex, nonzero, below l, seed-like input refused).
  - `internal/noderpc`: `get_info`.
  - `walletrpc`: `generate_from_keys`, `open_wallet`, `close_wallet`, `get_address`.
  - `internal/wallet`: Create and Open. The wallet password is random, mode 600, never overwritten. Open checks the opened wallet is the shop address.
  - `config`: the shop address, checked against the network.
  - supervisor `Init` hook: the wallet is opened on every start.
  - `run`: without a wallet it stops with the fix before any network use. Otherwise it installs a verified wallet-rpc if one is missing and supervises it.
  - `internal/testaddr`: test-only address builder.
- **Found live: wallet-rpc doesn't check the view key** (spec change 11, accepted by Wyatt).
  - The first live run gave the real wallet-rpc 0.18.5.1 the real shop address with a wrong (well-formed) view key. `generate_from_keys` succeeded.
  - The v0.18.5.1 source confirms it: `on_generate_from_keys` only parses the hex, and `wallet2::generate` (view-only) calls `create_from_viewkey` with no comparison.
  - Without a check of our own, a wrong key makes a wallet that never sees payments, and a pasted spend key would be stored.
  - **Fix**, commit `a7a23cd`:
    - `internal/edwards`: k·B on Ed25519, standard library `math/big`, complete addition law, not constant-time (used once at install).
    - `shopkeys.CheckViewKeyMatches`: view·B must equal the address's public view key. Equal to the public spend key gives `ErrSpendKey`: "that is the shop wallet's SPEND key. Never enter it here…".
    - `ReadKeys` and `wallet.Create` both check before wallet-rpc sees the key.
  - The failed first run left a wallet-rpc briefly running (it exited on the parent-death SIGTERM) and a temporary folder with empty subfolders (no keys; the real key was never used). Both are gone. The test now stops wallet-rpc before deleting anything.

Tests:
- `cd bridge && go test ./...`: 92 top-level tests pass, 4 live tests skipped by default. `gofmt`, `vet`, static build clean. `oracle` passes.
- **Curve code:**
  - RFC 8032 section 7.1, TESTs 1 to 3
  - 300 random seeds against Go's `crypto/ed25519` (the test's oracle)
  - k·B == (k mod l)·B
  - 0·B and 1·B
  - fuzzed against `crypto/ed25519` for 2 min, about 124k inputs (`~/xmr-pay-dev-data/3c-fuzz-edwards.txt`)
- **Mutation checks, all caught:**
  - curve: sign bit, top scalar bit, d instead of 2d, wrong sign of d
  - address: network check, subaddresses accepted, unreduced scalar, seed check
  - node: status ignored, size cap
  - wallet: node network check, node offline accepted, existing wallet overwritten, opened address unchecked, password file kept after a failure, created address unchecked
  - supervisor: `Init` failure ignored
  - config: address unchecked, same-machine flag anywhere
  - the view-key match skipped in `Create` or in `ReadKeys`, the spend key not recognised, any key accepted
- **Test gaps the mutation checks found, fixed:**
  - two config cases ("same machine on mainnet/testnet") had been passing for the wrong reason since an edit silently didn't apply
  - wallet refusal cases had passed because the fake wallet-rpc failed
  - the node size cap's error wasn't asserted
  - Not run: the "run without a wallet" mutation, which would start a real 85 MB download; without the check, the test hangs until its timeout.
- **Live** (`~/xmr-pay-dev-data/3c-live-shop-wallet.txt`, run under `scripts/with-shop-env.sh`):
  - The real stagenet address and view key pass every check, including view·B == the address's public view key.
  - A wrong key was refused before wallet-rpc.
  - The wallet was created from `SHOP_RESTORE_HEIGHT` (2219978) and opened by `run`'s start-up path; the address matches. Synced to the node's height 2222135 in 5 s.
  - **The phase 01 spike's 0.001 XMR payment was found:** subaddress 1, height 2221449, 686 confirmations, unlock 0.
  - After `kill -9` it was restarted and the wallet reopened.
  - Wallet files mode 600, folder 700.
  - Nothing left running; the temporary folder deleted. 24 s.

Not covered:
- `--tx-notify` firing on a new payment (3h)
- the subaddress-lookahead test (spec change 9, 3h)
- the race detector (CI only, not yet run)
- a remote node that needs a login (no setting for it, by design)

Open issues:
- Wyatt folds spec changes 6, 7, 9, 10 and 11 into the live spec.
- Delete the excludes on or after 2026-10-08.
- Commits `ae5d394` through this entry are local.

Next step: session 3d.
- The Ed25519 bridge key (`crypto/ed25519`, key file mode 600).
- Pairing with the one-time code; signing that matches `contract/test-vectors/sync-signature.json` byte for byte.
- The sync loop (10–15 s and on SIGUSR1), snapshots from `get_transfers`, pool top-up with `create_address`, reconcile on start, backoff when the site is unreachable.
- `xmr-bridge status`.
- End to end against the dev site.

## 2026-10-04 · Phase 03 · Session 3d: signing, pairing, sync loop

Done:
- Pushed `0590403..6a756ba` with Wyatt's approval. CI on GitHub: the new race-detector step passed on its first run.
- Plan approved:
  - spec change 12 (more than 32 transfers to one address: send the 32 largest), accepted
  - pending pool addresses kept in `run/pending.json`
  - `xmr-bridge pair` and `dev-e2e.mjs --issue-code`
  - the shop wallet's real stagenet subaddresses in the dev site's pool during the test
- **Code**, commit `af293af`:
  - `internal/syncsign`: Ed25519 over `ts + "\n" + body`; key file with the seed, mode 600.
  - `internal/syncclient`: one bridge/sync request.
    - JSON without a BOM; no `Origin` or `Authorization` header; 256 KiB (4 KiB for pairing) checked before sending.
    - Redirects are reported, not followed.
    - Each refusal carries the site's code and its fix: pair again, the clock, or access rules for `/_emdash/api/plugins/xmr-pay/*`.
  - `internal/pairing`: a fresh key and one `pair` request; the key is saved only when the site accepts it.
  - `internal/bridgeloop`:
    - syncs every 12–15 s, and on SIGUSR1 (debounced)
    - reconcile on start
    - a snapshot for every watched index, rotated past 100 and halved if a body is too large; at most the 32 largest transfers per index
    - pool top-up up to 100 addresses per sync, pending ones persisted until the site takes them
    - `seq` never goes back; backoff 15 s to 5 min; the key file read every sync, so re-pairing needs no restart
    - `run/status.json` after every attempt
  - Commands: `xmr-bridge pair --config --code` and `xmr-bridge status --config` (plain words and fixes; exit 1 unless healthy). `run` starts the loop beside the supervisor.
- **Live end to end with the dev site**, commit `5e7306d`. The first run found that a used code answers `BAD_SIGNATURE`, as the contract README says (nothing is read before the signature once a code is spent). The test's expectation was wrong; pairing now explains `NOT_PAIRED`, `BAD_SIGNATURE` and `PAIRING_REJECTED` as "the pairing code is used or expired, or mistyped".
- `scripts/dev-e2e.mjs --issue-code <file>`; CLAUDE.md command rows.

Tests:
- `cd bridge && go test ./...`: 121 top-level tests pass, 5 live tests skipped by default. `gofmt` and `vet` clean.
- The Go signer reproduces all 9 cases of `contract/test-vectors/sync-signature.json` byte for byte (RFC 8032 TEST 1 and 2), and its verdicts match.
- **Mutation checks:** 15 of 16 caught. They covered:
  - the message separator, a readable key file, signing other bytes, the size limit, following redirects, a bad watch index
  - the 32 cap, the tie rule, duplicate txids, `seq` going back, pending not saved, no immediate reconcile, too-large not split
  - a key saved after a refusal, status hiding errors

  The survivor, pending addresses in the top-up count, is redundant: after a successful sync nothing is pending.
- **Live** (`~/xmr-pay-dev-data/3d-live-devsite.txt`; dev site on `astro dev` with a fresh plugin build; `data.db` backed up to `~/xmr-pay-dev-data/baseline/data.db.before-3d`), real wallet-rpc and view-only shop wallet, 51 s:
  1. paired through an issued code
  2. the used code refused with the key unchanged
  3. pool filled to 50 of 50 real subaddresses; `xmr-bridge status` healthy
  4. restarted: synced again, pool still 50, nothing new created
  5. proxy down: "can't be reached: connection refused" in the status, and `status` exits 1
  6. proxy back: syncing again after 15 s
  7. paired again with a new code: the running bridge synced with the new key, and the old key got `BAD_SIGNATURE`
  - Cleanup: the site's 50 pool rows, 2 KV rows and the bridge key removed. The database is back to its baseline (rate cache and cron flag only), the wallet copy and code files deleted, no wallet-rpc left, the dev site stopped.

Not covered (3h, with Wyatt's payments):
- snapshots carrying real transfers to a pool address
- `--tx-notify` waking the loop
- a checkout settling through the real bridge
- the built (workerd) copy of the site

Open issues:
- Wyatt folds spec changes 6, 7 and 9–12 into the live spec.
- Delete the excludes on or after 2026-10-08.
- Commits `af293af`, `5e7306d` and this entry are local.

Next step: session 3e, the remote-node cross-check. Compare the block hash at each payment height with a second node before reporting confirmations; hold at 0 and turn a check red on a mismatch.
- Open questions for Wyatt: which second nodes by default (open question 12), and whether the cross-check applies only when the configured node is remote.

## 2026-10-04 · Phase 03 · Session 3e: remote-node cross-check

Done:
- Pushed `6a756ba..5423a71` with Wyatt's approval. Plan approved (all five): spec change 13 accepted, commit `37c68fb`.
  - The method: the second node's whole block at the payment height must have the configured node's hash and contain the txid. The second node learns heights only.
  - Only when the node isn't the shop's own.
  - A built-in list of second nodes, no setting.
  - A mismatch holds the transfer at 0 (red); no second node answering is amber, with confirmations as reported.
  - An optional `checks` field in the sync body, shown on the admin page in phase 04.
- **Second-node research** (open question 12):
  - Stagenet candidates from monero.fail and xmr.ditatompel.com. Six answer `get_info` (stagenet) and `get_block` at height 2221449 with the local node's hash: `stagenet.xmr.kernal.eu:38089` (https, and the only one with https), `stagenet.xmr-tw.org:38081`, `node.sethforprivacy.com:38089`, `node.monerodevs.org:38089`, `node2.monerodevs.org:38089`, `xmr-lux.boldsuck.org:38081`.
  - Mainnet: candidates listed only, not probed (no mainnet use in development). Added to "Still to decide" in `docs/decisions.md`.
- **Code**, commit `3009559`:
  - `noderpc`: `get_block_header_by_height` and `get_block` on a shared JSON-RPC helper.
  - `internal/crosscheck`: the check, the cache per txid@height (a reorg is checked again), the smaller confirmation count, the second node held to 0 while it's behind, own-node detection (names resolved), the built-in lists.
  - The loop applies it before building snapshots; the sync body carries `checks`; `status.json` and `xmr-bridge status` show "Node check" (a mismatch is unhealthy); `run` enables it only for a remote node.

Tests:
- `cd bridge && go test ./...`: all pass, live tests skipped by default. `gofmt` and `vet` clean.
- **Mutation checks, 10 of 10 caught:** block hash not compared, txid not looked for, the second node's count ignored, its network ignored, no cache, cache ignoring the height, the second node behind not held, private LAN treated as remote, the loop ignoring checked confirmations, status calling a mismatch healthy.
- **Live** (`~/xmr-pay-dev-data/3e-live-crosscheck.txt`), the local stagenet node against the built-in public nodes:
  - the spike payment checks out (883 confirmations on both)
  - a made-up txid is a mismatch
  - a proxy rewriting the local node's block hash (a dishonest node) is caught as a mismatch
  - 1.1 s
- The plugin ignores the new top-level `checks` field: its test "accepts a well-formed body and ignores unknown fields" covers a top-level unknown key.

Not covered:
- the cross-check inside a full run with a remote configured node; 3h or phase 05's remote-node run, which uses a public node as the configured node
- mainnet second nodes (to decide)
- the admin page showing `checks` (phase 04)

Open issues:
- **For Wyatt:** the mainnet second-node list, before release (phase 09).
- Wyatt folds spec changes 6, 7 and 9–13 into the live spec.
- Delete the excludes on or after 2026-10-08.
- Commits `37c68fb` through this entry are local.
- Plaintext second nodes: five of the six stagenet nodes are http only. A network attacker between the wallet host and that node could answer for it, but would also have to fake the configured node's view to cause harm. https entries are preferred when the list is chosen for mainnet.

Next step: session 3f, `installer/install.sh` and the systemd unit (Wyatt runs it with `sudo`; the same-machine check; prompts read from `/dev/tty`; the cautious path `xmr-bridge install`).

## 2026-10-04 · Phase 03 · Session 3f-1: xmr-bridge install and uninstall

Done:
- Pushed `5423a71..453538a` with Wyatt's approval. 3f plan approved (all five); `shellcheck` skipped.
- **The install flow**, commit `320ac1b`. Everything the machine sees goes through small interfaces, so the whole flow runs against a fake root folder.
  - Checks before any prompt: root, systemd, `--site`, `--pair`.
  - Prompts on `/dev/tty`: the address, then the view key with echo off. Three tries each, with the 3c checks, including the view key belonging to the address and the spend key recognised. The network comes from the address.
  - The same-machine check (site process, `astro.config.*` importing `emdash`, the site's name resolving here), refused unless `--allow-same-machine` on stagenet. How reliable each signal is (open question 17) is documented in `internal/installer/samemachine.go`.
  - The local node is tried on 127.0.0.1 and [::1] at the network's port, else asked for.
  - The service user and files:
    - `/var/lib/xmr-bridge` (700) holds the bridge binary, wallet-rpc, wallet and key
    - `/etc/xmr-bridge/config` (600, the service account's)
    - `/usr/local/bin/xmr-bridge` symlink, which never replaces a file the installer didn't make
  - wallet-rpc runs as the service account even during install: the supervisor's new `Credential` option, with root's groups dropped.
  - Running it again keeps the wallet for the same address and pairs again; another address is refused.
  - Then systemd: `enable --now`, or `restart` when the unit already existed.
  - `uninstall` keeps the data unless `--delete-data` is given.
  - Commands: `xmr-bridge install --site --pair [--node] [--restore-height] [--no-auto-update] [--allow-same-machine]` and `xmr-bridge uninstall [--delete-data]`.
- **The unit:** a dedicated user, `NoNewPrivileges`, `ProtectSystem=strict` with `ReadWritePaths=/var/lib/xmr-bridge`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, the kernel, cgroup, clock and hostname protections, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `RestrictNamespaces`, `SystemCallFilter=@system-service`, `MemoryDenyWriteExecute`, `ProtectProc=invisible`, `RemoveIPC`, an empty capability set, `UMask=0077`.
  - `systemd-analyze verify`: clean apart from the binary not existing yet.
  - `systemd-analyze security --offline`: exposure 3.0, then **1.5** after the last five directives.
  - `MemoryDenyWriteExecute` and `SystemCallFilter` are confirmed against the real wallet-rpc in Wyatt's run (3f-2).
  - The dev box runs systemd 257 (Debian 13), not Debian 12 as I'd assumed.

Tests:
- `cd bridge && go test ./...`: all pass, live tests skipped by default. `gofmt` and `vet` clean.
- Installer tests:
  - a full install: config, files, modes, owners, symlink, order, the credential, the unit, systemd calls, no key in the output
  - early refusals that leave nothing behind
  - retries and giving up
  - mainnet and the IPv6 local node
  - the node prompt and `--node`
  - same machine, with and without the flag
  - running it again
  - a foreign file at the symlink's place
  - uninstall, with and without `--delete-data`
  - the unit's directives
  - the same-machine signals against a fake `/proc` and fake folders
  - the prompter (echo restored, line cap)
  - `Chown` not following links
- **The real detector on the dev box** (dev site stopped) found the dev site's `astro.config.mjs`, the baseline copy of it in `~/xmr-pay-dev-data/baseline/`, and `localhost` resolving here.
- **Mutation checks:** 12 of 13 caught. The survivor (the dev flag on mainnet) is refused by config validation too, before any change.

Not covered: anything as real root (3f-2, Wyatt's run). Not unit-tested without a terminal or root: `useradd`, `userdel`, `systemctl`, and the terminal echo ioctls.

Open issues:
- Commit `320ac1b` and this entry are local.
- Spec changes 6, 7 and 9–13 to fold into the live spec.
- Delete the excludes on or after 2026-10-08.
- The mainnet second-node list.

Next step: session 3f-2.
- `installer/install.sh` (POSIX `sh`): detect the CPU, download the bridge, check the embedded SHA-256, then `sudo <bridge> install "$@"`.
- `scripts/build-dev-release.sh`, with a dev `install.sh` pointing at `http://127.0.0.1:8099`.
- Wyatt's real run on the dev box: stagenet, `--allow-same-machine`, a code from the admin page, then status, restart and uninstall.

## 2026-10-04 · Phase 03 · Session 3f-2: install.sh, dev release, Wyatt's real install

Done:
- Pushed `453538a..73e2ea2` with Wyatt's approval.
- **`installer/install.sh`**, POSIX `sh`, a template the build fills in (an unfilled one refuses to run), commit `89635ac`.
  - Linux and x86-64 or 64-bit ARM only.
  - Downloads that release's `xmr-bridge` and checks it against the SHA-256 written into the script.
  - Falls back to the home folder when `/tmp` can't run programs.
  - Then `sudo xmr-bridge install "$@"`, reading the terminal so it works piped from curl.
- **`scripts/build-dev-release.sh`:** both CPUs and a filled `install.sh` for `http://127.0.0.1:8099` in `~/xmr-pay-dev-data/dev-release/`. Built at `0.0.0-dev.89635ac`; about 11 MB per binary (4.5 MB at 3a).
- **`scripts/dev-bridge-checks.sh`:** Wyatt's `sudo` checks, written to one file.
- **Wyatt's real install on the dev box** (stagenet, `--allow-same-machine`, a code from the admin page; `data.db` backed up to `~/xmr-pay-dev-data/baseline/data.db.before-3f2`). From `~/xmr-pay-dev-data/3f-checks-output.txt`, `3f-where.txt`, `systemctl` and the site's database:
  - **Installed:** `xmr-bridge status` paired, synced, node check off (own node), 50 of 50 addresses on the site, exit 0. The service ran as `xmr-bridge` with wallet-rpc on 127.0.0.1, no login on its command line, 72 MB.
  - **Files:** config 600 and the wallet files 600, all owned by `xmr-bridge`; data folder 700; the symlink in place.
  - **Hardening:** live `systemd-analyze security` 1.5 OK. wallet-rpc runs under `MemoryDenyWriteExecute` and `SystemCallFilter=@system-service`, so both stay.
  - **Restart:** synced 3 s after.
  - **`kill -9` wallet-rpc:** restarted 6 s later, wallet reopened, height advancing.
  - **Uninstall:** service and symlink gone; wallet, key and config kept, with the message saying where.
  - **The second install with a new code:** the service started at 20:49:56, the wallet opened at height 2222352, the code was marked used, syncing resumed, and the pool stayed at 50 with no new addresses created.
  - The view-only wallet file is about 54 MB just after creation, at a restore height of today.
- **Not recorded:** `3f-install-output.txt` and `3f-reinstall-output.txt` were never written, in `/home/dev` or `/root`; the cause is unknown. That leaves the installer's messages unseen, including "Keeping the existing view-only wallet" on the second run, which is proven only by `TestRunAgain`. Setup-friction row added, with a proposal for Wyatt: `xmr-bridge install` writes its own messages (never the answers) to `/var/lib/xmr-bridge/log/install.log`.

Tests:
- `install.sh` under `/bin/sh` (dash), with a fake release server and fake `sudo`, `uname` and `id`:
  - a good install, with sudo and as root
  - arm64
  - tampered or missing download
  - an unfilled template, another CPU, not Linux
  - the noexec `/tmp` fallback
  - the download folder removed afterwards
- Mutation: without the checksum comparison, 2 tests fail.
- `cd bridge && go test ./...`: all pass.

Not covered:
- the installer's messages in a real run (not captured)
- a separate wallet-host machine (phase 05)
- a remote node in a real install (phase 05)
- arm64 on real hardware

State left:
- **The wallet host service stays installed and enabled on the dev box** for 3g and 3h, paired with the dev site. It backs off while the dev site is stopped.
- The dev site and release server are stopped.
- The dev database holds the pairing: the bridge key, 50 real stagenet subaddresses of the shop wallet in the pool, and `state:bridge`. Remove with `dev-e2e.mjs --cleanup-only` and `sudo xmr-bridge uninstall --delete-data` when done with phase 03.

Open issues:
- **For Wyatt:** the `install.log` proposal (above).
- Spec changes 6, 7 and 9–13 to fold into the live spec.
- Delete the excludes on or after 2026-10-08.
- The mainnet second-node list.
- Commit `89635ac`, the setup-friction row, CLAUDE.md and this entry are local.

Next step: session 3g, signed self-update.
- `release.json` signed with Ed25519 (`"xmr-bridge-release-v1\n"` prefix), up to two pinned keys.
- The `devrelease` build tag pins a dev key from `~/xmr-pay-devkeys/`.
- `--release-url` on stagenet only.
- Downgrade refused, a 48-hour staged delay, rollback on a failed health check.
- The daily check for new Monero wallet-rpc releases (3b-2's verifier).

## 2026-10-04 · Phase 03 · Session 3g (paused): handoff

**Finished** (built, tested, committed locally; not pushed): commits `bfa1f94`, `2d62ff5`, `4754c7b`.
- **Install log:** `/var/lib/xmr-bridge/log/install.log`, written once the installer starts changing the machine. It holds the installer's messages, with answers shown as `[answered]`, never the answers or the code.
- **Signed self-update:** `release.json` signed with Ed25519 over `"xmr-bridge-release-v1\n"` plus its bytes, checked against pinned keys.
  - Newer versions only; a refused version, and anything older, is skipped until a newer one appears.
  - Waits 48 h after the signed date.
  - Size, SHA-256 and a `version` run are checked before any swap.
  - The previous binary is kept as `.prev`.
  - Applied with wallet-rpc stopped, then exit 75 for systemd to restart the service.
- **Rollback:**
  - The guard (`update-guard.sh`, `ExecStartPre`, run as `xmr-bridge`) restores the previous binary on the 4th start without a proper start, then refuses the version.
  - The 10-minute rule rolls back only when the wallet never opened, or when the site answered and refused while nothing was accepted. An unreachable site never counts against the update.
- **wallet-rpc updates:** 48 h after first seen; the wallet files are backed up before the swap. Rollback after 3 failures or 5 minutes, restoring both binary and wallet, and refusing the version.
- **Admin copy:** `/usr/local/bin/xmr-bridge` is now a root-owned copy (hash recorded; uninstall removes only that file), so root never runs a file the service can write.
  - `status`, `pair` and `uninstall` refuse a newer state format, telling you to re-run the installer.
  - `pair` run as root hands the key to `xmr-bridge`.
- **The unit:** `StartLimitIntervalSec=600` and `StartLimitBurst=20` in `[Unit]`; `ExecStartPre` without a prefix, `RestartForceExitStatus=75` and `RestartSec=10` in `[Service]`; `User=` and `Group=xmr-bridge`. `systemd-analyze security --offline`: 1.5.
- **Dev builds** (`-tags devrelease`):
  - The dev public key and release address are set at build time.
  - Updates happen only when the open wallet's address is on stagenet.
  - Short delays.
  - Break modes: `crash` and `badsig`.
- **The content test:** a release build contains no dev key, no dev address and no `devBreak` (with a control on the dev build).
- **Scripts:**
  - `dev-release-key.sh` and `sign-dev-release.sh` (both run by Wyatt)
  - `build-dev-release.sh` (`--version`, `--break`, unsigned `release.json`)
  - `check-dev-signature.sh` (Claude: public key only)
- **Tests:** `cd bridge && go test ./...` passes, with and without `-tags devrelease`; `gofmt` and `vet` clean. 17 of 17 mutation checks caught. An `openssl -rawin` signature verifies in `VerifyManifest` (checked with a throwaway key, since deleted).

**Left, in order:**
1. **Wyatt makes the dev key**, on the dev box as `dev`, not with sudo:
   ```sh
   sh ~/xmr-pay/scripts/dev-release-key.sh 2>&1 | tee /home/dev/xmr-pay-dev-data/3g-key-output.txt; ls -l /home/dev/xmr-pay-dev-data/3g-key-output.txt
   ```
2. **Claude:**
   - reads `3g-key-output.txt` and `~/xmr-pay-dev-data/dev-release.pub`
   - backs up `data.db`
   - builds V1 with `scripts/build-dev-release.sh`
   - starts the dev site (fresh plugin build) and the release server: `tmux new -d -s release 'cd ~/xmr-pay-dev-data/dev-release && python3 -m http.server 8099 --bind 127.0.0.1'`
3. **Wyatt's sudo reinstall** with a new code from Connect wallet host; only the installer runs with sudo, and the output path is absolute:
   ```sh
   curl -fsSL http://127.0.0.1:8099/install.sh | sh -s -- --site http://localhost:4321 --pair <CODE> --allow-same-machine 2>&1 | tee /home/dev/xmr-pay-dev-data/3g-reinstall-output.txt; ls -l /home/dev/xmr-pay-dev-data/3g-reinstall-output.txt
   ```
   This migrates the 3f layout (the symlink becomes the root-owned copy, the guard is installed, the unit gets its new lines).
4. **V2, good:** Claude builds `--version <newer>`; Wyatt runs `sh ~/xmr-pay/scripts/sign-dev-release.sh`; Claude checks with `scripts/check-dev-signature.sh`, then watches the service update itself (2-minute delay, checks every minute) and commit after a sync.
5. **V3, crash:** `--break crash`; Wyatt signs. Expected: the guard rolls back on the 4th start, V3 is refused, and the next check skips it.
6. **V4, bad signature:** `--break badsig`; Wyatt signs. Expected: the site answers `BAD_SIGNATURE`, and 10 minutes later V4 is rolled back and refused.
7. Then: the 3g progress entry, the push (with Wyatt's approval), and CI on the new commits.

**Open or unverified:**
- **No 3g behaviour has run on the real system yet:** updates, both rollbacks, the guard under `ProtectSystem=strict` as the service user, the new unit lines under real systemd, the admin copy and the install log.
- **The installed service is the 3f build** (`0.0.0-dev.89635ac`): old layout (the symlink), no guard, the old unit, no update code. It is still active and paired, backing off while the dev site is stopped. Step 3 replaces it.
- **The harness refuses any Bash command that touches `~/xmr-pay-devkeys/`** (the new Read deny applies to shell commands too). Every key operation is Wyatt's.
- **`.claude/settings.json` has Wyatt's two deny rules, uncommitted;** his to commit.
- **wallet-rpc updates can't be tested live:** there is no newer Monero release than 0.18.5.1. They're covered by unit tests only.
- **CI hasn't run on `bfa1f94`, `2d62ff5`, `4754c7b`** (not pushed), including the race step on the new code.
- The dev database still holds the 3f-2 pairing: the bridge key and 50 real stagenet subaddresses of the shop wallet.
- From earlier sessions:
  - fold spec changes 6, 7 and 9–13 into the live spec
  - delete the release-age excludes on or after 2026-10-08
  - the mainnet second-node list
  - the 3f-2 transcripts were never captured

## 2026-10-05 · Phase 03 · Session 3g: live update and rollback runs (3g done)

Done:
- **Wyatt's steps:** made the dev key (`dev-release-key.sh`; the public key in `~/xmr-pay-dev-data/dev-release.pub`, 32 bytes), committed his deny rules (`34f1000`), reinstalled from a dev release, and signed V2, V3 and V4. Each signature was checked with the public key only (`scripts/check-dev-signature.sh`), which also proved the public file matches his key.
- **V1 install** (`0.0.202610051414-dev.34f1000`), from `~/xmr-pay-dev-data/3g-final-output.txt` and what I could see without root:
  - The 3f layout migrated: `/usr/local/bin/xmr-bridge` is now a root-owned copy, and the guard is installed.
  - The unit systemd loaded has every new line: `StartLimitIntervalSec=600` and `StartLimitBurst=20` in `[Unit]`, `User=` and `Group=xmr-bridge`, `ExecStartPre=…/update-guard.sh` with no prefix, `RestartForceExitStatus=75`, `RestartSec=10`, and the hardening.
  - `install.log`: questions shown as `[answered]`, "Keeping the existing view-only wallet for this address", pairing done, the dev-flag signals listed.
- **V2, good update** (`…1436`): at 08:39:43 it verified the signed `release.json`, downloaded and checked the binary, and swapped it in. It logged "restarting for the update" (exit 75), systemd restarted it 10 s later, and it logged "update confirmed" 15 s after starting (08:40:09). Later checks fetched `release.json` and its signature but never the binary again.
- **V3, crash** (`…1447`): swapped in at 08:50:33. Three starts each logged "deliberately broken … exiting", 10 s apart. Then the guard, as the service user: "the update to bridge …1447 didn't start 3 times in a row; rolled back and refused it" (08:51:14), and V2 started again. Later checks never downloaded V3. systemd stayed well inside its start limit (5 starts in about 45 s).
- **V4, bad signature** (`…1451`, newer than the refused V3, so it got past that refusal): swapped in at 08:54:35 and ran normally. The site's last accepted sync stayed frozen at 14:54:29 UTC for 10 minutes; every sync was refused with `BAD_SIGNATURE`. At 09:04:46, 10 minutes after the swap: "the update to bridge …1451 didn't work; rolling back to …1436 and refusing …1451". V2 was back at 09:04:57, and the site accepted syncs again from 15:05:27 UTC.
  - `run/refused` holds both V3 and V4.
  - The admin copy (still V1) ran `status` successfully against the self-updated V2 service: same state format, exit 0.
- **Two gaps found by the live run, fixed** (commit `52cf950`, tests first, mutation checks caught):
  - `xmr-bridge status` didn't print the update state it records; it now prints `Updates:`.
  - `update-state.json`, which the admin copy's format check reads, only appeared once a wallet-rpc version had been seen; `run` now writes the format at every start.
  - Both are unit-tested; neither is live yet (the service runs V2, built before them). A V5, signed the same way, would deliver them.
- Setup-friction row: why `tee` transcripts can't hold the installer's messages, and the still-missing files.

Tests:
- `cd bridge && go test ./...`: all pass, with and without `-tags devrelease`; `gofmt` and `vet` clean.
- Live: V1 install, V2 update, V3 crash rollback, V4 10-minute rollback, all as designed (watch files `~/xmr-pay-dev-data/3g-v3-watch.txt`, `3g-v4-watch.txt`; journal and state in `3g-final-output.txt`).

Not covered:
- wallet-rpc updates live (there is no newer Monero release than 0.18.5.1; unit tests only)
- an update while the site is unreachable (unit-tested as "wait, never roll back")
- a real arm64 machine
- release builds' "no key pinned" state on a live machine (unit-tested)

State left:
- The wallet host service runs V2 (`0.0.202610051436-dev.34f1000`), paired, and backs off while the dev site is stopped.
- The dev site and release server are stopped; no tmux sessions.
- `~/xmr-pay-dev-data/dev-release/` holds the V4 files.
- The dev database still holds the pairing and 50 real stagenet subaddresses.

Open issues:
- Commits `bfa1f94`, `2d62ff5`, `4754c7b`, `a0b03fd`, `52cf950` and this entry are not pushed; CI hasn't run on them.
- Spec changes 6, 7 and 9–13 to fold into the live spec.
- Delete the release-age excludes on or after 2026-10-08.
- The mainnet second-node list.
- The cause of the missing transcript files is still unknown.

Next step: session 3h, end to end on stagenet with the dev site, with Wyatt sending payments:
- happy path, two-part payment, underpayment, late payment
- the bridge stopped across an invoice's expiry
- wallet-rpc killed, the site unreachable
- re-pairing after deleting the bridge's key
- plus spec change 9's subaddress-lookahead test

## 2026-10-05 · Phase 03 · Before 3h: the plugin is renamed Coffer (slug `coffer`)

Done:
- **Rename** (Wyatt's decision; spec change 14, proposed; `docs/decisions.md`), commits `2f0bdf1` (code) and `5fbda8c` (docs). Every `xmr-pay` hit was sorted into three groups:
  - **Slug or brand, changed:** the manifest slug `coffer` and name `Coffer`, the npm name `coffer`, the bridge's sync route `/_emdash/api/plugins/coffer/bridge/sync`, the access-rule hint path, the `BAD_RESPONSE` hint, the subaddress label `coffer` (write-only, nothing reads it back), doc comments, `dev-e2e.mjs`, the seed wording, README, CLAUDE.md, the contract README, phases 06 and 08, the setup-friction lessons.
  - **Installer wording:** `install.sh` now says `xmr-bridge installer:` and uses `xmr-bridge.XXXXXX` temp folders (Wyatt's choice: the wallet host keeps the xmr-bridge name).
  - **Unchanged:** the xmr-bridge layer (binary, user, paths, unit including its `Description`, guard, the signed `"xmr-bridge-release-v1\n"`), dev-box paths, signed hash-list fixtures, dated history, the PoC snapshot.
- **Dev site:**
  - Old plugin's data removed. EmDash can't uninstall a config-listed plugin from the admin page, so Wyatt ran `~/xmr-pay-dev-data/purge-xmr-pay.cjs` after the auto-mode classifier blocked it for Claude; it ran 2 storage rows, 7 indexes and the cron row down to 0. A read-only scan finds no `xmr-pay` in any table or index.
  - Dependency and `astro.config.mjs` switched to `coffer`.
  - This replaces the end-of-phase-03 cleanup: `dev-e2e.mjs --cleanup-only` and Wyatt's `sudo xmr-bridge uninstall --delete-data` both ran.
- **Dev bridge reinstalled and re-paired:** `dev-release/` emptied, then rebuilt as `0.0.202610051631-dev.5fbda8c`; the binary holds the coffer path and no `plugins/xmr-pay`.
  - Wyatt's install with a `--issue-code` code; the service is active.
  - `xmr-bridge status`: paired, synced 5 s before, stagenet, node check off (own node), 50 of 50 addresses, **`Updates:    on`**. That line is from `52cf950`, now live.
  - Site side: 50 `coffer` pool rows, `state:bridge` at height 2222773, the bridge key option, the 7 `idx_plugin_coffer_*` indexes (created on EmDash's periodic sweep, not at plugin load).
- **The transcript** `coffer-install-output.txt` was written (12:16:12, checked with `ls -l` in the same command). As 3g found, it holds only `install.sh`'s two lines; the installer talks through `/dev/tty`, and its record is `install.log`. So the missing 3f and 3g key files remain unexplained, but this run shows `tee` itself works from Wyatt's shell.
- Setup-friction rows (`2e4becf`): a handed-over script that was never written (Claude's error), and a `cp` backup of `data.db` without its WAL.

Tests:
- Tests first. Each new expectation failed before the code change: the source manifest's slug and name, the pool label `coffer`, the `xmr-bridge installer:` prefix, the sync and hint paths.
- Plugin: typecheck clean, `validate` ok, 120 of 120 tests, bundle check ok (27.5 KB).
- Bridge: gofmt and vet clean; `go test ./...` and `go test -tags devrelease ./...` all pass.
- Live: the steps above.

Not covered:
- `walletrpc/client_test.go` passes with any label (it tests the pass-through only); `bridgeloop`'s test pins the label.
- The `housekeeping` cron row doesn't exist yet. As designed, a config-listed install schedules it on the first admin page load (`src/admin.ts:148`), and pairing went through `--issue-code`, so the admin page hasn't been opened.
- Backups: `data.db.before-coffer.NO-WAL` lacks the WAL. The full copy is `data.db.coffer-after-cleanup` (`VACUUM INTO`, after the old-slug cleanup).

State left:
- The wallet host service runs `0.0.202610051631-dev.5fbda8c`, paired with the dev site under `coffer`, and backs off while the site is stopped.
- The dev site and release server are stopped; ports free. `dev-release/` holds this build (unsigned `release.json`).

Open issues:
- **For Wyatt:**
  - spec change 14: fold it into the live spec, and decide on the unit's `Description` and the PoC
  - whether `coffer` is free in the registry and on npm
- Commits `2f0bdf1`, `5fbda8c`, `2e4becf` and this entry are not pushed.
- Carried over: spec changes 6, 7 and 9–13 to fold in; delete the release-age excludes on or after 2026-10-08; the mainnet second-node list.

Next step: session 3h as planned (stagenet end to end with the dev site, Wyatt sending payments). Open the admin page first, which schedules the cron. Back up `data.db` with `VACUUM INTO`.

## 2026-10-06 · Phase 03 · Session 3h: stagenet end to end with the dev site

Done (real stagenet payments from Wyatt's buyer wallet through the installed bridge into the dev site; Speed Standard, 2 confirmations; evidence files `~/xmr-pay-dev-data/3h-*`, the watch log `3h-watch.txt`):
- **Tooling** (`b290c9a`, `4014a2b`): `scripts/dev-invoices.mjs` (checkouts, pay scripts Wyatt runs, a status watcher, the `drain-pool` dev shortcut Wyatt approved), `walletrpc.RescanBlockchain`, `TestLiveLookahead`.
- **Results, each as the spec says:**
  | Scenario | Result |
  |---|---|
  | No payment | 4 invoices: `pendingExpiry` at the deadline, `expired` at the next sync (19:30:20 to 19:30:35) |
  | Happy | Full payment at once: `confirming` (skipping `seen`), then `settled` at 2 confirmations |
  | Two-part | 60% then 40%, both in the window: `seen`, `confirming`, `settled` |
  | Underpaid | 90%: `seen`, then review `underpaid` at expiry. A first two-part attempt whose second part couldn't come in time did the same |
  | Late | Paid after expiry, within 24 h: `expired` to review `late` |
  | E: bridge stopped across expiry | Both invoices `pendingExpiry` while the bridge was silent. Started about 2 h after the deadline: the paid one (mined at 2222909, `expiresHeight` 2222924) settled, the unpaid one expired |
  | K: wallet-rpc killed | Restarted by the bridge's supervisor 1 s later (systemd restarts 0); syncs continued |
  | S: site down 5 min | The bridge backed off and resumed within about 3 min of the site's return; a payment made during the outage was reported then |
  | R: key deleted | `status` said "not paired" with the fix; `pair` with a new code; syncs resumed |
  | L1: gap | Index 261, 252 past the last paid index: reported and settled |
  | L2: shop app stand-in | Not seen as restored, not seen after creating addresses, seen after a rescan (spec change 9 evidence) |
  | L3: reinstall | Found a gap: a settled high-index invoice falsely went to review `reversed`, and the catch-up was a 303-sync loop. **Spec change 15, proposed** |
- **Docs:** spec change 9's evidence, spec change 15, and a setup-friction row (Claude's `pkill -x` mistake).

Tests:
- `node --test scripts/dev-invoices.test.mjs`: 5 pass; two mutation checks caught.
- Bridge: `go test ./...` passes with and without `-tags devrelease`; gofmt and vet clean. `TestLiveLookahead` passed live on its second run; the first failed on the 5 s client timeout during the rescan, now tolerated.
- Live: the table above.

Not covered:
- Tips; a reorg or double-spend on stagenet (plugin scenario tests only); overpayment; the per-client rate limit.
- **The admin page wasn't opened**, so its bridge-key display (part of phase 03's "done when") isn't confirmed this session, and the `housekeeping` cron row still doesn't exist.
- Whether raising a wallet app's lookahead before restoring finds the far payment (spec change 9's open question for Wyatt).

Notes for later phases:
- Phase 04 admin page: an underpaid or review invoice shows `confirmations: 0` because the count is that of the payment that crosses the threshold (`totals()`). Label it, or show the deepest transfer.
- Phase 04: the site has no way to undo a false `reversed` except an admin decision (spec change 15 prevents the cause).

State left:
- The wallet host service runs `0.0.202610051631-dev.5fbda8c`, reinstalled in L3 with restore height 2222850, paired, synced.
- The dev site, watcher and release server are stopped; ports free; no tmux sessions.
- The dev database (backup before the session: `baseline/data.db.before-3h`, `VACUUM INTO`):
  - 16 invoices (settled, expired and review)
  - `far` in review `reversed`, a consequence of the reinstall gap
  - pool rows 1–312, with 261 drained rows claimed without invoices
  
  Clean up with `dev-e2e.mjs --cleanup-only` when no longer needed.

Open issues:
- **For Wyatt:**
  - spec change 15 (accept, change or reject)
  - spec change 14 (fold in)
  - spec change 9's lookahead question
  - open the admin page once to confirm the bridge key and schedule the cron
- Commits `b290c9a`, `4014a2b` and this session's docs commit are not pushed.
- Carried over: spec changes 6, 7 and 9–13 to fold in; delete the release-age excludes on or after 2026-10-08; the mainnet second-node list.

Phase 03 status: its "done when" is met (install.sh sets up the service, pairing succeeds, a stagenet payment settles, the restart and outage tests pass), apart from the admin-page check above. Spec change 15 is a real gap in the reinstall path; if Wyatt accepts it, the next session (3i) implements it and reruns L3.

Next step: Wyatt decides spec change 15 and opens the admin page. Then either session 3i (spec change 15) or phase 04.

## 2026-10-06 · Phase 03 · End of day: handoff (break for the night)

Pushed with Wyatt's approval: `2f0bdf1..9768d84` (the Coffer rename) and `b290c9a..c5d23c0` (3h), CI green on both (`c5d23c0`: run 37407668991). This handoff commit is local.

Everything found or changed in this session (2026-10-05 and 06), with where it's recorded:
1. **The plugin is Coffer, slug `coffer`.** The wallet host keeps the xmr-bridge name, and the repo and dev-box paths keep xmr-pay. Recorded in `decisions.md` and spec change 14 (proposed: spec text to fold in, the unit's `Description` and the PoC left for Wyatt).
2. **EmDash facts found on the way** (spec change 14 and the rename entry):
   - a new slug is a new plugin
   - EmDash's uninstall handles only registry and marketplace plugins, so a plugin listed in `astro.config.mjs` has its data removed by hand
   - plugin indexes are created on EmDash's periodic sweep, not at load
   - such a plugin schedules its cron only on the first admin page load (already in the spec)
3. **Payment rules confirmed on stagenet** (3h entry): no-payment expiry on evidence, happy, two-part, underpaid, late, bridge stopped across expiry (settled on `expiresHeight`), wallet-rpc killed, site down, key deleted and re-paired, far-index payment.
4. **Spec change 9 evidence:** a wallet restored from keys with default settings misses a payment 252 addresses past the last paid one; creating the address alone doesn't find it; a rescan does.
5. **Spec change 15 (proposed):** a reinstalled bridge doesn't catch its wallet up to the pool.
   - It caused a false review `reversed` on a settled invoice (`far`, index 261, still in review in the dev database).
   - It caused a 303-sync loop of duplicate addresses.
   - It risks missing payments mined to addresses the fresh wallet doesn't know yet.
   - The bridge's 5 s wallet-rpc client timeout matters for any rescan.
6. **New code and tooling:**
   - `scripts/dev-invoices.mjs` and its tests, `walletrpc.RescanBlockchain`, `TestLiveLookahead`
   - CLAUDE.md commands for both, and for database backups
   - `decisions.md`: the pay-script and pool-drain dev shortcuts
7. **For phase 04's admin page** (3h entry, "Notes for later phases"):
   - Underpaid and review invoices show `confirmations: 0` by design; label it.
   - A false `reversed` can only be cleared by an admin decision.
8. **Setup friction, 4 rows:**
   - a handed-over script that was never written (Claude)
   - a `cp` backup without the WAL (Claude)
   - `pkill -x` with a long process name (Claude)
   - the buyer wallet's funds and the 10-block lock pacing the payments
   
   Also, in the rename entry: the `tee` transcript did land this time (absolute path, checked with `ls -l`) and holds only `install.sh`'s lines, as 3g found. The 3f/3g missing files stay unexplained.
9. **Not done:**
   - Wyatt hasn't opened the admin page, so the bridge-key display (phase 03's last "done when" item) isn't confirmed and the `housekeeping` cron isn't scheduled.
   - Not covered on stagenet: tips, reorgs, double-spends, overpayment, the per-client rate limit.

State left for the break:
- The bridge service is installed and paired (L3 reinstall, restore height 2222850). It keeps running, backing off quietly while the dev site is stopped.
- The dev site, watcher and release server are stopped; no tmux sessions.
- The dev database holds the 3h invoices; the backup from before the session is `baseline/data.db.before-3h`.
- `~/xmr-pay-dev-data/3h-*` holds the evidence and the used pay scripts. They contain stagenet addresses only, no keys.

Reminders:
- Delete the release-age excludes on or after **2026-10-08**.
- Spec changes 6, 7 and 9–14 to fold into the live spec; the mainnet second-node list.

Next step, in order:
1. Wyatt decides spec change 15 (`docs/spec-changes.md`, last entry).
2. Wyatt opens the admin page once through the tunnel (`ssh -N -L 4321:localhost:4321 xmr-dev`, with the dev site started) to confirm the bridge key; that also schedules the cron. Phase 03 is then done.
3. If spec change 15 is accepted: session 3i. Tests first (fresh wallet behind the pool: no snapshots before catch-up, one rescan, no duplicate addresses), then the plugin's `poolTop`, then the bridge, then L3 again on stagenet. Otherwise phase 04.

## 2026-10-07 · Phase 03 · Session 3i: spec change 15 (catch-up after a reinstall), part 1

Wyatt accepted spec change 15 today and asked for it next.

Done:
- **Docs** (`398c61c`): spec change 15 marked accepted; `decisions.md` entry.
- **Plugin** (`8acdffa`): the `bridge/sync` response carries `poolTop`, the pool's highest `addrIndex` (pool rows are never deleted and every invoice's index is a pool row). An optional field; no trust-contract change.
- **walletrpc** (`4f04c11`):
  - `HasSubaddress` (`get_address`; −15 means absent)
  - `CreateAddresses` (`create_address` with `count`, at most 1000 per call, consecutive indexes checked)
  - `RescanBlockchain` now runs on an untimed copy of the client (ctx bounds it)
  
  Behaviour read from wallet-rpc v0.18.5.1's source (`~/work/monero-v0.18.5.1`, sparse clone).
- **Bridge loop** (`f631de5`):
  - When the site's `poolTop` is above what the wallet is known to have, the bridge probes the wallet. If the index is missing, it creates addresses up to `poolTop` in batches of 100 (not sent), rescans once (capped at 24 h), then reconciles.
  - Marker `run/catchup.json` redoes an interrupted catch-up, rescan included, before any snapshot.
  - A top-up address at or below `poolTop` is never sent; it starts a catch-up.
  - `xmr-bridge status` shows a "Catching up" line and doesn't report a stale sync while it runs.
- **Live** (`1a1ec84`, `TestLiveShopWallet`, stagenet, real wallet-rpc 0.18.5.1): a fresh wallet's next index was 10; −15 above it; `count` 100 in 198 ms and 1000 in 2.2 s, consecutive; `rescan_blockchain` answered after 8 s through the supervisor's 5 s client. Evidence: `~/xmr-pay-dev-data/3i-live-shopwallet.txt`.
- **Phase 03's last "done when" item: met.** Wyatt opened the admin page through the tunnel: Paired, last sync "less than a minute ago", 50 of 50 free. The `housekeeping` cron row exists (hourly, created 2026-10-08 01:19:16 UTC).

Tests:
- Plugin: 122 pass (2 new), typecheck, validate and bundle check (27.6 KB) clean. Mutation check: ascending order caught.
- Bridge: gofmt, vet, `go test ./...` with and without `-tags devrelease` pass.
- New tests: syncclient `TestPoolTop` and two refusal cases; walletrpc rescan-timeout, `HasSubaddress`, `CreateAddresses`; bridgeloop L3 model (pool to 312, paid index 261, wallet at 10), redo after a failed rescan and restart, the top-up guard, an older site without `poolTop`, no probe per top-up; `TestStatusCatchUp`.
- Mutations caught: no top-up guard, no redo at start, no rescan. Static build OK.
- Race detector: CI only (no `gcc` here).

Not covered yet: the L3 rerun on stagenet (below).

Paused: Wyatt's buyer wallet had too little sXMR for `far3` (index 263, created 01:07 UTC). It expired unpaid at 01:37 and will show `expired` at the next sync.

Findings for later (not acted on):
- **Stale height estimate at checkout:** after about 1.5 days of a silent bridge, checkout's estimate (`checkout.ts:142`, last sync + 2 min per block) was 35 blocks low, so `far3`'s `expiresHeight` (2224387) was already below the chain (2224404). Payments still count as on time if seen before `expiresAt`. But a payment reported late after a long outage is judged against a too-low `expiresHeight`. For Wyatt / phase 04.
- **Reinstall restore height:** `xmr-bridge install` defaults `--restore-height` to today. A reinstall with the default can't find payments mined before it, even with spec change 15's rescan. The rescan only scans from the restore height. For Wyatt: possibly the installer should suggest a height at or below the oldest open invoice's `createdHeight`. Spec-changes proposal to write if he wants it.

State left:
- Dev site, watcher and release server stopped; ports free.
- Installed bridge is still the old `0.0.202610051631-dev.5fbda8c`, paired.
- New dev release `0.0.202610080123-dev.1a1ec84` is built in `~/xmr-pay-dev-data/dev-release/` (unsigned `release.json`; install needs only the SHA-256s).
- Database backup `baseline/data.db.before-3i`.

Next step (when Wyatt's wallet is topped up), the L3 rerun:
1. Start the site and the watcher.
2. New invoice `far3b`; Wyatt pays it; it settles.
3. New invoice `far4`. Serve the release.
4. Wyatt:
   - `sudo xmr-bridge uninstall --delete-data`
   - pay `far4` and wait for it to be mined
   - reinstall with `--restore-height 2222850` and a code from `dev-e2e.mjs --issue-code`
5. Expect:
   - `far3b` stays settled
   - `far4` is found by the rescan and settles
   - nothing goes to review `reversed`
   - the "Catching up" status, then normal
   - no burst of syncs

## 2026-10-08 · Phase 03 · Session 3i, part 2: the L3 rerun on stagenet (spec change 15, live)

Evidence: `~/xmr-pay-dev-data/3h-watch.txt` (from "--- 3i run resumed"), `3i-before-reinstall.txt`, `3i-uninstall-output.txt`, `3i-install-output.txt`, `3i-status-output.txt` (status and journal).

Run (Speed Standard, 2 confirmations; times UTC):

| Step | Result |
|---|---|
| `far3b`, index 264, paid by Wyatt | `confirming` 01:50:37, `settled` 01:52:23 |
| Uninstall, `--delete-data` (old bridge `5fbda8c`) | Service, data and user removed |
| `far4`, index 265, created 01:53:53, paid with no bridge installed | Mined at 2224419 (`expiresHeight` 2224436); `pendingExpiry` at 02:23:55, correctly, with no evidence yet |
| Reinstall, dev release `0.0.202610080123-dev.1a1ec84`, `--restore-height 2222850`, a fresh pairing code | Started 02:32:54 |
| Catch-up | 02:32:57 wallet open (height 579994), target 314; 02:32:58 addresses created, rescan; 02:33:09 caught up (11 s); 02:33:10 one top-up address (index 315) |
| `far4` | `pendingExpiry` → **`settled`** 02:33:15, 1786639510 atomic, 23 confirmations: **found by the rescan** |
| `far3b` | Stayed **`settled`** (reported with its transfer, 26 confirmations) |
| False `reversed` | **None** (only `far`, index 261, from 3h remains) |
| Duplicate-address loop | **None**: 315 pool rows, top 315; one `created pool addresses` line after the catch-up (3h: 303) |
| `xmr-bridge status` | Paired, last sync 10 s, 50 of 50, watching 1 |

All of spec change 15's expectations held. Its "status shows catching up" wasn't seen live, because the catch-up took 12 s; it's covered by `TestStatusCatchUp`.

The first reinstall attempt didn't reach the dev box (setup-friction row). `far3` (index 263) expired unpaid while the buyer wallet was refunded.

New spec-change proposals (for Wyatt):
- **16:** the site's height can be far off. A fresh wallet's first sync reports height 579994. Checkout's estimate after 1.5 days of silence was 35 blocks low. Either gives invoices a too-low `expiresHeight`. Proposed: a stored height that never goes down; refuse checkout (or ignore the height rule) when the bridge is silent.
- **17:** a reinstall's restore height. The default (today) would have missed `far4` despite the rescan. Proposed: the pairing response suggests a restore height from the oldest watched invoice.

State left:
- Bridge `0.0.202610080123-dev.1a1ec84` installed and paired; it backs off while the site is stopped.
- Dev site, watcher and release server stopped; ports free; no tmux sessions.
- Dev database: 3h's invoices plus `far3` (expired), `far3b` and `far4` (settled); pool rows 1–315. Backup from before 3i: `baseline/data.db.before-3i`.
- `~/work/monero-v0.18.5.1`: a sparse clone of Monero's wallet source (reference only).

Phase 03 status: done. Every "done when" item is met, and spec change 15 is implemented and passed on stagenet.

Open issues:
- **For Wyatt:**
  - spec changes 16 and 17
  - spec changes 6, 7, 9–15 to fold into the live spec (15 is accepted)
  - spec change 9's lookahead question
  - the mainnet second-node list
- Commits from `398c61c` to this entry are not pushed. CI's race-detector step covers the new bridge code; there's no `gcc` here.
- **Today (2026-10-08):** delete the release-age excludes and their reminder (CLAUDE.md, dependency tiers).

Next step:
1. Wyatt approves the push and watches CI.
2. The release-age excludes are deleted (due today).
3. Wyatt decides spec changes 16 and 17.
4. Phase 04 (admin page), which also picks up 3h's notes: label `confirmations: 0` on review invoices; an admin path to clear a false `reversed`.

## 2026-10-08 · Phase 03 · Wrap-up: spec changes 16 and 17 accepted, push, release-age excludes deferred to 16:48 UTC

- **Spec changes 16 and 17 accepted by Wyatt.** Recorded with the recommended sub-choices: for 16, checkout refuses while the bridge is silent; for 17, option (a). Wyatt may override either before implementation. `decisions.md` rows added.
- **Release-age excludes not deleted yet.** The newest excluded package, `emdash@1.1.0`, was published 2026-10-01T16:47:35Z (`npm view … time`); `plugin-cli`, `admin` and others came minutes earlier, and four were published on 2026-09-27. So the 7-day rule passes for all of them only at **2026-10-08T16:48Z**. Deleting earlier would make the strict `pnpm install` refuse them.
- **Still due, after 16:48 UTC today:** delete the whole `minimumReleaseAgeExclude` block and its comment from `plugin/pnpm-workspace.yaml` and `spikes/xmr-spike/pnpm-workspace.yaml`, run `pnpm install` in each (one at a time), confirm both succeed with `pnpm-lock.yaml` unchanged, then commit, and remove the reminders.
- Next step after that: phase 04 (admin page), planned with spec changes 16 and 17. They touch the plugin's sync, checkout and the pairing response, and the bridge's installer; Wyatt to say whether they go into phase 04 or a session 3j first.

## 2026-10-08 · Phase 03 · End of night: handoff (Wyatt chose session 3j before phase 04)

Pushed with Wyatt's approval: `c5d23c0..60e22a8`. CI run 37719242461 passed, both jobs, the race-detector step included (the first race run of the spec change 15 code). This handoff commit is local.

Added tonight:
- `scripts/ci-status.py`: CI status from GitHub's public API, because there's no `gh` here. CLAUDE.md has a row for it.
- Phase 03's session table now has 3i and 3j.
- A setup-friction row: a time-based reminder needs the exact UTC moment.

State left:
- The bridge `0.0.202610080123-dev.1a1ec84` is installed and paired, backing off while the site is stopped.
- The dev site, watcher and release server are stopped; no tmux sessions.
- The dev database has 3i's invoices; backup `baseline/data.db.before-3i`.

Next steps, in order:
1. **After 2026-10-08T16:48Z only:** delete the release-age excludes.
   - Delete the whole `minimumReleaseAgeExclude` block and its comment in `plugin/pnpm-workspace.yaml`, then in `spikes/xmr-spike/pnpm-workspace.yaml`.
   - Run `pnpm install` in each, one at a time (memory).
   - Confirm both succeed and `pnpm-lock.yaml` is unchanged.
   - Run the plugin tests, commit (the lockfile note in the message: "no lockfile change"), and remove the reminders here.
   
   Before that time, skip this step and come back to it at the end of the session.
2. **Session 3j: spec changes 16 and 17**, plan first.
   - At the start, confirm the sub-choices with Wyatt: for 16, refuse checkout while the bridge is silent, against ignoring the height rule; for 17, option (a).
   - Likely scope, to check against the code in the plan:
     - plugin `handle.ts`: the stored height never goes down
     - `checkout.ts`: a domain error while the last sync is older than 5 minutes (spec change 2's threshold), replacing the estimate at `checkout.ts:142`
     - the pairing response: a suggested restore height, the oldest watched invoice's `createdHeight` minus a margin (or none when nothing is watched)
     - bridge installer: use the suggestion when `--restore-height` isn't given. This means pairing before the wallet is created; check `bridge/cmd/xmr-bridge/install.go` and `internal/installer` for the order.
     - optionally, the bridge doesn't sync until its wallet is within a few blocks of the node
   - Tests first.
   - Live: a reinstall without `--restore-height` that still finds a payment mined while uninstalled. That needs Wyatt (sudo, a payment), so check his buyer wallet's unlocked balance first.
3. Phase 04 (admin page), with 3h's notes: label `confirmations: 0` on review invoices, and an admin way to clear a false `reversed`.

Carried over for Wyatt:
- Spec changes 6, 7 and 9–17 to fold into the live spec (14 is the rename text).
- Spec change 9's lookahead question.
- The mainnet second-node list.

## 2026-10-08 · Phase 03 · Session 3j, part 1: spec changes 16 and 17 implemented; live run waiting for Wyatt

Wyatt approved the plan with the recommended sub-choices: 16 refuses checkout while the bridge is silent, and the optional bridge-side wait is skipped. 17 is option (a), with a 720-block margin. A kept wallet with too new a height gets a warning only.

Done (local commits, not pushed):
- `b448231` Release-age excludes deleted, after 16:48 UTC as planned. `pnpm install` in `plugin/` and `spikes/xmr-spike/`: lockfile unchanged, supply-chain check passed. The 2026-10-03 reminder is marked done.
- `ed2cfc2` (16) `bridge/sync` stores `max(stored, reported)` and judges snapshots at that height. Without it, a re-confirmation could start at a fresh wallet's tiny height and become a false `reorg` review.
- `3562463` (16) Checkout returns `WALLET_HOST_SILENT` when the bridge never synced or last synced more than 5 minutes ago. Otherwise it uses the last sync's height, with no estimate. `SILENT_MS` moved to `core/constants.ts`.
- `c212172` (17) The pairing response carries `restoreHeight`: the oldest watched `createdHeight` − 720, left out when nothing is watched.
- `0d66a34` (17) Bridge:
  - `xmr-bridge install` pairs before creating the wallet. The restore height is the flag, else the site's suggestion, else the node's height, and is written to the config.
  - A kept wallet, or `xmr-bridge pair`, warns when its height is newer than the suggestion.
  - A wallet failure after pairing says the code is spent.
- Spec text to fold in, for both changes, is in `docs/spec-changes.md` (16 and 17).

Tests:
- Plugin: 128 pass (6 new), typecheck clean, bundle 27.9 KB validates.
- Bridge: gofmt, vet and `go test ./...` pass (new tests in syncclient, pairing, installer and `cmd/xmr-bridge`). `-race` runs in CI only (no cgo here).
- Live so far: with the dev site started and the bridge's last sync about 21 h old, checkout returned `WALLET_HOST_SILENT` (23:28 UTC). After the bridge's next sync, the stored height was 2225081, the node's height.

State:
- Dev site running in tmux `site`, with a fresh plugin build.
- Dev release `0.0.202610082327-dev.0d66a34` built and served (tmux `release`, 127.0.0.1:8099).
- Installed bridge: still `1a1ec84`, paired, syncing.
- Database backup: `baseline/data.db.before-3j`.

Next step, the live run (L4), with Wyatt:
1. Wyatt checks the buyer wallet's unlocked balance (`3j-balance-output.txt`).
2. New invoice `far5`, a pay script, the watcher.
3. Wyatt: `sudo xmr-bridge uninstall --delete-data`, pays `far5`, and it gets mined.
4. Claude issues a code (`dev-e2e.mjs --issue-code`).
5. Wyatt reinstalls **without** `--restore-height`.
6. Expect:
   - the installer prints the suggested height
   - the config holds it
   - the rescan finds `far5`, which settles
   - no false `reversed`
   - no `reorg`

Not done here: phase 03's file (line 56) still lists pairing after the wallet in the installer's steps. Fold it in with the spec text.

## 2026-10-08 · Phase 03 · Session 3j, part 2: the L4 run on stagenet (spec changes 16 and 17, live)

Evidence: `~/xmr-pay-dev-data/3h-watch.txt` (from "--- 3j run (far5)"), `3j-balance-output.txt`, `3j-uninstall-output.txt`, `3j-pay-output.txt`, `3j-install-output.txt`, `3j-checks-output.txt` (install-log lines, status, journal).

Run (Speed Standard, 2 confirmations; times UTC; the journal shows local time, UTC−6):

| Step | Result |
|---|---|
| Checkout with the bridge's last sync about 21 h old (site just started) | `WALLET_HOST_SILENT` (23:28:05) |
| The bridge's next sync | Stored height 2225081, the node's height |
| Buyer wallet | 0.1417 sXMR unlocked |
| `far5`, index 266, created 23:35:35 | `createdHeight` 2225085, `expiresHeight` 2225103 (real height, no estimate) |
| Uninstall, `--delete-data` (bridge `1a1ec84`) | Service, data, config and user removed |
| `far5` paid with no bridge installed | Tx `0c01590c…4919`, mined at 2225085 by 23:38:42 |
| Reinstall, dev release `0.0.202610082327-dev.0d66a34`, a fresh code, **no `--restore-height`** | The installer paired first, then printed "The site has open invoices from about block 2223649 on: the new wallet scans from there." That's `far3`'s `createdHeight` 2224369 − 720 (`far3` is watched until 01:37 UTC) |
| Catch-up | Wallet open 23:41:21 (height 579994), target 316, rescan; caught up at 23:41:32 (11 s) |
| `far5` | **`settled`** 23:41:45, 1849933403 atomic, 3 confirmations: **found by the rescan**. The old default ("today") would have been about 2225088, after the payment's block |
| Stored height after the fresh wallet's first sync | 2225088 = the node's; not lowered |
| New review invoices | **None** (only 3h's `far` reversed and three deliberate underpaid/late ones remain) |
| Pool | 316 rows, top 316: one top-up after the catch-up, no duplicate loop |
| `xmr-bridge status` | Paired, last sync 7 s, 50 of 50, watching 2 |

Not seen directly:
- The config's `restoreHeight` value: the grep pattern missed it (setup-friction row). The installer's message and the settlement show the suggestion was used, and `TestRestoreHeight` checks the written value.
- The "kept wallet" warning and `xmr-bridge pair`'s warning: unit tests only.

Noise, not new:
- The bridge logs `selfupdate: release.json.sig: HTTP 404` every minute while the unsigned dev release is served, and `connection refused` once it's stopped. Same as earlier sessions.

Docs:
- A setup-friction row: installer messages go to `/dev/tty`, so `tee` misses them; use the install log.
- Phase 03's installer steps now list pairing before the wallet.

State left:
- Bridge `0.0.202610082327-dev.0d66a34` installed and paired. It backs off while the site is stopped.
- Dev site, watcher and release server stopped; ports 4321, 4322 and 8099 free; no tmux sessions.
- Dev database: 3i's invoices plus `far5` (settled). Backup from before 3j: `baseline/data.db.before-3j`.

Session 3j: done. Spec changes 16 and 17 are implemented, unit-tested and passed on stagenet.

Open issues:
- **For Wyatt:**
  - approve a push of `b448231`..this entry and watch CI (the race-detector step covers the new bridge code; there's no cgo here)
  - spec changes 6, 7 and 9–17 to fold into the live spec (16 and 17 have spec text ready in `spec-changes.md`)
  - spec change 9's lookahead question
  - the mainnet second-node list
- **Later:**
  - a stored height that never goes down would keep a higher stagenet height if a site moved to mainnet. It's a non-issue unless switching networks is ever supported; note it for phase 09's docs.
  - `WALLET_HOST_SILENT` needs a buyer-facing message in the theme (phase 06).

Next step: Wyatt approves the push and CI. Then phase 04 (admin page), with 3h's notes: label `confirmations: 0` on review invoices, and an admin way to clear a false `reversed`.

## 2026-10-08 · Phase 03 · Session 3j: pushed, CI green

Pushed with Wyatt's approval: `60e22a8..f0a52da`. CI run 37861316946 passed both jobs (`bridge`, `plugin`). The race-detector step passed too: the first race run of the spec change 16 and 17 code. This entry is local.

Next step: phase 04 (admin page), with 3h's notes: label `confirmations: 0` on review invoices, and an admin way to clear a false `reversed`. Spec changes 6, 7 and 9–17 are still for Wyatt to fold into the live spec.

## 2026-10-08 · Phase 04 · Session 4a: health panel and widget (code done; live look next)

Before the phase:
- Spec change 18 (a tips-only tier with no wallet host) was added word for word from Wyatt's draft, with its "Still to decide" row (`de46b55`). It doesn't change phase 04.
- Wyatt approved the phase 04 plan (four sessions, 4a to 4d) and took the recommended answer on all four questions. They're recorded in `decisions.md`, Admin experience (`70cd78f`):
  - "Payment addresses ready" wording
  - the gap line with phase 03's remedy
  - the bridge reports `checks.wallet`
  - one recommended action per review reason

Done (local commits):
- `e96cefe` `bridge/sync` keeps the bridge's optional `checks` (node cross-check, wallet height) with the bridge state. Parsing is by hand: known states only, details cut to 300 characters, anything malformed dropped.
- `2297560` The highest paid index (`state:paidTop`, noted once per sync, never lowered) and whether checkouts carry the visitor's IP (`state:clientIp`).
- `7b9414d` The health panel:
  - one line per check, the "Payment addresses ready" meter with its hint, and the spam-limit information line
  - red and amber banners, worst first, each naming its fix
  - the gap red from `GAP_ALERT` = 150, and an unpaid-run line amber at `UNPAID_RUN_ALERT` = 10 (a constant I chose; the spec gives none)
  - the widget names the worst red problem plus the review count, and makes no price request
- `3e32e68` Bridge: `checks.wallet` is ok, behind (its node more than 5 blocks ahead) or unavailable. The node is asked at most once a minute. The node's error stays in the bridge's log, because it can hold the node's address.

Tests:
- Plugin: 149 pass (19 new, 17 of them in `admin-health.test.ts`), typecheck clean, bundle 33.7 KB validates. Mutation check: the gap threshold (`>=` to `>`) caught.
- Bridge: gofmt, vet and `go test ./...` pass, with and without `-tags devrelease` (new: `TestWalletCheck`, `TestChecksJSON`). `-race`: CI only.

Not covered:
- **Storage calls per page load:** about 14 storage and KV calls plus 0–2 price requests, counted from the code. The test host can't count them, and whether they count toward Cloudflare's 10-subrequest cap is unknown (spike 18, item 4). The dev site runs on Node.
- **Older sites:** a site from before `state:paidTop` gets it worked out once from its invoices on the first page load (tested).

Next step: the live look.
1. Build and serve a dev release with `3e32e68`.
2. Wyatt signs it, and the installed bridge updates itself.
3. Start the dev site with the new plugin build.
4. Wyatt opens `/payments` and the dashboard through the tunnel.

Then 4b (setup checklist, test address, pairing notes, the bridge key setting).

## 2026-10-08 · Phase 04 · Session 4a: live look (done)

- **Bridge update:** dev release `0.0.202610090032-dev.97f0e66`, signed by Wyatt (`4a-sign-output.txt`). The installed bridge updated itself from `0d66a34`. Its syncs now carry `checks.wallet`: `ok`, "the wallet is at block 2225127, its node at 2225126", with `checks.node` off (own node).
- **Wyatt's look through the tunnel:**
  - Wallet height line, the address meter and its hint, and the amber "4 invoices need a decision" banner (3h's `far` and the three deliberate underpaid or late invoices) were all shown.
  - No "wallet app may miss payments" line, correctly: the highest claimed and the highest paid index are both 266, so the gap is 0.
- **No spam-limit line, correctly:** no checkout since `state:clientIp` was added.
- **State left:**
  - The bridge `97f0e66` is installed.
  - Dev site and release server stopped.

Next step: session 4b (setup checklist with Get a test address, pairing notes, the bridge key read-only with the paste-by-hand fallback).

## 2026-10-09 · Phase 04 · Session 4b: setup checklist, test address, pairing notes (code done)

Pushed with Wyatt's approval: `b821886..281ef6d`. **CI run 37866556943 failed** in the plugin job: one test timed out, `checkout-route.test.ts` "site-wide cap" (5 s default; 0.7 s here; it passed in the previous run). The job log needs a signed-in account (HTTP 403), so only the annotation was read.
- Fix: `9b4dc8f`, a 30 s per-test timeout in `plugin/vitest.config.ts`. The bridge job passed, race detector included.
- Not pushed yet.

Done (local commits):
- `f69065c` Session 4b:
  - **Setup checklist** (an accordion): five items, each saying what to do next. It collapses for good once a test tip settles (`state:setupDone`).
  - **Get a test address:** an open `kind: "tip"` invoice through the admin route (`claimAndStore` and `newIds` now exported from checkout). It shows the subaddress, the 0.0001 floor and the `monero:` URI, then the payment's progress. Pressing again reuses an open one. It's refused while the wallet host is silent or no address is free.
  - **Connect wallet host:** minutes left as of page load. "Paired at HH:MM UTC" (", replacing the previous one, which no longer syncs") for a day (`state:lastPairing`, written by the sync route).
  - **Settings:** the bridge key, read-only.
  - **Page order:** banners, checklist, Connect, Health, Settings.
- `07caf81` **Spec change 19, proposed:** the "paste a key by hand" fallback has no bridge counterpart (the bridge makes its key only while pairing and never prints it). I recommend dropping it. Not built.

Tests:
- Plugin: 159 pass (10 new in `admin-setup.test.ts`, covering the checklist, the test address with reuse, refusals and an expired one, collapse, minutes left, an expired code, pairing notes and the key field).
- Typecheck clean; bundle 37.3 KB validates.

Not covered:
- A live test tip from Wyatt's buyer wallet (the checklist's last item).
- Block Kit has no live countdown or copy button, so the page shows minutes left as of load, and code blocks to select.

Next step:
1. Wyatt: approve pushing `07caf81` (CI fix included), decide spec change 19, and optionally do a live test tip.
2. Then 4c (invoice table and row actions).

## 2026-10-09 · Phase 04 · Session 4b: Wyatt's changes, CI, live test tip, key check (done)

Wyatt's decisions on the 4b report:
- **Spec change 19: (a), drop the paste-a-key fallback** (`e5f8eae`).
  - `xmr-bridge status` now prints `Bridge key: <base64>`, the admin page's form. An unreadable key file is unhealthy, with the re-pair fix.
  - The page's hint names the command.
  - `decisions.md` row; phase 04's Settings item updated.
  - **The spec's Bridge public key row isn't edited here:** `.claude/settings.json` denies edits to `docs/spec.md` (CLAUDE.md agrees). The exact new row is in spec change 19 for Wyatt to apply, in the live spec and the snapshot. No other spec line mentions pasting a key.
- **CI timeout:** back to vitest's 5 s default, with only the site-wide cap test at 30 s (`feceff2`, replacing `9b4dc8f`).
- **Pushed:** `281ef6d..feceff2`. CI run 37868656023 passed (plugin, bridge, race detector).

Live (dev site, stagenet; times UTC):

| Step | Result |
|---|---|
| Checklist before | "Setup: 4 of 5 done" |
| Get a test address (Wyatt, through the tunnel) | `inv_08a47de9…`, kind tip, index 267, min 100000000 atomic, 2 confirmations, `createdHeight` 2225154 |
| 0.0001 sXMR from the buyer wallet (`3h-pay-4btip.sh`) | Tx `04074b35…e049`, fee 0.0000304 |
| Seen | 01:21:38, confirming 0 of 2 |
| Mined | 01:22:51 at 2225155, 1 of 2 |
| Settled | 01:26:04, 2 confirmations |
| Reload | **"Setup complete"**, collapsed; `state:setupDone` true |
| Key check: the new build's `status` against the installed config (`4b-status-output.txt`) | `Bridge key: N2wSOfKJ…+B8=` equals the site's `bridgePublicKey` |

Finding for Wyatt (phase 09 or later), not acted on:
- **A self-update replaces only the service's binary** in `/var/lib/xmr-bridge/bin`. The root-owned admin copy (`/usr/local/bin/xmr-bridge`, which runs `status`, `pair` and `uninstall`) stays at the installed version, by design: the service account must not be able to write it.
- **So new status output reaches existing installs only when the installer runs again.** The key line was checked by running the dev release's binary directly. `CheckFormat` stops an outdated admin copy only when the state format changes.

State left:
- Bridge `97f0e66` installed (the `feceff2` release was built, never signed or installed).
- Dev site and release server stopped.
- Database backup before the tip: `baseline/data.db.before-4b-tip`.

Next step: session 4c (invoice table: paged products, row actions with stale-state checks, not-counted transfers, hundreds of invoices).

## 2026-10-09 · Phase 04 · Session 4c: invoice table and row actions (code done)

Pushed before the session: `feceff2..21ec032`.

Done (`aed1b84`, local):
- **Invoices table:** product invoices, newest first, 25 a page. "Load more" pages by storage cursor, and "Newest invoices" goes back. Columns:
  - status, with the review reason and "(by admin)"
  - fiat amount, XMR, received
  - confirmations: the deepest counted transfer plus what's needed, so a review invoice no longer reads "0" (3h's note)
  - created, expires
  
  Tips are left out until phase 07.
- **Row menu by state:**
  - Mark settled and Expire: final (`adminFinal`)
  - Raise confirmations to 10: open invoices only, never lower
  - Details and txids
- **Stale state:** each action re-reads the invoice and refuses, changing nothing, if its state no longer allows the action. The write is a `compareAndSet` on the revision read, so a sync landing in between isn't overwritten.
- **Details:** amounts, the payment address, buyer email, refund address and note as plain text. Each txid as copyable text, with why a transfer doesn't count (time-locked until a block or a time, or flagged as a possible double spend).

Tests:
- Plugin: 170 pass (11 new in `admin-invoices.test.ts`), typecheck clean, bundle 42.4 KB validates.
- Mutation check: "settle allowed in every state" caught by the menu and stale-state tests.
- The 300-invoice test takes 0.9 s here and has its own 30 s timeout. Everything else keeps vitest's 5 s.

Not covered:
- **The `compareAndSet` race itself** (a sync landing between the read and the write): the test host can't interleave the two. The stale-state checks are tested.
- **Sorting by column:** not offered. Columns aren't sortable.
- **After a row action, the table returns to its first page:** the menu's value doesn't carry the cursor.

Next step: session 4d (review queue with one recommended action per reason, the false-`reversed` path). Then Wyatt's click-through of the whole page on the dev site.

## 2026-10-09 · Phase 04 · Session 4d: review queue (code done; click-through led to UI changes)

Pushed before the session: `21ec032..3c69299`. CI run 37871358018 passed (plugin, bridge, race detector).

Done (`56da16f`, local):
- **Review queue,** between Health and Invoices. Each review invoice is an accordion with what happened, the recommendation, received, confirmations, buyer email and refund address, and one primary button: late → Mark settled; underpaid, reorg and reversed → Expire. Reversed also gets Mark settled behind a confirmation (3h's false reversed).
- **Wiring:** the buttons use the row-action path, so the stale-state checks and the `compareAndSet` write apply.
- **Order and limits:** oldest deadline first, at most 20, plus "N more wait". Tips in review are listed.

Tests:
- Plugin: 179 pass (9 new in `admin-review.test.ts`), typecheck clean, bundle 45.1 KB validates.

Click-through (dev site, 01:52 UTC):
- Wyatt reviewed screenshots in his planning chat and wrote UI changes to `~/xmr-pay-dev-data/04-ui/notes.md`, with four screenshots: page order, the checklist and Connect into Settings, no confirm dialog, review items as colored banners, banner wording, "Needs decision" status.
- Database backup before the click-through: `baseline/data.db.before-4d-clickthrough`.

Bug found while planning those changes (mine, 4d):
- "Late" is set whenever any payment arrived after the deadline, whether or not the total reached the price (`evaluate`, `hasLate`).
- The late item always says "Paid in full … The money is in your wallet", which is wrong for a late partial payment. Fix and recommended action: in the UI-changes plan.

## 2026-10-09 · Phase 04 · Click-through UI changes built; end of night: handoff

Wyatt's click-through decisions (from `~/xmr-pay-dev-data/04-ui/notes.md`, eight changes, plus answers Q1–Q4 and the paging choice) are recorded in `decisions.md`, Admin experience (`d5098dc`), and built.

**Plugin (`587b32a`):**
- **Page order:** before setup, banners, checklist, Connect wallet host, Health, invoices, Settings. After setup, banners, Health, invoices, Settings, with "Setup (complete)" and "Connect a new wallet host" as closed toggles at the end of Settings.
- **Connect wallet host:**
  - no confirmation dialog (EmDash 1.1.0's has no padding)
  - a line above the button when a host is paired
  - the Settings toggle opens by itself while a code shows (it gets a new `block_id`, `connect_code`, since the host keeps toggle state per `block_id`)
- **"Needs a decision (N)" above "All invoices":** one banner per review invoice, red for reversed and reorg, yellow for late and underpaid, each with a closed "Details and actions" toggle.
  - Red first: sorted in memory over up to 500 review invoices, because the reason has no index and adding one is a stop point.
  - **12 a page,** Wyatt's choice. EmDash counts every value as a node, and a full 25-row table is about 840 of the 2,000, so 60 at once can't fit (category (c)). Paged to item 60, then "N more are in All invoices below, marked Needs decision".
  - Worst case measured: 1,809 nodes.
- **Review banner:** "They're under Needs a decision, below Health, …". There's no separate "Invoices" heading, because three stacked headings looked wrong; Wyatt hasn't seen this yet.
- **Table status:** "Needs decision: <reason>".
- **Gone-payment wording:** reversed reads "No longer reported (needed N)" and "0 XMR now" (+ what was reported). Reorg reads "Not mined again (needed N)" and "X XMR, not in a block now".
- **"Open product" link** from `productRef`.
- **Fixed 4d's wording:** a late payment short of the price reads "Late payment · N% received" and recommends Expire (Q2).
- **The 4c limit test** now counts nodes as EmDash does.

**Bridge (`c76efda`):**
- Every message that sends the admin for a pairing code quotes both labels: "Connect wallet host" on the site's Monero payments page (after setup, it's "Connect a new wallet host" under Settings).
- The wording is one constant in a new package, `internal/sitetext`. Its test checks that the plugin's `admin.ts` still has both labels.

Tests:
- Plugin: 196 pass (new `admin-layout.test.ts`; `admin-review.test.ts` rewritten), typecheck clean, bundle 47.6 KB validates.
- Bridge: gofmt, vet and `go test ./...` pass, with and without `-tags devrelease`. `-race`: CI only.

Not covered:
- **Wyatt's live look at the reworked page:** the dev site was started at 03:07 UTC for it, then the session stopped for the night.
- **The `compareAndSet` race:** still untested, because the test host can't interleave a sync with the write.

Docs:
- A setup-friction row: CI job logs need sign-in; use the check-run annotations.
- Phase 04's page order.

State left:
- **Not pushed:** `56da16f..c76efda`, five commits (4d, its progress entry, the decisions, the UI changes, the bridge messages). CI last ran on `3c69299`, green.
- The bridge `97f0e66` is installed and paired, and backs off while the site is stopped.
- Dev site, release server and watcher stopped; ports 4321, 4322 and 8099 free; no tmux sessions.
- **Dev database:**
  - setup done (`state:setupDone`)
  - the 4b test tip settled
  - the four review invoices (#4 late, #6 and #7 underpaid, #261 reversed) untouched
  - backups: `baseline/data.db.before-4d-clickthrough` and `baseline/data.db.before-4d-ui`

Next steps, in order:
1. **Wyatt approves the push;** Claude checks CI (`scripts/ci-status.py`).
2. **Live look:** back up `data.db`, `cd plugin && pnpm run build`, start the dev site, wait for a sync. Wyatt clicks through the reworked page:
   - **Needs a decision (4):** red `far` first, then three yellow.
   - **The toggles:** Details and actions, Open product, and Settings' Setup and Connect toggles, with Connect showing the code after the button is pressed.
   - **Resolving the dev items (optional):** Mark settled on `far` through its confirm button; the recommended action on #4.
3. **Close phase 04** if the look passes: the progress entry, then phase 05 (setup test).

Carried over for Wyatt:
- **Spec text to fold into the live spec:** spec changes 6, 7 and 9–17, and 19's Bridge public key row. `docs/spec.md` can't be edited here (`.claude/settings.json`).
- **Spec change 18:** A in phase 06; B's spike after phase 04, decision before phase 07.
- **The mainnet second-node list** (before phase 09).
- **A self-update doesn't refresh the root-owned admin copy** (`/usr/local/bin/xmr-bridge`), so new `status` output reaches existing installs only when the installer runs again. Decide before phase 09.
- **EmDash's confirm dialog has no padding:** upstream, for Wyatt to report if he wants.

## 2026-10-09 · Phase 04 · Round 2 click-through changes (code done; live look next)

Pushed before the session: `3c69299..ac02c68`. CI run 37986414420 passed (plugin, bridge, race detector).

Wyatt's second click-through (`~/xmr-pay-dev-data/04-ui-2/notes.md`, five screenshots) asked for six changes. His decisions are recorded in `decisions.md`, Admin experience. The round 1 Connect-toggle row was updated, not contradicted.

**Plugin (`ce60feb`):**
- **All invoices as toggles** (change 1): one closed toggle per invoice, opening in place. The label is the summary on one line; inside are the details, the Actions menu and Open product.
  - **10 a page,** Wyatt's choice. Measured before building: a 25-row table was 744 nodes and the review queue's worst case 739. One invoice with its details is about 80 nodes, so 25 can't fit.
  - After an action, the invoice opens (block_id `invoice_<id>_acted`) and the page stays put (the menu value carries `|cursor`).
- **Long values** (change 2): the payment address and the refund address go in labeled code boxes, in invoices and review items.
  - Block Kit 1.1.0 has no wrapping style for these blocks: the code box is a bare `<pre>`, and the fields grid truncates.
  - The admin's `<main>` has `overflow-y: auto`, so the page scrolls sideways at narrow widths. Wyatt accepted that.
  - Wyatt asked for a copy button. Block Kit has no clipboard element, and the plugin can't add one (category (c)). Wyatt chose no hint, and may raise it upstream.
- **Settings after setup** (change 3): the button, its hint, the site line, then the code; Setup (complete) is last. Before setup nothing changes.
- **Payments** (change 4): all of an invoice's payments in one code box, each with "Transaction ID: …" under it, at most 50 listed.
- **Product ID field removed** (change 5).
- **Due and Received** (change 6): the labels; Expires reads "—" once an invoice is final.

Tests:
- **Plugin:** 205 pass.
  - `admin-invoices.test.ts` rewritten.
  - Settings tests in `admin-layout.test.ts`.
  - The worst case in `admin-review.test.ts`: 300 reversed items, 10 invoices with 16 payments and every buyer field, a pairing code showing. It comes to 1,730 nodes and 68.8 KB.
  - Typecheck clean, validate passes, bundle 48.8 KB validates.
- **Mutation checks:** "acted invoice not opened" and "expiry shown on final invoices" were both caught.
- **Bridge:** the `sitetext` label test still passes.

Not covered:
- **Narrow-width rendering:** checked in the CSS only, not on screen. That's for the live look.
- **The `compareAndSet` race:** still untested, as before.
- **Review advice for invoices on a later page:** it says "find it under All invoices below", which may need Load more.

Docs:
- **Phase 04 file:** item 5 now describes the list.
- **Spec text for Wyatt to fold in:** "invoice table" in the spec (the admin route row and line 591) is now a list of toggles. This adds to the carried-over spec text list.
- **Upstream note for Wyatt:** Block Kit has no copy-to-clipboard element and no wrapping for long values.

Database backups: `baseline/data.db.before-04-livelook` and `baseline/data.db.before-04-ui-2-look`, both with `VACUUM INTO` through Node's `node:sqlite` (there is no `sqlite3` on this box).
