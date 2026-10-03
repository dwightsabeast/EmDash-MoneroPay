// Spike Q1 in the plugin test host (Worker Loader + the production host bridge).
// Vectors come from scripts/make-vectors.mjs (signed in Node with node:crypto, RFC 8032 TEST 1 key).
// Results are also stored in task.meta so `vitest run --reporter=json` records the raw responses.
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import vectors from "./vectors.json";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
const vector = (name: string) => {
	const v = vectors.cases.find((c) => c.name === name);
	if (!v) throw new Error(`no vector ${name}`);
	return v;
};

type Verdict = { ok: boolean; alg: string | null; attempts: unknown[]; bodyHex: string; bodyLength: number; headerKeys: string[] };
type Envelope = { success: boolean; data?: Verdict; error?: { code: string; message: string } };

async function send(route: string, rawBody: Uint8Array<ArrayBuffer>, headers: Record<string, string>, meta: object) {
	host ??= await createPluginRuntimeTestHost();
	const res = await host.actions.routes.request(route, { method: "POST", rawBody, headers });
	const json = (await res.json()) as Envelope;
	Object.assign(meta, { status: res.status, json });
	return { status: res.status, json };
}

const signedHeaders = (v: { ts: string; sig: string }) => ({
	"content-type": "text/plain; charset=utf-8",
	"x-xmr-ts": v.ts,
	"x-xmr-sig": v.sig,
});

describe("Q1 bytes mode: every vector verifies exactly as Node says, body byte for byte", () => {
	for (const v of vectors.cases) {
		it(v.name, async ({ task }) => {
			const { status, json } = await send("sig-bytes", hexToBytes(v.bodyHex), signedHeaders(v), task.meta);
			expect(status).toBe(200);
			expect(json.data).toMatchObject({ ok: v.expectOk, alg: "Ed25519", attempts: [], bodyHex: v.bodyHex });
		});
	}
});

describe("Q1 text mode (what the spec declares)", () => {
	for (const name of ["valid", "one-byte-changed", "non-ascii-trailing-newline", "crlf-and-tab"]) {
		it(`${name}: same verdict as Node, body byte for byte`, async ({ task }) => {
			const v = vector(name);
			const { status, json } = await send("sig", hexToBytes(v.bodyHex), signedHeaders(v), task.meta);
			expect(status).toBe(200);
			expect(json.data).toMatchObject({ ok: v.expectOk, alg: "Ed25519", attempts: [], bodyHex: v.bodyHex });
		});
	}

	it("leading-bom: the host strips the BOM, so a correctly signed body fails", async ({ task }) => {
		const v = vector("leading-bom");
		const { status, json } = await send("sig", hexToBytes(v.bodyHex), signedHeaders(v), task.meta);
		expect(status).toBe(200);
		expect(json.data).toMatchObject({ ok: false, alg: "Ed25519", bodyHex: v.bodyHex.slice(6), bodyLength: 74 });
	});

	it("invalid-utf8: the host rejects the request before the plugin runs", async ({ task }) => {
		const v = vector("invalid-utf8");
		const { status, json } = await send("sig", hexToBytes(v.bodyHex), signedHeaders(v), task.meta);
		expect(status).toBe(400);
		expect(json).toMatchObject({ success: false, error: { code: "INVALID_PLUGIN_REQUEST" } });
	});
});

describe("Q1 headers", () => {
	it("mixed-case header names arrive lowercased and still verify", async ({ task }) => {
		const v = vector("valid");
		const { json } = await send("sig", hexToBytes(v.bodyHex), { "X-XMR-TS": v.ts, "X-Xmr-Sig": v.sig }, task.meta);
		expect(json.data).toMatchObject({ ok: true, headerKeys: ["x-xmr-sig", "x-xmr-ts"] });
	});

	it("undeclared headers are stripped, including credentials, cookies and Cloudflare Access", async ({ task }) => {
		const v = vector("valid");
		const { json } = await send(
			"sig",
			hexToBytes(v.bodyHex),
			{
				...signedHeaders(v),
				"x-other": "1",
				authorization: "Bearer not-a-real-token",
				cookie: "a=b",
				"cf-access-jwt-assertion": "not-a-real-jwt",
				"x-forwarded-for": "203.0.113.7",
				origin: "https://example.invalid",
			},
			task.meta,
		);
		expect(json.data).toMatchObject({ ok: true, headerKeys: ["x-xmr-sig", "x-xmr-ts"] });
	});

	it("a missing signature header is reported, not thrown", async ({ task }) => {
		const v = vector("valid");
		const { status, json } = await send("sig", hexToBytes(v.bodyHex), { "x-xmr-ts": v.ts }, task.meta);
		expect(status).toBe(200);
		expect(json.data).toMatchObject({ ok: false, error: "MISSING_OR_BAD_HEADERS" });
	});
});
