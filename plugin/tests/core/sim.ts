// A small chain-and-bridge simulator for the pure core's tests: a clock, 2-minute blocks, the buyer's transactions,
// reorgs, and the snapshots a bridge would send. It builds Transfer records the way bridge/sync will (seenAt, poolTs).
import type { Speed } from "../../src/core/constants";
import { type Invoice, type InvoiceEvent, type InvoiceKind, type Transfer, evaluate, newInvoice } from "../../src/core/invoice";

export const BLOCK_MS = 120_000;
export const T0 = Date.parse("2026-10-01T11:00:00Z");
export const H0 = 3_000_000;
export const RATE = 15000n; // $150.00 per XMR

interface Tx {
	txid: string;
	amount: bigint;
	/** When the wallet first saw it (ms); null while the wallet host is offline. */
	walletSeenAt: number | null;
	minedHeight: number;
	minedAt: number;
	doubleSpendSeen: boolean;
	unlockTime: string;
	gone: boolean;
}

export class Sim {
	now = T0;
	height = H0;
	inv: Invoice;
	events: InvoiceEvent[] = [];
	walletOnline = true;
	private txs: Tx[] = [];
	private known = new Map<string, { seenAt: number; poolTs: number | null }>();
	private n = 0;

	constructor(opts: { kind?: InvoiceKind; fiatMinor?: bigint | null; speed?: Speed; startMs?: number } = {}) {
		this.now += opts.startMs ?? 0;
		this.inv = newInvoice({
			id: "inv_test",
			token: "tok",
			kind: opts.kind ?? "product",
			fiatMinor: opts.fiatMinor === undefined ? 1200n : opts.fiatMinor,
			currency: "USD",
			rate: { minor: RATE, source: "test" },
			speed: opts.speed ?? "standard",
			subaddress: "7test",
			addrIndex: 1,
			now: this.now,
			chainHeight: this.height,
		});
	}

	get expected(): bigint {
		return BigInt(this.inv.expectedAtomic ?? this.inv.minAtomic ?? "0");
	}

	/** The buyer broadcasts a payment now. */
	pay(amount: bigint, opts: { doubleSpendSeen?: boolean; unlockTime?: string } = {}): string {
		const txid = (++this.n).toString(16).padStart(64, "0");
		this.txs.push({
			txid, amount, walletSeenAt: this.walletOnline ? this.now : null, minedHeight: 0, minedAt: 0,
			doubleSpendSeen: opts.doubleSpendSeen ?? false, unlockTime: opts.unlockTime ?? "0", gone: false,
		});
		return txid;
	}

	/** Mine `count` blocks; unmined payments go into the first one unless `include` is false. */
	mine(count = 1, include = true): void {
		for (let i = 0; i < count; i++) {
			this.height += 1;
			this.now += BLOCK_MS;
			for (const tx of this.txs) {
				if (include && !tx.gone && tx.minedHeight === 0) {
					tx.minedHeight = this.height;
					tx.minedAt = this.now;
				}
			}
		}
	}

	/** Time passes without blocks (for clock-only steps). */
	wait(ms: number): void {
		this.now += ms;
	}

	/** Replace the last `depth` blocks: payments in them go back to the mempool, or vanish if `reverse`. */
	reorg(depth: number, reverse = false): void {
		const floor = this.height - depth;
		for (const tx of this.txs) {
			if (tx.minedHeight > floor) {
				tx.minedHeight = 0;
				tx.minedAt = 0;
				if (reverse) tx.gone = true;
			}
		}
	}

	/** The wallet host comes back: it now sees every payment it missed. */
	walletBack(): void {
		this.walletOnline = true;
		for (const tx of this.txs) tx.walletSeenAt ??= this.now;
	}

	private transfers(): Transfer[] {
		const out: Transfer[] = [];
		for (const tx of this.txs) {
			if (tx.gone || tx.walletSeenAt === null) continue;
			const mined = tx.minedHeight > 0;
			const timestamp = Math.floor((mined ? tx.minedAt : tx.walletSeenAt) / 1000);
			const k = this.known.get(tx.txid) ?? { seenAt: this.now, poolTs: mined ? null : timestamp };
			this.known.set(tx.txid, k);
			out.push({
				txid: tx.txid, amountAtomic: tx.amount.toString(), confirmations: mined ? this.height - tx.minedHeight + 1 : 0,
				height: tx.minedHeight, timestamp, doubleSpendSeen: tx.doubleSpendSeen, unlockTime: tx.unlockTime,
				seenAt: k.seenAt, poolTs: k.poolTs,
			});
		}
		return out;
	}

	/** A bridge sync now: the snapshot overwrites the transfers, seq is the bridge clock, then the rules run. */
	sync(): InvoiceEvent[] {
		return this.run({ ...this.inv, transfers: this.transfers(), seq: this.now });
	}

	/** An evaluation without a new snapshot (backup cron, or a status read). */
	tick(): InvoiceEvent[] {
		return this.run(this.inv);
	}

	private run(inv: Invoice): InvoiceEvent[] {
		const r = evaluate(inv, { now: this.now, chainHeight: this.height });
		this.inv = r.invoice;
		this.events.push(...r.events);
		return r.events;
	}
}
