# Monero Payments POC — findings

Sep 30, 2026, updated after the fixes. Copied from the EmDash project for reference.

The interactive proof of concept of the design spec is `docs/poc/monero-payments-poc.html` (open it in a browser; it is self-contained apart from one QR library loaded from jsDelivr). The same page is published at https://claude.ai/artifact/TsWK9bimrjQpnXfrfPe7Te (version 2, xmr-pay 0.2.0-poc). Its script is extracted to `docs/poc/poc-simulation.js` for reading.

## What it runs

- Plugin core written against a modelled `ctx` (kv, storage, content:read, http with an allowedHosts gate, cron): `checkout`, `status`, `bridge/sync`, `admin`, plus `plugin:install` and the cron sweep.
- Real WebCrypto Ed25519 signing (bridge) and verification (plugin) over `x-xmr-ts + "\n" + rawBody`, the 300 s freshness window and per-invoice `seq` ordering. Falls back to HMAC if the browser lacks Ed25519.
- BigInt atomic-unit math, 99.5% tolerance, confirmation presets, the six-state invoice machine, hashed per-IP buckets, the address pool and watch list.
- Simulated: monerod (2-minute blocks, reorgs, reorgs that double-spend, dropped mempool txs), view-only wallet-rpc returning height, timestamp, double_spend_seen and unlock_time, the buyer's wallet, and the two price APIs.

Scenarios that pass: pay in full, pay in two parts, underpay at expiry (review/underpaid), pay after expiry (review/late), reorg after settling (stays settled, re-confirms, no alert), payment reversed (review/reversed + alert), bridge outage across expiry (waits, then settles as on time), speed change mid-invoice (target stays locked), and a tip.

Attacks that are rejected: time-locked funds (not counted), mempool double-spend (not counted), replayed syncs (fresh replay accepted but ignored by `seq`; old replay STALE_TIMESTAMP), forged sync (BAD_SIGNATURE), tampered body (BAD_SIGNATURE), client-sent price (ignored), plugin calling wallet-rpc (HOST_NOT_ALLOWED), checkout spam (TOO_MANY_OPEN after 5 per hashed IP).

Also checked by forcing it: a reorged payment that is not mined again within 5 blocks moves to review/reorg with an alert.

## Gaps the POC found, and how they were fixed

All three are fixed in the spec and in the POC.

1. **Reorg after settlement couldn't be seen.** Settled invoices fell off the watch list.
   Fix: settled invoices stay watched until the payment is 10 confirmations deep. A payment that is still in the mempool or chain after a reorg keeps the invoice settled and marked re-confirming, with no alert; if it isn't mined again within 5 blocks → review (reorg) + alert. A payment that is gone → review (reversed) + alert at once.
2. **Bridge outage across expiry turned on-time payments into "late".** The plugin judged lateness by when it first heard of a transfer.
   Fix: expire on evidence (only after a sync from after `expiresAt` has covered the invoice; until then `pendingExpiry`, and the pay page says it is checking). Lateness is judged by: the plugin saw it before expiry; else the wallet's timestamp from the first unmined report; else block height ≤ `expiresHeight` (height at checkout + 15 + 3 grace). The bridge passes `height`, `timestamp`, `doubleSpendSeen`, `unlockTime` through from `get_transfers`. An expired invoice whose payment proves to be on time reopens.
3. **The confirmation target moved with the settings.**
   Fix: `required` is stored on the invoice at checkout; settings changes affect new invoices only; an admin can raise (never lower) it on one open invoice.

Related fix added at the same time: transfers with a non-zero `unlockTime` or flagged `doubleSpendSeen` are never counted.

## Still open

- Which wallet-rpc field (`unlock_time` or `locked`) reliably marks a buyer-set time lock: confirm on stagenet (spec open question 11).
- New tunables: 10-block final depth, 5-block re-mine allowance, 3-block expiry grace (spec open question 9).

Demo-only choices: invoices store the product title for the admin table; address pool target is 10 instead of 50; under-dust tips just expire rather than going to review.
