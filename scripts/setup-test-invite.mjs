// Makes the setup tester's sign-in for phase 05: an Admin invite on the dev site, with the link moved to the public
// test hostname and written to a mode-600 file. The link holds a one-time token, so it is never printed.
//
//   node scripts/setup-test-invite.mjs
//   Options: --site <url> (default http://localhost:4321; loopback only), --public <https origin> (default
//   https://dev.wyattdilley.com), --out <file> (default ~/xmr-pay-dev-data/05-setup/tester-invite.txt),
//   --email <address> (default tester@coffer-test.invalid)
//
// Needs the dev site in `astro dev`: it signs in through EmDash's dev bypass (dev mode only), creates the invite, and
// takes the link from the reply (no email provider) or from the dev email list (the dev console provider). The passkey
// registered from the link belongs to the public hostname, because the built copy runs with EMDASH_SITE_URL set to it.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ADMIN = 50; // EmDash's Role.ADMIN
const args = process.argv.slice(2);
const known = new Set(["--site", "--public", "--out", "--email"]);
const opts = {};
for (let i = 0; i < args.length; i += 2) {
	if (!known.has(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith("--")) {
		console.error("usage: node scripts/setup-test-invite.mjs [--site http://localhost:4321] [--public https://dev.wyattdilley.com] [--out <file>] [--email <address>]");
		process.exit(2);
	}
	opts[args[i]] = args[i + 1];
}
const site = new URL(opts["--site"] ?? "http://localhost:4321");
const publicOrigin = opts["--public"] ?? "https://dev.wyattdilley.com";
const out = opts["--out"] ?? join(homedir(), "xmr-pay-dev-data/05-setup/tester-invite.txt");
const email = opts["--email"] ?? "tester@coffer-test.invalid";
const fail = (message) => {
	console.error(message);
	process.exit(1);
};

// The dev bypass signs anyone in as an admin, so only a site on this machine is ever asked.
if (site.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)) fail(`refusing ${site.origin}: the dev site must be on loopback (localhost, 127.0.0.1 or [::1])`);
let pub;
try {
	pub = new URL(publicOrigin);
} catch {
	pub = null;
}
if (!pub || pub.protocol !== "https:" || pub.origin !== publicOrigin.replace(/\/$/, "")) fail(`--public must be a bare https origin, like https://dev.example.com`);

async function call(path, init = {}) {
	const res = await fetch(new URL(path, site), init).catch((e) => fail(`${site.origin} doesn't answer (${e.cause?.code ?? e.message}); start the dev site first`));
	const body = await res.json().catch(() => null);
	return { res, body };
}

// 1. A dev session. Keep every cookie it sets.
const bypass = await call("/_emdash/api/auth/dev-bypass");
if (!bypass.res.ok) fail(`dev sign-in refused (${bypass.res.status} ${bypass.body?.error?.code ?? ""}); is the site in astro dev mode?`);
const cookie = bypass.res.headers
	.getSetCookie()
	.map((c) => c.split(";")[0])
	.join("; ");
const headers = { Cookie: cookie, "X-EmDash-Request": "1" };

// 2. The invite.
const invite = await call("/_emdash/api/auth/invite", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ email, role: ADMIN }) });
if (invite.res.status === 409) fail(`an account for ${email} already exists, so no invite was made (it stays between runs)`);
if (!invite.res.ok) fail(`invite refused (${invite.res.status} ${invite.body?.error?.code ?? ""})`);

// 3. The link: in the reply without an email provider, otherwise the newest dev email to this address.
let link = invite.body?.data?.inviteUrl;
if (!link) {
	const emails = await call("/_emdash/api/dev/emails", { headers });
	if (!emails.res.ok) fail(`no link in the invite reply, and the dev email list refused (${emails.res.status})`);
	const item = (emails.body?.data?.items ?? []).find((i) => i?.message?.to === email);
	link = item?.message?.text?.match(/https?:\/\/\S*\/invite\/accept\?\S+/)?.[0];
	if (!link) fail(`no invite link for ${email} in the dev email list`);
}
const url = new URL(link);
if (!url.pathname.endsWith("/invite/accept") || !url.searchParams.get("token")) fail("the invite link doesn't have the expected shape (…/invite/accept?token=…); nothing written");

// 4. Same path and token on the public hostname, into a file only this user can read.
const moved = new URL(url.pathname + url.search, pub).toString();
mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
writeFileSync(out, `${moved}\n`, { mode: 0o600 });
chmodSync(out, 0o600); // the mode above only applies to a new file
console.log(`Invite for ${email} (Admin) written to ${out} (mode 600, link on ${pub.origin}). It works once and expires in 7 days.`);
