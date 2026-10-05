// Session 3h: real stagenet invoices on the running dev site, the pay scripts Wyatt runs, and a watcher. Dev only;
// never shipped. Loopback sites only. State lives in ~/xmr-pay-dev-data/3h-invoices.json.
//
//   node scripts/dev-invoices.mjs new <name> [--product <slug>]   checkout (default test-sticker), record the invoice
//   node scripts/dev-invoices.mjs pay-script <step> <name>=<fraction|rest> ...
//                                    write ~/xmr-pay-dev-data/3h-pay-<step>.sh: one transfer to every listed invoice
//   node scripts/dev-invoices.mjs list                                 every recorded invoice, its status now
//   node scripts/dev-invoices.mjs watch                                poll status every 15 s, append changes to
//                                                                      ~/xmr-pay-dev-data/3h-watch.txt (run in tmux)
//   node scripts/dev-invoices.mjs drain-pool --below <index>           DEV SHORTCUT (Wyatt, 2026-10-05): mark free pool
//                                    rows below <index> claimed with no invoice (the state a lost claim race leaves),
//                                    so the next checkout gets a far index. Prints the counts
//   Options: --site <loopback URL> (default http://localhost:4321), --db <path> (default ~/sites/xmr-dev-site/data.db)
//
// Fractions are plain decimals rounded down ("0.6"); "rest" pays exactly what the recorded parts left unpaid.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import { atomicToXmr, partAtomic, payScript } from "./dev-invoices-lib.mjs";

process.removeAllListeners("warning"); // node:sqlite's experimental notice
const { DatabaseSync } = await import("node:sqlite");

const PLUGIN = "coffer";
const DATA = `${homedir()}/xmr-pay-dev-data`;
const STATE = `${DATA}/3h-invoices.json`;
const WATCH = `${DATA}/3h-watch.txt`;

const args = process.argv.slice(2);
const value = (name, fallback) => {
	const i = args.indexOf(name);
	if (i === -1) return fallback;
	if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
	const v = args[i + 1];
	args.splice(i, 2);
	return v;
};
const site = new URL(value("--site", "http://localhost:4321"));
const dbPath = value("--db", `${homedir()}/sites/xmr-dev-site/data.db`);
if (!["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)) throw new Error(`refusing ${site.origin}: loopback dev sites only`);
const route = (name) => new URL(`/_emdash/api/plugins/${PLUGIN}/${name}`, site).href;

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { invoices: {} });
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, "\t") + "\n", { mode: 0o600 });
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";

async function status(token) {
	const res = await fetch(`${route("status")}?token=${encodeURIComponent(token)}`);
	const json = await res.json();
	return json.data;
}

/** The review reason isn't in the public status answer; read it (read-only) from the site's database. */
function reviewReasons() {
	if (!existsSync(dbPath)) return {};
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const out = {};
		for (const r of db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'invoices'").all(PLUGIN)) {
			const d = JSON.parse(r.data);
			if (d.reviewReason) out[d.token] = d.reviewReason;
		}
		return out;
	} finally {
		db.close();
	}
}

function describe(s, reason) {
	if (!s || s.error) return `error ${s?.error?.code ?? "no answer"}`;
	const parts = [s.status + (reason ? `(${reason})` : ""), `received ${s.receivedAtomic}`, `conf ${s.confirmations}`];
	if (s.pendingExpiry) parts.push("pendingExpiry");
	return parts.join(" ");
}

const [cmd, ...rest] = args;
if (cmd === "new") {
	const name = rest[0];
	if (!name || !/^[A-Za-z0-9-]{1,20}$/.test(name)) throw new Error("new <name> (letters, digits, dashes)");
	const product = value("--product", "test-sticker");
	const s = load();
	if (s.invoices[name]) throw new Error(`${name} already recorded`);
	const res = await fetch(route("checkout"), {
		method: "POST",
		headers: { "content-type": "application/json", origin: site.origin },
		body: JSON.stringify({ kind: "product", product }),
	});
	const data = (await res.json()).data;
	if (!data?.token) throw new Error(`checkout failed: HTTP ${res.status} ${JSON.stringify(data ?? {})}`);
	const db = new DatabaseSync(dbPath, { readOnly: true });
	const row = db.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = 'invoices' AND json_extract(data, '$.token') = ?").get(PLUGIN, data.token);
	db.close();
	const inv = row ? JSON.parse(row.data) : {};
	s.invoices[name] = { token: data.token, product, address: data.address, amountAtomic: data.amountAtomic, expiresAt: data.expiresAt, addrIndex: inv.addrIndex, expiresHeight: inv.expiresHeight, required: inv.required, createdAt: stamp(), paidAtomic: "0", parts: [] };
	save(s);
	console.log(`${name}: index ${inv.addrIndex}, ${atomicToXmr(BigInt(data.amountAtomic))} XMR, ${inv.required} confirmations, expires ${data.expiresAt} (height ${inv.expiresHeight})`);
} else if (cmd === "pay-script") {
	const [step, ...specs] = rest;
	if (!step || specs.length === 0) throw new Error("pay-script <step> <name>=<fraction|rest> ...");
	const s = load();
	const payments = specs.map((spec) => {
		const [name, fraction] = spec.split("=");
		const inv = s.invoices[name];
		if (!inv || !fraction) throw new Error(`unknown invoice or missing fraction: ${spec}`);
		return { name, inv, fraction, atomic: partAtomic(inv.amountAtomic, fraction, inv.paidAtomic) };
	});
	const file = `${DATA}/3h-pay-${step}.sh`;
	if (existsSync(file)) throw new Error(`${file} exists already; pick a new step name`);
	writeFileSync(file, payScript(step, payments.map((p) => ({ name: p.name, address: p.inv.address, atomic: p.atomic }))), { mode: 0o644 });
	for (const p of payments) {
		p.inv.parts.push({ step, fraction: p.fraction, atomic: p.atomic.toString(), scriptAt: stamp() });
		p.inv.paidAtomic = (BigInt(p.inv.paidAtomic) + p.atomic).toString();
	}
	save(s);
	for (const p of payments) console.log(`${p.name}: ${atomicToXmr(p.atomic)} XMR (${p.fraction} of ${atomicToXmr(BigInt(p.inv.amountAtomic))})`);
	console.log(`wrote ${file}`);
} else if (cmd === "list") {
	const s = load();
	const reasons = reviewReasons();
	for (const [name, inv] of Object.entries(s.invoices)) {
		console.log(`${name.padEnd(12)} #${String(inv.addrIndex).padEnd(4)} ${describe(await status(inv.token), reasons[inv.token])}`);
	}
} else if (cmd === "watch") {
	const last = {};
	appendFileSync(WATCH, `${stamp()} watch started\n`);
	for (;;) {
		try {
			const s = load();
			const reasons = reviewReasons();
			for (const [name, inv] of Object.entries(s.invoices)) {
				const line = describe(await status(inv.token), reasons[inv.token]);
				if (last[name] !== line) {
					appendFileSync(WATCH, `${stamp()} ${name} #${inv.addrIndex}: ${line}\n`);
					last[name] = line;
				}
			}
		} catch (e) {
			const line = `site unreachable (${e.cause?.code ?? e.message})`;
			if (last.__site !== line) appendFileSync(WATCH, `${stamp()} ${line}\n`);
			last.__site = line;
			await new Promise((r) => setTimeout(r, 15_000));
			continue;
		}
		if (last.__site) appendFileSync(WATCH, `${stamp()} site answering again\n`);
		last.__site = undefined;
		await new Promise((r) => setTimeout(r, 15_000));
	}
} else if (cmd === "drain-pool") {
	const below = Number(value("--below", ""));
	if (!Number.isInteger(below) || below < 1) throw new Error("drain-pool --below <index>");
	const db = new DatabaseSync(dbPath);
	db.exec("PRAGMA busy_timeout = 5000");
	const rows = db.prepare("SELECT id FROM _plugin_storage WHERE plugin_id = ? AND collection = 'pool' AND json_extract(data, '$.status') = 'free' AND json_extract(data, '$.addrIndex') < ?").all(PLUGIN, below);
	const upd = db.prepare("UPDATE _plugin_storage SET data = json_set(data, '$.status', 'claimed'), revision = ?, updated_at = ? WHERE plugin_id = ? AND collection = 'pool' AND id = ? AND json_extract(data, '$.status') = 'free'");
	let n = 0;
	db.exec("BEGIN");
	for (const r of rows) n += upd.run(randomUUID(), new Date().toISOString(), PLUGIN, r.id).changes;
	db.exec("COMMIT");
	const left = db.prepare("SELECT count(*) n, min(json_extract(data, '$.addrIndex')) lo, max(json_extract(data, '$.addrIndex')) hi FROM _plugin_storage WHERE plugin_id = ? AND collection = 'pool' AND json_extract(data, '$.status') = 'free'").get(PLUGIN);
	db.close();
	console.log(`drain-pool: marked ${n} free rows below ${below} claimed; free now ${left.n} (indexes ${left.lo ?? "-"}..${left.hi ?? "-"})`);
} else {
	throw new Error("usage: new | pay-script | list | watch | drain-pool (see the top of this file)");
}
