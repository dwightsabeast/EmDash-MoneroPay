/**
 * Housekeeping (docs/spec.md, "Housekeeping", spec change 2): runs after each bridge/sync in small bounded batches,
 * and from the backup cron. Expiry, the reorg rule and ending watches already happen when snapshots are applied;
 * what is left is the 30-day buyer-data purge, which goes by the calendar.
 */
import type { PluginContext } from "emdash/plugin";

import { KV, invoices } from "./store";

export const PURGE_MS = 30 * 24 * 3_600_000;
export const PURGE_BATCH = 25;
export const CRON_TASK = "housekeeping";
export const CRON_SCHEDULE = "0 * * * *"; // hourly: the cron is only a backup

/** Purges buyer contact data from up to PURGE_BATCH invoices final for 30 days, resuming where the last batch stopped. */
export async function purgeBatch(ctx: PluginContext, now: number): Promise<number> {
	const col = invoices(ctx);
	const cursor = (await ctx.kv.get<string>(KV.purgeCursor)) ?? undefined;
	const page = await col.query({
		// finalAt is at least expiresAt, so anything final for 30 days expired at least 30 days ago.
		where: { expiresAt: { lt: now - PURGE_MS } },
		orderBy: { expiresAt: "asc" },
		limit: PURGE_BATCH,
		...(cursor ? { cursor } : {}),
	});
	let purged = 0;
	for (const { id, data } of page.items) {
		if (data.buyer && data.finalAt !== undefined && now >= data.finalAt + PURGE_MS) {
			const { buyer: _removed, ...rest } = data;
			await col.put(id, rest);
			purged++;
		}
	}
	if (page.hasMore && page.cursor) await ctx.kv.set(KV.purgeCursor, page.cursor);
	else await ctx.kv.delete(KV.purgeCursor);
	return purged;
}

/** Schedules the backup cron (idempotent: schedule() upserts by name). */
export async function ensureCron(ctx: PluginContext): Promise<void> {
	if (!ctx.cron) return;
	await ctx.cron.schedule(CRON_TASK, { schedule: CRON_SCHEDULE });
	await ctx.kv.set(KV.cronScheduled, true);
}
