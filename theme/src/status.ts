/**
 * Reading an invoice's status on the server, in-process: EmDash 1.1.0 gives SSR pages the public plugin route dispatcher
 * (`getPublicPluginApiRouteHandler`, from `emdash/plugin-utils`), so there's no network request to the site's own
 * address, which a Cloudflare Worker can't always make. Only routes the plugin marks public are reachable this way.
 */
import { getPublicPluginApiRouteHandler, type PublicPluginRuntimeLocals } from "emdash/plugin-utils";

/** The plugin's slug, which is its route prefix: /_emdash/api/plugins/coffer/<route>. */
export const PLUGIN_ID = "coffer";
export const STATUS_PATH = `/_emdash/api/plugins/${PLUGIN_ID}/status`;

/** The plugin's GET status response (docs/spec.md, API contracts, plus spec change 32). Amounts are decimal strings. */
export interface InvoiceStatus {
	status: "new" | "seen" | "confirming" | "settled" | "expired" | "review";
	confirmations: number;
	required: number;
	amountAtomic: string | null;
	receivedAtomic: string;
	expiresAt: string;
	settledAt: string | null;
	pendingExpiry: boolean;
	reconfirming: boolean;
	kind: "product" | "tip" | "order";
	address: string;
	uri: string;
	fiat: { amountMinor: string; currency: string } | null;
	minAtomic: string | null;
}

export type StatusResult = { ok: true; status: InvoiceStatus } | { ok: false; code: "INVOICE_NOT_FOUND" | "UNAVAILABLE" };

/** Tokens are 128-bit random, base64url: 22 characters. Anything else is never sent to the plugin. */
export const isToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{22}$/.test(token);

/**
 * The invoice's status, or why there's none: INVOICE_NOT_FOUND for a malformed or unknown token, UNAVAILABLE when the
 * plugin can't answer (not installed, disabled, or an error). The token is never logged here.
 */
export async function fetchStatus(astro: { locals: unknown; url: URL }, token: unknown): Promise<StatusResult> {
	if (!isToken(token)) return { ok: false, code: "INVOICE_NOT_FOUND" };
	const handler = getPublicPluginApiRouteHandler(astro.locals as PublicPluginRuntimeLocals);
	if (!handler) return { ok: false, code: "UNAVAILABLE" };
	try {
		const request = new Request(new URL(`${STATUS_PATH}?token=${token}`, astro.url), { method: "GET" });
		const res = await handler(PLUGIN_ID, "GET", "status", request);
		const data = res.success ? res.data : undefined;
		if (isStatus(data)) return { ok: true, status: data };
		if (isRecord(data) && isRecord(data.error) && data.error.code === "INVOICE_NOT_FOUND") return { ok: false, code: "INVOICE_NOT_FOUND" };
		return { ok: false, code: "UNAVAILABLE" };
	} catch {
		return { ok: false, code: "UNAVAILABLE" };
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STATUSES = new Set(["new", "seen", "confirming", "settled", "expired", "review"]);

/** Enough of a shape check that the page never renders half an invoice. */
function isStatus(v: unknown): v is InvoiceStatus {
	return (
		isRecord(v) &&
		typeof v.status === "string" &&
		STATUSES.has(v.status) &&
		typeof v.address === "string" &&
		typeof v.uri === "string" &&
		v.uri.startsWith("monero:") &&
		typeof v.expiresAt === "string" &&
		typeof v.receivedAtomic === "string" &&
		Number.isSafeInteger(v.confirmations) &&
		Number.isSafeInteger(v.required)
	);
}

const ATOMIC_PER_XMR = 10n ** 12n;

/** Atomic units to XMR without trailing zeros ("0.08", "1", "0.000000000001"). BigInt only, never a float. */
export function xmr(atomic: string | bigint): string {
	const a = BigInt(atomic);
	const frac = (a % ATOMIC_PER_XMR).toString().padStart(12, "0").replace(/0+$/, "");
	return frac ? `${a / ATOMIC_PER_XMR}.${frac}` : `${a / ATOMIC_PER_XMR}`;
}

/** Fiat minor units with two decimals and the currency code ("12.00 USD"). The plugin's currencies all have two. */
export function fiat(amountMinor: string, currency: string): string {
	const m = BigInt(amountMinor);
	return `${m / 100n}.${(m % 100n).toString().padStart(2, "0")} ${currency}`;
}
