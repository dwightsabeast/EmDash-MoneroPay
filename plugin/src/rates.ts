/**
 * The XMR price (spec change 8): Kraken's public Ticker first, CoinGecko's keyless simple/price as the fallback,
 * cached about a minute in KV. Prices are parsed from decimal text into integer minor units, never through a float,
 * and rounded down to the cent (a lower rate means a slightly higher XMR amount, never a lower one).
 */
import type { PluginContext } from "emdash/plugin";

import { FIAT_DECIMALS } from "./core/constants";

export const CURRENCIES = ["USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

export const RATE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
/** Refuse obviously broken prices: between $0.01 and $10,000,000 per XMR. */
const MIN_RATE_MINOR = 1n;
const MAX_RATE_MINOR = 1_000_000_000n;

export interface Rate {
	minor: bigint;
	source: "api.kraken.com" | "api.coingecko.com";
	at: number;
}

/** "555.37000000" -> 55537n (floor to the currency's decimals); null if it isn't a plain positive decimal. */
export function decimalToMinorFloor(text: string, decimals: number = FIAT_DECIMALS): bigint | null {
	const m = /^(\d{1,12})(?:\.(\d{1,20}))?$/.exec(text);
	if (!m) return null;
	const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
	return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

const sane = (v: bigint | null): v is bigint => v !== null && v >= MIN_RATE_MINOR && v <= MAX_RATE_MINOR;

/** Kraken: {"error":[],"result":{"XXMRZUSD":{"c":["555.37000000","1.7"],...}}}; "c" is the last trade, a string. */
export function parseKraken(text: string): bigint | null {
	try {
		const j = JSON.parse(text) as { error?: unknown[]; result?: Record<string, { c?: unknown[] }> };
		if (!Array.isArray(j.error) || j.error.length > 0 || !j.result) return null;
		const pairs = Object.values(j.result);
		const last = pairs.length === 1 ? pairs[0]?.c?.[0] : undefined;
		return typeof last === "string" ? decimalToMinorFloor(last) : null;
	} catch {
		return null;
	}
}

/** CoinGecko: {"monero":{"usd":556.0}}. The price is a JSON number, so read its digits from the text, not from a float. */
export function parseCoinGecko(text: string, currency: Currency): bigint | null {
	const m = new RegExp(`^\\s*\\{\\s*"monero"\\s*:\\s*\\{\\s*"${currency.toLowerCase()}"\\s*:\\s*(\\d{1,12}(?:\\.\\d{1,20})?)\\s*\\}\\s*\\}\\s*$`).exec(text);
	return m ? decimalToMinorFloor(m[1]) : null;
}

const SOURCES: Array<{ source: Rate["source"]; url: (c: Currency) => string; parse: (text: string, c: Currency) => bigint | null }> = [
	{ source: "api.kraken.com", url: (c) => `https://api.kraken.com/0/public/Ticker?pair=XMR${c}`, parse: (t) => parseKraken(t) },
	{ source: "api.coingecko.com", url: (c) => `https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=${c.toLowerCase()}`, parse: parseCoinGecko },
];

interface CachedRate {
	minor: string;
	source: Rate["source"];
	at: number;
}

/** The current rate, or null if neither source answers sensibly (checkout then returns RATE_UNAVAILABLE). */
export async function getRate(ctx: PluginContext, currency: Currency, now: number): Promise<Rate | null> {
	const key = `cache:rate:${currency}`;
	const cached = await ctx.kv.get<CachedRate>(key);
	if (cached && now - cached.at < RATE_TTL_MS && now >= cached.at) return { minor: BigInt(cached.minor), source: cached.source, at: cached.at };
	if (!ctx.http) return null;
	for (const s of SOURCES) {
		try {
			const res = await ctx.http.fetch(s.url(currency), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (!res.ok) continue;
			const minor = s.parse(await res.text(), currency);
			if (!sane(minor)) continue;
			await ctx.kv.set(key, { minor: minor.toString(), source: s.source, at: now } satisfies CachedRate);
			return { minor, source: s.source, at: now };
		} catch {
			// Next source. Never fall back to a stale price.
		}
	}
	return null;
}
