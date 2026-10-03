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

## 2. Nothing depends on the cron; it stays as a backup  (status: proposed by Wyatt, 2026-10-03)
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

## 3. Make `subaddress` a unique index on `invoices`  (status: proposed by Wyatt, 2026-10-03)
Found in: phase 01, spike Q6 (`spikes/xmr-spike/tests/q6-pool-claims.test.ts`, `scripts/claim-race.mjs`, `evidence/q6-*.txt`)
Spec says: Plugin manifest, storage: `"invoices": { "indexes": ["status", "expiresAt", "subaddress", ["kind", "createdAt"]], "uniqueIndexes": ["token"] }`; Key design decisions: one subaddress per invoice, never reused.
Evidence: `updateIf` claims were correct in all three places (exactly one of 20 claims of one row applied; 20 claim-loop requests on 5 rows made 5 distinct claims), with no errors. But concurrency was not really exercised: the first request won every round, which suggests the runner and SQLite handled the requests one after another. PostgreSQL (where the documented `StorageSerializationError` applies) was not tested.
Proposal: move `subaddress` from `indexes` to `uniqueIndexes` on `invoices`, so the database itself refuses a second invoice with an address already used, whatever happens in the claim path. Checkout treats a unique-index violation as a lost claim and retries within its bounded loop (or returns `NO_ADDRESS_AVAILABLE`).
Effect on the admin budget: none.
Effect on the trust contract: a storage index declaration changes, before the first release, so no installed user has consented to the old one.

## 4. Spam limits must work without a client IP  (status: proposed by Claude, 2026-10-03)
Found in: phase 01, spike Q5 (`spikes/xmr-spike` `echo` route; `evidence/q5-box-trusted-header.txt`, `evidence/q2-q5-pc-round{1,2}.txt`; EmDash source `plugins/request-meta.ts`)
Spec says: Open question 6, "whether `requestMeta` gives the real client IP on public routes … which decides whether per-IP buckets help"; phase 02: "cap on open invoices per hashed client bucket … using `requestMeta` as the spike found it".
Evidence: On a Node site (`astro dev` or built), `requestMeta.ip` is `null` by default, both directly and behind a Cloudflare Tunnel. It becomes the real IP only if the operator sets `EMDASH_TRUSTED_PROXY_HEADERS` (or `trustedProxyHeaders`), and then anyone who can reach the origin without going through the proxy can choose their own IP. On Cloudflare Workers deployments EmDash uses the `cf` object and the IP is real and trustworthy.
Proposal: per-IP buckets apply only when `requestMeta.ip` is non-null. When it is `null`, checkout falls back to a site-wide cap on open (unpaid, unexpired) invoices, sized well below the pool target so the address pool can't be drained by one client, plus the existing short invoice window. No new setting and no request to set an environment variable; the admin page's health panel may say "per-visitor limits off: the site doesn't pass client IPs" as information, not a red line.
Effect on the admin budget: none (deliberately: asking admins to configure trusted proxy headers would add a setup step and, done wrong, a spoofing hole).
Effect on the trust contract: none.
