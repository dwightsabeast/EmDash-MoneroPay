// A fake EmDash runtime for the pay page: `locals.emdash.handlePublicPluginApiRoute`, answering the status route the way
// the plugin does (`{ success: true, data }`, with `{ error: { code } }` inside data for an unknown token).
import type { InvoiceStatus } from "../src/status";

export const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
export const ADDRESS = `7${"Q".repeat(94)}`;
export const URI = `monero:${ADDRESS}?tx_amount=0.080000000000&tx_description=Test%20handbook`;

export function status(o: Partial<InvoiceStatus> = {}): InvoiceStatus {
	return {
		status: "new", confirmations: 0, required: 2, amountAtomic: "80000000000", receivedAtomic: "0",
		expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), settledAt: null, pendingExpiry: false, reconfirming: false,
		kind: "product", address: ADDRESS, uri: URI, fiat: { amountMinor: "1200", currency: "USD" }, minAtomic: null, ...o,
	};
}

export interface Call { pluginId: string; method: string; path: string; url: string }

/** Locals whose handler answers with `reply` (or throws it), recording every call. */
export function locals(reply: unknown, calls: Call[] = [], opts: { throws?: boolean } = {}) {
	return {
		emdash: {
			handlePublicPluginApiRoute: async (pluginId: string, method: string, path: string, request: Request) => {
				calls.push({ pluginId, method, path, url: request.url });
				if (opts.throws) throw new Error("boom");
				return reply;
			},
		},
	};
}

export const ok = (data: unknown) => ({ success: true, data });
export const NOT_FOUND = ok({ error: { code: "INVOICE_NOT_FOUND" } });
