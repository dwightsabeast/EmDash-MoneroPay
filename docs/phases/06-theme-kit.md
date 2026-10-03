# Phase 06 — Theme kit

**Goal:** the buyer-facing pieces as an installable package of Astro components: a pay button and the `/pay/[token]` page, one import each.
**Spec sections:** Theme integration (pieces, privacy details, distribution), API contracts (`checkout`, `status`), Commerce readiness (storefront pieces as components).
**Done when:** the dev site uses the package to sell a test product end to end on stagenet; the page meets every privacy rule; the QR code decodes to the exact `monero:` URI in tests; the `installation` snippet for the registry listing is written.

## For Wyatt, before the session

- [ ] Choose the npm package name (for example an unscoped `xmr-pay-astro`, or a scope you own). Publishing it needs an npm account; until then the dev site installs it from the repo folder.
- [ ] Expect a dependency question about QR generation.

**Start the session:**

```text
Phase 06, theme kit. Read docs/phases/06-theme-kit.md and docs/progress.md, then give me your plan.
```

## For Claude

**Package (`theme/`)**

- `PayButton.astro`: "Pay with Monero" for a product entry. Posts `{ kind: "product", product }` to the plugin's `checkout` route (same origin) and redirects to `/pay/<token>`. Domain errors show a short, plain message.
- `PayPage.astro` (used by the site's `src/pages/pay/[token].astro`): fetches `status` server-side, then shows the amount in XMR and fiat, the address with a copy button, a QR code of the `monero:` URI, a countdown to `expiresAt`, a confirmation counter, "Checking for your payment" while `pendingExpiry` is true, and a success state on `settled`. Polls `status` every 5 seconds with a small inline script.
- A server-side helper `isPaid(token)` that returns true only for `settled`, for gated content. Never trust a client-side flag.
- Styling through CSS custom properties so any theme can restyle it; no framework required; works without JavaScript except for polling and copy.

**Privacy rules for `/pay` (all tested)**

- `noindex` robots meta, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`.
- No third-party assets of any kind: fonts, scripts, images or QR services. The QR code is rendered on the server (SVG or PNG) or by bundled code.
- The token appears only in the path and is never logged by the components.

**QR code:** generating QR codes needs a library or a small encoder. Present the options with maintainers and size (a QR bug can't redirect funds to another valid address, but it can make payment impossible). Whatever is chosen, a test decodes the generated QR and compares it byte for byte with the URI.

**Distribution:** `package.json` with exports for the components, a README with the two-line install, and the `installation` section text for the plugin's registry listing (manifest `sections.installation`).

**Tests:** component rendering through Astro's container API (or a dev-site build and HTML checks), headers on the pay page, QR round trip, polling state changes against a fake `status`, the gating helper.

**Stop points:** the package name, any dependency, anything that would need a new plugin route or setting.

**Out of scope:** the tip button (phase 07), store integration (phase 08), publishing to npm (phase 09).
