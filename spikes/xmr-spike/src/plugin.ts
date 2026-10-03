import { pluginRoute, type SandboxedPlugin } from "emdash/plugin";

/**
 * Throwaway phase 01 spike (docs/phases/01-spike.md). Never shipped, never imported by later phases.
 *
 * Q1: Ed25519 verification of `x-xmr-ts + "\n" + rawBody` inside the sandbox isolate.
 * `sig` declares the body as "text" (what the spec says); `sig-bytes` declares "bytes" for comparison,
 * because a text body arrives as a decoded string and may not re-encode to the signed bytes.
 */

// RFC 8032 section 7.1 TEST 1 public key (published test key).
const PUBLIC_KEY_HEX = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

const SIGNED_HEADERS = ["x-xmr-ts", "x-xmr-sig"];
const MAX_BYTES = 65536;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function bytesToHex(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += b.toString(16).padStart(2, "0");
	return s;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
	try {
		const bin = atob(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

// Try the standard WebCrypto name first, then the older Cloudflare/workerd naming.
const ALGORITHMS: Array<{ label: string; importAlg: Algorithm | (Algorithm & { namedCurve: string }); verifyAlg: Algorithm }> = [
	{ label: "Ed25519", importAlg: { name: "Ed25519" }, verifyAlg: { name: "Ed25519" } },
	{
		label: "NODE-ED25519",
		importAlg: { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
		verifyAlg: { name: "NODE-ED25519" },
	},
];

async function verifySigned(headers: Record<string, string>, body: Uint8Array) {
	const ts = headers["x-xmr-ts"];
	const sig = headers["x-xmr-sig"] === undefined ? null : base64ToBytes(headers["x-xmr-sig"]);
	const attempts: Array<{ alg: string; error: string }> = [];
	if (ts === undefined || sig === null) return { ok: false, alg: null, attempts, error: "MISSING_OR_BAD_HEADERS" };

	const prefix = new TextEncoder().encode(`${ts}\n`);
	const message = new Uint8Array(prefix.length + body.length);
	message.set(prefix, 0);
	message.set(body, prefix.length);

	for (const a of ALGORITHMS) {
		try {
			const key = await crypto.subtle.importKey("raw", hexToBytes(PUBLIC_KEY_HEX), a.importAlg, false, ["verify"]);
			const ok = await crypto.subtle.verify(a.verifyAlg, key, sig, message);
			return { ok, alg: a.label, attempts, error: null };
		} catch (err) {
			attempts.push({ alg: a.label, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
		}
	}
	return { ok: false, alg: null, attempts, error: "NO_ED25519" };
}

function report(headers: Record<string, string>, body: Uint8Array, result: Awaited<ReturnType<typeof verifySigned>>) {
	return { ...result, bodyHex: bytesToHex(body), bodyLength: body.length, headerKeys: Object.keys(headers).sort() };
}

const plugin: SandboxedPlugin = {
	routes: {
		sig: pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "text", headers: SIGNED_HEADERS, maxBytes: MAX_BYTES },
			handler: async (routeCtx) => {
				const body = new TextEncoder().encode(routeCtx.input);
				return report(routeCtx.request.headers, body, await verifySigned(routeCtx.request.headers, body));
			},
		}),
		"sig-bytes": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "bytes", headers: SIGNED_HEADERS, maxBytes: MAX_BYTES },
			handler: async (routeCtx) => {
				const body = routeCtx.input;
				return report(routeCtx.request.headers, body, await verifySigned(routeCtx.request.headers, body));
			},
		}),
	},
};

export default plugin;
