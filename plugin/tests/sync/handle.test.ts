// handleSync end to end against an in-memory store: pairing, pool top-up, snapshots, seq replays, the watch list.
import { describe, expect, it } from "vitest";

import { newInvoice } from "../../src/core/invoice";
import { handleSync } from "../../src/sync/handle";
import { PAIRING_TTL_MS, newPairingCode } from "../../src/sync/pairing";
import { PAIR_MAX_BYTES } from "../../src/sync/protocol";
import { type KeyName, MemoryStore, PUBLIC_KEYS, bytesOf, signedHeaders } from "./helpers";

const T0 = 1_790_000_000_000;
const H0 = 3_000_000;
const ADDR = (i: number) => `7${String(i).padStart(94, "A")}`;
const TXID = (n: number) => n.toString(16).padStart(64, "0");

function syncBody(over: Record<string, unknown> = {}) {
	return { v: 1, seq: T0, height: H0, addresses: [], snapshots: [], ...over };
}
async function send(store: MemoryStore, body: unknown, opts: { now?: number; key?: KeyName; raw?: Uint8Array } = {}) {
	const now = opts.now ?? T0;
	const bytes = opts.raw ?? bytesOf(body);
	return handleSync({ body: bytes, headers: await signedHeaders(bytes, now, opts.key ?? "test1"), now }, store);
}
const errorCode = (out: Awaited<ReturnType<typeof send>>) => ("error" in out.response ? out.response.error.code : "ok");

function pairedStore(key: KeyName = "test1") {
	const store = new MemoryStore();
	store.publicKey = PUBLIC_KEYS[key];
	return store;
}

describe("pairing", () => {
	it("NOT_PAIRED without a key or an active code", async () => {
		expect(errorCode(await send(new MemoryStore(), syncBody()))).toBe("NOT_PAIRED");
	});

	it("pairs with an active code and a body signed by the key it carries, then burns the code", async () => {
		const store = new MemoryStore();
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		const out = await send(store, syncBody({ pair: { code, publicKey: PUBLIC_KEYS.test1 } }));
		expect(out.response).toMatchObject({ ok: true });
		expect(out.paired).toBe(true);
		expect(store.publicKey).toBe(PUBLIC_KEYS.test1);
		expect(store.pairing?.used).toBe(true);
		// The paired key now signs ordinary syncs.
		expect(errorCode(await send(store, syncBody({ seq: T0 + 1 }), { now: T0 + 1000 }))).toBe("ok");
	});

	it("rejects a wrong code while one is active, and stores nothing", async () => {
		const store = new MemoryStore();
		store.pairing = (await newPairingCode(T0)).state;
		const out = await send(store, syncBody({ pair: { code: "A".repeat(22), publicKey: PUBLIC_KEYS.test1 } }));
		expect(errorCode(out)).toBe("PAIRING_REJECTED");
		expect(store.publicKey).toBeNull();
		expect(store.pairing?.used).toBe(false);
	});

	it("rejects a body signed by a key other than the one it carries, without burning the code", async () => {
		const store = new MemoryStore();
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		const out = await send(store, syncBody({ pair: { code, publicKey: PUBLIC_KEYS.test1 } }), { key: "test2" });
		expect(errorCode(out)).toBe("BAD_SIGNATURE");
		expect(store.publicKey).toBeNull();
		expect(store.pairing?.used).toBe(false);
	});

	it("an expired code is not active: nothing is parsed before the signature, so the request is not paired", async () => {
		const store = new MemoryStore();
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		const later = T0 + PAIRING_TTL_MS;
		expect(errorCode(await send(store, syncBody({ seq: later, pair: { code, publicKey: PUBLIC_KEYS.test1 } }), { now: later }))).toBe("NOT_PAIRED");
	});

	it("a used code can't pair a second bridge (its body isn't parsed before the signature check)", async () => {
		const store = new MemoryStore();
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		await send(store, syncBody({ pair: { code, publicKey: PUBLIC_KEYS.test1 } }));
		const again = await send(store, syncBody({ seq: T0 + 1, pair: { code, publicKey: PUBLIC_KEYS.test2 } }), { key: "test2", now: T0 + 1000 });
		expect(errorCode(again)).toBe("BAD_SIGNATURE");
		expect(store.publicKey).toBe(PUBLIC_KEYS.test1);
	});

	it("a pair field signed by the paired bridge: PAIRING_NOT_ACTIVE without any code, PAIRING_REJECTED with a used one", async () => {
		const never = pairedStore();
		expect(errorCode(await send(never, syncBody({ pair: { code: "A".repeat(22), publicKey: PUBLIC_KEYS.test1 } })))).toBe("PAIRING_NOT_ACTIVE");
		const used = pairedStore();
		used.pairing = { ...(await newPairingCode(T0)).state, used: true };
		expect(errorCode(await send(used, syncBody({ pair: { code: "A".repeat(22), publicKey: PUBLIC_KEYS.test1 } })))).toBe("PAIRING_REJECTED");
	});

	it("a pairing body over 4 KiB takes the ordinary path and can't pair", async () => {
		const store = new MemoryStore();
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		const body = syncBody({ pair: { code, publicKey: PUBLIC_KEYS.test1 }, padding: "x".repeat(PAIR_MAX_BYTES) });
		expect(bytesOf(body).length).toBeGreaterThan(PAIR_MAX_BYTES);
		expect(errorCode(await send(store, body))).toBe("NOT_PAIRED");
		expect(store.pairing?.used).toBe(false);
	});

	it("a new pairing replaces the old key", async () => {
		const store = pairedStore("test1");
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		expect(errorCode(await send(store, syncBody({ pair: { code, publicKey: PUBLIC_KEYS.test2 } }), { key: "test2" }))).toBe("ok");
		expect(store.publicKey).toBe(PUBLIC_KEYS.test2);
		expect(errorCode(await send(store, syncBody({ seq: T0 + 1 }), { now: T0 + 1000, key: "test1" }))).toBe("BAD_SIGNATURE");
		expect(errorCode(await send(store, syncBody({ seq: T0 + 2 }), { now: T0 + 2000, key: "test2" }))).toBe("ok");
	});
});

describe("ordinary syncs", () => {
	it("forged, tampered, stale and badly encoded requests change nothing", async () => {
		const store = pairedStore();
		expect(errorCode(await send(store, syncBody(), { key: "test2" }))).toBe("BAD_SIGNATURE");
		const bytes = bytesOf(syncBody({ height: H0 + 1 }));
		const headers = await signedHeaders(bytes, T0);
		const tampered = bytesOf(syncBody({ height: H0 + 2 }));
		expect(errorCode({ ...(await handleSync({ body: tampered, headers, now: T0 }, store)) })).toBe("BAD_SIGNATURE");
		expect(errorCode(await handleSync({ body: bytes, headers, now: T0 + 301_000 }, store))).toBe("STALE_TIMESTAMP");
		const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf(syncBody())]);
		expect(errorCode(await send(store, null, { raw: bom }))).toBe("INVALID_ENCODING");
		expect(store.bridge).toBeNull();
	});

	it("records the bridge's height, time and protocol version", async () => {
		const store = pairedStore();
		await send(store, syncBody({ height: H0 + 7 }), { now: T0 + 500 });
		expect(store.bridge).toEqual({ height: H0 + 7, lastSyncAt: T0 + 500, version: 1, outdated: false });
	});

	it("tops up the pool with new indexes only, and reports the free count and target", async () => {
		const store = pairedStore();
		const out = await send(store, syncBody({ addresses: [1, 2, 3].map((i) => ({ index: i, address: ADDR(i) })) }));
		expect(out.response).toMatchObject({ ok: true, poolFree: 3, poolTarget: 50 });
		const again = await send(store, syncBody({ seq: T0 + 1, addresses: [{ index: 3, address: ADDR(99) }, { index: 4, address: ADDR(4) }] }), { now: T0 + 1000 });
		expect(again.response).toMatchObject({ poolFree: 4 });
		expect(store.pool.get(3)?.address).toBe(ADDR(3)); // an existing index is never overwritten
	});

	it("applies a snapshot to the invoice on that subaddress, ignores unknown indexes, and returns the watch list", async () => {
		const store = pairedStore();
		await send(store, syncBody({ addresses: [1, 2].map((i) => ({ index: i, address: ADDR(i) })) }));
		const inv = newInvoice({ id: "inv_a", token: "tok", kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: "", addrIndex: 0, now: T0, chainHeight: H0 });
		store.claim(1, inv);
		const amount = inv.expectedAtomic as string;
		const pay = (seq: number, height: number, confirmations: number) => ({
			seq, height: H0 + 2,
			snapshots: [{ index: 1, transfers: [{ txid: TXID(1), amount, confirmations, height, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0" }] }, { index: 2, transfers: [] }, { index: 77, transfers: [] }],
		});
		const first = await send(store, syncBody(pay(T0 + 10_000, 0, 0)), { now: T0 + 10_000 });
		expect(first.response).toMatchObject({ ok: true, watch: [1] });
		expect(first.events).toContainEqual({ invoiceId: "inv_a", event: { type: "status", from: "new", to: "confirming" } });
		const stored = store.invoices.get("inv_a");
		expect(stored?.transfers[0]).toMatchObject({ seenAt: T0 + 10_000, poolTs: 1_790_000_100 });

		const settled = await send(store, syncBody(pay(T0 + 20_000, H0 + 1, 2)), { now: T0 + 20_000 });
		expect(settled.events).toContainEqual({ invoiceId: "inv_a", event: { type: "status", from: "confirming", to: "settled" } });
		const after = store.invoices.get("inv_a");
		expect(after).toMatchObject({ status: "settled", seq: T0 + 20_000 });
		expect(after?.transfers[0]).toMatchObject({ seenAt: T0 + 10_000, poolTs: 1_790_000_100, height: H0 + 1 }); // first-seen data kept
		expect(settled.response).toMatchObject({ watch: [1] }); // settled but only 2 deep

		const deep = await send(store, syncBody(pay(T0 + 30_000, H0 + 1, 10)), { now: T0 + 30_000 });
		expect(deep.response).toMatchObject({ watch: [] }); // 10 deep: no longer watched
	});

	it("a replayed snapshot (seq not newer) is ignored, even re-signed with a fresh timestamp; retries are idempotent", async () => {
		const store = pairedStore();
		await send(store, syncBody({ addresses: [{ index: 1, address: ADDR(1) }] }));
		const inv = newInvoice({ id: "inv_b", token: "tok", kind: "product", fiatMinor: 1200n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: "", addrIndex: 0, now: T0, chainHeight: H0 });
		store.claim(1, inv);
		const amount = inv.expectedAtomic as string;
		const snap = (n: number) => [{ index: 1, transfers: Array.from({ length: n }, (_, i) => ({ txid: TXID(i + 1), amount, confirmations: 3, height: H0 + 1, timestamp: 1_790_000_100, doubleSpendSeen: false, unlockTime: "0" })) }];
		await send(store, syncBody({ seq: T0 + 50_000, height: H0 + 3, snapshots: snap(2) }), { now: T0 + 50_000 });
		const before = structuredClone(store.invoices.get("inv_b"));
		// An old snapshot (fewer transfers), replayed later with a fresh signature: ignored.
		const replay = await send(store, syncBody({ seq: T0 + 40_000, height: H0 + 3, snapshots: snap(1) }), { now: T0 + 60_000 });
		expect(replay.response).toMatchObject({ ok: true });
		expect(store.invoices.get("inv_b")).toEqual(before);
		// The same request retried: same seq, so nothing changes either.
		await send(store, syncBody({ seq: T0 + 50_000, height: H0 + 3, snapshots: snap(2) }), { now: T0 + 61_000 });
		expect(store.invoices.get("inv_b")).toEqual(before);
	});

	it("from pairing to a settled invoice", async () => {
		const store = new MemoryStore();
		const { code, state } = await newPairingCode(T0);
		store.pairing = state;
		const paired = await send(store, syncBody({ pair: { code, publicKey: PUBLIC_KEYS.test1 }, addresses: [1, 2, 3, 4, 5].map((i) => ({ index: i, address: ADDR(i) })) }));
		expect(paired.response).toMatchObject({ ok: true, poolFree: 5, watch: [] });
		const inv = newInvoice({ id: "inv_c", token: "tok", kind: "product", fiatMinor: 15000n, currency: "USD", rate: { minor: 15000n, source: "t" }, speed: "standard", subaddress: "", addrIndex: 0, now: T0, chainHeight: H0 });
		store.claim(3, inv); // $150: 1 XMR, 5 confirmations
		let now = T0;
		const amount = inv.expectedAtomic as string;
		for (let confs = 0; confs <= 5; confs++) {
			now += 120_000;
			const height = confs === 0 ? 0 : H0 + 1;
			await send(store, syncBody({ seq: now, height: H0 + confs, snapshots: [{ index: 3, transfers: [{ txid: TXID(9), amount, confirmations: confs, height, timestamp: 1_790_000_200, doubleSpendSeen: false, unlockTime: "0" }] }] }), { now });
		}
		expect(store.invoices.get("inv_c")).toMatchObject({ status: "settled", required: 5 });
	});
});
