# Cloudflare spike: setup walkthrough (Wyatt)

For `spikes/cf-runner/PLAN.md`. Every step here is in your Cloudflare account or your own terminal. Nothing goes into Claude Code, and the token is never pasted anywhere but the file in step 4.

Wyatt's choices (2026-10-16):
- **Deploys:** option A, a scoped API token in a mode-600 file, used only through `scripts/with-cf-env.sh` (which runs nothing but `wrangler`).
- **Approved:** the working area `~/sites/xmr-cf-spike` and its throwaway dependencies.
- **The site** is scaffolded and builds locally: EmDash 1.1.0, `@emdash-cms/cloudflare` 1.1.0, `@astrojs/cloudflare` 14.3.4, `wrangler` 4.149.0, Coffer sandboxed. Nothing is deployed yet.

## In the Cloudflare dashboard (your browser)

1. **Your `workers.dev` subdomain.**
   - Go to **Workers & Pages**.
   - If Cloudflare asks you to choose a `workers.dev` subdomain (first visit), pick one that doesn't identify you.
   - The spike site will be `https://xmr-cf-spike.<subdomain>.workers.dev`.
2. **Your Account ID.**
   - On **Workers & Pages**, the right-hand column shows **Account ID**.
   - Keep it for step 4. It isn't a secret, but it goes in the same file.
3. **A scoped API token.**
   1. Go to **My Profile** (top right), then **API Tokens**, then **Create Token**, then **Create Custom Token**.
   2. **Token name:** `coffer-cf-spike`.
   3. **Permissions,** each one an **Account** row:
      - **Workers Scripts:** Edit
      - **D1:** Edit
      - **Workers R2 Storage:** Edit
      - **Workers KV Storage:** Edit (Astro's Cloudflare adapter may create a KV namespace for sessions)
      - **Account Settings:** Read
   4. **Account Resources:** Include, your account only.
   5. **Zone Resources:** none. The site is on `workers.dev`, so no zone or DNS access.
   6. **Client IP Address Filtering:** optional. If you know the dev box's public IP, limit the token to it.
   7. **TTL:** today to 14 days from today.
   8. **Continue to summary,** then **Create Token.** Copy the token now; Cloudflare shows it once.

## On the dev box (your terminal, not Claude Code)

4. **Save the token and the account ID:**

   ```sh
   install -m 600 /dev/null ~/.config/xmr-pay-dev/cloudflare.env
   nano ~/.config/xmr-pay-dev/cloudflare.env
   ```

   Put in exactly these two lines, then save (Ctrl+O, Enter, Ctrl+X):

   ```text
   CLOUDFLARE_API_TOKEN=<the token>
   CLOUDFLARE_ACCOUNT_ID=<the account id>
   ```

   Check the mode: `stat -c %a ~/.config/xmr-pay-dev/cloudflare.env` should print `600`.
5. **Tell me it's there.**
   - I check it with a read-only call through the wrapper: `wrangler d1 list`. It lists D1 databases, none yet.
   - I never print the token.

## The first deploy (together)

6. **I build and deploy** (`scripts/with-cf-env.sh …/wrangler deploy`). Wrangler creates the D1 database and the R2 bucket and prints the site's URL.
7. **Right away, you open `https://xmr-cf-spike.<subdomain>.workers.dev/_emdash/admin`** and finish EmDash's setup wizard, with a passkey on that hostname.
   - Until you do, whoever arrives first could claim the site's admin.
   - **Alternative:** turn on Cloudflare Access for the Worker's `workers.dev` route before step 6, and add a bypass for `/_emdash/api/plugins/*`, as on `dev.wyattdilley.com`. Otherwise the measuring script can't reach the routes.
8. **I check that the plugin loaded on the Cloudflare runner.** Then the measurements in PLAN.md begin.

## When the spike ends (you)

9. **Delete:**
   - the Worker `xmr-cf-spike`
   - the D1 database `xmr-cf-spike`
   - the R2 bucket `xmr-cf-spike-media`
   - any KV namespace Wrangler created for it
10. **Revoke** the `coffer-cf-spike` token under **My Profile**, **API Tokens**.
11. **On the dev box:** `rm ~/.config/xmr-pay-dev/cloudflare.env`.

## If something's off

- **The deploy refuses `worker_loaders`:** Worker Loader (Dynamic Workers) may need enabling on the account, or may still be in beta. Stop; we check Cloudflare's current Dynamic Workers docs together.
- **A permission error naming a resource:** tell me which. I'll tell you which single permission to add; nothing broader.
