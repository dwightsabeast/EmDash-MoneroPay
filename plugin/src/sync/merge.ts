/**
 * Applying one snapshot to an invoice (pure): seq ordering, keeping what the plugin learned about each txid,
 * overwriting the transfer list, then the lifecycle rules.
 */
import { type Evaluation, type Invoice, type Transfer, evaluate } from "../core/invoice";
import type { RawTransfer } from "./protocol";

export type MergeResult = { applied: false } | ({ applied: true } & Evaluation);

/**
 * Snapshots overwrite: the transfers in this snapshot become the invoice's transfers. A snapshot whose seq is not newer
 * than the invoice's is ignored (a replay, or a slower retry). `now` is the plugin's clock; `chainHeight` the sync's height.
 */
export function mergeSnapshot(inv: Invoice, raw: RawTransfer[], at: { seq: number; now: number; chainHeight: number }): MergeResult {
	if (at.seq <= inv.seq) return { applied: false };
	const known = new Map(inv.transfers.map((t) => [t.txid, t]));
	const transfers: Transfer[] = raw.map((t) => {
		const k = known.get(t.txid);
		return {
			txid: t.txid,
			amountAtomic: t.amount,
			confirmations: t.confirmations,
			height: t.height,
			timestamp: t.timestamp,
			doubleSpendSeen: t.doubleSpendSeen,
			unlockTime: t.unlockTime,
			seenAt: k?.seenAt ?? at.now,
			// The wallet's time from the first report while unmined; kept once set.
			poolTs: k?.poolTs ?? (t.height === 0 ? t.timestamp : null),
		};
	});
	return { applied: true, ...evaluate({ ...inv, transfers, seq: at.seq }, { now: at.now, chainHeight: at.chainHeight }) };
}
