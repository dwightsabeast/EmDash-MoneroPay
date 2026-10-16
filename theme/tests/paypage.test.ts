// PayPage through Astro's container API, rendered from a page shaped like the README's (tests/pages/PayRoute.astro:
// preparePayPage in the page's frontmatter, because headers a component sets arrive too late in a real site), with a
// fake EmDash runtime in locals: every state, the privacy headers and CSP (hashes checked against the inline text
// actually sent), no third-party references, where the token appears, and failing closed without the preparation.
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";

import PayPage from "../src/PayPage.astro";
import { setPayPageHeaders } from "../src/headers";
import type { PreparedPayPage } from "../src/page";
import PayRoute from "./pages/PayRoute.astro";
import { CLIENT_SCRIPT } from "../src/client";
import { qrSvg } from "../src/qr";
import { PAGE_CSS } from "../src/styles";
import { ADDRESS, type Call, NOT_FOUND, TOKEN, URI, locals, ok, status } from "./fixtures";

let container: AstroContainer;
beforeAll(async () => {
	container = await AstroContainer.create();
});

async function render(token: string | undefined, loc: unknown) {
	const res = await container.renderToResponse(PayRoute, { props: { token }, locals: loc as App.Locals, request: new Request(`https://shop.example/pay/${token}`), partial: false });
	return { res, html: await res.text() };
}

/** The markup alone: the inline CSS and script name the same classes and attributes. */
const markup = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*?<\/script>/, "");

/** The visible status line: the one data-show paragraph without `hidden`. */
const visibleStates = (html: string) => [...html.matchAll(/<p class="coffer-status" data-show="(\w+)"( hidden)?/g)].filter((m) => !m[2]).map((m) => m[1]);

async function sha256b64(text: string) {
	const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return btoa(String.fromCharCode(...d));
}

describe("PayPage", () => {
	it("an open invoice: amount in XMR and fiat, the QR of the exact URI, the address, the wallet link, waiting", async () => {
		const calls: Call[] = [];
		const { res, html } = await render(TOKEN, locals(ok(status()), calls));
		expect(res.status).toBe(200);
		expect(calls).toEqual([{ pluginId: "coffer", method: "GET", path: "status", url: `https://shop.example/_emdash/api/plugins/coffer/status?token=${TOKEN}` }]);
		expect(html).toContain('<p class="coffer-amount">0.08 XMR</p>');
		expect(html).toContain('<p class="coffer-fiat">12.00 USD</p>');
		expect(html).toContain(qrSvg(URI));
		expect(html).toContain(`<p class="coffer-value" data-field="address">${ADDRESS}</p>`);
		expect(html).toContain('<p class="coffer-value" data-field="amount">0.08</p>');
		expect(html).toContain(`href="${URI.replaceAll("&", "&amp;")}"`);
		// Run 6c: on Windows, Feather isn't registered for monero: links, so the button can do nothing (Wyatt).
		expect(html).toMatch(/Open in wallet<\/a>\s*<p class="coffer-note">Nothing opened\? Copy the address and amount above into your wallet\.<\/p>/);
		expect(visibleStates(html)).toEqual(["waiting"]);
		expect(html).toMatch(/Pay within <strong data-field="countdown">2[45]:\d\d<\/strong> \(by \d\d:\d\d UTC\)/);
		expect(html).toContain('data-final="false"');
	});

	it("the privacy headers and meta, with a CSP whose hashes match the inline script and style as sent", async () => {
		const { res, html } = await render(TOKEN, locals(ok(status())));
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(res.headers.get("referrer-policy")).toBe("no-referrer");
		expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		const csp = res.headers.get("content-security-policy") ?? "";
		const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
		const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
		expect(script).toBe(CLIENT_SCRIPT);
		expect(style).toBe(PAGE_CSS);
		expect(csp).toBe(
			`default-src 'none'; connect-src 'self'; script-src 'sha256-${await sha256b64(script ?? "")}'; style-src 'self' 'sha256-${await sha256b64(style ?? "")}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
		);
		expect(html.match(/<script/g)).toHaveLength(1);
		expect(html.match(/<style/g)).toHaveLength(1);
		expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
		expect(html).toContain('<meta name="referrer" content="no-referrer">');
	});

	it("nothing from anywhere else: no URL but the SVG namespace, no src, no stylesheet link", async () => {
		const { html } = await render(TOKEN, locals(ok(status())));
		const scrubbed = html.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
		expect(scrubbed).not.toMatch(/https?:\/\//);
		expect(scrubbed).not.toMatch(/\ssrc=|<link|<iframe|<img|@import|url\(/i);
	});

	it("the token appears once: in the status URL the script polls (same origin, relative)", async () => {
		const { html } = await render(TOKEN, locals(ok(status())));
		expect(html.split(TOKEN)).toHaveLength(2);
		expect(html).toContain(`data-status-url="/_emdash/api/plugins/coffer/status?token=${TOKEN}"`);
	});

	it("each later state shows its line, hides the payment details once paid, and is final where nothing more changes", async () => {
		const cases: Array<[Parameters<typeof status>[0], string, boolean, boolean]> = [
			[{ status: "seen", receivedAtomic: "40000000000" }, "partial", true, false],
			[{ status: "new", pendingExpiry: true }, "checking", true, false],
			[{ status: "confirming", confirmations: 1, receivedAtomic: "80000000000" }, "confirming", false, false],
			[{ status: "settled", confirmations: 2 }, "settled", false, true],
			[{ status: "settled", reconfirming: true }, "reconfirming", false, false],
			[{ status: "expired" }, "expired", false, true],
			[{ status: "review" }, "review", false, true],
		];
		for (const [o, state, details, final] of cases) {
			const { html } = await render(TOKEN, locals(ok(status(o))));
			expect(visibleStates(html), state).toEqual([state]);
			expect(/<section class="coffer-card" data-show="waiting partial checking"( hidden)?>/.exec(html)?.[1] === undefined, state).toBe(details);
			expect(html, state).toContain(`data-final="${final}"`);
		}
		const { html } = await render(TOKEN, locals(ok(status({ status: "confirming", confirmations: 1, required: 10 }))));
		expect(html).toContain('Confirming: <strong data-field="confirmations">1</strong> of <strong data-field="required">10</strong>.');
		expect((await render(TOKEN, locals(ok(status({ status: "seen", receivedAtomic: "40000000000" }))))).html).toContain('Received <strong data-field="received">0.04</strong> XMR');
	});

	it("an open tip: any amount from the floor, no fiat, no amount box", async () => {
		const { html } = await render(TOKEN, locals(ok(status({ kind: "tip", amountAtomic: null, fiat: null, minAtomic: "100000000", uri: `monero:${ADDRESS}?tx_amount=0.000100000000&tx_description=Coffer%20test%20tip` }))));
		expect(html).toContain('<p class="coffer-amount">Any amount from 0.0001 XMR</p>');
		expect(markup(html)).not.toContain("coffer-fiat");
		expect(markup(html)).not.toContain('data-field="amount"');
		expect(html).toContain('<p class="coffer-note">Nothing opened? Copy the address above into your wallet.</p>');
		expect(html).toContain(qrSvg(`monero:${ADDRESS}?tx_amount=0.000100000000&tx_description=Coffer%20test%20tip`));
	});

	it("unknown token: 404, the not-valid line, no polling; a malformed token never reaches the plugin", async () => {
		const unknown = await render(TOKEN, locals(NOT_FOUND));
		expect(unknown.res.status).toBe(404);
		expect(visibleStates(unknown.html)).toEqual(["notfound"]);
		expect(markup(unknown.html)).not.toContain("data-status-url");
		expect(unknown.html).toContain('data-final="true"');
		expect(unknown.res.headers.get("cache-control")).toBe("private, no-store");
		for (const bad of [undefined, "short", `${TOKEN}x`, "../../admin/route/aaaa", "A".repeat(21) + "/"]) {
			const calls: Call[] = [];
			const r = await render(bad, locals(NOT_FOUND, calls));
			expect(r.res.status, String(bad)).toBe(404);
			expect(calls).toEqual([]);
		}
	});

	it("no runtime, a failed reply or a throwing handler: 503, reload later, nothing else shown", async () => {
		for (const loc of [{}, locals({ success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } }), locals(ok({ status: "new" })), locals(null, [], { throws: true })]) {
			const { res, html } = await render(TOKEN, loc);
			expect(res.status).toBe(503);
			expect(visibleStates(html)).toEqual(["unavailable"]);
			expect(markup(html)).not.toContain("coffer-amount");
			expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
		}
	});

	it("a site title, and same-origin site CSS through the head slot", async () => {
		const res = await container.renderToString(PayRoute, {
			props: { token: TOKEN, title: "Pay Wyatt's shop" },
			slots: { head: '<link rel="stylesheet" href="/site.css">' },
			locals: locals(ok(status())) as App.Locals,
			request: new Request(`https://shop.example/pay/${TOKEN}`),
			partial: false,
		});
		expect(res).toContain("<title>Pay Wyatt&#39;s shop</title>");
		expect(res).toContain('<link rel="stylesheet" href="/site.css">');
	});

	it("fails closed without preparePayPage or its headers: no payment details, no token, no plugin call", async () => {
		const calls: Call[] = [];
		const loc = locals(ok(status()), calls) as App.Locals;
		const request = new Request(`https://shop.example/pay/${TOKEN}`);
		const prepared: PreparedPayPage = { token: TOKEN, result: { ok: true, status: status() } };
		// No prepared result; a prepared result but no headers (as if the page skipped preparePayPage's header step).
		for (const props of [{}, { pay: prepared }]) {
			const html = await container.renderToString(PayPage, { props, locals: loc, request, partial: false });
			expect(visibleStates(html)).toEqual(["unconfigured"]);
			expect(markup(html)).not.toContain(TOKEN);
			expect(markup(html)).not.toContain(ADDRESS);
			expect(markup(html)).not.toContain("<svg");
			expect(html).toContain('data-final="true"');
		}
		expect(calls).toEqual([]);
	});

	it("the headers set by the page are what PayPage checks for", async () => {
		const headers = new Headers();
		await setPayPageHeaders({ response: { headers } });
		const { res } = await render(TOKEN, locals(ok(status())));
		for (const [name, value] of headers) expect(res.headers.get(name), name).toBe(value);
	});
});
