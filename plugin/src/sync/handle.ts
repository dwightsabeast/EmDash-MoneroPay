/**
 * bridge/sync, step by step in the spec's order, against a storage interface (session 2d wires it to ctx.storage and
 * ctx.kv and declares the route). Returns the response body and the lifecycle events for the caller to record.
 */
import type { Invoice, InvoiceEvent } from "../core/invoice";
import { isWatched } from "../core/watch";
import { mergeSnapshot } from "./merge";
import { type PairingState, isPairingActive, pairingCodeMatches } from "./pairing";
import {
	PAIR_MAX_BYTES,
	POOL_TARGET,
	type SyncBody,
	type SyncErrorCode,
	checkHeaders,
	decodeBase64,
	decodeStrict,
	parseSyncBody,
	verifySignature,
} from "./protocol";

export interface BridgeState {
	height: number;
	lastSyncAt: number;
	version: number;
	outdated: boolean;
}

export interface SyncStore {
	getPublicKey(): Promise<string | null>;
	setPublicKey(publicKey: string): Promise<void>;
	getPairing(): Promise<PairingState | null>;
	setPairing(state: PairingState): Promise<void>;
	getBridgeState(): Promise<BridgeState | null>;
	setBridgeState(state: BridgeState): Promise<void>;
	/** True if the pool already has this subaddress index (free or claimed). */
	poolHas(index: number): Promise<boolean>;
	poolAdd(row: { addrIndex: number; address: string }): Promise<void>;
	poolFreeCount(): Promise<number>;
	/** The highest subaddress index in the pool (free or claimed), 0 when empty. Every invoice's index is a pool row. */
	poolTop(): Promise<number>;
	/** The invoice that claimed this subaddress index, if any. */
	invoiceForIndex(index: number): Promise<Invoice | null>;
	saveInvoice(inv: Invoice): Promise<void>;
	/** Invoices that might still be watched (open, or final within the last day); the handler applies isWatched. */
	watchCandidates(now: number): Promise<Invoice[]>;
}

export interface SyncSuccess {
	ok: true;
	poolFree: number;
	poolTarget: number;
	/** Spec change 15: a bridge whose wallet lacks this index catches up (creates addresses, rescans) before it reports. */
	poolTop: number;
	watch: number[];
}
export type SyncResponse = SyncSuccess | { error: { code: SyncErrorCode } };

export interface SyncOutcome {
	response: SyncResponse;
	/** Lifecycle events per invoice (status changes, alerts) for the caller to record. */
	events: Array<{ invoiceId: string; event: InvoiceEvent }>;
	/** Set when this request completed a pairing. */
	paired?: boolean;
}

const error = (code: SyncErrorCode): SyncOutcome => ({ response: { error: { code } }, events: [] });

export async function handleSync(input: { body: Uint8Array; headers: Record<string, string>; now: number }, store: SyncStore): Promise<SyncOutcome> {
	const { body: bytes, headers, now } = input;

	// 1. Headers and freshness, before anything else.
	const head = checkHeaders(headers, now);
	if (!head.ok) return error(head.code);
	const { ts, signature } = head.value;

	// 2. Pairing: the only case where the body is parsed before the signature is checked, and only while a code is
	// active and the body is small. The signature must verify with the key carried in the body.
	const pairing = await store.getPairing();
	let parsed: SyncBody | null = null;
	let paired = false;
	if (isPairingActive(pairing, now) && bytes.length <= PAIR_MAX_BYTES) {
		const text = decodeStrict(bytes);
		if (text === null) return error("INVALID_ENCODING");
		const body = parseSyncBody(text);
		if (!body.ok) return error(body.code);
		if (body.value.pair) {
			if (!(await pairingCodeMatches(pairing, body.value.pair.code, now))) return error("PAIRING_REJECTED");
			const key = decodeBase64(body.value.pair.publicKey, 32);
			if (!key || !(await verifySignature(key, ts, bytes, signature))) return error("BAD_SIGNATURE");
			await store.setPublicKey(body.value.pair.publicKey);
			await store.setPairing({ ...pairing, used: true });
			parsed = body.value;
			paired = true;
		}
	}

	// 3. Otherwise: the stored key verifies the exact bytes, then strict decoding, then parsing.
	if (!parsed) {
		const stored = await store.getPublicKey();
		const key = stored === null ? null : decodeBase64(stored, 32);
		if (!key) return error("NOT_PAIRED");
		if (!(await verifySignature(key, ts, bytes, signature))) return error("BAD_SIGNATURE");
		const text = decodeStrict(bytes);
		if (text === null) return error("INVALID_ENCODING");
		const body = parseSyncBody(text);
		if (!body.ok) return error(body.code);
		if (body.value.pair) return error(pairing === null ? "PAIRING_NOT_ACTIVE" : "PAIRING_REJECTED");
		parsed = body.value;
	}

	// 4. Apply: bridge state, pool top-up, snapshots. The chain height never goes down (spec change 16): a fresh
	// wallet's first sync reports the height it has scanned to, which can be far below the chain's.
	const height = Math.max((await store.getBridgeState())?.height ?? 0, parsed.height);
	await store.setBridgeState({ height, lastSyncAt: now, version: parsed.v, outdated: parsed.outdated });
	for (const a of parsed.addresses) {
		if (!(await store.poolHas(a.index))) await store.poolAdd({ addrIndex: a.index, address: a.address });
	}
	const events: SyncOutcome["events"] = [];
	for (const snap of parsed.snapshots) {
		const inv = await store.invoiceForIndex(snap.index);
		if (!inv) continue;
		const merged = mergeSnapshot(inv, snap.transfers, { seq: parsed.seq, now, chainHeight: height });
		if (!merged.applied) continue;
		await store.saveInvoice(merged.invoice);
		for (const event of merged.events) events.push({ invoiceId: inv.id, event });
	}

	// 5. Response: pool status, the pool's highest index and the watch list.
	const watch = (await store.watchCandidates(now)).filter((inv) => isWatched(inv, now)).map((inv) => inv.addrIndex);
	const response: SyncSuccess = { ok: true, poolFree: await store.poolFreeCount(), poolTarget: POOL_TARGET, poolTop: await store.poolTop(), watch: [...new Set(watch)].sort((a, b) => a - b) };
	return { response, events, ...(paired ? { paired } : {}) };
}
