// Spec change 35 (B, release 1): on an EmDash site hosted on Cloudflare Workers, every bridge call counts toward a fixed
// 10 per invocation, and pairing alone goes over. Coffer detects the Workers runtime (requestMeta.geo, set only from
// Cloudflare's cf object) and answers before touching storage: bridge/sync and checkout with UNSUPPORTED_PLATFORM, the
// admin page with one message. Node sites (geo null) work as before. Through transport.invokeRoute, which passes meta
// straight to the plugin, as on Cloudflare.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const CF = { ip: "203.0.113.7", userAgent: null, referer: null, geo: { country: "US", region: "Colorado", city: "Denver" } };
const NODE = { ip: null, userAgent: null, referer: null, geo: null };

async function setup() {
	const h = await createPluginRuntimeTestHost();
	host = h;
	await h.fixtures.plugin.kv("state:pairing", { codeHash: "x".repeat(43), expiresAt: Date.now() + 600_000, used: false });
	await h.fixtures.plugin.storage("pool", "1", { addrIndex: 1, address: `7${"Q".repeat(94)}`, status: "free" });
	await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	return h;
}
const invoke = (name: string, input: unknown, meta: typeof CF | typeof NODE, extra: Record<string, unknown> = {}) =>
	(host as any).transport.invokeRoute(name, input, { method: "POST", meta, ...extra }) as Promise<B>;
const stored = async (h: PluginRuntimeTestHost) => ({ kv: await h.inspect.kv.list(), pool: await h.inspect.storage.list("pool"), invoices: await h.inspect.storage.list("invoices"), key: await h.inspect.setting("bridgePublicKey") });

describe("Cloudflare Workers: not supported in release 1 (spec change 35)", () => {
	it("bridge/sync answers UNSUPPORTED_PLATFORM before reading or writing anything, even a well-signed pairing", async () => {
		const h = await setup();
		const before = await stored(h);
		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: 3_000_000, addresses: [], snapshots: [], pair: { code: "a".repeat(22), publicKey: PUBLIC_KEYS.test1 } });
		const r = await invoke("bridge/sync", bytes, CF, { headers: await signedHeaders(bytes, now) });
		expect(r).toEqual({ error: { code: "UNSUPPORTED_PLATFORM" } });
		expect(await stored(h)).toEqual(before);
	});

	it("checkout answers UNSUPPORTED_PLATFORM; nothing claimed", async () => {
		const h = await setup();
		const before = await stored(h);
		expect(await invoke("checkout", { kind: "tip" }, CF)).toEqual({ error: { code: "UNSUPPORTED_PLATFORM" } });
		expect(await stored(h)).toEqual(before);
	});

	it("the admin page is one message saying so, and nothing else", async () => {
		const h = await setup();
		const r = await invoke("admin", { type: "page_load", page: "/payments" }, CF);
		const blocks = r.blocks as B[];
		expect(blocks).toEqual([
			{ type: "header", text: "Monero payments" },
			{
				type: "banner",
				variant: "alert",
				title: "Not supported on Cloudflare Workers yet",
				description: "This site runs on Cloudflare Workers. Coffer works on EmDash sites hosted on Node.js; Cloudflare support is planned. Nothing has been set up or stored.",
			},
		]);
		// Any action on that page gets the same answer.
		expect((await invoke("admin", { type: "block_action", action_id: "connect_wallet_host", page: "/payments" }, CF)).blocks).toEqual(blocks);
		expect((await h.inspect.kv.get("state:pairing")) as B).toMatchObject({ used: false });
	});

	it("on Node (no geo) everything works as before", async () => {
		await setup();
		expect(await invoke("checkout", { kind: "tip" }, NODE)).toMatchObject({ status: "new" });
		const page = await invoke("admin", { type: "page_load", page: "/payments" }, NODE);
		expect(JSON.stringify(page.blocks)).not.toContain("Not supported on Cloudflare Workers");
		expect(JSON.stringify(page.blocks)).toContain("Connect wallet host");
	});

	// The guard against an EmDash upgrade (docs/emdash-upgrade-checklist.md): Coffer's detection relies on EmDash
	// leaving requestMeta.geo null off Cloudflare. If an upgrade ever filled it on Node, every Node site would be refused.
	// These go through EmDash's own request handling (actions.routes.request derives requestMeta the real way), not
	// transport.invokeRoute.
	it("through EmDash's own request handling on Node, geo stays null, so Coffer isn't refused", async () => {
		await setup();
		const res = await (host as PluginRuntimeTestHost).actions.routes.request("checkout", { method: "POST", rawBody: JSON.stringify({ kind: "tip" }), headers: { "content-type": "application/json" } });
		expect(((await res.json()) as B).data).toMatchObject({ status: "new" });
	});

	it("nor with the CF-* headers a Node site behind Cloudflare's proxy or a tunnel receives", async () => {
		await setup();
		const headers = { "content-type": "application/json", "cf-ipcountry": "US", "cf-connecting-ip": "203.0.113.9", "cf-ray": "8a1b2c3d4e5f6789-DEN", "cf-visitor": '{"scheme":"https"}' };
		const res = await (host as PluginRuntimeTestHost).actions.routes.request("checkout", { method: "POST", rawBody: JSON.stringify({ kind: "tip" }), headers });
		expect(((await res.json()) as B).data).toMatchObject({ status: "new" });
	});
});

