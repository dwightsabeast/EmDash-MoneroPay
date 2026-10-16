# Vendored: Project Nayuki's QR Code generator (TypeScript)

| | |
| --- | --- |
| Upstream | https://github.com/nayuki/QR-Code-generator |
| File | `typescript-javascript/qrcodegen.ts` |
| Commit | `3c6d0b3cefb4e049dc337e82237c9644399716a8` (2026-08-31, "Declared the Rust edition being used.") |
| Upstream file SHA-256 | `1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c` |
| Vendored file SHA-256 | `6021d93ffbcd06e094a1014188a1718384279f684b3bcfbced5784c0cf6e356a` |
| License | MIT (`LICENSE`, from upstream's README; the file keeps its own header) |
| Vendored | 2026-10-16, phase 06 (Wyatt's choice in the phase 06 plan) |

## Changes from upstream

Three lines, so the file is an ES module that `src/qr.ts` can import. Nothing else differs:

```diff
-namespace qrcodegen {
+export namespace qrcodegen {
-namespace qrcodegen.QrCode {
+export namespace qrcodegen.QrCode {
-namespace qrcodegen.QrSegment {
+export namespace qrcodegen.QrSegment {
```

`tests/vendor.test.ts` checks both hashes: the vendored file's, and upstream's after undoing these three edits. So any other change fails the tests until this note and the recorded hashes are updated.

## Rules

- Any change to this file is reviewed like our own code (`CLAUDE.md`, "Dependency tiers"), and recorded above.
- An upstream update is a new vendoring: a new commit, both hashes, and the diff reviewed.
- Coffer uses byte mode and one error-correction level (`src/qr.ts`). The rest of the library is unused but kept, so the file stays comparable with upstream.
