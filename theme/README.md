# coffer-astro

Astro components for Coffer, Monero payments for EmDash: the buyer's `/pay/<token>` page and a server-side `isPaid`
helper for gated content. Work in progress (phase 06).

**The package name is a placeholder,** to be decided before phase 09. Until it's published, the dev site installs it
from this folder.

- No runtime npm packages. `astro` and `emdash` are peer dependencies, which every Coffer site already has.
- QR codes are drawn on the server from a vendored copy of Project Nayuki's encoder (`src/vendor/qrcodegen/`, MIT,
  pinned commit and hashes in its `SOURCE.md`).
