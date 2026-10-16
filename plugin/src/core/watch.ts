/**
 * Which invoices the bridge keeps reporting (docs/spec.md, `bridge/sync`, "Watch list").
 */
import { FINAL_DEPTH, LATE_WINDOW_MS, TIP_WATCH_MS } from "./constants";
import { type Invoice, isOpen, totals } from "./invoice";

/**
 * Open invoices; expired and review invoices inside the 24-hour late window; settled invoices until their payment is
 * 10 deep (or re-confirming after a reorg), capped at 24 hours after settling so the list can't grow forever.
 *
 * Tips (spec change 33): expired and review tips for 7 days, since a tip is never late. But an untouched tip (nothing
 * ever reported) leaves once the wallet host has reported its address empty for 24 hours past its window, measured by
 * `seq`, the bridge's clock of the newest snapshot applied. During an outage seq doesn't move, so it stays watched; with
 * a healthy host a bot's unpaid tips leave as fast as unpaid products do.
 */
export function isWatched(inv: Invoice, now: number): boolean {
	if (isOpen(inv)) return true;
	if ((inv.status === "expired" || inv.status === "review") && inv.kind === "tip") {
		if (now >= inv.expiresAt + TIP_WATCH_MS) return false;
		return inv.transfers.length > 0 || inv.seq < inv.expiresAt + LATE_WINDOW_MS;
	}
	if (inv.status === "expired" || inv.status === "review") return now < inv.expiresAt + LATE_WINDOW_MS;
	if (inv.status === "settled") {
		if (inv.settledAt === undefined || now >= inv.settledAt + LATE_WINDOW_MS) return false;
		return inv.reconfirmingSince !== undefined || totals(inv).depth < FINAL_DEPTH;
	}
	return false;
}
