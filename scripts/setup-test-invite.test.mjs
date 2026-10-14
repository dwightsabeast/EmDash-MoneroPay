// Tests for scripts/setup-test-invite.mjs (phase 05), run against a fake EmDash on 127.0.0.1.
// Run: node --test scripts/*.test.mjs
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

const SCRIPT = join(import.meta.dirname, "setup-test-invite.mjs");
const TOKEN = "tok_SECRET_0123456789";
const EMAIL = "tester@coffer-test.invalid";
const PUBLIC = "https://dev.example.test";
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/**
 * A fake EmDash dev site. mode "direct": the invite reply carries inviteUrl (no email provider). "email": the reply
 * says it was sent and the link is in the dev email list (the dev console provider). "exists": the user exists (409).
 */
async function fakeSite(mode) {
	const seen = [];
	const server = createServer((req, res) => {
		seen.push(`${req.method} ${req.url}`);
		const json = (status, body) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};
		const link = `http://localhost:4321/_emdash/admin/invite/accept?token=${TOKEN}`;
		if (req.url === "/_emdash/api/auth/dev-bypass") {
			res.setHeader("Set-Cookie", ["session=s1; Path=/; HttpOnly", "other=o1; Path=/"]);
			return json(200, { success: true, data: { success: true, user: { role: 50 } } });
		}
		const signedIn = (req.headers.cookie ?? "").includes("session=s1");
		if (req.url === "/_emdash/api/auth/invite" && req.method === "POST") {
			if (!signedIn || req.headers["x-emdash-request"] !== "1") return json(403, { error: { code: "FORBIDDEN" } });
			let raw = "";
			req.on("data", (c) => (raw += c));
			req.on("end", () => {
				const body = JSON.parse(raw);
				if (body.email !== EMAIL || body.role !== 50) return json(400, { error: { code: "BAD_BODY" } });
				if (mode === "exists") return json(409, { error: { code: "USER_EXISTS", message: "A user with this email already exists" } });
				if (mode === "direct") return json(200, { success: true, data: { success: true, inviteUrl: link } });
				return json(200, { success: true, data: { success: true, message: `Invite sent to ${EMAIL}` } });
			});
			return;
		}
		if (req.url === "/_emdash/api/dev/emails" && signedIn) {
			const item = (to, token) => ({ message: { to, subject: "Invited", text: `Hi.\n\nClick this link to create your account:\nhttp://localhost:4321/_emdash/admin/invite/accept?token=${token}\n\nThis link expires in 7 days.` } });
			return json(200, { success: true, data: { items: [item(EMAIL, TOKEN), item("someone@example.test", "tok_OTHER"), item(EMAIL, "tok_OLDER")] } });
		}
		json(404, { error: { code: "NOT_FOUND" } });
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	server.unref(); // a failed assertion before close() mustn't keep the test process alive
	return { site: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

function tempOut() {
	const dir = mkdtempSync(join(tmpdir(), "setup-test-invite-"));
	dirs.push(dir);
	return join(dir, "tester-invite.txt");
}

/** Runs the script; resolves with { code, out } where out is stdout and stderr together. */
async function run(args) {
	try {
		const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, ...args]);
		return { code: 0, out: stdout + stderr };
	} catch (e) {
		return { code: e.code, out: (e.stdout ?? "") + (e.stderr ?? "") };
	}
}

for (const mode of ["direct", "email"]) {
	test(`${mode}: writes the link with only its origin changed, mode 600, and never prints the token`, async () => {
		const fake = await fakeSite(mode);
		const out = tempOut();
		const r = await run(["--site", fake.site, "--public", PUBLIC, "--out", out]);
		fake.close();
		assert.equal(r.code, 0, r.out);
		assert.equal(readFileSync(out, "utf8"), `${PUBLIC}/_emdash/admin/invite/accept?token=${TOKEN}\n`);
		assert.equal(statSync(out).mode & 0o777, 0o600);
		assert.ok(!r.out.includes(TOKEN), "output must not contain the token");
		assert.ok(r.out.includes(out), "output names the file");
	});
}

test("an existing file is overwritten and left at mode 600", async () => {
	const fake = await fakeSite("direct");
	const out = tempOut();
	writeFileSync(out, "old\n");
	chmodSync(out, 0o644);
	const r = await run(["--site", fake.site, "--public", PUBLIC, "--out", out]);
	fake.close();
	assert.equal(r.code, 0, r.out);
	assert.equal(statSync(out).mode & 0o777, 0o600);
	assert.ok(readFileSync(out, "utf8").includes(TOKEN));
});

test("an existing account is reported plainly and nothing is written", async () => {
	const fake = await fakeSite("exists");
	const out = tempOut();
	const r = await run(["--site", fake.site, "--public", PUBLIC, "--out", out]);
	fake.close();
	assert.notEqual(r.code, 0);
	assert.match(r.out, /already exists/);
	assert.equal(existsSync(out), false);
});

test("refuses a site that isn't on loopback, before any request", async () => {
	const fake = await fakeSite("direct");
	const out = tempOut();
	const r = await run(["--site", "http://192.0.2.1:4321", "--public", PUBLIC, "--out", out]);
	fake.close();
	assert.notEqual(r.code, 0);
	assert.match(r.out, /loopback/);
	assert.equal(existsSync(out), false);
});

test("refuses a public origin that isn't a bare https origin", async () => {
	const fake = await fakeSite("direct");
	for (const bad of ["http://dev.example.test", "https://dev.example.test/path"]) {
		const r = await run(["--site", fake.site, "--public", bad, "--out", tempOut()]);
		assert.notEqual(r.code, 0, bad);
		assert.match(r.out, /https origin/);
	}
	fake.close();
	assert.equal(fake.seen.length, 0);
});
