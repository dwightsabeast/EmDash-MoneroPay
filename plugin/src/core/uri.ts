/**
 * The monero: payment URI, built in one place for checkout, status and the admin page (spec change 32), so the pay
 * page's QR encodes exactly what checkout returned.
 */
import type { Invoice } from "./invoice";
import { atomicToXmr } from "./money";

/** `monero:<address>`, then `tx_amount` (all 12 decimals) and `tx_description` (percent-encoded) when given. */
export function paymentUri(address: string, amountAtomic: bigint | null, description?: string): string {
	const params: string[] = [];
	if (amountAtomic !== null) params.push(`tx_amount=${atomicToXmr(amountAtomic)}`);
	if (description) params.push(`tx_description=${encodeURIComponent(description)}`);
	return params.length > 0 ? `monero:${address}?${params.join("&")}` : `monero:${address}`;
}

/** An invoice's URI: its expected amount, or a tip's floor when it has none; no description if none was stored. */
export function invoiceUri(inv: Pick<Invoice, "subaddress" | "expectedAtomic" | "minAtomic" | "uriDescription">): string {
	const amount = inv.expectedAtomic ?? inv.minAtomic;
	return paymentUri(inv.subaddress, amount !== null ? BigInt(amount) : null, inv.uriDescription);
}
