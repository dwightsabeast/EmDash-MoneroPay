# Phase 01 spike findings

Answers, with evidence, to the questions in `docs/phases/01-spike.md`. Spike code is in `spikes/xmr-spike/` (throwaway; never imported by later phases). Raw outputs are in `spikes/xmr-spike/evidence/`.

**Versions:** EmDash 1.1.0, `@emdash-cms/plugin-cli` 0.13.2, `@emdash-cms/plugin-test` 0.2.7, `@emdash-cms/sandbox-workerd` 0.9.2, astro 7.3.5, workerd 2026-10-02, Node 24.21.0, Monero 0.18.5.1.

**Three places, where a question applies:**
- **Test host:** `@emdash-cms/plugin-test`'s runtime host, which runs the plugin through Worker Loader, EmDash's production sandbox wrapper, and the host bridge (`pnpm test` in `spikes/xmr-spike`).
- **`astro dev`:** the dev site under `astro dev` (Miniflare), on `localhost:4321`.
- **Built server:** the dev site built and run with `node ./dist/server/entry.mjs` (workerd), on `127.0.0.1:4322`.

## Summary

| # | Question | Verdict | Evidence | Effect on the spec |
| --- | --- | --- | --- | --- |
| 1 | Ed25519 in the isolate (gate) | **Pass** in all three places. `crypto.subtle` `"Ed25519"` imports and verifies; the `NODE-ED25519` fallback was never needed. One changed byte fails; non-ASCII, a trailing newline, CRLF and tab arrive byte for byte; header names arrive lowercased; undeclared headers are stripped (including `cookie`, `cf-access-jwt-assertion`, `x-forwarded-for`, `Basic` authorization). In `"text"` body mode the host strips a leading BOM (signed body then fails) and rejects invalid UTF-8 with 400 `INVALID_PLUGIN_REQUEST`; `"bytes"` mode is exact. On the dev site (not the test host) an invalid `Authorization: Bearer` gets 401 `INVALID_TOKEN` and a cross-origin `Origin` gets 403 `CSRF_REJECTED`, even on a public route; no `Origin` passes | `tests/q1-ed25519.test.ts` (15 passing; vectors signed in Node by `scripts/make-vectors.mjs` with the RFC 8032 TEST 1 key); `node scripts/send-vectors.mjs <base URL>` → `evidence/q1-astro-dev.txt`, `evidence/q1-built-workerd.txt` (all as expected) | Spec change 1 (accepted): `bridge/sync` takes `"bytes"`, verifies over exactly those bytes, then decodes as strict UTF-8 rejecting a BOM; the bridge never sends a BOM. Nothing in front of the site may add an `Origin` or a `Bearer` header to bridge requests (see Q2) |
| 2 | Non-browser POST through tunnel, hostname and Access (gate) | *Pending (needs Wyatt).* So far: a POST with no `Origin` reaches the public route directly under `astro dev` and the built server | Q1 evidence files | |
| 3 | Cron on Node (gate) | *In progress.* `plugin:install` never runs for a config-managed plugin (`sandboxed: [...]`), and neither does `plugin:activate` at startup: EmDash 1.1.0 runs install only for registry/marketplace installs, and activate when the plugin is switched on in the admin. In the test host, `plugin:activate` schedules, the scheduler fires once per minute, and the task survives a restart. The Node scheduler wakes at the next due time (between 1 s and 60 s); schedules are croner expressions (5- or 6-field, aliases, or a one-shot ISO date). 15-minute timing and the restart check: pending | `tests/q3-cron.test.ts`; EmDash source (`emdash-runtime.ts`, `astro/routes/api/admin/plugins/*/install`, `NodeCronScheduler` `MIN_INTERVAL_MS`/`MAX_INTERVAL_MS`); dev-site `cron-log` after startup: install, activate and tasks all empty | Spec change 2 (proposed): nothing depends on the cron |
| 4 | Settings storage | **`ctx.settings` exists for sandboxed plugins**, with `get`, `getVersioned`, `set`, `delete`, `list`, `compareAndSet`, `compareAndDelete`. `secret` fields in `admin.settingsSchema` are stored encrypted (envelope `$emdash`, `ciphertext`, `iv`, `kid`, `v`; no plaintext) and read back as plaintext through `ctx.settings.get()` and the older `ctx.kv.get("settings:…")`. Saving a secret needs `EMDASH_ENCRYPTION_KEY`; without it the whole update is rejected (`PLUGIN_SETTING_ENCRYPTION_KEY_MISSING`), the plain field included. Same API on `astro dev` and the built server. Whether a non-secret-only update needs the key: pending | `tests/q4-settings.test.ts` (2 passing; throwaway key generated at run time, never stored); `evidence/q4-astro-dev.txt`, `evidence/q4-built-workerd.txt` | xmr-pay stores no secrets either way |
| 5 | Client IP in `requestMeta` | *Pending (needs Wyatt for the tunnel and hostname)* | | |
| 6 | Pool claims with `updateIf` | **Correct in all three places**, but **concurrency was not really exercised**: 20 concurrent claims of one free row → exactly one applied; 20 claim-loop requests on 5 free rows → 5 distinct claims and 15 `NO_ADDRESS_AVAILABLE`; no errors; 10 rounds each on the dev site. The first request won every round, so the runner and SQLite appear to have handled the requests one after another. **PostgreSQL was not tested** (where `StorageSerializationError` applies) | `tests/q6-pool-claims.test.ts` (2 passing); `node scripts/claim-race.mjs <base URL> 10` → `evidence/q6-astro-dev.txt`, `evidence/q6-built-workerd.txt` | Spec change 3 (proposed): `subaddress` becomes a unique index on `invoices`. Keep the bounded retry loop |
| 7 | Time-lock field | *Pending (needs Wyatt's payments)* | | |
| 8 | Regtest (optional) | *Pending* | | |
| 9 | Bundle budget | **4,098 bytes** of `backend.js` for the spike's seven routes (Ed25519 in two body modes, settings probe, pool seed/claim/claim-loop/list), 3.1% of the 128 KB cap; the tarball is 7,330 bytes decompressed of 256 KB. `zod` / `zod/mini` not measured: under the dependency tiers (2026-10-03) the plugin carries no third-party runtime code | `pnpm exec emdash-plugin bundle` → `evidence/q9-bundle.txt` | None: the budget is not a constraint for hand-written code |

## Other observations

- **Test-host gaps.** The test host doesn't reproduce the site's `Bearer`-token 401 or cross-origin 403 on public routes, and doesn't run `plugin:install`. Tests that depend on host middleware need the dev site.
- **Test-host console.** Vitest's workerd pool drops `console.log` from passing tests; the spike records results in `task.meta` and reads them with `--reporter=json`. Teardown prints `deleteAllDurableObjects` errors from the cron lock recovery; they don't affect results.
- **`plugin-cli` 0.13.2 depends on TypeScript `^6.0.3`** and passes it to its `tsdown` 0.20.3, which declares `^5`: an unmet peer inside EmDash's CLI, harmless so far.
- **Dev-site `npm audit`:** 10 high-severity findings, all in packages that predate the spike (astro, undici, sharp, http-cache-semantics). Not in anything xmr-pay ships; the site's dependencies are Wyatt's call.

## Recommendations

*Written when the spike ends.*
