/**
 * GET status?token=... (docs/spec.md, API contracts). Read-only: it evaluates the invoice for display (for example
 * pendingExpiry once the window has closed) but never writes, so it can't race a bridge sync. Expiry happens in syncs.
 */
import type { PluginContext } from "emdash/plugin";

import { basis, evaluate, isOpen, totals } from "./core/invoice";
import { KV, invoices } from "./store";
import type { BridgeState } from "./sync/handle";

export type StatusResponse =
	| {
			status: string;
			confirmations: number;
			required: number;
			amountAtomic: string | null;
			receivedAtomic: string;
			expiresAt: string;
			settledAt: string | null;
			pendingExpiry: boolean;
			reconfirming: boolean;
	  }
	| { error: { code: "INVOICE_NOT_FOUND" } };

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const NOT_FOUND: StatusResponse = { error: { code: "INVOICE_NOT_FOUND" } };

export async function handleStatus(ctx: PluginContext, query: Record<string, unknown>, now: number): Promise<StatusResponse> {
	const token = typeof query.token === "string" ? query.token : "";
	if (!TOKEN.test(token)) return NOT_FOUND;
	const found = await invoices(ctx).query({ where: { token }, limit: 1 });
	const stored = found.items[0]?.data;
	if (!stored) return NOT_FOUND;
	const bridge = await ctx.kv.get<BridgeState>(KV.bridge);
	const inv = evaluate(stored, { now, chainHeight: bridge?.height ?? 0 }).invoice;
	const t = isOpen(inv) ? basis(inv, now) : totals(inv);
	return {
		status: inv.status,
		confirmations: Math.max(0, t.depth),
		required: inv.required,
		amountAtomic: inv.expectedAtomic,
		receivedAtomic: t.received.toString(),
		expiresAt: new Date(inv.expiresAt).toISOString(),
		settledAt: inv.settledAt !== undefined ? new Date(inv.settledAt).toISOString() : null,
		pendingExpiry: Boolean(inv.pendingExpiry),
		reconfirming: inv.reconfirmingSince !== undefined,
	};
}
