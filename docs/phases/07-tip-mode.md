# Phase 07 — Tip mode

**Goal:** tips on the same engine: open or suggested amounts, an optional entry reference and note, settling at the dust floor, with per-entry totals for the owner.
**Spec sections:** Tip jar mode (all), API contracts (`checkout` tips), Invoice lifecycle (Tips rule, presets), Theme integration (tip button).
**Done when:** a stagenet tip from the dev site's tip button settles; per-entry totals show in the admin page; tests cover every amount mode and the purge.

## For Wyatt, before the session

- [ ] Phases 02–06 are done.
- [ ] Have opinions ready on: the suggested fiat amounts (for example 3, 5, 10), the note's length limit, and whether the optional public "tips received" count is worth its toggle.

**Start the session:**

```text
Phase 07, tip mode. Read docs/phases/07-tip-mode.md and docs/progress.md, then give me your plan.
```

## For Claude

**Plugin**

- `checkout` accepts `kind: "tip"` with optional `contentRef` (collection and entry id, checked to exist through `ctx.content`), optional `amount` (fiat minor units or XMR atomic units, clearly typed), and optional `note` (plain text, length-limited, control characters stripped).
- No amount: an open tip that settles on any counted amount at or above `minAtomic` (proposed 0.0001 XMR = 10^8 atomic units). With an amount: settles like a product at tolerance.
- Confirmations: the lowest tier of the chosen speed preset.
- Under-dust payments at expiry: the spec doesn't say, and the POC simply expired them. Ask Wyatt; review as underpaid is the cautious choice.
- Notes and buyer data are purged 30 days after the invoice is final, like other buyer data.
- Admin page: a tips view with totals per entry (counted, settled tips only) and recent notes.
- Public tips count: the spec allows an optional count (off by default, never amounts or notes), but showing it to visitors needs either a new public route or another way to read it, plus a fourth setting. Both touch frozen parts (routes, settings). Write it up in `docs/spec-changes.md` and let Wyatt choose between building it that way and dropping it from v1.

**Theme:** `TipButton.astro`, for entry templates: suggested amounts, a custom amount, or "any amount", then the same `/pay` page.

**Tests:** each amount mode, dust floor boundaries, contentRef validation, note sanitizing and length, purge timing, totals excluding unsettled and not-counted transfers.

**Stop points:** the public count; any new setting; any change to the trust contract.

**Out of scope:** per-author tipping, sending funds of any kind (never in scope).
