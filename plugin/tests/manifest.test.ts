// The trust contract an operator consents to (docs/spec.md, "Plugin manifest"; CLAUDE.md, "Plugin trust contract (frozen)").
// Any change here is a stop point for Wyatt: update this test only together with the spec.
import { afterEach, expect, it } from "vitest";

import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";

let host: PluginTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

it("the built manifest matches the spec's trust contract exactly", async () => {
	host = await createPluginTestHost();
	const m = host.manifest as unknown as Record<string, any>;
	expect(m.id).toBe("xmr-pay");
	expect(m.capabilities).toEqual(["content:read", "network:request"]);
	expect(m.allowedHosts).toEqual(["api.coingecko.com", "api.kraken.com"]);
	expect(m.storage).toEqual({
		pool: { indexes: ["status"], uniqueIndexes: ["addrIndex"] },
		invoices: { indexes: ["status", "expiresAt", ["kind", "createdAt"]], uniqueIndexes: ["token", "subaddress"] },
	});
	expect(m.admin).toMatchObject({
		pages: [{ path: "/payments", label: "Monero payments" }],
		widgets: [{ id: "xmr-status", title: "Monero payments", size: "half" }],
	});
	// Session 2a has only the private admin route; 2c-2d add checkout, status and bridge/sync, nothing else.
	const routes = (m.routes ?? []).map((r: any) => ({ name: r.name ?? r, public: r.public ?? false }));
	expect(routes).toEqual([{ name: "admin", public: false }]);
});

it("the admin page and the xmr-status widget load through the host's admin path", async () => {
	const { createPluginRuntimeTestHost } = await import("@emdash-cms/plugin-test");
	const runtime = await createPluginRuntimeTestHost();
	try {
		const page = await runtime.admin.loadPage("/payments");
		const widget = await runtime.admin.loadWidget("xmr-status");
		expect(page.blocks[0]).toMatchObject({ type: "header", text: "Monero payments" });
		expect(widget.blocks.length).toBeGreaterThan(0);
	} finally {
		await runtime.dispose();
	}
});
