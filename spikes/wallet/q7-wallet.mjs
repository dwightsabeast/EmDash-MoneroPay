// Spike Q7: a view-only stagenet shop wallet in monero-wallet-rpc, to see which get_transfers field marks a
// buyer-set time lock. Throwaway (phase 01); never imported by later phases.
//
// monero-wallet-rpc must already be running on 127.0.0.1:38083 (see spikes/wallet/README.md).
// Commands:
//   scripts/with-shop-env.sh node spikes/wallet/q7-wallet.mjs create     (needs SHOP_ADDRESS, SHOP_VIEW_KEY, SHOP_RESTORE_HEIGHT)
//   node spikes/wallet/q7-wallet.mjs status
//   node spikes/wallet/q7-wallet.mjs addresses
//   node spikes/wallet/q7-wallet.mjs transfers
//   scripts/with-shop-env.sh node spikes/wallet/q7-wallet.mjs check-log <log file>
//
// Rules (CLAUDE.md): never print, log or put SHOP_VIEW_KEY on a command line. It only ever travels inside the
// JSON body of one request to wallet-rpc on 127.0.0.1. Nothing printed here is derived from it.
import { readFileSync } from "node:fs";

const RPC = "http://127.0.0.1:38083/json_rpc";
const DAEMON = "http://127.0.0.1:38081/json_rpc";
const WALLET = "q7-shop-view";
const LABELS = ["q7-normal", "q7-timelocked"];

async function rpc(url, method, params = {}) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }),
	});
	const json = await res.json();
	// wallet-rpc error messages never echo request parameters, but print only code and message anyway.
	if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
	return json.result;
}

async function openWallet() {
	try {
		await rpc(RPC, "open_wallet", { filename: WALLET, password: "" });
	} catch (err) {
		if (!String(err.message).includes("already")) throw err;
	}
}

const cmd = process.argv[2];

if (cmd === "create") {
	const { SHOP_ADDRESS, SHOP_VIEW_KEY, SHOP_RESTORE_HEIGHT } = process.env;
	if (!SHOP_ADDRESS || !SHOP_VIEW_KEY || !SHOP_RESTORE_HEIGHT) throw new Error("run through scripts/with-shop-env.sh");
	if (!SHOP_ADDRESS.startsWith("5")) throw new Error("not a stagenet address");
	const result = await rpc(RPC, "generate_from_keys", {
		restore_height: Number(SHOP_RESTORE_HEIGHT),
		filename: WALLET,
		address: SHOP_ADDRESS,
		viewkey: SHOP_VIEW_KEY,
		password: "",
		autosave_current: true,
	});
	console.log(`created view-only wallet "${WALLET}": address matches SHOP_ADDRESS: ${result.address === SHOP_ADDRESS}; info: ${result.info}`);
	console.log(`restore height: ${SHOP_RESTORE_HEIGHT}`);
} else if (cmd === "status") {
	await openWallet();
	const wallet = await rpc(RPC, "get_height");
	const daemon = await rpc(DAEMON, "get_info");
	const view = await rpc(RPC, "query_key", { key_type: "spend_key" }).then(
		(r) => (/^0+$/.test(r.key) ? "view-only (no spend key)" : "HAS A SPEND KEY: stop"),
		() => "view-only (no spend key)",
	);
	console.log(`wallet height ${wallet.height}, daemon height ${daemon.height} (synchronized: ${daemon.synchronized}), ${view}`);
} else if (cmd === "addresses") {
	await openWallet();
	const existing = await rpc(RPC, "get_address", { account_index: 0 });
	for (const label of LABELS) {
		let a = existing.addresses.find((x) => x.label === label);
		if (!a) {
			const made = await rpc(RPC, "create_address", { account_index: 0, label });
			a = { address: made.address, address_index: made.address_index, label };
		}
		console.log(`${label.padEnd(14)} index ${a.address_index}  ${a.address}`);
	}
	await rpc(RPC, "store");
} else if (cmd === "transfers") {
	await openWallet();
	await rpc(RPC, "refresh");
	const height = (await rpc(RPC, "get_height")).height;
	const r = await rpc(RPC, "get_transfers", { in: true, pool: true, account_index: 0 });
	const rows = [...(r.in ?? []).map((t) => ({ ...t, list: "in" })), ...(r.pool ?? []).map((t) => ({ ...t, list: "pool" }))];
	console.log(`wallet height ${height}; ${rows.length} transfer(s)`);
	for (const t of rows) {
		console.log(
			JSON.stringify({
				list: t.list,
				subaddr: t.subaddr_index,
				txid: t.txid,
				amount: t.amount,
				unlock_time: t.unlock_time,
				locked: t.locked,
				height: t.height,
				timestamp: t.timestamp,
				confirmations: t.confirmations,
				double_spend_seen: t.double_spend_seen,
				type: t.type,
			}),
		);
	}
} else if (cmd === "check-log") {
	// Reports only whether the view key appears in the given file; never prints the key or any part of it.
	const key = process.env.SHOP_VIEW_KEY;
	if (!key) throw new Error("run through scripts/with-shop-env.sh");
	const text = readFileSync(process.argv[3], "utf8");
	console.log(`view key present in ${process.argv[3]}: ${text.includes(key)}`);
} else {
	console.error("usage: q7-wallet.mjs create|status|addresses|transfers|check-log <file>");
	process.exitCode = 2;
}
