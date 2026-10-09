// Puts the dev site's Coffer back to a freshly installed state for phase 05's setup test, and back again afterwards.
//
//   node scripts/setup-test-reset.mjs                      back up data.db, then remove every Coffer row and setting
//   node scripts/setup-test-reset.mjs --restore <backup>   save the current state, then put the backup back
//   Options: --db <path> (default ~/sites/xmr-dev-site/data.db), --backup-dir <dir> (default
//   ~/xmr-pay-dev-data/baseline), --ports <list> (default 4321,4322: the dev site and the built copy)
//
// The site must be stopped: it keeps the database open and recent writes in data.db-wal. Backups use VACUUM INTO, so
// they hold the WAL's writes too (setup-friction, 2026-10-05). A fresh install has no Coffer rows at all: storage
// (pool, invoices, KV) and the three settings go; the indexes and the cron task are the host's and stay (the plugin
// schedules the cron again on the next admin load).
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

process.removeAllListeners("warning"); // node:sqlite's experimental notice
const { DatabaseSync } = await import("node:sqlite");

const PLUGIN = "coffer";
const args = process.argv.slice(2);
const known = new Set(["--db", "--backup-dir", "--ports", "--restore"]);
const opts = {};
for (let i = 0; i < args.length; i += 2) {
	if (!known.has(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith("--")) {
		console.error("usage: node scripts/setup-test-reset.mjs [--restore <backup>] [--db <path>] [--backup-dir <dir>] [--ports 4321,4322]");
		process.exit(2);
	}
	opts[args[i]] = args[i + 1];
}
const dbPath = opts["--db"] ?? join(homedir(), "sites/xmr-dev-site/data.db");
const backupDir = opts["--backup-dir"] ?? join(homedir(), "xmr-pay-dev-data/baseline");
const ports = (opts["--ports"] ?? "4321,4322").split(",").map(Number);
const fail = (message) => {
	console.error(message);
	process.exit(1);
};

/** True when something accepts connections on the port, on either loopback address (localhost can be ::1 only). */
async function answers(port) {
	for (const host of ["127.0.0.1", "::1"]) {
		const ok = await new Promise((resolve) => {
			const s = connect({ port, host });
			s.once("connect", () => (s.destroy(), resolve(true)));
			s.once("error", () => resolve(false));
		});
		if (ok) return true;
	}
	return false;
}
for (const port of ports) if (!Number.isInteger(port) || (await answers(port))) fail(`port ${port} answers: stop the dev site and the built copy first`);

/** A full copy through SQLite (read-only on the source), to a new file named for what it precedes. */
function backup(what) {
	mkdirSync(backupDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[-:.]/g, "");
	const to = join(backupDir, `data.db.before-${what}-${stamp}`);
	if (existsSync(to)) fail(`${to} exists; run again`);
	const db = new DatabaseSync(dbPath, { readOnly: true });
	db.prepare("VACUUM INTO ?").run(to);
	db.close();
	return to;
}

const looksLikeSite = (path) => {
	const db = new DatabaseSync(path, { readOnly: true });
	const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('_plugin_storage', 'options')").all();
	db.close();
	return names.length === 2;
};

if (!existsSync(dbPath)) fail(`no database at ${dbPath}`);

if (opts["--restore"] !== undefined) {
	const from = opts["--restore"];
	if (!existsSync(from)) fail(`no such backup: ${from}`);
	if (!looksLikeSite(from)) fail(`${from} isn't a dev-site database (no _plugin_storage and options tables)`);
	const saved = backup("restore");
	// The backup is a whole database; the old WAL and shared-memory files belong to the file being replaced.
	for (const ext of ["-wal", "-shm"]) rmSync(dbPath + ext, { force: true });
	copyFileSync(from, dbPath);
	console.log(`restored ${from}\nthe state it replaced: ${saved}`);
} else {
	const saved = backup("setup-test");
	const db = new DatabaseSync(dbPath);
	db.exec("BEGIN");
	const byCollection = db.prepare("SELECT collection, count(*) AS n FROM _plugin_storage WHERE plugin_id = ? GROUP BY collection").all(PLUGIN);
	const rows = db.prepare("DELETE FROM _plugin_storage WHERE plugin_id = ?").run(PLUGIN).changes;
	const settings = db.prepare("DELETE FROM options WHERE name LIKE ?").run(`plugin:${PLUGIN}:settings:%`).changes;
	db.exec("COMMIT");
	db.close();
	const n = (c) => byCollection.find((r) => r.collection === c)?.n ?? 0;
	console.log(`backup: ${saved}`);
	console.log(`removed ${rows} storage rows (${n("pool")} pool, ${n("invoices")} invoices, ${n("__kv")} KV) and ${settings} settings`);
	console.log(`Coffer now looks freshly installed. To put the dev data back: node scripts/setup-test-reset.mjs --restore ${saved}`);
}
