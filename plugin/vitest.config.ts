import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [emdashPluginTest()],
	// One worker: the dev box has 8 GB of RAM at most (CLAUDE.md, "Memory"). 30 s per test instead of vitest's 5 s: the
	// runtime-host tests write many storage fixtures one by one, and a shared CI runner can be several times slower than
	// the dev box (CI run 37866556943 timed out a 0.7 s test). A real hang still fails.
	test: { maxWorkers: 1, testTimeout: 30_000 },
});
