# EmDash CMS — Consolidated Knowledge Base (AI-Optimized)

> **What this is:** A single-file, LLM-friendly distillation of the complete EmDash documentation site
> (https://docs.emdashcms.com — all 90 indexed pages plus the unindexed plugin testing page, 91 total; index at https://docs.emdashcms.com/llms.txt).
> Compiled 2026-09-30 against the EmDash 1.0 documentation. Prose is rewritten and condensed;
> identifiers, commands, config keys, package names, routes, and hook names are preserved exactly.
> Each section carries its canonical source URL — treat the live page as authoritative if anything conflicts.

## How to use this document

- **Loading into an AI assistant:** paste the whole file as context, or use it alongside the live docs MCP server
  (`https://docs.emdashcms.com/mcp`, tool `search_docs`) and the agent skills (`npx skills add emdash-cms/skills`).
- **Structure:** Part 0 is a dense quick-reference. Parts 1–11 follow the docs site's own sections
  (Start Here → Coming From → Guides → Plugins → Migration → Plugin Development → Contributing → Themes →
  Deployment → Concepts → Reference). Every subsection begins with `Source:` so a reader can verify.
- **Conventions:** `code` = exact identifier. Tables summarize options. "→" means "maps to / replaced by".
  Anything marked *(gotcha)* is a documented failure mode or footgun.

# Part 0 — Quick Reference

## What EmDash is (one paragraph)

EmDash is an Astro-native CMS: the admin panel (React SPA at `/_emdash/admin/`), REST API (`/_emdash/api/*`), MCP server (`/_emdash/api/mcp`), and your public Astro pages run as **one server-rendered Astro application** sharing one SQL database and one media store. The content model (collections + fields) lives **in the database** and is edited in the admin (or seeded once at setup); per-collection tables (`ec_<slug>`) get real columns per field. Content is read at request time through Astro Live Content Collections (`getEmDashCollection` / `getEmDashEntry`). Rich text is Portable Text (TipTap editor). Auth is passkey-first. Plugins come in two formats: **sandboxed** (isolated, registry-installable, Block Kit UI) and **native** (npm, in-process, React/Astro components).

## Minimal working config

```js
// astro.config.mjs (Node)
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), emdash({
    database: sqlite({ url: "file:./data.db" }),
    storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
    siteUrl: "https://cms.example.com",   // required for setup on non-loopback hosts
  })],
});
```
```js
// astro.config.mjs (Cloudflare) — bindings DB, MEDIA, LOADER in wrangler.jsonc; src/worker.ts exports PluginBridge + scheduled
import cloudflare from "@astrojs/cloudflare";
import { d1, r2, sandbox, kvCache } from "@emdash-cms/cloudflare";
emdash({ database: d1({ binding: "DB" }), storage: r2({ binding: "MEDIA" }), sandboxRunner: sandbox(), objectCache: kvCache({ binding: "CACHE" }) })
```
```ts
// src/live.config.ts
import { defineLiveCollection } from "astro:content";
import { emdashLoader } from "emdash/runtime";
export const collections = { _emdash: defineLiveCollection({ loader: emdashLoader() }) };
```

## Packages and entry points

| Import | Provides |
| --- | --- |
| `emdash` | `getEmDashCollection`, `getEmDashEntry`, `getEmDashReferences`, `getTranslations`, `resolveEmDashPath`, `decodeSlug`, `slugify`, `sanitizeHref`, `isSafeHref`, `getSiteSettings`, `getSiteSetting`, `getSeoMeta`, `getContentSeo`, `getHreflangAlternates`, `getMenu`, `getMenus`, `getWidgetArea(s)`, `getSection(s)`, `getTaxonomyTerms`, `getTerm`, `getEntryTerms`, `getEntriesByTerm`, `getTermsForEntries`, `getAllTermsForEntries`, `getTaxonomyDef(s)`, `getByline`, `getBylineBySlug`, `getEntriesByByline`, `getComments`, `getCommentCount`, `search`, `getPreviewUrl`, `buildPreviewUrl`, `generatePreviewToken`, `verifyPreviewToken`, `parseContentId`, `isPreviewRequest`, `getPreviewToken`, `getEditMeta`, `*WithCacheHint` variants, `definePlugin`, `definePluginRoute`, `pluginResponse`, `ContentSaveRejectedError`, `StorageSerializationError`, types (`PortableTextBlock`, `StorageCollection`, `FieldType`, `PluginDescriptor`, `PluginAdminExports`) |
| `emdash/astro` | `emdash()` integration (default), `local`, `s3`, `memoryCache` |
| `emdash/db` | `sqlite`, `libsql`, `postgres` |
| `emdash/runtime` | `emdashLoader` |
| `emdash/ui` | `Image`, `PortableText`, `WidgetArea`, `Blocks`, `defineBlockComponents`, `EmDashHead`, `EmDashBodyStart`, `EmDashBodyEnd`, `WebMcpSearch`, `Comments`, `CommentForm` |
| `emdash/ui/search` | `LiveSearch` (default export) |
| `emdash/page` | `createPublicPageContext` |
| `emdash/middleware` | `withEmDashRuntime` |
| `emdash/plugin` | type-only `SandboxedPlugin`, `PluginContext`, event types; runtime `pluginRoute`, `pluginResponse` |
| `emdash/plugin-utils` | `apiFetch`, `parseApiResponse` (native React admin) |
| `emdash/seed` | `applySeed`, `validateSeed`, `SeedFile`, `SeedApplyOptions` |
| `emdash/auth/providers/github` · `/google` · `/microsoft` | login providers |
| `@emdash-cms/cloudflare` | `d1`, `hyperdrive`, `durableObjects`, `previewDatabase`, `playgroundDatabase`, `r2`, `kvCache`, `access`, `sandbox`, `cloudflareImages`, `cloudflareStream`; `/worker` (`handler`, `createScheduledHandler`, `PluginBridge`), `/plugins` (`cloudflareEmail`, `aiSearch`) |
| `@emdash-cms/auth-atproto` | `atproto()` Atmosphere login |
| `@emdash-cms/x402` | paywall helpers |
| `@emdash-cms/sandbox-workerd` (+ `workerd`) | Node sandbox runner `"@emdash-cms/sandbox-workerd/sandbox"` |
| `@emdash-cms/plugin-cli` | `emdash-plugin` binary (sandboxed plugin toolchain) |
| `@emdash-cms/plugin-test` | `createPluginTestHost`, `createPluginRuntimeTestHost`, `/config` → `emdashPluginTest()` |
| `@emdash-cms/blocks` | Block Kit `blocks`/`elements` builders, `BlockResponse` type |
| `@emdash-cms/registry-client` (+ `/discovery`, `/withdrawal`, `/env`), `@emdash-cms/registry-loader` | registry discovery |
| `@emdash-cms/admin` | native admin extension types (`ContentEditorPanelExtension`, `ContentListColumnExtension`, …) |
| First-party plugins | `@emdash-cms/plugin-field-kit`, `@emdash-cms/plugin-audit-log`, `@emdash-cms/plugin-webhook-notifier`, `@emdash-cms/plugin-atproto`, `emdash-smtp` |
| Templates | `@emdash-cms/template-{blank,starter,blog,portfolio,marketing}` (+ `-cloudflare` variants) |

## Routes and URLs

`/_emdash/admin/` (admin, setup wizard on first visit, login at `/_emdash/admin/login`) · `/_emdash/api/openapi.json` · `/_emdash/api/content/{collection}[/{id}[/publish|unpublish|schedule|duplicate|restore|permanent|compare|discard-draft|lock|translations|terms/{tax}]]` · `/_emdash/api/media[/{id}[/usage|replace|confirm|upload]|/upload-url|/folders|/file/…]` · `/_emdash/api/schema/{collections,block-types,orphans}` · `/_emdash/api/{taxonomies,menus,sections,widget-areas,settings,search,redirects,comments}` · `/_emdash/api/admin/{users,allowed-domains,comments,media-usage,transfer}` · `/_emdash/api/plugins/<slug>/<route>` · `/_emdash/api/mcp` · `/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` (dev only) · `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server/_emdash`.

## Environment variables (most common)

`EMDASH_SITE_URL` (→ `SITE_URL`) · `EMDASH_ALLOWED_ORIGINS` · `EMDASH_ENCRYPTION_KEY` (`npx emdash secrets generate`; comma-separated for rotation) · `EMDASH_PREVIEW_SECRET` · `EMDASH_IP_SALT` (legacy `EMDASH_AUTH_SECRET`) · `EMDASH_TURNSTILE_SECRET_KEY` · `EMDASH_OAUTH_{GITHUB,GOOGLE,MICROSOFT}_CLIENT_ID/SECRET` (+ `_MICROSOFT_TENANT_ID`) · `CF_ACCESS_AUDIENCE` · `S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/PUBLIC_URL` · `DATABASE_URL` / `DATABASE_PATH` / `EMDASH_DATABASE_URL` · `LIBSQL_DATABASE_URL`, `LIBSQL_AUTH_TOKEN`, `TURSO_AUTH_TOKEN` · `EMDASH_MIGRATIONS_MODE` · `EMDASH_TRUSTED_PROXY_HEADERS` · `EMDASH_TOKEN`, `EMDASH_URL`, `EMDASH_HEADERS` (CLI) · `EMDASH_WORKERD_PASSTHROUGH_ENV` · `EMDASH_PSEUDO_LOCALE` (dev) · `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `EMDASH_TARGET_FINGERPRINT` (migrations CI) · `EMDASH_REGISTRY_URL`, `EMDASH_LABELER_URL`, `EMDASH_PUBLISHER_DID/HANDLE/PDS` (plugin CLI).

## Roles and key permissions

Roles: Subscriber (10) < Contributor (20) < Author (30) < Editor (40) < Admin (50). Permissions look like `content:edit_own` / `content:edit_any`, `content:publish_own` / `content:publish_any`, `content:delete_own` / `content:delete_any`, `content:delete_permanent`, `content:read_drafts`, `content:create`, `plugins:read` / `plugins:manage`, `schema:manage`, `media:read`, `transfer:export` / `transfer:import`. Token scopes: `content:read`, `content:write`, `media:read`, `media:write`, `schema:read`, `schema:write`, `taxonomies:manage`, `menus:manage`, `settings:read`, `settings:manage`, `mcp:tools[:<pluginId>]`, `transfer:{export,analyze,execute}`, `admin`.

## Field types (17)

`string`, `text`, `url`, `slug`, `number`, `integer`, `boolean`, `datetime`, `select`, `multiSelect`, `portableText`, `json`, `repeater`, `blocks`, `image`, `file`, `reference`. Indexable: `string`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `reference` (unbound only), `slug`. Reserved slugs: `id`, `slug`, `status`, `author_id`, `primary_byline_id`, `created_at`, `updated_at`, `published_at`, `scheduled_at`, `deleted_at`, `version`, `live_revision_id`, `draft_revision_id`, `terms`, `bylines`, `byline`.

## Content lifecycle in one line

`draft` ⇄ `scheduled` → `published` (publish promotes the draft revision to live; a published entry can carry a new draft + schedule); unpublish → draft (keeps `publishedAt`); trash is orthogonal; restore → draft; permanent delete is irreversible. Reads return `_rev`; pass it back on writes (optional REST, required CLI/MCP; stale → `CONFLICT`). Edit locks (7 min) → `ENTRY_LOCKED` (`overrideLock`).

## Plugin quick facts

- **Sandboxed:** `emdash-plugin.jsonc` (slug, publisher DID, license, author, security, capabilities, allowedHosts, storage, admin) + `src/plugin.ts` (`const plugin: SandboxedPlugin = { hooks, routes, mcp }; export default plugin`). Hooks `(event, ctx)`, routes `(routeCtx, ctx)`. Build/publish with `emdash-plugin`. UI = Block Kit via a private `admin` route. Needs a runner: `sandbox()` (Cloudflare Paid + `LOADER` + `PluginBridge`) or `@emdash-cms/sandbox-workerd/sandbox` (Node). D1-only bridge (no Hyperdrive). Limits: 50 ms CPU / 10 subrequests / 30 s wall (CF); 30 s wall (Node).
- **Native:** npm package exporting a descriptor factory (`{ id, version, format: "native", entrypoint, options, adminEntry?, componentsEntry? }`) **and** `createPlugin()` → `definePlugin({...})`. Register in `plugins: []`. Routes take one `ctx`. Only way to ship React admin, Portable Text renderers (`componentsEntry`/`blockComponents`), `page:fragments`.
- **Capabilities:** `content:read|write|publish|restore|revisions:read`, `comments:read|moderate`, `schema:read`, `taxonomies:read|write`, `bylines:read`, `redirects:read|write`, `media:read|bytes:read|metadata:write|write`, `network:request[:unrestricted]`, `users:read`, `email:send`, `hooks.content-policy:register`, `hooks.email-transport:register`, `hooks.email-events:register`, `hooks.page-fragments:register`, `admin.editor-draft:read|patch`.

## Most-cited gotchas

1. `react()` missing from integrations → admin stuck on "Loading EmDash…".
2. Scheduled publishing on Cloudflare needs **both** a Cron Trigger and the exported `scheduled` handler (`emdash doctor` checks); local dev uses a timer so local success proves nothing.
3. A changed seed does **nothing** against an existing database — evolve live schema in the admin / `emdash schema`, then `export-seed` to keep the repo baseline fresh.
4. `EMDASH_ENCRYPTION_KEY` is not in DB backups; losing it makes encrypted plugin settings unreadable. Never read secrets via `import.meta.env`.
5. Hyperdrive primary binding must have **query caching disabled**; D1 `session` modes hang with `global_fetch_strictly_public`.
6. Reference fields store nothing in `data` — read `entry.references[field]` and request them via `getEmDashEntry(…, { references })`.
7. `orderBy: { published_at: "desc" }` — never `sort`/`sortBy`/callbacks; `cursor` and `offset` are mutually exclusive.
8. `post.id` = route identifier (slug); `post.data.id` = database ID (use for comments, taxonomy helpers, visual editing context).
9. Public plugin routes skip auth but not cross-origin browser protection; private routes need `X-EmDash-Request: 1` on every method for cookie auth.
10. Workers Cache serves cached anonymous HTML to editors (no toolbar) — use `toolbar: "client"`; responses without `Cache-Control` are heuristically cached ~2 h.
11. Trust-contract changes (capabilities, hosts, storage indexes) need a new plugin version; broadening → major. Native capability additions have no consent re-prompt → treat as major.
12. Deleting a field/collection drops the column/table — JSON export can't restore; back up first and rehearse on a preview DB.
13. Node standalone server does not load `.env` (`node --env-file=.env …`); Wrangler reads `.dev.vars` **or** `.env`, never both.
14. PostgreSQL needs one stable owner role for all EmDash objects; swapping the connection user → `must be owner of table`.
15. Core migrations are forward-only with no undo — back up DB + artifact together before applying.


---

# Part 1 — Start Here

## 1.1 Create your first EmDash site (tutorial)

Source: https://docs.emdashcms.com/getting-started/

**Goal:** scaffold a Node.js + SQLite + local-media site from the Starter template, complete the setup wizard, publish one edit. No cloud account needed.

**Prerequisites**
- Node.js **22.16 or later** and npm (`node --version` must print `v22.16.0`+).
- For an existing Astro site, use §1.2 instead.

**Scaffold**
```bash
npm create emdash@latest        # pnpm create emdash / yarn create emdash / bun create emdash also work
```
Prompts and the tutorial's answers:

| Prompt | Tutorial value | Notes |
| --- | --- | --- |
| Project name | `my-emdash-site` | |
| Where will you deploy? | **Node.js** | Cloudflare is the other main target |
| Which template? | **Starter** | General-purpose site with Posts and Pages |
| Which package manager? | detected from the create command | |
| Install dependencies? | **Yes** | If install fails, project files remain; run the retry command the scaffolder prints |

The scaffolder writes a generated `EMDASH_ENCRYPTION_KEY` into a gitignored `.env`.
*(gotcha)* Never commit `.env`; back the key up before deploying — plugin secrets stored in the DB cannot be decrypted without it.

```bash
cd my-emdash-site
npm run dev      # Astro prints the local URL, normally http://localhost:4321/
```

**Setup wizard** — open `http://localhost:4321/_emdash/admin/` (a fresh site redirects there):
1. Site Title + optional Tagline; keep **Include sample content** checked (adds the template's Welcome post and About page) → Continue.
2. Your Email + optional Your Name → Continue.
3. Register a **passkey** when the browser prompts → **Open the dashboard**.

The wizard applies the Starter template's content model + sample content to the local SQLite DB. Dashboard shows Posts and Pages.

**Publish an edit** — Posts → Welcome → change title → **Save** (creates a draft revision) → **Publish changes** (draft becomes the version visitors see). Reload `http://localhost:4321/` to see it; the home page calls `getEmDashCollection("posts")` at render time.

**How the generated project is wired (3 integration points)**

| File | Role |
| --- | --- |
| `astro.config.mjs` | `output: "server"`, Node adapter, `react()` (needed for the admin UI), `emdash({...})` with a SQLite database + a local uploads directory |
| `src/live.config.ts` | Connects the DB-backed content to Astro **Live Content Collections** |
| `seed/seed.json` | Defines Posts/Pages collections, their fields, and the sample content the wizard applied |
| `emdash-env.d.ts` | Auto-regenerated during dev from the current model so TypeScript can check collection names/fields — do not hand-edit |
| `.env` | Supplies the encryption key at runtime; separate from the SQLite file holding model + content |

Canonical home-page query shape:
```astro
---
import { getEmDashCollection } from "emdash";
const { entries: posts, cacheHint } = await getEmDashCollection("posts", {
  orderBy: { published_at: "desc" },
});
if (Astro.cache?.enabled) Astro.cache.set(cacheHint);
---
<ul>{posts.map((post) => <li>{post.data.title}</li>)}</ul>
```

Next: §10.1 Architecture, §3.3 Querying, §9.1/§9.2 Deployment, §3.4 Media library.

## 1.2 Add EmDash to an existing Astro project

Source: https://docs.emdashcms.com/existing-project/

**Requirements:** Astro **6+**, Node **22.16+** (`node --version`, `npx astro --version`). The guide switches the site to `output: "server"` with the Node adapter. *(gotcha)* If you already use another server adapter (e.g. Cloudflare), do **not** add a second one — keep yours and follow its deployment guide (§9.1 for Cloudflare). Commit before changing config.

**Install (5 packages)**
```bash
npm install emdash @astrojs/node @astrojs/react react react-dom
```
React is mandatory for the admin panel even when the public site has zero React components.

**`astro.config.mjs`** (merge into existing integrations/settings):
```js
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: "file:./data.db" }),
      storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
    }),
  ],
});
```
- `data.db` holds content **and** the content model; `uploads/` holds media served through EmDash's media route. Add both to `.gitignore`.

**`src/live.config.ts`** (add the `_emdash` key if the file already exists; `src/content.config.ts` for file-based collections keeps working alongside it):
```ts
import { defineLiveCollection } from "astro:content";
import { emdashLoader } from "emdash/runtime";
export const collections = {
  _emdash: defineLiveCollection({ loader: emdashLoader() }),
};
```

**Encryption key**
```bash
npx emdash secrets generate --write .env
```
Protects plugin secrets at rest; losing/replacing it makes encrypted values unreadable → keep a protected backup.

**First run:** `npm run dev` → `http://localhost:4321/_emdash/admin/` → setup wizard (site details, admin account, passkey). With no seed file, setup applies EmDash's **built-in default model**: `posts` and `pages` collections with Title + content fields, plus `category` and `tag` taxonomies. No sample entries.

**Verify** with a server-rendered test page:
```astro
---
import { getEmDashCollection } from "emdash";
const { entries: posts, error } = await getEmDashCollection("posts");
if (error) throw error;
---
<ul>{posts.map((post) => <li>{post.data.title}</li>)}</ul>
```

**Troubleshooting matrix**

| Symptom | Cause / fix |
| --- | --- |
| Admin stuck on "Loading EmDash…" | `react()` not in `integrations` (installing `@astrojs/react` alone is insufficient) |
| `getEmDashCollection()` errors about the live collection | `src/live.config.ts` must export `_emdash` using `emdashLoader()` |
| Works in dev, deployed edits don't appear | Page is prerendered or deployment isn't server output |
| Build can't resolve an import | Packages landed in another workspace dir — rerun install in this project |

## 1.3 Upgrade to EmDash 1.0

Source: https://docs.emdashcms.com/upgrade-to-v1/

1.0 removes APIs deprecated during 0.x and moves EmDash-internal entry points under `emdash/internal/`.

**Upgrade**
```bash
pnpm up --latest emdash @emdash-cms/cloudflare   # add any other EmDash packages you use
pnpm build
```
If deployment runs `emdash migrate`, run it against the `.emdash/migrations.json` produced by a **post-upgrade** build — the command rejects manifests written by earlier versions. Per-package changelogs: https://github.com/emdash-cms/emdash/releases

**Breaking changes**

| Change | Before | After / action |
| --- | --- | --- |
| `cloudflareCache()` removed (incl. `@emdash-cms/cloudflare/cache` and `/cache/config`) | Route-cache provider purging via Cloudflare REST API | `cache: { provider: cacheCloudflare() }` from `@astrojs/cloudflare/cache` (Workers Cache). Purge uses `cache.purge()` from `cloudflare:workers`, so `CF_ZONE_ID` / `CF_CACHE_PURGE_TOKEN` secrets can be deleted. KV object cache `kvCache()` is unchanged. |
| `Comments` / `CommentForm` no longer exported from `emdash/ui` | `import { Comments, CommentForm } from "emdash/ui"` | `import { Comments, CommentForm } from "emdash/ui/comments"` — components themselves unchanged |
| `emdash dev` and `emdash auth secret` removed | `emdash dev` ran a server on `./data.db`; `emdash auth secret` produced `EMDASH_AUTH_SECRET` | Use your site's dev script / `astro dev`. Delete any `url` key under `emdash` in `package.json`; for remote types use `emdash types --url <site-url>` or `EMDASH_URL`. Keep an existing `EMDASH_AUTH_SECRET` (still read so stored commenter IP hashes stay stable). For plugin-secret encryption use `emdash secrets generate`. |
| `experimental.registry` removed (and `experimental` itself) | `emdash({ experimental: { registry: {...} } })` | Move unchanged to top-level `registry` (URL string or object such as `{ aggregatorUrl, policy: { minimumReleaseAge: "48h" } }`). Delete empty `experimental: {}` (TS error). Startup error names the top-level option. |
| Internal entry points relocated | `emdash/routes/*`, `emdash/middleware/*`, `emdash/db/sqlite-migrations`, `emdash/plugin-test-runtime`; Cloudflare D1/Hyperdrive migration executors | Now under `emdash/internal/` and `@emdash-cms/cloudflare/internal/db/` — **not public API**, may change any release. Public replacements: `sqlite()`/`libsql()`/`postgres()` from `emdash/db`; `memoryCache()` from `emdash/astro`; `localMedia()` from `emdash/media`; `@emdash-cms/plugin-test` for plugin tests; `middleware.outer` option of `emdash()` to run your middleware before EmDash's. Internal auth/setup/redirect/request-context middleware have no public replacement. |

**Deprecated (still works through 1.x, warns at startup):** old plugin capability names such as `read:content`, `network:fetch`, `page:inject`. Warning lists the replacement (e.g. `read:content → content:read`). Update the plugin's manifest to current names (§6.10).

## 1.4 Why EmDash (evaluation)

Source: https://docs.emdashcms.com/why-emdash/

**Model in one paragraph:** EmDash is a CMS for Astro that serves an editor-facing admin panel from the *same application* as the public site. Editors save entries to the configured database; Astro pages call EmDash query functions at render time via Astro's **Live Content Collections**, so a server-rendered page shows a published edit on its next request (a prerendered page stays static until rebuilt). Astro components own HTML/design; EmDash owns structured content. It is **not** a visual page builder.

**Good fit when all are true:** the site is Astro; editors need to manage content without touching the repo; the team wants CMS + site in one app/deployment; the team can operate a database and media storage. Typical cases: agency sites handed to client editors, small-team Astro sites, WordPress migrations with an Astro rebuild.

**Not a fit when:** the project isn't Astro; all content must live in source control; several unrelated frontends need an independently deployed CMS. Operational cost: your team owns the DB, media storage, backups, upgrades, and the admin-serving app. EmDash does not run PHP, WordPress themes, or WordPress plugins (it can import WP content).

**Roles**
- *Editors* — admin forms generated from collections/fields; drafts, publishing, media, taxonomies, menus, widget areas (per permissions).
- *Developers* — Astro pages/layouts/components; query functions return entries, errors, pagination info, and cache hints.
- *Administrators* — can add collections/fields in the admin at runtime; developers can export the model as a seed file and generate TS declarations. Declarations reflect the model at generation time: dev mode auto-refreshes `emdash-env.d.ts`; other `emdash types` workflows must regenerate after schema changes.

**Comparison of Astro content sources**

| Decision | EmDash | File-based Astro collection | Separate headless CMS |
| --- | --- | --- | --- |
| Where editors work | Admin panel inside the Astro app | Repo files + dev tools | Vendor UI / separately run admin |
| When content loads | On request (server-rendered) | Dev/build time | Build or request, over a network API |
| Where the model lives | EmDash database (admin or CLI) | Repo source code | CMS configuration |
| What you operate | Astro app + DB + media storage | Astro app + build pipeline | Astro app + the CMS service/account |
| Release coupling | Admin and frontend deploy together | Content and frontend usually build together | Independent deploys |

**Hosting shapes:** Cloudflare Workers (D1 content, R2 media) or Node.js (SQLite / libSQL / PostgreSQL content; local filesystem or S3-compatible media).

**Schema changes touch data** *(gotcha)*: adding a field keeps entries (new field empty until filled); deleting a field wipes that field's values from every entry; deleting a collection deletes all its entries; most field-type changes require a planned content migration. Back up production and rehearse destructive changes.

**Plugins:** two trust boundaries — *native* plugins run inside the host with its full access; *standard/sandboxed* plugins can run in an isolated runtime when a sandbox runner is configured and capabilities are granted (§6.1).

## 1.5 Docs MCP for AI tools

Source: https://docs.emdashcms.com/docs-mcp/

- Public, read-only, **no auth** Model Context Protocol server: `https://docs.emdashcms.com/mcp`. Backed by Cloudflare AI Search over an index of docs.emdashcms.com.
- Single tool: `search_docs` — returns relevant chunks with source URLs and match scores.
- **Distinct from your site's MCP server** (`/_emdash/api/mcp`, §3.18 / §11.8), which reads and writes your content. The docs MCP only knows the documentation.
- Templates created via `npm create emdash` already ship config for auto-discovery: `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), `.vscode/mcp.json` (VS Code) — accept the workspace-trust prompt on first run.

Manual setup snippets:
```bash
codex mcp add emdash-docs --url https://docs.emdashcms.com/mcp     # Codex CLI / ChatGPT desktop share config
```
```jsonc
// .mcp.json (Claude Code, Cursor)          // OpenCode uses "mcp": { "emdash-docs": { "type": "remote", "url": ... } }
{ "mcpServers": { "emdash-docs": { "type": "http", "url": "https://docs.emdashcms.com/mcp" } } }
// VS Code uses top-level "servers": { "emdash-docs": { "type": "http", "url": ... } }
```
- Suggested `AGENTS.md` / `CLAUDE.md` / `.cursorrules` instruction (templates include it): look up EmDash APIs, hooks, config options, and patterns via the `emdash-docs` MCP server and prefer it over training-data assumptions.
- Privacy: queries are sent to docs.emdashcms.com and processed by Cloudflare AI Search — never include private code, secrets, or user data.

## 1.6 Agent Skills

Source: https://docs.emdashcms.com/agent-skills/

EmDash publishes agent skills (folders of instructions + reference material an assistant loads on demand) at https://github.com/emdash-cms/skills, refreshed with each release. Source of truth for issues/PRs is the `skills/` folder of the main repo (https://github.com/emdash-cms/emdash/tree/main/skills); the skills repo itself does not accept them.

| Skill | Covers |
| --- | --- |
| `building-emdash-site` | Schema/seed files, content queries, Portable Text, menus, taxonomies, deployment |
| `creating-plugins` | Sandboxed and native plugins: hooks, routes, storage, admin UI |
| `emdash-cli` | Managing a site from the command line |
| `wordpress-theme-to-emdash` | Porting a WP theme (requires the first two skills) |
| `wordpress-plugin-to-emdash` | Porting WP plugin behavior (requires the first two skills) |

- Templates from `npm create emdash` include the first three in `.agents/skills/` (with a `.claude/skills` link to the same folder); a plugin scaffolded by the plugin CLI's `init` includes `creating-plugins`. These copies are pinned to the version at creation time.
- Install/update anywhere: `npx skills add emdash-cms/skills` (`--skill <name>` to preselect, `-g` for user-level). Works with Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, etc.
- Claude Code plugin route: `/plugin install emdash@emdash` → skills appear as `emdash:building-emdash-site` etc.; update with `/plugin marketplace update emdash` or enable auto-update for the `emdash` marketplace.

---

# Part 2 — Coming From WordPress / Astro

## 2.1 EmDash for WordPress developers

Source: https://docs.emdashcms.com/coming-from/wordpress/

What stays: named content types, structured fields, draft/published states, hierarchical categories, flat tags, nested menus, media, revision history. What changes: PHP template hierarchy → explicit Astro routes; template parts → imported components; code deploys separately from DB content; React is **not** required for the public site.

**Concept map**

| WordPress | EmDash / Astro |
| --- | --- |
| Post type | Collection |
| Post meta | Collection field |
| Category / tag | Taxonomy |
| `WP_Query` | `getEmDashCollection()` |
| `get_post()` | `getEmDashEntry()` |
| `the_content()` | `<PortableText />` |
| Template hierarchy | Files in `src/pages/` |
| Template part | Imported `.astro` component |
| `header.php` / `footer.php` | Astro layout |
| `wp_nav_menu()` | `getMenu()` |
| Sidebar | Widget area + `<WidgetArea />` |
| Options API | Site settings, or a plugin's `ctx.kv` |
| WordPress plugin | Sandboxed or native EmDash plugin |

**Template file map (blog template)**

| WordPress | Astro |
| --- | --- |
| `front-page.php` / `home.php` | `src/pages/index.astro` |
| `single.php` | `src/pages/posts/[slug].astro` |
| `archive.php` | `src/pages/posts/index.astro` |
| `page.php` | `src/pages/pages/[slug].astro` |
| `category.php` | `src/pages/category/[slug].astro` |
| `tag.php` | `src/pages/tag/[slug].astro` |
| `search.php` | `src/pages/search.astro` |
| `404.php` | `src/pages/404.astro` |
| `header.php` + `footer.php` | `src/layouts/Base.astro` |

**Key facts**
- Collections are created/edited under **Content Types** in the admin; each has typed fields and can enable drafts, revisions, scheduling, search, SEO, or comments.
- Query results are Astro live-collection entries: `entry.id` = route identifier (normally the slug); `entry.data.id` = database content ID (use with taxonomy/comment helpers that expect stored IDs).
- Menus and widget areas live in the DB and are queried at request time: `const primary = await getMenu("primary")` → `primary?.items` with `.url` / `.label`; `<WidgetArea name="sidebar" />` from `emdash/ui`.
- Site identity: `const settings = await getSiteSettings()` → `settings.title`, `settings.logo?.url`, `settings.logo.alt`.
- Taxonomy terms are separate records, not values in `entry.data`. Resolve then filter:
  `const news = await getTerm("category", "news", { includeCounts: false });` then `getEmDashCollection("posts", { where: { category: news.slug } })`.
- Plugin formats: sandboxed = `emdash-plugin.jsonc` manifest + default-exported `src/plugin.ts` typed `SandboxedPlugin`, Block Kit for admin UI, can run isolated; native = build-time descriptor factory + runtime `createPlugin()` built with `definePlugin()`, for React admin components, public Astro components, page fragments. Hook names and `PluginContext` APIs are shared; package/handler shapes are **not** interchangeable.
- **Import WordPress**: admin sidebar → Import WordPress, or `/_emdash/admin/import/wordpress`. Two paths: (1) upload a WXR file from WP Tools → Export; (2) install the **EmDash Exporter** WP plugin and connect with a WP application password (can include content the public REST API doesn't expose). Entering a WP URL without the exporter only probes/counts public posts, pages, media — it does not import. Status mapping: WP `publish` → `published`; draft/pending/private/future/trash/unknown → **draft**. Keep the WP site and media online until everything is verified.
- Editor UX: collection lists, Portable Text editor, media, menus, taxonomies, revisions, preview links. Gutenberg blocks become Portable Text; it is not a wp-admin clone.

## 2.2 Astro for WordPress developers (Astro primer)

Source: https://docs.emdashcms.com/coming-from/astro-for-wp-devs/

**Directory map**

| WordPress | Astro | Purpose |
| --- | --- | --- |
| `index.php`, `single.php`, `page.php` | `src/pages/` | URL routes |
| `template-parts/` | `src/components/` | Reusable markup |
| `header.php` / `footer.php` | `src/layouts/` | Shared shells |
| `style.css` | `src/styles/` | Styles |
| Plugin + DB setup | `astro.config.mjs` | Integrations, adapter |
| Theme setup data | `seed/seed.json` | Collections, menus, sample content |

Blog template layout: `src/components/PostCard.astro`, `src/layouts/Base.astro`, `src/pages/index.astro`, `src/pages/pages/[slug].astro`, `src/pages/posts/index.astro`, `src/pages/posts/[slug].astro`, `src/live.config.ts`.

**Astro essentials used by EmDash templates**
- `.astro` file = frontmatter between `---` fences (server-side TypeScript: imports, queries, `interface Props`, `Astro.props`) + HTML template below. `{value}` output is escaped.
- Expressions: print `{post.data.title}`; conditional `{cond && <p>…</p>}`; ternary `{a ? <X/> : <Y/>}`; lists `{items.map(i => <Comp … />)}`. Use `<PortableText />` for rich text rather than injecting HTML.
- Props ≈ `$args` of `get_template_part()` but typed. Slots: `<slot />` default, `<slot name="footer" />` named, filled with `<a slot="footer">`. Slots are local to the call — not like WP actions.
- Layouts own `<html>/<head>/<body>` and render page content through `<slot />`.
- File routing: `src/pages/index.astro` → `/`; `posts/index.astro` → `/posts`; `posts/[slug].astro` → `/posts/hello-world` (`Astro.params.slug`).
- Server rendering: templates use `output: "server"`; each request may hit the DB. *(gotcha)* Do **not** add `getStaticPaths()` to EmDash theme routes unless you deliberately treat EmDash as build-time data.

**Canonical single-entry route**
```astro
---
import { decodeSlug, getEmDashEntry } from "emdash";
import { PortableText } from "emdash/ui";
const slug = decodeSlug(Astro.params.slug);
if (!slug) return Astro.rewrite("/404");
const { entry: post, error } = await getEmDashEntry("posts", slug);
if (error) return new Response("Could not load the post", { status: 500 });
if (!post) return Astro.rewrite("/404");
---
<h1>{post.data.title}</h1>
<PortableText value={post.data.content} />
```
Collection results expose `entries` (array); single-entry results expose `entry` (`null` when nothing published matches).

## 2.3 EmDash for Astro developers

Source: https://docs.emdashcms.com/coming-from/astro/

**What EmDash adds to an Astro site**

| Feature | Provides |
| --- | --- |
| Admin | Collection/media/menu/taxonomy/settings management at `/_emdash/admin` |
| Database collections | Editor-managed content queried at request time |
| Media library | Stored files + media field values for templates |
| Drafts, revisions, previews | Editorial work before publication |
| Menus & widget areas | Editable site regions outside entry fields |
| Site settings | Title, tagline, logo, pagination size, etc. |
| Plugins | Hooks, routes, storage, optional admin extensions |

Astro keeps routing, layouts, rendering, styles, adapter.

**Astro content collections vs EmDash collections** — they coexist; pick by ownership (repo-owned vs editor-owned).

| | Astro content collection | EmDash collection |
| --- | --- | --- |
| Storage | Project files | SQL database |
| Editing | Repo workflow | EmDash admin |
| Query | `getCollection()` | `getEmDashCollection()` |
| Rich text | Markdown / MDX | Portable Text |
| Delivery | Build-time or live loader | Runtime live loader |

EmDash never copies file-based entries into its DB; e.g. `Promise.all([getCollection("releases"), getEmDashCollection("articles", { limit: 3 })])`.

**Wiring:** same `astro.config.mjs` as §1.2 (server output, `node({ mode: "standalone" })`, `react()`, `emdash({ database: sqlite(...), storage: local(...) })`) and `src/live.config.ts` exposing one live collection named `_emdash` via `emdashLoader()`. Cloudflare templates are pre-configured for D1 + R2 — start from the template for your target rather than translating adapters by hand.

**Query notes**
- `orderBy` uses stored field names → `"asc"` | `"desc"`; `limit` for pagination; result includes `entries`, `error`, `cacheHint` (`if (Astro.cache?.enabled) Astro.cache.set(cacheHint)`).
- Anonymous queries return **published** content only; explicit `status` filters are for authenticated/preview-aware code. `where` accepts content fields **and taxonomy names**.
- `getEmDashEntry(collection, slugOrId)`; `Astro.redirect("/404")` or `Astro.rewrite("/404")` on miss.
- Layout helpers: `Promise.all([getMenu("primary"), getSiteSettings()])`; `<WidgetArea name="sidebar" />`.
- *(gotcha)* Never paste a native `definePlugin()` example into a sandboxed plugin package — the formats differ (§6.1).
- Tip: start new sites from an official template so adapter, seed path, live collection, middleware, and package versions stay aligned.

---

# Part 3 — Guides

## 3.1 Create a Blog (blog template walkthrough)

Source: https://docs.emdashcms.com/guides/create-a-blog/

The **blog template** ships a working site with posts, pages, authors (bylines), categories, tags, search, comments, widgets, and RSS.

**Scaffold (non-interactive)**
```bash
npm create emdash@latest my-blog -- --template cloudflare:blog --pm pnpm --yes   # Cloudflare (D1/R2 emulated locally)
npm create emdash@latest my-blog -- --template node:blog --pm pnpm --yes         # Node.js + SQLite + local files
cd my-blog && pnpm dev                                                           # then /_emdash/admin → setup
```
Requires Node ≥ 22.12 and pnpm (per this page). A Cloudflare account is needed only to deploy; local dev emulates DB and storage. If dependency install fails, run `pnpm install` in the project. `.env` gets `EMDASH_ENCRYPTION_KEY`; `.gitignore` excludes it.

**Content model (`seed/seed.json`)**
- `posts`: `supports` enables drafts, revisions, search, SEO; comments enabled separately via `commentsEnabled: true`. Custom fields: `title` (required), `featured_image` (image), `content` (Portable Text), `excerpt` (short text for lists/meta fallbacks).
- `pages`: drafts, revisions, search.
- Taxonomies `category` and `tag` on posts; bylines credit one or more authors.
- System fields added automatically: stable content ID, slug, status, created/updated times, publication time.
- Dev server generates `emdash-env.d.ts` → `getEmDashCollection("posts")` entries have `data` typed as `Post`.

**Editor flow:** Posts → Add New → title (slug auto-suggested, editable) → excerpt + Content → featured image (Media Library; add alt text) → byline/category/tags in settings panel → **Save** (draft, opens permanent entry URL) → **Preview** → **Publish**. Post appears at `/posts/<slug>`, home, archive. After publishing, edits autosave into a new draft while the live version stays up; **Publish changes** swaps it. Local-dev posts live only in the local DB — deploying does not copy them.

**Template code patterns**
- Archive: `getEmDashCollection("posts", { orderBy: { published_at: "desc" } })` then batch tags with `getTermsForEntries("posts", posts.map(p => p.data.id), "tag")` (taxonomy assignments key off the stable content ID; links use `post.id`). Bylines are already on `post.data.bylines`.
- Detail: `decodeSlug(Astro.params.slug)` → `getEmDashEntry("posts", slug)` → `{ entry, error, cacheHint }` → `<Image image={post.data.featured_image} priority />` + `<PortableText value={post.data.content} />` (from `emdash/ui`). `Image` generates responsive output from the media value.
- Category archive: `getTerm("category", slug, { includeCounts: false })` → `getEmDashCollection("posts", { where: { category: category.slug }, orderBy: { published_at: "desc" } })`. Tag route mirrors it with `getTerm("tag", …)` and `where: { tag: term.slug }`.
- `getEmDashEntry()` hydrates assigned terms: `post.data.terms?.category ?? []`, `post.data.terms?.tag ?? []` (each has `.slug`, `.label`).
- Pagination: add `limit` + offset for numbered `/posts/page/2` or cursor for "Older posts"; keep `orderBy` identical across pages (§3.3).
- RSS: template serves `/rss.xml` — 20 newest posts via `getEmDashCollection()`, escapes title/excerpt, reads site title/tagline from settings; set Astro's `site` option for absolute production URLs (falls back to request origin in dev).
- Both blog templates use `output: "server"`.

## 3.2 Working with Content (editor workflow)

Source: https://docs.emdashcms.com/guides/working-with-content/

**Core model:** *saving* and *publishing* are separate. Draft changes are invisible to visitors until published.

**Collection page** (`/_emdash/admin` → sidebar → e.g. Posts): Add New; search title/slug/searchable fields; filter by publishing state, author, byline, date, locale; bulk publish / return to draft / move to Trash; **Trash** tab to restore or permanently delete. Available fields and features depend on the collection's content model (revisions, previews, taxonomies, search…).

**Create → publish:** Add New → required fields (title suggests slug; editable pre-publish) → body/excerpt/featured image/byline/taxonomies → **Save** (first save creates a draft and opens the permanent editor URL) → **Preview** (if supported) → **Publish now** + confirm. Entries have a stable content ID plus a separate slug; the ID survives slug changes.

**Rich text (Portable Text editor):** headings, paragraphs, quotes, lists, links, images, galleries, code blocks, tables, HTML blocks, reusable sections; plugins may add blocks. Insert via the add-block control or `/` search. Drag/paste images → uploads to Media Library inline. Image block settings: replace/remove this use, display size, alignment, alt, caption, tooltip; **Edit asset** opens the shared Media Library item (changes can affect other entries).
*(gotcha)* The standard Portable Text renderer sanitizes HTML blocks and only allows iframes from **YouTube and Vimeo**; a custom HTML-block renderer must do its own sanitization and allowlisting.

**Autosave & drafts:** after first save, autosaves 2 s after typing stops (Save → Saving… → Saved). Autosave replaces the current autosave revision rather than spamming history; press **Save** to pin a checkpoint. Failed saves keep unsaved fields visible. For a published entry, saves update the **draft only**; use **Preview draft**, **Live View**, **Publish changes**. Slug changes on published entries also go through the draft — the public URL changes on publish, not on autosave.

**Edit locks (multi-editor):** opening an entry takes a lock per entry **and locale**. If held by someone else: **Open read-only** or **Take over** (the other editor is told within ~2 minutes and their next save is refused). Lock renews while open, releases on leaving/closing, expires **7 minutes** after last renewal if the browser dies. Scripts/API/MCP clients are also refused while a lock is held unless they use the documented override (REST §11.7 "Entry edit lock", MCP §11.8). Admins can disable locking per collection: Content Types → collection → **Edit locking**.

**Publishing controls**

| Control | Effect |
| --- | --- |
| Publish now | New draft goes live (confirm) |
| Publish changes | Pending changes on a published entry go live (confirm) |
| Schedule | Sets when a new entry or pending changes go live (time zone shown) |
| Change schedule / Remove schedule | Edit or cancel |
| Unpublish | Removes live revision from public queries, cancels schedule, keeps editable draft |

Scheduled publishing: Node.js deployments run the sweep automatically; **Cloudflare Workers need a Cron Trigger** (starter templates include it; see §9.1).

**Revisions:** collections with revision support show **Revisions** in the settings panel with field-level diffs; **Restore** creates a new revision from the selected one (history is preserved).

**Translations (with i18n enabled):** settings panel → **Translations** → **Translate** for a locale → edit copied fields → Save → publish/schedule. Each translation has its own slug, state, schedule, revision history; collection page has a locale selector.

**Trash:** Move to Trash (single or bulk) → hidden from ordinary queries, visible under **Trash**; **Restore** returns it as a **draft with no schedule**. **Delete Permanently** (admins) removes entry + revisions irreversibly.

**Automation:** REST API and CLI mirror the same workflow — collection fields go inside the request's `data` object; an update saves a draft revision; publish is a separate call; pass the latest `_rev` on update/publish so stale writes are rejected. See §11.3 Content Lifecycle, §11.7 REST, §11.2 CLI (`emdash content`).

## 3.3 Querying Content

Source: https://docs.emdashcms.com/guides/querying-content/

**Two functions:** `getEmDashCollection(collection, options?)` → list; `getEmDashEntry(collection, slugOrId, options?)` → one entry. Both return **errors as data** (no throw). Public queries default to `status: "published"`; drafts are private unless published or accessed via a valid preview URL.

**Collection result shape**

| Key | Meaning |
| --- | --- |
| `entries` | Array; empty on no match **or** on failure |
| `error` | Set only for a failed query (not for empty results) |
| `cacheHint` | Tags + last-modified for `Astro.cache.set()` |
| `nextCursor` | Present when a limited cursor page has more |
| `hasMore` | Whether a limited cursor/offset page has a next page |

Ordering and limiting happen in the DB before hydration.

**Identifiers** *(important)*
- `entry.id` — URL-facing id from the content loader; normally the slug, **including any i18n locale prefix**. Use for links.
- `entry.data.id` — stable DB content ID; unchanged by slug edits. Use for APIs, taxonomy helpers, page context, relations.
- `getEmDashEntry()` accepts slug (locale-scoped when i18n is on) or content ID.
- *(gotcha)* Don't build links from `entry.data.slug` when `entry.id` is available — you'd drop the locale prefix.

**Filtering (`where`)**
- Keys naming a **taxonomy** match assigned term slugs; other keys match collection fields. Multiple keys = AND. Array value on a key = any-of (`{ category: ["news", "updates"] }`).
- `locale: "fr"` requests a language explicitly; omitted → request locale → configured default (§3.23).
- `status`: `"published"` | `"draft"` | `"archived"`. Never request drafts from public routes; use preview flow.

**Ordering (`orderBy`)**
- Map of **stored field names** → `"asc"` | `"desc"`, e.g. `{ published_at: "desc", title: "asc" }`.
- System columns use DB names: `created_at`, `updated_at`, `published_at`. Custom fields use their slug. *(gotcha)* The camelCase values on `entry.data` (`createdAt`, `updatedAt`, `publishedAt`) are **not** valid `orderBy` keys.
- First valid `orderBy` field is the pagination key; content ID is the tie-breaker. Default without `orderBy`: `created_at` desc.
- Mark custom scalar fields **indexed** when you regularly sort/filter by them.

**Pagination** — cursor (feeds) or offset (numbered pages); cannot mix in one query.
- Cursor: `getEmDashCollection("posts", { limit: 10, cursor, orderBy: {...} })` → pass `nextCursor` back verbatim via `?cursor=`; absent on the last page; no totals, no previous-cursor.
- Offset: `{ limit: perPage, offset: (page - 1) * perPage, orderBy }` + `hasMore` for the next link; offset must be a non-negative integer; entries added between requests can shift later pages.

**Single entry**
```astro
---
import { decodeSlug, getEmDashEntry } from "emdash";
import { Image, PortableText } from "emdash/ui";
const slug = decodeSlug(Astro.params.slug);
if (!slug) return Astro.redirect("/404");
const { entry: post, error, isPreview, cacheHint } = await getEmDashEntry("posts", slug);
if (error) return new Response("Unable to load post", { status: 500 });
if (!post) return Astro.redirect("/404");
if (Astro.cache?.enabled) Astro.cache.set(cacheHint);
---
{isPreview && <p>This is an unpublished preview.</p>}
{post.data.featured_image && <Image image={post.data.featured_image} priority />}
<PortableText value={post.data.content} />
```
- `PortableText` ships renderers for standard blocks (images, galleries, code, tables, sanitized HTML). Pass custom `components` for site-specific blocks. Replacing the `htmlBlock` renderer means you own sanitization + iframe host allowlist.
- Tables render as read-only placeholders in edit mode; localize with `tablePlaceholder={label}` (default `"Table (edit in admin)"`).

**Reference fields (relations)** — values are **not** in `data`; opt in per call:
```ts
const { entry: post } = await getEmDashEntry("posts", slug, {
  references: { author: true, related_posts: { limit: 6 } },
});
const author = post.references?.author.entries[0];
```
- `true` = first page at default limit **50**; `{ limit, cursor }` up to **100** per page.
- Each referenced entry is a full `ContentEntry` (`id`, `data` with `Date`s and resolved media, an `edit` proxy scoped to that entry for visual editing) — **except** bylines and taxonomy terms are not hydrated onto referenced entries.
- Ordering: editor-arranged order when the field is on the parent (picking) end; child-end fields list pointing entries with no intrinsic order.
- Cost: no `references` → no extra queries; otherwise one link query per field + one entry query per distinct target collection.
- Next page of one field: `getEmDashReferences("posts", post.id, "related_posts", { cursor, limit: 20 })` → `{ entries, nextCursor }`. Honors the same draft/preview visibility; ids carry locale prefixes where i18n uses them (`fr/about`). Merge its `cacheHint` into the route's.
- Preview/visual editing sees unpublished entries and the draft-staged selection; public sees published only.

**SEO helper**
```ts
import { getSeoMeta } from "emdash";
const seo = getSeoMeta(post, { siteTitle: "My Blog", siteUrl: Astro.url.origin, path: Astro.url.pathname });
// seo.title, seo.ogTitle, seo.description, seo.ogImage, seo.canonical, seo.robots
```
Resolves editor SEO title/description/image/canonical/no-index with entry fallbacks. A layout with `<EmDashHead>` applies the same fields plus plugin contributions. Hand-written meta from `data.title`/`data.excerpt` misses canonical and no-index.

**Preview:** middleware validates the `_preview` token; `getEmDashEntry()` returns the draft with `isPreview: true` (§3.20).

**Types:** dev generates `emdash-env.d.ts` (keep it in tsconfig). Remote: `npx emdash types --url https://cms.example.com` → `.emdash/types.ts` (supports API token / custom headers). Collections with relation-bound reference fields get a `{Collection}References` interface; `getEmDashEntry` narrows `references` to the fields you selected (unselected ones are type errors).

**Caching:** always pass `cacheHint` to `Astro.cache.set()` when the cache is enabled — EmDash tags responses by collection/entry so publishing invalidates them. Avoid replacing that with long fixed `Cache-Control` unless delayed updates are intentional. Prerendered routes only change on rebuild.

## 3.4 Media Library

Source: https://docs.emdashcms.com/guides/media-library/

**Structure:** admin **Media** → Main library (folders + unfiled files), grid/list views. External providers (e.g. Cloudflare Images, Cloudflare Stream) appear as separate sources with varying capabilities (may lack folders, local editing, deletion).

**Uploading:** Media → **Upload Files** → Browse/drag; rows show Queued / Uploading / Complete / Upload failed, with retry/cancel/remove; **Done** when finished. New local files always land in Main library. In-editor: image/file/gallery/Portable Text pickers have **Upload files**; galleries let you order **Selected media** before **Add images**.

**Accepted types (default):** PNG, JPEG, GIF, WebP, AVIF; MP4, WebM, QuickTime; MP3, WAV, Ogg; PDF. **SVG excluded by default** (active content risk). Fields can define their own accepted-type list; the server re-checks media type (`image/png`, `application/pdf`, …) on save — the browser chooser is not a bypass. Default max **50 MB/file**, configurable via `maxUploadSize` (§11.1). Providers may add limits.

**Organizing:** filename search (partial, whole local library even inside a folder); type filter (images/documents/video/audio). **Add new folder**; move by drag or via file → **Location** → Save (choose **Main library** to unfile). Authors move their own uploads; editors move any. Provider items can't be foldered. Deleting a folder returns files to Main library (no URL change, no deletion).

**Selecting for content:** Portable Text → block menu → **Image** → Insert; then set alt/caption/dimensions/alignment. Image/file fields → **Select image/file** (MIME rules filter the picker). Gallery fields keep their own order and per-image alt/caption.

**Editing scopes** *(important distinction)*

| Action | Scope |
| --- | --- |
| **Replace** (in editor) | This field/block/gallery slot only; other uses unchanged |
| **Edit asset** | The shared Media Library item; metadata + destructive edits may affect every use |
| **Remove** | Clears this reference; item stays in library |

Cropped copy via Edit asset → picker selects the copy for the current use (keeps that use's alt/caption/layout). Replace-original via Edit asset keeps the media ID → every use changes. Provider images: Replace/Remove only.

**Replace image (library-level):** uploads new bytes behind the same item — same media ID, filename, URL, alt, caption, folder; **same format required** (JPEG→JPEG etc.), dimensions may differ; focal point is cleared. Ready JPEG/PNG/WebP only. Authors: own uploads; editors: any. *(gotcha)* Irreversible, previous bytes not kept, CDNs may briefly serve the old image.

**Focal point:** Edit image → Focal point → drag/arrow keys → check portrait/square/landscape previews → Save (Reset removes). Selecting an image copies the asset's current focal point into the content value; existing uses keep their stored point until reselected; Edit asset from a field updates that use.

**Crop:** Edit image → Crop → Original / Freeform / Square / `4:3` / `3:2` / `16:9` → drag or arrow keys (Shift = larger step) → **Create cropped copy** (new item, same folder, unique filename) or **Replace original** (only with **Original** ratio; keeps media ID; irreversible; no crop history; caches may lag). Animated WebP crops become still.

**Used in (usage tracking):** file → **Used in** lists entries (collection + fields, trashed flagged) and site settings (**Logo**, **Favicon**, **Default Social Image**). Covers: image/file fields; images inside repeaters; image/file/Portable Text fields inside `blocks` fields; image & gallery blocks in Portable Text; logo/favicon/default social image. Requires an admin to enable **Settings → Media usage tracking → Enable tracking** once: pause all writes → status **Setting up** (EmDash temporarily refuses content/schema/revision/import/MCP writes) → **Indexing existing content** (editing may resume; keep page open) → **Ready**. **Cannot be turned off** once enabled. States: "No tracked references found" (complete, none) vs "No usage to show yet" (coverage incomplete). *(gotcha)* Does not inspect custom Portable Text blocks, custom code, generated HTML, other DBs, or external sites — an empty list does not prove deletion is safe; treat running/stale/partial/failed indexing as incomplete.

**Rendering:** image fields return a **media value**, not a URL. Use `Image` from `emdash/ui`:
```astro
{post.data.featured_image && <Image image={post.data.featured_image} width={1200} height={675} priority />}
```
`Image` handles local/provider URLs, dimensions, focal point, responsive variants, LQIP placeholder; `priority` = eager + high fetch priority — only for the main above-the-fold image. Dark variants render automatically (§3.5). Media metadata comes with the content reference (no extra library query); avoid per-image provider lookups on list pages.

**Storage:** local library uses the configured storage adapter (Node: local disk or S3-compatible; Cloudflare: R2 binding) — §9.7. Cloudflare Images / Stream register as external providers; their items can't use local folders/focal/crop/replace.

**Deletion:** Media → file → **Delete** → permanent. Authors delete own uploads; editors any; provider items only if the source supports deletion. *(gotcha)* No Trash, no undo, and content references are **not** rewritten → broken images unless you fix uses first (check **Used in** + custom code).

Automation: REST media endpoints (§11.7), CLI `emdash media` (§11.2).

## 3.5 Dark Mode

Source: https://docs.emdashcms.com/guides/dark-mode/

**Theme convention (read by EmDash components):**
1. A `dark` or `light` class on `<html>` pins the scheme (wins).
2. Otherwise follow `prefers-color-scheme`.

Bundled templates store the choice in a `theme` cookie and apply it pre-paint with an inline `<script is:inline>` in `<head>` that reads `theme=` from `document.cookie` and adds the class when it is `dark` or `light`. Define colors with CSS `light-dark()`:
```css
:root { color-scheme: light dark; --color-bg: light-dark(#ffffff, #0d0d0d); --color-text: light-dark(#1a1a1a, #ededed); }
:root.light { color-scheme: light; }
:root.dark  { color-scheme: dark; }
```
No switcher → no script needed; system preference applies.

**Dark image variants**
- Off by default; enable per image field: admin **Content Types** → field → **Dark mode variant**, or seed `"options": { "darkVariant": true }` on an `image` field.
- Editor: pick primary image → **Add dark mode variant** → Save. Stored inside the field value as `darkVariant`. Removing the primary removes the variant; replacing the primary keeps it.
- Render: unchanged template — `<Image image={post.data.featured_image} priority />` outputs two `<img>`s: primary gets class `emdash-image--light`, variant `emdash-image--dark`; both share the primary's `alt`, size overrides, loading attrs; each keeps its own placeholder color. A passed `id` stays on the primary; variant gets `id + "--dark"`. Explicit variant from another field: `<Image image={post.data.hero} darkVariant={post.data.hero_dark} />`.
- Loading: both lazy by default → browser downloads only the visible one (hidden lazy images aren't fetched). With `priority`, **both** become eager/high-priority and both download (server can't know the scheme) — use on one hero image only.

**Custom convention (e.g. `data-theme`):** either also set the `dark`/`light` classes, or override the four `display` cases for `:root[data-theme="dark"|"light"] .emdash-image--light|--dark` (EmDash's selectors use `:where()` on the `<html>` part so your rules win). EmDash's `prefers-color-scheme` rules still apply when no class is present.

## 3.6 Taxonomies

Source: https://docs.emdashcms.com/guides/taxonomies/

**Concepts:** a taxonomy is a named classification attached to one or more collections. Built-ins: hierarchical `category`, flat `tag` (for posts). Custom examples: `genre`, `topic`, `difficulty`. Terms belong to a taxonomy; hierarchical taxonomies nest.

**Admin:** **Taxonomies** → open one → **Add Category/Tag/…** → label, slug, parent (hierarchical), description → reorder with move controls. Editors assign terms from taxonomy panels in the entry editor (the taxonomy's `collections` decides which collections show it). Deleting a term removes its assignments, not the entries.

**Bulk assign:** in a collection list select posts → **Add tag** / **Add term** (asks which taxonomy when several apply); or on a taxonomy page → **Add to posts** and paste up to 50 public post URLs (one per line) → **Review posts** → confirm. Takes effect immediately without publishing pending drafts; already-tagged posts skipped; non-matching URLs are flagged not guessed; **Retry failures** for write errors. URL matching uses the configured public origin and collection URL patterns (incl. date/language paths).

**Custom taxonomy:** Taxonomies → **New Taxonomy** → label + stable **name** (lowercase letter start; lowercase letters, digits, underscores) → **Hierarchical** toggle → select collections → **Create Taxonomy**. Templates query the stable name; labels can change freely. Same helpers: `getTaxonomyTerms("genre", { includeCounts: false })`, `getEmDashCollection("books", { where: { genre: "science-fiction" } })`.

**Delete taxonomy:** actions menu → **Delete taxonomy** (needs `taxonomies:manage`, held by editors and admins). Deletes its terms in every language and their assignments; entries kept. *(gotcha)* Irreversible; templates keep rendering but `getTaxonomyTerms()` returns `[]` and `where` filters match nothing.

**Query helpers**
- `getTaxonomyTerms(name, { locale?, includeCounts? })` → tree (hierarchical: `term.children[]`). Counts included by default (aggregate over assigned collections; count = publicly visible entries in the query locale) — pass `includeCounts: false` when not displayed. Fields: `slug`, `label`, `description`, `children`, `count`.
- `getTerm(name, slug, { locale?, includeCounts? })` → one term (follows fallback chain when the translation is absent).
- `entry.data.terms` is hydrated by `getEmDashEntry()`/`getEmDashCollection()` (e.g. `post.data.terms?.category`) — prefer it over per-entry queries.
- `getEntryTerms()` when you only have collection + entry ID; `getTermsForEntries()` to batch for several entries.
- Archive route pattern: `decodeSlug` → `getTerm("category", slug, { locale, includeCounts: false })` → `getEmDashCollection("posts", { status: "published", locale, where: { category: category.slug }, orderBy: { published_at: "desc" } })`. Build links with `getRelativeLocaleUrl(locale, path)` from `astro:i18n` when localized, and honor a collection's custom `urlPattern` instead of assuming `/posts/{slug}`.
- Typing a component prop: `ContentEntry<InferCollectionData<"posts">>` from `emdash`.

**Translations:** one row per locale for taxonomy definitions and terms, linked as translations of one identity; assignments resolve to the translated term when present.

| Field | Belongs to | Notes |
| --- | --- | --- |
| `name` | Taxonomy | Fixed after creation; identical across locales |
| `hierarchical`, `collections` | Taxonomy | Same in all locales; changing via any locale changes all |
| `label`, `labelSingular` | Locale | Per-locale |

A definition created with an existing name in another locale joins that taxonomy (with or without `translationOf`) and inherits `hierarchical`/`collections`; conflicting values fail. Missing-locale definitions still list terms, using the label from the fallback chain → default locale → lowest locale code. Term parent and position are shared across locales; translated terms can have their own slug/label. Helpers use explicit `locale`, else request locale, else default.

REST: Bearer token + `X-EmDash-Request: 1` header on every state-changing request (§11.7 taxonomy endpoints).

## 3.7 Relations

Source: https://docs.emdashcms.com/guides/relations/

**Model:** a **relation** joins two collections and *owns* the links between their entries (post→author, lesson→chapters, product→related products). A **`reference` field** views one relation from one end and gives editors a picker. Slug, per-side names, and per-side limits live on the relation, so fields on both collections can't disagree. Links are stored outside both collection tables, keyed by each entry's **translation group** → all translations share one selection. Ends: **linking** side (picks) and **linked** side (is picked).

**Create a relation:** Content Types → **Relations** → **New Relation** → choose **Links from** (picks) and **Links to** (picked) → **Roles** (plural/singular names per side; a reference field takes the name of the side it picks from) → check **Slug** (stored by reference fields) → **How many** per side: **One** / **Any number** / **At most** N → create. Collections and slug are fixed afterwards (links are keyed by relation); names and limits stay editable. Lowering a limit keeps existing links but refuses saves whose selection exceeds it. Each content type page also has a **Relations** panel.

**Add a reference field:** content type → **Add Field** → **Reference** → pick relationship (or **Create relation** inline) → for self-referencing relations choose **This field picks**: *Entries this one links to* vs *Entries that link to this one* → label/slug (renaming the field renames that side) → add. Rules: **one field per end** (a second field over the same end is refused); a field on each end lets both types edit one link set. Reference fields **cannot be searchable or indexed** (no own column) → excluded from list filters and site search.

**Editor:** **Add reference** opens a search over the target type; single-entry fields show **Replace reference**; picked entries can be opened, removed, and (on a linked-side picker) reordered. Linking-side fields list back-references with no order. Selections save with the entry in one request; on revisioned collections a change on a published entry is staged in the draft (goes live on publish, discarded with the draft); previews show staged selections.

**Template:** `getEmDashEntry("posts", slug, { references: { author: true } })` → `post.references?.author.entries[0]` (full details in §3.3).

**Seed files:** top-level `relations` array; a reference field binds by slug; a field naming `targetCollection` instead gets a relation created for it. `emdash export-seed` emits relations; `--with-content` emits each entry's links (§8.3).

**Deletion:** deleting a reference field offers to also delete its relationship (removes the relationship, its links, and the field on the other type) — uncheck to keep them. Deleting a relationship always removes its links and bound fields. Deleting a content type removes every relationship it participates in plus the other types' viewing fields (confirmation lists them).

**Legacy fields without a relation:** hold one entry ID in a text box. Bind one: edit field → **Referenced collection** → optional **Allow multiple references** → Save. EmDash creates a relation named after field + type, copies existing IDs into links, clears searchable/indexed flags, leaves the old column in place but stops writing it; no limit on the reverse side (edit on **Relations** page). Sites updated from earlier releases may hold such fields — see §9.3 "Reference fields bind to relations".

## 3.8 Navigation Menus

Source: https://docs.emdashcms.com/guides/menus/

- A menu has a stable **name** (queried by templates, e.g. `primary`, `footer`) and a **label** (admin only); items are per translated menu. Use the same name in every locale; manage other locales via the menu's **Translations** panel.
- Admin **Menus** → **Create Menu** → **Add Content** (link an entry) or **Add Custom Link** (external URL or root-relative path) → Move up/down → set **Parent** to nest.

**URL resolution at `getMenu()` time** (content/taxonomy items store references, not URLs):

| Item kind | URL returned |
| --- | --- |
| Content entry | Collection's `urlPattern`, else `/{collection}/{slug}` |
| Taxonomy term | `/{taxonomy}/{slug}` (resolved translation) |
| Collection archive | `/{collection}/` |
| Custom link | As entered |

Item fields: `url`, `label`, `target`, `titleAttr`, `cssClasses`, `children[]`.

**Render:** `const menu = await getMenu("primary", { locale })` → `null` if the name doesn't exist. Locale resolution: explicit `locale` → request locale → default locale → fallback chain for missing menus/entries. *(gotcha)* Returned URLs **do not include Astro's locale prefix**; wrap root-relative URLs with `getRelativeLocaleUrl(locale, url)` from `astro:i18n` and leave external URLs alone. Render `aria-current="page"` when `Astro.url.pathname === href`; add `rel="noopener noreferrer"` for `target="_blank"`; for arbitrary depth, use a recursive component over `children`.
- Menu **widget** (in a widget area) renders a menu for the request locale but without locale prefixes — use direct rendering when you need custom markup or prefixes.
- `getMenus()` lists menu definitions. REST menu endpoints need Bearer token + `X-EmDash-Request: 1` on writes.

## 3.9 Widget Areas

Source: https://docs.emdashcms.com/guides/widgets/

- A widget area = named template position whose contents editors control (sidebar, footer column, promo). Use a **section** (§3.12) instead when editors need an independent editable copy inside an entry.
- Admin **Widgets** → **Add Widget Area** (name for template, label, description) → drag from **Available Widgets** → configure → reorder.

Widget types: **Content** (Portable Text), **Menu** (by name), **Component** (built-in):

| Component | Renders |
| --- | --- |
| `core:recent-posts` | Recent posts, optional dates/thumbnails |
| `core:categories` | Category links, optional counts |
| `core:tags` | Limited tag list, optional counts |
| `core:search` | Search form posting to `/search` |
| `core:archives` | Monthly/yearly archive links |

**Template:** `import { WidgetArea } from "emdash/ui"` → `<WidgetArea name="sidebar" class="sidebar-widgets" />` (renders nothing if missing/empty; keeps configured order). Wrapper classes: `widget-area` + your class; items: `widget`, `widget__title`, `widget__content` (+ type-specific classes). Style with `<style is:global>` because Astro scopes component styles.
- Locale: menu/category/tag widgets query in the request locale and resolve translations, but emit root-relative URLs **without** locale prefixes — for prefixed links use the §3.8/§3.6 patterns; content/search/recent-posts/archives widgets are fine in `WidgetArea`.
- Custom rendering: `getWidgetArea(name)` → `{ name, widgets[] }`; each `Widget` has `id`, `type` (`"content" | "menu" | "component"`), `title`, `content` (Portable Text for content widgets), `menuName` (menu widgets). Render content with `<PortableText>`; menus via `getMenu(widget.menuName, { locale })`. `getWidgetAreas()` lists areas. REST widget-area endpoints: Bearer + `X-EmDash-Request: 1`.

## 3.10 Page Layouts (template picker)

Source: https://docs.emdashcms.com/guides/page-layouts/

Pattern: a `select` field named `template` on the pages collection → one Astro layout component per option → the route maps value → component. Use a `blocks` field (§3.11) when editors compose/reorder sections instead.

Seed field:
```json
{ "slug": "template", "label": "Template", "type": "select",
  "validation": { "options": ["Default", "Full Width"] }, "defaultValue": "Default" }
```
Layout components take `page: ContentEntry<InferCollectionData<"pages">>` and wrap `Base.astro`, rendering `<PortableText value={page.data.content} />` with their own styling. Route:
```astro
---
import { decodeSlug, getEmDashEntry } from "emdash";
import PageDefault from "../../layouts/PageDefault.astro";
import PageFullWidth from "../../layouts/PageFullWidth.astro";
const slug = decodeSlug(Astro.params.slug);
if (!slug) return Astro.rewrite("/404");
const { entry: page } = await getEmDashEntry("pages", slug);
if (!page) return Astro.rewrite("/404");
const layouts = new Map([["Default", PageDefault], ["Full Width", PageFullWidth]]);
const Layout = layouts.get(page.data.template ?? "") ?? PageDefault;
---
<Layout page={page} />
```
Tip: use human-readable option values ("Full Width") — the value is both the stored value and the dropdown label. Typical layouts: Default (narrow), Full Width, Landing Page (no header/footer), Sidebar (with a widget area).

## 3.11 Blocks (page composition)

Source: https://docs.emdashcms.com/guides/blocks/

A `blocks` field stores an **ordered composition**; each item records `_type`, `_version` (retained schema version), `_key` (stable), plus that version's fields. Editors add/reorder in the editor; the route maps `_type` → Astro component.

**Seed structure:** top-level `blockTypes[]` (each: `slug`, `label`, `category`, `currentVersion`, `versions[]` with `version` + `fields[]`), then a collection field `{ "type": "blocks", "validation": { "allowedTypes": ["hero", "feature_grid"], "maxItems": 20 } }`. `allowedTypes` order = picker order. Removing an allowed type later moves it to the server-managed `retiredTypes` list (existing blocks editable; can't add/duplicate). Seed `$schema`: `https://emdashcms.com/seed.schema.json`.

**Components:** receive `value`, `index`, `blockKey`; `value` includes `_type/_version/_key`. Type with `BlockComponentProps<Extract<PageLayoutBlock, { _type: "hero" }>>` where `PageLayoutBlock` comes from the generated `emdash-env`. Use `sanitizeHref()` from `emdash` for editor-supplied URLs; `Image`/`PortableText` from `emdash/ui`.

**Render:**
```astro
---
import { Blocks, defineBlockComponents } from "emdash/ui";
import type { PageLayoutBlock } from "../../../emdash-env";
const components = defineBlockComponents<PageLayoutBlock>({ hero: Hero, feature_grid: FeatureGrid });
---
<Blocks value={page.data.layout} components={components} fallback={MissingBlock} />
```
`defineBlockComponents` requires a component for every `_type` in the generated union. `<Blocks>` does no queries — renders the array in stored order; block components may query explicitly. Unmapped type: dev → visible placeholder naming `_type` + console warning (value not printed); prod → `fallback` component or nothing. Ship renderers **before** enabling a type in production.

**Schema evolution**
- Compatible (same version): add optional field, add default, loosen validation. Stored blocks get defaults on next write.
- Breaking (new inactive version): remove field, change type, add required field, narrow validation. Procedure: create inactive version (schema API/MCP) → update renderer for both versions → deploy → activate → migrate stored blocks explicitly with `migrateBlocks: true`, preserving `_key` while changing `_version` + fields. Old versions remain for revisions/drafts/media tracking; no hard delete of block types/versions.
- *(gotcha)* Sites upgrading from < 0.39 must first deploy a release that treats unknown field types as read-only and rejects writes, before creating any blocks fields (protects against rolling-deploy/rollback runtimes rewriting block JSON as a string).

**Nested field support:** `string`, `text`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `multiSelect`, `portableText`, `image`, `file`, `repeater`. **Not** supported inside blocks: references, JSON, slugs, nested blocks, custom widgets, physical indexes, uniqueness, per-subfield localization. A `blocks` field itself can't be required/unique/searchable/indexed or given a custom widget.

## 3.12 Sections (reusable Portable Text)

Source: https://docs.emdashcms.com/guides/sections/

- Reusable groups of Portable Text blocks; inserting **copies** them into the entry (later library edits don't propagate). Use for CTAs, author bios, standard notices. For centrally synchronized content use a widget area.
- Admin **Sections** → **New section** → title, slug (lowercase letters/digits/hyphens; not a URL), description, content, search keywords → Save.
- Editor: type `/section` in a Portable Text field → search by title/description/keyword → insert → edit freely.
- Seed: top-level `sections[]` with `slug`, `title`, `description`, `keywords[]`, `source`, `content` (Portable Text with stable `_key` on every block and span). `source` values: `theme` (seeded), `user` (admin-created), `import` (WordPress reusable blocks). Validate with `emdash seed --validate`.
- Direct render (synchronized, reads library on every render): `const section = await getSection("newsletter-signup")` → `<PortableText value={section.content} />`. REST section endpoints: Bearer + `X-EmDash-Request: 1`.

## 3.13 Site Settings

Source: https://docs.emdashcms.com/guides/site-settings/

**Admin Settings pages:** **General** (title, tagline, logo, favicon, public URL, posts per page, date format, timezone); **Social** (handles for supported services); **SEO** (title separator, default social image, verification values, `robots.txt` content). All optional — templates must provide fallbacks.

**APIs**
- `getSiteSettings()` → partial object of configured keys; media refs resolved (`logo.url/alt/width/height`, `favicon`, `seo.defaultOgImage`). Request-scoped caching: later calls in the same request (including `EmDashHead`'s own call) reuse the result — read once in the base layout.
- `getSiteSetting("timezone")` (single key) e.g. `?? "UTC"` for `Intl.DateTimeFormat(..., { timeZone })`. `dateFormat` is a pattern string like `MMMM d, yyyy` — `Intl` doesn't consume it; use a pattern-capable library if you need it exactly.
- `getSiteSetting("social")` → `{ twitter, github, facebook, instagram, linkedin, youtube }` handles (not URLs); template builds URLs, e.g. strip `@` from `twitter` → `https://x.com/<handle>`.
- Deleted media → resolved `url` may be absent; check before rendering.

**Base layout pattern with head metadata:**
```astro
---
import { getSiteSettings } from "emdash";
import { createPublicPageContext } from "emdash/page";
import { EmDashHead } from "emdash/ui";
const settings = await getSiteSettings();
const siteTitle = settings.title ?? "My site";
const page = createPublicPageContext({
  Astro, kind: "custom", pageType: "website",
  title: fullTitle, pageTitle: title ?? siteTitle, description: description ?? settings.tagline, siteName: siteTitle,
});
---
<head><title>{fullTitle}</title><EmDashHead page={page} /></head>
```
For content pages use `kind: "content"` with a `content` reference (§3.14). **Writes:** API/MCP clients remove `logo`, `favicon`, or `seo.defaultOgImage` by sending `null`; omitted fields are unchanged; send only the fields you change inside `seo`/`social`; empty string clears a text field. One logo and one favicon only — dark variants belong to image fields (§3.5). REST settings endpoints: Bearer + `X-EmDash-Request: 1`.

## 3.14 Built-in SEO Features

Source: https://docs.emdashcms.com/guides/seo/

| Feature | Output | Requires |
| --- | --- | --- |
| SEO panel | Per-entry title, description, image, canonical, no-index | `seo` in collection `supports` |
| Head metadata | description, robots, canonical, Open Graph, Twitter Card | `<EmDashHead>` in the head |
| Structured data | JSON-LD `BlogPosting` or `WebSite` | `<EmDashHead>` |
| Sitemaps | `/sitemap.xml` index + `/sitemap-{collection}.xml` | SEO enabled on collection |
| `robots.txt` | `/robots.txt` with `Sitemap:` line | nothing |
| Site-wide settings | verification tags, default social image, title separator | **Settings → SEO** |
| Translations | `hreflang` links in head + sitemap | Astro i18n configured |
| Redirects & 404 log | redirect/gone rules, missed-URL log | nothing |

**Enable:** admin Content Types → **SEO** toggle, or seed `"supports": ["drafts", "revisions", "seo"]` (with `"urlPattern": "/posts/{slug}"`). Collections with **Routable** off stay out of the sitemap.

**SEO panel fields:** OG Image (`og:image` + sitemap image), SEO Title (social previews, structured data, and `<title>` via `getSeoMeta()`), Meta Description (160-char guideline), Canonical URL, **Hide from search engines** (`noindex, nofollow`, removed from sitemap and `hreflang`). Empty fields fall back to `createPublicPageContext()` values; `getSeoMeta()` falls back to `title`/`excerpt`.

**Content page head pattern:**
```ts
const settings = await getSiteSettings();
const seo = getSeoMeta(post, { siteTitle: settings.title, siteUrl: settings.url || Astro.url.origin,
  titleSeparator: settings.seo?.titleSeparator, path: Astro.url.pathname });
const page = createPublicPageContext({ Astro, kind: "content", title: seo.title, pageTitle: seo.ogTitle,
  description: seo.description, canonical: seo.canonical, siteName: settings.title,
  content: { collection: "posts", id: post.data.id, slug: post.data.slug } });
// <title>{seo.title}</title><EmDashHead page={page} />
```
`<EmDashHead>` emits: meta description; robots when hidden; canonical + `og:url`; OG (`og:type/title/description/image/site_name`) + Twitter Card (default social image when the page has none); `article:published_time/modified_time/author` when `articleMeta` is present. It **does not** render `<title>`. Precedence for the same tag: plugin (`page:metadata` hook) > site settings > page-context values.

**Structured data:** article page with canonical → `BlogPosting` (headline, description, image, dates, author, publisher); `kind: "content"` sets `pageType: "article"` unless overridden. Other pages → `WebSite` when `siteName` is set. Plugins may replace via `page:metadata`.

**Sitemaps:** index at `/sitemap.xml` linking `/sitemap-{collection}.xml` per collection with ≥1 listed entry (lastmod = most recent update). Lists entries that are published, not deleted, have a slug, not hidden; URLs from `urlPattern` or `/{collection}/{slug}`; includes SEO image (Google image extension); up to **50,000** entries per collection sitemap, ordered by last update.

**robots.txt:** default allows all, `Disallow: /_emdash/`, plus `Sitemap:`. Override in **Settings → SEO → robots.txt** (EmDash appends `Sitemap:` if missing). Absolute URL base: **Site URL** (Settings → General) → `siteUrl` config option / `EMDASH_SITE_URL` env → request origin. Caches: robots up to a day, sitemaps up to an hour. Your own `src/pages/robots.txt.ts`, `sitemap.xml.ts`, or `sitemap-[collection].xml.ts` route takes precedence for that path.

**Settings → SEO:** Title Separator (passed as `titleSeparator` to `getSeoMeta()`), Default Social Image, Google Verification (`google-site-verification`) and Bing Verification (`msvalidate.01`) meta on every page, custom robots.txt.

**Redirects (admin → Redirects):** rules redirect a source to a destination with `301/302/307/308`, or answer `410 Gone` / `451 Unavailable For Legal Reasons`. Sources accept named segments (`/old/[slug]`) and catch-all (`/old-blog/[...path]`) reusable in destinations. Slug change on a published entry auto-creates a `301` from the old URL (per `urlPattern`), collapses existing chains, and skips when another entry (e.g. a translation) still uses the old slug. **404 Errors** tab logs missed paths (up to **10,000**, LRU-evicted) with one-click redirect or 410. Seeds can define redirects (§8.3).

**Imported SEO:** the WordPress Exporter import can copy Yoast / Rank Math titles+descriptions into regular **SEO Title** / **SEO Description** content fields (separate from the SEO panel; templates must render them). Site transfer copies SEO panel values, SEO settings, and redirects; the target keeps its own site URL.

## 3.15 Authentication

Source: https://docs.emdashcms.com/guides/authentication/

**Model:** passkeys (WebAuthn) are primary. Additive **login providers** — GitHub, Google, Microsoft bundled (`emdash/auth/providers/*`), Atmosphere via `@emdash-cms/auth-atproto`, third parties via the same `AuthProviderDescriptor` interface. Each documented provider can create the first admin or sign in a linked user. **Cloudflare Access** is a separate, *exclusive* production mode (`auth: access(...)` instead of `authProviders`).

**Setup wizard (`/_emdash/admin`):** site title/tagline (+ optional sample content) → email + name → **Secure your account** (passkey or a configured provider) → first user becomes **Admin**. *(gotcha)* A passkey-created first account stores the wizard email unverified — configure email (§3.16) before relying on invites/magic links.

**Magic link:** login page → **Sign in with email** → link valid **15 minutes**, single-use, only consumed when the user clicks **Continue** on the confirmation page (so link-prefetching scanners don't burn it). Requires an email provider.

**Providers in config:**
```js
import { github } from "emdash/auth/providers/github";
import { google } from "emdash/auth/providers/google";
import { microsoft } from "emdash/auth/providers/microsoft";
import { atproto } from "@emdash-cms/auth-atproto";
emdash({ authProviders: [github(), google(), atproto()] });
```
Login page renders providers in listed order (button-only providers first, form providers like Atmosphere after). GitHub/Google/Microsoft auto-link an existing user **only** when the provider supplies the same *verified* email; Atmosphere links by DID (no email in that flow).

| Provider | Env vars (prefixed checked first, then unprefixed) | Callback URL |
| --- | --- | --- |
| GitHub | `EMDASH_OAUTH_GITHUB_CLIENT_ID`/`GITHUB_CLIENT_ID`, `EMDASH_OAUTH_GITHUB_CLIENT_SECRET`/`GITHUB_CLIENT_SECRET` | `/_emdash/api/auth/oauth/github/callback` |
| Google | `EMDASH_OAUTH_GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_ID`, `EMDASH_OAUTH_GOOGLE_CLIENT_SECRET`/`GOOGLE_CLIENT_SECRET` | `/_emdash/api/auth/oauth/google/callback` |
| Microsoft | `EMDASH_OAUTH_MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_ID`, `..._CLIENT_SECRET`/`MICROSOFT_CLIENT_SECRET`, `EMDASH_OAUTH_MICROSOFT_TENANT_ID`/`MICROSOFT_TENANT_ID` (directory ID or `common`/`organizations`/`consumers`) | `/_emdash/api/auth/oauth/microsoft/callback` |

Microsoft specifics: Entra secrets expire ≤ 24 months — rotate. Tenant must be the directory GUID, not `contoso.onmicrosoft.com`. Email verification rules: with a directory ID, an address counts verified only when it shares the domain of the account's UPN and the account signs in through that directory; guests/personal accounts/`common`/`organizations`/`consumers` → unverified; add optional ID-token claim `xms_edov` for verified-domain emails that differ from UPN domain; `microsoft({ emailVerified: true })` trusts everything (dangerous), `false` trusts nothing (only pre-linked users). Restrict sign-in with Entra **Assignment required** (groups need P1/P2, direct members only). EmDash keeps its own users/roles/disabled flag — directory changes don't propagate; disable the EmDash user too when someone leaves (an open session or registered passkeys keep working otherwise).

**Custom provider:** `AuthProviderDescriptor` from `emdash` — `id`, `label`, `adminEntry` (exports `LoginButton` / `LoginForm` / `SetupStep`), `routes: [{ pattern, entrypoint }]`, `publicRoutes`, `storage` collections. `@emdash-cms/auth-atproto` is the reference implementation.

**Roles (RBAC, each inherits lower levels; first user always Admin)**

| Role | Level | Can |
| --- | --- | --- |
| Subscriber | 10 | Read published content (`content:read`); no drafts/revisions/previews |
| Contributor | 20 | Create content (needs approval to publish); `content:read_drafts` |
| Author | 30 | Create/edit/publish own content |
| Editor | 40 | Manage all content |
| Admin | 50 | Everything incl. settings |

Subscriber requests to list/get endpoints are filtered to `status=published`; `/compare`, `/revisions`, `/trash`, `/preview-url` reject them.

**Invites:** Settings → Users → **Invite User** → email + role → **Send Invite** (emailed if configured, else copy the link). Single-use, expire **7 days**; invitee registers a passkey or uses a provider offered on the invite page.
**Passkeys:** up to **10** per user; add/remove/rename in account settings; can't remove the last one. Register on multiple devices.
**Group access without invites:** Atmosphere `allowedHandles`/`allowedDIDs`, or Cloudflare Access `autoProvision` + `roleMapping`.
**Sessions:** user ID stored in Astro's session store; browser holds the opaque `astro-session` cookie. Public pages read `Astro.locals.user`.

**Rate limits (per endpoint per trusted client IP)**

| Endpoint | Limit |
| --- | --- |
| `POST /_emdash/api/auth/passkey/options` | 10/min |
| `POST /_emdash/api/auth/magic-link/send` | 3 per 5 min |
| `POST /_emdash/api/auth/signup/request` | 3 per 5 min |
| `POST /_emdash/api/oauth/device/code` | 10/min |
| `POST /_emdash/api/oauth/device/token` | 12/min |
| `POST /_emdash/api/oauth/register` | 10 registrations/min |

Cloudflare supplies the client IP; self-hosted behind a proxy must set `trustedProxyHeaders` (§11.1) or per-IP limits are skipped. Magic-link tokens stored as SHA-256 hashes, deleted after use.

**Troubleshooting:** "No passkeys registered" → passkey deleted from password manager; admin sends recovery magic link (email required). "Passkey authentication failed" → passkeys are domain-bound (`localhost:4321` ≠ `example.com`). Lost all passkeys → recovery magic link from another admin; sole admin without email → reset auth via the database.

**Cloudflare Access mode**
```js
import { d1, access } from "@emdash-cms/cloudflare";
emdash({ database: d1({ binding: "DB" }),
  auth: access({ teamDomain: "myteam.cloudflareaccess.com", audienceEnvVar: "CF_ACCESS_AUDIENCE",
    roleMapping: { Admins: 50, "Content Editors": 40, Writers: 30 }, defaultRole: 20 }) });
```
- Protect the whole `/_emdash/*` path (not just `/_emdash/admin/*`, or the REST API lacks the JWT). Store the app's **Application Audience (AUD) tag** in `CF_ACCESS_AUDIENCE`.
- Options: `teamDomain` (required), `audience` or `audienceEnvVar` (default `"CF_ACCESS_AUDIENCE"`), `autoProvision` (default `true`), `defaultRole` (default `30`), `syncRoles` (default `false` — role fixed at first login, admins may edit; `true` = IdP groups authoritative every login), `roleMapping` (first matching group wins; first user is always Admin).
- Flow: Access redirects to IdP → JWT arrives in `Cf-Access-Jwt-Assertion` → EmDash validates signature/issuer/audience → finds or provisions user → records in Astro session; protected routes re-validate each request. Locally disabled users are still rejected.
- Replaces: login page, passkeys, GitHub/Google/Microsoft/Atmosphere login, magic links, self-signup, invites. Local dev falls back to passkeys (no JWT present).
- Errors: "No Access JWT present" (Access not covering `/_emdash/*`), "JWT audience mismatch" (wrong AUD), "User not authorized" (`autoProvision: false` and user missing).

## 3.16 Email Setup

Source: https://docs.emdashcms.com/guides/email/

- Email powers magic links, invites, account recovery. Exactly **one active provider plugin** delivers mail; with none, email features are unavailable (invite links must be copied manually from Users). Status + **Send test email** under **Settings → Email**.
- **Dev:** `astro dev` auto-activates a built-in **console provider** that logs emails to the terminal and keeps the last 100 in memory; list via `GET /_emdash/api/dev/emails`, clear via `DELETE`. Never runs in production builds. *(gotcha)* This masks a missing production provider — check Settings → Email on the deployed site.
- **Cloudflare Workers:** `cloudflareEmail()` from `@emdash-cms/cloudflare/plugins` sends via Cloudflare Email Sending over a `send_email` Worker binding (no external account/API key). See §9.1.
- **Node / others:** community `emdash-smtp` (https://github.com/masonjames/emdash-smtp) — generic SMTP + Amazon SES, Brevo, Mailgun, Postmark, Resend, SendGrid, Zoho, etc. `pnpm add emdash-smtp`; `emdash({ plugins: [emdashSmtp()] })` with `import { emdashSmtp } from "emdash-smtp"`.
- Credentials live in the plugin's settings page (stored in the DB with other plugin settings; rotate by pasting the new value). Sandboxed plugins **cannot** read `process.env` or platform bindings; native plugins may read `process.env` but must **not** use `import.meta.env` (inlined at build time).
- Troubleshooting: "No email provider is configured" → activate/select one; spam → SPF/DKIM/DMARC at the provider. Hooks: `email:beforeSend`, `email:deliver`, `email:afterSend` (§11.6).

## 3.17 Atmosphere Login (AT Protocol)

Source: https://docs.emdashcms.com/guides/atmosphere-auth/

- `@emdash-cms/auth-atproto` adds **Sign in with Atmosphere** (Bluesky / AT Protocol identity). Users enter a handle (`alice.bsky.social`) and authenticate at their own provider; EmDash never sees a password. Public OAuth client — serves its own metadata at `/.well-known/atproto-client-metadata.json`; no env vars, secrets, or app registration.
```js
import { atproto } from "@emdash-cms/auth-atproto";
export default defineConfig({
  server: { host: "127.0.0.1" },          // required for local dev
  integrations: [emdash({ authProviders: [atproto({ allowedDIDs: ["did:plc:…"], allowedHandles: ["*.example.com", "alice.bsky.social"], defaultRole: 30 })] })],
});
```
| Option | Default | Notes |
| --- | --- | --- |
| `allowedDIDs` | none | Exact DID list (individuals) |
| `allowedHandles` | none | Exact or leading-wildcard (`*.example.com` matches any depth); handle→DID is independently verified via DNS/HTTP so a rogue PDS can't spoof |
| `defaultRole` | `10` (Subscriber) | Role for allowed users after the first; first user is always Admin; no group mapping — adjust in Settings → Users |

- No allowlist → only the first user can sign up; later new accounts get `signup_not_allowed`; already-linked accounts keep working. With any allowlist, **every** login (including existing users) must match; lists are additive (DID **or** handle).
- First user: wizard → **Secure your account** → **Atmosphere** → handle → provider auth → Admin created with the wizard email. OAuth state/tokens stored separately from the EmDash session.
- **Local dev** *(gotcha)*: AT Protocol OAuth requires IP-literal loopback redirect URIs; EmDash rewrites `localhost` → `127.0.0.1`, so run the dev server on `server.host: "127.0.0.1"` and browse `http://127.0.0.1:4321/_emdash/admin` — otherwise the session cookie set on `localhost` is invisible after redirect and you bounce to the login page.
- **Production:** site must be publicly reachable over HTTPS (auth servers fetch the metadata doc). Behind a TLS-terminating proxy set `siteUrl` so the redirect URI matches.
- Troubleshooting: "Account is not in the allowlist" (pattern must start with `*.`; handle DID record must resolve); "Self-signup is not allowed" (no allowlist and not first user — email invites don't link a DID); silent redirect to login (loopback cookie issue); self-hosted handle resolution needs `_atproto.<handle>` TXT `did=<did>` or `https://<handle>/.well-known/atproto-did` (DoH via Cloudflare raced against HTTP).

## 3.18 AI Tools (your site's MCP server)

Source: https://docs.emdashcms.com/guides/ai-tools/

- Built-in MCP server at `https://<site>/_emdash/api/mcp` (local: `http://localhost:4321/_emdash/api/mcp`), **enabled by default**; disable with `emdash({ mcp: false })`. Accepts **OAuth or personal access bearer tokens** — an admin browser session alone does not authenticate MCP. OAuth consent lets the connecting person choose scopes (all requested are preselected; clear what the client doesn't need). Effective permission = token scopes ∩ user role.
- Clients: Claude (remote custom connector → EmDash OAuth flow), ChatGPT / Codex (`codex mcp login emdash-site`), VS Code/Cursor/Windsurf via §11.8.
- Capabilities by natural language: content browse/read/create/edit/publish/schedule/cancel schedule/compare live vs draft/discard draft/duplicate/translations; bylines (Editor role to create/update/delete/translate); media list/details/`media_upload` (base64, enforces MIME + size limits)/`media_create` (confirms a signed upload from `POST /_emdash/api/media/upload-url` by `storageKey`, same user, Author+; Contributors can use `media_upload`)/update alt/delete; search across collections; taxonomies (list/create/rename/move/detach/delete); menus (view/create/rename/replace items/delete); site settings (read = Editor, update = Admin; logo/favicon via uploaded media; SEO defaults; social handles); schema inspect/create/modify (**Admin only**, can destroy field data); revisions view/restore.

| Role | AI can |
| --- | --- |
| Admin | Everything incl. schema + settings updates |
| Editor | All content, media, bylines, taxonomies, menus; view schema; read settings |
| Author | Create content; edit/publish own; upload + manage own media |
| Contributor | Draft content + upload media; no publishing |

- Tips: name the collection explicitly; ask for the schema first; create as draft → review → publish; use compare before publishing; rich text is Portable Text (complex formatting best in the admin editor).
- **WebMCP for visitors' browser agents:** `import WebMcpSearch from "emdash/ui/webmcp-search"` → `<WebMcpSearch collections={["posts", "pages"]} routeMap={{ posts: "/blog/:slug" }} />` registers a read-only `search_site` tool (same public search API as `LiveSearch`; published content from search-enabled collections only; props `collections`, `locale`, `limit` ≤ 100, `routeMap`; returns title, absolute URL, collection, excerpt). No render-time DB cost; no-op without WebMCP; sets `untrustedContentHint`. Experimental API.

## 3.19 x402 Payments

Source: https://docs.emdashcms.com/guides/x402-payments/

- `@emdash-cms/x402` is a **standalone Astro integration** (EmDash optional) implementing the x402 HTTP payment protocol: unpaid request → `402 Payment Required` with machine-readable instructions (`PAYMENT-REQUIRED` header + body); x402-aware agents/browsers pay and retry.
```js
import { x402 } from "@emdash-cms/x402";
export default defineConfig({ integrations: [x402({ payTo: "0xYourWallet", network: "eip155:8453", defaultPrice: "$0.01" })] });
// src/env.d.ts:  /// <reference types="@emdash-cms/x402/locals" />
```
- Route enforcement:
```astro
---
const { x402 } = Astro.locals;
const result = await x402.enforce(Astro.request, { price: entry.data.price ?? "$0.01", description: entry.data.title });
if (result instanceof Response) return result;     // 402 → send to client
x402.applyHeaders(result, Astro.response);          // adds PAYMENT-RESPONSE settlement proof
// result.paid, result.skipped, result.payer
---
```
- Per-entry pricing: add a regular `number` field (e.g. `price`) and read `entry.data.price`.
- Modes: normal (every request must pay); **bot-only** (`botOnly: true`, `botScoreThreshold` default 30) reads Cloudflare `request.cf.botManagement.score` — below threshold = bot → pay; at/above or **missing** (local/non-CF/no Bot Management) = human → skipped. *(gotcha)* Fails open when bot data is absent. `hasPayment(request)` only checks header presence — never use it to unlock content.
- Per-request overrides on `enforce()`: `price`, `payTo`, `network`, `description`, `mimeType`.

| Option | Default | Notes |
| --- | --- | --- |
| `payTo` | required | Wallet |
| `network` | required | CAIP-2 id, e.g. `eip155:8453` (Base), `eip155:1` |
| `defaultPrice` | — | `"$0.10"`, `"0.10"`, `0.10`, or `{ amount, asset, extra }` |
| `facilitatorUrl` | `https://x402.org/facilitator` | Must support your network/asset |
| `scheme` | `"exact"` | |
| `maxTimeoutSeconds` | `60` | |
| `evm` / `svm` | `true` / `false` | Solana needs `pnpm add @x402/svm`, `svm: true`, e.g. `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, optionally `evm: false` |
| `botOnly` / `botScoreThreshold` | `false` / `30` | Cloudflare Bot Management only |

Flow: enforcer placed on `Astro.locals.x402` → `enforce()` checks `payment-signature` header → 402 or facilitator verify+settle → `applyHeaders()`.

## 3.20 Preview Mode

Source: https://docs.emdashcms.com/guides/preview/

**Mechanism:** the admin (**View on site**) generates a URL with a signed, time-limited `_preview` query token (HMAC-SHA256). EmDash middleware verifies it and records which entry it authorizes; `getEmDashEntry()` then returns the draft with `isPreview: true` — same template serves draft (valid matching token) or published (normal request). A token for another collection/entry never grants draft access.

**Secret:** auto-generated per site on first use and stored in the DB — zero config normally. Set `EMDASH_PREVIEW_SECRET` only to share the secret across processes (e.g. a separate signing Worker), pin it for compliance, or restore a known value; env wins over DB. *(gotcha)* The standalone `getPreviewUrl()` helper cannot read the DB-stored secret — set the env var if app code signs links. Anyone with the secret can preview any content.

**Generate URLs (server-side):**
```ts
import { getPreviewUrl } from "emdash";
const secret = process.env.EMDASH_PREVIEW_SECRET;   // throw if missing
await getPreviewUrl({ collection: "posts", id: "my-draft-post", secret, expiresIn: "1h" });
// → /posts/my-draft-post?_preview=eyJ…
// baseUrl: "https://example.com" → absolute;  pathPattern: "/blog/{id}";  pathPattern: "/{locale}/{id}", locale: "pt-br" | "" (empty collapses slashes)
```
`id` may be a DB ID or slug — use whatever the destination route passes to `getEmDashEntry()`. `expiresIn`: default `"1h"`; units `s m h d w` or seconds as a number.
- Admin endpoint: `POST /_emdash/api/content/{collection}/{id}/preview-url` uses the DB ID and supplies locale automatically; set `EMDASH_PREVIEW_PATH_PATTERN` (e.g. `/{locale}/posts/{id}`) when the public route differs from `/{collection}/{id}`; a `pathPattern` in the request body overrides. The endpoint can't substitute the slug — use the helper for slug-based URLs. `{locale}` receives the configured code, not Astro's custom locale `path` mappings.

**Other helpers (from `emdash`):** `verifyPreviewToken({ url | token, secret })` → `{ valid: true, payload: { cid: "posts:my-draft-post", exp, iat } } | { valid: false, error: "none" | "malformed" | "invalid" | "expired" }` (only for code outside the middleware); `generatePreviewToken({ contentId: "collection:id", expiresIn, secret })`; `isPreviewRequest(url)` (presence only); `getPreviewToken(url)`; `parseContentId("posts:my-draft-post")` → `{ collection, id }`.

**Template:** show a banner when `isPreview`; authenticated editors in visual editing already get an injected floating toolbar. Visual-editing hooks: spread `{...entry.edit}` on the article and `{...entry.edit.title}` / `{...entry.edit.content}` on fields → emits `data-emdash-ref` attributes for editors; produces nothing in production.

## 3.21 Backups and Recovery

Source: https://docs.emdashcms.com/guides/backups/

**Key rule:** the JSON backup is **not restorable** — EmDash has no admin action, API, or CLI to import it. Real recovery needs a raw DB backup / point-in-time recovery **plus** a separate media-object copy **plus** the `EMDASH_ENCRYPTION_KEY` rotation list (never stored in the DB, Time Travel, SQL dumps, or JSON). To copy a site elsewhere, use a **site package** (§3.22).

**JSON backup contents:** all entries (drafts, scheduled, trashed), collections/fields, taxonomies/terms/assignments, menus, sections, widget areas, SEO records, revisions, media metadata, migration history, and the `site:` settings group + `emdash:site_title`/`emdash:site_tagline`/`emdash:locale`. **Omits:** users/sessions/passkeys/OAuth/API tokens, plugin storage/settings/secrets, comments/reactions, redirects/404 log, bylines, relations/references, audit logs, rate limits, scheduled-task state, media folders, usage records, in-progress uploads, media bytes, `emdash:site_url`, preview secret, backup schedule. Same snapshot format the preview system uses; versioned by EmDash release.

- **Download:** Settings → Backups → **Download backup** (admin).
- **Automatic:** requires a storage backend (R2/S3/local) → Settings → Backups → **Daily automatic backups** → keep 1–30 → runs on the scheduled maintenance tick (Cloudflare cron trigger / Node built-in scheduler; no cron → use **Back up now**). Stored under `backups/emdash-backup-<timestamp>-<random>.json`; **Stored Backups** list lets you download/delete. *(gotcha)* Archives share the media bucket; EmDash's media route refuses `backups/`, but a public bucket domain/CDN exposes them — scope public domains to the media prefix.
- **Media objects:** `aws s3 sync s3://emdash-media ./emdash-media-backup --endpoint-url https://<account-id>.r2.cloudflarestorage.com` (omit endpoint for AWS). Use read-only creds; store outside the failure domain; restore into an **empty recovery bucket**, validate with a non-production deployment, then switch bindings.
- **D1 Time Travel:** `npx wrangler d1 time-travel info my-database` (record bookmark before risky ops); `npx wrangler d1 time-travel restore my-database --timestamp=…`. Restores the whole DB (content, users, settings, plugin data, migrations) but **not** R2 objects or the encryption key. Deploy the matching app version afterwards; verify sign-in, reads, schema, an encrypted plugin setting, a write.
- **D1 dump:** `npx wrangler d1 export my-database --remote --output=backup.sql` (includes users/auth). Import into an **empty** recovery DB: `npx wrangler d1 execute my-recovery-database --remote --file=backup.sql`. Never execute a full dump against production.
- **SQLite:** stop writers and copy the DB file **with** its `-wal` and `-shm` files, or online: `sqlite3 emdash.db ".backup backup.db"`. Recover by stopping servers, keeping a copy of the damaged DB, swapping in the verified backup, restoring keys/media, starting the matching version, verifying.

## 3.22 Site Transfer (site packages)

Source: https://docs.emdashcms.com/guides/site-transfer/

A **site package** (`.emdash` — uncompressed tar with `manifest.json` first, then `index/`, `records/`, `media/`) is a portable copy of the content model, content, editorial history, presentation, portable settings, and media bytes. Import into a **new, empty** site on any DB (SQLite, PostgreSQL, D1). Import validates everything first, runs in small resumable steps, reads the result back, and issues a **receipt**. Contains author/commenter emails → handle like a DB backup; contains no users/credentials/secrets.

| Mechanism | Purpose | Importable | Media | Users/secrets |
| --- | --- | --- | --- | --- |
| Seed file | Bootstrap model + sample content | Yes (seed semantics) | No | No |
| Preview snapshot | Isolated preview rendering | Preview only | No | No |
| JSON backup | Inspect DB-shaped state | **No** | No | No |
| Raw DB + media backup | Recover one deployment | Same DB type | Separate | Yes |
| Site package | Move a site elsewhere | Yes, empty target | Yes | No (names/emails only) |

**Included:** collections, fields, block types (all versions), taxonomy/relation/byline-field defs; every entry in every locale incl. drafts/scheduled/trashed/revisions/translation groups; terms + assignments, bylines + credits, references, SEO records; menus, widget areas, sections, redirects; comments + reactions (unless disabled; IP hash/UA dropped, voter hashes randomized); media folders/metadata/bytes of ready files; portable settings only: `site:title`, `site:tagline`, `site:logo`, `site:favicon`, `site:postsPerPage`, `site:dateFormat`, `site:timezone`, `site:social`, `site:seo`, `emdash:site_title`, `emdash:site_tagline`, `emdash:locale`. JSON object keys are stored sorted.
**Excluded:** users/sessions/passkeys/OAuth/tokens/clients, plugin storage/state/settings/secrets, other settings (preview secret), audit logs, rate limits, edit locks, task state, 404 log, migration history, media usage records + search indexes (rebuilt), storage keys/bucket/DB/binding names, non-ready media; external-provider media stays external (reference kept). Target keeps `site:url`/`emdash:site_url`, site ID, setup state, backup settings.

**Principals:** each referenced origin user becomes a principal (ID, display name, email; no role/credentials). Map to target users (default: exactly one target user with the same email, case-insensitive) or leave unmapped (references removed; an unmapped author's byline is credited explicitly on their entries so bylines survive). `principal_conflict` blocker when mappings would give one user two bylines in the same locale.

**Target requirements:** admin account; storage backend on both sides; **no content** (setup scaffold from an official template is fine and is removed on confirm); every package locale in target i18n config (no i18n → only `en`; matching case-insensitive, written with target casing = `locale_recased`); `maxUploadSize` ≥ largest media file (default 50 MiB); format version `1`. Check `GET /_emdash/api/admin/transfer/capabilities` (→ `portableDomain.empty` etc.).

**Export:** admin Settings → Transfer → (toggle Include comments) → **Export site** → **Download package** (browser assembles file-by-file with digest checks; Chromium writes to disk, others buffer — CLI recommended > ~500 MB) or **Download as one file** (small sites). CLI: `npx emdash login --url … && npx emdash site export --url … --output site.emdash` (`--no-comments`; rerun to resume). REST (scope `transfer:export`): `POST /_emdash/api/admin/transfer/exports` (optional `{ "comments": false }`, `Idempotency-Key`) → `POST …/exports/{id}/advance` until `nextRequestInMs` is `null` → `GET …/exports/{id}/archive` (or `…/manifest` + `…/files/{path}` for large sites). Export restarts if the site is written to during export (edit locks don't count); fails after 3 attempts with `TRANSFER_EXPORT_CONCURRENT_WRITES`. Files kept **7 days** (`TRANSFER_EXPIRED` after).

**Import:** admin → Settings → Transfer → **Choose package file** (chunked resumable upload; nothing changes until execution) → analysis → review Blockers / Warnings / Differences (transformations) / Starter content to be removed → **Authors** mapping → **Site identity** (package vs target title/tagline) → **Start import** (disabled while blockers exist; editing paused) → receipt with **Verified** badge (**Copy receipt**). CLI: `npx emdash site import site.emdash --url … --analyze` (exit code 2 on blockers; `--map-principal a@x=b@y`, `--map-principal <id>=none`, `--use-target-title`, `--use-target-tagline`) → `npx emdash site import site.emdash --url … --plan sha256:… --confirm`; `emdash site import resume|status|receipt|cancel|abandon <operation-id>`. REST (scopes `transfer:analyze` + `transfer:execute`): `POST …/transfer/imports` with raw `manifest.json` body → `PUT …/imports/{id}/files/{path}` for each missing file (`Content-Length` = declared size, digest must match; poll `…/imports/{id}/missing`) → `POST …/imports/{id}/analyze` until `nextRequestInMs` null (returns `plan` + `planDigest`; POST `{ "decisions": { "principalMappings": { "<id>": null }, "siteTitle": "target" } }` to change) → `POST …/imports/{id}/execute` with `{ packageDigest, planDigest }` → `POST …/imports/{id}/advance` until null → `GET …/imports/{id}/receipt`. Un-executed imports expire after **24 h**.

**Execution stages:** reserve + re-check empty → remove scaffold → create block types/collections/fields/taxonomy/relation/byline defs → copy media + records → terms + bylines → revisions + entries → assignments/credits/references/SEO → menus/widgets/sections/redirects/comments/reactions/settings → rebuild search/caches, queue usage re-index → verify. Each `advance` = one bounded step (fits Workers/D1 limits); idempotent writes; retries with growing `nextRequestInMs`. **Writes are blocked** during import (`503 TRANSFER_IMPORT_IN_PROGRESS`) for admin/REST/plugin routes/comments/scheduled publishing/MCP write tools; reads, sign-in, token mgmt, edit locks, transfer API, and `site_*` MCP tools remain. *(gotcha)* The public site is **not hidden** during/after a failed import — keep the target private until you hold a verified receipt. Resume by reopening the page / `resume` / calling `advance` (a held lease expires within 5 min). **Cancel** stops after the current batch (written records stay). A failed/cancelled import that started writing keeps blocking writes until **Abandon**; afterwards the site is non-empty and can't receive another import.

**Plan findings**
- Blockers (stop execution, `TRANSFER_PLAN_BLOCKED`): `package_invalid`, `unsupported_format`, `unsupported_feature`, `limit_exceeded`, `file_missing`, `file_mismatch`, `record_invalid`, `record_count_mismatch`, `record_order_invalid`, `duplicate_id`, `dangling_reference`, `reference_cycle`, `media_ref_invalid`, `media_blob_missing`, `media_blob_too_large`, `target_not_empty`, `locale_not_configured`, `field_type_unknown`, `principal_conflict`, `integer_out_of_range` (PostgreSQL 32-bit ints), `value_constraint_violation` (same checks as the admin API: field values, redirects, byline URLs/fields, URL patterns, block type slugs/labels ≤ 200 chars, SEO canonical, menu URL schemes), `unique_violation`. Max 500 listed (+ `issues_truncated`).
- Warnings (copied into receipt): `media_provider_external`, `media_row_missing`, `soft_reference_dangling`, `redirect_loops_unchecked`, `issues_truncated`.
- Exporter transformations: `orphan_dropped`, `soft_orphan_dropped`, `orphan_reference_nulled`, `avatar_nulled`, `media_not_ready_dropped`, `media_ref_unlinked`, `media_url_relativized`, `redirect_duplicate_dropped`, `unknown_storage_key`. Import transformations: `principal_mapped`, `principal_unmapped`, `seeded_scaffold_removed`, `redirect_loop_disabled`, `search_unsupported` (PostgreSQL has no full-text search — SQLite/D1 only), `float4_rounded` (PostgreSQL `real` for `number` fields and focal points), `locale_recased`.

**Receipt:** `{ operationId, packageDigest, planDigest, targetSiteId, originSiteId, formatVersion, importerEmDashVersion, completedAt, logicalDigest, counts, warnings, verification: "verified", receiptDigest }`. `receiptDigest` = SHA-256 of canonical JSON minus itself (tamper check; not a signature — fetch from the target over an authenticated connection). Verification compares every record + re-downloads every media file; mismatch → `TRANSFER_VERIFICATION_FAILED` with up to 50 differences.

**Security/scopes:** treat packages as sensitive and as untrusted input (import never runs code/SQL or fetches URLs). Scopes: `transfer:export`, `transfer:analyze`, `transfer:execute` (`admin` includes all; only admins can issue). Audit log actions: `transfer_export_create`, `transfer_import_create`, `transfer_import_execute`, `transfer_import_cancel`, `transfer_import_abandon`, `transfer_import_complete`, `transfer_import_fail`, `transfer_approval_approve`, `transfer_approval_deny`. Staging under `transfers/` prefix (refused by media route; scope public bucket domains). **Agent approvals:** `site_*` MCP tools need Admin; a token lacking `admin`/matching scope gets `TRANSFER_APPROVAL_REQUIRED` + approval ID; an admin approves in Settings → Transfer → **Approval requests** or session-only `POST /_emdash/api/admin/transfer/approvals/{id}/approve|deny`; approvals bind to user+token+args (+digests for imports), expire 15 min pending / 15 min after approval, one use.

**Limits:** `manifest.json` 8 MiB; one record 1,900,000 bytes; one record/index file 4 MiB & 1,000 records; 5,000,000 records and 1,000,000 files per package; JSON depth 64; media ≤ `maxUploadSize`.

**Error codes:** `TRANSFER_TARGET_NOT_EMPTY` 409, `TRANSFER_IMPORT_IN_PROGRESS` 503, `TRANSFER_FENCE_CHECK_FAILED` 503, `TRANSFER_EXPORT_CONCURRENT_WRITES` 409, `TRANSFER_EXPIRED` 410, `TRANSFER_FILE_MISSING`/`_NOT_DECLARED`/`_SIZE_MISMATCH`/`_DIGEST_MISMATCH` 422, `TRANSFER_LIMIT_EXCEEDED` 413, `TRANSFER_MANIFEST_INVALID` 422, `TRANSFER_UNSUPPORTED_FORMAT`/`_FEATURE` 422 (upgrade target), `TRANSFER_CONTAINER_INVALID` 422, `TRANSFER_PLAN_BLOCKED` 409, `TRANSFER_PACKAGE_DIGEST_MISMATCH`/`TRANSFER_PLAN_DIGEST_MISMATCH` 409, `TRANSFER_DECISIONS_INVALID` 422, `TRANSFER_INVALID_STATE` 409, `TRANSFER_LEASE_ACTIVE` 409, `TRANSFER_IDEMPOTENCY_CONFLICT` 409, `TRANSFER_RUNTIME_MISMATCH` 409, `TRANSFER_VERIFICATION_FAILED` 422, `TRANSFER_APPROVAL_REQUIRED`/`_INVALID` 403, `TRANSFER_SCHEMA_UNCLASSIFIED` 500, `INSUFFICIENT_SCOPE` 403.

Hosting providers: provision + setup → confirm `portableDomain.empty` → token with `transfer:analyze` + `transfer:execute` → import, refuse plans with blockers → check receipt (`verification`, `packageDigest`, `planDigest`, `targetSiteId`, `receiptDigest`) → promote.

## 3.23 Internationalization (i18n)

Source: https://docs.emdashcms.com/guides/internationalization/

**Enable:** add Astro's `i18n` block; EmDash reads it for locales, default, and fallback chain. No `i18n` block → single-language behavior.
```js
i18n: { defaultLocale: "en", locales: ["en", "fr", "es"], fallback: { fr: "en", es: "en" } }  // NO routing block
```
*(gotcha)* Any strategy that prefixes the default locale (`routing: { prefixDefaultLocale: true }` or `"prefix-always"`) breaks the admin — `/_emdash/admin` returns 404 (API under `/_emdash/api/*` unaffected). Use the default `prefix-other-locales`; if public URLs must include the default locale, redirect/rewrite (`/` → `/en/`) in front of the site.

**Model — row per locale:** each translation is its own row with its own `id`, `slug`, `status`, revisions, linked by a shared `translation_group`. → per-locale slugs (`/blog/my-post`, `/fr/blog/mon-article`), per-locale publishing/scheduling, per-locale revisions; list queries return one locale only. `entry.id` = slug (for URLs); `entry.data.id` = DB ID (for APIs, `getTranslations()`, `getEntryTerms()`).

**Querying**
- Always pass `locale: Astro.currentLocale` to `getEmDashEntry()`/`getEmDashCollection()` on multilingual routes (slugs may exist in several locales).
- Fallback (single-entry only): requested → configured fallback → default. Uses the same `id`, so `about` can fall back to an English `about`, but `a-propos` can't find `about`. Result includes `fallbackLocale` when used. Preview/visual editing may return drafts.
- Menus are per-locale (same `name`, shared `translation_group`); `getMenu("primary", { locale })`; menu items store `reference_id` = referenced content's translation group, so cloned translated menus link correctly. Create menu translations from the **Menus** list.
- Taxonomies: terms per locale (labels translatable; `hierarchical`/`collections` shared); `content_taxonomies.taxonomy_id` stores the term's translation group → one assignment spans all locales; translating content inherits assignments. `getTaxonomyTerms("category", { locale })`, `getEntryTerms("posts", post.data.id, undefined, { locale })`.
- Locale-mismatch repair: startup warns when taxonomy defs/terms use a locale outside `i18n.locales`; back up, inspect `_emdash_taxonomy_defs` and `taxonomies` rows, `UPDATE … SET locale = 'ja' WHERE id = …` with exact casing, checking uniqueness first.
- Language switcher: `const { translationGroup, translations } = await getTranslations(collection, entry.data.id)` → `[{ locale, id, slug, status }]` — includes drafts/scheduled, so filter `status === "published" && slug !== null` before rendering; build hrefs with `getRelativeLocaleUrl(translation.locale, "/blog/" + translation.slug)`.

**Admin:** content list gains a locale column + filter. Entry sidebar **Translations** panel: **Translate** (creates a pre-filled draft with default slug `{source-slug}-{locale}`) / **Edit** / checkmark for current. Each translation publishes independently.

**REST/CLI:** list routes accept `?locale=fr`; slug-based single-entry routes too (DB IDs are global). Create a translation: `POST /_emdash/api/content/posts` with `X-EmDash-Request: 1` and body `{ "locale": "fr", "translationOf": "<source DB id>", "slug": "mon-article", "data": {...} }` (starts as draft). List: `GET /_emdash/api/content/posts/<id>/translations`. CLI: `emdash content list posts --locale fr`, `emdash content get posts my-post --locale fr`, `emdash content create posts --locale fr --translation-of <id> --slug mon-article --data '{…}' --draft` (`content create` needs `--data`/`--file`/`--stdin`; publishes unless `--draft`).

**Seeds:** entries carry `locale` and `translationOf` (source `id` in the seed); the source must appear before its translations.

**Translatable fields:** each field has `translatable` (default `true`). Translatable → pre-filled for editing; non-translatable → copied and kept in sync across the group (publishing copies changed non-translatable values to siblings; a sibling's pending draft keeps its own value until it publishes). System fields (`status`, `published_at`, `author_id`) are always per-locale. Reference fields are shared (keyed by translation group).

**URLs:** `getRelativeLocaleUrl` from `astro:i18n`. Sitemaps (`/sitemap-{collection}.xml`) are locale-aware: each translation is its own `<url>` with `xhtml:link` alternates + `x-default`, grouped by `translation_group`; locales missing from `i18n.locales` omitted; single-locale sites emit no `xhtml` namespace.

**hreflang in head:** automatic with `<EmDashHead>` when i18n is on and the page context has `content` (one `<link rel="alternate">` per published sibling incl. self + `x-default`). Manual: `getHreflangAlternates("posts", entry.data.id, { siteUrl: Astro.url.origin })` → `[{ hreflang, href }]`. Rules: `x-default` = default-locale variant (falls back to first routable); unpublished and `noindex` siblings excluded (a `noindex` current entry returns none); unroutable locales dropped; untranslated entries still get self + `x-default`; i18n off → empty; needs an absolute site URL (arg or site settings) else `[]`.

**WordPress import:** WXR carries no WPML/Polylang locale structure → everything lands in the default locale; create translations afterwards with `emdash content create … --locale fr --translation-of <id> --draft`.

---

# Part 4 — Plugins (for site operators)

## 4.1 Plugin overview

Source: https://docs.emdashcms.com/plugins/overview/

Plugins can: react to events (content saves, media uploads, comment moderation, scheduled tasks, plugin lifecycle); store data (indexed collections + per-plugin KV); add admin pages and dashboard widgets (auto-generated settings forms); serve API routes at `/_emdash/api/plugins/<id>/<route>`; call external APIs against declared host allowlists; send email through the configured provider.

**Two formats**

| | Sandboxed | Native |
| --- | --- | --- |
| Runs in | Separate runtime via a configured sandbox runner | Same process as the Astro site |
| Installed by | Admin from the registry, or `sandboxed: []` in `astro.config.mjs` | npm + `plugins: []` in `astro.config.mjs` (requires deploy) |
| Access | Only declared EmDash plugin APIs; platform resource limits | Full runtime access; React admin pages, Portable Text renderers, page fragments |

Prefer sandboxed unless you need React admin UI, PT renderers, page fragments, or direct process access. EmDash plugins are **not** Astro integrations — they are passed into `emdash({...})`; a package needing both can be an Astro integration that also registers EmDash hooks.

## 4.2 Installing plugins

Source: https://docs.emdashcms.com/plugins/installing/

**Registry installs require:** admin with `plugins:manage`; configured storage (for downloaded bundles); an available sandbox runner.
- Cloudflare: `import { sandbox } from "@emdash-cms/cloudflare"` → `emdash({ sandboxRunner: sandbox() })`. Uses **Worker Loader** (one Worker per plugin); needs the **Workers Paid plan** and a `worker_loaders` binding named `LOADER`; the site's Worker entry must export the `PluginBridge` class (templates do; the `LOADER` binding is commented out so the free plan works). Without `LOADER`: registry browsing works, config-managed sandboxed plugins don't load, install/update returns `SANDBOX_NOT_AVAILABLE`. `sandbox()` reads the effective Wrangler config at build time.
- Node.js: `npm install @emdash-cms/sandbox-workerd workerd` → `emdash({ sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox" })` (runs plugin code in a separate `workerd` process). See §9.9.

**Install from registry:** admin **Registry** → search → detail page → pick release, review publisher/metadata/permissions/verification → **Install** → consent dialog (verified identifiers + permissions) → confirm. Plugin appears under **Plugins** (disable/configure).

**Permission vocabulary (consent dialog)**

| Permission | Grants |
| --- | --- |
| `content:read` | Read content |
| `content:write` | Create/update/delete content |
| `content:revisions:read` | Read revision history |
| `schema:read` | Read collection/field definitions |
| `bylines:read` | Read byline profiles + credits |
| `redirects:read` / `redirects:write` | Read / change redirect rules |
| `media:read` | Safe metadata for ready media |
| `media:bytes:read` | File contents + content hash |
| `media:metadata:write` | Alt, captions, focal points |
| `media:write` | Upload/replace/delete media |
| `network:request` | Requests to the plugin's allowed hosts |

Dialog also flags plugin routes exposed as MCP tools. An approved permission authorizes the described operation regardless of sandboxing — install only from trusted publishers.

**Update:** Plugins → **Check for updates** → **Update** → consent (re-confirmation required when permissions/MCP tools are added or a route goes authenticated→public; old version stays until approved). Explicit updates only move forward; "follow latest" can roll back if the publisher withdraws a release; otherwise downgrade = uninstall + install the older release. **Uninstall:** Plugins → expand → Uninstall → optional **Also delete plugin storage data** (kept by default).

**npm installs:** native plugins and config-managed sandboxed plugins are npm deps; follow the package README for `plugins: []` vs `sandboxed: []`. Example native: `import { fieldKitPlugin } from "@emdash-cms/plugin-field-kit"` → `emdash({ plugins: [fieldKitPlugin()] })`. Config-managed plugins change via dependency update + deploy; not manageable from the admin.

| | Registry | npm `sandboxed: []` | npm `plugins: []` |
| --- | --- | --- | --- |
| Install/update | Admin | Dependency + deploy | Dependency + deploy |
| Execution | Sandbox runner | Sandbox runner | Site process |
| EmDash access | Declared APIs | Declared APIs | Declared APIs + process |
| Node APIs / direct `fetch()` | No | No | Yes |
| React admin / PT renderers | No | No | Yes |

## 4.3 Plugin registry

Source: https://docs.emdashcms.com/plugins/registry/

- Public catalog: https://plugins.emdashcms.com. Default aggregator when a sandbox is enabled: `https://registry.emdashcms.com` (override/disable via the `registry` config option, §11.1).
- **Public names** = publisher's Atmosphere handle + package slug: `@example.com/my-gallery`. EmDash resolves the handle to the publisher's stable account ID before loading. If a handle conclusively stops resolving to the publisher → **INVALID HANDLE**, new installs blocked (existing installs untouched); temporary lookup failure → **Handle unavailable**.
- Install flow adds: checksum, name, version, and permission checks on the downloaded bundle; **build provenance** verified when the publisher requires it; any failure stops installation before the consent dialog.
- Related: read-only discovery client (§6.19), publishing (§6.11), capabilities (§6.10).

## 4.4 Migrate from Marketplace (legacy)

Source: https://docs.emdashcms.com/plugins/migrate-from-marketplace/

- Sites with the deprecated `marketplace` option use the registry for new discovery after upgrading; existing Marketplace plugins keep running and updating **while the option remains**.
- Steps: ensure `sandboxRunner` is configured (registry becomes default when `sandbox` isn't `false`) → keep `marketplace: "https://marketplace.emdashcms.com"` during migration → Plugins → **Check for updates** → for each **Marketplace** plugin: keep temporarily, replace with a registry package, or uninstall (optionally deleting storage) → only after all are gone, remove the `marketplace` option and restart.
- Marketplace and registry installs have separate identities/bundles/storage — installing a registry package does not convert or copy data; follow the publisher's migration notes. *(gotcha)* Removing `marketplace` early doesn't uninstall plugins but prevents further Marketplace updates.

## 4.5 Upgrading plugins on your site

Source: https://docs.emdashcms.com/plugins/upgrading-sites/

- `pnpm up --latest emdash @emdash-cms/plugin-audit-log @emdash-cms/plugin-webhook-notifier @emdash-cms/plugin-atproto && pnpm build`.
- **Breaking:** three first-party plugins switched from named export + factory call to a **default export passed directly** (per-install config moved to the plugin's admin settings page):

| Package | Old | New | Goes in |
| --- | --- | --- | --- |
| `@emdash-cms/plugin-audit-log` | `import { auditLogPlugin }` … `auditLogPlugin()` | `import auditLog` … `auditLog` | `plugins:` (in-process) |
| `@emdash-cms/plugin-webhook-notifier` | named + `()` | `import webhookNotifier` … `webhookNotifier` | `sandboxed:` |
| `@emdash-cms/plugin-atproto` | named + `()` | `import atproto` … `atproto` | `sandboxed:` |

Other native plugins (e.g. Field Kit `fieldKitPlugin()`) keep their own shapes. A third-party plugin still shipping a factory hasn't been updated for this release.

---

# Part 5 — Migration from WordPress

## 5.1 Migrate from WordPress (operator procedure)

Source: https://docs.emdashcms.com/migration/from-wordpress/

**Prep:** back up WP DB + `wp-content/uploads`; EmDash site with storage (for media copy); admin with `import:execute`; either a full WXR export or the **EmDash Exporter** WP plugin. Record permalinks, canonical origin, redirects, menus, post types, taxonomies, plugin-owned fields.

| Method | Use when | Data |
| --- | --- | --- |
| WXR upload | You can use WP Tools → Export | Posts, pages, CPTs, terms, reusable blocks, authors, attachment **URLs** (no bytes) |
| EmDash Exporter | You control the WP site | Authenticated content + comments, menus, site settings, SEO fields, taxonomies, media metadata |

URL-only entry = REST probe (detect + count public posts/pages/media; no import). WordPress.com: WXR or Exporter only (no OAuth source).

**Exporter connection:** WP **Tools → EmDash Migration** → generate migration key → paste in EmDash; or enter the WP URL and authorize via the WP application-password screen (local HTTP dev: enter username + application password manually — callback needs HTTPS). Exporter exposes `emdash/v1` API endpoints; no DB access.

**Admin flow** (`/_emdash/admin/import/wordpress`): Connect → Analyze (post types, required fields, authors, attachments, schema compatibility) → Review (target collection per post type; author→user mapping, unmapped authors → guest bylines; exporter-only switches: menus, title/tagline, logo/favicon, SEO values) → Prepare (creates missing collections/fields; **incompatible** = existing field with same slug but different type blocks that mapping — importer never coerces types) → Import (exporter path runs bounded `content` / `comments` / `finalize` phases) → Copy media (downloads bytes via storage adapter, rewrites matching URLs).

Schema states: **Ready** / **New collection** / **Add fields** / **Incompatible**.

**Conversion rules**
- Status: `publish` → `published`; `draft`, `pending`, `private`, `future`, `trash`, unknown → `draft`. Scheduled dates/visibility not reconstructed — review all drafts.
- Gutenberg and Classic HTML → Portable Text (inspect embeds, shortcodes, page builders, plugin blocks). `wp_block` reusable blocks → **sections** (source `import`), not entries.
- Mappings: `post`→`posts`, `page`→`pages`; CPTs → sanitized slug; internal WP types excluded. Prepare adds standard title / Portable Text content / excerpt / featured-image fields.
- Custom fields: WXR analysis lists non-internal meta keys as suggestions only (not copied); Exporter can copy custom meta and ACF values into matching fields and create/populate featured-image and Yoast/Rank Math SEO fields when switches are on. Review serialized PHP, repeaters, flexible content.
- Authors: mapped author = entry owner; presentation via bylines; unmapped → guest byline created/reused.
- Taxonomies: categories/tags → matching definitions; Exporter can create custom taxonomy defs; WXR custom taxonomy without a definition → reported missing, assignments skipped.
- Media: dedupe by **SHA-1 of downloaded bytes** (stored as `sha1:` prefix; not filenames/IDs); source must stay reachable; attachment redirects validated (private-network redirects fail).
- WXR carries no locale/translation structure → everything lands in the default locale (§3.23).

**Retry:** existing entries matched by **collection + slug + locale** (not WP ID) → a changed slug creates a duplicate; media rerun reuses byte-identical files; exporter flow is chunked with browser-held cursors/ID maps — restarting reprocesses pages and rebuilds maps from skipped entries. The admin has no durable WXR resume; `emdash import wordpress --resume` is a separate CLI file-conversion workflow (`.wp-migration-progress.json`), not an admin resume. Never delete/redirect the WP origin after an interrupted import.

**Verify before cutover:** counts by type/status; representative Gutenberg/Classic/shortcode/builder pages; featured + inline media on EmDash URLs; authors/bylines/taxonomies/translations; menus/comments/identity/SEO (exporter); crawl old URLs → redirects; drafts inaccessible to logged-out visitors. Keep WP until production is proven.

**Troubleshooting:** unparseable XML → re-export without re-encoding; incompatible collection → change mapping or reconcile field type in Content Types; media download failures → public reachability, existence, no private-network redirects.

## 5.2 Content import (API contracts)

Source: https://docs.emdashcms.com/migration/content-import/

Sources: `wxr` (file), `wordpress-plugin` (URL + Exporter credentials), `wordpress-rest` (probe only). All admin endpoints require an admin session with `import:execute` and `X-EmDash-Request: 1`; envelope `{ "success": true, "data": … }` / `{ "success": false, "error": { "code", "message" } }`.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /_emdash/api/import/probe` | `{ "url" }` | `{ success, result: { url, isWordPress, bestMatch, allMatches } }` (REST match ⇒ recommends WXR) |
| `POST /_emdash/api/import/wordpress/analyze` | multipart `file` | site, post-type analysis, attachments, authors, taxonomy counts, custom-field suggestions |
| `POST /_emdash/api/import/wordpress/prepare` | `{ "postTypes": [{ "name", "collection", "fields": [{ slug, label, type, required, searchable }] }] }` | `success`, `collectionsCreated`, `fieldsCreated`, per-collection `errors` |
| `POST /_emdash/api/import/wordpress/execute` | multipart `file` + `config` JSON string: `postTypeMappings`, `skipExisting`, optional `authorMappings`, `importSections`, `locale` | `success`, `imported`, `skipped`, `errors`, `byCollection`, section/taxonomy summaries |
| `POST /_emdash/api/import/wordpress/media` | `{ "attachments": [...], "stream": true }` | streaming NDJSON `progress`… then `result` (no envelope); `stream: false` → envelope around `{ imported, failed, urlMap }` |
| `POST /_emdash/api/import/wordpress/rewrite-urls` | `{ "urlMap": { old: new }, "collections": ["posts"] }` | updated-entry and rewritten-URL counts + errors |
| `POST /_emdash/api/import/wordpress-plugin/analyze` | `{ "url", "token" }` (`token` = Base64 Basic auth of WP user + application password) | `{ success, analysis }` |
| `POST /_emdash/api/import/wordpress-plugin/execute` | `url`, `token`, `config`, `phase` (`content` / `comments` / `finalize`) | `done`, next `cursor`, partial `result`, `chunk` (`idMap`, `translationGroups`, `commentRoots`) — client merges and resends |

URL rewriting after media copy covers Portable Text, text, string, image, and file fields. Prefer the admin workflow; test integrations against the installed EmDash version.

## 5.3 Porting WordPress plugins

Source: https://docs.emdashcms.com/migration/porting-plugins/

**Should it be ported?** Yes for plugin-owned behavior (validation, external APIs, background work, custom records, settings, admin tools). No for WP concerns Astro/EmDash already replace (PHP caching, rewrite rules, template selection, core globals). A CPT/fields-only plugin → make a collection + seed file, not a plugin.

| Requirement | Sandboxed | Native |
| --- | --- | --- |
| Registry install | Yes | No |
| Isolated runtime | Yes (with runner) | No |
| Hooks, routes, KV, structured storage | Yes | Yes |
| Block Kit admin pages | Yes | Yes |
| Custom React admin | No | Yes |
| Astro components for public rendering | No | Yes |
| Raw page fragments | No | Yes |

**Sandboxed package** (`emdash-plugin init`): `emdash-plugin.jsonc` (identity, publisher, capabilities, `allowedHosts`, `storage` with indexes; version from `package.json`) + `src/plugin.ts` default-exporting an object `satisfies SandboxedPlugin` (from `emdash/plugin`) + `tests/plugin.test.ts`. Hooks use `{ handler: async (event, ctx) => … }`; routes use `{ handler: async (routeCtx, ctx) => … }` and mount at `/_emdash/api/plugins/<slug>/<route>`. A storage field must be declared in `indexes` before `where`/`orderBy` can use it. Build with `emdash-plugin build`; no hand-written `src/index.ts` descriptor.

**Native package:** `src/index.ts` exports a descriptor factory returning `PluginDescriptor` (`id`, `version`, `format: "native"`, `entrypoint`, `capabilities`, `options`) **and** `createPlugin()` built with `definePlugin({ id, version, capabilities, admin: { settingsSchema }, hooks })` (default export). Optional `src/admin.tsx` and `src/astro/index.ts` as separate package exports. Native hook handlers are plain functions; native route handlers take one combined context. Keep descriptor and runtime `id`/`version`/capabilities/entrypoints aligned.

**Hook intent map**

| WordPress | EmDash |
| --- | --- |
| `register_activation_hook()` | `plugin:install` (first install) / `plugin:activate` (enable) |
| `register_uninstall_hook()` | `plugin:uninstall` |
| `wp_insert_post_data` | `content:beforeSave` |
| `save_post` | `content:afterSave` |
| `before_delete_post` | `content:beforeDelete` |
| `deleted_post` | `content:afterDelete` |
| `wp_handle_upload_prefilter` | `media:beforeUpload` |
| `add_attachment` | `media:afterUpload` |

Capabilities by API: `content:read` (read + content hooks exposing entry data), `content:write` (implies read), `media:read`, `media:write` (implies read), `network:request` (`ctx.http` to `allowedHosts`).

**Storage mapping:** `get_option`/`update_option` → `ctx.settings.get/set` (user config; declare credentials as `secret` fields in `admin.settingsSchema` for encryption) or `ctx.kv` (small internal values); custom tables → declared `ctx.storage.<collection>` with indexes on every `where`/`orderBy` field, e.g. `"storage": { "jobs": { "indexes": ["status", "createdAt"] } }` then `ctx.storage.jobs.put(id, {...})` / `.query({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, limit: 50 })`. Never open the EmDash DB or build SQL. REST routes → plugin routes with `inputSchema`. Admin UI: sandboxed = Block Kit + routes/KV; native = `admin.settingsSchema` or `adminEntry` React. Files → media APIs (sandboxed has no filesystem; native local files aren't portable).

**Procedure:** inventory (hooks, options, tables, cron, REST, admin pages, blocks, shortcodes, hosts) → drop what Astro/EmDash/platform owns → pick format, record capabilities + hosts → define KV keys + storage collections + indexes → port one behavior at a time with tests → add admin UI last → test install/upgrade/activate/deactivate/uninstall (with and without data deletion)/capability changes. *(gotcha)* Native ports run with host-process privileges — capability declarations gate `PluginContext` but not env vars, direct network, or the event loop.

---

# Part 6 — Plugin Development

## 6.1 Choosing a plugin format

Source: https://docs.emdashcms.com/plugins/creating-plugins/choosing-a-format/

Default to **sandboxed**; go **native** only for native-only surfaces. The formats differ in authoring shape, install path, and trust boundary.

| | Sandboxed | Native |
| --- | --- | --- |
| Authoring | `emdash-plugin.jsonc` + `src/plugin.ts` | `definePlugin()` descriptor |
| Install | One-click from admin registry | `npm install` + edit `astro.config` + redeploy |
| Runs in | Isolated runtime via sandbox runner | Astro site process |
| `ctx` capability gating | Enforced by the sandbox bridge | Gated by `PluginContext` but **not a security boundary** |
| Resource limits | Runner CPU/subrequest/wall-time limits + platform memory | None per plugin |
| Network | `ctx.http` restricted to declared hosts | `ctx.http` honors declarations, but code can call `fetch()` |
| Direct `fetch()` / `process.env` | Blocked | Possible |
| Distribution | Signed registry release | npm |
| Admin UI | Block Kit (JSON-described) | React or Block Kit |
| Settings UI | Block Kit page + `ctx.settings` | `admin.settingsSchema` auto-form or Block Kit |
| Portable Text render components | No | `componentsEntry` (Astro components) |
| Page metadata | `page:metadata` hook (meta/property, allowlisted `<link>` rels, JSON-LD) | Same |
| Page fragment injection | No | `page:fragments` (inline/external scripts, raw HTML) |
| Constructor options | None — read settings/KV at runtime | `options` on the descriptor |

**Native costs:** project-level install on every site; no isolation (a bug can crash the host or exhaust CPU; an unhandled hook rejection takes the request down); trust burden — capability declarations can't describe everything native code can do.

**Go native for exactly three things:** (1) custom React admin pages/widgets (beyond Block Kit); (2) custom Portable Text block types whose editing config + Astro renderers load from npm at build time; (3) shipping raw HTML/JS/CSS to visitors via `page:fragments`. If the "injection" need is SEO/structured data, stay sandboxed and use `page:metadata` — allowed `<link>` rels are `canonical`, `alternate`, `author`, `license`, `nlweb`, `site.standard.document` (resource-loading rels like `stylesheet`/`prefetch` are deliberately excluded).

**Shared runtime:** both use `PluginContext`, storage, KV, and most hook names. Sandboxed hook handlers `(event, ctx)`, sandboxed route handlers `(routeCtx, ctx)`, native route handlers a single context object.

**Runners:** `sandboxRunner` is pluggable. Shipped: `sandbox()` from `@emdash-cms/cloudflare` (each plugin = Dynamic Worker via Worker Loader) and `@emdash-cms/sandbox-workerd/sandbox` (a `workerd` child process on Node). No runner or unavailable runner → `sandboxed: []` plugins are **not loaded** (startup warning). Moving a sandboxed plugin into `plugins: []` runs it in-process: capabilities still gate `ctx`, but there is no isolation or limits — treat it as native for trust purposes.

## 6.2 Your first sandboxed plugin (tutorial)

Source: https://docs.emdashcms.com/plugins/creating-plugins/your-first-plugin/

**Prereqs:** Node + pnpm; a site with a sandbox runner; an Atmosphere handle/DID for the manifest `publisher`.

```bash
pnpm dlx @emdash-cms/plugin-cli init save-log   # asks publisher, author, security contact, repo
cd save-log && pnpm install
```
Scaffold: `.agents/skills → ../skills`, `.claude/CLAUDE.md → ../AGENTS.md`, `.claude/skills`, `AGENTS.md`, `emdash-plugin.jsonc`, `package.json`, `pnpm-workspace.yaml`, `README.md`, `skills/creating-plugins/SKILL.md`, `src/plugin.ts`, `tests/plugin.test.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`.

**Manifest essentials for the tutorial:** `"capabilities": ["content:read"]` (because `content:afterSave` exposes saved content — also required when running in-process), `"allowedHosts": []`, `"storage": { "events": { "indexes": ["savedAt"] } }` (accessing an undeclared `ctx.storage.<name>` throws).

**Runtime (`src/plugin.ts`)** — a `SandboxedPlugin`-typed constant (type from `emdash/plugin`) exported as default; the annotation types `event`/`ctx` without bundling the runtime:
```ts
import type { SandboxedPlugin } from "emdash/plugin";
const plugin: SandboxedPlugin = {
  hooks: {
    "content:afterSave": {
      handler: async (event, ctx) => {
        const savedAt = new Date().toISOString();
        const contentId = String(event.content.id);
        await ctx.storage.events.put(`${savedAt}:${contentId}`, { savedAt, collection: event.collection, contentId });
        ctx.log.info("Content save recorded", { collection: event.collection, contentId });
      },
    },
  },
  routes: {
    health: { public: true, handler: async (_routeCtx, ctx) => ({ ok: true, plugin: ctx.plugin.id }) },
  },
};
export default plugin;
```
Public routes are internet-facing — see §6.6 for auth/CSRF before exposing real data.

**Test** (`@emdash-cms/plugin-test`, vitest): `host = await createPluginTestHost(); await host.invokeRoute("health")` → `{ ok: true, plugin: "save-log" }`; `await host.dispose()` in `afterEach`. Runs through Worker Loader + `PluginBridge`. (A separate testing guide exists at `/plugins/creating-plugins/testing/`.)

**Build:** `pnpm run validate && pnpm run typecheck && pnpm run test && pnpm run build` → `dist/plugin.mjs` (hooks/routes), `dist/manifest.json` (runtime manifest + discovered hook/route names), `dist/index.mjs` (default-exported descriptor a site imports). `dist/` is gitignored build output.

**Register in a site:** `pnpm add file:../save-log`, then `import saveLog from "save-log"` → `emdash({ sandboxed: [saveLog], sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox" })` (keep whatever runner the site already uses). Run `pnpm dev` in the plugin (watch rebuild) and the site's dev command; hit `http://localhost:4321/_emdash/api/plugins/save-log/health` → `{ "success": true, "data": { "ok": true, "plugin": "save-log" } }`. Saving an entry logs `Content save recorded` and writes to `events`.

## 6.3 The plugin manifest (`emdash-plugin.jsonc`)

Source: https://docs.emdashcms.com/plugins/creating-plugins/manifest/

JSONC (comments + trailing commas OK) at the plugin root next to `package.json`. Keep the `$schema` (`./node_modules/@emdash-cms/plugin-cli/schemas/emdash-plugin.schema.json`). `emdash-plugin validate` is the full offline check.

**Identity**

| Field | Required | Rules |
| --- | --- | --- |
| `slug` | Yes | Lowercase letter start; lowercase letters, digits, `-`, `_`; ≤ 64 chars. Used in route URLs; **not** the npm name (`gallery` for `@example/plugin-gallery`) |
| `publisher` | Yes | Atmosphere DID (recommended — handles can change owners) or handle |
| `version` | Sometimes | Semver 2.0 without build metadata. Omit when `package.json` supplies it; if both set they must match; if neither, build fails |

**Package profile** (stable across releases; created on first `publish`, later edited only via `emdash-plugin update-package [--yes]`)

| Field | Required | Rules |
| --- | --- | --- |
| `license` | Yes | SPDX expression ≤ 256 chars |
| `author` **or** `authors` | Yes | `author`: `name` ≤ 64 graphemes + optional `url`/`email`; `authors`: 1–32 entries |
| `security` **or** `securityContacts` | Yes | Each has `email` and/or `url`; 1–8 entries |
| `name` | No | Display name ≤ 100 graphemes (slug used otherwise) |
| `description` | No | ≤ 140 graphemes |
| `keywords` | No | ≤ 5 strings, each ≤ 64 graphemes |
| `sections` | No | CommonMark for `description`, `installation`, `faq`, `changelog`, `security` — inline string or `{ "file": "./docs/x.md" }` (must stay inside the manifest dir); each ≤ 20,000 bytes and 2,000 graphemes |

**Trust contract** — `capabilities`, `allowedHosts`, `storage` (all default empty; scaffold writes them explicitly). `network:request` requires ≥ 1 bare hostname in `allowedHosts` (wildcards like `*.cdn.example.com` allowed); `network:request:unrestricted` requires an **empty** list. `storage` keys = plugin-owned collections with `indexes` (strings or composite arrays like `["collection", "savedAt"]`) and `uniqueIndexes`. *(gotcha)* Any change to the trust contract needs a new version (sites consented to the old one); broadening → major version.

**Admin declarations** (Block Kit): `"admin": { "pages": [{ "path": "/settings", "label": "Settings", "icon": "settings" }], "widgets": [{ "id": "recent-events", "title": "Recent events", "size": "half" }] }`. Paths start with `/` (letters, digits, `/`, `_`, `-`); widget IDs use slug characters; sizes `full` | `half` | `third`. Declaring a page/widget requires a route named `admin` in `src/plugin.ts` (bundle check fails otherwise).

**Release fields:** top-level `repo` (HTTPS URL; automated releases need a canonical public GitHub URL); `release.requires` keyed by `env:emdash`, `env:astro`, or a package DID → semver ranges (checked before install; invalid range fails validation); `release.artifacts.icon` / `.banner` / `.screenshots[]` (≤ 8, each `{ file, lang? }` with BCP 47 `lang`). Artifacts: PNG/JPEG/WebP, ≤ 1 MiB, ≤ 8,192 px per side, inside the manifest dir; uploaded separately from the bundle with type/dimensions/checksum/PDS blob ref recorded.

**Publisher pinning:** CLI compares the manifest `publisher` (handle resolved to DID) with the active session before publish/release prep; mismatch → `MANIFEST_PUBLISHER_MISMATCH` (no override). Fix with `emdash-plugin whoami` / `emdash-plugin switch <did>`. A handle pin can be hijacked by a handle move; a DID is stable.

**Validate:** `emdash-plugin validate [path]` — offline; reports duplicates, unknown fields, invalid values, mutually exclusive forms, cross-field errors.

## 6.4 The `emdash-plugin` CLI (`@emdash-cms/plugin-cli`)

Source: https://docs.emdashcms.com/plugins/creating-plugins/cli/

Install as pinned dev dep (`pnpm add -D @emdash-cms/plugin-cli`); run via `pnpm exec emdash-plugin`; use `pnpm dlx` only for the one-off `init`. Uses an Atmosphere account as publisher identity.

| Command | Purpose |
| --- | --- |
| `init [name]` | Scaffold (interactive; or `--yes --publisher <did> --author-name … --security-email …`; `--use-detected` opts into session/Git defaults; `--package-manager` override; pnpm scaffold includes the esbuild build-script policy) |
| `build` | Emit `dist/plugin.mjs` (+`.d.mts`), `dist/manifest.json`, `dist/index.mjs` (+`.d.mts`, only when a sibling `package.json` exists) |
| `dev` | Watch `src/**`, manifest, `package.json`; 150 ms debounce; serialized; failed rebuild keeps last good `dist/` |
| `validate [path]` | Offline schema + cross-field check with `file:line:column` diagnostics |
| `bundle` | `build` → validate bundle (no Node builtins, size limits, capability sanity) → collect README/icon/screenshots → `dist/<slug>-<version>.tar.gz` (`plugin.mjs` packed as `backend.js`); `--validate-only` skips the tarball |
| `publish` | Build, validate, upload bundle + listing images to your PDS, write the release record; enforces publisher pinning; `--url <https-url>` for an externally hosted bundle (+ `--local <path>` to verify a local tarball matches); legacy profile flags / `--no-manifest` still exist |
| `update-package [--yes]` | Dry-run/apply package-profile changes from the manifest; CID precondition → `STALE_RECORD` on race; removed optional properties keep their published value |
| `profile setup` | Create/augment the signed package profile for delegated releases (`--dir`, `--repository <url>`, `--provenance required\|optional` [default `required`], `--confirmation escalation-only\|always` [default `escalation-only`], `--yes`) |
| `release setup` | `profile setup` + generate `.github/workflows/emdash-release.yml` at repo root (`--service-url` default `https://releases.emdashcms.com`, `--action-ref` default `main`, `--trigger auto\|changesets\|tags\|manual`, `--force`) — never pushes |
| `release plan` | Workflow helper: `--published-packages <json>` (Changesets output → matrix in `GITHUB_OUTPUT`) or `--package <slug[@version]>` |
| `release prepare <slug[@ver]>` | Workflow resolver: finds the manifest, checks tag version, builds, writes outputs |
| `login <handle-or-did>` / `logout [--did]` / `whoami` / `switch <did>` | Publisher sessions |
| `search <query>` | Free-text registry search |
| `info <handle-or-did> <slug>` | Package details; `--version X --watch` follows listing checks after publish (reads the labeler before approval); `--labeler-url` / `EMDASH_LABELER_URL` |

Script-oriented commands support `--json`; discovery commands accept `--registry-url <url>` / `EMDASH_REGISTRY_URL`. Registry packages are shown as `@<publisher-handle>/<slug>`. Typical `package.json` scripts: `"build": "emdash-plugin build"`, `"dev": "emdash-plugin dev"`. Programmatic: `import { buildPlugin, bundlePlugin } from "@emdash-cms/plugin-cli"`; discovery/credential helpers from `@emdash-cms/registry-client`. Changesets mode: reusable workflow called after the Changesets publish job with its published-package JSON; private EmDash-only packages need `privatePackages.version: true` and `privatePackages.tag: true`.

## 6.5 Hooks (sandboxed)

Source: https://docs.emdashcms.com/plugins/creating-plugins/hooks/

Hooks are declared statically at definition time (no runtime registration). Signature `async (event, ctx) => ReturnType`; a `SandboxedPlugin`-typed constant infers types; import event types from `emdash/plugin` when needed. Bare handler or config object `{ priority (default 100, lower first), timeout (default 5000 ms), exclusive (for `email:deliver`, `comment:moderate`), handler, dependencies, errorPolicy }`. *(gotcha)* Isolated runners ignore hook metadata: they run sandboxed plugins in **load order** with their own wall-time limit (Cloudflare + Node runners default **30 s**; Cloudflare may stop earlier on CPU/subrequest limits). Never coordinate two sandboxed plugins via priority/dependencies.

**Registration capabilities (declare even if you only read the event)**

| Hooks | Capability |
| --- | --- |
| `content:beforeSave` | `content:write` (can replace content) |
| `content:beforePublish`, `content:beforeSchedule`, `content:beforeUnpublish` | `hooks.content-policy:register` |
| Other `content:*` | `content:read` |
| `media:beforeUpload` | `media:write` |
| `media:afterUpload` | `media:read` |
| `email:beforeSend`, `email:afterSend` | `hooks.email-events:register` |
| `email:deliver` | `hooks.email-transport:register` |
| All `comment:*` | `users:read` |
| `page:fragments` | `hooks.page-fragments:register` (native only) |
| Lifecycle hooks, `cron`, `page:metadata` | none |

**Lifecycle:** `plugin:install` (once; event `{}`), `plugin:activate`, `plugin:deactivate`, `plugin:uninstall` (event `{ deleteData: boolean }` — only delete storage when `deleteData` is true; loop `ctx.storage.x.query({ limit: 100 })` + `deleteMany(ids)`).

**Content hooks**
- `content:beforeSave` — event `{ content, collection, isNew, id, actor? }`; return modified content, `void`, or a rejection envelope `{ __emdashSandboxHookResult: true, version: 1, error: { code: "SAVE_REJECTED", reason } }` (`reason` = 1–500 plain-text chars, shown to the editor; malformed envelopes → generic `CONTENT_HOOK_ERROR`). In-process code throws `ContentSaveRejectedError` from `emdash` instead. On update, `content` holds only submitted fields — load the stored item with `ctx.content.get(event.collection, event.id)`. `slug` is not part of `content`; returning a `slug` key fails validation. `actor.id` + numeric `actor.role` present for authenticated REST/visual-editing/MCP saves.
- `content:afterSave` — `{ content, collection, isNew, actor? }`; side effects (e.g. `ctx.http.fetch(...)` when `ctx.http` exists).
- `content:beforeDelete` — `{ id, collection, permanent: false }`; return `false` to cancel the move to trash (throwing is logged and the delete proceeds). Not re-run on permanent deletion from trash.
- `content:afterDelete` — `{ id, collection, permanent }` (`permanent` true when removed from trash).
- Policy hooks `content:beforePublish` / `content:beforeSchedule` (+ `scheduledAt`) / `content:beforeUnpublish` — event `{ content, collection, origin, actor? }`; `origin.source` ∈ `api` | `mcp` | `visual-editor` | `plugin` (+ `pluginId`) | `scheduler` | `system`; return `void` to allow or `{ cancel: true, reason }` (1–500 chars) → `PUBLISH_REJECTED` / `SCHEDULE_REJECTED` / `UNPUBLISH_REJECTED`; errors abort without leaking. Publish/schedule events expose the effective draft in `content.data` and staged slug in `content.slug`; unpublish exposes live content. A scheduler-time rejection **unschedules** the entry, stores the reason, and lists it on the dashboard (no retry loop); a later schedule/publish/delete clears it. No `content:beforeUnschedule` exists.
- After-hooks (need `content:read`): `content:afterPublish`, `content:afterUnpublish`, `content:afterRestore`, `content:afterSchedule`, `content:afterUnschedule` — event `{ content, collection }`; errors are logged, can't roll back.

**Media:** `media:beforeUpload` — `{ file: { name, type, size } }`; return modified file or throw to cancel. `media:afterUpload` — `{ media: { id, filename, mimeType, size, url, createdAt } }`.

**Public page:** templates opt in via `<EmDashHead>`, `<EmDashBodyStart>`, `<EmDashBodyEnd>` from `emdash/ui`.
- `page:metadata` (both formats) — return `PageMetadataContribution | [] | null` with kinds `meta` (`name`), `property`, `link` (allowlisted `rel`; `href` must be http/https), `jsonld` (`id`, `graph`). Event `page`: `url`, `path`, `locale`, `kind` (`"content"|"custom"`), `pageType`, `title`, `pageTitle`, `description`, `canonical`, `image`, `content?` `{ collection, id, slug }`, `seo?` `{ ogTitle, ogDescription, ogImage, robots }`, `articleMeta?` `{ publishedTime, modifiedTime, author }`, `siteName`, `breadcrumbs`, `siteUrl`. Dedupe: first wins per key (`meta`: `key`/`name`; `property`: `key`/`property`; `link`: canonical singleton, alternate by `key`/`hreflang`; `jsonld`: `id`). Composition order plugins → site settings → template base (so plugins override); entry SEO panel values are folded into the page context first.
- `page:fragments` — native only (§6.16).

**Ordering (in-process pipeline only):** lower `priority` first → registration order → `dependencies` waited on. **Errors:** before-save throw → `CONTENT_HOOK_ERROR`; before-delete `false` cancels; after-hooks log only; `errorPolicy: "abort" | "continue"` is in-process only.

**Full hook table**

| Hook | Trigger | Return | Exclusive |
| --- | --- | --- | --- |
| `plugin:install` / `plugin:activate` / `plugin:deactivate` / `plugin:uninstall` | lifecycle | `void` | No |
| `content:beforeSave` | before save | content / rejection envelope / `void` | No |
| `content:afterSave` | after save | `void` | No |
| `content:beforeDelete` | before trash | `false` cancels | No |
| `content:afterDelete` | after trash/permanent | `void` | No |
| `content:afterPublish` / `afterUnpublish` / `afterRestore` / `afterSchedule` / `afterUnschedule` | after action | `void` | No |
| `media:beforeUpload` | before upload | file info / `void` | No |
| `media:afterUpload` | after upload | `void` | No |
| `cron` | scheduled task | `void` | No |
| `email:beforeSend` | before delivery | message / `false` / `void` | No |
| `email:deliver` | transport | `void` | **Yes** |
| `email:afterSend` | after delivery | `void` | No |
| `comment:beforeCreate` | before stored | event / `false` / `void` | No |
| `comment:moderate` | decide status | `{ status, reason? }` | **Yes** |
| `comment:afterCreate` / `comment:afterModerate` | after | `void` | No |
| `byline:afterSave` / `byline:afterDelete` | after | `void` | No |
| `page:metadata` | render | contributions / `null` | No |
| `page:fragments` | render (native) | contributions / `null` | No |

## 6.6 API routes (sandboxed)

Source: https://docs.emdashcms.com/plugins/creating-plugins/api-routes/

**Mount point:** `/_emdash/api/plugins/<slug>/<route-name>` (slug = manifest `slug` = `ctx.plugin.id`; route names may contain `/` for nesting, e.g. `settings/save`). Slug must match `/^[a-z][a-z0-9_-]*$/` (single Astro path segment) — pair an unscoped slug with a scoped npm name (`slug: "field-kit"`, package `@emdash-cms/plugin-field-kit`).

**Handler shape:** `(routeCtx, ctx)`. `routeCtx = { input: unknown, request: SandboxedRequest { url, method, headers (lowercased keys) }, requestMeta? (IP, UA, geo), user?: UserInfo { id, email, name, role, createdAt }, ui? }`. Always validate `routeCtx.input` (add `zod`; use `safeParse`). `ctx` is the same `PluginContext` as hooks: `plugin { id, version }`, `storage`, `kv`, `log`, `site`, `url(path)`, `settings`, and capability-gated `cron?`, `content?`, `schema?`, `taxonomies?`, `bylines?`, `redirects?`, `media?`, `http?`, `users?`, `email?`.

**Auth & CSRF:** routes are **private by default** — need a session (or token with `admin` scope); default required permission `plugins:manage`; set `permission: "content:create"` etc. to narrow. Cookie-authenticated requests need `X-EmDash-Request: 1` on **every** method incl. GET/HEAD (admin UI sends it); token requests skip the header but need `admin` scope + route permission. `public: true` skips auth (needs install consent; adding/flipping a public route re-prompts on update) — but cross-origin browser mutations still require a matching site `Origin` or the CSRF header (mismatched/malformed `Origin` → 403); non-browser clients without `Origin` are allowed, so validate input and verify signatures. `routeCtx.user` = authenticated caller on private routes (never trust a user ID from the body); `undefined` on public routes and for machine tokens. Caller identity ≠ `users:read` (that gates the `ctx.users` directory lookup).

**Content field filters (with `content:read`):** `ctx.content.list("items", { where: { fieldFilters: { priority: { in: ["urgent","high"] }, score: { gte: 80 }, resolved: false } } })` — only fields marked `indexed`; exact / `null` / `{ in: [...] }` (≤ 50) / `gt` `gte` `lt` `lte`; ≤ 20 field filters and a 50-operand budget per query (nulls free). No prefix/substring/JSON filtering.

**MCP tools:** opt in explicitly via `mcp.tools.<name> = { description, route, input (zod, required), output? (zod), destructive }` → exposed as `<pluginId>__<name>`; the route must be private with `permission`, and not `response: "raw"`. Admins enable a plugin's MCP tools separately after review; calling needs the route permission + `mcp:tools` or `mcp:tools:<pluginId>` scope.

**Request bodies:** default parsing = JSON for POST/PUT/PATCH, query string for GET/HEAD/DELETE (all strings; repeated keys → arrays; use `z.coerce`). Declare `request: { body: "none" | "json" | "text" | "bytes" | "form-data", maxBytes (default 1 MiB, max 8 MiB), headers: [...] }` via `pluginRoute({...})` from `emdash/plugin` (runtime identity, infers input type: `none` → query record, `text` → string, `bytes` → `Uint8Array`, `form-data` → ordered `entries[]` of `{ name, kind: "text", value }` / `{ name, kind: "file", filename, contentType, bytes }`; ≤ 100 parts, 1 MiB/part, filename ≤ 255 bytes, no control chars/path separators). Only headers listed in `request.headers` reach the handler; credentials, cookies, CF Access headers, proxy auth, `Set-Cookie`, and `X-EmDash-Request` can't be declared and are stripped. `methods: ["GET", "DELETE"]` → host returns `405` + `Allow` for others.

**Responses:** JSON contract by default — return any serializable value, wrapped as `{ success: true, data }`. Expected/domain errors → return JSON with a stable app-level code (still HTTP 200 in the envelope). Unexpected → throw → `ROUTE_ERROR` (message may be exposed — no secrets/paths/stack). Sandboxed code can't set arbitrary HTTP status by throwing a `Response`. **Raw responses:** `response: "raw"` + return `pluginResponse({ status, headers, body: { kind: "text" | "bytes", value } })` from `emdash/plugin` (buffered ≤ 8 MiB); allowed headers: `Accept-Ranges`, `Content-Disposition`, `Content-Encoding`, `Content-Language`, `Content-Range`, `Content-Type`, `ETag`, `Last-Modified`, `Location`, `Retry-After` (others stripped); host adds `X-Content-Type-Options: nosniff`, a sandboxed CSP, `Referrer-Policy: no-referrer`; `cacheControl` applies only to successful public GET/HEAD (else `private, no-store`). Active same-origin types rejected: HTML, JS, XHTML, SVG, XML, CSS, WebAssembly, `multipart/related`, `multipart/x-mixed-replace`.

**`ctx.http.fetch()`** (needs `network:request` + `allowedHosts`): buffered WHATWG `Response`; binary via `arrayBuffer()`/`blob()`; 8 MiB decoded per body; redirects rechecked per hop; credential headers dropped on cross-origin redirects.

**Calling without a request** (queue consumers, custom `scheduled()`): `withEmDashRuntime(async (runtime) => runtime.handlePluginApiRoute("my-plugin", "POST", "/finishJob", new Request("https://internal/", {...})))` from `emdash/middleware` — server-only, fully trusted (no auth/CSRF; validate inputs). On connection-backed DBs (Postgres/Hyperdrive) the callback runs in an event-scoped connection.

**External calls:** public → plain `curl`; private → session + `X-EmDash-Request: 1`, or `Authorization: Bearer <token>` with `admin` scope.

## 6.7 Storage (plugin document collections)

Source: https://docs.emdashcms.com/plugins/creating-plugins/storage/

- Declared in the manifest `storage` (sandboxed) or inside `definePlugin()` (native); EmDash creates/updates indexes on plugin load. Collection names: lowercase letter start, lowercase letters/digits/underscores. Index fields: letter start, letters/digits/underscores. `indexes` = strings or composite arrays; `uniqueIndexes` are queryable already (don't repeat). Scoped per runtime plugin ID; undeclared collections throw.
- **API:** `get(id)`, `put(id, data)`, `delete(id)`, `exists(id)`, `getVersioned(id)`, `compareAndSet(id, expectedRevision | null, data)`, `compareAndDelete(id, revision)`, `updateIf(id, args)`, `getMany(ids)` → `Map`, `putMany(items)`, `deleteMany(ids)` → count, `query(options)` → `{ items: [{ id, data }], cursor?, hasMore }`, `count(where?)`. Type with `ctx.storage.x as StorageCollection<T>` (type-only import from `emdash`).
- **Conditional writes** (storage and `ctx.kv`): `getVersioned` → `{ value, revision } | null`; `compareAndSet(key, null, v)` creates only if absent; with revision replaces only on match → `{ applied: true, revision } | { applied: false }`; `compareAndDelete` → `{ applied }`. Every write (even equal-value) changes the revision; delete+recreate invalidates old ones. Atomicity = one key; bounded retry loops (re-read, recompute). Limits: key ≤ 1,024 chars, value ≤ 1 MiB UTF-8, revision ≤ 128 chars; omitted revision invalid (only explicit `null` = create). Requires matching core + sandbox adapter versions and host DB migrations.
- **`updateIf(id, { where, set?, delta? })`** (native + sandboxed on Cloudflare/workerd): atomic guarded update → `{ applied: true, data } | { applied: false }` (never inserts). `where` required (same operators as queries; guard fields need no indexes); `set` replaces top-level fields; `delta` = one `{ inc: n }` or `{ dec: n }` per field with safe-integer operands (missing/null counter starts at 0; non-integer/unsafe/out-of-range → `{ applied: false }`); a field can't be in both. Keep counters ≥ 0 by pairing `dec: n` with `where: { counter: { gte: n } }`. Types `NumericDelta`, `UpdateIfArgs`, `UpdateIfResult` from `emdash` / `emdash/plugin`.
- **PostgreSQL serialization:** native plugins get `StorageSerializationError` (`code: "STORAGE_SERIALIZATION_FAILURE"`, `retryable: true`, `sqlState` `40001`/`40P01`); retry with backoff, or restart the whole transaction; across a sandbox check `code`/`retryable` (no `instanceof`).
- **Query:** `{ where?, orderBy?: Record<field, "asc"|"desc">, limit? (default 50, max 100), cursor? }`. Where operators: exact (string/number/boolean), `{ gt, gte, lt, lte }`, `{ in: [...] }`, `{ startsWith }`. Only indexed fields may filter/order (validation error otherwise). Paginate by passing `result.cursor` until undefined. `putMany` on Cloudflare writes sequentially (partial success possible).
- **Index design:** composite `["formId", "createdAt"]` serves filter-by-formId(+order-by-createdAt) but not a query starting with `createdAt`; add separate single indexes for standalone use. Any field in `indexes`/`uniqueIndexes` passes the indexed-field check, but efficiency depends on order.
- **Choose:** `ctx.storage` for operational records (logs, submissions, caches); `ctx.settings` for user config; `ctx.kv` with `state:` prefix for internal state; site collections for editor-managed content. Isolation: rows store plugin ID + collection + record ID + JSON + timestamps; declared fields become expression indexes (SQLite, D1, PostgreSQL dialects generated by EmDash).
- **Changing indexes:** added indexes created on next load (unique ones fail on existing duplicates — clean first); removed indexes dropped (dependent queries then fail validation). Bump version; major for breaking query/uniqueness changes.

## 6.8 Settings (sandboxed)

Source: https://docs.emdashcms.com/plugins/creating-plugins/settings/

- Sandboxed settings live in the per-plugin **KV** (`ctx.kv`: `get<T>(key)`, `set(key, value)`, `delete(key)`, `list(prefix?)`) and are edited via a **Block Kit** page served by the `admin` route. Keys are namespaced automatically (`settings:apiKey` stored in `_options` as `plugin:<id>:settings:apiKey`).
- Conventions: `settings:` (user prefs), `state:` (internal), `cache:`; avoid bare keys. Reads return `null` when unset → supply defaults at read time, or persist in `plugin:install` (only fresh installs get them; migrate idempotently in `plugin:activate` for new settings).
- Flow: admin sends `{ type: "page_load", page: "/settings" }` → return blocks (form with `text_input`, `secret_input`, `toggle`, `number_input`, …, `submit: { label, action_id }`); on `form_submit` with matching `action_id`, write `values` to KV and return blocks + `toast: { message, type: "success" }`. Declare the page in the manifest `admin.pages`.
- **Secrets:** don't seed `secret_input.initial_value` with the real value; skip empty strings on save so an untouched field doesn't wipe the stored secret. (Native: `admin.settingsSchema` with `type: "secret"` → encrypted via `ctx.settings`.)
- KV vs storage: KV = small string-keyed values, no queries; storage = indexed document collections. Native plugins may instead declare `admin.settingsSchema` in `definePlugin()` for an auto-generated form.

## 6.9 Block Kit (declarative admin UI)

Source: https://docs.emdashcms.com/plugins/creating-plugins/block-kit/

Sandboxed plugins describe admin UI as JSON; the host renders it (no plugin JS in the browser). Native plugins may also use Block Kit (declare `admin.pages`/`admin.widgets` in `definePlugin()`, leave `admin.entry` unset, add an explicit `admin` route; `admin.entry` switches to React). Native PT block editing fields also use Block Kit elements. Playground: https://blocks.emdashcms.com/

**Cycle:** user opens page → admin POSTs `page_load` to the plugin's private `admin` route → plugin returns `BlockResponse { blocks, toast? }` → interactions come back as `block_action { action_id, block_id?, value? }` or `form_submit { action_id, block_id?, values }` → plugin returns new blocks. Add `@emdash-cms/blocks` + `zod`; validate interactions with a `z.discriminatedUnion("type", …)`. EmDash validates every sandboxed page/widget response (invalid block, unsafe URL, undeclared page link → request fails). Limits: 256 KiB response, 20 nesting levels, 2,000 nodes, 1,000 items/array, 64 KiB/string. *(Checked in `@emdash-cms/blocks` 1.1.0, `validateResponseBounds`, 2026-10-09: every value counts as a node, strings, numbers and booleans included, not just blocks and elements. A 25-row table with a menu per row is about 840 nodes.)* Native page/widget responses are **not** validated (and `ctx.ui` is undefined there) — keep within the same rules.

**`routeCtx.ui`** = `{ surface, locale, direction, entry?, extensionId? }` — the admin UI locale (from cookie/request language), distinct from `ctx.site.locale`; manifest labels stay static.

**Navigation `link` element** (no action round-trip): `target` kinds `content` `{ collection, id, locale? }`, `plugin-page` `{ path }` (must be declared by the same plugin), `plugin-settings`, `external` `{ url }` (http/https/`mailto:`; opens new tab `noopener noreferrer`). Links can't have `action_id` or be form fields. Images: root-relative OK; external must be HTTPS with hostname in `allowedHosts` (or `network:request:unrestricted`) — otherwise the whole response is rejected.

**Tables with row actions:** column `format: "element"` holding a `button`, `link`, or `menu` per row; `menu { action_id, label, items: [{ label, value }] }` dispatches `block_action` with the item `value` (unique per menu); `page_action_id` for pagination.

**Saved-entry extensions (manifest `admin.editorPanels` / `admin.editorActions`):** panels `{ id, title, route, collections, draft?: { read: { fields? | translatable? }, patch: { fields } } }` start collapsed and call the private route on open (`{ type: "panel_load" }`, no draft data); `routeCtx.ui.entry` = `{ collection, id, locale, version }`, `routeCtx.ui.extensionId`. Draft snapshot on explicit interactions requires capability `admin.editor-draft:read` + narrowed `draft.read` + explicit `collections`. `admin.editor-draft:patch` lets a route return `patch: { type: "editor-draft-patch", operations: [{ op: "set", field, value }, { op: "clear", field }] }` — validated server-side (schema, capability, collection, locale, base revision, ownership, limits), previewed host-side, applied as unsaved form changes (no save/revision/hooks); concurrent edits reject the patch. Actions `{ id, label, route, placement: "overflow", style: "danger", confirm: { title, text, confirm, deny } }` receive `{ type: "editor_action" }`; saved-only actions are disabled while the form is dirty; return `{ toast?, refresh: true | navigate | patch }` (at most one terminal effect).

**Block types:** `header`, `section`, `divider`, `fields`, `table`, `actions`, `stats`, `form`, `image`, `context`, `columns`, `empty`, `accordion`, `chart`, `banner`, `meter`, `code`, `tab`.
**Element types:** `button` (optional confirm), `link`, `menu`, `text_input`, `number_input`, `select`, `toggle`, `secret_input`, `checkbox`, `combobox`, `date_input`, `radio` (`repeater` and `media_picker` exist only in the PT field editor).
**Builders:** `import { blocks, elements } from "@emdash-cms/blocks"` → `blocks.header("…")`, `blocks.form({ blockId, fields, submit: { label, actionId } })`, `blocks.actions([...])`, `elements.textInput(id, label, { initialValue })`, `elements.toggle`, `elements.select(id, label, options)`, `elements.link(label, target)`, `elements.menu(actionId, label, items, { style })`.
**Conditional fields:** `"condition": { "field": "auth_enabled", "eq": true }` evaluated client-side. `secret_input` exposes `has_value: true` instead of the stored value.

## 6.10 Capabilities and security

Source: https://docs.emdashcms.com/plugins/creating-plugins/capabilities/

Declared in the manifest `capabilities` (+ `allowedHosts`). The bridge populates a `ctx` API only when its capability is declared (no object otherwise). Declare only what the current version uses — the consent dialog shows every entry, and additions on update require re-approval.

| Capability | Grants |
| --- | --- |
| `content:read` | `ctx.content.get/list/getTranslations/getPublicUrl` (safe identity incl. author ID, translation group, revision pointers, row version; `getPublicUrl()` → `null` for drafts/unroutable/missing slug/unserved locale; never preview URLs) |
| `content:revisions:read` | `ctx.content.listRevisions/getRevision` (implies read; snapshots may contain removed fields; author identity omitted) |
| `content:write` | `ctx.content.create/update/delete` (implies read) |
| `content:publish` | versioned publish/unpublish/schedule/unschedule (implies read) |
| `content:restore` | read + restore trashed entries (`getTrashedVersioned` → `_rev` → `restore`) |
| `comments:read` | `ctx.comments.get/list/count` incl. author name/email, IP hash, UA (excludes linked user ID) |
| `comments:moderate` | `ctx.comments.setStatus(id, status, { expectedStatus })` (implies read) |
| `schema:read` | `ctx.schema.listCollections/getCollection` (no DB IDs/timestamps/SQL types; hidden collections visible) |
| `hooks.content-policy:register` | `content:beforePublish/beforeSchedule/beforeUnpublish` (no content access) |
| `taxonomies:read` | `ctx.taxonomies.getAll/getTerms/getEntryTerms` |
| `taxonomies:write` | `ctx.taxonomies.createTerm/addEntryTerms/removeEntryTerms` (implies read) |
| `bylines:read` | `ctx.bylines.get/list/getEntriesBylines` + `byline:afterSave/afterDelete` hooks (public profile fields only; credits `source: "explicit" | "inferred"`) |
| `redirects:read` / `redirects:write` | `ctx.redirects.list/get` / `create/update/delete` (write implies read) |
| `media:read` | `ctx.media.get/list` (dimensions, alt, caption, focal point, blurhash, dominant color, folder, authenticated ID-based URL; no storage key/author/hash/bytes) |
| `media:bytes:read` | `ctx.media.readBytes(id, { maxBytes })` (default 10 MiB, host max 16 MiB; returns `bytes` + `contentHash`) |
| `media:metadata:write` | `ctx.media.updateMetadata(id, { alt, caption, focalX, focalY })` (both focal coords 0–1 or both `null`) |
| `media:write` | `ctx.media.getUploadUrl/upload/delete` (implies `media:read`) |
| `network:request` | `ctx.http.fetch()` to `allowedHosts` (`*.x` matches x and subdomains) |
| `network:request:unrestricted` | any public HTTP/HTTPS host (for operator-supplied URLs; still blocks internal hosts/private IPs, rechecks redirects, strips credentials cross-origin; implies `network:request`, requires empty `allowedHosts`) |
| `users:read` | `ctx.users.get/getByEmail/list` |
| `email:send` | `ctx.email.send()` (populated only when an `email:deliver` transport plugin exists) |
| `hooks.email-transport:register` | exclusive `email:deliver` |
| `hooks.email-events:register` | `email:beforeSend` / `email:afterSend` |
| `hooks.page-fragments:register` | `page:fragments` (native only) |

Separations: media authorities (`media:read`, `media:bytes:read`, `media:metadata:write`) don't imply each other; taxonomies ≠ content; bylines ≠ content ≠ users; policy hooks ≠ content access.

**Content API details:** `ctx.content.create(collection, data, { locale?, translationOf? })` — locale case-insensitive (stored with configured casing); malformed or unconfigured locale → `VALIDATION_ERROR`; `translationOf` joins the source's group, inherits credits + taxonomy assignments, copies non-translatable values (supplied values for those are ignored); one active entry per locale per group (`CONFLICT`); missing source `NOT_FOUND`; save hooks may `SAVE_REJECTED`; the creating plugin's own `content:afterSave` isn't re-entered. Publication: `getVersioned(collection, id)` → `publish/unpublish/unschedule(collection, id, { _rev })`, `schedule(collection, id, { scheduledAt, _rev })` — same policy hooks, revision promotion, locale sync, redirects, media-usage, cache invalidation, after-hooks as REST/MCP; no `publishedAt` override. Taxonomies: `createTerm(taxonomy, { label, parentId?, locale?, translationOf? })` (parentId rejected on flat taxonomies), `addEntryTerms/removeEntryTerms(collection, entryId, taxonomy, termIds)` are idempotent set deltas (term row IDs or translation-group IDs, not slugs); no definition/attach/update/delete via plugins. Media upload allowlist in trusted plugins: PNG/JPEG/GIF/WebP/AVIF, `video/*`, `audio/*`, `application/pdf` (else `PluginRouteError` 415; malformed type 400); extension forced to match content type. Redirects: pass `_rev` from `get/create/update` back on update/delete (stale → rejected); hit counts don't bump `_rev`; loop/duplicate/self-loop validation as the admin API; `auto` marker not settable. Comments: `list({ status?, collection?, contentId?, cursor?, limit 1–100 (default 50) })` newest first; `setStatus` conflicts → `COMMENT_STATUS_CONFLICT` or `COMMENT_MODERATION_IN_PROGRESS`; successful transition fires `comment:afterModerate` with `origin: { source: "plugin", pluginId }`; same-status is a no-op.

**What the sandbox enforces:** capability gating; storage/KV scoping per plugin ID; network isolation (only `ctx.http`); no host bindings (no env vars, filesystem, platform bindings); resource limits — Cloudflare runner defaults **50 ms CPU, 10 subrequests, 30 s wall** (CPU/subrequests by Worker Loader, wall by runner; `memoryMb` not enforceable); Node workerd runner enforces only the 30 s wall default (warns on unenforceable CPU/memory/subrequest settings); per-hook `timeout` only applies in-process.
**Not enforced:** behavior within a granted capability (coarse — `content:write` edits any content); entry edit locks don't block programmatic `update`/`delete`; unavailable runner → `sandboxed: []` skipped (moving to `plugins: []` = native-level trust); side channels (timing, logs, stored data) visible to the operator.
**Bundle-time checks:** unknown capability names fail; `network:request` needs non-empty `allowedHosts` (unrestricted needs empty); `backend.js` may not import Node builtins.

## 6.11 Bundling and publishing (sandboxed only)

Source: https://docs.emdashcms.com/plugins/creating-plugins/publishing/

*Experimental:* registry records follow RFC 0001 and may change; pin `@emdash-cms/plugin-cli` to an exact version. Native plugins distribute via npm, not the registry.

**Prereqs:** valid manifest (`slug`, `publisher`, `license`, author, security contact — `emdash-plugin validate`); a `version` (in `package.json`, or manifest for registry-only); an Atmosphere account.

| Method | When | Credential |
| --- | --- | --- |
| `emdash-plugin publish` | Build/publish from a trusted machine | Local CLI OAuth session writes profile, release, blobs |
| Automated releases (§6.12) | GitHub Actions builds from tags / manual runs | Local CLI prepares the profile; release service holds create-only release/blob authority |

**Account:** `emdash-plugin login alice.bsky.social` (browser OAuth at your provider; EmDash never sees a password); any Bluesky/AT Protocol account works; `whoami` / `switch <did>`. Pin the account DID as manifest `publisher`.

**`bundle [--dir] [--out-dir|-o dist] [--validate-only]`** → `build` → validate → assets → `dist/<slug>-<version>.tar.gz`. Tarball: `manifest.json` (generated), `backend.js` (= `dist/plugin.mjs`), optional `README.md`, `icon.png` (256×256 PNG recommended), `screenshots/` (≤ 8 `.png/.jpg/.jpeg`, ≤ 1920×1080 recommended). **Caps (decompressed):** total ≤ 256 KB, per file ≤ 128 KB, ≤ 20 files. Checks: no Node builtins in `backend.js`, capability names, `network:request`/`allowedHosts` coherence; unreadable icon/screenshot skipped (dimension warnings don't fail). Inspect with `tar tzf dist/<slug>-<version>.tar.gz`. *(gotcha)* Conventional `icon.png` and `screenshots/*` are packed into the tarball and count against the caps — keep declared release images (`release.artifacts`, ≤ 1 MiB, ≤ 8,192 px) in another folder such as `images/`.

**`publish`:** build + validate + gzip → resume session + publisher pinning check → confirm OAuth grant includes package/image blob scopes (`MISSING_BLOB_SCOPE` → `logout` then `login` again) → upload package + declared images to your PDS and verify blob CIDs → create package profile (first publish) + immutable release record. Prints `@<publisher-handle>/<slug>`, the future public page URL, and an `emdash-plugin info … --version <v> --watch` command. Adds the canonical HTTPS repo to the profile when available. `--url <https>` publishes an externally hosted bundle (downloaded + validated + checksummed; no package blob upload); `--local <path>` compares bytes.

**Versions are immutable:** same slug+version is refused — bump first (major = broadened trust contract; minor = new hooks/routes; patch = fixes). `--allow-overwrite` exists for repair only and may be treated as a takedown/replacement by aggregators/labelers; automated releases are create-only. `MANIFEST_PUBLISHER_MISMATCH` → `emdash-plugin switch <did>` (or change `publisher` only when transferring ownership).

## 6.12 Automated (delegated) releases via GitHub Actions

Source: https://docs.emdashcms.com/plugins/creating-plugins/delegated-releases/

Your Atmosphere account owns profile + releases; GitHub OIDC identifies the approved workflow; the release service (`https://releases.emdashcms.com`) verifies the build and writes the release through a narrow delegation. **No Atmosphere credential is stored in the repo.** Requires a **public** GitHub repository (verifier trusts only GitHub's public Sigstore root); passkey-capable browser for approvals.

**Setup:** `pnpm exec emdash-plugin validate` → `login <handle>` → `release setup` (from the plugin dir, or `--dir`; creates/augments the profile: repo binding, approver = signed-in account, confirmation policy **When plugin permissions increase** [default] or **For every release**, provenance **Require provenance** [default] or **Allow releases without provenance**; generates `.github/workflows/emdash-release.yml` at repo root — shared by all packages; doesn't push; `--force` to overwrite) → commit → open https://releases.emdashcms.com/publisher, sign in, **Authorize publishing** (grant: create release records + upload package/listing blobs; cannot edit profiles or delete releases) → trigger (Changesets merge, tag `git tag gallery@1.2.3 && git push origin gallery@1.2.3`, or **Run workflow**) → first run: approve the repository connection from the job-summary link (**All package version tags** / **Only this tag**; manual runs approve per branch; scopes accumulate) → approve permission-expanding releases at the approval URL with a passkey (**Awaiting approval** state; Action returns success and the service waits).

Workflow properties: minimal `contents` / `id-token` / `attestations` permissions per job; third-party Actions pinned to commit SHAs; runs the exact CLI version that generated it; resolves packages from manifests; builds one bundle; attaches GitHub build provenance; calls the EmDash release Action. Changesets variant: `workflow_call` receiving `published-packages` JSON; add to the Changesets job `outputs.published` + `outputs.published-packages` (`steps.changesets.outputs['published-packages']` for Action v2 / CLI v3; `steps.changesets.outputs.publishedPackages` for v1 / CLI v2) and a dependent job `uses: ./.github/workflows/emdash-release.yml` gated on `published == 'true'` with `permissions: contents: read, id-token: write, attestations: write`. Private EmDash-only packages need `privatePackages.version: true` + `privatePackages.tag: true`. Add another package: `profile setup --dir packages/comments` then tag `comments@1.0.0`.

**Service verifies:** OIDC token (repo, owner, workflow, ref, environment, commit, run, GitHub-hosted runner) → signed profile with delegated settings naming the same canonical repo → package/version match the bundle → checksum → provenance covers bundle/repo/workflow/commit/run → declared access matches bundle manifest → version doesn't exist → any required passkey approval matches the verification result + profile revision. Uploads go to the publisher's PDS; provenance exposed at an immutable checksum-addressed URL.

**Action I/O:** inputs `service-url`, `publisher-did`, `bundle-file`, `provenance-file` (or a `release-file` alternative, not combinable); outputs `connection-url`, `intent-id`, `state`, `approval-url`, `release-uri`, `release-cid`, `reason-code`. Reference: https://github.com/emdash-cms/emdash/tree/main/apps/release-action

**Errors:** `PACKAGE_PROFILE_REQUIRED` (run `profile setup`), public repository required, `WORKLOAD_NOT_ALLOWED` (approve a new connection scope), `PROFILE_FETCH_FAILED` (PDS unavailable/profile changed), `POLL_TIMEOUT` (check dashboard; rerun reuses idempotency key). Revoke: **Turn off automated publishing** in the dashboard (profiles/releases/installs unchanged).

## 6.13 Migrating sandboxed plugins to the plugin CLI

Source: https://docs.emdashcms.com/plugins/creating-plugins/migrating-to-the-cli/

Native plugins are unaffected. Changes for sandboxed authors (runtime behavior unchanged):
1. `@emdash-cms/registry-cli` (binary `emdash-registry`) → `@emdash-cms/plugin-cli` (binary `emdash-plugin`); subcommands keep names; `init`, `build`, `dev` added.
2. `definePlugin()` from `emdash` with annotated handlers → bare default export `{ hooks, routes } satisfies SandboxedPlugin` (type-only from `emdash/plugin`); drop handler parameter annotations (inferred); import event types from `emdash/plugin` for helpers. Handlers must accept the canonical event type — narrower annotations no longer type-check; validate fields at runtime.
3. Two files (`src/index.ts` descriptor + `src/sandbox-entry.ts`) → one `src/plugin.ts` + hand-edited `emdash-plugin.jsonc` (`id` → `slug`; `capabilities`/`allowedHosts`/`storage` keep shape; `version` from `package.json`; `entrypoint`/`format` gone). `package.json`: `"./sandbox": "./dist/plugin.mjs"`, `"files": ["dist", "emdash-plugin.jsonc"]`.
4. Build: replace the `tsdown` script with `"build": "emdash-plugin build"`, `"dev": "emdash-plugin dev"`.
5. Removed from `emdash`: `StandardPluginDefinition`, `StandardHookHandler`, `StandardHookEntry`, `StandardRouteHandler`, `StandardRouteEntry`, `isStandardPluginDefinition` → use `SandboxedPlugin`.
6. Runtime handle type renamed: `SandboxedPlugin` (from `emdash`) → `SandboxedPluginInstance` (only for custom `SandboxRunner` authors).
Tell site operators: `import { helloPlugin } from …` + `sandboxed: [helloPlugin()]` → `import hello from …` + `sandboxed: [hello]`; factory config moves to admin plugin settings (read via `ctx.kv`/settings).

## 6.14 Testing sandboxed plugins (`@emdash-cms/plugin-test`)

Source: https://docs.emdashcms.com/plugins/creating-plugins/testing/ *(not listed in the site index; linked from the tutorial)*

- Builds the plugin and runs Vitest through a local **Worker Loader** binding with EmDash's production Cloudflare sandbox wrapper + `PluginBridge`, and local D1 via `@cloudflare/vitest-plugin`. `pnpm add -D @emdash-cms/plugin-test vitest`; allow `workerd` build scripts (`pnpm-workspace.yaml`: `allowBuilds: workerd: true`). `vitest.config.ts`: `plugins: [emdashPluginTest()]` from `@emdash-cms/plugin-test/config` (`{ dir }` when config lives elsewhere) — runs the plugin build first.
- **Two hosts:** `createPluginTestHost()` (direct transport: serialization, capability enforcement, storage, route logic — **no** auth/permission/scope/CSRF/cache checks) and `createPluginRuntimeTestHost()` (real EmDash orchestration: content, plugin activation, media, comments, scheduled tasks, plugin routes). Always `await host.dispose()` in `afterEach` (terminates isolate, resets bindings).
- Transport host API: `invokeRoute(name, input?, requestProps?)` (default POST, empty headers), `invokeHook(name, event)`, `storage(name).list()`, KV readers, `createCollection({ slug, label, fields })`, `seedContent(collection, [...])`. Declared collections/capabilities/hosts still enforced.
- Runtime host groups: `transport`; `admin` (`loadPage()`, `loadWidget()`, `act()`, `submit()`, `loadEditorPanel()`, `actEditorPanel()`, `submitEditorPanel()`, `invokeEditorAction()` with `locale`/`contentLocale`); `fixtures` (site, collection, field, user, byline, taxonomy, content, redirect, binary media with `reportedSize`/`contentHash`, plugin state — no hooks fired); `actions` (`content.create(...)`, plugin activate/deactivate, `plugin.updateSettings({...})`, media uploads, comment submission/moderation, `routes.request(name, { method, user, headers: { "X-EmDash-Request": "1" }, body | rawBody })`); `inspect` (content, redirects, credits, taxonomy assignments, storage, KV, `settings.raw(key)` envelope `{ v: 1, kid }`, plugin state, scheduled tasks, `scheduledPolicyRejections()`, media metadata + `mediaBytes(id)`, comments, captured email); `scheduled` (set time, run one maintenance batch); `http` (`respond(url, Response)` queues one response per expected call; `requests()`; `clear()`); `restart()` (new runtime/isolate, keeps D1/storage/state). Set `EMDASH_ENCRYPTION_KEY` in the test process for encrypted settings tests.
- Boundaries: default runner is Worker Loader; add an opt-in Node/workerd job for runner-sensitive behavior. Neither host renders the admin React app nor reproduces Cloudflare CPU/memory/subrequest limits — use a disposable site / Cloudflare preview for those; Block Playground for rendering.

## 6.15 Your first native plugin

Source: https://docs.emdashcms.com/plugins/creating-native-plugins/your-first-native-plugin/

A native plugin is an npm package imported into the site process. Layout: `package.json` (`"type": "module"`, `main`/`exports` → `dist/index.mjs` + `.d.mts`, `files: ["dist"]`, scripts `build: tsdown src/index.ts --format esm --dts --clean`, `dev: … --watch`, `typecheck: tsc --noEmit`; `peerDependencies: { emdash: "*" }`; devDeps `emdash`, `tsdown`, `typescript`), `tsconfig.json` (`target ES2022`, `module preserve`, `moduleResolution bundler`, strict, declaration), `src/index.ts`.

**Two exports, two stages:**
```ts
import { definePlugin } from "emdash";
import type { PluginDescriptor } from "emdash";
export function activityPlugin(options = {}): PluginDescriptor<Options> {
  return { id: "plugin-activity", version: "0.1.0", format: "native", entrypoint: "@example/plugin-activity", options };
}
export function createPlugin(options = {}) {
  return definePlugin({ id: "plugin-activity", version: "0.1.0", capabilities: ["content:read"],
    hooks: { "content:afterSave": async (event, ctx) => { ctx.log.info("Content saved", { collection: event.collection, contentId: event.content.id, isNew: event.isNew }); } } });
}
export default createPlugin;
```
- Descriptor factory runs while Astro evaluates config → serializable build-time metadata (`id`, `version`, `format`, `entrypoint`, `options`, plus `adminEntry` / `componentsEntry`). The **named `createPlugin` export is required** — EmDash imports it by name from `entrypoint` and passes `options`.
- Keep `id`/`version` identical in both; use an unscoped kebab-case `id` (`plugin-activity`) so it fits one route URL segment; keep the npm scope in the package name/`entrypoint`. Runtime concerns (`capabilities`, `allowedHosts`, `storage`, `hooks`, `routes`, `admin`) live in `definePlugin()`.
- Register in `astro.config.mjs`: `emdash({ plugins: [activityPlugin({ logUpdates: true })] })`. *(gotcha)* Native descriptors go in `plugins`, never `sandboxed` (rejected). Local dev: `pnpm add ../plugin-activity` in the site.
- **Native route handlers** take one `RouteContext` (`ctx.input`, `ctx.request`, `ctx.user`, plus `PluginContext`): `routes: { status: { permission: "plugins:read", handler: async (ctx) => ({ pluginId: ctx.plugin.id, callerId: ctx.user?.id ?? null }) } }`. Wrap in `definePluginRoute()` (from `emdash`) when declaring `request.body`; raw responses return `pluginResponse()` (from `emdash`).
- **Secrets/bindings:** handlers get the plugin context, not `Astro.locals`. Read deployment secrets from `process.env` (Cloudflare: `wrangler secret put` values reach `process.env` via `nodejs_compat` with compatibility date ≥ 2025-04-01). Admin-entered credentials → `admin.settingsSchema` `secret` field (encrypted with `EMDASH_ENCRYPTION_KEY`; read via `ctx.settings.get()`). Cloudflare bindings (queues, R2, `send_email`): `const { env } = await import("cloudflare:workers")` **inside the handler** (Astro loads the config in Node, which can't resolve that module); type with `@cloudflare/workers-types` and `declare namespace Cloudflare { interface Env { ACTIVITY_QUEUE: Queue } }`.
- No isolation: native code can import host packages, read env vars, call `fetch()`, and affect the host process.

## 6.16 React admin extensions (native)

Source: https://docs.emdashcms.com/plugins/creating-native-plugins/react-admin/

**Generated settings form (no React needed; also works for sandboxed):** `admin.settingsSchema` in `definePlugin()`; field types `string` (`default`, `multiline`), `number` (`default`, `min`, `max`), `boolean` (`default`), `select` (required `options: [{ value, label }]`, `default`), `secret` (write-only, never returned to browser), `url` / `email` (`default`, `placeholder`); `label` required, `description` optional. Reached from the plugin card's settings control in **Plugins** (`plugins:manage`). Read with `ctx.settings.get<T>("key")` — schema defaults fill the form but are **not** written to the store, so apply the same fallback in code. Clearing a non-secret deletes it; secrets are encrypted and only report "is set". Labels don't localize — build a React page if that matters.

**React entrypoint (three linked declarations):** descriptor `adminEntry: "@example/plugin-activity/admin"` (build-time bundle target) = runtime `admin.entry` (identical string) + `admin.pages: [{ path: "/activity", label, icon }]` / `admin.widgets: [{ id, title, size }]`; the admin module exports maps keyed by those paths/IDs.
- **Pages:** mounted at `/_emdash/admin/plugins/<plugin-id><path>`; `icon` = Phosphor icon name (kebab/snake/space/PascalCase; unknown → plugin icon). Export `export const pages: PluginAdminExports["pages"] = { "/activity": ActivityPage }` (`PluginAdminExports` from `emdash`). Use Kumo (`@cloudflare/kumo`: `Button`, `Loader`, …), `useLingui()` from `@lingui/react` for i18n (`i18n._({ id, message })`), and `apiFetch()` + `parseApiResponse<T>()` from `emdash/plugin-utils` (adds `X-EmDash-Request: 1`). Pair with a native route (`permission: "plugins:read"` etc.). Plugin catalogs: `i18n.load(locale, messages)` from `@lingui/core` at import time and on `i18n.on("change", …)`; guard against re-load loops; keep `@lingui/core` / `@lingui/react` as peer deps.
- **Dashboard widgets:** `export const widgets: PluginAdminExports["widgets"] = { "recent-activity": Widget }`; host renders the card + `title`; `size` (`full`/`half`/`third`) is stored but the current dashboard ignores it (two-column grid). Use `@tanstack/react-query` `useQuery`.
- **Content editor panels:** `export const contentEditorPanels = [{ id, title, component, collections?, minRole?, order? }] satisfies readonly ContentEditorPanelExtension[]` (types from `@emdash-cms/admin`); component receives `ContentEditorPanelContext { entry, collection, locale }`; only for saved entries; need `adminEntry`/`admin.entry` but not page/widget declarations; failures isolated.
- **Content-list columns:** `export const contentListColumns = [{ id, label, cell, header?, collections?, minRole?, align: "start" | "end", order }] satisfies readonly ContentListColumnExtension[]`; cell gets `ContentListColumnCellContext { item, visibleItems, collection, locale }`. *(gotcha)* Batch by `visibleItems` IDs in one plugin route and share the React Query key — per-row fetches create one request per row. Not shown in Trash; no client-side sort/filter.
- Disabled plugin → pages/widgets/panels/columns removed, private routes 404, hooks stop; re-enable rebuilds the pipeline.

## 6.17 Portable Text rendering components (native)

Source: https://docs.emdashcms.com/plugins/creating-native-plugins/portable-text-components/

Two parts: a declarative **block definition** (`admin.portableTextBlocks` in `definePlugin()` — compatible with sandboxed plugins) and an **Astro renderer** (needs a native descriptor's `componentsEntry`).

Block definition fields: `type` (required; becomes `_type` + renderer key; unique across enabled plugins), `label` (required), `icon`, `description`, `category` (default `Embeds`), `placeholder` (for the simple URL input when `fields` omitted), `fields` (Block Kit elements; each `action_id` becomes a saved property). Saved shape e.g. `{ "_type": "callout", "_key": "…", "heading", "body", "tone" }`.

Renderer: `src/astro/Callout.astro` receives the block as the **`node` prop** (astro-portabletext convention — not `value`); export `export const blockComponents = { callout: Callout }` from `src/astro/index.ts`; descriptor gets `componentsEntry: "@example/plugin-callout/astro"`; the package must export `./astro`. Merge order in `<PortableText>`: built-ins → plugin `blockComponents` → site-passed `components` (later overrides earlier), so a site can override just one renderer via `components={{ type: { callout: SiteCallout } }}`. A sandboxed plugin can ship the editor definition but the site (or a separate trusted package) must supply the renderer.

## 6.18 Page fragments (native only)

Source: https://docs.emdashcms.com/plugins/creating-native-plugins/page-fragments/

`page:fragments` injects scripts/raw HTML into public pages as first-party code; requires capability `hooks.page-fragments:register` in `definePlugin()` (missing → warning, hook not registered; hook errors logged, page still renders). Skip admin paths (`event.page.path.startsWith("/_emdash/")`). Contributions (one, array, or `null`):

| `kind` | Required | Optional | Output |
| --- | --- | --- | --- |
| `external-script` | `placement`, `src` | `async`, `defer`, `attributes`, `key` | `<script src>` |
| `inline-script` | `placement`, `code` | `attributes`, `key` | inline `<script>` (`</` escaped) |
| `html` | `placement`, `html` | `key` | inserted **unsanitized** |

`placement`: `head` | `body:start` | `body:end`. Attribute names/values are HTML-escaped and `on*` attributes removed, but the plugin must still encode interpolated data (e.g. `JSON.stringify` inside inline scripts). Dedup within a placement by `key` (first wins); external scripts also by `src`.

**Theme insertion points:** build one `PublicPageContext` via `createPublicPageContext({ Astro, kind, pageType, title, description, content })` from `emdash/page` and render `<EmDashHead page={page} />` (head fragments + metadata), `<EmDashBodyStart page={page} />`, `<EmDashBodyEnd page={page} />` from `emdash/ui`. Omitted component = that placement never renders; document required insertion points in the plugin README. Page context fields: `url`, `path`, `locale`, `kind`, `pageType`, `title`, `pageTitle`, `description`, `canonical`, `image`, `content?`, `seo?`, `articleMeta?`, `siteName`, `siteUrl`, `breadcrumbs`. Prefer `page:metadata` for meta/link/JSON-LD. Never place server-side secrets in a fragment.

## 6.19 Distributing native plugins (npm)

Source: https://docs.emdashcms.com/plugins/creating-native-plugins/distributing/

Layout: `src/index.ts` (descriptor + `createPlugin`), optional `src/admin.tsx`, optional `src/astro/index.ts`, `dist/`, `package.json`, `tsconfig.json`, `README.md`. Exports: `"."` (server, always), `"./admin"` (browser; React pages/widgets), `"./astro"` (SSR; PT renderers). Keep `emdash` and `react` (^18) as **peer** dependencies (bundling duplicates React in the admin). Build with `tsdown`/`tsup` ESM + dts, externalizing `react`, `react-dom`, `emdash`, `@emdash-cms/admin`; `.astro` files aren't bundled — include the `astro/` dir in `files`. `prepublishOnly: pnpm build`. Versioning: semver; *(gotcha)* native plugins have no consent re-prompt, so treat capability additions as **major** (or document prominently). README should cover install snippet, capabilities and why, required template changes (`<EmDashHead />`, `<EmDashBodyEnd />`), settings, migration notes. Publish: `npm version patch|minor|major && npm publish --access public` (scoped packages need `--access public` first time). Local dev: `pnpm build --watch` + `pnpm add file:../plugins/my-plugin` (or `--workspace`). Native plugins cannot be published to the registry/marketplace (sandboxed-only, with bundle validation + security audit); sometimes dropping `page:fragments` or converting `settingsSchema` to Block Kit makes a plugin sandboxable.

## 6.20 Querying the registry (`@emdash-cms/registry-client`)

Source: https://docs.emdashcms.com/plugins/registry-client/

Advanced: build your own directory/search/release feed against the public, read-only discovery API. *Experimental* — pin exact versions (`npm install @emdash-cms/registry-client@0.6.0`). `discovery` subpath has no auth deps; runs anywhere `fetch` exists.

```ts
import { DiscoveryClient } from "@emdash-cms/registry-client/discovery";
const discovery = new DiscoveryClient({ aggregatorUrl: "https://registry.emdashcms.com" });
const { packages, cursor } = await discovery.searchPackages({ q: "", limit: 50 });   // pkg.did, pkg.slug, pkg.handle?, pkg.profile?, pkg.latestVersion?
```
- Exact `q`: a handle, DID, or either + `/slug` (`@example.com/my-gallery` selects one package; `example.com` lists that publisher). DID + slug is the stable identity; handle is the current display form (redirect DID URLs to handle URLs when known).
- Methods: `searchPackages({ q, capability?, limit?, cursor? })`, `resolvePackage({ handle, slug })`, `getPackage({ did, slug })`, `listReleases({ did, package, limit?, cursor? })` (desc semver, includes yanked), `getLatestRelease({ did, package })` (highest non-yanked). `getPackage`/`resolvePackage` may return `historicalReleaseCount` + `releaseHistoryComplete` (aggregator operational history, not signed — only trust count 1 as "first release" when complete; never bypass release-age policy on missing evidence). `getPackageStatus()` / `resolvePackageStatus()` → `{ status: "passed", value } | { status: "unavailable" }` (safe handling of `ListingUnavailable`).
- Withdrawal check before showing/selecting a release: `evaluateRegistryReleaseWithdrawal(release, discovery.labelerPolicy)` from `@emdash-cms/registry-client/withdrawal` → `withdrawn` (fails closed: invalid labels ⇒ `withdrawn` and `malformed` both true); require `release.release !== null`.
- Untrusted records: `profile` and `release` can be `null` (validation failure of one relayed record) — always null-check; validate URL schemes yourself (a `uri` may carry `javascript:`); non-2xx → `ClientResponseError` (`.error`, `.description`, `.status`, `.headers`). Aggregator returns only exact-CID revisions approved by required positive-label sources (`atproto-accept-labelers` header declares labeler DIDs).
- Host compatibility: `checkEnvCompatibility(latest.release?.requires, hostEnvFromVersions("0.37.0", "7.0.0"))` from `@emdash-cms/registry-client/env` → array of mismatches (empty = compatible).
- Astro live loader: `@emdash-cms/registry-loader` → `plugins: defineLiveCollection({ loader: registryLoader() })`; `getLiveCollection("plugins", { q, limit })`, `getLiveEntry("plugins", { publisher, slug })`; pass the cache hint to `Astro.cache.set()`; no pagination metadata (use `DiscoveryClient` for cursors).

## 6.21 Field Kit (`@emdash-cms/plugin-field-kit`)

Source: https://docs.emdashcms.com/plugins/field-kit/

First-party **native** plugin adding four widgets for `json` fields (default editor is a raw single-line JSON input). Stores plain JSON in the field's own column — removing the plugin leaves data intact; unknown keys are preserved on write, so schemas can evolve.

```bash
npm i @emdash-cms/plugin-field-kit
```
```js
import { fieldKitPlugin } from "@emdash-cms/plugin-field-kit";
emdash({ plugins: [fieldKitPlugin()] });
```
Attach via the field's `"widget": "field-kit:<name>"` + `options`. Missing required options → inline "Widget misconfigured" warning.

| Widget | Use | Stored value | Required options | Other options |
| --- | --- | --- | --- | --- |
| `object-form` | Fixed-shape object (nutrition, contact) | `{ key: value }` | `fields` | `collapsed` (false), `helpText` |
| `list` | Ordered array with add/remove/reorder | `[{...}]` | `fields` | `itemLabel` ("Item"), `min`, `max`, `sortable` (true), `summary` (Mustache-style `{{key}}` template for collapsed row title; falsy → "{itemLabel} {n}"; plain substitution), `helpText` |
| `grid` | Rows × columns matrix | `{ rowKey: { colKey: value } }` | `rows`, `columns` (`{ key, label, image? }`) | `cell`: `"toggle"` (default) / `"text"` / `"number"` / `"select"` (needs `cellOptions`), `helpText` |
| `tags` | String chips | `["a", "b"]` | — | `placeholder` ("Add..."), `max`, `suggestions` (datalist), `allowCustom` (true), `transform`: `none`/`lowercase`/`uppercase`/`trim`, `helpText`; Enter or `,` commits, Backspace removes last, duplicates ignored |

**Sub-fields** (`fields[]` for `object-form`/`list`): `{ key, label, type, required?, helpText?, defaultValue?, ...extras }` with types `text` (`placeholder`), `textarea` (`rows` default 3, `placeholder`), `number` (`min`, `max`, `step`, `prefix`, `suffix`, `placeholder`), `boolean`, `select` (`options: string[] | { label, value }[]`, `placeholder`), `date`, `color` (picker + hex), `url` (`placeholder`).

---

# Part 7 — Contributing to EmDash

## 7.1 Contributor guide

Source: https://docs.emdashcms.com/contributing/

- pnpm monorepo. `packages/core` → npm `emdash` (Astro integration, REST API, DB layer, schema management, plugin system); `packages/admin` → React admin UI. Canonical policy: https://github.com/emdash-cms/emdash/blob/main/CONTRIBUTING.md; code-level patterns/invariants in `AGENTS.md`.
- Setup: `git clone https://github.com/emdash-cms/emdash.git && cd emdash && pnpm install && pnpm build` → `cd demos/simple && pnpm dev` (Node + SQLite at `http://localhost:4321`; applies `seed/seed.json` on first request). Fast admin access: dev bypass `http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` (runs migrations, creates a dev admin, signs in, adds sample content); or use the normal setup wizard to test passkeys.
- Watch mode: terminal 1 `cd packages/core && pnpm dev`, terminal 2 `cd demos/simple && pnpm dev`.
- Checks (must pass before commit): `pnpm typecheck`, `pnpm lint` (type-aware), `pnpm format` (oxfmt + Prettier). Tests: `pnpm test` (real in-memory SQLite per test; core-only / watch / E2E variants exist).
- Contribution paths: bug fixes (must include a failing reproduction test), docs, and translations → direct PR. Features/refactors require a **maintainer-approved Discussion first** (unapproved feature PRs are closed). Docs must follow the style guide (§7.3).

## 7.2 Architecture (internals)

Source: https://docs.emdashcms.com/contributing/architecture/

**Astro integration (build time):** injects routes via `injectRoute` (nothing copied into the project) — `/_emdash/admin/[...path]` (SPA), `/_emdash/api/manifest`, `/_emdash/api/content/[collection]/...`, `/_emdash/api/media/...`, `/_emdash/api/schema/...`, `/_emdash/api/settings/...`, `/_emdash/api/menus/...`, `/_emdash/api/taxonomies/...`, `/_emdash/api/plugins/[pluginId]/[...path]`, plus auth, comments, search, imports, widgets (full inventory: `packages/core/src/astro/integration/routes.ts`). Generates virtual modules: `virtual:emdash/config`, `virtual:emdash/dialect`, `virtual:emdash/admin-registry` (static imports of plugin admin UIs), `virtual:emdash/plugins`, `virtual:emdash/media-providers`. Registers the live loader and runtime middleware (opens DB/storage, applies pending migrations per request).

**Database-first schema:** `_emdash_collections` (columns: `id`, `slug`, `label`, `label_singular`, `description`, `icon`, `supports`, `has_seo`, `comments_enabled`, `edit_locking`, `title_field`, `date_field`, `admin_config`, `hidden`, `sort_order`, `url_pattern`, `routable`, `source` ∈ `manual` / `seed` / `template:<name>` / `import:<name>` / `discovered`); `_emdash_fields` (`id`, `collection_id`, `slug`, `label`, `type`, `column_type`, `required`, `unique`, `default_value`, `validation`, `widget`, `options`, `sort_order`, `searchable`, `indexed`, `translatable`; slug unique per collection).

**Per-collection tables `ec_<slug>`** with system columns `id` (PK), `slug`, `status` (default `'draft'`), `author_id`, `primary_byline_id`, `created_at`, `updated_at`, `published_at`, `scheduled_at`, `deleted_at`, `version` (default 1), `live_revision_id`, `draft_revision_id`, `locale` (NOT NULL default `'en'`), `translation_group`, plus one real column per field, and `UNIQUE (slug, locale)`. Data concerns: schema (system tables), content (`ec_*`), media (`media` table + storage), settings (`options` with `site:` prefix).

**Runtime schema change** (adding a field): insert into `_emdash_fields` → `ALTER` the `ec_*` table (+ index if indexed) → refresh dev types. Validation builds a Zod schema from current fields (`generateZodSchema()` → `generateFieldSchema()` per field); unknown fields rejected; references verified. Type/`required`/`unique`/localization changes may need manual migration — `SchemaRegistry` rejects unsupported in-place changes.

**Data layer:** Kysely typed SQL across SQLite, libSQL, D1, PostgreSQL; dialect via `virtual:emdash/dialect`. **Live loader:** `emdashLoader()` implements Astro `LiveLoader`, registered once as `_emdash`; `getEmDashCollection("posts")` → type filter → `ec_posts`.

**Request paths:** content: page → `getEmDashCollection/Entry` → Astro `getLiveCollection/Entry` on `_emdash` → loader queries `ec_*` (publication, locale, filters, order, pagination) → wrapper maps rows + loads bylines/terms → render; preview/edit state rides the request context. Admin API: auth middleware sets `Astro.locals` user (unauthenticated browser → redirect to `/_emdash/admin/login?redirect=…`, unauthenticated API → JSON `NOT_AUTHENTICATED` 401) → route parses + checks permission → handler/repository → plugin hooks around DB ops → standard JSON envelope.

**Admin SPA:** React + TanStack Router/Query/Table, React Hook Form + Zod, TipTap (ProseMirror) for Portable Text (PT ↔ ProseMirror conversion on load/save; unknown blocks preserved as read-only placeholders), Kumo design system. Manifest-driven: `GET /_emdash/api/manifest` returns collections (label, labelSingular, supports, fields with `kind`), plugins (version, enabled), taxonomies, auth mode, version — UI adapts to live schema without rebuild. Plugin admin entries bundled via `virtual:emdash/admin-registry`.

**Signed uploads:** `POST /_emdash/api/media/upload-url` (pending item) → upload to target (S3-compatible: signed URL bypassing body limits; R2 binding/local: EmDash streaming endpoint) → `POST /_emdash/api/media/:id/confirm` → validate + mark ready.

**Import sources:** pluggable `ImportSource { id, name, description, icon, requiresFile?, canProbe?, probe?(), analyze(), fetchContent() (async generator of NormalizedItem), fetchMedia?() }` — WXR, connector (EmDash WP plugin), REST (probe only).

## 7.3 Documentation style guide (summary)

Source: https://docs.emdashcms.com/contributing/docs-style-guide/

- Write for a tired, hurried, second-language, new-to-stack reader: short sentences, plain words, acronyms expanded on first use, active voice. Document how to build *with* EmDash, not how it's built (internals go to the internals page). Link out for non-EmDash topics.
- Emphasis by reader need, not authoring recency or builder salience; no straw-man comparisons ("unlike most CMSs…") outside the evaluation/"Coming from" pages; no definition by negation ("no rebuild needed") — state what happens.
- Evergreen: no "now / no longer / used to"; version deltas live only in upgrade guides.
- Voice: neutral, factual; no *we/us/our/let's/I*; address the reader as *you*; no narration, whimsy, mascots; exclamation points rare.
- Headings: `<h1>` from frontmatter, sections from `<h2>`, short, no trailing punctuation, code formatted. Lists: bullets for unordered, numbered/`<Steps>` for procedures; promote long items to `<h3>`.
- Examples: "for example" for one; "e.g." in parentheses for non-exhaustive; exhaustive lists use parentheses without "e.g.".
- Screenshots only when spatially necessary; keep instructions in text; record fixture/route/viewport/locale/theme.
- Code: introduce every block with a full standalone sentence; real working code (no foo/bar); one realistic config; `title="path"` for files; Expressive Code `del={n}`/`ins={n}` annotations for diffs; preview locally.
- Upgrade guides: fixed structure — how to upgrade, "may just work", changelog link, then per-change `### [Renamed/Changed/Removed/Deprecated]: <feature>` with "In earlier versions…", "…now…", `#### What should I do?` imperative diff.
- EmDash specifics: state sandboxed vs native explicitly; never include `messages.po` in docs PRs; keep experimental features lean with a caution aside + RFC link; call the AT Protocol identity an **Atmosphere account**. Docs go through the same PR/review flow as code.

## 7.4 Translating EmDash (admin UI)

Source: https://docs.emdashcms.com/contributing/translating/

- Lingui for extraction, Lunaria for progress (dashboard: https://i18n.emdashcms.com). Catalogs: `packages/admin/src/locales/<locale>/messages.po` (`msgid` = English key, `msgstr` = translation; empty → English fallback).
- Every translation must be supervised by a native/fluent speaker; AI first passes allowed only with full fluent review + in-UI preview, disclosed in the PR; unsupervised machine output is closed. Untranslated beats wrong.
- Workflow: check dashboard + open PRs → branch `i18n/<locale>` → fill `msgstr` → test → PR to `main` titled `i18n(de): add/update German translations`. Never translate `msgid`, placeholders (`{error}`, `{email}`), tag markers (`<0>…</0>` — translate the text inside), or `#:` comments.
- Testing: `pnpm run locale:compile && pnpm build && pnpm --filter emdash-demo dev` → switch locale in admin Settings. Pseudo locale (`EMDASH_PSEUDO_LOCALE=1` in `demos/simple/.env`, dev-only) garbles wrapped strings to reveal unwrapped ones.
- New language: add to `packages/admin/src/locales/locales.ts` (`{ code, label, enabled: false }` — single source of truth for Lingui/Lunaria/runtime; maintainer enables at sufficient coverage) → `pnpm run locale:extract` → translate. Standards: accuracy (read `#:` source context), consistent terminology per locale, direct professional tone. Partial translations welcome.

---

# Part 8 — Themes

## 8.1 Themes overview

Source: https://docs.emdashcms.com/themes/overview/

- A theme = a complete Astro project distributed as a `create-astro` template (routes, components, EmDash config, optional seed). No runtime theme package or template hierarchy — after scaffolding the files belong to the site.
- Structure: `astro.config.mjs` (server output, adapter, EmDash, DB, storage), `package.json` (`emdash.seed` → seed path), `seed/seed.json`, `src/components/`, `src/layouts/`, `src/live.config.ts` (`_emdash` live collection), `src/pages/`, `src/styles/`. The blank template has no user seed → built-in default seed.
- Install: `npm create astro@latest -- --template @emdash-cms/template-blog` (Node) / `@emdash-cms/template-blog-cloudflare`.

| Purpose | Node | Cloudflare |
| --- | --- | --- |
| Empty shell | `@emdash-cms/template-blank` | — |
| Basic pages | `@emdash-cms/template-starter` | `@emdash-cms/template-starter-cloudflare` |
| Posts, pages, categories, tags, widgets | `@emdash-cms/template-blog` | `@emdash-cms/template-blog-cloudflare` |
| Portfolio | `@emdash-cms/template-portfolio` | `@emdash-cms/template-portfolio-cloudflare` |
| Marketing pages from versioned blocks | `@emdash-cms/template-marketing` | `@emdash-cms/template-marketing-cloudflare` |

- Seed discovery order (build time): `.emdash/seed.json` → `package.json#emdash.seed` → `seed/seed.json` → built-in default. First admin visit runs the setup wizard (shows seed `meta`, offers sample content), applies the seed to an empty DB, and records completion; **later starts never reapply the seed**. *(gotcha)* A seed is initial setup data, not a migration system — evolve a live site in the admin and re-export when the repo needs a new baseline.

## 8.2 Creating a theme

Source: https://docs.emdashcms.com/themes/creating-themes/

- Start from the closest current template (Node vs Cloudflare variants keep DB/storage/adapter/middleware aligned); copy real files — templates differ in routes (blog: `posts/index.astro`, `posts/[slug].astro`, `pages/[slug].astro`, `category/[slug].astro`, `tag/[slug].astro`, `search.astro`; starter uses `src/pages/[slug].astro`).
- Declare the seed in `package.json`: `"emdash": { "seed": "seed/seed.json" }`. Edit the template's existing seed rather than replacing it. Content entry `id` is seed-local (used by `$ref:`), not the DB ID; `slug` becomes `entry.id`.
- Routes: `output: "server"`; no `getStaticPaths()`; archive uses `orderBy: { published_at: "desc" }` (never `sort`/`sortBy`/callbacks); single route passes `content={{ collection, id: post.data.id, slug }}` to the layout and spreads `{...post.edit.title}` for visual editing.
- CMS-managed values must come from `getSiteSettings()`, `getMenu()`, `<WidgetArea />` — not hard-coded constants; static design copy may stay in Astro files.
- Images: pass the whole media value to `<Image image=… alt width height />`; field alt used unless overridden; `priority` only above the fold.
- Page layouts: `select` field `template` with stable values (`default`, `full-width`, `landing`) → explicit component map (never turn a stored string into a module path).
- Search: enable `search` in collection `supports` + `searchable` fields → `import LiveSearch from "emdash/ui/search"` → `<LiveSearch placeholder collections={["posts", "pages"]} />` (uses `Astro.currentLocale`; `locale={null}` to search all locales).
- Sections in seed (see §3.12); structural model applies even when sample content is omitted.
- Structured page blocks: `blocks` field + `defineBlockComponents<PageContentBlock>({...})` + `<Blocks value components />` (marketing template seeds `marketing_hero`, `marketing_features`, `marketing_testimonials`, `marketing_pricing`, `marketing_faq`). Custom Portable Text objects go through `<PortableText components={{ type: {...} }} />`; a seed can hold the stored value but a **native plugin** is needed to register a custom editor/renderer package.
- Test: scaffold into a clean dir → build + typecheck → empty DB → `/_emdash/admin/setup` with and without sample content → every route with seeded/new/empty content → edit settings/menus/taxonomies/PT/blocks in admin and confirm routes → deployment-specific setup in a disposable environment. Rebuilding doesn't reapply the seed to an initialized DB.
- Publish: GitHub repo usable via `npm create astro@latest -- --template github:example/emdash-theme-publication`; strip local DBs/uploads/secrets; document the deployment target. Checklist: server output + adapters; `emdashLoader()` registered; `package.json#emdash.seed` exists; every queried collection/field seeded; `orderBy` + correct identifiers; no duplicated CMS values; clean setup both ways; build + typecheck pass.

## 8.3 Seed file format (reference)

Source: https://docs.emdashcms.com/themes/seed-files/

Embedded at build time; for first setup and explicit `emdash seed` runs — not a per-deploy migration. Discovery order as §8.1. Editor schema: `"$schema": "https://emdashcms.com/seed.schema.json"`.

**Root properties:** `version` (required; only `"1"`), `defaultLocale` (non-empty, no surrounding whitespace; fallback for locale-bearing rows; runtime i18n config wins), `meta` `{ name, description, author }` (shown at setup), `settings`, `blockTypes`, `collections`, `relations`, `taxonomies`, `bylines`, `content`, `menus`, `redirects`, `widgetAreas`, `sections`.

**`settings`** — partial site settings: `title`, `tagline`, `logo`, `favicon`, `url`, `postsPerPage`, `dateFormat`, `timezone`, `social`, `seo`. Wizard can override title/tagline; `onConflict: "skip"` preserves existing values and fills missing ones.

**`blockTypes[]`** — `{ slug, label, category, currentVersion, versions: [{ version, fields[] }] }`; applied before collections; versions are contiguous positive integers from 1; `currentVersion` must exist; export preserves numbers. With `onConflict: "update"`, amending an existing version is allowed only when compatible, else `BLOCK_TYPE_VERSION_CONFLICT` — add a new version for breaking changes. Seeded block values carry `_type`, `_version`, `_key` (runtime fills active version + key when omitted).

**`collections[]`** — required `slug` (lowercase letter start; lowercase letters/digits/underscores), `label`, `fields`. Optional: `labelSingular`, `description`, `icon` (Phosphor name e.g. `calendar-blank`), `admin.listColumns` (≤ 4 field slugs), `admin.quickCreate` (default true), `supports` (any of `drafts`, `revisions`, `preview`, `scheduling`, `search`, `seo`), `urlPattern` (e.g. `/posts/{slug}`, ≤ 1 placeholder per segment), `routable` (default true; published entries need a slug), `hidden` (hides sidebar/palette/quick-create; still reachable by URL/API), `sortOrder` (sidebar order; collections only — fields have no `sortOrder`, they use array order), `group` (sidebar folder), `commentsEnabled`, `editLocking` (default true), `titleField`, `dateField` (a `datetime` field).

**Fields** — `slug`, `label`, `type` (required); `required`, `unique`, `searchable`, `indexed`, `translatable` (default true; false = one value shared across translations), `defaultValue`, `validation`, `widget`, `options`. Types: `string`, `text`, `url`, `slug`, `number`, `integer`, `boolean`, `datetime`, `select`, `multiSelect`, `portableText`, `json`, `repeater`, `blocks`, `image`, `file`, `reference` (stores no column — links live in its relation). `indexed: true` only for `string`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `reference` (only while unbound), `slug`. Validation rules: `min`/`max` (numeric), `minLength`/`maxLength`/`pattern` (string-shaped), `options` (`select`/`multiSelect`), `subFields`/`minItems`/`maxItems` (`repeater`), `allowedTypes`/`minItems`/`maxItems` (`blocks`; `retiredTypes` is server-managed), `allowedMimeTypes` (media). *(gotcha)* `validateSeed()` doesn't deep-check `validation`/`options` — bad rules surface at schema build or content write.

**`relations[]`** — `{ slug, parentCollection, childCollection, parentLabel, parentLabelSingular?, childLabel, childLabelSingular?, maxChildrenPerParent?: number|null, maxParentsPerChild?: number|null }`. A reference field binds with `"validation": { "relation": "post_authors" }`, or uses `targetCollection` to have a relation auto-created (one-sided view). Collections of an existing relation are fixed (seed naming different ones fails); labels/limits update with `onConflict: "update"`.

**`taxonomies[]`** — `{ name, label, labelSingular, hierarchical, collections, terms: [{ slug, label, parent? }] }` (+ seed-local `id`, `locale`, `translationOf` on taxonomies and terms; a translation is ordered after its source; `hierarchical`/`collections` shared across locales and may be omitted on translations; `parent` = parent slug in same locale, ignored with warning on flat taxonomies). Terms are sample data (need `includeContent`).

**`bylines[]`** — `{ id, slug, displayName, isGuest?, bio?, websiteUrl?, avatar?: { storageKey, filename, mimeType, alt, width, height } }` (avatar points to an existing storage object; creates/reuses a media row, no upload). Sample data.

**`content`** — `{ "<collection>": [{ id (seed-local), slug (required if routable), status ("published" default | "draft"), data, taxonomies: { name: [termSlugs] }, bylines: [{ byline: <id>, roleLabel }], locale, translationOf }] }`. Routable entries get a generated DB ID (seed id mapped for refs); slugless entries in `routable: false` collections use the seed `id` as DB ID (idempotent). `$ref:<seed-id>` inside `data` resolves to the created DB ID (target must be applied earlier; unresolved refs stay literal). Declare relation links from the **parent** end. `$media: { url, filename, alt, caption }` downloads + uploads via the supplied storage adapter → media field value (also inside PT `image`/`gallery` `asset`, filling missing alt/width/height); same URL reused within one apply; no local `file` support; no storage adapter → `null`; `skipMediaDownload: true` → external media values.

**`menus[]`** — `{ name, label, items: [{ type: "custom" | "page" | "post" | "taxonomy" | "collection", label, url? (custom), ref? (page/post → seed content id), collection?, titleAttr?, cssClasses?, locale?, target?, id?, translationOf?, children? }] }`. Structural (applied even without content). Missing `ref` target → warning + unresolved item. Items are always deleted and recreated when the menu is applied.

**`redirects[]`** — `{ source, destination, type: 301|302|307|308, enabled, groupName }`; both paths start with a single `/`; no protocol-relative URLs, traversal, or newlines.

**`widgetAreas[]`** — `{ name, label, widgets: [{ type: "content", title, content (PT) } | { type: "menu", title, menuName } | { type: "component", title, componentId, props }] }`; no `settings` property; widgets always deleted and recreated on apply.

**`sections[]`** — `{ slug (lowercase/digits/hyphens), title, description, keywords, source: "theme" (default) | "user" | "import", content (PT with stable _key) }`; theme sections can't be deleted in admin; structural.

**Localization:** `id` + `translationOf` on taxonomies, terms, menus, menu items, content; source before translation; translated content must set `locale` and reference the same collection.

**Programmatic:** `import { applySeed, validateSeed, type SeedApplyOptions, type SeedFile } from "emdash/seed"`. `validateSeed(seed)` → `{ valid, errors, warnings }`; `applySeed(db, seed, options)` throws `Invalid seed file` on errors and returns counters (collections, fields, taxonomies, bylines, menus, redirects, widget areas, sections, settings, content, media). Options: `includeContent` (default **false** programmatically; wizard passes the user's choice; CLI includes unless `--no-content`), `onConflict` (`"skip"` default | `"update"` | `"error"`), `storage`, `skipMediaDownload`, `mediaBasePath` (unused). Conflict semantics: collections/fields/bylines/content/redirects/sections honor the mode; taxonomies too, except unedited built-in `category`/`tag` are replaced in every mode; settings per key (`skip` fills missing; `update` overwrites; `error` stops at first existing); menus and widget areas keep their row but replace items/widgets; content matched by collection+slug+locale (or seed id for slugless non-routable). `update` replaces content data and reconciles bylines/taxonomies — test on a copy.

**Validation covers:** version/defaultLocale; container shapes; required names/labels/ids/slugs; supported field/widget types; duplicate ids per scope; indexed types; `admin.listColumns`; taxonomy parents; content translations; byline refs; menu item requirements; redirect paths/codes. Warnings: taxonomy without collections, parent on flat taxonomy, absent menu content ref. Not validated: `data` vs fields, settings, field `validation`/`options`, arbitrary PT, widget props, `$ref:` targets, `$media` availability.

**CLI:** `npx emdash seed seed/seed.json --validate`; `npx emdash seed seed/seed.json --database ./data.db --on-conflict skip`; `npx emdash export-seed --database ./data.db --with-content=all > seed/seed.json` (local SQLite only — export D1 to a local file first; `--media-base-url` makes exported media importable elsewhere).

## 8.4 Porting a WordPress theme

Source: https://docs.emdashcms.com/themes/porting-wp-themes/

- Import representative content first; record post types, taxonomies, permalinks, menus, widget areas, Customizer values, shortcodes, plugin markup. Choose explicit URLs per type (no template hierarchy). File map as §2.1 plus `template-parts/content.php` → `src/components/PostCard.astro`; starter template uses `src/pages/[slug].astro` for pages — pick one route model and align `urlPattern` + redirects.
- Design: gather `style.css`/enqueued CSS, `theme.json` (block themes), template parts, fonts/icons/images (licensed), breakpoints, interactions → tokens in project CSS, shell in `src/layouts/Base.astro`, repeated parts as components; drop WP-generated class names/JS unless needed.
- Queries: `WP_Query` → `getEmDashCollection("posts", { orderBy: { published_at: "desc" }, limit: 12 })`; single → `decodeSlug` + `getEmDashEntry` + `<PortableText>`; taxonomy archives → `getTerm(name, slug, { includeCounts: false })` then `where: { [name]: term.slug }`; batch with `getTermsForEntries()` using `entry.data.id`.
- Dynamic features: menus from seed + `getMenu("primary")` (render `children`, `aria-current`); widget areas from seed + `<WidgetArea name="sidebar" />` (component widgets only where the component ID is registered); identity via `getSiteSettings()` (site title → `title`, tagline → `tagline`, custom logo → `logo`, site icon → `favicon`, posts per page → `postsPerPage`); page templates via select field + component map; shortcodes/blocks → Portable Text shapes; custom `_type`s (e.g. namespaced `publication.gallery`) rendered via `<PortableText components={{ type: { "publication.gallery": Gallery } }} />` (type `PortableTextBlock` from `emdash`) — a native plugin is needed for a custom editor.
- Seed every route dependency at `seed/seed.json`. Stage the port: import → start from current template → shared layout/tokens → archive + single routes → taxonomy/search/menus/widgets/settings → seed + empty-DB setup test → compare URLs at mobile/desktop, edge cases (empty fields, long titles, missing images, drafts, 404) → redirects for every changed permalink.
- Hard cases: child themes (port the *effective* parent+child output); block themes (`theme.json` tokens + `templates/*.html` structure → Astro components); page builders (deliberate PT conversion or redesign); WooCommerce (commerce is a separate integration — presentation port doesn't replace product/cart/checkout/order semantics). Keep WordPress online until media, URLs, redirects, SEO, forms, and plugin pages are verified.

---

# Part 9 — Deployment

## 9.1 Deploy to Cloudflare Workers (D1 + R2)

Source: https://docs.emdashcms.com/deployment/cloudflare/

**Prereqs:** Cloudflare account, deps installed, `pnpm wrangler login`.

**`wrangler.jsonc` (template shape):** `name`, `main: "./src/worker.ts"`, `compatibility_date` (e.g. `2026-02-24`), `compatibility_flags: ["nodejs_compat"]`, `d1_databases: [{ binding: "DB", database_name }]`, `r2_buckets: [{ binding: "MEDIA", bucket_name }]`, `worker_loaders: [{ binding: "LOADER" }]` (sandbox), `triggers: { crons: ["* * * * *"] }`. Wrangler creates missing named resources on first deploy; keep names stable. Binding names must match the adapters.

**`astro.config.mjs`:**
```js
import cloudflare from "@astrojs/cloudflare"; import react from "@astrojs/react";
import emdash from "emdash/astro"; import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
export default defineConfig({ output: "server", adapter: cloudflare(),
  integrations: [react(), emdash({ database: d1({ binding: "DB" }), storage: r2({ binding: "MEDIA" }), sandboxRunner: sandbox() })] });
```
Omit `sandboxRunner` + `LOADER` if no registry/`sandboxed` plugins.

**Worker entry (`src/worker.ts`):**
```ts
import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
export { PluginBridge };
export default { ...handler, scheduled: createScheduledHandler() } satisfies ExportedHandler;
```
`createScheduledHandler({ generalCron: "…" })` must match `triggers.crons` for non-minutely general maintenance (mismatch → logged and ignored). `PluginBridge` export is harmless without plugins.

**Deploy:** `pnpm build && pnpm wrangler deploy`. Default `auto` migration mode applies core migrations on the first request; seed schema/structure applied once on first request until setup completes (sample content only if chosen in the wizard). Seed inlined at build from `.emdash/seed.json` → `package.json#emdash.seed` → `seed/seed.json` → default.

**Scheduled publishing** *(gotcha)*: requires **both** the Cron Trigger and the exported `scheduled` handler — otherwise scheduled entries never go live in production (local `astro dev` uses a timer, so local success proves nothing). `pnpm emdash doctor` → `scheduler wiring` check (recognizes the documented entry-point shape; the `database` check fails on D1 projects looking for `./data.db` — irrelevant). New/changed triggers take up to **15 min** to start; then overdue entries publish. Watch with `pnpm wrangler tail` (`Ok` = no uncaught error; publishing logs `[scheduled] Published N scheduled item(s)`). Admin shows **Scheduled publishing needs attention** when an entry is overdue and no run completed in 5 minutes.

**Performance:** Targeted Placement (`placement.mode: "targeted"` with exactly one of `region` / `host` / `hostname`) near the D1 primary; don't enable D1 read replicas with it; keep `session` at `"disabled"`. **Object cache:** `objectCache: kvCache({ binding: "CACHE" })` from `@emdash-cms/cloudflare` (§9.8). **Workers Cache** (edge cache in front of the Worker): `cache: { provider: cacheCloudflare() }` from `@astrojs/cloudflare/cache` + `routeRules` (e.g. `"/": { maxAge: 300, swr: 86400 }`); purge with `import { cache } from "cloudflare:workers"; await cache.purge({ purgeEverything: true })` or `{ tags: ["posts"] }` (no REST creds). Admin/API responses are `private, no-store`. *(gotchas)* responses without `Cache-Control` are heuristically cached ~2 h (RFC 9111) — set explicit headers on every custom route; cached anonymous pages are served to logged-in editors too (no toolbar) because the cache runs before the Worker.

**Custom domain:** `"routes": [{ "pattern": "www.example.com", "custom_domain": true }]` (domain must be active in the same account); keep `workers.dev` for diagnosis.

**Public R2:** `r2({ binding: "MEDIA", publicUrl: "https://media.example.com" })` — exposes every object; never expose the `backups/` prefix.

**Image transformation:** EmDash transforms R2 media in-Worker via the `IMAGES` binding; `@astrojs/cloudflare` adds it automatically when `imageService` is unset / `"cloudflare-binding"` / `{ runtime: "cloudflare-binding" }` (declare `"images": { "binding": "IMAGES" }` for clarity; check `dist/server/wrangler.json` via `.wrangler/deploy/config.json`). Internal `/_emdash/api/media/file/…` route reads R2 directly (works behind Access and `global_fetch_strictly_public`); bucket-URL media uses the adapter's HTTP-fetching endpoint. Missing binding → internal route serves full-size originals silently; bucket URL → 500. `imageService: "passthrough"` opts out. Billing: Images transformations — each unique source+params once per month; Free plan 5,000/month, then new transforms error `9422`.

**Cloudflare Access:** `auth: access({ teamDomain, audienceEnvVar: "CF_ACCESS_AUDIENCE", roleMapping: { Admins: 50, Editors: 40 } })`; `pnpm wrangler secret put CF_ACCESS_AUDIENCE` (§3.15).

**Email:** `send_email: [{ name: "EMAIL" }]` binding + `plugins: [cloudflareEmail({ from: { email, name }, replyTo })]` from `@emdash-cms/cloudflare/plugins` (custom `binding` option); onboard/verify the sender domain with Cloudflare Email Sending first; activate under **Extensions**, select under **Settings → Email**. Without an email plugin: "Email is not configured".

**AI Search:** `plugins: [aiSearch()]` from `@emdash-cms/cloudflare/plugins` + `ai_search_namespaces: [{ binding: "AI_SEARCH", namespace: "default" }]`; route `src/pages/api/ai-search/search.ts` → `export { POST, prerender } from "@emdash-cms/cloudflare/plugins/ai-search"`; UI `import AISearchSnippet from "@emdash-cms/cloudflare/plugins/ai-search/astro"` → `<AISearchSnippet apiUrl="/api/ai-search" placeholder>` with a `slot="trigger"` button; admin **Cloudflare AI Search** → choose collections → **Sync All Content**.

**Secrets:** `pnpm wrangler secret put <NAME>`; never in `wrangler.jsonc` or `import.meta.env` (Vite inlines at build). `EMDASH_ENCRYPTION_KEY` read via `process.env` (populated with `nodejs_compat` + compatibility date ≥ 2025-04-01; earlier dates need `nodejs_compat_populate_process_env`); rotate by prepending the new key and keeping old keys comma-separated until all secrets are re-saved. Preview HMAC secret and IP salt auto-generated in DB unless overridden.

**Preview environments:** named Wrangler envs don't inherit bindings — `pnpm wrangler d1 create my-emdash-site-preview --binding DB --env preview --update-config`, `pnpm wrangler r2 bucket create my-emdash-media-preview --binding MEDIA --env preview --update-config`, repeat `worker_loaders`/KV/AI Search/email bindings under `env.preview`, `pnpm wrangler secret put <NAME> --env preview`, `pnpm build && pnpm wrangler deploy --env preview`. Never point preview bindings at production.

**Verify:** public page, admin sign-in, media upload/retrieve, `scheduled` in `wrangler tail`. Errors "D1 binding not found" / "R2 binding not found" → binding name mismatch (`DB` / `MEDIA`); migration errors → `wrangler tail` + file an issue.

## 9.2 Deploy to Node.js

Source: https://docs.emdashcms.com/deployment/nodejs/

- Node **22.16+** (Node 22 prints a harmless `ExperimentalWarning: SQLite is an experimental feature`; Node 24 doesn't). Single server: SQLite + local storage; multiple instances: PostgreSQL or libSQL; media independent of disk: S3-compatible.
- Config: `adapter: node({ mode: "standalone" })`, `emdash({ database: sqlite({ url: "file:./data/emdash.db" }), storage: local({ directory: "./data/uploads", baseUrl: "/_emdash/api/media/file" }) })`; production pattern `database: sqlite({ url: \`file:${process.env.DATABASE_PATH}\` }), storage: s3()` (`s3` from `emdash/astro`; works with R2 S3 API, MinIO, etc.).
- Run: `npm run build` → `node ./dist/server/entry.mjs` (default `http://localhost:4321`). *(gotcha)* The standalone entry does **not** load `.env` — set env via the host, or `node --env-file=.env ./dist/server/entry.mjs` locally. First request applies migrations (`auto`) and seeds a fresh DB.
- **Scheduler** runs only while a Node process runs — keep ≥ 1 process alive (scheduled publishing, plugin tasks, maintenance pause otherwise).
- Sandbox: `@emdash-cms/sandbox-workerd` (§9.9).
- **Docker:** `.dockerignore` (`node_modules`, `dist`, `.git`); multi-stage `node:22-alpine` build → copy `dist`, `node_modules`, `package.json`, `mkdir -p data`, `ENV HOST=0.0.0.0 PORT=4321`, `EXPOSE 4321`, `CMD ["node", "./dist/server/entry.mjs"]`; `docker run -p 4321:4321 -v emdash-data:/app/data my-emdash-site`; compose with named volume `emdash-data:/app/data`, `restart: unless-stopped`. Seed is inlined at build (no copy needed). This builds *your site*, unlike the monorepo root Dockerfile.
- **Env vars:** `EMDASH_ENCRYPTION_KEY` (`npx emdash secrets generate`; operator-provided, not in DB; comma-separated rotation list; malformed → startup message + secret ops fail), optional overrides `EMDASH_PREVIEW_SECRET`, `EMDASH_IP_SALT`, `EMDASH_AUTH_SECRET` (legacy IP-salt source; `EMDASH_IP_SALT` wins; leave unset on new deployments); `DATABASE_PATH`, `HOST`, `PORT`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto`), `S3_PUBLIC_URL`. Never commit secrets or bake them into images.
- Persistent disk required for SQLite (ephemeral FS loses the DB) — back up the DB file **and** the upload dir; stop the process before replacing either.
- Health check: `src/pages/health.ts` → `export const GET = () => new Response("OK", { status: 200 })` (proves routing only). **Pre-traffic verification:** `/health` + a public page; `npx emdash migrate --check` (no pending/unknown); admin sign-in + publish a disposable draft; upload/retrieve/delete a media file; exercise a sandboxed plugin route and check for `workerd`/sandbox-unavailable errors.

## 9.3 Update EmDash (site operators)

Source: https://docs.emdashcms.com/deployment/updating/

- Pre-1.0 semver: patch = fixes; minor = features **and** breaking changes (marked **Breaking** with required action in release notes). `emdash` and `@emdash-cms/cloudflare` share a version and must be updated together (exact dependency). Plugins version independently with a minimum `emdash`. Releases: https://github.com/emdash-cms/emdash/releases
- Template files (layouts, components, styles, `astro.config.mjs`) are copied at scaffold time and **not** updated — diff against https://github.com/emdash-cms/emdash/tree/main/templates to adopt changes.
- Before: restorable DB backup + separate media backup (JSON export can't restore; migrations have no undo); check Node version.
- Steps: `pnpm outdated emdash @emdash-cms/cloudflare` → `pnpm up --latest emdash @emdash-cms/cloudflare` (+ plugin packages; caret ranges below 1.0 admit patches only, so `--latest` is needed) → `pnpm build` (writes the migration manifest) → `pnpm dev` (regenerates `emdash-env.d.ts`; migrations run on first request) → deploy (`pnpm wrangler deploy` / restart Node) → verify admin, public page, publish a disposable entry, media round-trip, scheduled tasks, sandboxed plugins. Use `emdash migrate --check` / pre-traffic migration per §9.4.
- **Release note — reference fields bind to relations:** the update binds each reference field that named a target collection to a new relation and copies its column IDs into links (column kept, nothing deleted). Left unbound when: no/missing target collection; marked searchable or indexed; relation slug `{collection}_{field}` already taken; locales of one entry select different entries (links are per translation group). Unbound fields keep working as text-box ID fields. Action: open an entry per collection; fields rendering as text boxes → bind via §3.7 "Bind a field that has no relation" (settle per-locale selections first).
- If broken: build/runtime errors → read **Breaking** entries for skipped versions; plugin fails → plugin changelog + §4.5; Astro API errors → EmDash needs Astro 6+; rollback = reinstall previous versions and redeploy — migrations aren't undone, so if the old artifact can't use the migrated DB, stop traffic and restore DB + artifact together.

## 9.4 Core database migrations (deployment-managed)

Source: https://docs.emdashcms.com/deployment/core-migrations/

Core migrations update EmDash's own tables and the standard columns on content tables — never your collections/fields (that's §9.5). Forward-only; retryable after completed statements, but an interrupted remote run is ambiguous → inspect with `emdash migrate --status`, don't assume.

**Runtime modes** (`emdash({ migrations: { runtime: "auto" | "check" | "manual", dev: "auto" } })`, env override `EMDASH_MIGRATIONS_MODE`): `auto` (default; startup checks + applies), `check` (one status query; 503 while known migrations pending; tolerates newer-compatible records during rolling deploys), `manual` (no runtime query — only when the pipeline reliably applies + checks every build). Setup/dev-bypass routes obey the mode. Recommended rollout: `auto` → `check` → `manual`.

**Manifest:** build/sync writes `.emdash/migrations.json` (secret-free: EmDash version, ordered migration set, locale config, adapter executor). **Gitignore it**; deployment jobs generate and consume it. Manifest and artifact must come from the same build; a global CLI can't substitute its registry.

**Workflow:** `pnpm build` → `pnpm emdash migrate --status` (applied/pending/unknown, no changes) → `pnpm emdash migrate` (shows target, asks confirmation) → `pnpm wrangler deploy` → `pnpm emdash migrate --check` (never applies; non-zero when pending or unknown records). Non-interactive apply and every `--json` apply require `--expected-target-fingerprint`. `--manifest <path>`; `--from-config [--config astro.config.mjs]` for local investigation only.

**Targets (credentials stay in env, read only by the migrate command):**

| Adapter | Manifest target | Default credential var | Override |
| --- | --- | --- | --- |
| SQLite | path or `file:` URL (relative to project root) | — | `--database <path>` |
| libSQL | public URL | `TURSO_AUTH_TOKEN` | `migrationAuthTokenEnv` |
| PostgreSQL | connection var name | `DATABASE_URL` | `--database-url-env <name>` |
| D1 | Wrangler binding | `CLOUDFLARE_API_TOKEN` | `--d1`, `--account-id`, `--wrangler-config`, `--wrangler-env` |
| Hyperdrive | primary binding + origin var | binding-specific direct-origin var | `migrationConnectionStringEnv` |

**D1:** `emdash migrate` never creates a database — `pnpm wrangler d1 create my-site-production`, put the UUID in the binding, build, then `export CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=…` (D1 Edit scope) and `pnpm emdash migrate --status --wrangler-config wrangler.jsonc --wrangler-env production` → apply. Or `--account-id … --d1 <uuid-or-name>` (name must be unique; preview/placeholder IDs and ambiguous bindings fail closed). **Lock:** held during any migration run (CLI or `auto`); a second run waits 10 s then succeeds-without-applying or fails. **CI (GitHub Actions):** secret `CLOUDFLARE_API_TOKEN`; vars `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `EMDASH_TARGET_FINGERPRINT` (from a locally reviewed `--status`); `concurrency.group: emdash-migrations-${account}-${db}` with `cancel-in-progress: false`; steps: install → build → `migrate --status --json --account-id --d1` → `migrate --account-id --d1 --expected-target-fingerprint "$EMDASH_TARGET_FINGERPRINT"` → `wrangler deploy` → `migrate --check`. Update the fingerprint only after local review.

**Stuck lock:** after > 1 min, runs error "The migration lock has been held since … (lock <id>)". Confirm nothing is running → `pnpm emdash migrate --status` (shows lock id; first pending migration may be partial; if applied set keeps changing, wait) → `pnpm emdash migrate --release-lock <id>` (confirms target; `--expected-target-fingerprint` non-interactively) → `pnpm emdash migrate`. Local dev D1: stop the server and `pnpm wrangler d1 execute DB --local --command "UPDATE _emdash_migrations_lock SET is_locked = 0 WHERE is_locked = <id>"`.

**Hyperdrive:** the migration executor connects **directly to the PostgreSQL origin** (not through Hyperdrive; no Worker private-network reach). Set `migrationConnectionStringEnv` on `hyperdrive()` and give that var only to the migration job.

**Rolling deploys:** expand/deploy/contract; runtime `check` tolerates unknown *applied* records; CLI check reports them and apply refuses. **Rollback:** redeploying old code doesn't undo migrations — back up before applying; if the old artifact can't run on the new schema, restore DB + artifact together; never delete `_emdash_migrations` rows or run `down()`.

**PostgreSQL mixed ownership** (`must be owner of table`): pick one canonical role; back up; stop traffic; inventory tables (`pg_class` joined to `pg_namespace` for `current_schema()`, relkind `r`/`p`) and functions (`pg_proc` with `pg_get_function_identity_arguments`); EmDash objects = `_emdash_*`, `_plugin_*`, `ec_*`, and unprefixed `content_taxonomies`, `media`, `options`, `revisions`, `taxonomies`; fix with targeted `ALTER TABLE <schema>.<table> OWNER TO <role>` / `ALTER FUNCTION <schema>.<fn>(<args>) OWNER TO <role>` (never `REASSIGN OWNED` unless the old role was dedicated); re-verify; connect as the role and check `current_database()`, `current_schema()`, migration status.

**Troubleshooting:** no manifest → build first; artifact mismatch → rebuild + deploy together, use the project CLI; missing/ambiguous target → supply explicit selectors; fingerprint changed → review target; unknown records → don't delete/rerun, investigate divergent builds; ambiguous D1 write → `--status`, don't replay; datetime normalization error (legacy values in a DST-repeated/skipped hour) → fix listed rows with explicit UTC offsets; Hyperdrive can't connect → test runner→origin reachability.

## 9.5 Evolving a deployed site's schema

Source: https://docs.emdashcms.com/deployment/schema-evolution/

| Workflow | Changes | How |
| --- | --- | --- |
| Content editing | entries, media, settings | admin / content API |
| Code deploy | templates, config, EmDash version | `wrangler deploy` (may run core migrations) |
| First-time bootstrap | everything from empty | migrations + seed + setup wizard (first boot only) |
| Schema evolution | collections, fields, taxonomies | admin **Content Types** or `emdash schema` against the live site |

*(gotcha)* Deploying a changed seed against an existing DB does nothing. Evolve live schema in the admin (immediate effect; API/loader/UI read schema at runtime) or via CLI. Regenerate types after: `npx emdash types --url https://example.com`.

**CLI:** `npx emdash login --url https://example.com` (device flow) or an API token from **Settings → API Tokens** via `--token` / `EMDASH_TOKEN`; then `npx emdash schema add-field posts subtitle --type string --label "Subtitle" --url …`, `npx emdash schema remove-field posts legacy_field --url …`, `npx emdash schema create projects --label Projects --url …`. Scriptable per environment but **not idempotent** (rerunning `create`/`add-field` on existing objects can fail) — inspect with `emdash schema list` / `get`, record progress, stop on first error. *(gotcha)* Removing a field deletes its column and values; JSON export can't restore — take a raw backup and rehearse.

**Keep the seed in sync:** the embedded seed defines what a *fresh* DB bootstraps to (previews, DR rebuilds). Missing seed → built-in starter blog model + `astro dev` warning. Export the live model: `npx wrangler d1 export emdash-db --remote --output=./prod.sql && sqlite3 prod.db < prod.sql && npx emdash export-seed --database prod.db > .emdash/seed.json` (add `--with-content` for entries); commit with the code that depends on it.

**Rehearse on preview:** `npx wrangler d1 create emdash-db-preview --binding DB --env preview --update-config` → export prod → `npx wrangler d1 execute DB --env preview --remote --file=./prod.sql` → `npm run build && npx wrangler deploy --env preview` → run the schema command against the preview URL → verify pages/admin/types → fresh prod backup → run once against production.

**Recovery:** field removed by mistake → D1 Time Travel or re-add + restore values from an earlier export; fresh env with wrong model → fix `.emdash/seed.json`, rebuild, bootstrap an empty DB; schema/template disagreement → additive schema first then code; for removals, deploy code that stops using the field first, then remove it.

## 9.6 Database options

Source: https://docs.emdashcms.com/deployment/database/

| Database | Use when | Runtime | Adapter |
| --- | --- | --- | --- |
| SQLite | one Node process with persistent disk | Node / local | `sqlite({ url: "file:./data.db" })` from `emdash/db` |
| D1 | Cloudflare Workers with Cloudflare SQL (template default) | Workers | `d1({ binding: "DB" })` from `@emdash-cms/cloudflare` |
| Hyperdrive | Workers + existing PostgreSQL origin | Workers | `hyperdrive({ binding: "HYPERDRIVE" })` from `@emdash-cms/cloudflare` |
| PostgreSQL | several Node processes sharing one DB | Node | `postgres({ connectionString })` from `emdash/db` (needs `pnpm add pg`) |
| libSQL | Node with remote SQLite-compatible DB | Node | `libsql({ url, authToken })` from `emdash/db` |

Media binaries live in a separate storage backend (§9.7). Use separate databases per environment (dev/preview/staging/prod); Cloudflare bindings per Wrangler env with `--env`; Node via different URLs in runtime secrets.

**SQLite:** `url` must start with `file:` (relative, absolute, or `` `file:${process.env.DATABASE_PATH}` ``). Opened in **WAL** mode → `-wal`/`-shm` siblings need directory write access; back up with SQLite's `.backup` (WAL may hold committed data); keep on local/block storage (no NFS/SMB — WAL needs shared memory); persistent FS required.

**D1:** options `binding`, `session` (`"disabled"` default | `"auto"` | `"primary-first"`), `bookmarkCookie` (`"__em_d1_bookmark"`). Wrangler can provision a missing DB from the binding; migrations are separate. **Read replicas** (enable on the D1 database itself too): `auto` → anonymous requests read nearest replica (`first-unconstrained`), authenticated users get read-your-writes via bookmark cookie, writes (`POST`/`PUT`/`DELETE`) start at primary, build-time queries bypass sessions; `primary-first` → first query always primary (write-heavy sites). *(gotcha)* Sessions are incompatible with `global_fetch_strictly_public` — every SSR request hangs silently (possibly only after replicas provision); keep `session` disabled with that flag (issue #1273). Anonymous readers may see a few seconds of staleness.

**libSQL:** `url` (`libsql://…` or `file:…`), `authToken`, `migrationAuthTokenEnv` (default `TURSO_AUTH_TOKEN`); local dev `libsql({ url: "file:./data.db" })`.

**PostgreSQL:** `connectionString` or `host`/`port`/`database`/`user`/`password`/`ssl`; `pool.min` (0), `pool.max` (10), `pool.connectionTimeoutMillis` (pg default 0 = no timeout — set nonzero to bound waits), `pool.idleTimeoutMillis` (10,000 ms; `0` keeps idle clients); `migrationConnectionStringEnv` (default `DATABASE_URL`). **Role requirements:** one canonical, non-expiring role with `CONNECT`, `USAGE` + `CREATE` on the active schema, ownership of every EmDash table/function (directly or via `INHERIT` membership), and DML grants; no superuser/CREATEDB/CREATEROLE/extensions needed. `GRANT ALL` ≠ ownership; EmDash doesn't `SET ROLE`; changing the user in the connection string doesn't transfer objects (→ `must be owner of table`). Uses `current_schema()` (no `search_path` changes); verify with `SELECT current_database(), session_user, current_user, current_schema(), current_setting('search_path')`. Grants: `GRANT CONNECT ON DATABASE app TO emdash_app; GRANT USAGE, CREATE ON SCHEMA public TO emdash_app;`. Optional dedicated schema (before first setup): `CREATE SCHEMA emdash AUTHORIZATION emdash_app; ALTER ROLE emdash_app IN DATABASE app SET search_path = emdash;`.

**Hyperdrive:** requires `pg >= 8.16.3`, `nodejs_compat`, `compatibility_date >= "2024-09-23"`. `wrangler hyperdrive create emdash-db --connection-string "postgres://…?sslmode=verify-full" --caching-disabled` → `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "…" }]`. *(gotcha)* **Query caching must be off** on the primary binding (EmDash needs read-after-write; caching corrupts setup and shows stale content) — `wrangler hyperdrive update <id> --caching-disabled`. Co-locate with Smart Placement (`"placement": { "region": "aws:us-east-1" }`). Options: `binding` (`"HYPERDRIVE"`), `cachedBinding`, `preferUncachedAfterWriteMs` (60000, only with `cachedBinding`), `migrationConnectionStringEnv` (default `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>`), `max` (5, in-Worker pool). **Two-config caching:** second config with caching on (same role/DB/schema) as `cachedBinding` → anonymous public `GET`/`HEAD` outside `/_emdash` use the cached binding except for `preferUncachedAfterWriteMs` after a content publish (match Hyperdrive `max_age`); authenticated, mutating, `/_emdash`, runtime migrations, cold start → primary; deployment migrations → direct origin. Cross-isolate post-write routing needs a distributed Object Cache. **Sandboxed plugins are D1-only** (bridge talks to a D1 binding) — unavailable on Hyperdrive. Optional restricted cached role: needs `CONNECT`, schema `USAGE`, `SELECT` on all tables, plus `UPDATE` on `_emdash_redirects` and full DML on `_emdash_404_log`; add after initial migrations; `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES`.

Core migrations run automatically per dialect by default; the build emits `.emdash/migrations.json` for pre-deploy application (§9.4). Seed schema applies once on first request pre-setup.

## 9.7 Media storage options

Source: https://docs.emdashcms.com/deployment/storage/

DB backups hold media *metadata*, not files — back up storage separately.

| Storage | Use when | Signed uploads |
| --- | --- | --- |
| **R2 binding** `r2({ binding: "MEDIA", publicUrl? })` from `@emdash-cms/cloudflare` | Cloudflare Workers (no access keys needed) | No |
| **S3** `s3({...})` from `emdash/astro` | Node with AWS S3, R2 S3 API, MinIO, compatible | **Yes** (direct client uploads, used automatically by the admin) |
| **Local** `local({ directory, baseUrl })` from `emdash/astro` | Node with one persistent writable volume | No (uploads go through the server) |

- **R2:** `r2_buckets: [{ binding: "MEDIA", bucket_name }]`. Public access via a custom domain (not the rate-limited `r2.dev` URL) set as `publicUrl`; a public bucket exposes `backups/` too — keep private or restrict the public origin to media. Need signed uploads on Workers? Not possible with the binding — use S3 with R2 credentials on Node.
- **S3:** requires `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` (not bundled; else `Rollup failed to resolve import "@aws-sdk/client-s3"`). Options `endpoint`, `bucket` (required), `accessKeyId` + `secretAccessKey` (both or neither), `region` (`"auto"`), `publicUrl`. Any omitted field resolves from `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_PUBLIC_URL` at Node process start (explicit values win) — build once, inject creds at boot. *(gotcha)* Node-only: it reads `process.env`, not `cloudflare:workers` bindings; never inject S3 creds into `astro.config.mjs` for a Worker build (Vite may embed them) — use `r2()` on Workers. R2 via S3: endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`. MinIO: point `S3_ENDPOINT` at the API origin.
- **Local:** `directory` + `baseUrl` (should be `/_emdash/api/media/file` unless a custom static server serves it).
- Per-environment: `const storage = import.meta.env.PROD ? r2({ binding: "MEDIA" }) : local({...})`.
- Storage interface (all adapters): `upload({ key, body, contentType })`, `download(key)`, `delete(key)`, `exists(key)`, `list(options?)`, `getSignedUploadUrl(options)`, `getPublicUrl(key)`.

## 9.8 Object cache

Source: https://docs.emdashcms.com/deployment/object-cache/

Per-request dedup is built in; the optional **object cache** keeps selected query results across requests. Disabled by default; DB stays source of truth; reads fail open; writes invalidate namespaces.

| Backend | For | Shared across isolates |
| --- | --- | --- |
| KV — `objectCache: kvCache({ binding: "CACHE" })` from `@emdash-cms/cloudflare` | Workers | Yes |
| Memory — `objectCache: memoryCache()` from `emdash/astro` | Node / local | No (per process) |

- KV setup: `npx wrangler kv namespace create CACHE` → `kv_namespaces: [{ binding: "CACHE", id }]`. Options: `binding` (required), `defaultTtl` (3600 s; KV min 60), `revalidate` (1000 ms isolate-local epoch reuse), `timeout` (2000 ms; KV op timeout → miss; `0` disables), `keyPrefix` (`"em"`; unique per site when sharing a namespace). Memory options: `defaultTtl`, `revalidate`, `maxEntries` (1000), `keyPrefix`.
- Cached: `getEmDashCollection`, `getEmDashEntry`, `resolveEmDashPath`, site settings, menus, taxonomy terms. Not cached: admin API, media files, full HTML (use Workers Cache §9.1). A response that may fill Astro's route cache bypasses the object cache so purged pages aren't rebuilt from stale KV.
- Freshness: admin/REST edits invalidate the collection (create/update/publish/delete) and dependent entries (byline/term changes). Preview + visual editing bypass the cache; other requests (even authenticated) read the cache, which holds only published content. Propagation: memory immediate; KV bounded by edge propagation (~60 s) + `revalidate`. Scheduled entries appear on the next collection change or when `defaultTtl` lapses → lower `defaultTtl` if precise scheduling matters.

## 9.9 Plugin sandbox runners

Source: https://docs.emdashcms.com/deployment/plugin-sandbox/

Registry installs and `sandboxed: []` plugins need a runner selected by `sandboxRunner` (which also enables the hosted registry catalog). Without it: `sandboxed` plugins not loaded; a configured registry stays browseable but install/update fails with `SANDBOX_NOT_AVAILABLE`. Native `plugins: []` never get isolation.

| | Cloudflare Workers | Node.js |
| --- | --- | --- |
| `sandboxRunner` | `sandbox()` from `@emdash-cms/cloudflare` | `"@emdash-cms/sandbox-workerd/sandbox"` |
| Requirements | **Workers Paid plan**, `worker_loaders: [{ binding: "LOADER" }]`, `PluginBridge` exported from the `main` entry | `npm install @emdash-cms/sandbox-workerd workerd` (workerd binary via optional dep — install with optional deps on the runtime platform; same platform in multi-stage Docker) |
| DB access | the `DB` D1 binding directly (independent of adapter → **no Hyperdrive**) | configured database |
| Enforced limits | CPU 50 ms, 10 subrequests (Worker Loader), 30 s wall (runner); 128 MB memory not per-plugin | 30 s wall only |

- Cloudflare: `*-cloudflare` templates ship the export but comment out the binding (free plan). Named environments: set `CLOUDFLARE_ENV` during the Astro build and add `LOADER` to each env (bindings aren't inherited). Build-time check: no `LOADER` → runner unset + warning `[emdash] Sandboxed plugins are disabled because wrangler.jsonc has no LOADER Worker Loader binding…`.
- Node: in `astro dev` (`NODE_ENV=development`) the runner uses **Miniflare** (manages its own workerd; crash policy below doesn't apply); `astro preview` / `node ./dist/server/entry.mjs` use `workerd`. workerd starts on first request after plugins load (10 s wait), restarts on plugin install/update, logs as `[emdash:workerd]`; services on `127.0.0.1`, back-channel via Unix socket (TCP on Windows). Child env is limited to `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL` — extend with `EMDASH_WORKERD_PASSTHROUGH_ENV=VAR1,VAR2`. Crash policy: restart on next invocation with backoff 1 s → 30 s; > 5 crashes / 60 s → `workerd crashed 5 times in 60 seconds, giving up` and every hook/route fails with `Plugin sandbox unavailable for <plugin>…; restart the server`. `SIGTERM` to the server kills workerd.
- Wall-time exceed → `Plugin <id> exceeded wall-time limit of 30000ms during hook:<name>` (hook logged as `EmDash: Sandboxed plugin <id>`, request continues) or `route:<name>` (route fails). Limits are fixed (no integration option).
- Runtime unavailability (missing deployed `LOADER`/`PluginBridge`, missing workerd) → warning `Plugin sandbox is configured but not available on this platform: <cause>`; sandboxed plugins skipped; installs `SANDBOX_NOT_AVAILABLE`; rest of the site fine. Check workerd: `./node_modules/.bin/workerd --version` (Windows `node_modules\.bin\workerd.cmd --version`).
- **`sandbox: false`** runs `sandboxed`/registry plugins in-process for debugging (no isolation/limits); refused on Workers (`sandbox: false is not supported in Cloudflare Workers`); **never in production**.
- Troubleshooting: `workerd failed to start within 10 seconds` → read preceding `[emdash:workerd]` lines; retries next invocation. `workerd crashed 5 times…` → fix cause, restart server.

## 9.10 Secrets and key management

Source: https://docs.emdashcms.com/deployment/secrets/

Runtime secrets go in the host's secret manager (`process.env`) or `wrangler secret put` — never `astro.config.mjs`, `wrangler.jsonc`, or `import.meta.env` (Vite may embed build-time values).

| Secret | Source | Stored in | If lost |
| --- | --- | --- | --- |
| `EMDASH_ENCRYPTION_KEY` | operator (`npx emdash secrets generate`) | env / Worker secret only | encrypted plugin settings unreadable until the key is restored |
| Preview secret | auto (override `EMDASH_PREVIEW_SECRET`, legacy `PREVIEW_SECRET`) | `options` row `emdash:preview_secret` | outstanding preview links stop working |
| IP salt | auto (override `EMDASH_IP_SALT`; legacy `EMDASH_AUTH_SECRET` / `AUTH_SECRET` consulted) | `options` row `emdash:ip_salt` | rate-limit continuity resets |
| Session & API tokens | generated | session store / DB (hashes only) | nothing |
| OAuth provider creds | you | env | that provider's sign-in stops |
| Turnstile secret | you | env (`EMDASH_TURNSTILE_SECRET_KEY` / `TURNSTILE_SECRET_KEY`) | comment CAPTCHA fails |
| S3 creds | you | runtime env | media up/download fails |
| Plugin secrets | admin settings UI | encrypted `options` `plugin:<id>:settings:<key>` | restore key or re-enter |
| CLI creds | `emdash login` device flow | `~/.config/emdash/auth.json` (0600; honors `XDG_CONFIG_HOME`) | log in again |
| Registry CLI creds | `emdash-plugin` atproto OAuth | `~/.emdash/oauth/`, `~/.emdash/credentials.json` (0600) | log in again |

- **Encryption key:** format `emdash_enc_v1_` + 32 random bytes as unpadded base64url (43 chars); AES-GCM with plugin ID + setting key as authenticated data; malformed → startup message, encrypted-setting ops fail closed (site otherwise works). Not in DB backups — keep a separate recovery copy. Rotation: `EMDASH_ENCRYPTION_KEY=emdash_enc_v1_<new>,emdash_enc_v1_<old>` — new/re-saved values use the first key; reads select by stored `kid`; re-save every plugin secret, verify with a deployment holding only the new key, then drop the old (EmDash doesn't report which `kid`s remain in use).
- **Preview secret / IP salt:** generated atomically on first use (concurrent cold starts converge); env always wins over the stored row; rotate by deleting the row or changing the env var + redeploy. Preview: HMAC-signed URLs; old links stop validating. IP salt: SHA-256 salt for commenter `ip_hash`; rotation restarts rate-limit counting only.
- **Sessions/tokens:** Astro session store (Workers KV on Cloudflare, filesystem on Node; adapters without a store, e.g. Vercel, need a configured session driver or sign-in fails); cookie = opaque session ID (no signing secret); clear the store to force re-login. API tokens `ec_pat_` / `ec_oat_` / `ec_ort_` = opaque 256-bit, only SHA-256 stored, plaintext shown once; revoke + recreate in admin. Invite (7 days), magic-link (15 min), recovery tokens hashed in `auth_tokens`.
- **Provider creds:** `EMDASH_OAUTH_GOOGLE_CLIENT_ID/SECRET`, `EMDASH_OAUTH_GITHUB_CLIENT_ID/SECRET`, `EMDASH_OAUTH_MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` (unprefixed aliases accepted). Local dev: `.env`; Wrangler reads `.dev.vars` **or** `.env` (`.dev.vars` wins when present — migrate fully and delete it). Node: Turnstile key is read from `process.env` at request time; neither `astro dev` nor the built server loads `.env` — export it or use `node --env-file=.env ./dist/server/entry.mjs`.
- **Plugin secrets:** admin only learns whether a secret is set (even with a missing key, so it can be replaced); plugin reads plaintext via `ctx.settings`; arbitrary KV/state values are **not** encrypted. Values from older releases stay readable; re-save to encrypt. Encryption doesn't limit what the plugin does with the value — prefer scoped, revocable credentials.
- **Registry CLI in CI:** `EMDASH_PUBLISHER_DID`, `EMDASH_PUBLISHER_HANDLE`, `EMDASH_PUBLISHER_PDS`, `EMDASH_REGISTRY_URL`; automated `publish` still needs the OAuth session files in `~/.emdash/oauth/` on the runner. Revoke publishing at your AT Protocol account.
- **Rotation quick reference:** plugin-setting encryption → prepend new key, re-save, remove old; invalidate preview links → delete `emdash:preview_secret` row / change override; reset rate-limit hashing → change `EMDASH_IP_SALT` / delete `emdash:ip_salt`; leaked API token → Admin → Users → API tokens → revoke + recreate; kill all sessions → clear session store; provider credential → rotate at provider, update env, redeploy; plugin API key → rotate at provider, re-enter in plugin settings.

---

# Part 10 — Concepts

## 10.1 Architecture (site builder view)

Source: https://docs.emdashcms.com/concepts/architecture/

EmDash runs inside the Astro app: public pages and the admin panel share one runtime, database, and media storage (one deployed application, not frontend + separate CMS service).

| Part | Does | Connection |
| --- | --- | --- |
| Admin panel | saves entries and media | → EmDash runtime |
| Astro pages/components | query entries | ← EmDash runtime |
| EmDash runtime | content model, publishing rules, queries, plugins, API | ↔ DB + media storage |
| SQL database | content model, entries, users, settings, records | used by runtime |
| Media storage | uploaded files (media fields reference stored items, not bytes in the table) | used by runtime |

- Astro needs `output: "server"` + an adapter; register **both** `react()` and `emdash()` (missing `react()` → admin stuck on **Loading EmDash…**). Local storage is the default when `storage` is omitted, but production needs persistent storage.
- `src/live.config.ts`: `_emdash: defineLiveCollection({ loader: emdashLoader() })` (from `emdash/runtime`); pages call `getEmDashCollection()` / `getEmDashEntry()` (from `emdash`) per request (server-rendered; prerendered pages only see build-time content).
- Model changes: admins edit collections/fields in the admin → DB schema changes; seeds describe a starting model for other environments; generated TS declarations describe the current model. All describe the *same* model.
- Plugins: native run with host access; sandboxed run isolated when a runner is configured and capabilities granted.

## 10.2 Collections and fields

Source: https://docs.emdashcms.com/concepts/collections/

- **Identity:** plural label, optional singular label, slug (used in queries, API routes, seeds, DB). *(gotcha)* Slugs can't be renamed later (queries and columns depend on them): lowercase letter start, lowercase letters/digits/underscores, ≤ 63 chars, reserved names rejected.
- **Behavior toggles:** Routable (published entries need a slug; URL pattern may combine slug/ID with publication date — one placeholder per path segment: `/{year}/{month}/{slug}.html` OK, `/{year}{month}/{slug}` and `/{slug}-{id}` rejected); Drafts; Revisions; Preview (signed URLs); Search (full-text on searchable fields); SEO (title/description/image fields + sitemap); Edit locking; Comments (moderation, auto-close); Icon (Phosphor name, fallback default); Hide from navigation (still reachable by URL/API/plugins) and separate "Quick action on the dashboard" toggle; Group (collapsible sidebar folder; taxonomies join when all their collections are in it). Enable only what the site renders.
- **17 field types:** text (`string`, `text`, `slug`, `url`), numbers (`number`, `integer`), state/time (`boolean`, `datetime`), choices (`select`, `multiSelect`), rich/structured (`portableText`, `json`, `repeater`, `blocks`), media (`image`, `file`), relationships (`reference`). Type governs storage, validation, and generated TS.
- **Field rules:** Required, Unique, Default value, Validation (length/range/pattern/choices/file types/repeater length), Searchable, Indexed (only `string`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `reference`, `slug`; index when queries sort/filter by it, not merely because a page displays it), Translatable (per-locale value vs shared). `reference` stores nothing in the table; linked entries come back under `references`, not `data`.
- **Changing later:** labels, validation, search, indexes, widget options, order are safe; adding a field keeps entries (no value until supplied). **Destructive:** deleting a field drops its column; deleting a collection drops its table. Type and slug are fixed in the admin; the schema API allows in-place retypes only among `string` ↔ `text` ↔ `slug`; other retypes, `required`/`unique` changes, and translatable → non-translatable need a content migration (§9.5).

## 10.3 Content model

Source: https://docs.emdashcms.com/concepts/content-model/

- **Collection** = a kind of content; **field** = one value on it; **entry** = a saved item. EmDash adds standard per-entry data: ID, public slug, publishing state, author, created/updated times, locale, revision refs — exposed alongside custom fields in query results.
- Deleting an entry = trash (sets deletion time; restorable until permanently deleted) — distinct from schema deletion.
- One model, two ways to manage it: admin **Content Types** (immediate schema change) and seed files (JSON starting model for setup/other environments). Both mutate the same model in the target DB.
- Existing content: adding a collection creates an empty table; adding an optional field adds it to all entries (no value until supplied; default value fills at add time); labels/descriptions/validation/search/order are safe; slugs fixed at creation. Type changes limited to `string`/`text`/`slug`; other retypes, `required`/`unique`, and translatable → non-translatable need migrations; back up and test first.
- **TypeScript declarations:** the integration writes `emdash-env.d.ts` during local dev and refreshes after schema changes (generated — don't edit); remote: `emdash types` writes `.emdash/types.ts` from a selected site. Types don't migrate content.

## 10.4 The admin panel

Source: https://docs.emdashcms.com/concepts/admin-panel/

- Served at `/_emdash/admin/`; first visit → setup wizard; then permissions gate tools. React app: needs `@astrojs/react`, `react`, `react-dom`, `react()` registered, server output, DB, storage.
- **Work areas:** Dashboard (site + plugin widgets); collections (list/create/edit/publish/trash); collection groups (folders); Media; Taxonomies & Bylines; Menus & Widget Areas; Comments; Content Types; Plugins; Settings (site, auth, backups, site transfer, email, search, …). Admin manages data/config — Astro components must query and render menus/widgets for them to appear publicly.
- **Content editor:** form built from the collection (text inputs, rich-text editor for `portableText`, media picker, entry picker for references) plus publishing/preview/revision/comment/search controls. Rich text: headings, lists, quotes, code, links, images, registered custom blocks; unknown imported blocks preserved on save. **Save** = draft; **Publish / Publish changes** = live; scheduling records a future publish. Edit locking refuses concurrent writers; stale saves (entry changed since load) are refused so the editor can reload.
- **Roles:** Subscriber, Contributor, Author, Editor, Admin (cumulative; ownership still matters — Authors edit/publish own entries, Editors any). Editors manage taxonomies, menus, bylines, widgets, sections, others' content; Admins manage content model, users, plugins, redirects, backups, settings, whole-site export/import, permanent deletion. Server checks every action — hidden nav is not the security boundary.
- **Media:** grid/list, search/filter, metadata, bulk actions; signed uploads when the adapter supports them (browser → storage → confirm). Check media usage before deleting/replacing.
- **Plugins:** may add dashboard widgets, settings sections, editor controls, full pages (mounted under the plugin's own admin route; can't replace core screens); server-side permission checks still required. Build UI with the native admin APIs, not by modifying core.

---

# Part 11 — Reference

## 11.1 Configuration reference (`emdash()` integration options)

Source: https://docs.emdashcms.com/reference/configuration/

```js
import emdash, { local, s3, memoryCache } from "emdash/astro";
import { sqlite, libsql, postgres } from "emdash/db";
import { d1, r2, hyperdrive, durableObjects, previewDatabase, playgroundDatabase, kvCache, access, sandbox, cloudflareImages, cloudflareStream } from "@emdash-cms/cloudflare";
```

| Option | Default | Purpose |
| --- | --- | --- |
| `database` | **required** | `sqlite({ url })`, `libsql({ url, authToken, migrationAuthTokenEnv })`, `postgres({ connectionString \| host/port/database/user/password/ssl, pool: { min 0, max 10, connectionTimeoutMillis, idleTimeoutMillis }, migrationConnectionStringEnv })`, `d1({ binding, session, bookmarkCookie, coalesce })`, `hyperdrive({ binding, cachedBinding, preferUncachedAfterWriteMs, migrationConnectionStringEnv, max })`, `durableObjects({ binding, name "emdash", session, bookmarkCookie "__em_do_bookmark" })` (needs `experimental` + `replica_routing` flags for replicas), `previewDatabase({ binding })`, `playgroundDatabase({ binding })` |
| `migrations` | `{ runtime: "auto" }` | `runtime: "auto" \| "check" \| "manual"`, `dev` override; env `EMDASH_MIGRATIONS_MODE` |
| `storage` | local `./.emdash/uploads` via `/_emdash/api/media/file` | `local({ directory, baseUrl })`, `r2({ binding, publicUrl })`, `s3({ endpoint, bucket, accessKeyId, secretAccessKey, region "auto", publicUrl })` (Node resolves omitted fields from `S3_*`; missing → `MISSING_S3_CONFIG`; Workers must use `r2()` or explicit values) |
| `images` | `true` | wrap Astro's image endpoint so `<Image>`/`getImage()` read from the storage adapter (works behind Access); `false` to opt out |
| `mediaProviders` | — | `[cloudflareImages({...}), cloudflareStream({...})]` (see below) |
| `objectCache` | disabled | `kvCache({ binding, defaultTtl 3600, revalidate 1000, timeout 2000, keyPrefix "em" })` or `memoryCache({ defaultTtl, revalidate, maxEntries 1000, keyPrefix })` |
| `middleware.outer` | — | path to an Astro middleware module registered `order: "pre"` — runs before EmDash init (no `locals.emdash`/`locals.user`/DB before `next()`), receives the final response after; use for full-response caches/request gates; early `Response` skips EmDash entirely (set your own security/cache headers); recompute `Content-Length` if you change the body |
| `playground` | — | `{ middlewareEntrypoint: "@emdash-cms/cloudflare/db/playground-middleware" }` with `playgroundDatabase` — disposable demo sites only (bypasses setup/auth) |
| `plugins` | `[]` | native plugins (in-process); a sandbox-compatible plugin may run here with full trust |
| `sandboxed` | `[]` | sandbox-compatible plugins (never native); skipped without a usable runner |
| `sandboxRunner` | — | `sandbox()` (Cloudflare) or `"@emdash-cms/sandbox-workerd/sandbox"` (Node); required for `sandboxed`, registry, marketplace plugins |
| `sandbox` | `true` when runner set | `false` = run sandboxed/marketplace plugins in-process (diagnosis only; refused on Workers) |
| `registry` | `https://registry.emdashcms.com` when runner set and `sandbox !== false` | `false` disables discovery/registry installs; string URL; or `{ aggregatorUrl, acceptLabelers (comma-separated DIDs), policy: { minimumReleaseAge ("48h" / "7d" / seconds), minimumReleaseAgeExclude: ["<did>" \| "<did>/<slug>"] } }` — first-release exemption only when the registry confirms one continuously observed release |
| `marketplace` | — | **deprecated** base URL for updating legacy Marketplace plugins (HTTPS in prod); remove after migrating (§4.4) |
| `fonts` | Noto Sans (self-hosted via Astro Font API; Latin/Cyrillic/Greek/Devanagari/Vietnamese) | `{ scripts: ["arabic", "japanese", …] }` (arabic, armenian, bengali, chinese-simplified/-traditional/-hongkong, devanagari, ethiopic, farsi, georgian, gujarati, gurmukhi, hebrew, japanese, kannada, khmer, korean, lao, malayalam, myanmar, oriya, sinhala, tamil, telugu, thai, tibetan) or `false` for system fonts; CSS var `--font-emdash` |
| `auth` | passkeys | `access({ teamDomain (required), audience \| audienceEnvVar "CF_ACCESS_AUDIENCE", autoProvision true, defaultRole 30, syncRoles false, roleMapping })` — an auth adapter **replaces** passkeys |
| `authProviders` | — | `[github(), google(), microsoft({ emailVerified }), atproto({ allowedDIDs, allowedHandles, defaultRole })]` from `emdash/auth/providers/*` / `@emdash-cms/auth-atproto`; third parties implement `AuthProviderDescriptor` |
| `mcp` | enabled (bearer token required) | `false` to remove `/_emdash/api/mcp` |
| `siteUrl` | env `EMDASH_SITE_URL` → `SITE_URL` | public origin (scheme+host[+port], no path; normalized to origin); required for setup on non-loopback hosts (`SITE_URL_REQUIRED`); fixes passkeys, CSRF, OAuth/login redirects, MCP discovery, snapshot exports, sitemap, robots.txt, JSON-LD behind TLS-terminating proxies; doesn't change `Astro.url` (set Astro `site` for your own canonical URLs) |
| `allowedOrigins` | env `EMDASH_ALLOWED_ORIGINS` (merged) | extra passkey-verification origins — must be same host or subdomains of `siteUrl` (which supplies `rpId`); `siteUrl` required and not an IP literal; config errors fail at Astro startup, env errors at first passkey verify (500) |
| `trustedProxyHeaders` | env `EMDASH_TRUSTED_PROXY_HEADERS` | e.g. `["x-real-ip"]`, `["fly-client-ip", "x-forwarded-for"]` (`*-forwarded-for` parsed as list, first entry); Cloudflare uses `cf` automatically; **only when you control the proxy** — otherwise rate limits are skipped and all comments share one bucket (20 per 10 min) |
| `maxUploadSize` | 52,428,800 (50 MB) | bytes; direct uploads → `413`, signed-URL path → `400` |
| `admin` | — | `{ logo, siteName, footerLabel ("EmDash" \| false), favicon }` admin branding only |
| `updateCheck` | `true` | daily deferred GET to `https://registry.npmjs.org/emdash`; banner names newest stable ≥ 24 h old; `{ minimumReleaseAge: "7d" }`; `false` disables |
| `toolbar` | `"server"` | `"server"` injects the editor toolbar into authenticated HTML; `"client"` keeps public HTML identical and shows an "Edit" pill via a small inline bootstrap + `localStorage` flag, reloading with `?_edit` (never cached; logged-out visitors redirected) — use behind shared caches; `false` never renders it; CSP without `'unsafe-inline'` needs a hash |

**Reverse proxy:** set Astro `security.allowedDomains: [{ hostname, protocol }]` (so `X-Forwarded-*` is honored) and `vite.server.allowedHosts` for dev; prefer those first, then `siteUrl` when the rebuilt URL still diverges (TLS in front, upstream `http://`); bind dev to `--host 127.0.0.1`; proxies must forward port-aware `Host`/`X-Forwarded-Host`.

**Media providers** (env vars read as Worker binding first, then `process.env`; direct options win): `cloudflareImages({ accountId | accountIdEnvVar "CF_ACCOUNT_ID", accountHash | accountHashEnvVar "CF_IMAGES_ACCOUNT_HASH", apiToken | apiTokenEnvVar "CF_IMAGES_TOKEN", deliveryDomain "imagedelivery.net", defaultVariant "public" })`; `cloudflareStream({ accountId…, apiToken | apiTokenEnvVar "CF_STREAM_TOKEN", customerSubdomain, controls true, autoplay false, loop false, muted })`.

**Live collections:** `src/live.config.ts` → `_emdash: defineLiveCollection({ loader: emdashLoader() })` (no options).

**Environment variables:** `EMDASH_SITE_URL` (→ `SITE_URL`), `EMDASH_ALLOWED_ORIGINS`, `EMDASH_DATABASE_URL`, `EMDASH_ENCRYPTION_KEY`, `EMDASH_PREVIEW_SECRET`, `EMDASH_IP_SALT`, `EMDASH_AUTH_SECRET` (legacy IP-salt source), `EMDASH_TURNSTILE_SECRET_KEY` (→ `TURNSTILE_SECRET_KEY`; pair with `turnstileSiteKey` prop on `<CommentForm>`), `EMDASH_URL` (remote EmDash for schema sync), `EMDASH_MIGRATIONS_MODE`, `EMDASH_TRUSTED_PROXY_HEADERS`, `EMDASH_TOKEN` (CLI), `EMDASH_WORKERD_PASSTHROUGH_ENV`, `EMDASH_PSEUDO_LOCALE` (dev).

**`package.json#emdash`:** `{ label, schema (".emdash/schema.sql", legacy `emdash init`), seed (path) }`.

**TypeScript:** dev integration writes `emdash-env.d.ts` (augments `emdash` so `getEmDashCollection()` infers fields; regenerated after schema changes). `npx emdash types` writes `.emdash/types.ts` from a running instance; alias `"@emdash-cms/types": ["./.emdash/types.ts"]` only if importing it directly.

## 11.2 CLI reference (`emdash` / `em`)

Source: https://docs.emdashcms.com/reference/cli/

Bundled with `emdash` (`npx emdash …`, alias `em`). Remote commands (`types`, `whoami`, `content`, `schema`, `media`, `search`, `taxonomy`, `menu`, `site`) resolve auth: `--token` → `EMDASH_TOKEN` → `~/.config/emdash/auth.json` → dev bypass on localhost. Common flags: `--url/-u` (default `EMDASH_URL` or `http://localhost:4321`), `--token/-t`, `--header/-H "Name: Value"` (repeatable; merged with `EMDASH_HEADERS`), `--json` (also when piped). Exit codes: `0` success, `1` error (plus command-specific codes below).

| Command | Purpose / key options |
| --- | --- |
| `init [-d ./data.db] [--cwd] [-f]` | Init a local SQLite DB: core migrations + optional SQL from `package.json#emdash.schema`; no-op if initialized unless `--force` |
| `doctor [-d] [--cwd] [--json]` | Check local SQLite (connection, migrations, collections, tables, users) + Wrangler scheduler wiring (Cron Trigger + `scheduled()`); non-zero on failure |
| `seed [path] [-d] [--validate] [--no-content] [--on-conflict skip\|update\|error] [--uploads-dir ./uploads] [--media-base-url /_emdash/api/media/file]` | Validate/apply a seed to local SQLite (path → `.emdash/seed.json` → `package.json#emdash.seed`); runs migrations first |
| `migrate [--check] [--status] [--json] [--manifest] [--from-config [--config]] [--expected-target-fingerprint] [--release-lock <id>] [--database] [--database-url-env] [--d1] [--account-id] [--wrangler-config] [--wrangler-env]` | Core migrations from `.emdash/migrations.json` (§9.4). No `down`/`--dry-run`. Exit: `0` ok, `1` error, `2` pending known, `3` unknown applied records (precedence), `4` confirmation missing/declined/fingerprint mismatch, `130` interrupted |
| `types [-u] [-t] [-H] [-o .emdash/types.ts] [--cwd]` | Generate standalone TS interfaces from a running instance + `schema.json` beside it |
| `login [-u] [-H]` / `logout [-u]` / `whoami [-u] [-t] [--json]` | OAuth device flow (dev bypass on localhost without auth); shows requested permissions before approval; stores `~/.config/emdash/auth.json` |
| `content list <collection> [--status] [--locale] [--limit] [--cursor]` | List entries |
| `content get <collection> <id> [--locale] [--raw] [--published]` | Get (Markdown by default; `--raw` Portable Text); returns `_rev` |
| `content create <collection> (--data JSON \| --file \| --stdin) [--slug] [--locale] [--translation-of <id>] [--draft]` | Auto-publishes unless `--draft` |
| `content update <collection> <id> --rev <token> (--data \| --file) [--locale] [--draft] [--override-lock]` | `--rev` required (409 on stale; `ENTRY_LOCKED` 409 names the holder) |
| `content delete / publish / unpublish / restore <collection> <id> [--override-lock]` | Trash (soft delete), publish, unpublish, restore |
| `content schedule <collection> <id> --at <ISO 8601 with Z/offset> [--override-lock]` | Schedule |
| `content translations <collection> <id>` | List the translation group (id, locale, slug, status) |
| `schema list` / `schema get <c>` / `schema create <c> --label … [--label-singular] [--description]` / `schema delete <c> [--force]` / `schema add-field <c> <f> --type <type> [--label] [--required]` / `schema remove-field <c> <f>` | Schema management via REST (types: string, text, url, number, integer, boolean, datetime, select, multiSelect, portableText, image, file, reference, json, slug, repeater) |
| `media list [--mime] [--limit] [--cursor]` / `media upload <file> [--alt] [--caption]` / `media get <id>` / `media delete <id>` | Media |
| `media repair-usage (--collection/-c <c> \| --all) [--json]` | Rebuild media-usage indexes (Admin + `admin` scope; `--all` can be slow; parse `status`, `failedSourceCount`, `skippedSourceCount` in JSON — `complete`/`partial`/`stale` exit 0, `failed` exit 1) |
| `search "<query>" [-c collection] [--locale] [-l limit]` | Full-text search |
| `taxonomy list` / `taxonomy terms <name> [-l] [--cursor]` / `taxonomy add-term <taxonomy> --name … [--slug] [--parent <id>]` | Taxonomies |
| `menu list` / `menu get <name>` | Menus |
| `site export -o site.emdash [--no-comments]` | Export a `.emdash` package (scope `admin` or `transfer:export`); verifies manifest/package digest + per-file SHA-256; writes `<output>.partial`, progress `<output>.partial.json`, parts `<output>.parts/`; rerun to resume (`TRANSFER_PACKAGE_DIGEST_MISMATCH` on mismatch); JSON: `operationId`, `output`, `packageDigest`, `files`, `bytes`, `resumed` |
| `site import <file> --analyze [--map-principal <from>=<to\|none>]… [--use-target-title] [--use-target-tagline]` → `site import <file> --plan sha256:… --confirm` | Two-step import (scopes `transfer:analyze` + `transfer:execute`); decisions persist per import and change the plan digest; `TRANSFER_PLAN_DIGEST_MISMATCH` if the plan changed; exit `2` when blockers exist. Subcommands: `status <op>`, `resume <op> [file]`, `receipt <op>`, `cancel <op> [-y]`, `abandon <op> [-y]` (lifts the write block; nothing deleted) |
| `export-seed [-d ./data.db] [--cwd] [--with-content all\|c1,c2] [--pretty/--no-pretty] [--media-base-url https://site]` | Export settings, collections, block types (all versions), taxonomies, menus, redirects (301/302/307/308 only), widget areas, sections, optional content with `$media`/`$ref:`; requires a fully migrated DB (read-only); scheduled entries export as drafts; without `--media-base-url`, `$media` URLs are relative and skipped on apply; PT images keep stored IDs (don't resolve elsewhere) |
| `secrets generate [--write .env [--force]]` / `secrets fingerprint <key>` | Generate `EMDASH_ENCRYPTION_KEY` (`--write` refuses to overwrite without `--force`); print the 8-char `kid` |

**Generated files:** `emdash-env.d.ts` (dev integration; augments `EmDashCollections` so `getEmDashCollection("posts")` is typed); `.emdash/types.ts` (from `emdash types`; standalone interfaces with `id`, `slug`, `status`, fields, `createdAt`, `updatedAt`, `publishedAt`, `bylines?`, `terms?` — *(gotcha)* currently omits `ContentBylineCredit`/`TaxonomyTerm` from its import line; add them manually, regenerating overwrites); `.emdash/schema.json` (raw schema `{ version, collections }`).

**Env:** `EMDASH_DATABASE_URL`, `EMDASH_TOKEN`, `EMDASH_URL`, `EMDASH_HEADERS` (newline-separated), `EMDASH_ENCRYPTION_KEY`, `EMDASH_PREVIEW_SECRET`, `EMDASH_IP_SALT`, `EMDASH_AUTH_SECRET` (legacy). Typical scripts: `"types": "emdash types"`, `"export-seed": "emdash export-seed"`, `"db:reset": "rm -f data.db"`.

## 11.3 Content lifecycle (canonical state contract)

Source: https://docs.emdashcms.com/reference/content-lifecycle/

Status ∈ `draft` | `scheduled` | `published`; a published entry may also carry a draft and a future schedule (visitors keep seeing the live revision). Trash is orthogonal (metadata preserved, excluded from ordinary reads). Same rules for admin, REST, CLI, MCP.

| Action | From | Result | Revisions | `publishedAt` | `scheduledAt` | Repeat |
| --- | --- | --- | --- | --- | --- | --- |
| Save | any active | status unchanged | replaces draft revision (live stays public) | — | — | supplied `_rev` refuses stale; omitted → unconditional REST write |
| Publish | draft/scheduled/published | published | draft → live, draft pointer cleared | set on first publish, preserved after (override needs auth) | cleared | preserves content/time, new `_rev` |
| Publish when due | scheduled / published+scheduled draft | published | same | scheduled time on first publish | cleared | scheduler skips cleared schedules |
| Unpublish | any active | draft | live pointer cleared; draft kept or created from live | preserved | cleared | plain draft unchanged |
| Schedule | draft/scheduled/published | draft → scheduled; published stays published | — | — | set | replaces, new `_rev` |
| Unschedule | scheduled / published+schedule | scheduled → draft; published stays | — | — | cleared | no-op without schedule |
| Discard draft | any active | unchanged | draft pointer cleared | — | — | no-op without draft |
| Move to Trash | any active | trashed | preserved | preserved | preserved | already-trashed → not found |
| Restore from Trash | trashed | **draft** | live pointer cleared; draft kept | preserved | cleared | needs trashed entry |
| Delete permanently | trashed | removed (entry + revisions) | — | — | — | irreversible |
| Restore a revision | any active | unchanged | draft replaced with the selected revision copy (live unchanged; **not published**) | — | — | new revision + `_rev` |

Collections without revisions write to the row directly.

**Permissions / concurrency / hooks:** ownership matters (Author own, Editor any; permanent delete = Admin; setting `publishedAt` on publish needs `content:publish_any`).

| Action | Permission | REST `_rev` | MCP `_rev` | Lock | Hooks |
| --- | --- | --- | --- | --- | --- |
| Save | `content:edit_own` / `edit_any` | optional | required | enforced | `content:beforeSave`, `afterSave` |
| Publish / Unpublish / Schedule | `content:publish_own` / `publish_any` | optional | required | enforced | `beforePublish`/`afterPublish`, `beforeUnpublish`/`afterUnpublish`, `beforeSchedule`/`afterSchedule` |
| Unschedule | `content:publish_own` / `publish_any` | not accepted | not accepted | enforced | `afterUnschedule` |
| Discard draft | `content:edit_own` / `edit_any` | optional | required | enforced | none |
| Move to Trash | `content:delete_own` / `delete_any` | — | — | enforced | `beforeDelete`, `afterDelete` (`permanent: false`) |
| Restore from Trash | `content:edit_own` / `edit_any` | — | — | not enforced | `afterRestore` |
| Delete permanently | `content:delete_permanent` | — | — | not enforced | `afterDelete` (`permanent: true`) |
| Restore a revision | `content:edit_own` / `edit_any` | — | — | enforced | none |

Stale `_rev` → `CONFLICT`; lock → `ENTRY_LOCKED` unless an authorized override. After-hooks may run after the response. A `content:beforePublish` rejection at scheduled time clears the schedule and runs `content:afterUnschedule`. *(gotcha)* A dropped connection doesn't prove nothing changed — re-read before retrying. Revision restore commits content + audit revision atomically.

## 11.4 JavaScript API reference (site-template API, `import … from "emdash"`)

Source: https://docs.emdashcms.com/reference/api/

**Template contract:** `decodeSlug`, `getEmDashCollection`, `getEmDashEntry`, `getMenuWithCacheHint`, `getSeoMeta`, `getSiteSettings`, `getSiteSettingsWithCacheHint`, `getTaxonomyTermsWithCacheHint`, `getTermsForEntries`, `sanitizeHref`, `search`.

**`getEmDashCollection(collection, options?)`** → `{ entries, error?, cacheHint, nextCursor?, hasMore? }`. `CollectionFilter`: `status` (`"draft" | "published" | "archived"`), `limit`, `cursor` (keyset; pass previous `nextCursor`) **or** `offset` (mutually exclusive), `where: Record<field | taxonomy | "byline", string | string[] | { gt, gte, lt, lte }>`, `orderBy: Record<field, "asc" | "desc">`, `locale`. Offset pagination example: `{ limit: perPage, offset: (page - 1) * perPage, orderBy: { published_at: "desc" } }`.

**`getEmDashEntry(collection, slugOrId, { locale?, references? })`** → `{ entry | null, error?, isPreview, fallbackLocale?, cacheHint }`. Preview is automatic when `_preview` is valid. `references`: `{ fieldSlug: true | { limit (≤ 100, default 50), cursor } }` — omitted fields aren't read. Missing entry → `entry: null` with no `error`.

**`ContentEntry<T, R>`**: `{ id (route identifier, normally the slug), data: T, references?: R, edit: EditProxy }`. `data` = custom fields + `id`, `slug`, `status`, `createdAt` (Date), `updatedAt` (Date), `publishedAt` (Date | null, retained on unpublish), plus hydrated `bylines` / `terms`. Spread `{...entry.edit.title}` for visual editing (no output outside edit mode). `ReferencePage` = `{ entries, nextCursor? }` (referenced entries lack `data.bylines`/`data.terms`). **`getEmDashReferences(collection, slugOrId, field, { limit?, cursor?, locale? })`** → `{ entries, nextCursor?, error?, cacheHint }` — page through a reference field; unknown field/missing entry → empty; merge its `cacheHint` into the route's.

**Other content helpers:** `getTranslations(collection, dbId)` → `{ translationGroup, translations: [{ id, locale, slug, status }], error? }`; `resolveEmDashPath(pathname)` → `{ collection, entry, params } | null` (matches routable URL patterns); `getEditMeta(portableTextValue)` → `{ collection, id, field } | undefined`.

**URL helpers:** `decodeSlug(raw)` (undefined for missing; `decodeURIComponent`, throws on malformed); `slugify(value)`; `isSafeHref(v)` / `sanitizeHref(v)` (allow `http:`, `https:`, `mailto:`, `tel:`, site-relative, fragments; reject script schemes, protocol-relative, backslash forms, control chars; `sanitizeHref` returns `"#"` when unsafe/empty).

**Preview:** `generatePreviewToken({ contentId: "collection:id", secret, expiresIn (seconds or "1h"/"30m"/"2d"/"1w"; default "1h") })`; `verifyPreviewToken({ token | url, secret })` → `{ valid: true, payload: { cid, exp, iat } } | { valid: false, error: "none" | "malformed" | "invalid" | "expired" }`; `parseContentId(cid)` → `{ collection, id }`; `getPreviewUrl({ collection, id, secret, expiresIn?, baseUrl?, pathPattern?, locale? })` (site-relative without `baseUrl`); `buildPreviewUrl({ path, token, baseUrl? })`; `isPreviewRequest(url)` / `getPreviewToken(url)`. Middleware handles normal preview automatically.

**Converters:** `prosemirrorToPortableText(doc)`, `portableTextToProsemirror(pt)`.

**Site settings:** `getSiteSettings()` → `Partial<SiteSettings>` (unset keys omitted; logo/favicon resolved to media refs); `getSiteSetting(key)`; `getSiteSettingsWithCacheHint()` → `{ data, cacheHint }`. Read-only.

**SEO:** `getSeoMeta(content, { siteTitle, siteUrl, titleSeparator (" | "), path, defaultOgImage, defaultTitle, defaultDescription })` → `{ title, description, ogTitle, ogDescription, ogImage, canonical, robots }`; `getContentSeo(content)` (raw panel values); `getHreflangAlternates(collection, entryId, { siteUrl? })` → `[{ hreflang, href }]` + `x-default` (empty when i18n off, entry `noindex`, or no absolute site URL).

**Comments:** `getComments({ collection, contentId, threaded, reactions, sort: "oldest" (default) | "best" })` → `{ items, total }` (≤ 500 approved; use REST for pagination); `getCommentCount(collection, contentId)`.

**Menus:** `getMenu(name, { locale? })` → `Menu | null` (`items[]` with `label`, `url`, `children[]`; follows locale fallback); `getMenus({ locale? })` → summaries; `getMenuWithCacheHint()`.

**Bylines:** `getByline(id)`, `getBylineBySlug(slug, { locale? })`, `getEntriesByByline(collection, translationGroupOrId)`; entries already carry ordered credits in `data.bylines`.

**Taxonomies:** `getTaxonomyTerms(name, { locale?, includeCounts? (default true; tree for hierarchical) })`, `getTerm(name, slug, { locale?, includeCounts? })`, `getEntryTerms(collection, entryId, name)`, `getEntriesByTerm(collection, name, slug)`, `getTermsForEntries(collection, entryIds, name, { locale? })` → `Map<entryId, TaxonomyTerm[]>`, `getAllTermsForEntries(collection, entryIds)` → `Map<entryId, Record<taxonomy, terms>>`, `getTaxonomyDefs({ locale? })`, `getTaxonomyDef(name, { locale? })`, `getTaxonomyTermsWithCacheHint()`. Entries also hydrate `data.terms`.

**Widget areas:** `getWidgetAreas()`, `getWidgetArea(name)` → `{ widgets: [{ type, title, … }] }` (sorted), `getWidgetAreaWithCacheHint(name)`.

**Sections:** `getSections({ source?: "theme" | "user" | "import", search?, limit (50, max 100), cursor })` → `{ items, nextCursor? }`; `getSection(slug)`.

**Search:** `search(query, { collections? (all searchable), status ("published"), locale? (all), limit (20), cursor, scope: "all" | "title" })` → `{ items: [{ title, snippet (with <mark>), score, … }], nextCursor? }`; `scope: "title"` matches only title fields (collections whose title isn't search-indexed return nothing).

**Errors:** query functions return `error` in the envelope (missing entry is not an error); helpers without envelopes may throw — handle at the route boundary (`error` → 500; `!entry` → `Astro.rewrite("/404")`).

## 11.5 Field types reference (17 types)

Source: https://docs.emdashcms.com/reference/field-types/

| Type | Column | Notes / validation / stored value |
| --- | --- | --- |
| `string` | TEXT | short text; `minLength`, `maxLength`, `pattern`; editor caps at `maxLength` with live count |
| `text` | TEXT | multi-line; same validation; widget option `rows` (default 3) |
| `url` | TEXT | must be absolute `http:`/`https:`, `mailto:`, `tel:`, site-relative path, or fragment; rejects protocol-relative, backslash forms, control chars, `javascript:`/`data:`. Seeds/plugin writes keep scheme-less `www.example.com`. Legacy unsafe values stay readable but any re-save is rejected until fixed — render through `sanitizeHref()` |
| `slug` | TEXT | slug-like text, **not** generated/sanitized; distinct from the reserved system `slug` |
| `number` | REAL | `min`, `max` (editor sets input bounds) |
| `integer` | INTEGER | `min`, `max` |
| `boolean` | INTEGER (0/1) | — |
| `datetime` | TEXT | an instant; API/MCP/CLI writes need `Z` or an explicit offset; stored UTC with ms (`2025-01-24T12:00:00.000Z`); admin picker uses **Settings → General** timezone; use `string` for calendar dates / wall-clock times |
| `select` | TEXT | `validation.options` optional (without it any string passes) |
| `multiSelect` | JSON | array; `options` optional |
| `portableText` | JSON | array of PT blocks (`{ _type: "block", style, children: [{ _type: "span", text }] }`); plugin custom blocks appear in the slash menu; rendering custom blocks needs a native plugin/companion Astro component |
| `image` | TEXT | `validation.allowedMimeTypes` (exact types); widget option `darkVariant` (true → second slot; value carries `darkVariant: { id, width, height }`); stored `{ id, src, alt, width, height, provider, meta: { storageKey } }` |
| `file` | TEXT | `allowedMimeTypes`; stored `{ id, provider, filename, mimeType, meta: { storageKey } }` (+ optional `url`, `size`); queries return the persisted value without hydration — use media library APIs for fresh metadata |
| `reference` | **none** | entry picker backed by a **relation**; links in `_emdash_content_references` keyed by translation group (shared across locales); read back under `entry.references[field]`, not `data` |
| `json` | JSON | arbitrary, **no validation** — use sparingly (see Field Kit §6.21 for widgets) |
| `repeater` | JSON | array of row objects; `validation.subFields` (≥ 1; each `{ slug, label, type, required?, options? }`; allowed sub-types `string`, `text`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `image` — no nested repeater/PT/reference/file), `minItems` (≥ 0), `maxItems` (≥ 1, ≥ minItems) |
| `blocks` | JSON | ordered typed blocks `{ _type, _version, _key, ...fields }`; `validation.allowedTypes` (ordered slugs), `retiredTypes` (server-managed), `minItems` (raising above 0 on populated data needs a migration), `maxItems` (≤ 100); always optional, defaults `[]`; can't be required/unique/searchable/indexed or use a custom widget; block definitions may use scalar/text/selection/PT/image/file/repeater fields but not references, JSON, slugs, nested blocks; render with `<Blocks value components fallback>` from `emdash/ui` |

**`reference` details:** `validation.targetCollection` (creating the field auto-creates relation `{collection}_{field}` with this field as the **parent** end; child side takes the field's label; `multiple` (default false) sets the limit) **or** `validation.relation` (bind to an existing relation; `relationSide: "parent" | "child"` only for self-referencing relations). Both forms store `relation`, `relationSide`, `targetCollection`; target is fixed afterward (delete + recreate to change); one field per relation end. Bound fields can't be `indexed` and aren't searchable. **Unbound** fields (no relation/target) keep a TEXT column holding one entry ID (or a JSON array with `options.allowMultiple`), render as a text box, and *can* be indexed/filtered; binding later (choose a referenced collection in **Content Types**) creates the relation, copies IDs into links, and clears `searchable`/`indexed` (column kept, no longer written).

**Common properties:** `slug`, `label`, `type` (required); `required`, `unique`, `searchable`, `indexed` (scalar types only: `string`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `reference`, `slug` — enables `orderBy` and `fieldFilters`), `translatable` (default true; `false` syncs the value across translations — use for identifiers, prices, flags), `defaultValue`, `validation`, `widget`, `options`, `sortOrder`. `blocks` uses only `slug`, `label`, `type`, `translatable`, `validation`, `sortOrder`.

**Reserved field slugs:** `id`, `slug`, `status`, `author_id`, `primary_byline_id`, `created_at`, `updated_at`, `published_at`, `scheduled_at`, `deleted_at`, `version`, `live_revision_id`, `draft_revision_id`, `terms`, `bylines`, `byline`.

**Types:** `import type { FieldType, Field, CreateFieldInput } from "emdash"`.

## 11.6 Hook reference (all plugin formats; complements §6.5)

Source: https://docs.emdashcms.com/reference/hooks/

Overview table as §6.5. Details not covered there:

**`content:beforeSave`** (`content:write`) — event `{ content, collection, isNew, id?, actor?: { id, role }, locale?, translationOf? }`. `locale` = save locale (create: requested/default; update: stored); `translationOf` set only for creates from the translation flow → use `isNew && !translationOf` to detect a brand-new entry (e.g. enforce one entry per locale by `ctx.content.list("home", { limit: 1, where: { locale } })` and throwing `ContentSaveRejectedError` natively). Return modified content / rejection envelope / `void`.
**`content:afterSave`** (`content:read`) — `{ content (complete saved entry: `content.id` = DB id, fields under `content.data`), collection, isNew, actor?, locale?, translationOf? }`.
**`content:beforeDelete`** (`content:read`) — `{ id, collection, permanent?: false }` (`permanent` present natively, omitted in sandbox — don't branch on it); runs only for trash moves; permanent deletion bypasses it. `false` cancels.
**`content:afterDelete`** — `{ id, collection, permanent }`; check `permanent` before deleting data a restored entry needs.
**Policy hooks** (`hooks.content-policy:register`, no content access implied): `beforePublish` (→ `PUBLISH_REJECTED`), `beforeSchedule` (+ `scheduledAt`, → `SCHEDULE_REJECTED`), `beforeUnpublish` (→ `UNPUBLISH_REJECTED`); return `void` or `{ cancel: true, reason (1–500 chars) }`; invalid decisions/abort errors fail closed.
**After-state hooks** (`content:read`; event `ContentStateChangeEvent { content (complete entry incl. id, slug, status; fields in content.data), collection }`; deferred after the response; no return): `afterPublish` (incl. scheduled auto-publish; with `errorPolicy: "abort"` later publish hooks don't run), `afterUnpublish` (also cancels a pending schedule **without** `afterUnschedule`), `afterRestore` (restored entry is a draft with no schedule; no `afterUnschedule`), `afterSchedule`, `afterUnschedule`.
**Media:** `media:beforeUpload` (`media:write`) `{ file: { name, type, size } }` → return `{ name, type, size }` / `void` / throw; `media:afterUpload` (`media:read`) `{ media: { id, filename, mimeType, size: number | null, url, createdAt } }`.
**Lifecycle:** `plugin:install` / `plugin:activate` / `plugin:deactivate` (event `{}`), `plugin:uninstall` (`{ deleteData }`); no capability.
**`cron`** (no capability) — schedule with `ctx.cron.schedule()`; expressions evaluated in **UTC**; event `{ name, data?, scheduledAt }`.
**Email** — order for plugin-sent mail: `email:beforeSend` → `email:deliver` → `email:afterSend`; system auth messages go straight to `email:deliver`. `email:beforeSend` (`hooks.email-events:register`) event `{ message: { to, cc?, replyTo?, subject, text, html? }, source }` → return modified message or `false` to cancel. `email:deliver` (`hooks.email-transport:register`, exclusive — declare `{ exclusive: true, handler }`) same event; `source` = `"system"` or plugin ID; deliver `cc`/`replyTo` when present. `email:afterSend` fire-and-forget (errors logged).
**Comments** (all `users:read`) — order `comment:beforeCreate` → `comment:moderate` → `comment:afterCreate`; `comment:afterModerate` separately on status changes. `StoredComment { id, collection, contentId, parentId, authorName, authorEmail, authorUserId, body, status, moderationMetadata, createdAt, updatedAt }`. `beforeCreate` event `{ comment: { collection, contentId, parentId, authorName, authorEmail, authorUserId, body, ipHash, userAgent }, metadata }` → modified event / `false` / `void`. `moderate` (exclusive) event adds `collectionSettings: { commentsEnabled, commentsModeration: "all" | "first_time" | "none", commentsClosedAfterDays, commentsAutoApproveUsers }`, `priorApprovedCount` → `{ status: "approved" | "pending" | "spam", reason? }`. **Active moderator:** built-in applies collection settings; exactly one plugin provider → auto-selected and stored; several without a stored choice → none selected, comments wait for review. `afterCreate` event `{ comment, metadata, content: { id, collection, slug, title? }, contentAuthor?: { id, name, email } }` (sending mail needs `email:send` + a configured transport, else `ctx.email` undefined). `afterModerate` event `{ comment, previousStatus, newStatus, moderator: { id, name }, origin?: { source: "admin", userId } | { source: "plugin", pluginId } }`.
**Bylines** (`bylines:read`) — run after admin API / MCP changes (not seeds/imports); errors logged. `byline:afterSave` `{ byline: BylineInfo, isNew }`; `byline:afterDelete` `{ byline }` (pre-deletion state). Relinking a byline to another user changes inferred credits without per-entry hooks.
**Page hooks** — both receive `{ page: PublicPageContext }` (shape as §6.18). `page:metadata` (no capability) contributions: `{ kind: "meta", name, content, key? }`, `{ kind: "property", property, content, key? }`, `{ kind: "link", rel: "canonical" | "alternate" | "author" | "license" | "nlweb" | "site.standard.document", href, hreflang?, key? }`, `{ kind: "jsonld", id?, graph }`. `page:fragments` (`hooks.page-fragments:register`, native only) contributions as §6.18.
**Configuration (in-process pipeline):** `{ priority 100 (lower first), timeout 5000 ms, dependencies: string[], errorPolicy: "abort" (default) | "continue", exclusive, handler }`. **Errors:** `abort` stops execution and rolls back where applicable; `continue` logs and proceeds. **Order:** priority ascending → dependencies satisfied → same-priority order deterministic but unspecified.
**`PluginContext`:** `plugin { id, version }`, `storage`, `kv`, `content?`, `media?`, `http?`, `log`, `site { name, url, locale }`, `url(path)`, `users?`, `cron?`, `email?` (+ capability-gated `schema?`, `taxonomies?`, `bylines?`, `redirects?`, `comments?`, `settings`).

## 11.7 REST API reference

Source: https://docs.emdashcms.com/reference/rest-api/

- **Contract:** `GET /_emdash/api/openapi.json` (OpenAPI 3.1 generated from the Zod schemas; reflects `maxUploadSize`). Routes absent from OpenAPI (backups, byline admin, relation traversal, plugin management, setup, import, auth/OAuth) are not supported external REST operations — use the backup guide, MCP byline tools, or OAuth discovery metadata.
- **Auth:** session cookie **or** `Authorization: Bearer $EMDASH_TOKEN` (PAT or OAuth token; limited by scopes + user role). Cookie-authenticated state changes need `X-EmDash-Request: 1`; Bearer requests don't. Public: `GET`/`POST /_emdash/api/comments/{collection}/{contentId}` (browser POSTs need the header or a matching `Origin`).
- **Envelopes:** `{ success: true, data }` / `{ success: false, error: { code, message, details? } }`. Statuses: 400 invalid, 401 no/invalid creds, 403 scope/permission, 404, 409 conflict, 413 oversized upload, 422 plugin-rejected save, 500.
- **Pagination:** opaque `cursor` + `limit` 1–100 (default 50); pass `nextCursor` back unchanged. Some media lists support numbered pages.

**Endpoint inventory (operationId in parentheses):**
- **Content** `/_emdash/api/content/{collection}`: `GET` list (`listContent`), `POST` create (`createContent`); `/{id}`: `GET` (`getContent`), `PUT` (`updateContent`), `DELETE` soft delete (`deleteContent`); `/{id}/publish` `POST` (`publishContent`), `/unpublish` `POST`, `/schedule` `POST` (`scheduleContent`) / `DELETE` (`unscheduleContent`), `/duplicate` `POST`, `/restore` `POST`, `/permanent` `DELETE` (`permanentDeleteContent`), `/compare` `GET` (live vs draft), `/discard-draft` `POST`, `/lock` `GET`/`POST`/`DELETE` (`getEntryLock`/`acquireEntryLock`/`releaseEntryLock`), `/translations` `GET`, `/terms/{taxonomy}` `GET`/`POST` (`getContentTerms`/`setContentTerms`); `/{collection}/authors` `GET`; `/{collection}/trash` `GET`.
- **Media** `/_emdash/api/media`: `GET` list, `POST` multipart upload (`uploadMedia`); `/folders` CRUD (`listMediaFolders`, `createMediaFolder`, `getMediaFolder`, `updateMediaFolder`, `deleteMediaFolder`); `/{id}` `GET`/`PUT` metadata/`DELETE`; `/{id}/usage` `GET`; `/{id}/replace` `PUT` (`replaceMediaImage`); `/upload-url` `POST` (`getMediaUploadUrl`); `/{id}/confirm` `POST`; `/{id}/upload` `PUT` (`uploadPendingMedia`). Admin usage maintenance `/_emdash/api/admin/media-usage/`: `repair` `POST`, `progress` `GET`/`POST`, `work` `GET`, `work/retry` `POST`, `activation` `GET`/`POST`, `collection-deletions` `GET`, `collection-deletions/retry` `POST`.
- **Schema** `/_emdash/api/schema/`: `block-types` `GET`/`POST`, `block-types/{slug}` `GET`/`PUT`, `block-types/{slug}/versions/{version}/activate` `POST`; `collections` `GET`/`POST`, `collections/{slug}` `GET`/`PUT`/`DELETE`, `collections/{slug}/fields` `GET`/`POST`, `collections/{slug}/fields/{fieldSlug}` `GET`/`PUT`/`DELETE`, `collections/reorder` `POST`, `collections/{slug}/fields/reorder` `POST`, `orphans` `GET`, `orphans/{slug}` `POST` (register orphaned table).
- **Comments:** public `GET`/`POST /comments/{collection}/{contentId}`; admin `/admin/comments` `GET`, `/counts` `GET`, `/bulk` `POST`, `/{id}` `GET`/`DELETE`, `/{id}/status` `PUT`.
- **Taxonomies** `/taxonomies`: `GET`; `/{name}` `GET`/`PUT`/`DELETE` (deletes every locale, all terms, all assignments — not the entries); `/{name}/translations` `GET`; `/{name}/reorder` `POST`; `/{name}/terms` `GET`/`POST`; `/{name}/terms/{slug}` `GET`/`PUT`/`DELETE`.
- **Menus** `/menus`: `GET`/`POST`; `/{name}` `GET`/`PUT`/`DELETE`; `/{name}/items` `POST`; `/{name}/items/{id}` `PUT`/`DELETE`; `/{name}/reorder` `POST`.
- **Sections** `/sections`: `GET`/`POST`; `/{slug}` `GET`/`PUT`/`DELETE`.
- **Widgets** `/widget-areas`: `GET`/`POST`; `/{name}` `GET`/`DELETE`; `/{name}/widgets` `POST`; `/{name}/widgets/{id}` `PUT`/`DELETE`; `/{name}/reorder` `POST`.
- **Settings** `/settings`: `GET`/`PUT`. **Search** `/search` `GET`, `/search/suggest` `GET`, `/search/rebuild` `POST`, `/search/enable` `POST`, `/search/stats` `GET`. **Redirects** `/redirects` `GET`/`POST`, `/{id}` `GET`/`PUT`/`DELETE`, `/404s` `GET`/`POST` (prune)/`DELETE` (clear), `/404s/summary` `GET`. **Users** `/admin/users` `GET`, `/{id}` `GET`/`PUT`, `/{id}/disable` `POST`, `/{id}/enable` `POST`; `/admin/allowed-domains` `GET`/`POST`, `/{domain}` `PUT`/`DELETE`. **Transfer** `/admin/transfer/`: `capabilities`, `imports` (`GET`/`POST`, `/{id}`, `/{id}/missing`, `/{id}/files/{path}` `PUT`, `/analyze`, `/plan`, `/cancel`, `/abandon`, `/execute`, `/advance`, `/receipt`), `exports` (`GET`/`POST`, `/{id}`, `/advance`, `/manifest`, `/files/{path}`, `/archive`), `approvals` (`GET`, `/{id}/approve`, `/{id}/deny` — session-only; decide MCP `site_export_start`/`site_import_start` requests).

**Content read/update:** `GET …/{id}` → `data: { item: { id, type, slug, status, data }, _rev }`; `PUT` with `{ data: {partial fields}, _rev }` (stale → 409 `CONFLICT`; `_rev` optional in REST, mandatory in CLI/MCP). Editing a published entry creates a draft (live stays); `compare` then publish or `discard-draft`. Bodies accept byline credits; responses include primary byline + ordered credits; list filters by byline IDs (optionally inferred). Restore → draft, no schedule.

**Edit lock:** 7-minute lease; `GET`/`POST`/`DELETE …/{id}/lock` → `{ enabled, heldByCaller, holder: { userId, userName, acquiredAt, expiresAt } }`; acquire body may carry an opaque session `token` and `takeover: true`; pass the same `token` as a query param on release; saving extends the caller's lease. Another holder → `409 ENTRY_LOCKED` (details name holder/expiry); override with `"overrideLock": true` in the body or `?overrideLock=true` on bodyless `DELETE`.

**Reference selections:** create/update bodies carry `references: { fieldSlug: [ids ≤ 1000 in display order] }` written in the same transaction; child-end fields select the entries pointing at the written entry (unordered); limits enforced on both ends; on revisioned collections a changed selection is staged in the draft and re-checked at publish. Single reads return `references[field] = { entries: [{ id, slug, collection, title, locale, translationGroup }] (first 50), nextCursor? }`; list reads don't include references.

**Translations:** content create accepts `translationOf`; `GET /taxonomies/{name}` without `locale` → default-locale definition (fallback lowest locale code) but `PUT` without `locale` changes the **lowest** locale code — always pass `locale` (missing → `NOT_FOUND`). `label`/`labelSingular` are per locale; `hierarchical`/`collections` are shared (creating another locale with different values → `VALIDATION_ERROR`). Term reorder `ids` may list a subset (listed terms swap positions, others stay; e.g. `[A,B,C]` + `["C","A"]` → `[C,B,A]`); applies across locales. Menu/term/byline translation listings live in MCP (`menu_translations`, `taxonomy_term_translations`, `byline_translations`).

**Media:** list filters MIME/filename/`folderId` (`unfiled` = Main library), `includeUsage=1` (only `1` valid). `usage.count` = distinct active rows/locales + site settings (`logo`, `favicon`, `seo.defaultOgImage`); `null` for callers who can't read drafts. Coverage status: `complete` | `never` | `running` | `partial` | `failed` | `stale` | `unknown` — only `complete` lets a zero count mean unused; counts are advisory. Indexing covers image/file fields, repeater images, PT image/gallery blocks, retained block versions, and those three settings — not custom PT blocks, code, menus, widgets, plugin data, external sites, provider-only assets. **Direct upload:** `curl --form "file=@./cover.jpg;type=image/jpeg" …/media` (optional `width`, `height`, `fieldId`, `thumbnail`); `201` new, `200` + `deduplicated: true` for identical bytes. **Upload-target flow:** `POST /media/upload-url { filename, contentType, size, contentHash? }` → `{ uploadUrl, method, headers, mediaId, storageKey, expiresAt }` or `{ existing: true }` → upload (Bearer only for same-origin/root-relative targets — *never* send the token to another origin) → `POST /media/{id}/confirm { size, width, height }` (must match). Errors: `NO_FILE`, `INVALID_TYPE`, `VALIDATION_ERROR`, `FILE_NOT_FOUND`, `UPLOAD_SIZE_MISMATCH` (restart), `INVALID_STATE` (400/409 — re-read), `NOT_FOUND`, `PAYLOAD_TOO_LARGE` (413). Folders: names trimmed, ≤ 200 chars, compared NFKC-lowercased (`Photos`/`photos`/`ＰＨＯＴＯＳ` conflict); deleting returns media to Main. **Usage repair/activation** (`schema:manage` + `admin` scope): stop direct DB writers → read activation (`expanded` off / `activating` / `active`) → `POST activation { writersDrained: true }` → poll `progress` honoring `nextRequestInMs` until `active` → resume writers → continue until `ready`; irreversible once started; on `409`/`500`/timeout re-read state; `lastErrorCode` → fix then one confirmed retry. Work retries idempotent; `409 WORK_LEASE_ACTIVE` (wait for `details.leaseExpiresAt`), `409 WORK_CHANGED`. Repair body `{ scope: "collection", collection }` or `{ scope: "all" }` (sync, sequential); a `200` may still report `partial`/`failed`/`stale`.

**Transfer:** sessions need `transfer:export` / `transfer:import` permissions (admins only); tokens need `admin` or per-operation `transfer:export` / `transfer:analyze` / `transfer:execute`. During an executing import (and after failure/cancel until abandoned) most writes return `503 TRANSFER_IMPORT_IN_PROGRESS`.

**Search tokenizers** (per collection via `/search/enable`; change rebuilds): `porter unicode61` (default; English stemming), `unicode61` (word-separated languages without English stemming), `trigram` (no-space scripts such as Japanese, Chinese, Thai, Khmer, Lao, Burmese, or substring matching; queries < 3 chars return nothing). Disabling preserves the tokenizer.

**Comments/redirects:** public submissions enter moderation (`429` on rate limit); 404 log prune (by body selection) vs clear (all) never delete redirect rules. Irreversible: schema deletion, permanent content deletion, comment deletion, log clearing, some media maintenance — back up first.

## 11.8 MCP server reference (`/_emdash/api/mcp`)

Source: https://docs.emdashcms.com/reference/mcp-server/

**Auth (Bearer only — sessions don't work):** OAuth 2.1 Authorization Code + PKCE (interactive clients), personal access tokens (`ec_pat_`, created in admin), OAuth 2.0 Device Authorization Grant (`emdash login`). Discovery: `GET /.well-known/oauth-protected-resource` → authorization server metadata at `GET /.well-known/oauth-authorization-server/_emdash` (authorization/token/registration/device endpoints, scopes, grants, `S256` PKCE); unauthenticated requests → `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.

**Scopes** (role checked separately; consent page can trim requested scopes; empty grants refused): `content:read` (drafts also need user's `content:read_drafts`), `content:write` (also implies `taxonomies:manage` + `menus:manage` for compatibility), `media:read`, `media:write`, `schema:read`, `schema:write`, `taxonomies:manage`, `menus:manage`, `settings:read`, `settings:manage`, `mcp:tools`, `mcp:tools:<pluginId>`, `transfer:export`, `transfer:analyze`, `transfer:execute`, `admin` (every core tool incl. transfer; plugin tools still need `mcp:tools*`).

**Minimum roles:** Subscriber reads published content/media/taxonomies/terms/menus; Contributor reads drafts/scheduled/trash/comparisons/revisions and creates content/uploads media; Author edits/publishes own content and registers media; Editor manages bylines/taxonomies/menus/all content and reads schemas/settings; Admin changes schemas/settings, permanently deletes, repairs media usage, exports/imports the site.

**Transport:** stateless Streamable HTTP; `POST /_emdash/api/mcp` only (JSON-RPC 2.0 initialize / `tools/list` / `tools/call`); `GET`/`DELETE` → 405. Always read `tools/list` for current input schemas + annotations (`readOnlyHint`, `destructiveHint`). Results arrive as JSON text in the first content block (+ `structuredContent` when an output schema exists).

**Tool inventory (name → scope):**
- Content: `content_list`, `content_get`, `content_compare`, `content_list_trashed`, `content_translations` (`content:read`); `content_create`, `content_update`, `content_delete` (trash), `content_restore`, `content_permanent_delete`, `content_publish`, `content_unpublish`, `content_schedule`, `content_unschedule`, `content_discard_draft`, `content_duplicate` (`content:write`).
- Bylines: `byline_list`, `byline_get`, `byline_translations` (read); `byline_create`, `byline_update`, `byline_delete` (write).
- Schema: `schema_list_collections`, `schema_get_collection`, `schema_list_block_types`, `schema_get_block_type` (`schema:read`); `schema_create_block_type`, `schema_update_block_type`, `schema_activate_block_type_version`, `schema_create_collection`, `schema_update_collection`, `schema_delete_collection`, `schema_create_field`, `schema_update_field`, `schema_delete_field` (`schema:write`).
- Media: `media_list`, `media_get` (`media:read`); `media_upload` (base64), `media_create` (confirm signed upload by `storageKey`), `media_update`, `media_delete` (`media:write`); `media_usage_repair` (`admin`).
- `search` (`content:read`).
- Taxonomies: `taxonomy_list`, `taxonomy_get`, `taxonomy_list_terms`, `taxonomy_term_translations` (read); `taxonomy_create`, `taxonomy_update`, `taxonomy_delete`, `taxonomy_create_term`, `taxonomy_update_term`, `taxonomy_delete_term` (`taxonomies:manage`).
- Menus: `menu_list`, `menu_get`, `menu_translations` (read); `menu_create`, `menu_update`, `menu_delete`, `menu_set_items` (`menus:manage`).
- Revisions: `revision_list` (read), `revision_restore` (write). Settings: `settings_get` (`settings:read`), `settings_update` (`settings:manage`).
- Site transfer (Admin role always): `site_transfer_capabilities` (`transfer:*`), `site_export_start` / `site_export_status` (`transfer:export`), `site_import_analyze` (`transfer:analyze`), `site_import_start` / `site_import_resume` (`transfer:execute`), `site_import_status` / `site_import_receipt` (`transfer:*`).
- Plugin tools: `<pluginId>__<localName>` once an admin enables the plugin's MCP surface; need `mcp:tools` / `mcp:tools:<pluginId>` plus the route permission; audited.

**Lifecycle via MCP:** `content_get` returns `_rev`; **required** for `content_update`, `content_publish`, `content_unpublish`, `content_schedule`, `content_discard_draft` (stale → conflict). `content_update` is partial (omitted fields keep values); updating a published item stages a draft → `content_compare` → `content_publish` or `content_discard_draft`. Edit lock held by another user → `ENTRY_LOCKED` (holder in `_meta.details`; re-reading doesn't clear it; `overrideLock: true` to force) on update/delete/publish/unpublish/schedule/unschedule/discard/`revision_restore`. Bylines: `byline_create` makes a guest credit or links a user (one byline per user per locale); translations via `translationOf` keep the source user unless `userId` given (`null` unlinks); pass byline IDs in `bylines` on content create/update; deleting a byline removes credits and clears primary byline.

**Other notes:** `schema_get_collection` first to learn fields/constraints; collection/field deletion is irreversible. `media_upload` obeys size/MIME limits, may return `deduplicated: true`; `media_create` must be called by the same user who requested the upload URL. Terms: `parentId` must be same taxonomy, acyclic, only in hierarchical taxonomies (else `VALIDATION_ERROR`); terms with children can't be deleted. `menu_set_items` atomically replaces all items; array order = menu order; `parentIndex` points to an earlier array item. `media_usage_repair` statuses `complete`/`partial`/`failed`/`stale` are successful responses — inspect them, don't rely on `isError`.

**Site transfer via MCP:** tools never carry bytes/media/record contents/emails/URLs — upload/download with CLI or REST, then drive by operation ID. `site_export_start({ comments: true })`; `site_export_status` runs one bounded step per call → repeat until `nextRequestInMs` is `null` (`advance: false` = read-only); completed result includes `totals`. Import: upload first (`emdash site import <file> --analyze`), `site_import_analyze` per step until done → plan summary (`packageDigest`, `planDigest`, `executable`, counts, sizes, ≤ 50 principals/warnings/blockers with `total`, transformations as `code`/`kind`/`count`); pass `decisions` (principal → user ID or `null`, title/tagline choice) → new `planDigest`. `site_import_start(operationId, packageDigest, planDigest)` requires no blockers, is `destructiveHint: true` — confirm with the user. `site_import_resume` steps until `null` (safe after disconnect); `site_import_status`; `site_import_receipt` (with `receiptDigest`). While importing (and after failure/cancel until abandoned) all writing tools incl. plugin tools fail with `TRANSFER_IMPORT_IN_PROGRESS` (read-only and `site_*` tools, `initialize`, `tools/list` keep working); during media-usage activation writes fail with `MEDIA_USAGE_ACTIVATION_IN_PROGRESS`. Cancel/abandon only via REST/CLI. Operation summary: `id`, `kind`, `state`, `stage`, `progress { done, total, records, bytesDone, bytesTotal }`, digests, `error { code } | null`, timestamps.

**Approvals:** a token without the scope (e.g. only `transfer:analyze`) calling `site_export_start`/`site_import_start` → creates a pending request and fails with `TRANSFER_APPROVAL_REQUIRED` (`approvalId`, `expiresAt` in `_meta.details`; same args → same open request) → admin approves under **Settings → Transfer → Approval requests** (or the session-only REST approval endpoint; API tokens can't approve) → client repeats the call with `approvalId` (consumed when the operation starts; retryable until expiry). Bound to user + token + action + exact args; pending expires 15 min after creation, approved 15 min after approval; mismatch/denied/expired/used → `TRANSFER_APPROVAL_INVALID`; non-admin → `INSUFFICIENT_PERMISSIONS`; token without an ID → `INSUFFICIENT_SCOPE`. Afterwards the same user/token may call the status/resume/receipt tools for that operation without the scope.

**Errors:** `isError: true`, first text block starts with `[CODE] message`, `_meta.code` repeats it (e.g. `NOT_FOUND`, `INSUFFICIENT_SCOPE`, `INSUFFICIENT_PERMISSIONS`, `ENTRY_LOCKED` with `_meta.details`); transport failures → JSON-RPC `-32603` without exception details.
