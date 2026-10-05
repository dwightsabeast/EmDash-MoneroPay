# Phase 08 — Store adapter and the payment contract

**Goal:** make Coffer a payment method any EmDash store can use, and publish the contract so other payment methods can implement it too.
**Spec sections:** Commerce readiness (all), API contracts (`checkout` with `kind: "order"`, `status`), Security model (price manipulation).
**Done when:** `kind: "order"` works and is tested; `contract/` holds the contract doc and a conformance suite that Coffer passes; a DashCommerce adapter works against the dev site on stagenet; an upstream proposal draft is ready for Wyatt to post.

## For Wyatt, before the session

- [ ] Phases 02–07 are done.
- [ ] You decide whether and where to post upstream (DashCommerce issues, EmDash GitHub Discussions). Claude only drafts.

**Start the session:**

```text
Phase 08, store adapter. Read docs/phases/08-store-adapter.md and docs/progress.md, then give me your plan.
```

## For Claude

**Plugin: `kind: "order"`**

- `checkout` accepts `orderRef`, `amountMinor`, `currency`, `description` and `returnUrl`. `status` echoes `orderRef`, `amountMinor` and `currency`, and maps Coffer states to the contract's five statuses (`open`, `processing`, `paid`, `expired`, `needs_review`) with `paidAt`.
- `returnUrl` must be on the site's own origin (no open redirects).
- Currencies the rate source can't price return a domain error. A new error code is a spec change: note it in `docs/spec-changes.md`.
- No webhooks and no shared secret, per the spec. The store confirms by calling `status` on its server and checking `orderRef`, `amountMinor` and `currency` against its own order.
- The consent dialog must not change: no new routes, capabilities or hosts.

**Contract (`contract/`)**

- `contract/README.md`: the payment contract as a short standalone doc (create, get, five statuses, what the store must check, no webhooks, no shared secret, security notes), written so a card, Lightning or bank-transfer method could implement it.
- A conformance suite built from the POC scenarios, runnable against any implementation through an adapter interface; Coffer's adapter runs it in CI.
- The signing test vectors from phase 02 live here too.

**DashCommerce adapter**

- Work in a separate clone at `~/work/dashcommerce` (MIT license), outside this repo. Cloning is fine; pushing or forking on GitHub is Wyatt's. Write the adapter so Monero appears as a payment method, using only the contract. Keep the patch small and self-contained, with tests, ready for Wyatt to open as a pull request.
- If DashCommerce has no payment-method extension point, write the smallest one that would be acceptable upstream and keep it separate from the adapter.

**Upstream proposal:** `docs/upstream-proposal.md`: a payment-method interface for EmDash stores modeled on how `email:deliver` providers work, with the contract as the shape. Wyatt edits and posts it.

**Stop points:** posting anything public; any change to the plugin's trust contract; any dependency.

**Out of scope:** x402 (research only, per the spec).
