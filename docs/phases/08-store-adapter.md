# Phase 08 — Store adapter and the payment contract

**Release 2 (spec change 22).** This phase runs after release 1 (tips) has shipped in phase 09. Pass 2 of the adversarial testing (phase 08b, `07b-adversarial-testing.md`) follows it, then the orders release (09b).

**Goal:** make Coffer a payment method any EmDash store can use, and publish the contract so other payment methods can implement it too.
**Spec sections:** Commerce readiness (all), API contracts (`checkout` with `kind: "order"`, `status`), Security model (price manipulation).
**Done when:** the release-1 switch is on again and product checkout works through `PayButton.astro`; `kind: "order"` works and is tested; `contract/` holds the contract doc and a conformance suite that Coffer passes; a DashCommerce adapter works against the dev site on stagenet; an upstream proposal draft is ready for Wyatt to post.

## For Wyatt, before the session

- [ ] Release 1 is out (phases 05–07, 07b and 09 are done).
- [ ] Talk to the store plugins early, before the contract is fixed, so it fits their payment hooks: Otta (discussion #406) and DinkusKit. You post; Claude drafts.
- [ ] You decide whether and where to post upstream (DashCommerce issues, EmDash GitHub Discussions). Claude only drafts.

**Start the session:**

```text
Phase 08, store adapter. Read docs/phases/08-store-adapter.md and docs/progress.md, then give me your plan.
```

## For Claude

**Design input from the store plugins:** DinkusKit allows only one active payment provider per store, so Coffer may have to be a store's only payment method, or sit behind a provider that offers several. Check the contract against both.

**Plugin: the release-1 switch and the pay button**

- Turn the release-1 switch on (spec change 22): product checkout and the admin page's product parts come back. Phase 07's tests for both positions must still pass.
- `PayButton.astro` (moved from phase 06): "Pay with Monero" for a product entry. Posts `{ kind: "product", product }` to the plugin's `checkout` route (same origin) and redirects to `/pay/<token>`. Domain errors show a short, plain message.
- Release 2's trust contract: release 1 declared today's manifest as is. Anything more this phase needs (for example an `orderRef` index for a store that retries checkout) is a spec change first, then a version bump and the admin's fresh consent.

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
