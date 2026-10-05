// Session 2f: the plugin end to end on the running dev site, with a fake bridge. Dev only; never shipped.
//
//   node scripts/dev-e2e.mjs                  pair through the KV shortcut (below), run every check, clean up
//   node scripts/dev-e2e.mjs --pair <code>    pair with a code from the admin page's "Connect wallet host" instead
//   node scripts/dev-e2e.mjs --keep           leave the run's pool, invoice and bridge key in place afterwards
//   node scripts/dev-e2e.mjs --cleanup-only   remove what an earlier run left behind, then stop
//   node scripts/dev-e2e.mjs --issue-code <file>
//                                            store a new pairing code through the KV shortcut (as the admin page's
//                                            Connect wallet host would) and write the code to <file> (mode 600, under
//                                            ~/xmr-pay-dev-data/), then stop. For pairing the real Go bridge (3d).
//   Options: --site <loopback URL> (default http://localhost:4321), --db <path> (default ~/sites/xmr-dev-site/data.db)
//
// KV shortcut: the admin page stores only a SHA-256 hash of its code, so a script can't read one back. Instead this
// script makes a code and writes its hash into the plugin's KV row in the dev site's database (the sandbox runner keeps
// a sandboxed plugin's KV in _plugin_storage, collection "__kv"), exactly what the admin page would store. No plugin
// change. Only for a local dev site: the script refuses any site URL that isn't loopback.
//
// The fake bridge signs with an Ed25519 key generated in memory for this run and never written anywhere. Pool
// addresses are well-formed fakes (95 base58 characters) that can't receive anything. Prices come from the plugin's
// own live rate fetch (Kraken, then CoinGecko).
//
// Node's fetch sends no Origin header, like the Go bridge. Prints one line per check; exit code 0 when all pass.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

process.removeAllListeners("warning"); // node:sqlite's experimental notice
const { DatabaseSync } = await import("node:sqlite");

const PLUGIN = "coffer";
const PRODUCT = "test-sticker";
const FAKE_HEIGHT = 1_000_000;
const POOL_TARGET = 50;
/** What the run creates and cleanup removes. Wyatt's settings (currency, speed), the salt and the cron flag stay. */
const RUN_KV = ["state:pairing", "state:bridge", "state:alerts", "state:buckets", "state:purgeCursor"];
const KEY_OPTION = `plugin:${PLUGIN}:settings:bridgePublicKey`;

// ---- arguments ----
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
	const i = args.indexOf(name);
	if (i === -1) return fallback;
	if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
	return args[i + 1];
};
const site = new URL(value("--site", "http://localhost:4321"));
const dbPath = value("--db", `${homedir()}/sites/xmr-dev-site/data.db`);
const handCode = value("--pair", null);
if (!["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)) throw new Error(`refusing ${site.origin}: loopback dev sites only`);
if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath}`);
if (handCode !== null && !/^[A-Za-z0-9_-]{22}$/.test(handCode)) throw new Error("--pair takes the 22-character code from the admin page");

// ---- database (the dev site's SQLite file; the site keeps running) ----
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000");
const hasKey = () => db.prepare("SELECT 1 FROM options WHERE name = ?").get(KEY_OPTION) !== undefined;
/** What an earlier run (or a real pairing) left: one plain description per kind of row. */
function leftovers() {
	const found = [];
	for (const { collection, n } of db.prepare("SELECT collection, count(*) AS n FROM _plugin_storage WHERE plugin_id = ? AND collection IN ('pool', 'invoices') GROUP BY collection").all(PLUGIN)) {
		found.push(`${n} ${collection} row(s)`);
	}
	const kv = db.prepare(`SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = '__kv' AND id IN (${RUN_KV.map(() => "?").join(",")})`).all(PLUGIN, ...RUN_KV);
	for (const { id, data } of kv) {
		if (id !== "state:pairing") {
			found.push(`KV ${id}`);
			continue;
		}
		// --pair needs the code the admin page just stored: allowed while it's unused and unexpired, nothing else.
		let state = null;
		try {
			state = JSON.parse(data);
		} catch {}
		const active = state !== null && state.used === false && Number(state.expiresAt) > Date.now();
		if (handCode !== null && active) continue;
		if (active) found.push("an active pairing code from the admin page (pass it with --pair <code> instead)");
		else found.push(`${state?.used ? "an already used" : "an expired"} pairing code (KV state:pairing)`);
	}
	if (hasKey()) found.push("a paired bridge key (setting bridgePublicKey)");
	return found;
}
function cleanup() {
	const a = db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection IN ('pool', 'invoices')").run(PLUGIN).changes;
	const b = db.prepare(`DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = '__kv' AND id IN (${RUN_KV.map(() => "?").join(",")})`).run(PLUGIN, ...RUN_KV).changes;
	const c = db.prepare("DELETE FROM options WHERE name = ?").run(KEY_OPTION).changes;
	console.log(`cleanup: removed ${a} pool and invoice rows, ${b} KV rows, ${c} bridge key`);
}
if (flag("--cleanup-only")) {
	cleanup();
	process.exit(0);
}
const issueTo = value("--issue-code", null);
if (issueTo !== null) {
	if (!issueTo.startsWith(`${homedir()}/xmr-pay-dev-data/`)) throw new Error("--issue-code writes only under ~/xmr-pay-dev-data/");
	const code = Buffer.from(randomBytes(16)).toString("base64url");
	const state = JSON.stringify({ codeHash: Buffer.from(createHash("sha256").update(code).digest()).toString("base64url"), expiresAt: Date.now() + 15 * 60_000, used: false });
	const now = new Date().toISOString();
	db.prepare(
		"INSERT INTO _plugin_storage (plugin_id, collection, id, data, revision, created_at, updated_at) VALUES (?, '__kv', 'state:pairing', ?, ?, ?, ?) ON CONFLICT (plugin_id, collection, id) DO UPDATE SET data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at",
	).run(PLUGIN, state, crypto.randomUUID(), now, now);
	writeFileSync(issueTo, code + "\n", { mode: 0o600 });
	console.log(`issued a pairing code (valid 15 minutes) into ${issueTo}`);
	process.exit(0);
}
const found = leftovers();
if (found.length > 0) {
	throw new Error(`the dev site's plugin data isn't clean: found ${found.join("; ")}. Run with --cleanup-only to remove it${handCode !== null ? ", then press Connect wallet host again" : ""}`);
}

// ---- helpers ----
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const route = (name) => new URL(`/_emdash/api/plugins/${PLUGIN}/${name}`, site).href;
const DIGITS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A well-formed fake stagenet subaddress for a pool index: "7", 88 filler characters, the index in base58 (6 chars). */
function fakeAddress(index) {
	let n = index;
	let tail = "";
	for (let i = 0; i < 6; i++, n = Math.floor(n / 58)) tail = DIGITS[n % 58] + tail;
	return `7${"x".repeat(87)}D${tail}`;
}

/** A bridge key for this run only (kept in memory). */
function newKey() {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return { privateKey, publicB64: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
}
const bridgeKey = newKey();
let seq = Date.now();

async function send(url, { method = "POST", body, headers = {} } = {}) {
	const res = await fetch(url, { method, headers, body });
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text.slice(0, 120) };
	}
	// Plugin results arrive as { data }; host errors as { error: { code } }.
	const data = json.data;
	const code = data?.error?.code ?? json.error?.code ?? null;
	return { status: res.status, json, data, code };
}
function signedHeaders(bytes, { key = bridgeKey, ts = String(Math.floor(Date.now() / 1000)) } = {}) {
	const sig = sign(null, Buffer.concat([Buffer.from(`${ts}\n`), bytes]), key.privateKey).toString("base64");
	return { "content-type": "application/json", "x-xmr-ts": ts, "x-xmr-sig": sig };
}
const syncBody = (fields) => Buffer.from(JSON.stringify({ v: 1, seq: ++seq, height: FAKE_HEIGHT, addresses: [], snapshots: [], ...fields }));
const sync = (bytes, opts, extra = {}) => send(route("bridge/sync"), { body: bytes, headers: { ...signedHeaders(bytes, opts), ...extra } });

let failures = 0;
function check(label, pass, got) {
	if (!pass) failures++;
	console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${got}`);
	return pass;
}
const show = (r) => `${r.status} ${r.code ?? JSON.stringify(r.data ?? r.json).slice(0, 110)}`;

try {
	// 1. The plugin answers on the site.
	let r = await send(`${route("status")}?token=${"A".repeat(22)}`, { method: "GET" });
	if (!check("site up: status for an unknown token", r.code === "INVOICE_NOT_FOUND", show(r))) throw new Error("dev site or plugin not answering; is the site running with a fresh plugin build?");

	// 2. Host middleware the plugin test hosts don't reproduce (spike Q1/Q2).
	const probe = syncBody({});
	r = await sync(probe, undefined, { authorization: "Bearer not-a-real-token" });
	check("bridge/sync with an invalid Bearer token: 401", r.status === 401 && r.code === "INVALID_TOKEN", show(r));
	r = await sync(probe, undefined, { origin: "https://example.invalid" });
	check("bridge/sync with a cross-origin Origin: 403", r.status === 403 && r.code === "CSRF_REJECTED", show(r));
	r = await send(route("checkout"), { body: JSON.stringify({ kind: "product", product: PRODUCT }), headers: { "content-type": "application/json", origin: "https://example.invalid" } });
	check("checkout with a cross-origin Origin: 403", r.status === 403 && r.code === "CSRF_REJECTED", show(r));
	r = await send(route("admin"), { body: JSON.stringify({ type: "page_load", page: "/payments" }), headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" } });
	check("admin with an invalid Bearer token: 401", r.status === 401, show(r));
	r = await send(route("admin"), { body: JSON.stringify({ type: "page_load", page: "/payments" }), headers: { "content-type": "application/json" } });
	check("admin with no session: refused", r.status === 401 || r.status === 403, show(r));
	r = await send(route("bridge/sync"), { body: Buffer.alloc(256 * 1024 + 1, 0x20), headers: signedHeaders(Buffer.alloc(0)) });
	check("bridge/sync over 256 KiB: 413", r.status === 413, show(r));

	// 3. Unpaired.
	r = await send(route("bridge/sync"), { body: probe, headers: { "content-type": "application/json" } });
	check("bridge/sync unsigned: MISSING_SIGNATURE", r.code === "MISSING_SIGNATURE", show(r));
	r = await sync(syncBody({}));
	check("bridge/sync signed, not paired: NOT_PAIRED", r.code === "NOT_PAIRED", show(r));

	// 4. Pairing: a code from the admin page (--pair), or the KV shortcut.
	let code = handCode;
	if (code === null) {
		code = b64url(randomBytes(16));
		const state = JSON.stringify({ codeHash: b64url(createHash("sha256").update(code).digest()), expiresAt: Date.now() + 15 * 60_000, used: false });
		const now = new Date().toISOString();
		db.prepare(
			"INSERT INTO _plugin_storage (plugin_id, collection, id, data, revision, created_at, updated_at) VALUES (?, '__kv', 'state:pairing', ?, ?, ?, ?) ON CONFLICT (plugin_id, collection, id) DO UPDATE SET data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at",
		).run(PLUGIN, state, crypto.randomUUID(), now, now);
	}
	const firstAddresses = Array.from({ length: 10 }, (_, i) => ({ index: i + 1, address: fakeAddress(i + 1) }));
	const wrongPair = syncBody({ pair: { code: b64url(randomBytes(16)), publicKey: bridgeKey.publicB64 } });
	r = await sync(wrongPair);
	check("pair with a wrong code: PAIRING_REJECTED", r.code === "PAIRING_REJECTED", show(r));
	const pairBytes = syncBody({ addresses: firstAddresses, pair: { code, publicKey: bridgeKey.publicB64 } });
	r = await sync(pairBytes);
	check(`pair ${handCode ? "(admin page code)" : "(KV shortcut)"}, 10 addresses: ok, 10 free`, r.data?.ok === true && r.data.poolFree === 10, show(r));
	r = await sync(syncBody({ pair: { code, publicKey: newKey().publicB64 } }), newKey());
	check("the same code again, another key: refused", r.code !== null && r.data?.ok !== true, show(r));
	check("pairing code burned in KV", JSON.parse(db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = '__kv' AND id = 'state:pairing'").get(PLUGIN).data).used === true, "used: true");

	// 5. Signed syncs: top-up, then forged, tampered and stale requests changing nothing.
	const topUp = Array.from({ length: POOL_TARGET - 10 }, (_, i) => ({ index: i + 11, address: fakeAddress(i + 11) }));
	r = await sync(syncBody({ addresses: topUp }));
	check("top-up to 50 addresses", r.data?.ok === true && r.data.poolFree === POOL_TARGET && r.data.poolTarget === POOL_TARGET, show(r));
	r = await sync(syncBody({}), { key: newKey() });
	check("signed by another key: BAD_SIGNATURE", r.code === "BAD_SIGNATURE", show(r));
	const good = syncBody({});
	const tampered = Buffer.from(good);
	tampered[tampered.length - 2] ^= 0x01;
	r = await send(route("bridge/sync"), { body: tampered, headers: signedHeaders(good) });
	check("one byte changed after signing: BAD_SIGNATURE", r.code === "BAD_SIGNATURE", show(r));
	r = await sync(syncBody({}), { ts: String(Math.floor(Date.now() / 1000) - 600) });
	check("timestamp 10 minutes old: STALE_TIMESTAMP", r.code === "STALE_TIMESTAMP", show(r));
	const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), syncBody({})]);
	r = await sync(bom);
	check("signed body with a leading BOM: INVALID_ENCODING", r.code === "INVALID_ENCODING", show(r));

	// 6. Checkout as a same-origin browser would send it; a client-sent price is ignored.
	r = await send(route("checkout"), { body: JSON.stringify({ kind: "product", product: PRODUCT, price: 0.0001 }), headers: { "content-type": "application/json", origin: site.origin } });
	const inv = r.data;
	if (!check(`checkout ${PRODUCT} (live rate)`, typeof inv?.token === "string" && /^\d+$/.test(inv.amountAtomic ?? "") && inv.status === "new", show(r))) throw new Error("checkout failed; nothing to pay");
	const index = Array.from({ length: POOL_TARGET }, (_, i) => i + 1).find((i) => fakeAddress(i) === inv.address) ?? 0;
	check("invoice on a pool address, exact monero: URI", index >= 1 && inv.uri.startsWith(`monero:${inv.address}?tx_amount=${inv.amountXmr}&`), `index ${index}, ${inv.amountXmr} XMR, ${inv.amountAtomic} atomic`);
	// Same product, no client price, within the rate's 60-second cache: the same amount.
	r = await send(route("checkout"), { body: JSON.stringify({ kind: "product", product: PRODUCT }), headers: { "content-type": "application/json", origin: site.origin } });
	check("client-sent price ignored (same amount without it)", r.data?.amountAtomic === inv.amountAtomic, `${inv.amountAtomic} vs ${r.data?.amountAtomic ?? show(r)}`);
	const status = async () => send(`${route("status")}?token=${encodeURIComponent(inv.token)}`, { method: "GET" });
	r = await status();
	const required = r.data?.required;
	check("status: new", r.data?.status === "new" && Number.isInteger(required) && required >= 1, `status ${r.data?.status}, required ${required}`);

	// 7. The payment, in two parts: half seen unmined, then the rest (a full payment seen at once goes straight to
	// confirming, spec "Invoice lifecycle"), then both mined and confirmed to the required depth.
	const now = () => Math.floor(Date.now() / 1000);
	const half = BigInt(inv.amountAtomic) / 2n;
	const part = (amount) => ({ txid: randomBytes(32).toString("hex"), amount: String(amount), unlockTime: "0", doubleSpendSeen: false });
	const [p1, p2] = [part(half), part(BigInt(inv.amountAtomic) - half)];
	const at = (t, confirmations, height) => ({ ...t, confirmations, height, timestamp: now() });
	r = await sync(syncBody({ snapshots: [{ index, transfers: [at(p1, 0, 0)] }] }));
	check("sync: half the amount seen unmined; index watched", r.data?.ok === true && r.data.watch.includes(index), show(r));
	r = await status();
	check("status: seen", r.data?.status === "seen" && r.data.receivedAtomic === p1.amount, `status ${r.data?.status}, received ${r.data?.receivedAtomic}`);
	// A time-locked transfer of the full amount beside the parts: never counted (spec "Payment logic").
	const locked = { ...part(inv.amountAtomic), unlockTime: "99999999" };
	r = await sync(syncBody({ snapshots: [{ index, transfers: [at(p1, 0, 0), at(locked, 0, 0)] }] }));
	r = await status();
	check("a time-locked transfer of the full amount isn't counted", r.data?.status === "seen" && r.data.receivedAtomic === p1.amount, `status ${r.data?.status}, received ${r.data?.receivedAtomic}`);
	r = await sync(syncBody({ snapshots: [{ index, transfers: [at(p1, 0, 0), at(locked, 0, 0), at(p2, 0, 0)] }] }));
	r = await status();
	check("status: the rest arrives: confirming", r.data?.status === "confirming" && r.data.receivedAtomic === inv.amountAtomic, `status ${r.data?.status}, received ${r.data?.receivedAtomic}`);
	for (let c = 1; c <= required; c++) {
		r = await sync(syncBody({ height: FAKE_HEIGHT + c, snapshots: [{ index, transfers: [p1, locked, p2].map((t) => at(t, c, FAKE_HEIGHT + 1)) }] }));
		const s = await status();
		const want = c >= required ? "settled" : "confirming";
		check(`sync: ${c} of ${required} confirmations: ${want}`, r.data?.ok === true && s.data?.status === want, `status ${s.data?.status}, confirmations ${s.data?.confirmations}`);
	}
	seq -= 10; // a snapshot older than the one that settled the invoice
	r = await sync(syncBody({ height: FAKE_HEIGHT + required, snapshots: [{ index, transfers: [] }] }));
	r = await status();
	check("an older seq with the payment gone changes nothing", r.data?.status === "settled", `status ${r.data?.status}`);
	check("final status", r.data?.status === "settled" && r.data.receivedAtomic === inv.amountAtomic && r.data.settledAt !== null, `settled at ${r.data?.settledAt}, received ${r.data?.receivedAtomic}`);
} catch (err) {
	failures++;
	console.log(`STOPPED: ${err.message}`);
} finally {
	if (flag("--keep")) console.log("--keep: the run's pool, invoices and bridge key stay (remove them with --cleanup-only)");
	else cleanup();
	db.close();
}

console.log(failures === 0 ? "ALL AS EXPECTED" : `${failures} UNEXPECTED RESULT(S)`);
process.exitCode = failures === 0 ? 0 : 1;
