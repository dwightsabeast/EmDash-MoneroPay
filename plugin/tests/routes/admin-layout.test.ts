// The admin page's order and the Connect wallet host section (phase 04 click-through, Wyatt's notes changes 1 to 3,
// decisions.md 2026-10-09): before setup, banners, checklist, Connect, Health, Invoices, Settings; after setup, banners,
// Health, Invoices, Settings, with the checklist and Connect as closed toggles in Settings.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { newInvoice } from "../../src/core/invoice";
import { PUBLIC_KEYS } from "../sync/helpers";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type B = Record<string, any>;
const H0 = 3_000_000;
const ADDR = (i: number) => `7${String(i).padStart(94, "H")}`;

async function setup(o: { done?: boolean; paired?: boolean; review?: boolean; silent?: boolean } = {}) {
	const h = await createPluginRuntimeTestHost();
	host = h;
	if (o.paired !== false) {
		await h.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
		await h.fixtures.plugin.kv("state:bridge", { height: H0, lastSyncAt: Date.now() - (o.silent ? 12 * 60_000 : 30_000), version: 1, outdated: false });
	}
	for (let i = 1; i <= 3; i++) await h.fixtures.plugin.storage("pool", String(i), { addrIndex: i, address: ADDR(i), status: "free" });
	if (o.done) await h.fixtures.plugin.kv("state:setupDone", true);
	if (o.review) {
		const inv = newInvoice({ id: "inv_r", token: "r".repeat(22), kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: ADDR(9), addrIndex: 9, now: Date.now() - 3_600_000, chainHeight: H0 });
		await h.fixtures.plugin.storage("invoices", inv.id, { ...inv, status: "review", reviewReason: "reversed" });
	}
	await h.http.respond("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", new Response(JSON.stringify({ error: [], result: { XXMRZUSD: { c: ["150.00", "1.0"] } } })));
	return h;
}

const load = async () => (await (host as PluginRuntimeTestHost).admin.loadPage("/payments")).blocks as B[];
/** The page's outline: headers, toggles, and banners (review items as "review", the rest as "banner"). */
const outline = (blocks: B[]) =>
	blocks.flatMap((b) => {
		if (b.type === "header") return [`h:${b.text}`];
		if (b.type === "accordion") return String(b.block_id).startsWith("review_") ? [] : [`a:${b.block_id}`];
		if (b.type === "banner") return [String(b.block_id ?? "").startsWith("review_") ? "review" : "banner"];
		return [];
	});
const connectButton = (blocks: B[]): B | undefined => {
	const all = [...blocks, ...blocks.filter((b) => b.type === "accordion").flatMap((b) => b.blocks)];
	return all.find((b) => b.type === "actions" && b.elements.some((e: B) => e.action_id === "connect_wallet_host"))?.elements.find((e: B) => e.action_id === "connect_wallet_host");
};
const WARNING = "A wallet host is already paired. Pairing a new one replaces it, and the current one stops syncing.";

describe("page order", () => {
	it("before setup, nothing to flag: checklist, Connect, Health, All invoices, Settings", async () => {
		await setup();
		expect(outline(await load())).toEqual(["h:Monero payments", "a:setup", "h:Connect wallet host", "h:Health", "h:All invoices", "h:Settings"]);
	});

	it("before setup, with a red line and a review item: banners first, Needs a decision above All invoices", async () => {
		await setup({ review: true, silent: true });
		expect(outline(await load())).toEqual(["h:Monero payments", "banner", "banner", "a:setup", "h:Connect wallet host", "h:Health", "h:Needs a decision (1)", "review", "h:All invoices", "h:Settings"]);
	});

	it("after setup, nothing to flag: Health first, the checklist and Connect as toggles in Settings", async () => {
		await setup({ done: true });
		const b = await load();
		expect(outline(b)).toEqual(["h:Monero payments", "h:Health", "h:All invoices", "h:Settings", "a:setup", "a:connect"]);
		expect(b.find((x) => x.block_id === "setup")).toMatchObject({ label: "Setup (complete)", default_open: false });
		expect(b.find((x) => x.block_id === "connect")).toMatchObject({ label: "Connect a new wallet host", default_open: false });
	});

	it("after setup, with banners and a review item", async () => {
		await setup({ done: true, review: true, silent: true });
		expect(outline(await load())).toEqual(["h:Monero payments", "banner", "banner", "h:Health", "h:Needs a decision (1)", "review", "h:All invoices", "h:Settings", "a:setup", "a:connect"]);
	});
});

describe("Connect wallet host", () => {
	it("no confirmation dialog; the warning line only when a host is paired", async () => {
		await setup();
		let b = await load();
		expect(connectButton(b)).toEqual({ type: "button", action_id: "connect_wallet_host", label: "Connect a new wallet host", style: "primary" });
		expect(JSON.stringify(b)).toContain(WARNING);
		await host?.dispose();
		await setup({ paired: false });
		b = await load();
		expect(connectButton(b)).toEqual({ type: "button", action_id: "connect_wallet_host", label: "Connect wallet host", style: "primary" });
		expect(JSON.stringify(b)).not.toContain(WARNING);
	});

	it("after setup, the warning sits inside the toggle, above the button", async () => {
		await setup({ done: true });
		const inner = (await load()).find((x) => x.block_id === "connect")?.blocks as B[];
		const warn = inner.findIndex((x) => x.type === "context" && x.text === WARNING);
		const button = inner.findIndex((x) => x.type === "actions");
		expect(warn).toBeGreaterThan(-1);
		expect(warn).toBeLessThan(button);
	});

	it("before setup, pressing the button shows the code at the top, where the section is", async () => {
		const h = await setup();
		const b = (await h.admin.act("/payments", "connect_wallet_host")).blocks as B[];
		const at = outline(b).indexOf("h:Connect wallet host");
		expect(at).toBe(2);
		expect(b.some((x) => x.type === "code" && String(x.code).startsWith("curl"))).toBe(true);
	});

	it("after setup, pressing the button opens the toggle by itself with the code inside", async () => {
		const h = await setup({ done: true });
		const b = (await h.admin.act("/payments", "connect_wallet_host")).blocks as B[];
		const toggle = b.find((x) => x.type === "accordion" && String(x.block_id).startsWith("connect")) as B;
		// A new block_id while a code shows: the host keeps a toggle's open state per block_id, so this one starts open.
		expect(toggle).toMatchObject({ block_id: "connect_code", label: "Connect a new wallet host", default_open: true });
		expect(toggle.blocks.some((x: B) => x.type === "code" && String(x.code).startsWith("curl"))).toBe(true);
		expect(b.some((x) => x.type === "code")).toBe(false);
		// The next load shows the closed toggle again (the code is shown once).
		expect((await load()).find((x) => x.type === "accordion" && String(x.block_id).startsWith("connect"))).toMatchObject({ block_id: "connect", default_open: false });
	});
});
