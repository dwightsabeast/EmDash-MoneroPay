# @cofferhq/astro

Astro components for Coffer, Monero payments for EmDash: the buyer's `/pay/<token>` page, and a server-side `isPaid`
helper for gated content. Not published yet (phase 09); until then the dev site installs it from this folder.

## The pay page

`src/pages/pay/[token].astro`:

```astro
---
import PayPage from "@cofferhq/astro/PayPage.astro";
import { preparePayPage } from "@cofferhq/astro/page";
const pay = await preparePayPage(Astro, Astro.params.token);
---
<PayPage pay={pay} />
```

`preparePayPage` must run in the page file itself: Astro sends headers and the status code only from there, not from a
component inside the page. It sets the privacy headers (`Cache-Control: private, no-store`, `Referrer-Policy:
no-referrer`, `X-Robots-Tag: noindex`, `nosniff`, and a CSP that allows nothing but the page's own inline script and
style, by hash, same-origin stylesheets and the status route), reads the invoice's status in-process, and answers
200, 404 or 503. Without it, `PayPage` shows no payment details.

The page is a complete HTML document of its own, so a site layout can't add third-party assets to a page whose URL
holds the token. To restyle it, set the `--coffer-*` custom properties in your own stylesheet from the same site:

```astro
<PayPage pay={pay} title="Pay Example Shop">
	<link slot="head" rel="stylesheet" href="/your.css" />
</PayPage>
```

## Gated content

```astro
---
import { isPaid } from "@cofferhq/astro/isPaid";
if (!(await isPaid(Astro, Astro.url.searchParams.get("token")))) return Astro.redirect("/");
---
```

True only once the payment has settled, read on the server. Never trust a flag from the browser.

## What's inside

- No runtime npm packages. `astro` (7) and `emdash` (1.1 or later) are peer dependencies, which every Coffer site has.
- QR codes are drawn on the server as inline SVG from a vendored copy of Project Nayuki's encoder
  (`src/vendor/qrcodegen/`, MIT; pinned commit and hashes in its `SOURCE.md`).
- `@cofferhq/astro/messages`: what a buyer reads when checkout refuses, for the tip and pay buttons.
