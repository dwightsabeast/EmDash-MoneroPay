// The admin page's order and the Connect wallet host section (phase 04 click-throughs, decisions.md 2026-10-09): before
// setup, banners, checklist, Connect, Health, Invoices, Settings; after setup, banners, Health, Invoices, Settings, with
// the Connect button out in the open in Settings (round 2, change 3) and the checklist as a closed toggle last.
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
		if (b.type === "accordion") return /^(review|invoice)_/.test(String(b.block_id)) ? [] : [`a:${b.block_id}`];
		if (b.type === "banner") return [String(b.block_id ?? "").startsWith("review_") ? "review" : "banner"];
		return [];
	});
const connectButton = (blocks: B[]): B | undefined => {
	const all = [...blocks, ...blocks.filter((b) => b.type === "accordion").flatMap((b) => b.blocks)];
	return all.find((b) => b.type === "actions" && b.elements.some((e: B) => e.action_id === "connect_wallet_host"))?.elements.find((e: B) => e.action_id === "connect_wallet_host");
};
const WARNING = "A wallet host is already paired. Pairing a new one replaces it, and the current one stops syncing.";
const HINT = "Use this to move, rebuild or replace your wallet host. It creates a one-time code (15 minutes) and the install command.";
const HINT_PAIRED = `${HINT} When the new one pairs, the current wallet host stops syncing.`;
/** Settings, from its header to the end of the page. */
const settings = (blocks: B[]) => blocks.slice(blocks.findIndex((b) => b.type === "header" && b.text === "Settings"));

describe("page order", () => {
	it("before setup, nothing to flag: checklist, Connect, Health, All invoices, Settings", async () => {
		await setup();
		expect(outline(await load())).toEqual(["h:Monero payments", "a:setup", "h:Connect wallet host", "h:Health", "h:All invoices", "h:Settings"]);
	});

	it("before setup, with a red line and a review item: banners first, Needs a decision above All invoices", async () => {
		await setup({ review: true, silent: true });
		expect(outline(await load())).toEqual(["h:Monero payments", "banner", "banner", "a:setup", "h:Connect wallet host", "h:Health", "h:Needs a decision (1)", "review", "h:All invoices", "h:Settings"]);
	});

	it("after setup, nothing to flag: Health first, the checklist as a closed toggle last", async () => {
		await setup({ done: true });
		const b = await load();
		expect(outline(b)).toEqual(["h:Monero payments", "h:Health", "h:All invoices", "h:Settings", "a:setup"]);
		expect(b.at(-1)).toMatchObject({ type: "accordion", block_id: "setup", label: "Setup (complete)", default_open: false });
	});

	it("after setup, with banners and a review item", async () => {
		await setup({ done: true, review: true, silent: true });
		expect(outline(await load())).toEqual(["h:Monero payments", "banner", "banner", "h:Health", "h:Needs a decision (1)", "review", "h:All invoices", "h:Settings", "a:setup"]);
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

	it("before setup, pressing the button shows the code at the top, where the section is", async () => {
		const h = await setup();
		const b = (await h.admin.act("/payments", "connect_wallet_host")).blocks as B[];
		const at = outline(b).indexOf("h:Connect wallet host");
		expect(at).toBe(2);
		expect(b.some((x) => x.type === "code" && String(x.code).startsWith("curl"))).toBe(true);
	});
});

describe("Settings after setup (round 2, change 3)", () => {
	const kinds = (blocks: B[]) => settings(blocks).map((b) => (b.type === "actions" ? `actions:${b.elements.map((e: B) => e.action_id).join(",")}` : b.block_id ? `${b.type}:${b.block_id}` : b.type));

	it("top to bottom: the form and its note, the bridge key and its hint, the button, its hint, the site line, the checklist toggle last", async () => {
		await setup({ done: true });
		const b = await load();
		expect(kinds(b)).toEqual(["header", "form:settings", "context", "fields:bridge_key", "context", "actions:connect_wallet_host", "context", "context", "accordion:setup"]);
		const s = settings(b);
		expect(s[6].text).toBe(HINT_PAIRED);
		expect(s[7].text).toMatch(/^The wallet host will connect to /);
	});

	it("the button is out in the open, not inside a toggle; no warning line above it", async () => {
		await setup({ done: true });
		const b = await load();
		expect(b.find((x) => x.type === "actions" && x.elements.some((e: B) => e.action_id === "connect_wallet_host"))?.elements[0]).toEqual({ type: "button", action_id: "connect_wallet_host", label: "Connect a new wallet host", style: "primary" });
		for (const t of b.filter((x) => x.type === "accordion")) expect(JSON.stringify(t.blocks)).not.toContain("connect_wallet_host");
		expect(JSON.stringify(b)).not.toContain(WARNING);
	});

	it("the hint without a paired host leaves out the line about the current one", async () => {
		await setup({ done: true, paired: false });
		const s = settings(await load());
		const at = s.findIndex((x) => x.type === "actions" && x.elements.some((e: B) => e.action_id === "connect_wallet_host"));
		expect(s[at + 1].text).toBe(HINT);
	});

	it("pressing the button shows the code and the commands directly below it, outside any toggle", async () => {
		const h = await setup({ done: true });
		const b = (await h.admin.act("/payments", "connect_wallet_host")).blocks as B[];
		expect(kinds(b)).toEqual(["header", "form:settings", "context", "fields:bridge_key", "context", "actions:connect_wallet_host", "context", "context", "banner", "code", "context", "code", "accordion:setup"]);
		const s = settings(b);
		expect(s[8]).toMatchObject({ type: "banner", title: "Pairing code ready" });
		expect(String(s[9].code)).toMatch(/^curl /);
		expect(String(s[11].code)).toMatch(/^xmr-bridge install /);
		expect(b.some((x) => x.type === "accordion" && String(x.block_id).startsWith("connect"))).toBe(false);
	});
});
