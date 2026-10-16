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

4. **Save the token and the account ID.** Each line starts with its name, then `=`:

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

## Before the first deploy: Cloudflare Access (Wyatt's choice, 2026-10-16)

Use hostname-based Access applications, which can exist before the Worker does. Protecting the whole Worker from its own **Access** tab can't exempt a path. This follows Cloudflare's "Cloudflare Access" page for Workers, and is the same pattern as `dev.wyattdilley.com`.

6. **The site, protected.**
   - Go to **Zero Trust**, then **Access**, then **Applications**, then add a **Self-hosted** application.
   - **Domain:** `xmr-cf-spike.<subdomain>.workers.dev` (no path).
   - **Policy:** **Allow**, with **Include: Emails** set to your address (or your usual login method).
7. **The plugin routes, open.**
   - Add a second **Self-hosted** application.
   - **Domain:** the same hostname, with the **path** `_emdash/api/plugins/*`.
   - **Policy:** **Bypass**, **Include: Everyone**.
   - The more specific application wins for that path. The measuring script, and a fake bridge's signed syncs, need these routes without a login, just as a real wallet host does.
8. **Tell me both exist.** I'll deploy (`scripts/with-cf-env.sh …/wrangler deploy`), and Wrangler creates the D1 database and R2 bucket.
9. **Then you open `https://xmr-cf-spike.<subdomain>.workers.dev/_emdash/admin`,** sign in through Access, and finish EmDash's setup wizard with a passkey.
10. **I check from the dev box:**
    - the root and `/_emdash/admin` redirect to the Access login
    - a plugin route answers without one
    - the plugin loaded on the Cloudflare runner

    Then the measurements in PLAN.md begin.

## When the spike ends (you)

11. **Delete:**
   - the Worker `xmr-cf-spike`
   - the D1 database `xmr-cf-spike`
   - the R2 bucket `xmr-cf-spike-media`
   - any KV namespace Wrangler created for it
   - the two Access applications from steps 6 and 7
12. **Revoke** the `coffer-cf-spike` token under **My Profile**, **API Tokens**.
13. **On the dev box:** `rm ~/.config/xmr-pay-dev/cloudflare.env`.

## If something's off

- **The deploy refuses `worker_loaders`:** Worker Loader (Dynamic Workers) may need enabling on the account, or may still be in beta. Stop; we check Cloudflare's current Dynamic Workers docs together.
- **A permission error naming a resource:** tell me which. I'll tell you which single permission to add; nothing broader.
