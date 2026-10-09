// Tests for scripts/setup-test-reset.mjs (phase 05), run against throwaway databases in a temp folder.
// Run: node --test scripts/*.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.removeAllListeners("warning"); // node:sqlite's experimental notice
const { DatabaseSync } = await import("node:sqlite");

const SCRIPT = join(import.meta.dirname, "setup-test-reset.mjs");
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A database shaped like the dev site's: Coffer's rows, another plugin's, and site options. */
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "setup-test-reset-"));
	dirs.push(dir);
	const path = join(dir, "data.db");
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE _plugin_storage (plugin_id TEXT, collection TEXT, id TEXT, data TEXT, created_at TEXT, updated_at TEXT, revision TEXT, PRIMARY KEY (plugin_id, collection, id));
		CREATE TABLE options (name TEXT PRIMARY KEY, value TEXT);
		CREATE TABLE _plugin_indexes (plugin_id TEXT, collection TEXT, index_name TEXT, fields TEXT, created_at TEXT);
		CREATE TABLE _emdash_cron_tasks (id TEXT PRIMARY KEY, plugin_id TEXT, task_name TEXT);
		INSERT INTO _plugin_storage VALUES
			('coffer', 'pool', '1', '{}', '', '', '1'), ('coffer', 'invoices', 'inv_1', '{}', '', '', '1'),
			('coffer', '__kv', 'state:setupDone', 'true', '', '', '1'), ('coffer', '__kv', 'state:salt', '"s"', '', '', '1'),
			('other', '__kv', 'state:x', '1', '', '', '1');
		INSERT INTO options VALUES
			('plugin:coffer:settings:bridgePublicKey', '"k"'), ('plugin:coffer:settings:currency', '"EUR"'),
			('plugin:other:settings:a', '1'), ('site:title', '"Shop"');
		INSERT INTO _plugin_indexes VALUES ('coffer', 'invoices', 'status', '["status"]', '');
		INSERT INTO _emdash_cron_tasks VALUES ('t1', 'coffer', 'housekeeping');
	`);
	db.close();
	return { dir, path, backups: join(dir, "baseline") };
}

const count = (path, sql) => {
	const db = new DatabaseSync(path, { readOnly: true });
	const n = db.prepare(sql).get().n;
	db.close();
	return n;
};
const coffer = (path) => count(path, "SELECT count(*) AS n FROM _plugin_storage WHERE plugin_id = 'coffer'") + count(path, "SELECT count(*) AS n FROM options WHERE name LIKE 'plugin:coffer:%'");
/** A port nothing listens on: bind one, note it, close it. */
async function freePort() {
	const s = createServer();
	await new Promise((r) => s.listen(0, "127.0.0.1", r));
	const { port } = s.address();
	await new Promise((r) => s.close(r));
	return port;
}
const run = (args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const fails = (args) => {
	try {
		run(args);
	} catch (e) {
		return String(e.stderr);
	}
	assert.fail("expected the script to fail");
};

test("reset: every Coffer row and setting goes, a full backup first; other plugins, site options, indexes and cron stay", async () => {
	const f = fixture();
	const out = run(["--db", f.path, "--backup-dir", f.backups, "--ports", String(await freePort())]);
	assert.equal(coffer(f.path), 0);
	assert.equal(count(f.path, "SELECT count(*) AS n FROM _plugin_storage WHERE plugin_id = 'other'"), 1);
	assert.equal(count(f.path, "SELECT count(*) AS n FROM options WHERE name IN ('plugin:other:settings:a', 'site:title')"), 2);
	assert.equal(count(f.path, "SELECT count(*) AS n FROM _plugin_indexes"), 1);
	assert.equal(count(f.path, "SELECT count(*) AS n FROM _emdash_cron_tasks"), 1);
	assert.match(out, /removed 4 storage rows \(1 pool, 1 invoices, 2 KV\) and 2 settings/);
	const [backup] = readdirSync(f.backups);
	assert.match(backup, /^data\.db\.before-setup-test-\d{8}T\d{6}\d{3}Z$/);
	assert.equal(coffer(join(f.backups, backup)), 6);
	assert.match(out, new RegExp(`backup: ${join(f.backups, backup).replaceAll(".", "\\.")}`));
});

test("refuses while the site is running (its port answers), and changes nothing", async () => {
	const f = fixture();
	const s = createServer();
	await new Promise((r) => s.listen(0, "127.0.0.1", r));
	try {
		const err = fails(["--db", f.path, "--backup-dir", f.backups, "--ports", `${await freePort()},${s.address().port}`]);
		assert.match(err, /port \d+ answers: stop the dev site and the built copy first/);
	} finally {
		await new Promise((r) => s.close(r));
	}
	assert.equal(coffer(f.path), 6);
	assert.equal(existsSync(f.backups), false);
});

test("restore: the backup comes back whole, and the state it replaces is saved first", async () => {
	const f = fixture();
	const port = String(await freePort());
	run(["--db", f.path, "--backup-dir", f.backups, "--ports", port]);
	const [backup] = readdirSync(f.backups);
	const out = run(["--db", f.path, "--backup-dir", f.backups, "--ports", port, "--restore", join(f.backups, backup)]);
	assert.equal(coffer(f.path), 6);
	assert.equal(count(f.path, "SELECT count(*) AS n FROM options WHERE name = 'site:title'"), 1);
	const saved = readdirSync(f.backups).find((n) => n.includes("before-restore"));
	assert.ok(saved, "the replaced state is saved");
	assert.equal(coffer(join(f.backups, saved)), 0);
	assert.match(out, /restored .*before-setup-test/);
});

test("restore refuses a missing file and a file that isn't a dev-site database", async () => {
	const f = fixture();
	const port = String(await freePort());
	assert.match(fails(["--db", f.path, "--backup-dir", f.backups, "--ports", port, "--restore", join(f.dir, "nope")]), /no such backup/);
	const other = join(f.dir, "other.db");
	new DatabaseSync(other).exec("CREATE TABLE t (x)");
	assert.match(fails(["--db", f.path, "--backup-dir", f.backups, "--ports", port, "--restore", other]), /isn't a dev-site database/);
	assert.equal(coffer(f.path), 6);
});

test("unknown options are refused", () => {
	assert.match(fails(["--everything"]), /usage/);
});
