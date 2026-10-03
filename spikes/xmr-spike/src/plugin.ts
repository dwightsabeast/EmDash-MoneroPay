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

// Q4: what ctx.settings gives a sandboxed plugin. Reports types and lengths only, never values.
function describe(value: unknown) {
	if (value === null || value === undefined) return { type: String(value) };
	if (typeof value === "string") return { type: "string", length: value.length };
	if (typeof value === "object") return { type: "object", keys: Object.keys(value as object).sort() };
	return { type: typeof value };
}

// Q6: atomic pool claims with updateIf. Public only because this is a throwaway spike on a dev box.
type PoolRow = { addrIndex: number; address: string; status: "free" | "claimed"; invoiceId?: string };

function errorName(err: unknown) {
	return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// Q3: cron scheduled from plugin:install, logging each run's timestamps to KV (capped).
const CRON_LOG_KEY = "state:cron-log";
type CronLogEntry = { name: string; scheduledAt: string; ranAt: string };

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": async (_event, ctx) => {
			const at = new Date().toISOString();
			if (!ctx.cron) {
				await ctx.kv.set("state:install", { at, cron: "ctx.cron is undefined" });
				return;
			}
			await ctx.cron.schedule("minute", { schedule: "* * * * *" });
			await ctx.kv.set("state:install", { at, cron: "scheduled", tasks: await ctx.cron.list() });
		},
		"plugin:activate": async (_event, ctx) => {
			const at = new Date().toISOString();
			const seen = (await ctx.kv.get<string[]>("state:activate")) ?? [];
			seen.push(at);
			await ctx.kv.set("state:activate", seen.slice(-50));
			if (ctx.cron) await ctx.cron.schedule("minute", { schedule: "* * * * *" });
		},
		cron: async (event, ctx) => {
			const log = (await ctx.kv.get<CronLogEntry[]>(CRON_LOG_KEY)) ?? [];
			log.push({ name: event.name, scheduledAt: event.scheduledAt, ranAt: new Date().toISOString() });
			await ctx.kv.set(CRON_LOG_KEY, log.slice(-500));
		},
	},
	routes: {
		// Config-managed plugins get neither plugin:install nor plugin:activate at startup (EmDash 1.1.0),
		// so the spike can also schedule on request. Idempotent: schedule() upserts by name.
		"cron-schedule": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "none" },
			handler: async (_routeCtx, ctx) => {
				if (!ctx.cron) return { scheduled: false, reason: "ctx.cron is undefined" };
				await ctx.cron.schedule("minute", { schedule: "* * * * *" });
				await ctx.kv.set("state:route-scheduled", new Date().toISOString());
				return { scheduled: true, tasks: await ctx.cron.list() };
			},
		}),
		"cron-log": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			handler: async (_routeCtx, ctx) => ({
				install: await ctx.kv.get("state:install"),
				activate: await ctx.kv.get("state:activate"),
				routeScheduled: await ctx.kv.get("state:route-scheduled"),
				tasks: ctx.cron ? await ctx.cron.list() : "ctx.cron is undefined",
				log: (await ctx.kv.get<CronLogEntry[]>(CRON_LOG_KEY)) ?? [],
			}),
		}),
		"pool-seed": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "json" },
			handler: async (routeCtx, ctx) => {
				const { count } = (routeCtx.input ?? {}) as { count?: number };
				const n = Number.isSafeInteger(count) && (count as number) > 0 && (count as number) <= 100 ? (count as number) : 1;
				const pool = ctx.storage.pool;
				const old = await pool.query({ limit: 100 });
				await pool.deleteMany(old.items.map((i) => i.id));
				await pool.putMany(
					Array.from({ length: n }, (_, i) => ({
						id: `row-${i + 1}`,
						data: { addrIndex: i + 1, address: `spike-address-${i + 1}`, status: "free" } satisfies PoolRow,
					})),
				);
				return { seeded: n, free: await pool.count({ status: "free" }) };
			},
		}),
		"pool-claim-row": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "json" },
			handler: async (routeCtx, ctx) => {
				const { id, claimer } = (routeCtx.input ?? {}) as { id?: string; claimer?: string };
				try {
					const r = await ctx.storage.pool.updateIf(String(id), {
						where: { status: "free" },
						set: { status: "claimed", invoiceId: String(claimer) },
					});
					return { applied: r.applied, row: r.applied ? r.data : null };
				} catch (err) {
					return { applied: false, error: errorName(err) };
				}
			},
		}),
		"pool-claim-any": pluginRoute({
			public: true,
			methods: ["POST"],
			request: { body: "json" },
			handler: async (routeCtx, ctx) => {
				const { claimer } = (routeCtx.input ?? {}) as { claimer?: string };
				const pool = ctx.storage.pool;
				const errors: string[] = [];
				// Bounded claim loop: find a free row, try to claim it; on a lost race or a serialization error, try again.
				for (let attempt = 1; attempt <= 25; attempt++) {
					const free = await pool.query({ where: { status: "free" }, orderBy: { addrIndex: "asc" }, limit: 5 });
					if (free.items.length === 0) return { claimed: null, attempts: attempt, errors, code: "NO_ADDRESS_AVAILABLE" };
					// Spread claimers over the first few free rows to reduce collisions.
					const pick = free.items[attempt % free.items.length];
					try {
						const r = await pool.updateIf(pick.id, { where: { status: "free" }, set: { status: "claimed", invoiceId: String(claimer) } });
						if (r.applied) return { claimed: pick.id, attempts: attempt, errors };
					} catch (err) {
						errors.push(errorName(err));
					}
				}
				return { claimed: null, attempts: 25, errors, code: "GAVE_UP" };
			},
		}),
		"pool-list": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			handler: async (_routeCtx, ctx) => {
				const rows = await ctx.storage.pool.query({ orderBy: { addrIndex: "asc" }, limit: 100 });
				return rows.items.map((i) => ({ id: i.id, ...(i.data as PoolRow) }));
			},
		}),
		"settings-probe": pluginRoute({
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			handler: async (_routeCtx, ctx) => {
				const settings = ctx.settings as unknown as Record<string, unknown> | undefined;
				return {
					hasSettings: settings !== undefined,
					methods: settings ? Object.keys(Object.getPrototypeOf(settings) ?? {}).concat(Object.keys(settings)).sort() : [],
					secretViaSettings: describe(await ctx.settings.get("spikeSecret")),
					noteViaSettings: describe(await ctx.settings.get("spikeNote")),
					secretViaKv: describe(await ctx.kv.get("settings:spikeSecret")),
					noteViaKv: describe(await ctx.kv.get("settings:spikeNote")),
					listedKeys: (await ctx.settings.list()).map((e) => e.key).sort(),
				};
			},
		}),
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
