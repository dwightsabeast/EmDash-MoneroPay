// contract/test-vectors/sync-signature.json, the vectors the Go bridge will also use (phase 03).
import { describe, expect, it } from "vitest";

import { handleSync } from "../../src/sync/handle";
import { decodeBase64, decodeStrict, verifySignature } from "../../src/sync/protocol";
import vectors from "../../../contract/test-vectors/sync-signature.json";
import { MemoryStore, fromB64 } from "./helpers";

describe("shared signature vectors", () => {
	for (const v of vectors.cases) {
		it(`${v.name}: ${v.expected}`, async () => {
			const body = fromB64(v.body);
			const key = decodeBase64(v.publicKey, 32);
			const sig = decodeBase64(v.signature, 64);
			expect(key).not.toBeNull();
			expect(sig).not.toBeNull();
			// The signed message is exactly ts + "\n" + body.
			expect(fromB64(v.message)).toEqual(new Uint8Array([...new TextEncoder().encode(`${v.ts}\n`), ...body]));
			const verified = await verifySignature(key as Uint8Array<ArrayBuffer>, v.ts, body, sig as Uint8Array<ArrayBuffer>);
			expect(verified).toBe(v.expected !== "BAD_SIGNATURE");
			if (verified) expect(decodeStrict(body) === null).toBe(v.expected === "INVALID_ENCODING");

			// And through the whole handler, with the vector's key stored as the paired bridge.
			const store = new MemoryStore();
			store.publicKey = v.publicKey;
			const out = await handleSync({ body, headers: { "x-xmr-ts": v.ts, "x-xmr-sig": v.signature }, now: Number(v.ts) * 1000 }, store);
			if (v.expected === "ok") expect(out.response).toMatchObject({ ok: true });
			else expect(out.response).toEqual({ error: { code: v.expected } });
		});
	}
});
