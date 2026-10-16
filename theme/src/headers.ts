/**
 * The pay page's response headers (docs/spec.md, Theme integration, "Privacy details for /pay", plus Wyatt's CSP,
 * phase 06 plan). The token is in the URL, so: never cached, never sent on as a Referer, never indexed, never framed,
 * and nothing loads from anywhere but this page and the status route on the same origin. The inline script and style
 * are allowed by their SHA-256, computed from the exact text the page sends.
 */
import { CLIENT_SCRIPT } from "./client";
import { PAGE_CSS } from "./styles";

async function sha256Base64(text: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return btoa(String.fromCharCode(...digest));
}

let cached: Promise<Record<string, string>> | undefined;

/** The headers, the same for every pay page (the hashes depend only on the package's own text). */
export function payPageHeaders(): Promise<Record<string, string>> {
	cached ??= (async () => {
		const csp = [
			"default-src 'none'",
			"connect-src 'self'",
			`script-src 'sha256-${await sha256Base64(CLIENT_SCRIPT)}'`,
			`style-src 'self' 'sha256-${await sha256Base64(PAGE_CSS)}'`,
			"frame-ancestors 'none'",
			"base-uri 'none'",
			"form-action 'none'",
		].join("; ");
		return {
			"Cache-Control": "private, no-store",
			"Referrer-Policy": "no-referrer",
			"X-Robots-Tag": "noindex, nofollow",
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": csp,
		};
	})();
	return cached;
}
