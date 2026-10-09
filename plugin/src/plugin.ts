import { type PluginContext, type SandboxedPlugin, pluginRoute } from "emdash/plugin";

import type { InvoiceEvent } from "./core/invoice";
import { handleAdmin } from "./admin";
import { handleCheckout } from "./checkout";
import { ensureCron, purgeBatch } from "./housekeeping";
import { handleStatus } from "./status";
import { CtxSyncStore, KV, deletePluginData } from "./store";
import { handleSync } from "./sync/handle";
import { MAX_BODY_BYTES } from "./sync/protocol";

/**
 * Coffer: Monero payments for EmDash (docs/spec.md). The trust contract is pinned by tests/manifest.test.ts.
 */

const MAX_ALERTS = 100;

/** Status changes go to the log; alerts are kept (bounded) for the admin page. */
async function recordEvents(ctx: PluginContext, events: Array<{ invoiceId: string; event: InvoiceEvent }>, now: number) {
	const alerts: Array<{ invoiceId: string; kind: string; at: number }> = [];
	for (const { invoiceId, event } of events) {
		if (event.type === "status") ctx.log.info("invoice status", { invoiceId, from: event.from, to: event.to, reason: event.reason });
		if (event.type === "alert") alerts.push({ invoiceId, kind: event.kind, at: now });
	}
	if (alerts.length > 0) {
		const existing = (await ctx.kv.get<typeof alerts>(KV.alerts)) ?? [];
		await ctx.kv.set(KV.alerts, [...existing, ...alerts].slice(-MAX_ALERTS));
	}
}

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": async (_event, ctx) => ensureCron(ctx),
		"plugin:activate": async (_event, ctx) => ensureCron(ctx),
		cron: async (_event, ctx) => {
			await purgeBatch(ctx, Date.now());
		},
		"plugin:uninstall": async (event, ctx) => {
			if (event.deleteData) await deletePluginData(ctx);
		},
	},
	routes: {
		"bridge/sync": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "bytes", headers: ["x-xmr-ts", "x-xmr-sig"], maxBytes: MAX_BODY_BYTES },
			handler: async (routeCtx, ctx) => {
				const now = Date.now();
				const out = await handleSync({ body: routeCtx.input, headers: routeCtx.request.headers, now }, new CtxSyncStore(ctx));
				if ("ok" in out.response) {
					// For the admin page: when the wallet host paired, and whether it replaced an earlier one.
					if (out.paired) await ctx.kv.set(KV.lastPairing, { at: now, replaced: out.replaced === true });
					await recordEvents(ctx, out.events, now);
					await purgeBatch(ctx, now);
				}
				return out.response;
			},
		}),
		checkout: pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "json", maxBytes: 4096 },
			handler: async (routeCtx, ctx) => {
				const meta = routeCtx.requestMeta as { ip?: string | null } | undefined;
				return handleCheckout(ctx, routeCtx.input, typeof meta?.ip === "string" ? meta.ip : null, Date.now());
			},
		}),
		status: pluginRoute({
			public: true,
			methods: ["GET"],
			cacheControl: "private, no-store",
			request: { body: "none" },
			handler: async (routeCtx, ctx) => handleStatus(ctx, routeCtx.input, Date.now()),
		}),
		// The private admin route serves the admin page (/payments) and the xmr-status widget (src/admin.ts).
		admin: {
			methods: ["POST"],
			permission: "plugins:manage",
			handler: async (routeCtx, ctx) => handleAdmin(ctx, routeCtx.input, Date.now()),
		},
	},
};

export default plugin;
