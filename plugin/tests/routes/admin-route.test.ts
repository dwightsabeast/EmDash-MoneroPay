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

type B = Record<string, any>;
const find = (blocks: B[], pred: (b: B) => boolean) => blocks.find(pred);
const texts = (blocks: B[]) => JSON.stringify(blocks);
const codeFrom = (blocks: B[]) => {
	const cmd = find(blocks, (b) => b.type === "code" && String(b.code).startsWith("curl"))?.code as string | undefined;
	return cmd?.match(/--pair ([A-Za-z0-9_-]{22})$/)?.[1];
};

describe("admin page", () => {
	it("loads with status, Connect wallet host and the settings form (defaults USD, Standard)", async () => {
		host = await createPluginRuntimeTestHost();
		const page = await host.admin.loadPage("/payments");
		const b = page.blocks as B[];
		expect(b[0]).toEqual({ type: "header", text: "Monero payments" });
		expect(find(b, (x) => x.type === "fields")?.fields).toEqual([
			{ label: "Wallet host", value: "Not paired" },
			{ label: "Last sync", value: "Never" },
			{ label: "Free addresses", value: "0 of 50" },
		]);
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
		host = await createPluginRuntimeTestHost();
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
		host = await createPluginRuntimeTestHost();
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
		expect(JSON.stringify(await host.inspect.kv.list())).not.toContain(code as string); // the code itself is never stored

		// A reload doesn't show the code again; pressing the button again replaces it.
		const reload = await host.admin.loadPage("/payments");
		expect(codeFrom(reload.blocks as B[])).toBeUndefined();
		expect(texts(reload.blocks as B[])).toContain("A pairing code is active until");
		const second = codeFrom((await host.admin.act("/payments", "connect_wallet_host")).blocks as B[]);
		expect(second).not.toBe(code);
		expect(((await host.inspect.kv.get<{ codeHash: string }>("state:pairing")) as { codeHash: string }).codeHash).toBe(await hashPairingCode(second as string));
	});

	it("the code from the page pairs a bridge; the page then shows it paired and asks before replacing it", async () => {
		host = await createPluginRuntimeTestHost();
		const code = codeFrom((await host.admin.act("/payments", "connect_wallet_host")).blocks as B[]);
		const now = Date.now();
		const bytes = bytesOf({ v: 1, seq: now, height: 3_000_000, addresses: [], snapshots: [], pair: { code, publicKey: PUBLIC_KEYS.test1 } });
		const res = await host.actions.routes.request("bridge/sync", { method: "POST", rawBody: bytes, headers: await signedHeaders(bytes, now) });
		expect(((await res.json()) as B).data).toMatchObject({ ok: true });
		const page = (await host.admin.loadPage("/payments")).blocks as B[];
		expect(find(page, (x) => x.type === "fields")?.fields[0]).toEqual({ label: "Wallet host", value: "Paired" });
		const button = find(page, (x) => x.type === "actions")?.elements[0];
		expect(button).toMatchObject({ label: "Connect a new wallet host", confirm: { confirm: "Create a code" } });
	});

	it("warns when the wallet host is silent or outdated, on the page and in the widget", async () => {
		host = await createPluginRuntimeTestHost();
		expect(texts((await host.admin.loadWidget("xmr-status")).blocks as B[])).toContain("Not set up");
		await host.fixtures.plugin.setting("bridgePublicKey", PUBLIC_KEYS.test1);
		await host.fixtures.plugin.kv("state:bridge", { height: 3_000_000, lastSyncAt: Date.now() - 12 * 60_000, version: 1, outdated: true });
		const page = (await host.admin.loadPage("/payments")).blocks as B[];
		expect(find(page, (x) => x.type === "banner" && x.variant === "alert")).toMatchObject({ title: "Wallet host silent for 12 min" });
		expect(find(page, (x) => x.type === "banner" && String(x.title).includes("update"))).toBeDefined();
		expect(texts((await host.admin.loadWidget("xmr-status")).blocks as B[])).toContain("Wallet host silent");
		await host.fixtures.plugin.kv("state:bridge", { height: 3_000_000, lastSyncAt: Date.now() - 30_000, version: 1, outdated: false });
		const healthy = (await host.admin.loadPage("/payments")).blocks as B[];
		expect(find(healthy, (x) => x.type === "banner")).toBeUndefined();
		expect(texts((await host.admin.loadWidget("xmr-status")).blocks as B[])).toContain("Healthy");
	});

	it("an unknown action gets an error toast, not a crash", async () => {
		host = await createPluginRuntimeTestHost();
		const r = await host.admin.act("/payments", "delete_everything");
		expect(r.toast).toMatchObject({ type: "error" });
	});
});
