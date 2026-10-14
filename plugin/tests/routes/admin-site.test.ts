// The wallet host's site address (spec change 23). EmDash 1.1.0 gives a sandboxed plugin only the address saved at
// site setup (`emdash:site_url`), which is http://localhost:4321 for a site first set up under `astro dev`. The admin
// page then falls back to the admin's own browser origin, https only, on the private admin route only, and says where
// the address came from; a saved https address is never replaced, only warned about when it differs.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { walletHostSite } from "../../src/admin";
import { PUBLIC_KEYS, bytesOf, signedHeaders } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const texts = (blocks: B[]) => JSON.stringify(blocks);
const command = (blocks: B[]) => blocks.find((b) => b.type === "code" && String(b.code).includes("/install.sh"))?.code as string | undefined;
const ADMIN = { id: "u1", email: "admin@example.test", name: "Admin", role: 50 };

/** The admin route as the admin UI calls it, with the request headers the browser would send. */
async function admin(h: PluginRuntimeTestHost, input: unknown, headers: Record<string, string> = {}) {
	const out = (await h.transport.invokeRoute("admin", input, { method: "POST", url: "http://localhost:4322/_emdash/api/plugins/coffer/admin", headers, user: ADMIN } as never)) as B;
	return (out?.data ?? out) as { blocks: B[]; toast?: B };
}
const connect = (h: PluginRuntimeTestHost, headers: Record<string, string> = {}) => admin(h, { type: "block_action", action_id: "connect_wallet_host" }, headers);

describe("walletHostSite: which address the install command uses", () => {
	it("a saved https address is used as is, without a trailing slash", () => {
		expect(walletHostSite("https://shop.example/", undefined)).toEqual({ url: "https://shop.example", source: "saved", saved: "https://shop.example" });
		expect(walletHostSite("https://shop.example", "https://shop.example")).toEqual({ url: "https://shop.example", source: "saved", saved: "https://shop.example" });
	});

	it("a saved https address that differs from the browser's is kept, with a warning naming both", () => {
		expect(walletHostSite("https://old.example", "https://new.example")).toEqual({ url: "https://old.example", source: "saved", saved: "https://old.example", browser: "https://new.example" });
		// A plain-http browser origin isn't a candidate, so there's nothing to warn about.
		expect(walletHostSite("https://shop.example", "http://192.168.1.5:4322")).toEqual({ url: "https://shop.example", source: "saved", saved: "https://shop.example" });
	});

	it("a loopback, plain-http or missing saved address falls back to an https browser origin", () => {
		for (const saved of ["http://localhost:4321", "http://127.0.0.1:4321/", "http://[::1]:4321", "https://localhost", "http://shop.example", "http://192.168.8.249:4322", ""]) {
			expect(walletHostSite(saved, "https://dev.example.com"), saved).toEqual({ url: "https://dev.example.com", source: "browser", saved: saved.replace(/\/$/, "") });
		}
	});

	it("no usable address: no https browser origin, or one on loopback, or one that isn't a bare origin", () => {
		for (const origin of [undefined, "", "null", "http://dev.example.com", "http://localhost:4321", "https://localhost:4321", "https://127.0.0.1", "https://sub.localhost", "https://dev.example.com/path", "https://user@dev.example.com", "not a url"]) {
			expect(walletHostSite("http://localhost:4321", origin), String(origin)).toEqual({ url: null, saved: "http://localhost:4321" });
		}
		expect(walletHostSite("", undefined)).toEqual({ url: null, saved: "" });
	});
});

describe("the admin page with EmDash's saved address on localhost", () => {
	it("Origin reaches the admin route: the command uses the browser's https address and says why", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "http://localhost:4321" } });
		const r = await connect(host, { origin: "https://dev.example.com" });
		expect(r.toast).toMatchObject({ type: "success" });
		expect(command(r.blocks)).toMatch(/--site https:\/\/dev\.example\.com --pair [A-Za-z0-9_-]{22}$/);
		expect(texts(r.blocks)).toContain("The wallet host will connect to https://dev.example.com (from your browser, because EmDash's saved address for this site is http://localhost:4321).");
	});

	it("without an https Origin: a red line, no command and no code", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "http://localhost:4321" } });
		for (const headers of [{}, { origin: "http://localhost:4321" }, { host: "dev.example.com", "x-forwarded-host": "dev.example.com" }] as Record<string, string>[]) {
			const r = await connect(host, headers);
			expect(r.toast, JSON.stringify(headers)).toMatchObject({ type: "error" });
			expect(command(r.blocks)).toBeUndefined();
			expect(r.blocks.find((b) => b.type === "banner" && b.variant === "error" && String(b.description).includes("http://localhost:4321"))).toBeDefined();
		}
		expect(await host.inspect.kv.get("state:pairing")).toBeNull();
	});

	it("a saved https address wins over a different browser origin, with a warning naming both", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "https://shop.example" } });
		const r = await connect(host, { origin: "https://www.shop.example" });
		expect(command(r.blocks)).toContain("--site https://shop.example --pair ");
		const warn = r.blocks.find((b) => b.type === "banner" && b.variant === "alert") as B;
		expect(String(warn.description)).toContain("https://shop.example");
		expect(String(warn.description)).toContain("https://www.shop.example");
		expect(texts(r.blocks)).toContain("The wallet host will connect to https://shop.example (EmDash's saved address for this site).");
	});

	it("the page load (not only the button) uses the same rule", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "http://localhost:4321" } });
		const withOrigin = await admin(host, { type: "page_load", page: "/payments" }, { origin: "https://dev.example.com" });
		expect(texts(withOrigin.blocks)).toContain("The wallet host will connect to https://dev.example.com (from your browser");
		const without = await admin(host, { type: "page_load", page: "/payments" });
		expect(without.blocks.find((b) => b.type === "banner" && b.variant === "error" && String(b.description).includes("http://localhost:4321"))).toBeDefined();
	});
});

describe("F06: spoofed Origin, Host and X-Forwarded-Host change nothing on the public routes", () => {
	const SPOOF = { origin: "https://evil.example", host: "evil.example", "x-forwarded-host": "evil.example" };

	it("status, checkout and bridge/sync replies never carry the spoofed host, and match the unspoofed ones", async () => {
		host = await createPluginRuntimeTestHost({ site: { url: "http://localhost:4321" } });
		const h = host;
		const status = async (headers: Record<string, string>) => (await h.actions.routes.request("status", { method: "GET", url: "https://site.test/_emdash/api/plugins/coffer/status?token=inv_unknown", headers })).text();
		expect(await status(SPOOF)).toBe(await status({}));

		const checkout = async (headers: Record<string, string>) => (await h.actions.routes.request("checkout", { method: "POST", body: { kind: "product", product: "nope" }, headers })).text();
		const spoofedCheckout = await checkout(SPOOF);
		expect(spoofedCheckout).toBe(await checkout({}));
		expect(spoofedCheckout).not.toContain("evil.example");

		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: 3_000_000, addresses: [], snapshots: [], pair: { code: "A".repeat(22), publicKey: PUBLIC_KEYS.test1 } });
		const sync = async (headers: Record<string, string>) => (await h.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: { ...(await signedHeaders(bytes, now)), ...headers } })).text();
		const spoofedSync = await sync(SPOOF);
		expect(spoofedSync).toBe(await sync({}));
		expect(spoofedSync).not.toContain("evil.example");
	});
});
