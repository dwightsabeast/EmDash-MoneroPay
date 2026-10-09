// The minimal admin route through the runtime host's admin helpers (which also validate Block Kit responses).
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { INSTALL_URL } from "../../src/admin";
import { PAIRING_TTL_MS, hashPairingCode } from "../../src/sync/pairing";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

/** A host with one good price response per currency queued: the page checks the price feed (then caches it a minute). */
async function newHost() {
	const h = await createPluginRuntimeTestHost();
	for (const c of ["USD", "EUR"]) {
		await h.http.respond(`https://api.kraken.com/0/public/Ticker?pair=XMR${c}`, new Response(JSON.stringify({ error: [], result: { [`XXMRZ${c}`]: { c: ["150.00", "1.0"] } } })));
	}
	return h;
}

type B = Record<string, any>;
const find = (blocks: B[], pred: (b: B) => boolean) => blocks.find(pred);
const texts = (blocks: B[]) => JSON.stringify(blocks);
const codeFrom = (blocks: B[]) => {
	const cmd = find(blocks, (b) => b.type === "code" && String(b.code).startsWith("curl"))?.code as string | undefined;
	return cmd?.match(/--pair ([A-Za-z0-9_-]{22})$/)?.[1];
};

describe("admin page", () => {
	it("loads with status, Connect wallet host and the settings form (defaults USD, Standard)", async () => {
		host = await newHost();
		const page = await host.admin.loadPage("/payments");
		const b = page.blocks as B[];
		expect(b[0]).toEqual({ type: "header", text: "Monero payments" });
		const health = find(b, (x) => x.type === "fields" && x.block_id === "health")?.fields as B[];
		expect(health.slice(0, 2)).toEqual([
			{ label: "Wallet host", value: "Not paired" },
			{ label: "Last sync", value: "Never" },
		]);
		expect(find(b, (x) => x.type === "meter")).toMatchObject({ label: "Payment addresses ready", custom_value: "0 of 50" });
		const button = find(b, (x) => x.type === "actions")?.elements[0];
		expect(button).toMatchObject({ action_id: "connect_wallet_host", label: "Connect wallet host" });
		expect(button.confirm).toBeUndefined();
		const form = find(b, (x) => x.type === "form") as B;
		expect(form.fields.map((f: B) => [f.action_id, f.initial_value, f.options.map((o: B) => o.value)])).toEqual([
			["currency", "USD", ["USD", "EUR"]],
			["speed", "standard", ["fast", "standard", "strict"]],
		]);
	});

	it("saves valid settings and refuses anything else", async () => {
		host = await newHost();
		const ok = await host.admin.submit("/payments", "save_settings", { currency: "EUR", speed: "strict" });
		expect(ok.toast).toMatchObject({ type: "success" });
		expect(await host.inspect.setting("currency")).toBe("EUR");
		expect(await host.inspect.setting("speed")).toBe("strict");
		const form = find(ok.blocks as B[], (x) => x.type === "form") as B;
		expect(form.fields.map((f: B) => f.initial_value)).toEqual(["EUR", "strict"]);

		for (const values of [{ currency: "GBP", speed: "fast" }, { currency: "USD", speed: "instant" }, {}, { currency: "USD" }]) {
			const bad = await host.admin.submit("/payments", "save_settings", values);
			expect(bad.toast).toMatchObject({ type: "error" });
		}
		expect(await host.inspect.setting("currency")).toBe("EUR");
	});

	it("Connect wallet host shows a one-time code and the install command, storing only its hash", async ({ task }) => {
		host = await newHost();
		const before = Date.now();
		const r = await host.admin.act("/payments", "connect_wallet_host");
		const blocks = r.blocks as B[];
		Object.assign(task.meta, { blocks });
		const code = codeFrom(blocks);
		expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const cmd = (find(blocks, (x) => x.type === "code" && String(x.code).startsWith("curl")) as B).code as string;
		expect(cmd).toBe(`curl -fsSL ${INSTALL_URL} | sh -s -- --site ${cmd.split("--site ")[1].split(" ")[0]} --pair ${code}`);
		expect(texts(blocks)).toContain(`xmr-bridge install --site`);
		const state = (await host.inspect.kv.get<{ codeHash: string; expiresAt: number; used: boolean }>("state:pairing")) as { codeHash: string; expiresAt: number; used: boolean };
		expect(state.codeHash).toBe(await hashPairingCode(code as string));
		expect(state.used).toBe(false);
		expect(state.expiresAt - before).toBeGreaterThanOrEqual(PAIRING_TTL_MS);
		// The code itself is stored nowhere: not in KV, settings or storage (only returned once in this response).
		expect(JSON.stringify(await host.inspect.kv.list())).not.toContain(code as string);
		for (const key of ["bridgePublicKey", "currency", "speed"]) expect(JSON.stringify(await host.inspect.setting(key))).not.toContain(code as string);
		for (const col of ["pool", "invoices"]) expect(JSON.stringify(await host.inspect.storage.list(col))).not.toContain(code as string);
		expect(JSON.stringify(r.toast)).not.toContain(code as string);

		// A reload doesn't show the code again; pressing the button again replaces it.
		const reload = await host.admin.loadPage("/payments");
		expect(codeFrom(reload.blocks as B[])).toBeUndefined();
		expect(texts(reload.blocks as B[])).toContain("A pairing code is active until");
		const second = codeFrom((await host.admin.act("/payments", "connect_wallet_host")).blocks as B[]);
		expect(second).not.toBe(code);
		expect(((await host.inspect.kv.get<{ codeHash: string }>("state:pairing")) as { codeHash: string }).codeHash).toBe(await hashPairingCode(second as string));
	});

	it("the code from the page pairs a bridge; the page then shows it paired and asks before replacing it", async () => {
		host = await newHost();
		const code = codeFrom((await host.admin.act("/payments", "connect_wallet_host")).blocks as B[]);
		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: 3_000_000, addresses: [], snapshots: [], pair: { code, publicKey: PUBLIC_KEYS.test1 } });
		const res = await host.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
		expect(((await res.json()) as B).data).toMatchObject({ ok: true });
		const page = (await host.admin.loadPage("/payments")).blocks as B[];
		expect(find(page, (x) => x.type === "fields" && x.block_id === "health")?.fields[0]).toEqual({ label: "Wallet host", value: "Paired" });
		const button = find(page, (x) => x.type === "actions")?.elements[0];
		expect(button).toMatchObject({ label: "Connect a new wallet host", confirm: { confirm: "Create a code" } });
	});

	it("warns when the wallet host is silent or outdated, on the page and in the widget", async () => {
		host = await newHost();
		expect(texts((await host.admin.loadWidget("xmr-status")).blocks as B[])).toContain("Not set up");
		await host.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
		await host.fixtures.plugin.kv("state:bridge", { height: 3_000_000, lastSyncAt: Date.now() - 12 * 60_000, version: 1, outdated: true });
		const page = (await host.admin.loadPage("/payments")).blocks as B[];
		expect(find(page, (x) => x.type === "banner" && x.variant === "error")).toMatchObject({ title: "Wallet host silent for 12 min" });
		expect(find(page, (x) => x.type === "banner" && String(x.title).includes("update"))).toBeDefined();
		expect(texts((await host.admin.loadWidget("xmr-status")).blocks as B[])).toContain("Wallet host silent");
		await host.fixtures.plugin.kv("state:bridge", { height: 3_000_000, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
		await host.fixtures.plugin.storage("pool", "1", { addrIndex: 1, address: `7${"D".repeat(94)}`, status: "free" });
		const healthy = (await host.admin.loadPage("/payments")).blocks as B[];
		expect(find(healthy, (x) => x.type === "banner" && /silent|update/.test(String(x.title)))).toBeUndefined();
		expect(texts((await host.admin.loadWidget("xmr-status")).blocks as B[])).toContain("Healthy");
	});

	it("an unknown action gets an error toast, not a crash", async () => {
		host = await newHost();
		const r = await host.admin.act("/payments", "delete_everything");
		expect(r.toast).toMatchObject({ type: "error" });
	});
});

describe("pairing codes and the site URL", () => {
	async function pairWith(h: PluginRuntimeTestHost, code: string | undefined) {
		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: 3_000_000, addresses: [], snapshots: [], pair: { code, publicKey: PUBLIC_KEYS.test1 } });
		const res = await h.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
		return ((await res.json()) as B).data;
	}

	it("a new code cancels the old one at once", async () => {
		host = await newHost();
		const first = codeFrom((await host.admin.act("/payments", "connect_wallet_host")).blocks as B[]);
		const second = codeFrom((await host.admin.act("/payments", "connect_wallet_host")).blocks as B[]);
		expect(await pairWith(host, first)).toEqual({ error: { code: "PAIRING_REJECTED" } });
		expect(await host.inspect.setting("bridgePublicKey")).toBeNull();
		expect(await pairWith(host, second)).toMatchObject({ ok: true });
	});

	it("the install command uses the configured site URL, not the request's host, and says which address it is", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "https://shop.example" } });
		const blocks = (await host.admin.act("/payments", "connect_wallet_host")).blocks as B[];
		const cmd = (find(blocks, (x) => x.type === "code" && String(x.code).startsWith("curl")) as B).code as string;
		expect(cmd).toContain("--site https://shop.example --pair ");
		expect(texts(blocks)).toContain("The wallet host will connect to https://shop.example.");
	});

	it("with no site URL, no command is shown and no code is created", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "" } });
		const r = await host.admin.act("/payments", "connect_wallet_host");
		expect(r.toast).toMatchObject({ type: "error" });
		expect(codeFrom(r.blocks as B[])).toBeUndefined();
		expect(find(r.blocks as B[], (x) => x.type === "banner" && x.title === "Your site's address isn't known")).toMatchObject({ variant: "error" });
		expect(await host.inspect.kv.get("state:pairing")).toBeNull();
	});
});

