# Phase 09 — Release

**Goal:** ship v1: a reviewed, signed release of the bridge, the install script on its own host, the plugin in the EmDash registry, the theme package on npm, and a small mainnet tips trial on Wyatt's own site.
**Spec sections:** Build plan step 9, Bridge service (updates, install command), Security model, Open questions 10, 15, 16.
**Done when:** the security review gate passes; a fresh install from the registry, using the published install command, settles a stagenet test tip in under 15 minutes; Wyatt has run a mainnet tips-only trial on his own site.

This phase mixes Claude's work with steps only Wyatt can do. Claude never holds the signing key, never logs in to accounts, and never publishes without Wyatt approving each step.

## For Wyatt

**Accounts and keys (in this order)**

1. **Atmosphere account:** any Bluesky account works. Note its DID; it goes in the manifest's `publisher`.
2. **Release signing key, offline.** Claude prepares a short key ceremony checklist for the scheme chosen in phase 03. You generate the key on a machine that is offline (or a live USB), keep the private key on encrypted media with a backup, and give Claude only the public key. The private key never touches the dev box.
3. **Install host:** a subdomain such as `get.wyattdilley.com` served by Cloudflare Pages or GitHub Pages, set up with a DNS record only, so the live site at wyattdilley.com is untouched.
4. **npm account** for the theme package (if publishing it to npm).
5. **Live site:** before the mainnet trial, snapshot the live site's container. You decide when.

**Start the session:**

```text
Phase 09, release. Read docs/phases/09-release.md and docs/progress.md, then plan the security review first.
```

## For Claude

**1. Security review gate (before anything is published)**

- Walk the spec's Security model table row by row and point to the code and test that covers each threat. Anything uncovered is a blocker.
- Review: signature and freshness checks, pairing, spam limits, money math, the state machine, admin action validation, buyer-data purge, the pay page's privacy headers, the installer's prompts and file permissions, the systemd hardening, download and update verification, and dependency audits (`pnpm audit`, `govulncheck`, with Wyatt's approval to install it).
- Confirm the manifest's trust contract matches the spec exactly, and the bundle is under its caps.
- Write `docs/security-review.md` with findings and fixes. Wyatt decides whether an outside review is needed before mainnet.

**2. Build and sign**

- Reproducible bridge builds for linux amd64 and arm64: `CGO_ENABLED=0`, `-trimpath`, pinned Go version, version stamped from the tag. A script produces the binaries, a checksum file, and the unsigned release manifest.
- Wyatt signs the release manifest offline with the real key and hands back only the signature. Pin the real public key in the bridge (replacing the placeholder), with tests proving that release builds contain neither the placeholder, the dev release key, the `--release-url` dev option, nor the RFC 8032 test keys.
- GitHub Releases hold the binaries, checksums and signatures. Tags and releases are created only after Wyatt approves.

**3. Install host:** (before writing any admin-facing install text, reread `docs/setup-friction.md`) the static `install.sh` for this release, verifying the bridge the way phase 03 decided, published to the install host. Replace the placeholder install URL in the plugin with the real one.

**4. Registry:** set `publisher` to Wyatt's DID, pin `@emdash-cms/plugin-cli` exactly, fill `license`, `author`, `security`, `repo`, and the listing sections (description, installation snippet from phase 06, FAQ, security). Wyatt runs `emdash-plugin login`, then either `emdash-plugin publish` or the delegated GitHub release flow (`release setup`, which needs the public repo). Watch the listing checks with `emdash-plugin info … --watch`.

**5. Theme package:** publish to npm after Wyatt logs in, or document installing from GitHub.

**6. Registry setup test:** repeat phase 05's timed run from the real registry click with the published install command, on stagenet.

**7. Mainnet tips trial (Wyatt decides when):** on wyattdilley.com, after the container snapshot: install from the registry, tips only, a dedicated mainnet shop wallet, Standard or Strict speed, small amounts. Claude prepares a checklist and a rollback plan (uninstall the plugin; the bridge's `uninstall`), and touches nothing on the live site itself.

**Stop points:** every publish, tag, release, login and DNS step; the mainnet trial.
