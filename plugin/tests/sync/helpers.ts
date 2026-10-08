// Test helpers for bridge/sync: an in-memory SyncStore, and signing with the published RFC 8032 test keys through
// WebCrypto (the same keys as contract/test-vectors/sync-signature.json; never a key of our own).
import type { Invoice } from "../../src/core/invoice";
import type { BridgeState, SyncStore } from "../../src/sync/handle";
import type { PairingState } from "../../src/sync/pairing";

const SEEDS = {
	test1: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
	test2: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
} as const;
export const PUBLIC_KEYS = {
	test1: "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=",
	test2: "PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=",
} as const;
export type KeyName = keyof typeof SEEDS;

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
export const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function privateKey(name: KeyName): Promise<CryptoKey> {
	const pkcs8 = new Uint8Array([...hexBytes("302e020100300506032b657004220420"), ...hexBytes(SEEDS[name])]);
	return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
}

/** Headers for a body: x-xmr-ts (seconds) and the base64 signature over ts + "\n" + bytes. */
export async function signedHeaders(body: Uint8Array, nowMs: number, key: KeyName = "test1", tsOverride?: string): Promise<Record<string, string>> {
	const ts = tsOverride ?? String(Math.floor(nowMs / 1000));
	const prefix = new TextEncoder().encode(`${ts}\n`);
	const message = new Uint8Array(prefix.length + body.length);
	message.set(prefix, 0);
	message.set(body, prefix.length);
	const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, await privateKey(key), message));
	return { "x-xmr-ts": ts, "x-xmr-sig": b64(sig) };
}

export const bytesOf = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

export class MemoryStore implements SyncStore {
	publicKey: string | null = null;
	pairing: PairingState | null = null;
	bridge: BridgeState | null = null;
	pool = new Map<number, { addrIndex: number; address: string; status: "free" | "claimed"; invoiceId?: string }>();
	invoices = new Map<string, Invoice>();

	async getPublicKey() { return this.publicKey; }
	async setPublicKey(k: string) { this.publicKey = k; }
	async getPairing() { return this.pairing; }
	async setPairing(s: PairingState) { this.pairing = s; }
	async setBridgeState(s: BridgeState) { this.bridge = s; }
	async poolHas(i: number) { return this.pool.has(i); }
	async poolAdd(row: { addrIndex: number; address: string }) { this.pool.set(row.addrIndex, { ...row, status: "free" }); }
	async poolFreeCount() { return [...this.pool.values()].filter((r) => r.status === "free").length; }
	async poolTop() { return Math.max(0, ...this.pool.keys()); }
	async invoiceForIndex(i: number) {
		const row = this.pool.get(i);
		return row?.invoiceId ? (this.invoices.get(row.invoiceId) ?? null) : null;
	}
	async saveInvoice(inv: Invoice) { this.invoices.set(inv.id, structuredClone(inv)); }
	async watchCandidates() { return [...this.invoices.values()]; }

	/** Test-only: claim a pool row for an invoice, as checkout will in session 2d. */
	claim(index: number, inv: Invoice) {
		const row = this.pool.get(index);
		if (!row || row.status !== "free") throw new Error(`pool row ${index} not free`);
		row.status = "claimed";
		row.invoiceId = inv.id;
		this.invoices.set(inv.id, structuredClone({ ...inv, addrIndex: index, subaddress: row.address }));
	}
}
