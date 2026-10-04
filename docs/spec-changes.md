# Proposed spec changes

The spec (`docs/spec.md`) is a snapshot of a live doc that Wyatt owns. Claude never edits it. When the code needs the design to change, or EmDash or Monero behaves differently from what the spec assumes, add an entry here and stop for Wyatt's decision. Once Wyatt decides, he updates the live doc and the snapshot, and the entry's status changes.

Entry format:

```text
## N. Short title  (status: proposed | accepted | rejected | superseded)
Found in: phase, file or test
Spec says: quote or section name
Evidence: what was observed (command, test, output, doc link)
Proposal: the smallest change that fixes it
Effect on the admin budget: none, or what changes
Effect on the trust contract: none, or what changes (any broadening is a major version)
```

## Entries

## 1. Declare `bridge/sync`'s body as `"bytes"`, not `"text"`  (status: accepted, 2026-10-03)
Found in: phase 01, spike Q1 (`spikes/xmr-spike/tests/q1-ed25519.test.ts`, `spikes/xmr-spike/evidence/q1-*.txt`)
Spec says: API contracts, `POST bridge/sync`: "Declared with `request: { body: "text", headers: ["x-xmr-ts", "x-xmr-sig"], maxBytes }`, so the handler sees the exact raw bytes." Plugin manifest, routes table: "raw text (`maxBytes` capped)".
Evidence: In all three places (plugin test host, `astro dev`, built server on workerd), a `"text"` body reaches the handler as a decoded string, not the raw bytes. EmDash 1.1.0 strips a leading UTF-8 BOM (77 bytes in, 74 re-encoded, so a correctly signed body fails verification) and rejects invalid UTF-8 with `400 INVALID_PLUGIN_REQUEST` before the plugin runs. The same six vectors declared as `"bytes"` arrive as a `Uint8Array` identical to what was signed, and every verdict matches Node's `crypto.verify`. Ed25519 itself works everywhere under the standard `"Ed25519"` name.
Proposal: declare `bridge/sync` with `request: { body: "bytes", headers: ["x-xmr-ts", "x-xmr-sig"], maxBytes }`; verify the signature over `ts + "\n" + bytes`, then decode with `new TextDecoder("utf-8", { fatal: true })` and parse JSON. The spec's sentence "the handler sees the exact raw bytes" becomes true as written. With `"text"`, both failure modes are fail-closed (no security hole), and the Go bridge's `encoding/json` never emits a BOM or invalid UTF-8, so `"text"` would also work in practice; `"bytes"` removes the dependency on that.
Effect on the admin budget: none.
Effect on the trust contract: the route's name, method and public access are unchanged; only its declared body mode changes, before the first release, so no installed user has consented to the old one. CLAUDE.md's "raw text body" wording would change to "raw bytes body".
Wyatt's decision (2026-10-03), the terms for the bridge:
1. `bridge/sync` takes `"bytes"`.
2. The signature is checked over exactly those bytes.
3. Only after the signature passes does the plugin decode them, as strict UTF-8, rejecting a leading byte-order mark.
4. The bridge never sends a byte-order mark. (First written as "sends"; Wyatt confirmed "never" the same day.)
Wyatt updates the live spec and `docs/spec.md`; CLAUDE.md's trust-contract line "raw text body" becomes "raw bytes body" with that update.
Done 2026-10-03: live spec revision 69 and `docs/spec.md` updated.

## 2. Nothing depends on the cron; it stays as a backup  (status: accepted, 2026-10-03)
Found in: phase 01, spike Q3 (`spikes/xmr-spike/tests/q3-cron.test.ts`, `evidence/q3-*.txt`; EmDash 1.1.0 source `emdash-runtime.ts` `runPluginInstallLifecycle`, `setPluginStatus`; `astro/routes/api/admin/plugins/{registry,marketplace}/install`)
Spec says: Plugin manifest, Hooks: "`plugin:install` seeds defaults and schedules the cron; `cron` runs the sweep". Invoice lifecycle, Cron sweep: expiry, reorg review, ending watches, the 30-day purge, and the silent-bridge flag.
Evidence: EmDash 1.1.0 runs `plugin:install` (then `plugin:activate`) only when a plugin is installed from the registry or marketplace through the admin API. A config-managed plugin (`sandboxed: [...]`) gets neither hook at startup or restart: on the dev site under `astro dev` the spike's install and activate records stayed empty and no task was scheduled. `plugin:activate` also runs when the plugin is switched on in the admin (`setPluginStatus`). In the test host, `actions.plugin.activate()` scheduled the task, the scheduler fired it once per (simulated) minute, and the task survived `host.restart()`. Node timing: see the Q3 row of `docs/spike-findings.md` (scheduler wakes at the next due time, at least 1 s and at most 60 s apart; schedules are croner expressions, 5- or 6-field).
Proposal (Wyatt's):
- Expiry happens inside `bridge/sync`: a post-deadline sync is required for expiry anyway ("expire on evidence"), so the sync that covers an invoice after `expiresAt` expires it (or sends it to review).
- Ending finished watches (24-hour window, settled 10 confirmations deep) and the 30-day buyer-data purge also run in `bridge/sync`, in small bounded batches per request, so no sync exceeds the per-request limits.
- The silent-bridge flag is computed when the admin page (or the dashboard widget) loads, from the last sync time.
- Claude's addition, for Wyatt to confirm: the reorg rule (a settled invoice whose payment left the chain and was not re-mined within 5 blocks goes to review) also depends only on sync evidence, so it moves into `bridge/sync` too.
- The cron stays as a backup that runs the same bounded batch functions, scheduled idempotently (`ctx.cron.schedule` upserts by name) from `plugin:install`, `plugin:activate`, or the first admin page load, whichever comes first.
Effect on the admin budget: none (no setting, no step).
Effect on the trust contract: none (no capability, route, storage or admin declaration changes).
Wyatt's decision (2026-10-03): accepted as written, including Claude's reorg addition. The spec also says why the backup cron is always scheduled (pairing happens on the admin page, so every working install loads it) and why it stays (the 30-day purge goes by the calendar, so the cron keeps it running if the wallet host is retired). Live spec revision 69 and `docs/spec.md` updated.

## 3. Make `subaddress` a unique index on `invoices`  (status: accepted, 2026-10-03)
Found in: phase 01, spike Q6 (`spikes/xmr-spike/tests/q6-pool-claims.test.ts`, `scripts/claim-race.mjs`, `evidence/q6-*.txt`)
Spec says: Plugin manifest, storage: `"invoices": { "indexes": ["status", "expiresAt", "subaddress", ["kind", "createdAt"]], "uniqueIndexes": ["token"] }`; Key design decisions: one subaddress per invoice, never reused.
Evidence: `updateIf` claims were correct in all three places (exactly one of 20 claims of one row applied; 20 claim-loop requests on 5 rows made 5 distinct claims), with no errors. But concurrency was not really exercised: the first request won every round, which suggests the runner and SQLite handled the requests one after another. PostgreSQL (where the documented `StorageSerializationError` applies) was not tested.
Proposal: move `subaddress` from `indexes` to `uniqueIndexes` on `invoices`, so the database itself refuses a second invoice with an address already used, whatever happens in the claim path. Checkout treats a unique-index violation as a lost claim and retries within its bounded loop (or returns `NO_ADDRESS_AVAILABLE`).
Effect on the admin budget: none.
Effect on the trust contract: a storage index declaration changes, before the first release, so no installed user has consented to the old one.
Wyatt's decision (2026-10-03): accepted as written. Phase 02 adds a test that a second invoice with an address already used is refused and checkout retries with the next address. Live spec revision 69 and `docs/spec.md` updated (manifest `uniqueIndexes`, and "Address claims and limits" under `POST checkout`).

## 4. Spam limits must work without a client IP  (status: accepted, 2026-10-03)
Found in: phase 01, spike Q5 (`spikes/xmr-spike` `echo` route; `evidence/q5-box-trusted-header.txt`, `evidence/q2-q5-pc-round{1,2}.txt`; EmDash source `plugins/request-meta.ts`)
Spec says: Open question 6, "whether `requestMeta` gives the real client IP on public routes … which decides whether per-IP buckets help"; phase 02: "cap on open invoices per hashed client bucket … using `requestMeta` as the spike found it".
Evidence: On a Node site (`astro dev` or built), `requestMeta.ip` is `null` by default, both directly and behind a Cloudflare Tunnel. It becomes the real IP only if the operator sets `EMDASH_TRUSTED_PROXY_HEADERS` (or `trustedProxyHeaders`), and then anyone who can reach the origin without going through the proxy can choose their own IP. On Cloudflare Workers deployments EmDash uses the `cf` object and the IP is real and trustworthy.
Proposal: per-IP buckets apply only when `requestMeta.ip` is non-null. When it is `null`, checkout falls back to a site-wide cap on open (unpaid, unexpired) invoices, sized well below the pool target so the address pool can't be drained by one client, plus the existing short invoice window. No new setting and no request to set an environment variable; the admin page's health panel may say "per-visitor limits off: the site doesn't pass client IPs" as information, not a red line.
Effect on the admin budget: none (deliberately: asking admins to configure trusted proxy headers would add a setup step and, done wrong, a spoofing hole).
Effect on the trust contract: none.
Wyatt's decision (2026-10-03): accepted, with two refinements:
1. An invoice counts as open for the site-wide cap until its `expiresAt`, by the plugin's clock. This only decides whether a new checkout is allowed, never an invoice's status, so "expire on evidence" still holds. Without it, a bridge outage would keep unpaid invoices open (with entry 2, formal expiry waits for a sync), fill the cap and lock checkout until the bridge came back.
2. The spec states the tradeoff plainly: without client IPs, one spammer can fill the cap and block checkout until those invoices' windows close, but can't take money or mark the wrong invoice paid. The remedy is a rate-limit rule for the checkout route at Cloudflare or the proxy, explained in phase 09's install docs, never a plugin setting.
Live spec revision 69 and `docs/spec.md` updated (Security model threat table, Privacy, the Health bullet and the "Bridge down" failure row).

## 5. A payment mined in time counts as on time, however it was first reported  (status: accepted, 2026-10-03)
Found in: phase 01 review, checking spike Q7's `timestamp` finding against the spec (raised by Claude in Wyatt's planning chat)
Spec says: Invoice lifecycle, Rules, "On time or late": "the plugin saw the transfer before `expiresAt`; or the wallet's timestamp from when it was first reported unmined is before `expiresAt`; or, if it was first reported already mined, its block height is at most `expiresHeight`".
Evidence: Q7 confirmed that `timestamp` is when the wallet first saw an unmined transfer. If the wallet host is offline when a buyer pays on time and comes back after `expiresAt` while the transfer is still unmined, its first-seen timestamp is after the deadline, and the height test didn't apply because the transfer wasn't first reported mined. The payment went to review as late even when it was mined by `expiresHeight`.
Proposal: any one of the three pieces of evidence is enough, and the height test applies whenever the transfer is mined, however it was first reported.
Effect on the admin budget: none (fewer false review items).
Effect on the trust contract: none.
Wyatt's decision (2026-10-03): accepted. Live spec revision 69 and `docs/spec.md` updated.

## 6. The admin page path can't be `"/"`  (status: accepted, 2026-10-03)
Found in: phase 02, session 2a (`pnpm test` in `plugin/`, which runs `emdash-plugin validate` first)
Spec says: Plugin manifest: `"admin": { "pages": [{ "path": "/", "label": "Monero payments" }], ... }`.
Evidence: `@emdash-cms/plugin-cli` 0.13.2 (manifest schema from `@emdash-cms/plugin-types` 0.5.0) rejects it: `admin.pages[0].path: admin page path must be at least 2 characters (leading slash + name)` and `admin page path must start with "/" and contain only letters, digits, "-", "_", "/"`.
Proposal: `"path": "/payments"` (label unchanged, "Monero payments"). It is the plugin's only admin page, so the path shows only in the admin URL, where `/payments` reads naturally.
Effect on the admin budget: none.
Effect on the trust contract: the admin page declaration changes before the first release, so no installed user has consented to the old one.
Wyatt's decision (2026-10-03): accepted, `"/payments"`. Wyatt updates the live spec and `docs/spec.md`; `plugin/emdash-plugin.jsonc` already uses it.

## 7. Lifecycle clarifications from phase 02 session 2b  (status: accepted, 2026-10-03)
Found in: phase 02 session 2b, porting the proof of concept's rules into `plugin/src/core/` (`invoice.ts`, `presets.ts`, `watch.ts`; tests in `plugin/tests/core/`)
Spec says: Invoice lifecycle, Rules and Confirmation presets; `bridge/sync`, Watch list. The spec is silent or the proof of concept differs on the points below.
Evidence: `plugin/tests/core/scenarios.test.ts` (each point has a test); a mutation check removing item 6 fails both of its tests.
Proposal (the spec should state these):
1. Fiat currencies with two decimals only for now (USD, EUR, GBP and similar); the preset tiers compare integer minor units (under 10,000 / 10,000 to 100,000 inclusive / over 100,000 for two decimals). Other currencies later, with the decimal count as a parameter.
2. Boundaries are inclusive: seen or first reported unmined exactly at `expiresAt` is on time, as is a block height exactly `expiresHeight`.
3. An expired invoice whose on-time payment turns up later but is below the threshold goes to `review` with reason `underpaid`, like an underpayment seen at the deadline (the proof of concept left it `expired`, silently).
4. A tip below the dust floor at expiry just expires (as in the proof of concept); phase 07 decides tips under dust.
5. A settled invoice stays watched until its payment is 10 deep or re-confirming, but never longer than 24 hours after settling.
6. An unmined transfer that isn't proven on time is undecided while the chain is below `expiresHeight`, because it can still be mined in time. While any transfer is undecided, the invoice waits with `pendingExpiry` instead of expiring or going to review as late; once the chain reaches `expiresHeight` with the transfer still unmined, it is late. Without this, spec change 5 fails in the case it was written for: the wallet host comes back after the deadline and first reports the payment unmined, the plugin calls it late and sends the invoice to review (admin-only), and the later on-time mining can no longer settle it. The extra wait is at most 3 blocks (the grace) past the window.
Effect on the admin budget: none (fewer false review items).
Effect on the trust contract: none.
Wyatt's decision (2026-10-03): items 1-5 accepted as answered in session 2b; item 6 accepted. Wyatt folds the entry into the live spec and `docs/spec.md`.

## 8. Price sources: Kraken first, CoinGecko as the fallback; USD and EUR only  (status: accepted, 2026-10-03)
Found in: phase 02 session 2d, checking the price APIs' current terms before writing the rate fetch (a phase 02 stop point)
Spec says: API contracts and Amount math: "The rate comes from the first price API that answers, falls back to the second"; Plugin manifest: `"allowedHosts": ["api.coingecko.com", "api.kraken.com"]` with CoinGecko first; "The price-API hosts are a first choice; their current terms and rate limits still need checking."
Evidence (2026-10-03): both answer without a key (`curl` from the dev box: CoinGecko `simple/price` for USD, EUR, GBP; Kraken `Ticker` for XMRUSD and XMREUR; Kraken has no XMR/GBP pair, `EQuery:Unknown asset pair`). CoinGecko's docs say the keyless API is "not suitable for production workloads, scheduled polling, or high-frequency updates", limited to about 10–30 calls a minute per IP and varying with load (https://docs.coingecko.com/docs/keyless-public-api); its free Demo key needs an account, an API key and a visible "Powered by CoinGecko" attribution (https://www.coingecko.com/en/api/pricing, https://www.coingecko.com/en/api_terms). Kraken's public market-data endpoints need no account and allow about one call a second per IP (https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-). The plugin calls at most once a minute per currency (60-second cache).
Proposal: Kraken's public `Ticker` first, CoinGecko's keyless `simple/price` as the fallback, both parsed as decimal strings into integer minor units. Supported currencies USD and EUR, which both sources quote. GBP is left out for now (only one source). No API key and no new setting; `RATE_UNAVAILABLE` when both fail, never a stale price.
Effect on the admin budget: none.
Effect on the trust contract: none (the same two hosts; only the order changes).
Wyatt's decision (2026-10-03): accepted: Kraken first; GBP left out for now. Wyatt updates the live spec and `docs/spec.md`.


## 9. The shop's wallet app may miss payments after a long run of unpaid addresses (subaddress lookahead)  (status: accepted, 2026-10-04)
Found in: Wyatt, 2026-10-04, reviewing phase 02 before phase 03
Spec says: Key design decisions: "Pre-created address pool, one subaddress per invoice, never reused". Bridge service, Pool top-up: "create the missing subaddresses (`create_address`, account 0 …)". The spec says nothing about how other wallets holding the same keys find those addresses.
Evidence (not yet tested; phase 03 tests it):
- A Monero wallet doesn't scan every possible subaddress. It keeps a lookahead window past the highest index that has received money, 200 per account by default in `wallet2`, and grows the window as payments arrive (to be confirmed on stagenet).
- The bridge's own `monero-wallet-rpc` knows every address it created with `create_address`, so the bridge and the plugin still see the payment.
- The shop's wallet app (GUI, Feather, Cake, the CLI, restored from the seed) knows only its default window. Every checkout claims a new index, and abandoned checkouts are never paid. After 200 or more claimed-but-unpaid indexes in a row, a payment to a later index can be settled in the plugin but missing from the app's balance until the app's lookahead is raised.
- The same applies to a reinstalled bridge: a fresh `generate_from_keys` wallet starts with the default window, so it must recreate addresses up to the highest pool index before it reconciles.
- Checked 2026-10-04: `/opt/monero/monero-wallet-rpc --help` (0.18.5.1) lists no lookahead option.
Proposal:
1. Phase 03 tests it on stagenet. With more than 200 unpaid indexes past the last paid one, pay the far address, then check:
   - the bridge reports the payment
   - a second view-only wallet restored from the same keys with default settings (standing in for the shop's app) doesn't see it
   - what makes it appear (raising the lookahead, creating addresses up to the index)
   - that a reinstalled bridge (fresh wallet from keys) sees payments to high indexes after it reconciles
2. The plugin computes the gap from data it already stores: the highest claimed pool index minus the highest index with a counted payment.
3. The admin page (phase 04) warns before the gap gets close: a red health line from a constant threshold (proposed: 150 of 200; a constant, no setting), naming the fix in the wallet app. It belongs with the spec's existing Health check "a run of unpaid expired invoices".
4. Address reuse is not proposed (`docs/decisions.md`: never reused).
Effect on the admin budget: no new setting or install step. The fix for the warning (raising the app's lookahead, once, when it shows) is an occasional manual task and touches "no routine upkeep"; Wyatt decides whether that is acceptable or the feature must change.
Effect on the trust contract: none (no capability, host, route, storage or admin declaration changes).
Wyatt's decision (2026-10-04): accepted (phase 03's stagenet test, the phase 04 warning from a constant threshold, phase 05's wallet-app check). Still open: how an admin raises the wallet app's lookahead, and whether that manual step is acceptable at all. This doesn't block phase 03. Its stagenet test supplies the evidence (what works, in which wallet apps), and Wyatt decides before the phase 04 warning text is written. Tracked under "Still to decide" in `docs/decisions.md`. Wyatt updates the live spec and `docs/spec.md`.

## 10. The comparison checks compare a defined verdict, and our verifier may be stricter by named policy  (status: accepted, 2026-10-04)
Found in: phase 03 session 3b-1, `bridge/oracle/oracle_test.go` against `gpgv` 2.4.7 (`~/xmr-pay-dev-data/3b1-oracle-gpgv.txt`)
Spec says: Bridge service, "Tests the decision depends on": "Differential oracles in CI only: the real `hashes.txt` and the corpus run through `gpgv` and ProtonMail `go-crypto` as well, and all three verdicts must match."
Evidence: 26 inputs (the real `hashes.txt`, 9 signed test files, 16 altered copies of the real file) × 3 keys = 78 comparisons.
- **What "verdict" means.** It is defined as "exactly one valid signature by the pinned primary key over this text, unexpired". `gpgv`'s status lines are mapped to that question: exit 0, exactly one `VALIDSIG` whose signing key and primary key are both the pinned key, and no `BADSIG`, `ERRSIG`, `EXPSIG` or `NO_PUBKEY`. Without this mapping, `gpgv` "accepts" a file signed by a subkey and a file carrying two signatures, which revision 70 tells us to refuse.
- **Results.** 73 match. Our verifier never accepted anything `gpgv` refused, and every text both accepted was identical after canonicalization.
- **The five differences** are all refusals by our verifier of things `gpgv` accepts:
  1. text before the signed block
  2. text after the signature
  3. a SHA-384 signature
  4. a missing armor checksum
  5. a `Version:` header in the signature armor

  Items 1 to 3 are revision 70 policy ("text outside the signed block", "SHA-256 or SHA-512 only"). Items 4 and 5 are Claude's strict reading: revision 70 says "a bad armor checksum" and doesn't mention armor headers. RFC 9580 makes the checksum optional, and `gpgv` ignores signature-block headers.
- `go-crypto` isn't run yet (see the dependency question in the 3b-1 progress entry).
Proposal:
1. **Replace "all three verdicts must match" with:**
   - every oracle's output is mapped to that one verdict
   - the check fails if our verifier accepts anything an oracle refuses, or if accepted texts differ
   - our verifier may refuse what an oracle accepts only where a named policy says so, listed in the test with its reason
2. **Keep items 4 and 5 strict:** require the checksum, and allow no armor headers in the signature block. Monero's current file has a checksum and no headers.
   - If Monero's format changes, the bridge refuses the new `hashes.txt`, keeps its current wallet-rpc, and turns a health check red. That is the same path as a key change, fixed by a bridge update.
   - The alternative is to follow RFC 9580 (checksum optional, headers ignored). That is more tolerant of format changes, but it accepts more variants of the input.
Effect on the admin budget: none, unless Monero changes the file's format (then one bridge update, as with a key change).
Effect on the trust contract: none.
Wyatt's decision (2026-10-04): accepted, strict. The verdict definition and the failure rule as proposed; a missing armor checksum and signature-block armor headers stay refused. Wyatt updates the live spec and `docs/spec.md`.

## 11. wallet-rpc does not check the view key against the address; the bridge must  (status: accepted, 2026-10-04)
Found in: phase 03 session 3c, live test `TestLiveShopWallet` (`bridge/cmd/xmr-bridge/live_test.go`, output `~/xmr-pay-dev-data/3c-live-shop-wallet.txt`)
Spec says: Bridge service, duty 1: "Create the view-only wallet with `generate_from_keys` (primary address and private view key, no spend key …)". Phase 03 rules: "The bridge never handles a spend key, and refuses input that looks like one or like a seed." The 3c plan (approved, item 3) relied on wallet-rpc refusing a view key that doesn't belong to the address.
Evidence:
- The real `monero-wallet-rpc` 0.18.5.1 (stagenet) was given the shop's real address and a well-formed view key that isn't the shop's. `generate_from_keys` **returned success** and created the wallet.
- Source of v0.18.5.1 confirms it:
  - `src/wallet/wallet_rpc_server.cpp`, `on_generate_from_keys`, only checks that the view key parses as hex ("Failed to parse view key secret key").
  - With no spend key it calls `wallet2::generate(…, info.address, viewkey, …)`, and that function (`src/wallet/wallet2.cpp`, the overload at line 5851) calls `m_account.create_from_viewkey(address, viewkey)` with no comparison.
  - The CLI wallet's "view key does not match" check is in `simplewallet`, not in this path.
- Consequences without a check of our own:
  1. A mistyped or wrong view key makes a wallet that silently never sees a payment. Setup would stall at the test tip with no clear reason.
  2. A **spend key** pasted at the view-key prompt is accepted and stored in the wallet file on the wallet host, against the rule above.
Proposal:
1. **Before anything reaches wallet-rpc,** the bridge computes the public key of the entered value (scalar × the Ed25519 base point) and compares it with the address's public view key (bytes 33–64 of the decoded address).
   - **Equal:** go on.
   - **Equal to the address's public *spend* key:** refuse with "that is the shop wallet's SPEND key: never enter it here; paste the private VIEW key", and drop the value.
   - **Neither:** refuse with "that private view key doesn't belong to this address".
2. **Implementation:** Go's standard library has Ed25519 signatures but no raw scalar multiplication on the base point, so this needs a small base-point multiplication of our own, about 150 lines on `math/big`, in the shipped bridge (Tier 1, standard library only, like the hash-list verifier). It runs once at install, on a value the admin just typed.
3. **Tests**, before it is trusted:
   - Against Go's own `crypto/ed25519`, as an oracle in the test only: for random seeds, our multiplication of the clamped `SHA-512(seed)` scalar must equal `ed25519.NewKeyFromSeed(seed).Public()`, plus the RFC 8032 section 7.1 keys.
   - A property test: `k·G == (k mod l)·G`.
   - Fuzzing.
   - Live: the real stagenet view key matches the real address, and a wrong key is refused.
4. **Also** `wallet.Open` keeps checking `get_address`. That only proves the address, not the key, so the install-time check is the one that matters.
Effect on the admin budget: none. A wrong or spend key is caught at the prompt with a message, instead of a setup that never sees the test tip.
Effect on the trust contract: none (plugin unchanged). The bridge gains about 150 lines of curve arithmetic that we own.
Wyatt's decision (2026-10-04): accepted, the bridge's own check as proposed. This replaces item 3 of the approved 3c plan (relying on wallet-rpc's check). Wyatt updates the live spec and `docs/spec.md`.
