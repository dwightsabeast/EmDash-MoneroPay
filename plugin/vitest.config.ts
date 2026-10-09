import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [emdashPluginTest()],
	// One worker: the dev box has 8 GB of RAM at most (CLAUDE.md, "Memory"). 20 s a test: each route test starts its own
	// workerd host, and CI runners have run 7x slower than the dev box (runs 37866556943 and 37994601431, where a test
	// taking 0.7 s here passed 5 s).
	test: { maxWorkers: 1, testTimeout: 20_000 },
});
