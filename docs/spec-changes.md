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
Evidence from phase 03 session 3h (stagenet, 2026-10-06; files `~/xmr-pay-dev-data/3h-*`):
- **Gap:** the bridge's own pool top-up was driven past index 310 (`dev-invoices.mjs drain-pool`, five rounds). A checkout got index 261, 252 past the last paid index (9). Wyatt paid it. The bridge reported it, and it settled at 2 confirmations (02:40:14 UTC). The bridge's wallet sees it because it created that address itself.
- **Shop app stand-in** (`TestLiveLookahead`, `3h-L2-output.txt`): a second view-only wallet-rpc, restored from the same keys with default settings.
  1. As restored: the payment to index 261 is **not seen**.
  2. After `create_address` up to 261 and two auto-refreshes: **still not seen**. Creating the address doesn't find a payment in blocks already scanned.
  3. After `rescan_blockchain`: **seen**, 1784471529 atomic at height 2222980, 8 s from a recent restore height.
  
  So the fix for a wallet app is both steps, addresses up to the index and then a rescan. (Raising the lookahead before restoring should work too; that's not tested here, and there's no lookahead option in wallet-rpc.)
- **Reinstall:** see spec change 15. A reinstalled bridge does **not** recreate addresses before it reconciles. One consequence was observed: a settled invoice falsely moved to review `reversed`.

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

## 12. More than 32 transfers to one address: the bridge sends the 32 largest  (status: accepted, 2026-10-04)
Found in: phase 03 session 3d plan, comparing the plugin's caps with what a wallet can report
Spec says: API contracts, `POST bridge/sync`: a snapshot carries the transfers to one watched subaddress. The plugin caps a snapshot at 32 transfers (phase 02, `MAX_TRANSFERS`; `contract/test-vectors/README.md`) and refuses the whole request beyond that. The spec doesn't say what the bridge does when a subaddress has received more.
Evidence: anyone who sees a pay address can send it many tiny payments, so more than 32 incoming transfers to one invoice address is possible, if unlikely from a real buyer.
Proposal: when an index has more than 32 incoming transfers, the bridge sends the 32 largest (ties broken by the earlier height), logs a warning, and shows it in `xmr-bridge status`. Dropping the smallest can only lower the reported total, so it can't make an invoice look paid that isn't; an honest buyer paying in more than 32 parts would go to review as underpaid, where the admin sees the transfers in the wallet.
Effect on the admin budget: none.
Effect on the trust contract: none.
Wyatt's decision (2026-10-04): accepted with the 3d plan. Wyatt updates the live spec and `docs/spec.md`.

## 13. The remote-node cross-check: what is compared, when, with whom, and how the site hears of it  (status: accepted, 2026-10-04)
Found in: phase 03 session 3e plan
Spec says: Bridge service, duty 6: "Cross-check on remote nodes: before reporting a transfer as confirmed, compare the block hash at its height with a second node. A mismatch holds the transfer at 0 confirmations and turns a health check red." Open question 12: which second nodes to use by default.
Evidence (reasoning, before code): the wallet trusts its node's view of the chain. Comparing "the block hash at its height" means asking the configured node for that hash, and a dishonest node could serve the wallet a fabricated block yet answer that question honestly. Asking the second node about the txid directly would close that, but tells the second node's operator which transactions this wallet host cares about.
Proposal (Wyatt's decisions, 2026-10-04):
1. **What:**
   - For each mined transfer the bridge is about to report, it asks a second node for the whole block at that height (`get_block`).
   - The transfer's txid must be in that block's transaction list, and that block's hash must equal the configured node's hash at the same height.
   - Confirmations reported are the smaller of the two nodes' counts.
   - The second node learns a height, not a txid.
   - Results are kept per (txid, height); a reorg changes the height, so the transfer is checked again.
2. **When:** only when the configured node is not your own, meaning its address is not loopback and not a private or link-local address (a host name is resolved first). A node on the same machine or your LAN is trusted.
3. **With whom:** a built-in list of public nodes per network, tried in random order; no setting. The list is chosen with Wyatt in 3e (open question 12) and changes only with a bridge release.
4. **A mismatch** holds the transfer at 0 confirmations and turns the check red. **No second node answering** reports confirmations as they are, with an amber "node check unavailable", so a public-node outage can't stall every payment.
5. **The site:** the bridge sends an optional `checks` field in the sync body (the plugin ignores unknown fields today); the plugin shows it on the admin page in phase 04. Until then it shows in `xmr-bridge status` and the log.
Effect on the admin budget: none (no setting; your own node needs nothing).
Effect on the trust contract: none for the plugin. The bridge makes outbound requests to the listed public nodes only when the configured node is remote.

## 14. The plugin is renamed Coffer (slug `coffer`)  (status: proposed, 2026-10-05; the rename itself is Wyatt's decision, the spec text is for him to fold in)
Found in: Wyatt's request before phase 03 session 3h. Code changed in commit `2f0bdf1`.
Spec says: Plugin manifest: `"slug": "xmr-pay"`, `"name": "Monero Payments"`. The plugin is called xmr-pay throughout.
Evidence: EmDash takes the plugin id from the manifest slug, and the id is part of everything the plugin owns on a site. So the rename makes a new plugin, not an upgrade of the old one:
- The route prefix `/_emdash/api/plugins/<id>/…`. The bridge's sync URL is now `/_emdash/api/plugins/coffer/bridge/sync`, and the access-rule advice says `/_emdash/api/plugins/coffer/*`.
- `_plugin_storage.plugin_id`, the index names `idx_plugin_<id>_<collection>_<field>`, the `plugin:<id>:settings:*` options and the `_emdash_cron_tasks` row (dev site, `data.db`, checked 2026-10-05).
- A site that ran xmr-pay keeps that data until it's removed. On the dev site it was removed by hand: EmDash's own uninstall handlers act only on registry and marketplace plugins, not on plugins listed in `astro.config.mjs` (`emdash` `api-*.mjs`, `handleRegistryUninstall` and `handleMarketplaceUninstall`). Nothing has been published under either slug, so no real site is affected.
Proposal: change these in the spec:
- line 1, the title: "Coffer: Monero payments for EmDash, design spec" or similar (Wyatt's wording)
- line 55, the diagram: "Coffer plugin"
- line 149, `"slug": "coffer"`; line 154, `"name": "Coffer"`. The admin page label and widget title ("Monero payments") and the widget id `xmr-status` stay, being part of the admin trust contract.
- line 345, the pool top-up label: "a label such as `coffer`" (the bridge now uses `coffer`; nothing reads the label back)
- line 356 and line 588: `/_emdash/api/plugins/coffer/bridge/sync`
- lines 501, 507, 512, 526 and 537: "xmr-pay" becomes "Coffer"
Kept as they are (Wyatt, 2026-10-05):
- The wallet-host side is still **xmr-bridge**: the binary, the service user, `/var/lib/xmr-bridge`, `/etc/xmr-bridge`, the unit, the update guard, and the signed prefix `"xmr-bridge-release-v1\n"`. `install.sh` now says "xmr-bridge installer:" and uses `xmr-bridge.XXXXXX` temp folders.
- The repo, its folder `~/xmr-pay`, and the dev-box paths (`~/xmr-pay-dev-data`, `~/xmr-pay-devkeys`, `~/.config/xmr-pay-dev`).
Left for Wyatt:
- The unit's `Description=xmr-pay wallet host (xmr-bridge)` (`bridge/internal/installer/unit.go:10`) is unchanged, because the unit was out of scope. It's the one place the admin still sees the old name (`systemctl status`).
- The proof of concept (`docs/poc/monero-payments-poc.html`, `poc-simulation.js`) is a snapshot of the published page and still says xmr-pay, including its `SYNC_PATH`.
- Whether `coffer` is free as a registry slug under your publisher and as an npm name (phase 06 and phase 09).
Effect on the admin budget: none.
Effect on the trust contract: capabilities, allowed hosts, route names, storage collections and indexes are unchanged. The route URLs and the plugin's identity change, which is a fresh install with a fresh consent, not an update.

## 15. A reinstalled bridge must catch its wallet up to the site's pool before it reports  (status: accepted, 2026-10-07)
Found in: phase 03 session 3h, step L3 (stagenet, dev box). Evidence files: `~/xmr-pay-dev-data/3h-L3-*.txt` and `3h-watch.txt`.
Spec says: spec change 9: "a reinstalled bridge (a fresh wallet from keys) must recreate addresses up to the highest pool index before it reconciles". Bridge service, Reconcile on start. The bridge has no code for this; the sync response doesn't tell it the pool's highest index.
Evidence. The bridge was uninstalled with `--delete-data` and reinstalled from keys (restore height 2222850, before every payment of the session). The site kept its pool: 311 indexes, free 262–311. The fresh wallet knew indexes up to about 10, from the payments it found while scanning.
1. **A false "reversed".** The first sync after the reinstall (02:53:35 UTC, 7 s after the wallet opened) reported watched index 261 as empty, because the fresh wallet has no address 261. The plugin moved the settled invoice `far` to review `reversed` with received 0, and raised the admin alert. Its payment is on the chain, and the invoice stays in review. An open invoice paid before a reinstall would instead look unpaid and expire.
2. **An accidental, lazy catch-up.** While the pool was full, the bridge created nothing. Once a checkout claimed one row, the site asked for 1 address. The fresh wallet's `create_address` returned a low index the site already had (about 11; inferred from 303 creations ending at 312, since the journal logs counts, not indexes), so it was silently skipped (`plugin/src/sync/handle.ts:109`). A pending address makes the bridge sync again at once, so it looped: **303 syncs in 31 s** (02:56:13–02:56:44), one address each, until index 312. It's harmless at this size, but it's a burst of signed requests that grows with the pool's history, and it only starts after the next checkout.
3. **What did work.** `far2` (index 262), paid after that catch-up, was seen in the mempool and settled (03:03:24). A payment *mined* to an index before the fresh wallet creates it would be missed for good, because blocks already scanned aren't rescanned (spec change 9, stand-in step 2).
4. **A side note for any rescan:** the bridge's wallet-rpc client times out after 5 s (`supervise.go:285`), and `rescan_blockchain` answers only when it's finished. wallet-rpc carries on regardless (`TestLiveLookahead`).
Proposal (smallest that fixes 1–3):
- **Plugin:** the `bridge/sync` response gains `poolTop`, the highest `addrIndex` the site holds (pool and invoices). An optional field: older bridges ignore it.
- **Bridge, at start and whenever `poolTop` is above the wallet's highest index, before sending any snapshot:**
  - create addresses up to `poolTop`, without sending them (the site has them already)
  - then `rescan_blockchain` once, with its own long timeout
  - then reconcile as now
  
  While catching up it sends no snapshots, so nothing can look reversed or unpaid. `status` shows "catching up the wallet (n of m addresses)".
- **Bridge, top-ups:** start numbering from the wallet's next index only once that index is above `poolTop`. That removes the duplicate loop.
- **Tests:** unit tests with fakes (fresh wallet, pool above it, no snapshots before catch-up, one rescan, no duplicate addresses), then this L3 run again on stagenet.
Effect on the admin budget: none. No setting or step; a reinstall just takes the time of one rescan.
Effect on the trust contract: none. It adds a response field on an existing route; no capability, host, route or storage change.

## 16. The height the site relies on can be far off: a fresh wallet's first sync, and checkout's estimate after a silence  (status: accepted, 2026-10-08; sub-choice recorded as the recommended one, refuse checkout while the bridge is silent, open to Wyatt's override before implementation)
Found in: phase 03 session 3i (stagenet, dev box). Evidence: `~/xmr-pay-dev-data/3i-status-output.txt` (journal), `3h-watch.txt`, the `far3` invoice in the dev database.
Spec says: `bridge/sync` carries the wallet's `height`, which the plugin stores as the chain height (`state:bridge`). Checkout sets `createdHeight` from it, and `expiresHeight` = that + 15 + 3 blocks. A payment reported after the deadline counts if it was mined at or below `expiresHeight` (Lifecycle, "On time or late").
Evidence:
1. **A fresh wallet reports a tiny height.** After the reinstall, the bridge logged `wallet open height=579994` (the chain was at 2224442). Its first sync, the learning one, sends that height, and the site stored it for about 12 s until the catch-up and the next sync. 3h's first sync also came 7 s after the wallet opened. Any first install does the same while the wallet is still refreshing.
2. **Checkout's estimate after a silence was 35 blocks low.** With the bridge silent for about 1.5 days, checkout estimated the height as the last sync's plus 2 minutes a block (`checkout.ts:142`). It gave `createdHeight` 2224369 against a real 2224404. So `far3`'s `expiresHeight` (2224387) was below the chain the moment it was made.

Effect: an invoice created in either state gets an `expiresHeight` that is too low, by about 1.6 million blocks in case 1. A payment to it that the plugin doesn't see before `expiresAt` (a bridge outage) can then never count as on time by its block height. It would go to review `late` although it was paid in time. Nothing in 3i was affected: `far3` was never paid, and no checkout fell in case 1's window.
Proposal (smallest):
- **Plugin:** the stored height never goes down (`max(stored, reported)`). That covers case 1, since the site already holds the real height from before. A first install has no stored height and no invoices yet.
- **Plugin, checkout:** if the last sync is older than the silent-bridge threshold (5 minutes, spec change 2), refuse checkout with a domain error such as `WALLET_HOST_SILENT` instead of estimating. Or, the gentler option: keep the estimate but count `expiresHeight` as unknown, so only the time-based on-time rules apply. Wyatt to choose. Refusing is simpler and is what the admin alert already implies.
- **Bridge (optional):** don't send a sync until wallet-rpc's height is within a few blocks of the node's. It needs a node call the bridge already makes for the cross-check.

Effect on the admin budget: none. Trust contract: none (a new domain error code, if chosen).
Implemented in session 3j (2026-10-08), with the bridge part skipped (Wyatt): `bridge/sync` stores `max(stored, reported)` and judges snapshots at that height; checkout returns `WALLET_HOST_SILENT` when the bridge never synced or its last sync is more than 5 minutes old, checked after the product lookup and before the price request, and otherwise uses the last sync's height with no estimate. Spec text to fold in, API contracts, checkout errors: `{ "error": { "code": "PRODUCT_NOT_FOUND | RATE_UNAVAILABLE | NO_ADDRESS_AVAILABLE | TOO_MANY_OPEN | WALLET_HOST_SILENT" } }`, with: "`WALLET_HOST_SILENT`: the wallet host hasn't synced for over 5 minutes (the admin page shows the same alert), so the site can't be sure of the chain height an invoice's deadline is set from."

## 17. A reinstall's restore height  (status: accepted, 2026-10-08; option (a), recommended, open to Wyatt's override before implementation)
Found in: phase 03 session 3i.
Spec says: the installer creates the wallet "with a restore height of today (no full-chain scan)" (Admin setup, step 3). `xmr-bridge install --restore-height` defaults to today.
Evidence: spec change 15's catch-up rescans from the wallet's restore height. In 3i, `far4` was paid and mined while the bridge was uninstalled. The rescan found it only because the reinstall passed `--restore-height 2222850`. With the default it would have been missed, and the invoice would have expired unpaid.
Proposal: when the site already holds invoices, the restore height must be at or below the oldest watched invoice's `createdHeight`. Either:
- **(a)** the `bridge/sync` pairing response returns a suggested restore height (the minimum `createdHeight` of watched invoices, minus a margin), and the installer uses it when no `--restore-height` was given, before creating the wallet. That reorders the install a little, because pairing would come before the wallet's creation.
- **(b)** the bridge compares, on its first sync, the oldest watched invoice's height (sent in the response) with its restore height. If the restore height is too new, it recreates the wallet from keys with the lower height (it needs the view key again, read from the existing wallet or asked for again).

(a) is simpler and keeps the view key handling as it is. Effect on the admin budget: none for (a) (no prompt or setting). Trust contract: a response field.
Implemented in session 3j (2026-10-08), option (a) with a 720-block margin (Wyatt):
- **Plugin:** the response that completes a pairing carries `restoreHeight` = the oldest watched invoice's `createdHeight` − 720, floored at 0, and leaves it out when nothing is watched. Ordinary syncs never carry it.
- **Bridge:** `xmr-bridge install` now pairs before it creates the wallet. A new wallet's restore height is `--restore-height` if given (with a warning when it is newer than the suggestion), else the suggestion, else the node's height. The height used is written to the config.
- **A kept wallet** (a rerun for the same address, or `xmr-bridge pair`) keeps its height. The admin is told how to start over (`uninstall --delete-data`, then install again) when that height is newer than the suggestion. There's no warning when the height wasn't written down (wallets made before 3j without `--restore-height`).
- If wallet creation fails after pairing, the code is spent; the error says to press Connect wallet host for a new one.
Spec text to fold in, Admin setup step 3: "creates the view-only wallet with a restore height of today (no full-chain scan), or, when the site already has open invoices, from just before the oldest of them (the pairing response suggests it), so a reinstall sees payments made while the wallet host was away"; and in the installer's steps, pairing moves before the wallet's creation. API contracts, `bridge/sync` response: "`restoreHeight` (number, on the response that completes a pairing only, absent when no invoice is watched)".

## 18. A tips-only tier with no wallet host  (status: proposed, 2026-10-08)
Found in: Wyatt's planning chat, 2026-10-08, comparing Coffer with SlowBearDigger's `xmr-pay` (npm 1.1.0, published 2026-06-21; README section "You do not need a dedicated server"). Not found by code or tests; it reopens a decision at Wyatt's request.
Spec says:
- Key design decisions, "Wallet host on its own Linux machine": "A watcher inside the plugin and running on the site's server were both considered and rejected."
- Where the wallet host runs: "Considered and rejected: … a watcher inside the plugin with no machine at all (the site would hold the view key and depend on public nodes)."
- Tip jar mode, the options table: "Static address | One primary address and QR in the theme, no plugin | Works today, zero moving parts | Address reuse, no confirmation, no per-post attribution".
- Admin budget: "Required settings | None."
- `docs/decisions.md`: "The wallet host must be a separate machine from the site; no in-plugin "quick setup" mode". `CLAUDE.md`, trust contract: "The plugin never calls the wallet, a node, the bridge, or any host but the two price APIs."

Evidence:
1. **xmr-pay's claim.** "confirming a Monero payment is, underneath, just reading public blockchain data and doing some math", so no always-on box is needed. It offers three ways:
   - **Proof mode:** the buyer pastes a txid and a tx key or tx proof; a stateless endpoint checks it against one or more nodes.
   - **Watch mode:** "a long-running process you host", holding the view key (through wallet-rpc or a WASM scanner).
   - **Its WordPress plugin:** both, in pure PHP with vendored monerophp curve code, run by WP-Cron and checkout page loads.
2. **How each maps to a sandboxed EmDash plugin** (`docs/reference/emdash-knowledge-base.md` 9.9 and 6.11):
   - **Watch mode:** the sandbox has no long-lived process, and a Cloudflare-hosted site has no server to run one on. On a Node site it would run on the site's own server, which the installer refuses.
   - **Scanning inside the plugin** (the WordPress route): puts the view key in the site's database, the case the spec rejected. On Cloudflare it must also fit 50 ms CPU and 10 subrequests per call, with at least one variable-base curve multiplication per transaction in every block.
   - **Proof checking:** fits the sandbox's shape: one public route, no long-lived process, no view key. The site needs only a public shop address, and a proof is bound to that address.
3. **Their JavaScript can't be used as-is.**
   - `verifyPayment` needs `monero-ts`: a multi-MB WASM build, rejected in `docs/decisions.md`, and over the 128 KB `backend.js` cap.
   - `verifyPaymentViaRpc` needs a wallet-rpc, which is a server.
   - So a proof check in the plugin means our own Keccak-256 and Ed25519 point arithmetic in TypeScript. WebCrypto's Ed25519 only signs and verifies.
   - Precedent: spec change 11's base-point multiplication in the bridge (`internal/edwards`, about 150 lines on `math/big`).
   - The plugin bundle is 27.9 KB of 128 KB today.
4. **Two traps a proof check must close.**
   - **The encrypted amount (`ecdhInfo`) isn't checked by consensus,** so a sender can write any amount there. The check must decode the amount and verify it against the output's commitment (`C == mask·G + amount·H`), as `wallet2` does when it checks a tx key.
   - **The check trusts the node for the transaction itself.** A dishonest node can serve a transaction that was never mined, built to match a proof the attacker made. Two independent nodes agreeing, plus the txid being in the block at its height (the spec change 13 check), limit this; nothing removes it. That's why this proposal covers tips only: a forged tip releases nothing, a forged order would.
5. **Why it matters.** Coffer's pitch says it isn't for "anyone without a machine of their own or a host they trust", and "no server" is xmr-pay's headline. A tier with no machine and no view key on the site answers that without giving up "the site holds nothing worth stealing".

Proposal: two steps, decided separately. Neither changes phase 04.

**A. Static tip button (theme kit, phase 06).** The spec's "Static address" option, shipped as a mode of Coffer's tip button instead of being left to each theme.
- The button takes a shop address as a prop. That can be the primary address or a subaddress set aside for tips, which keeps the primary address unpublished.
- It shows a locally rendered QR, the address, copy and "open in wallet", with a plain label: the site doesn't confirm these tips.
- Once a wallet host is paired, the same button makes tip invoices (phase 07), with no theme edit in between.
- For Wyatt: while checkout returns `WALLET_HOST_SILENT`, should the button fall back to the static address (tips keep flowing during an outage, unrecorded) or show the error?
- No plugin change.

**B. Proof-checked tips with no wallet host (plugin, phase 07 at the earliest), only if the spike below passes.**
1. **Tip address:** the admin types the tip address once on the admin page. It's public data, not a secret.
2. **Submitting a proof:** after paying, the buyer submits:
   - the txid
   - the tx key or an OutProofV2
   - optionally, the entry reference and a note

   A new public route (for example `tip/prove`, POST) validates the format before any network call and refuses a txid already recorded (a unique index). The pay page prefers the OutProof where the buyer's wallet offers one: a tx key also lets the site test the transaction's other outputs, such as the buyer's change, against addresses it knows.
3. **The check:** the plugin asks two nodes from a built-in list for the transaction and the chain height. The nodes learn which txid the site asked about, not the amount or the address. A tip counts only if:
   - both nodes return the same transaction, mined, and the txid is in the block at that height
   - `unlock_time` is 0 and there's no double-spend flag
   - the proof is valid for the tip address
   - each amount decodes and matches its commitment
   - the sum to the tip address is at least the dust floor
   - confirmations are at least the lowest tier of the speed preset
4. **Not passed yet:** a transaction that isn't mined, or is short of confirmations, is stored as pending and rechecked in bounded batches by the backup cron and the status route (as in spec change 2). Nothing counts as a tip until it passes. A node that doesn't answer means "try again", never a tip.
5. **After it passes:** the tip counts toward per-entry totals and notes exactly like a settled tip invoice. The admin page marks it "checked by public nodes".
6. **Pairing a wallet host later:** new tips switch to tip invoices. Only the bridge, holding the view key, can confirm that a tip subaddress belongs to its wallet. How it reports that is a detail for phase 07.
7. **Spam:** checkout's site-wide cap approach, plus a per-minute cap on node calls, so a flood of fake submissions can't exhaust the nodes or the CPU budget.

**Spike for B** (about half a session, after phase 04):
1. Does `ctx.http.fetch` reach `http://` hosts and non-default ports (18081, 18089) listed in `allowedHosts`, on both runners? If not, only HTTPS nodes qualify. How many public HTTPS nodes exist for stagenet and mainnet?
2. CPU: our own BigInt verifier on a real 2-output and a 16-output stagenet transaction, in the Cloudflare runner (50 ms) and in workerd.
3. Size: what the verifier adds to `backend.js`.
4. Outbound calls per check against Cloudflare's 10-subrequest cap, and whether `ctx.storage` calls count toward it.
5. Correctness: our verifier against the dev box's `monero-wallet-rpc` (`check_tx_key`, `check_tx_proof`) as an oracle on stagenet. Cases:
   - real tips
   - a wrong key
   - a wrong address
   - a hand-built mismatched `ecdhInfo` amount
   - a time-locked transaction
   - a fabricated transaction served by a proxy node
6. Buyer side: which wallets show a tx key or make a tx proof, and in how many steps (a setup-friction row for buyers).

If any of items 1–4 fails, B is dropped and A stands alone.

Effect on the admin budget:
- **A:** none. The tip button takes one prop (the address); no new step.
- **B:** a tips-only site is set up with the registry install plus one typed value: no command, no machine, no view key. But the address is a fourth setting, required in this tier, against "Required settings: None"; Wyatt decides whether that's acceptable. No routine upkeep for admins. The built-in node list needs plugin releases as nodes disappear, which is upkeep for the maintainer, not the admin.

Effect on the trust contract:
- **A:** none.
- **B:** broadens it:
  - `allowedHosts` gains the built-in node hosts
  - a new public route
  - a unique `txid` index, on `invoices` or a new collection
  - a fourth setting
  - CLAUDE.md's line "never calls … a node" changes

  If all of it lands before the first release, no installed site has consented to the old contract. After release, adding a node host is a broadening, so a major version.
- **Both keep** the reason behind the "no in-plugin watcher" decision: no key of any kind on the site; the view key stays on the wallet host or nowhere. B does take on the rejected watcher's other cost, depending on public nodes, and accepts it for tips only. Only the decision's wording, "no in-plugin quick setup mode", is reopened.

Recommended order (planning chat): accept A for phase 06. Run B's spike after phase 04 and decide B before phase 07. Phase 04 goes ahead as written.

## 19. The "paste a key by hand" fallback has nothing to paste  (status: accepted, 2026-10-09, option (a))
Found in: phase 04 session 4b, building the Settings section.
Spec says: Configuration, "Bridge public key | filled in by pairing | … Pasting a key by hand is a fallback for advanced setups. Not a secret." Phase 04, Settings: "The bridge public key read-only, with 'paste a key by hand' as an advanced fallback."
Evidence:
- `xmr-bridge` makes its key only inside pairing (`internal/pairing.Pair`): a new key per attempt, saved only when the site accepts it.
- No command prints the public key (`grep PublicKeyText bridge/cmd`: nothing), and no command makes a key without pairing.
- So an admin has no key to paste. A pasted key would also leave the bridge without the private key that matches it.

The fallback would only help where pairing fails but signed syncs would work. Pairing and syncs use the same route, the same signature check and the same outbound connection, so nothing found so far fits that.

Proposal:
- **(a), recommended:** drop the fallback from the spec. Pairing stays the only way to set the key, and the admin page shows the key read-only, as built in 4b.
- **(b):** a new `xmr-bridge key --new` that makes and saves a key and prints its public half; the admin pastes it into a form on the admin page. That's one more bridge command, one more admin path to test and document, and a way to put a key on the site that no pairing code vouches for.

Effect on the admin budget: none for (a); for (b), an extra advanced path (not part of setup).
Effect on the trust contract: none for either (the key setting exists already).
Wyatt's decision (2026-10-09): (a), drop the fallback. Also, `xmr-bridge status` prints the bridge's public key in the form the admin page shows, so the admin can check they match. Implemented in phase 04 session 4b.
Spec text to fold in (Wyatt; `docs/spec.md` is not edited here):
- Configuration, the Bridge public key row: "| Bridge public key | filled in by pairing | none | Shown read-only; pairing is the only way to set it. `xmr-bridge status` on the wallet host prints the same key, so the two can be compared. Not a secret. |"
- No other line of the spec mentions pasting a key. Key design decisions ("…instead of a key to copy by hand") already says pairing replaces copying a key.

## 20. A node that's still syncing passes every check  (status: accepted, 2026-10-12, as part of Wyatt's approved phase 05 plan)
Found in: phase 05, preparing run A on a newly started node (Wyatt's notes, 2026-10-12).
Spec says: Configuration, Monero node: "Defaults to a local `monerod` if one answers (recommended); otherwise asks for a remote node you trust." Bridge service, duty 6 (and spec change 13, item 3): a second node from a built-in list. Phase 04's wallet check (`checks.wallet`) compares the wallet's height with its node's: `ok`, `behind`, `unavailable`.
Evidence:
- `get_info` from run A's new node over restricted RPC, from the dev box, on 2026-10-12: `nettype` stagenet, `height` 94,954, `target_height` 2,227,755, `synchronized: false`, `busy_syncing: true`, `restricted: true`. So `synchronized` and `target_height` do come through restricted RPC; `version` comes back empty there.
- The installer's node check (`chooseNode`) tests the network and `offline`, not `synchronized`, so it accepts that node.
- The wallet check compares the wallet only with its own node's height. A wallet on a half-synced node reads `ok`, and the admin page's checklist shows Wallet synced, while a payment on the real chain can't appear until the node catches up. That is exactly an admin who has just started their own node.
- The cross-check's second node had the same gap: a syncing second node gives a low height, so every payment is held at 0 confirmations. It could also pick the configured node itself, since every stagenet node listed as online today is on the built-in list.

Proposal (accepted):
1. **Installer:** when the chosen node isn't synchronized, it says so in one line (block N of about M, payments can't show until it has caught up, a new node can take hours, `xmr-bridge status` shows progress) and goes on. No new prompt, no refusal.
2. **Wallet check:** a new state, `syncing`, when the wallet host's node says it isn't synchronized. It takes precedence over `ok` and `behind`. `xmr-bridge status` shows the wallet check too.
3. **Admin page:** Wallet synced is not done while the state is `syncing`; a red health line says the node is still syncing, with one action (wait; check with `xmr-bridge status`). The plugin accepts the new state; an older plugin drops unknown states, so no protocol version change.
4. **Second node:** never on the configured node's host (any scheme or port), and only one that says it is synchronized.
5. **Checkout is unchanged in this change, and that is not safe; open for Wyatt.** The bridge reports the wallet's height, which can't pass its node's. An invoice created while the node syncs gets `createdHeight` and `expiresHeight` from that low height (spec change 16's `max(stored, reported)` doesn't help on a first install, which has no stored height). A payment mined on the real chain is far above `expiresHeight`. As the node catches up, the invoice expires on the rising heights, and the payment then counts as late and goes to review, although it was paid in time. Corrected 2026-10-12: this item first said the opposite. Options:
   - **(a), recommended:** checkout refuses while the wallet check says `syncing`, like spec change 16's `WALLET_HOST_SILENT`. It needs a new checkout error code or a reuse of that one, which is an API contract change. Get a test address already waits, because Wallet synced is to do.
   - **(b):** keep checkout and treat `expiresHeight` as unknown for invoices created during a sync, so only the time-based rules apply.
   Until Wyatt decides, the setup test is unaffected: run A starts only after the node has caught up, and run B uses a synced public node.

   **Wyatt's decision (2026-10-12): (a), with a new code.** Implemented the same day:
   - Checkout refuses with `WALLET_HOST_SYNCING` while the last sync's wallet check is `syncing`. As with `WALLET_HOST_SILENT`, it refuses before the price request, so nothing is claimed. A silent host is reported as silent, since its last check is stale.
   - Get a test address refuses with a message saying the node is still catching up.
   - The admin page's red line adds "Checkout is paused until then."
   - Spec text to fold in, API contracts, checkout errors: add `WALLET_HOST_SYNCING` to the code list (`… | WALLET_HOST_SILENT | WALLET_HOST_SYNCING`), with: "`WALLET_HOST_SYNCING`: the wallet host's node is still catching up with the network (the admin page shows the same alert), so the chain height an invoice's deadline is set from would be far too low. Pages treat it like `WALLET_HOST_SILENT`: payments are temporarily unavailable."

Effect on the admin budget: none (one installer line, no prompt or step). A new node's sync time is outside the 15 minutes; the message makes the wait visible instead of silent.
Effect on the trust contract: none (the `checks` field is optional information in the sync body; no new route, capability, host or storage).
Spec text to fold in (Wyatt; `docs/spec.md` is not edited here):
- Configuration, Monero node row: "… otherwise asks for a remote node you trust. If the node is still catching up with the network, the installer says so and goes on."
- Bridge service, duty 6: "… with a second node from a built-in list: never the configured node's own host, and only one that has caught up with the network."
- Admin page, health: "The wallet's height against its node's, and whether that node has caught up with the network."

## 21. The install command works without curl  (status: accepted, 2026-10-12)
Found in: phase 05, preparing the wallet-host container `coffer-test` (Wyatt's update 2).
Spec says: Bridge service, The install command: `curl -fsSL https://<release host>/install.sh | sh -s -- --site … --pair …`. The admin budget: "no software to install first".
Evidence:
- `command -v` on a clean container from Proxmox's plain Ubuntu 24.04 template: `sha256sum`, `sudo`, `wget` and `python3` are there; `curl` is not. A minimal Debian 12 container has no `curl` either (phase 05 prep).
- Both the admin page's command and `installer/install.sh` (its own check, then the bridge download) needed curl, so fixing only one would fail one step later.
- Proxmox containers are a likely home for a wallet host, so this is the common case, not an edge case.

Decision (Wyatt, 2026-10-12):
1. **The admin page's command** picks one downloader before fetching anything: curl, else wget, else a plain message saying what to install and to paste the command again. Still one line, no added step:
   `if command -v curl >/dev/null; then curl -fsSL <URL>; elif command -v wget >/dev/null; then wget -nv -O- <URL>; else echo "This command needs curl or wget. Install one (on Debian or Ubuntu: sudo apt install curl), then paste this command again." >&2; fi | sh -s -- --site … --pair …`
   - Not `curl … || wget …`: a curl that fails part way would send its partial output and then wget's whole copy into `sh`.
   - `-nv`, not `-q`: `wget -q` prints nothing on a 404, so the command would end silently.
   - It no longer runs in fish; bash, dash and zsh are fine.
2. **`install.sh`** uses curl with `--proto` as before, else `wget --max-redirect=0`, else the same plain message. The SHA-256 check and everything after it are unchanged.
3. **What stands in for `--proto` on the wget path: no redirects at all.** GNU wget can't limit the protocol a redirect goes to (`--https-only` applies only to recursive downloads), so it follows none, and the release URL keeps the protocol the build allows. Integrity never depended on it: the binary must match the SHA-256 written into `install.sh`. Open item for phase 09's install host: the binaries must be served from `RELEASE_BASE` without a redirect (GitHub Releases asset URLs redirect).

Effect on the admin budget: better. A machine without curl no longer needs software installed first; a machine with neither curl nor wget is told plainly what to install.
Effect on the trust contract: none.
Spec text to fold in (Wyatt; `docs/spec.md` is not edited here):
- Bridge service, The install command, the code block:
  ```sh
  # Linux, the only supported platform at launch; curl or wget
  if command -v curl >/dev/null; then curl -fsSL https://<release host>/install.sh; elif command -v wget >/dev/null; then wget -nv -O- https://<release host>/install.sh; else echo "This command needs curl or wget. Install one (on Debian or Ubuntu: sudo apt install curl), then paste this command again." >&2; fi | sh -s -- --site https://example.com --pair <one-time code>
  ```
- After it: "The command uses curl, or wget where curl isn't installed (as on a clean Ubuntu or Debian container). With neither, it says what to install."


## 22. Tips first: two releases  (status: accepted, 2026-10-13)
Found in: Wyatt's plan change of 2026-10-13 (`docs/plan-change-tips-first.md`, Part 1), during phase 05.
Spec says: Build plan and testing, steps 5 to 9: one release after the store adapter (step 8).
Evidence: two Stripe-based payment plugins and a commerce plugin are already on the EmDash registry. Nothing is fulfilled on a tip, so a tips-only release carries far less risk than selling goods. No release reaches mainnet without an adversarial pass first.
Decision (Wyatt, 2026-10-13):
1. **Release 1, tips only:** phase 05 (unchanged; the confirmed test payment is a test tip), 06 (scoped to what tips need), 07 (unchanged), the new 07b (adversarial testing, pass 1), then 09 (release, mainnet tips trial). No order or product checkout.
2. **Release 2, orders:** 08 (store adapter), 08b (adversarial testing, pass 2), 09b (orders release, security report regenerated to cover orders).
3. **Goods kept out of release 1 by one switch** (Wyatt's choice of 2026-10-13, over leaving the code out of the build): a single constant in the plugin. With it off, `checkout` accepts only `kind: "tip"`, and `product` and `order` get the same reply as an unknown `kind`. The admin page hides what only products use (the "All invoices" table filtered to products, the review advice's "find it under All invoices" hint). The release-1 theme package has no PayButton. Dev and release builds run the same code. Phase 07 turns it off when tip checkout lands; release 2 turns it on. Pass 1 attacks every path (07b, row A0).
4. **The trust contract stays as declared:** release 1 publishes today's manifest unchanged. Per the spec and phase 08, orders need no new capability, host, route or index. If phase 08 finds it needs more (for example an `orderRef` index for a store that retries checkout), release 2 takes the version bump and the admin's fresh consent, written up here first.
5. **Security reports:** release 1's published report covers tips. Order-only threats stay listed, marked "covered in release 2".
6. **Sidebar icon:** the admin page declares `"icon": "coins"` (Phosphor's Coins; EmDash shows its generic plug when none is declared), set in phase 09's manifest step.

Effect on the admin budget: none.
Effect on the trust contract: none (item 4). The icon is an admin-page change, not part of the trust contract.
Spec text to fold in (Wyatt; `docs/spec.md` is not edited here):
- Build plan and testing: after step 7, "7b. **Adversarial testing, pass 1.** A fresh session that didn't write the code attacks everything a tips-only install exposes, and proves no order path is reachable." Step 9 becomes "**Release 1 (tips).**" with the mainnet tips trial. After it: "8b. **Adversarial testing, pass 2** (orders, products, the store adapter, and a retest of pass 1 on changed code)" and "9b. **Release 2 (orders).**" Step 8 is marked as release 2.

## 23. The site address a sandboxed plugin gets can be localhost for good  (status: accepted, 2026-10-13)
Found in: phase 05, run A attempt 1 (`~/xmr-pay-dev-data/05-setup/run-a-attempt-1.md`, local).
Spec says: Admin setup and upkeep, the install flow: the admin page shows the install command with the site's own address. The plugin's address was assumed to follow the site's configured `siteUrl` (or `EMDASH_SITE_URL`), as the old admin hint said.
Evidence (EmDash 1.1.0, from its source):
- A sandboxed plugin's `ctx.site.url` is the `emdash:site_url` option and nothing else (`emdash-runtime`, `readSiteInfo`; the Node runtime sets no `deps.siteInfo`).
- That option is written once, at site setup (`setIfAbsent`). Setup under `astro dev` on localhost saves the request's own origin, so this dev site holds `http://localhost:4321`. The dev setup bypass also overwrites it with the request's origin.
- `siteUrl` and `EMDASH_SITE_URL` never update it. EmDash's own sign-in reads those first (`getPublicOrigin`), which is why the passkey worked at `https://dev.wyattdilley.com` while Coffer's command said localhost.
- EmDash's settings page has no field for it: its "url" setting writes `site:url`, a different key. Nothing in the CLI writes it either.
- So a real admin who first set their site up under `npm run dev`, or who later moved domains, gets a command aimed at the wrong address, and can only fix it in the database.
- On the Node runner, a route that declares no `request` block gets every request header except EmDash's strip list (cookies, authorization, Cloudflare Access headers, `x-emdash-request`). The admin route declares none, so the browser's `Origin` reaches it. The phase 01 stripping applies to routes with a `request` block, such as `bridge/sync`. Proved live on the dev site (saved address localhost): with `Origin: https://dev.wyattdilley.com` the page used that address; without it, the red line.

Decision (Wyatt, 2026-10-13), with his five conditions:
1. **A saved public https address is always used.** When the admin's browser is on a different https origin, an alert names both and the command keeps the saved one: no silent switch after a domain move (condition 5).
2. **Otherwise the admin's own browser Origin is used,** when it is a bare https origin that isn't loopback (condition 2). This covers a saved address that is loopback, plain http or missing.
3. **Anything else:** a red line naming the saved address, no command, and Connect wallet host refuses.
4. **Origin is read only on the private admin route** (signed in, `plugins:manage`), never on a public route (condition 3). Tests show spoofed `Origin`, `Host` and `X-Forwarded-Host` change nothing in the `status`, `checkout` and `bridge/sync` replies.
5. **The page says which address the command uses and where it came from** (condition 4): "(from your browser, because EmDash's saved address for this site is http://localhost:4321)" or "(EmDash's saved address for this site)".
6. **Proven before building on it** (condition 1): the runtime test host with real headers, and the live probe above.
7. **The installer** refuses a `--site` on localhost, 127.0.0.0/8 or ::1 without `--allow-same-machine`, before any prompt. Its same-machine check also moved ahead of the address and view-key prompts.

Effect on the admin budget: better. An admin whose EmDash saved a wrong address no longer needs a database edit; one opening the page at an address the wallet host can't use is told so, with no command.
Effect on the trust contract: none. No new route, header declaration, capability or setting.
Matrix note (for `docs/security-matrix.md`, row F06; Wyatt copies it into the Claude Doc): "The admin page reads the request's `Origin` header, on the private admin route only, and only to fill in the wallet host's site address when EmDash's saved one is loopback, plain http or missing; https only, never loopback. Public routes build no URL from any request header. Tests: `plugin/tests/routes/admin-site.test.ts`."
Upstream note (draft for Wyatt to post to EmDash): "`ctx.site.url` for sandboxed plugins comes only from the `emdash:site_url` option, which setup writes once (under `astro dev`, as the loopback origin) and nothing else updates. `siteUrl` and `EMDASH_SITE_URL` are ignored for it, though sign-in and invites prefer them (`getPublicOrigin`). Could plugin site info prefer the configured origin, as `getSiteBaseUrl` does, or could the admin settings expose the saved address?"
Spec text to fold in (Wyatt; `docs/spec.md` is not edited here):
- Admin setup and upkeep, the install flow: "The command carries the site's address: EmDash's saved address when it is a public https one; otherwise the address the admin has the page open at, when that is https. The page says which, and shows no command when neither will do."
- Bridge service, the install command: the four-line form (spec change 21's command, split at `if` / `elif` / `else` / `fi`, with the shorter message "This needs curl or wget: sudo apt install curl, then paste again.").

## 24. Help the owner find the test tip in their wallet app  (status: accepted, 2026-10-15)
Found in: phase 05, run A attempt 2 (`~/xmr-pay-dev-data/05-setup/run-a-attempt-2.md`, local).
Spec says: Admin setup and upkeep, the setup checklist ending in a test tip; spec change 9 makes "the tip shows in the shop's wallet app, with its amount" a pass criterion.
Evidence:
- Coffer settled the test tip at 02:22:30 UTC, about 4 minutes in (block 2,228,686, txid `2f88c81c…c972ec`). The node agreed.
- Feather's shop wallet stayed empty, and the run failed at about 16½ minutes.
- Cause: Feather 2.8.1 gave the new 16-word (Polyseed) stagenet wallet a restore height of 2,230,020 from the seed's creation date, about 1,300 blocks above the chain. It scanned nothing.
- Feather 2.8.1 can't change the restore height of an open wallet. Re-restoring with "Override embedded wallet creation date" and height 2,228,000 showed the tip.
- The admin page gave the owner nothing to look for. A settled test tip appears nowhere but the checklist's "Done", and the `monero:` link under the test address has no label.

Proposal (Wyatt's suggestions 1–7, with Claude's recommendation on when):

| # | What | Where | When (recommended) |
| --- | --- | --- | --- |
| 1 | After the test tip settles, show its amount, txid and block height, with "Look for this in your shop wallet's history" | Plugin, setup section | Before the rerun of A |
| 2 | Beside it, a "Not in your wallet app?" hint: the app must be synced to the wallet host's height (shown); its restore height must be at or below block N (the tip's block); rescan if not | Plugin | Before the rerun of A |
| 3 | In the checklist, before Get a test address: "Open your shop wallet app and let it finish syncing. If the wallet is new, check its restore height is at or below block N", with N the wallet host's current height | Plugin | Before the rerun of A |
| 3b | Label the `monero:` link: "Payment link: fills in the address and amount in most wallets" | Plugin | Before the rerun of A |
| 4 | "Your shop wallet app" section in the install docs: a synced node, and the restore height of a new wallet | Phase 09 docs | Phase 09 |
| 5 | Setup-test protocol: a wallet prep step before the clock (restart, heights match, restore height below the current block); the run sheet records Coffer's settle time, the wallet app's show time and the confirmation wait separately | `docs/setup-test.md`, run sheets | Before the rerun of A (the prep is already in the local organizer sheet) |
| 6 | Upstream note for Feather (draft below) | For Wyatt to post | Any time |
| 7 | Preventive wording everywhere: check the shop wallet's restore height right after creating it, before installing; redo the restore then if needed | Setup test, phase 09 docs | With 5 and 4 |
| — | The installer's node prompt (the tester looked up the address) | Organizer sheet now; prompt wording at the next release rebuild | Not before the rerun: it would need another release build and signature |
| — | A place to see tips | Phase 07's tips view (already planned) | Phase 07 |

Effect on the admin budget: better, because a wallet-app mismatch shows up while it's cheap to fix. Item 3 adds guidance text, not a step Coffer runs or checks; there's no new setting or prompt.
Effect on the trust contract: none (admin page text only; the txid and height are already stored).

Decision (Wyatt, 2026-10-15): as proposed, with the "when" column as recommended. Item 1's details show in a "Test tip received" section at the top of the page for 24 hours after the tip settles (the plugin's clock, for display only), and inside Setup (complete) for good. Built before the rerun of A: items 1, 2, 3 and 3b in `plugin/src/admin.ts` (tests in `plugin/tests/routes/admin-setup.test.ts`), and items 5 and 7 in `docs/setup-test.md` ("Before the clock", the split timing table, pass criterion 7) and the local run sheets.

Upstream note for Feather (draft; Wyatt decides whether to post it, and no LAN addresses go in it):
"Feather 2.8.1, stagenet: a new wallet with a 16-word Polyseed got restore height 2,230,020, while the chain was at about 2,228,700 (2026-10-14). The height is in the future, so the wallet silently scans nothing and misses every payment until the chain passes it. Debug info shows the height, but nothing changes it; the only fix is restoring again with 'Override embedded wallet creation date'. Two asks: (1) clamp a new wallet's restore height to the node's current height; (2) expose the existing 'Change restore height' action (it's in the source but on no menu)."

## 25. Admin upkeep: tip records, quiet-host alerts, versions, a recovery sheet, an activity log  (status: proposed, 2026-10-14)
Found in: Wyatt's planning chat of 2026-10-14 ("what would make the admin side easier to live with"), after reading the spec, spec changes 1–24 and phases 07, 07b and 09.
Spec says:
- Phase 07: "a tips view with totals per entry (counted, settled tips only) and recent notes."
- Admin setup and upkeep, Health: one line per check, shown on the admin page and dashboard widget; the silent-bridge line turns red after 5 minutes without a sync.
- Updates: the bridge updates itself and wallet-rpc daily (on by default, can be turned off); an older protocol version shows "wallet host update available".
- Build plan step 10, Later versions: "Receipts through `email:send` … Each capability addition re-prompts consent."
- Proposed earlier, undecided: a reconciliation export (settled txids and amounts, to check in the owner's own wallet).

Evidence:
- Every invoice already stores `fiat` (amount, currency), `rate` (locked at checkout), `settledAt`, `transfers[]` (txid, amount, height) and `kind`. A tip's fiat value is already known; nothing shows it over time or lets the owner take it away. Tips are taxable income for most owners, and today they'd have to rebuild that record by hand from their wallet and a price history.
- Buyer notes are purged 30 days after an invoice is final. Invoices themselves are kept. So a record of amounts can be complete, but notes can't be, and anything that exports notes must say so.
- Health lines only help when someone opens the admin page. A home wallet host that loses power or a tunnel that lapses stays red until the owner happens to look, and every tip in that time waits.
- Run A attempt 2 showed that restore height is the easiest thing for an owner to get wrong, and the moment they most need the right number is when a wallet host has died. Spec changes 15 and 17 cover how a reinstall catches up; nothing hands the owner the numbers ahead of time.
- When auto-update is turned off, nothing tells the owner they've fallen behind until the protocol version gap shows up, and a Monero network upgrade would make an old wallet-rpc stop seeing payments.
- Re-pairs, setting changes and review decisions leave no trace the owner can read. A re-pair nobody remembers making is a security signal (it may mean the bridge key was replaced), and a trail makes support questions answerable.

Proposal (five parts, separable; Claude's recommendation on when):

| # | What | Where | Trust contract | When (recommended) |
| --- | --- | --- | --- | --- |
| 1 | **Tip record.** Extend phase 07's tips view with totals for this month, this year and all time, in XMR and in the site currency at each tip's locked rate. Add an export of settled tips: date (UTC), txid, block height, amount in XMR, rate, fiat value, currency, rate source, entry. This is the same table as the proposed reconciliation export; build them as one. Label the fiat column "value at the rate locked at checkout (up to 30 minutes before payment)" and add a line under the export: "Not tax advice. Check how your country values crypto income." Notes stay out of the export (they're purged after 30 days anyway). | Plugin (phase 07 tips view) | None, if the export fits an existing route (see question A) | Release 1, phase 07 |
| 1b | Store the price host that answered as `rateSource` on new invoices, so the export can name it. Older invoices show "not recorded". | Plugin, invoice field | None (a field, not an index or collection) | With 1 |
| 2 | **Quiet-host email.** One email when the wallet host has been silent for a set time (default 2 hours), one when it's back. Never more than one of each per outage. Off until the owner turns it on and EmDash has an email provider. | Plugin | Adds `email:send`: a new version and fresh consent | Release 2, bundled with buyer receipts so owners see one consent prompt for both |
| 2b | Until then: a short "Get told when this breaks" line in the install docs, pointing to the dashboard widget and to any uptime checker the owner already uses against the site (no new Coffer surface). | Phase 09 docs | None | Release 1, phase 09 |
| 3 | **Versions on the health list.** One line: bridge version, wallet-rpc version, auto-update on/off. Yellow when auto-update is off and the bridge's daily check found something newer: "Updates are off on your wallet host, and Monero X is out. Run `xmr-bridge update`." Requires the bridge to send its own and wallet-rpc's versions, plus "newer available", in the signed sync. | Plugin and bridge | None (sync body fields, not manifest) | Release 1 if the sync change is small, otherwise release 2. Ties to phase 09's open self-update question |
| 4 | **Recovery sheet.** A "If your wallet host dies" section on the admin page, closed by default, showing only public facts: the shop's primary address (shortened), the bridge key fingerprint, the restore height to use (the block before the first settled invoice, or the install height if none), the highest pool address index (so a rebuilt wallet looks far enough ahead), and the four steps to rebuild and re-pair. A "print this" hint. No view key, no seed. | Plugin text, plus phase 09 docs | None (all values already stored) | Release 1, with spec change 24's text work or phase 07 |
| 5 | **Activity log.** A short list of re-pairs, settings saves, review-queue decisions and test tips, newest first, each with time and which admin did it. Keep the last 100 entries in plugin KV, not a new collection. A re-pair entry gets a "Didn't do this? Re-pair now and check the wallet host" line. | Plugin | None if KV (see question B) | Release 2, or release 1 if A and B come back cheap |

Effect on the admin budget: setup unchanged (nothing here is a setup step; 2 is opt-in). Upkeep better: the owner gets a tax-ready record without rebuilding it, hears about outages, sees when they're behind on updates, and has recovery numbers before they need them.
Effect on the trust contract: none for 1, 1b, 2b, 3, 4 and (if B holds) 5. Part 2 adds `email:send` and must wait for a release that already re-prompts.

Questions for Claude Code to answer before any of this is built (from EmDash 1.1.0 source, as in spec change 23):
- A. **How does the owner get the export out?** Options, cheapest first: (i) a Block Kit code or text block holding CSV the owner copies; (ii) a raw text/csv response from the existing private admin route; (iii) a new private admin route. Say whether (ii) or (iii) changes the consent dialog or anything spec change 22 item 4 freezes. On a phone, (i) is awkward past a few dozen rows; note the limit.
- B. **Can the admin route see who is signed in** (for "which admin" in part 5), and is plugin KV available to a sandboxed plugin without a manifest change? If either is no, say what part 5 can do instead.
- C. **Does `email:send` reach a sandboxed plugin** on EmDash 1.1/1.2 when the site has an `email:deliver` provider (Wyatt's own site uses emdash-smtp)? Proof only, no build.
- D. For part 3: does the bridge's daily update check already know wallet-rpc's latest version when auto-update is off, or does it skip the check?

Spec text to fold in (Wyatt; `docs/spec.md` is not edited here):
- Admin setup and upkeep, Health: add "Versions: bridge, wallet-rpc, auto-update on or off; yellow when updates are off and a newer release is out."
- Tip jar mode: "The tips view shows totals by month, year and all time in XMR and in the site currency at each tip's locked rate, and exports settled tips (date, txid, height, XMR, rate, fiat value, rate source, entry) for bookkeeping. Notes are not exported."
- Admin setup and upkeep: add "Recovery: the admin page keeps the public numbers needed to rebuild a wallet host (primary address, bridge key fingerprint, restore height, highest pool index) with the steps to do it."
- Build plan step 10, Later versions: add "an opt-in email when the wallet host goes quiet and when it's back, shipped with receipts under the same `email:send` consent."

Not proposed (considered and left out): scheduled crypto-to-fiat conversion, or anything that moves funds. It needs spend authority and exchange keys on a server, which breaks "the site holds nothing worth stealing" and "money goes straight to the merchant." The tip record (part 1) and a docs page on converting XMR cover the need without custody.

Answers (Claude Code, 2026-10-15, from the EmDash 1.1.0 source installed in the dev site, and this repo's bridge):
- **A. The export.**
  - **(i) works today.** A Block Kit `code` block holds any string. `@emdash-cms/blocks` (`BLOCK_RESPONSE_LIMITS`) caps each string at 64 KB, the whole admin reply at 256 KB and 2,000 nodes. A CSV row of the proposed columns is about 200 bytes, so one block holds about 300 rows: one block per year, or per month in a busy year, fits. kumo 2.6.0's `CodeBlock` has no copy button, so the owner selects the text by hand: fine on a desktop, awkward on a phone past a few dozen rows.
  - **(ii) isn't possible.** The manifest validator requires the Block Kit `admin` route to be a private POST JSON route (`validateBlockKitAdminRoute`), and the runtime checks every `admin` reply as Block Kit (`validateSandboxedAdminResponse`); anything else becomes a 502 `INVALID_BLOCK_RESPONSE`. Raw replies exist only on routes declared `response: "raw"`.
  - **(iii) is possible but doesn't give a download.**
    - A new private route declared `response: "raw"` can return `text/csv` with `content-disposition` (an allowed header; 8 MB body cap; EmDash adds `nosniff` and a sandbox CSP).
    - EmDash's consent dialog doesn't change: its update gate (`handleRegistryUpdate`) re-prompts only for added capabilities, newly public routes and changed MCP tools. It does change Coffer's frozen route list and spec change 22 item 4 (release 1 ships today's manifest), so it's Wyatt's decision and release 2 at the earliest.
    - It can't be a link the owner clicks: private routes refuse a signed-in session without the `X-EmDash-Request: 1` header (`authorizePrivatePluginRouteRequest`, its CSRF check), so a plain link gets a 403, and Block Kit has no download action. Only an API-token `curl` reaches it, which is an admin step.
  - **Recommendation:** (i), one code block per year with its row count above it.
- **B. Who is signed in, and KV.** Yes to both.
  - A private route's handler gets `user` (id, email, name, role), filled in by the host after its own auth check; no `users:read` needed (`RouteContext.user` in `plugins/types.ts`; the workerd wrapper passes `serializedRequest.user`). It's undefined for an API-token call with no bound user: part 5 would log "an API token" then.
  - `ctx.kv` needs no capability or manifest entry (the sandbox bridge's `kv/*` calls). Coffer already uses it.
- **C. `email:send` from a sandboxed plugin.** Yes, on 1.1.0, when the plugin declares `email:send` and the site has an `email:deliver` provider.
  - The runtime hands `emailPipeline.send` to the sandbox runner (`setEmailSend`); the bridge's `email/send` checks the capability, then the provider, and throws "Email is not configured" without one.
  - A sandboxed send carries the plugin id as its source, so the site's `email:beforeSend` and `email:afterSend` hooks see it (only auth email skips them).
  - From source only, not run live. EmDash 1.2 isn't installed here, so this covers 1.1.0 only.
- **D. The update check with auto-update off.** It skips the check.
  - `startUpdates` (`bridge/cmd/xmr-bridge/update.go`) sets "off (installed with --no-auto-update)" and returns before checking anything.
  - The check is already separate from the install: `monerodl.Fetcher.Latest` fetches and verifies only the signed `hashes.txt`. Part 3 needs a small bridge change (check only, when off) and new signed sync body fields, a change to the spec's API contracts.
  - Also found: there is no `xmr-bridge update` command (the CLI has install, uninstall, version, run, pair, status, notify). Part 3's proposed line names it, and so does today's "Wallet host update available" banner (`plugin/src/admin.ts`). Logged in `docs/progress.md` for phase 09's self-update work.

## 26. The test tip's confirmations  (status: proposed, 2026-10-15)
Found in: phase 05, run A attempt 3 (`~/xmr-pay-dev-data/05-setup/run-A.md`, local), which passed at 13 minutes. Wyatt asked whether the test tip needs 2 confirmations.
Spec says: Admin setup and upkeep, Install flow step 6: "Send a test tip … Setup is done when it settles." Confirmation presets: Under 100 (site currency) is Fast 1, Standard 2, Strict 10; tips use that tier (`requiredConfirmations`). "Nothing is fulfilled at zero confirmations."
Evidence:
- Attempt 3's test tip, from the dev database and the node (UTC):

  | Event | Time | Gap |
  | --- | --- | --- |
  | Test address | 23:18:50 | |
  | Tip in the pool (the page showed Payment seen) | 23:20:00 | |
  | Mined in block 2,230,085 | 23:23:17 | 3 min 17 s in the pool |
  | Block 2,230,086 | 23:28:38 | 5 min 21 s more |
  | Settled | 23:29:01 | 23 s for the next sync |

  - The confirmation wait was 9 of the run's 13 minutes. Coffer's own share was the 23-second sync.
  - With 1 confirmation it would have settled at about 23:23:40: about 8½ minutes in all.
- Block times vary: Monero targets one block every 2 minutes, but the gaps are random. Assuming a steady 2-minute rate, the tip waits more than 9 minutes after it's sent about 1 time in 16 with 2 confirmations, and about 1 time in 90 with 1. Real gaps vary more than that, as attempt 3's 5-minute gap shows.
- The test tip takes its target from the confirmation speed setting. An owner who chooses Strict before testing waits for 10 confirmations, about 20 minutes on average, and goes over the budget every time.
- Nothing is fulfilled on a test tip. It's the owner's own money, from their own second wallet, and it only proves that the wallet host and site see a payment. The checks that follow (seen, mined, counted: `unlockTime` "0" and no double-spend flag, then settled) are the same at 1 confirmation as at 2.

Proposal: the test tip from Get a test address always needs **1 confirmation** (a constant), whatever the speed setting. It's never zero: it still has to be mined and counted. Public tips (phase 07) and orders keep the preset. The waiting line says so: "Payment seen: 0 of 1 confirmation. A test tip needs one; your buyers' payments use your confirmation speed."
Effect on the admin budget: better. The typical wait drops by about one block, and choosing Strict no longer breaks setup.
Effect on the trust contract: none.
Spec text to fold in (Wyatt; `docs/spec.md` is not edited here): Install flow step 6: "Setup is done when it settles, at one confirmation whatever the speed setting (a test tip fulfils nothing)."

## 27. The payments page doesn't update by itself  (status: proposed, 2026-10-15)
Found in: phase 05, run A attempt 3, confusion log at 5:19 MDT (steps 6c and 7). The tester reloaded the page by hand to see Payment seen and then the confirmations. It cost no time, but they expected the page to update on its own.
Spec says: Admin setup and upkeep, Install flow step 4: "The admin page's setup checklist turns green item by item". It doesn't say how.
Evidence (EmDash 1.1.0, from the installed `@emdash-cms/admin` and `@emdash-cms/blocks`):
- A plugin's admin page sends one `page_load` when it opens (a `useEffect` in the Block Kit page renderer) and never again. There's no timer or polling, and the dashboard widget works the same way.
- A reply can carry `blocks` and `toast`. The validator also accepts `refresh`, `navigate` and `patch`, but those are content-editor panel effects: the admin page renderer reads only `blocks` and `toast`. Even `refresh: true` would reload once, not on a schedule.
- Block Kit has no element that refreshes itself.
- A `block_action` reply re-renders the page in place, so a button can refresh the page without a full browser reload.
- A Check again while the install command is on screen would lose the command: it's shown once, and only its hash is stored. So a refresh must not run on that view, or must warn first.

Proposal:
1. **During setup only** (checklist not done), add a line at the bottom of the Setup section: "Checked at HH:MM:SS UTC. This page doesn't update by itself." It goes next to a **Check again** button, a new `block_action` that only re-renders the page.
2. **Not on the pairing-code view.** There the line says "Reload this page after the installer says Done". It mustn't come earlier, because the command would be gone.
3. **After setup,** nothing new. Health's "Last sync" already says how fresh the data is.
4. **An upstream note for EmDash** (draft, for Wyatt to post): "Block Kit admin pages load once. Could a page reply carry an optional `refresh_after_seconds` (with a minimum, paused while the tab is hidden) so a status page can update itself? A plugin waiting on an external event (a payment, a sync) today has to tell the admin to reload."

Effect on the admin budget: none in time. It's clearer while the admin waits, and the setup test's "reload" wording stays as a fallback.
Effect on the trust contract: none (a button on the existing page; no route, page, widget or setting).

## 28. An https remote node breaks wallet creation  (status: accepted, 2026-10-16, items 1 and 3)
Found in: phase 05, run B attempt 1 (`~/xmr-pay-dev-data/05-setup/B1-*`, local).
- The installer paired, then stopped at "Creating the view-only wallet" with `walletrpc: wallet-rpc error 0: .`
- The node was `https://stagenet.xmr.kernal.eu:38089`.
- No service was installed, the pairing code was used up, and the site showed the wallet host as paired.

Spec says:
- Bridge service: a remote node is allowed (spec change 13 adds the cross-check).
- The installer takes an `http` or `https` node URL.

Evidence (the dev box, monero-wallet-rpc v0.18.5.1, the shop wallet view-only in a temporary folder, deleted after; outputs in `05-setup/B1-repro-*.txt`, `B1-ssl-probe.txt`):
- **Reproduced.** `TestLiveShopWallet` with `XMR_BRIDGE_LIVE_NODE=https://stagenet.xmr.kernal.eu:38089` fails at `generate_from_keys` in 1.5 s with the same error. With the local node it passes, and with `http://` on the same host the wallet is created.
- **Cause, from wallet-rpc's log:** `wallet2.cpp:431` throws "Enabling --daemon-ssl requires --daemon-ssl-allow-any-cert or --daemon-ssl-ca-certificates or --daemon-ssl-allowed-fingerprints or use of a .onion/.i2p domain".
  - For an `https` node, the bridge starts wallet-rpc with `--daemon-ssl enabled` and nothing else (`supervise.New`). That means system-CA checking, which the wallet treats as too weak by design.
  - The exception comes from `make_new`, outside `on_generate_from_keys`'s own try blocks, so the generic catch in `wallet_rpc_server.h:148` answers with code 0 and an empty message.
  - Every https node fails this way. kernal.eu is not at fault.
- **The installer's pre-checks passed.** Its own Go client reached the node over https (`noderpc.GetInfo`), so nothing caught this before the pairing code was used.
- **What the wallet accepts** (`TestLiveDaemonSSL`, three cases against kernal.eu):
  1. `--daemon-ssl enabled` alone: the same error 0.
  2. Adding `--daemon-ssl-ca-certificates /etc/ssl/certs/ca-certificates.crt --daemon-ssl-allow-chained`: the wallet is created and rescans over TLS, at the node's height.
  3. The same flags, dialling the node by IP address: also accepted. The certificate names only `*.xmr.kernal.eu` and `xmr.kernal.eu` (checked with `openssl s_client`). So in this mode wallet-rpc checks that the certificate chains to a trusted CA, **not that it was issued for the node's name**.
- **Pinning a fingerprint at install** would break at the next renewal: kernal.eu's certificate expires 2026-11-21. Every renewal would need routine upkeep, so it's out.
- **The site said "Wallet synced" with no wallet.** The pairing request counts as a sync (`plugin/src/sync/handle.ts` stores `lastSyncAt` and the installer's height), so the checklist shows paired and synced for up to 5 minutes (`SILENT_MS`) when nothing is running.

Proposal (Claude's recommendation first):
1. **For an https node, give wallet-rpc the system CA bundle with `--daemon-ssl-allow-chained`.**
   - It's the first bundle that exists of `/etc/ssl/certs/ca-certificates.crt` (Debian, Ubuntu) and `/etc/pki/tls/certs/ca-bundle.crt` (Fedora, RHEL).
   - If there's none, the installer refuses an https node **before pairing**, with a message that says why.
   - This is still TLS, but it doesn't check the name: an attacker on the path with any publicly trusted certificate could stand in for the node. That's no worse than a dishonest node, which spec change 13's cross-check already assumes, and better than plain http, which is allowed today.
   - A security matrix row records the gap, and 07b attacks it.
   - Bridge change, small, tests first. It needs a release rebuild and Wyatt's signature.
2. **Later, if Wyatt wants the name checked:** the bridge forwards wallet-rpc's node traffic through a loopback port. wallet-rpc speaks http to the bridge, and the bridge speaks https to the node, with Go's full checks (system roots and the host name). Standard library only (`net/http/httputil`). It's more code, and the installer's wallet creation would need it too.
3. **Either way, the installer says why wallet-rpc refused.** When wallet-rpc answers with code 0 and no message, the installer quotes the last ERROR line from wallet-rpc's log instead of "error 0".
4. **For triage, not part of this fix:**
   - The pairing-only "Wallet synced": count a pairing request as paired, not as synced (a plugin change).
   - The installer pairs before it creates the wallet (spec change 17), so a failure there always uses up the code. The fix above removes this cause, but any other wallet-rpc failure still costs a new code.

Effect on the admin budget: none for a working setup. Without the fix, every admin who chooses an https node fails setup and needs a new code.
Effect on the trust contract: none (bridge only; the plugin's contract is unchanged).

Decision (Wyatt, 2026-10-16): items 1 and 3 now, then run B is repeated over https. Item 2, the bridge's TLS forwarder that checks the node's name, is **decided before phase 09** (Wyatt, 2026-10-16), with 07b's man-in-the-middle row as evidence. Item 4 goes to triage.
- Built:
  - `supervise.CABundle` and `DefaultCABundles`; an https node gets `--daemon-ssl-ca-certificates <bundle> --daemon-ssl-allow-chained`, and `New` refuses with `ErrNoCABundle` when there's none
  - the installer's node check refuses an https node without a bundle, at the prompt or for `--node`, before pairing
  - `explainWalletRPC` quotes wallet-rpc's last log error (`supervise.LastError`) in place of a bare "error 0"
- Tests: `internal/supervise/ssl_test.go`, `TestHTTPSNodeNeedsACABundle` in `internal/installer`, `cmd/xmr-bridge/explain_test.go`. The live proofs are `TestLiveDaemonSSL` and `TestLiveShopWallet` with `XMR_BRIDGE_LIVE_NODE`.
- Found by the first live run with the fix: `generate_from_keys` over kernal.eu's https takes more than the supervisor client's 5 s. There was no error, the call was just cut off, so run B would have failed again, this time with a timeout.
  - `generate_from_keys` and `open_wallet` now run without the client's timeout, like `rescan_blockchain`. The installer bounds wallet creation at 3 minutes, and the service's open is bounded by the supervisor's 60 s start-up limit.
  - The untimed view now shares the client's digest-auth state. Separate nonce counts collided as soon as `open_wallet` went untimed (`TestOpenCloseAndAddress` caught it). That collision was latent after `rescan_blockchain` too.
  - Test: `TestWalletCallsOutlastTheClientTimeout`.

Matrix note (for `docs/security-matrix.md`; Wyatt copies it into the Claude Doc): "An https remote node: wallet-rpc checks that the node's certificate chains to the system's trusted CAs, but not that it was issued for the node's name (Monero 0.18.5.1, `--daemon-ssl-allow-chained`). An on-path attacker with any publicly trusted certificate can stand in for the node. That gives no more power than a dishonest node, which the remote-node cross-check (spec change 13) is for. 07b (section E) attacks it with a valid certificate for another name. Spec change 28 item 2 (the bridge checks the name) is decided before phase 09."
