// Spike Q1: replays tests/vectors.json against a running site and prints one line per case.
// Node's fetch sends no Origin header, like the Go bridge.
// Usage: node scripts/send-vectors.mjs http://localhost:4321
import { readFileSync } from "node:fs";

const base = process.argv[2];
if (!base) throw new Error("usage: node scripts/send-vectors.mjs <base URL>");
const vectors = JSON.parse(readFileSync(new URL("../tests/vectors.json", import.meta.url), "utf8"));
const url = (route) => `${base.replace(/\/$/, "")}/_emdash/api/plugins/xmr-spike/${route}`;

async function post(route, bodyHex, headers) {
	const res = await fetch(url(route), { method: "POST", headers, body: Buffer.from(bodyHex, "hex") });
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text.slice(0, 200) };
	}
	return { status: res.status, json };
}

function line(label, expect, { status, json }) {
	const d = json.data;
	const got = d ? `ok=${d.ok} alg=${d.alg} attempts=${d.attempts?.length ?? "-"} bytes=${d.bodyLength} headers=${d.headerKeys?.join(",")}` : JSON.stringify(json.error ?? json);
	console.log(`${label.padEnd(44)} ${String(status).padEnd(4)} expect ${expect.padEnd(26)} got ${got}`);
	return d;
}

const signed = (v) => ({ "content-type": "text/plain; charset=utf-8", "x-xmr-ts": v.ts, "x-xmr-sig": v.sig });
let mismatches = 0;
for (const route of ["sig-bytes", "sig"]) {
	for (const v of vectors.cases) {
		let expect = `ok=${v.expectOk}, same bytes`;
		if (route === "sig" && v.name === "leading-bom") expect = "ok=false (BOM stripped)";
		if (route === "sig" && v.name === "invalid-utf8") expect = "400 INVALID_PLUGIN_REQUEST";
		const r = await post(route, v.bodyHex, signed(v));
		const d = line(`${route} ${v.name}`, expect, r);
		const okExact = d && d.ok === v.expectOk && d.alg === "Ed25519" && d.bodyHex === v.bodyHex;
		const pass =
			route === "sig" && v.name === "leading-bom"
				? d && d.ok === false && d.bodyHex === v.bodyHex.slice(6)
				: route === "sig" && v.name === "invalid-utf8"
					? r.status === 400 && r.json.error?.code === "INVALID_PLUGIN_REQUEST"
					: okExact;
		if (!pass) mismatches++;
	}
}

const valid = vectors.cases.find((c) => c.name === "valid");
const mixed = line("sig mixed-case headers", "ok=true, lowercased", await post("sig", valid.bodyHex, { "X-XMR-TS": valid.ts, "X-Xmr-Sig": valid.sig }));
if (!(mixed?.ok && mixed.headerKeys.join(",") === "x-xmr-sig,x-xmr-ts")) mismatches++;
const stripped = line(
	"sig undeclared headers",
	"only x-xmr-sig,x-xmr-ts",
	await post("sig", valid.bodyHex, {
		...signed(valid),
		"x-other": "1",
		authorization: "Basic Zm9vOmJhcg==",
		cookie: "a=b",
		"cf-access-jwt-assertion": "not-a-real-jwt",
		"x-forwarded-for": "203.0.113.7",
	}),
);
if (!(stripped?.ok && stripped.headerKeys.join(",") === "x-xmr-sig,x-xmr-ts")) mismatches++;

// Host behavior seen on the dev site but not in the test host (the test host passes both through and strips them).
const bearer = await post("sig", valid.bodyHex, { ...signed(valid), authorization: "Bearer not-a-real-token" });
line("sig invalid bearer token", "401 INVALID_TOKEN", bearer);
if (!(bearer.status === 401 && bearer.json.error?.code === "INVALID_TOKEN")) mismatches++;
const foreign = await post("sig", valid.bodyHex, { ...signed(valid), origin: "https://example.invalid" });
line("sig cross-origin Origin header", "403 CSRF_REJECTED", foreign);
if (!(foreign.status === 403 && foreign.json.error?.code === "CSRF_REJECTED")) mismatches++;

console.log(mismatches === 0 ? "ALL AS EXPECTED" : `${mismatches} UNEXPECTED RESULT(S)`);
process.exitCode = mismatches === 0 ? 0 : 1;
