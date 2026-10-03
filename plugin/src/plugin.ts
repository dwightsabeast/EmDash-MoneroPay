import { type PluginContext, type SandboxedPlugin, pluginRoute } from "emdash/plugin";

import type { InvoiceEvent } from "./core/invoice";
import { ensureCron, purgeBatch } from "./housekeeping";
import { CtxSyncStore, KV, deletePluginData } from "./store";
import { handleSync } from "./sync/handle";
import { MAX_BODY_BYTES } from "./sync/protocol";

/**
 * xmr-pay: Monero payments for EmDash (docs/spec.md). The trust contract is pinned by tests/manifest.test.ts.
 */

// Block Kit as plain JSON (CLAUDE.md, "Dependency tiers": no @emdash-cms/blocks at runtime).
const PLACEHOLDER_BLOCKS = [
	{ type: "header", text: "Monero payments" },
	{ type: "context", text: "Setup isn't available yet: this plugin is in development (phase 02)." },
];

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
					await recordEvents(ctx, out.events, now);
					await purgeBatch(ctx, now);
				}
				return out.response;
			},
		}),
		// The private admin route serves the admin page (/payments) and the xmr-status widget.
		// Session 2e adds settings and Connect wallet host; phase 04 builds the full page.
		admin: {
			methods: ["POST"],
			permission: "plugins:manage",
			handler: async (_routeCtx, ctx) => {
				// Config-managed installs get neither plugin:install nor plugin:activate, so the first admin page load
				// schedules the backup cron (spec change 2).
				if (!(await ctx.kv.get<boolean>(KV.cronScheduled))) await ensureCron(ctx);
				return { blocks: PLACEHOLDER_BLOCKS };
			},
		},
	},
};

export default plugin;
