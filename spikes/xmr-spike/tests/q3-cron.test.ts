// Spike Q3 in the plugin test host: cron scheduled from plugin:install, fired by the host scheduler, kept across restart.
// The real question (Node runner granularity over 15 minutes, survival across a dev-site restart) is scripts/cron-watch.mjs.
import { afterEach, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let host: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

async function cronLog() {
	const res = await (host as PluginRuntimeTestHost).actions.routes.request("cron-log", { method: "GET" });
	return ((await res.json()) as { data: { install: any; activate: any; tasks: any; log: Array<{ ranAt: string; scheduledAt: string }> } }).data;
}

it("plugin:activate schedules the task; the scheduler fires it; it survives a restart", async ({ task }) => {
	host = await createPluginRuntimeTestHost();
	const beforeActivate = await cronLog();
	await host.actions.plugin.activate();
	const atStart = await cronLog();
	const hostTasks = await host.inspect.scheduledTasks();

	const t0 = new Date(Date.parse(atStart.tasks?.[0]?.nextRunAt ?? new Date().toISOString()) + 1000);
	host.scheduled.setTime(t0);
	const run1 = await host.scheduled.run();
	const afterRun1 = await cronLog();

	host.scheduled.setTime(new Date(t0.getTime() + 60_000));
	const run2 = await host.scheduled.run();
	const afterRun2 = await cronLog();

	await host.restart();
	const afterRestart = await cronLog();

	Object.assign(task.meta, { beforeActivate, atStart, hostTasks, run1, afterRun1: afterRun1.log, run2, afterRun2: afterRun2.log, afterRestart });

	// plugin:install is not run by the test host (EmDash runs it only for registry/marketplace installs).
	expect(beforeActivate.install).toBeNull();
	expect(atStart.tasks).toEqual([expect.objectContaining({ name: "minute", schedule: "* * * * *" })]);
	expect(afterRun1.log.length).toBeGreaterThanOrEqual(1);
	expect(afterRun2.log.length).toBeGreaterThan(afterRun1.log.length);
	expect(afterRestart.tasks).toEqual([expect.objectContaining({ name: "minute" })]);
	expect(afterRestart.log.length).toBe(afterRun2.log.length);
});
