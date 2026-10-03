# Phase 02 — Plugin core

**Goal:** the sandboxed plugin's engine: storage, the three public routes, pairing, signed sync, the invoice state machine and the cron sweep, with the proof of concept's scenarios as passing tests, running in the dev site.
**Spec sections:** Plugin manifest, API contracts, Invoice lifecycle and payment logic, Admin setup and upkeep (pairing, fixed defaults), Security model.
**Reference:** `docs/poc/poc-simulation.js`, section "xmr-pay plugin" (logic) and sections "Scenarios" and "Attacks" (test cases). `docs/spike-findings.md` overrides the spec where they differ and Wyatt has accepted the change.
**Done when:** all tests below pass in the plugin test hosts; the plugin runs in the dev site; a signed sync sent by a script settles an invoice; the bundle is under its caps; CI runs the tests.

## For Wyatt, before the session

- [ ] Phase 01 is done and you've accepted its findings.
- [ ] Publisher: either keep a placeholder until release, or create your Atmosphere (Bluesky) account now and give Claude its DID. A DID is public; nothing secret is shared.
- [ ] Expect questions on dependencies (for example `zod` or `zod/mini`, `@emdash-cms/blocks`).

**Start the session:**

```text
Phase 02, plugin core. Read docs/phases/02-plugin-core.md, docs/progress.md and docs/spike-findings.md, then plan the first session (2a).
```

## For Claude

**Suggested sessions**

| Session | Scope |
| --- | --- |
| 2a | Scaffold `plugin/` non-interactively with `@emdash-cms/plugin-cli` `init` (see "Scaffolding" below); pin `@emdash-cms/plugin-cli`, `@emdash-cms/plugin-test` and `vitest` exactly; write the manifest from the spec; scaffold tests pass; create the dev site's `products` collection; link the plugin into the dev site |
| 2b | Pure core with no `ctx`: money math, presets, counted / on-time / classify / evaluate, watch-list rules. Unit tests ported from the POC |
| 2c | Sync protocol: header and signature checks, freshness, protocol version, `seq`, pairing, pool top-up, watch list response. Shared test vectors |
| 2d | Routes and storage: `checkout` (product), `status`, `bridge/sync`, `plugin:install`, `plugin:uninstall`, cron sweep, rate fetch, pool claims, per-IP limits |
| 2e | Minimal `admin` route: settings (currency, speed) and **Connect wallet host** (pairing code and install command). The full admin page is phase 04 |
| 2f | Dev-site run, scripted end-to-end with a fake bridge, bundle check, CI workflow |

**Scaffolding (2a)**

- `init` is interactive by default. Run it non-interactively (`init xmr-pay --yes --publisher <DID or placeholder> --author-name … --security-email …`; check `init --help`). The name sets the slug, which must be `xmr-pay`; if it also sets the folder name, scaffold into a temporary directory and move the result to `plugin/`.
- The scaffold adds `plugin/AGENTS.md` and `.claude` links to it, plus the `creating-plugins` skill. Use them for EmDash API details; `CLAUDE.md` at the repo root wins on conflicts.
- In the dev site, create the `products` collection with a numeric `price` field (`npx emdash schema create products --label Products`, then `npx emdash schema add-field products price --type number`, run in `~/sites/xmr-dev-site` while the dev server runs; check `--help` first), and add two or three test products.
- Link the plugin into the dev site: `npm install file:../../xmr-pay/plugin` in `~/sites/xmr-dev-site`, then add it to `sandboxed: [...]`. Keep `pnpm dev` running in `plugin/` so `dist/` rebuilds.

**Design rules for the code**

- Keep the engine pure. `src/core/` holds functions that take state and return new state and events, with no `ctx`, no clock reads and no I/O. Routes and hooks in `src/plugin.ts` (and small modules beside it) load records, call the core, and save. This is what makes the scenarios testable and the bundle small.
- `kind: "product"` only in this phase, but keep the invoice model ready for `tip` (`minAtomic`) and `order` (`orderRef`, `amountMinor`, `currency`, `returnUrl`) as the spec's storage record lists.
- Products: the `products` collection with a numeric `price` in the site currency, read server-side through `ctx.content`. The client sends only the entry id or slug.
- Rates: first price API that answers, then the second; cached about 60 seconds in KV; locked into the invoice. Parse prices as decimal strings into integer minor units, with no float math (the POC uses `Number()` here; don't copy that). If both fail, `RATE_UNAVAILABLE`. Check each API's current terms and whether it now needs an API key; a required key would be a new setting, so stop and ask.
- Pool claims: atomic per spike question 6. Retry on serialization failures with a bounded loop.
- Spam limits: cap on open invoices per hashed client bucket, short retention, using `requestMeta` as the spike found it. Hash with a per-site salt kept in KV; never store raw IPs.
- Pairing: code is 128-bit random, stored only as a hash with a 15-minute expiry, single use. The install command shown to the admin uses a constant install URL (a placeholder until phase 09) plus `--site <site URL> --pair <code>`.
- Domain errors return `{ error: { code } }` with the codes in the spec. Unexpected errors throw and must not leak secrets or stack traces.
- Cloudflare limits apply in production even though dev is Node: keep each request's work small, cap snapshots per sync, and avoid unbounded loops.

**Shared test vectors.** Write `contract/test-vectors/sync-signature.json` using the published RFC 8032 (section 7.1) Ed25519 test keys, never a key of your own: timestamps, raw bodies (including non-ASCII and a trailing newline), the exact signed message, the expected signatures and the verdicts. The plugin tests use it now; the Go bridge tests use the same file in phase 03, so the two sides can't drift.

**Tests (minimum)**

- Money: `expectedAtomic` rounding up, large values, zero and negative rejected, tolerance at exactly 99.5%, overpayment recorded.
- Presets: each tier boundary for Fast, Standard, Strict; `required` locked at checkout; admin raise allowed, lower refused.
- Every POC scenario: pay in full, two parts, underpaid at expiry, late, reorg after settling (stays settled, re-confirms), not re-mined within 5 blocks (review/reorg), reversed (review/reversed), bridge outage across expiry (pendingExpiry, then settles on time), settings change mid-invoice, tip-shaped invoice settles at the dust floor (core only).
- Every POC attack: time-locked funds not counted, double-spend flag not counted, fresh replay ignored by `seq`, stale timestamp rejected, forged and tampered bodies rejected, client-sent price ignored, checkout spam stopped.
- From the spec (the POC has no pairing or size limit): `pair` with no active code rejected, wrong, expired or reused pairing code rejected, a pairing body over 4 KiB rejected, a new pairing replacing the old key, oversized sync bodies rejected, protocol version current and previous accepted, older refused.
- Expire on evidence: no expiry from the cron alone without a post-deadline sync; on-time evidence order (seenAt, then poolTs, then height ≤ expiresHeight).
- Watch list contents for each state, including settled invoices until 10 deep.
- Route-level tests with `createPluginTestHost()`, and runtime tests with `createPluginRuntimeTestHost()`: signed raw bodies through `routes.request`, price feeds through `http.respond`, the cron through `scheduled`, and `restart()` to prove state survives.

**CI:** `.github/workflows/ci.yml` running the plugin's typecheck, validate, tests and bundle check on pull requests and pushes. Pin third-party actions to commit SHAs. Ask before adding it.

**Stop points:** any change to the manifest's trust contract; any dependency; the price-API terms; anything that contradicts the spec or the spike findings.

**Out of scope:** the Go bridge, the full admin page, theme components, tips and orders beyond the data model.
