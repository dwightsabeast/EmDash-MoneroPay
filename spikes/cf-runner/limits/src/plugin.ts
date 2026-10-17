/**
 * THROWAWAY spike plugin (spikes/cf-runner/PLAN.md): one public route, `op`, that repeats one kind of operation N
 * times so a driver can find where EmDash's Cloudflare sandbox runner (Worker Loader: 50 ms CPU, 10 subrequests per
 * call) refuses. Each loop catches its own error and reports the iteration that failed; a limit that kills the whole
 * isolate shows as the route failing instead.
 */
import { type PluginContext, type SandboxedPlugin, pluginRoute } from "emdash/plugin";

type Row = { group: string; pad: string; i: number };

const int = (v: unknown, fallback: number, max: number) => {
	const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : fallback;
	return Math.min(n, max);
};

async function sha256hex(text: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A pure-CPU loop (integer mixing) the optimizer can't drop: its result is returned. */
function burn(iters: number): number {
	let x = 0x9e3779b9;
	for (let i = 0; i < iters; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		x = (x + i) | 0;
	}
	return x;
}

async function repeat(n: number, step: (i: number) => Promise<unknown>) {
	let done = 0;
	try {
		for (let i = 0; i < n; i++) {
			await step(i);
			done++;
		}
		return { ok: true, done };
	} catch (e) {
		return { ok: false, done, error: String((e as Error)?.message ?? e).slice(0, 300) };
	}
}

async function op(ctx: PluginContext, q: Record<string, unknown>) {
	const kind = typeof q.kind === "string" ? q.kind : "noop";
	const n = int(q.n, 1, 100_000);
	const rows = ctx.storage.rows;
	const started = Date.now();
	let r: Record<string, unknown>;
	switch (kind) {
		case "noop":
			r = { ok: true, done: 0 };
			break;
		case "kv":
			r = await repeat(n, () => ctx.kv.get("probe"));
			break;
		case "kvset":
			r = await repeat(n, (i) => ctx.kv.set(`probe:${i % 4}`, i));
			break;
		case "settings":
			r = await repeat(n, () => ctx.settings.get("probe"));
			break;
		case "get":
			r = await repeat(n, () => rows.get("row_0"));
			break;
		case "put":
			r = await repeat(n, (i) => rows.put(`put_${i % 4}`, { group: "put", pad: "x".repeat(100), i }));
			break;
		case "query":
			r = await repeat(n, () => rows.query({ where: { group: "seed" }, limit: 100 }));
			break;
		case "getMany":
			// n batched reads of `size` ids each (seeded rows row_0..), to see whether one batch is one subrequest.
			r = await repeat(n, () => rows.getMany(Array.from({ length: int(q.size, 100, 1000) }, (_, i) => `row_${i}`)));
			break;
		case "putMany":
			r = await repeat(n, (k) => rows.putMany(Array.from({ length: int(q.size, 100, 1000) }, (_, i) => ({ id: `pm_${i}`, data: { group: "pm", pad: "x".repeat(100), i: k } }))));
			break;
		case "kvlist":
			r = await repeat(n, () => ctx.kv.list("probe"));
			break;
		case "contentRaw":
			// content.get without swallowing errors, so a subrequest refusal shows.
			r = await repeat(n, () => (ctx.content ? ctx.content.get("pages", "no-such-entry") : Promise.resolve(null)));
			break;
		case "content":
			r = await repeat(n, () => (ctx.content ? ctx.content.get("pages", "no-such-entry").catch(() => null) : Promise.resolve(null)));
			break;
		case "fetch":
			r = await repeat(n, () => (ctx.http ? ctx.http.fetch("https://api.kraken.com/0/public/Time").then((x) => x.text()) : Promise.resolve(null)));
			break;
		case "cpu": {
			const iters = int(q.iters, 1_000_000, 900_000_000);
			r = { ok: true, done: 1, result: burn(iters), iters };
			break;
		}
		case "scan": {
			// Pages of 100 seeded rows, each parsed and touched, like Coffer's watch-candidate scan.
			const pages = int(q.pages, 1, 1000);
			let cursor: string | undefined;
			let items = 0;
			let chars = 0;
			r = await repeat(pages, async () => {
				const page = await rows.query({ where: { group: "seed" }, limit: 100, ...(cursor ? { cursor } : {}) });
				for (const it of page.items) chars += (it.data as Row).pad.length;
				items += page.items.length;
				cursor = page.hasMore && page.cursor ? page.cursor : undefined;
				if (!cursor) throw new Error(`end of rows after ${items}`);
			});
			r = { ...r, items, chars };
			break;
		}
		case "seed": {
			// Throwaway data for scans, guarded by a key set on first use (the route is public behind the Access bypass).
			const key = typeof q.key === "string" ? q.key : "";
			const stored = await ctx.kv.get<string>("seedKeyHash");
			const hash = await sha256hex(key);
			if (key.length < 20) return { ok: false, error: "key too short" };
			if (stored && stored !== hash) return { ok: false, error: "wrong key" };
			if (!stored) await ctx.kv.set("seedKeyHash", hash);
			const from = int(q.from, 0, 1_000_000);
			const size = int(q.size, 700, 4000);
			r = await repeat(n, (i) => rows.put(`row_${from + i}`, { group: "seed", pad: "p".repeat(size), i: from + i }));
			break;
		}
		default:
			return { ok: false, error: `unknown kind ${kind}` };
	}
	return { kind, n, wallMs: Date.now() - started, ...r };
}

const plugin: SandboxedPlugin = {
	routes: {
		op: pluginRoute({
			public: true,
			methods: ["GET"],
			cacheControl: "private, no-store",
			request: { body: "none" },
			handler: async (routeCtx, ctx) => {
				const q = (routeCtx.input ?? {}) as Record<string, unknown>;
				// What EmDash passes as requestMeta: is geo set on the Cloudflare runner (and null on Node)?
				if (q.kind === "meta") {
					const m = routeCtx.requestMeta as { ip?: unknown; geo?: unknown } | undefined;
					return { geoPresent: m?.geo !== null && m?.geo !== undefined, geoKeys: m?.geo ? Object.keys(m.geo as object) : [], ipPresent: typeof m?.ip === "string" };
				}
				return op(ctx, q);
			},
		}),
	},
};

export default plugin;
