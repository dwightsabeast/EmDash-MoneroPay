// Spike Q1: writes tests/vectors.json, signed in Node with node:crypto, the way the Go bridge will sign.
// Key: RFC 8032 section 7.1 TEST 1 (published test key, never a key of our own; see CLAUDE.md).
// Message: x-xmr-ts + "\n" + raw body bytes. Signature: base64 Ed25519.
// Usage: node scripts/make-vectors.mjs
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { writeFileSync } from "node:fs";

const RFC_SECRET = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC_EMPTY_SIG =
	"e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
	"5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

// PKCS#8 and SPKI wrappers for a raw Ed25519 seed / public key.
const privateKey = createPrivateKey({
	key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(RFC_SECRET, "hex")]),
	format: "der",
	type: "pkcs8",
});
const publicKey = createPublicKey(privateKey);
const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
if (rawPublic !== RFC_PUBLIC) throw new Error("derived public key does not match RFC 8032 TEST 1");
if (sign(null, Buffer.alloc(0), privateKey).toString("hex") !== RFC_EMPTY_SIG) {
	throw new Error("signature of the empty message does not match RFC 8032 TEST 1");
}

const signMessage = (ts, body) => sign(null, Buffer.concat([Buffer.from(`${ts}\n`, "utf8"), body]), privateKey);

const ts = "1790000000";
const cases = [];
function add(name, body, { tamper, expectOk, note }) {
	const sig = signMessage(ts, body);
	const sent = tamper ? tamper(Buffer.from(body)) : body;
	if (verify(null, Buffer.concat([Buffer.from(`${ts}\n`), sent]), publicKey, sig) !== expectOk) {
		throw new Error(`Node disagrees with the expected verdict for ${name}`);
	}
	cases.push({ name, note, ts, sig: sig.toString("base64"), bodyHex: sent.toString("hex"), expectOk });
}

const json = Buffer.from('{"v":1,"seq":1790000000000,"height":3012345,"addresses":[],"snapshots":[]}', "utf8");
add("valid", json, { expectOk: true, note: "plain ASCII JSON" });
add("one-byte-changed", json, {
	expectOk: false,
	note: "signed the valid body, then changed one digit of height",
	tamper: (b) => {
		const i = b.indexOf("3012345");
		b[i] = "4".charCodeAt(0);
		return b;
	},
});
add("non-ascii-trailing-newline", Buffer.from('{"note":"café 🍰 Ünïcödé","v":1}\n', "utf8"), {
	expectOk: true,
	note: "multi-byte UTF-8 and a trailing newline must survive byte for byte",
});
add("crlf-and-tab", Buffer.from('{"a":1,\r\n\t"b":2}\r\n', "utf8"), {
	expectOk: true,
	note: "CRLF and tab must not be normalized",
});
add("leading-bom", Buffer.concat([Buffer.from("efbbbf", "hex"), json]), {
	expectOk: true,
	note: "UTF-8 BOM first: a text decoder may strip it, changing the bytes",
});
add("invalid-utf8", Buffer.concat([Buffer.from('{"x":"', "utf8"), Buffer.from("ff", "hex"), Buffer.from('"}', "utf8")]), {
	expectOk: true,
	note: "invalid UTF-8 byte: a text decoder replaces it with U+FFFD, changing the bytes",
});

writeFileSync(
	new URL("../tests/vectors.json", import.meta.url),
	`${JSON.stringify({ source: "RFC 8032 section 7.1 TEST 1", publicKeyHex: RFC_PUBLIC, cases }, null, "\t")}\n`,
);
console.log(`wrote ${cases.length} cases; RFC 8032 TEST 1 key and empty-message signature checked`);
