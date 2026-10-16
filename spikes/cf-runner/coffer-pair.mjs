// THROWAWAY probe (spikes/cf-runner/PLAN.md): does Coffer's pairing sync fit the Cloudflare runner's 10 bridge calls?
//   node spikes/cf-runner/coffer-pair.mjs issue <sql file>         make a pairing code; write the SQL that stores its
//                                                                  hash (the dev-e2e KV shortcut, for D1) and keep the
//                                                                  code in ~/xmr-pay-dev-data/cf-spike/pair-code (600)
//   node spikes/cf-runner/coffer-pair.mjs pair <origin> <addresses> send a signed pairing sync with that many fake
//                                                                  pool addresses from a key made for this run only
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const CODE_FILE = `${homedir()}/xmr-pay-dev-data/cf-spike/pair-code`;
const DIGITS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddress = (index) => {
	let n = index;
	let tail = "";
	for (let i = 0; i < 6; i++, n = Math.floor(n / 58)) tail = DIGITS[n % 58] + tail;
	return `7${"x".repeat(87)}D${tail}`;
};
const [cmd, a, b] = process.argv.slice(2);
if (cmd === "issue") {
	const code = randomBytes(16).toString("base64url");
	const state = JSON.stringify({ codeHash: createHash("sha256").update(code).digest("base64url"), expiresAt: Date.now() + 15 * 60_000, used: false });
	const now = new Date().toISOString();
	const q = (s) => `'${s.replaceAll("'", "''")}'`;
	writeFileSync(a, `INSERT INTO _plugin_storage (plugin_id, collection, id, data, revision, created_at, updated_at) VALUES ('coffer', '__kv', 'state:pairing', ${q(state)}, ${q(randomUUID())}, ${q(now)}, ${q(now)}) ON CONFLICT (plugin_id, collection, id) DO UPDATE SET data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at;\n`);
	writeFileSync(CODE_FILE, `${code}\n`, { mode: 0o600 });
	console.log(`SQL in ${a}; code kept in ${CODE_FILE} (valid 15 minutes)`);
} else if (cmd === "pair") {
	const origin = a;
	const count = Number(b ?? "0");
	const code = readFileSync(CODE_FILE, "utf8").trim();
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
	const body = Buffer.from(JSON.stringify({ v: 1, seq: Date.now(), height: 2_230_700, addresses: Array.from({ length: count }, (_, i) => ({ index: i + 1, address: fakeAddress(i + 1) })), snapshots: [], pair: { code, publicKey: pub } }));
	const ts = String(Math.floor(Date.now() / 1000));
	const sig = sign(null, Buffer.concat([Buffer.from(`${ts}\n`), body]), privateKey).toString("base64");
	const t = Date.now();
	const res = await fetch(`${origin}/_emdash/api/plugins/coffer/bridge/sync`, { method: "POST", headers: { "content-type": "application/json", "x-xmr-ts": ts, "x-xmr-sig": sig }, body });
	console.log(`pair with ${count} addresses: HTTP ${res.status} in ${Date.now() - t} ms: ${(await res.text()).slice(0, 300)}`);
} else throw new Error("issue <sql file> | pair <origin> <addresses>");
