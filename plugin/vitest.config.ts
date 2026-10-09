import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [emdashPluginTest()],
	// One worker: the dev box has 8 GB of RAM at most (CLAUDE.md, "Memory").
	test: { maxWorkers: 1 },
});
