import { defineConfig } from "vitest/config";

export default defineConfig({
	// One worker: the dev box has 8 GB of RAM at most (CLAUDE.md, "Memory"). 20 s a test, as in plugin/: CI runners have
	// run 7x slower than the dev box.
	test: { maxWorkers: 1, testTimeout: 20_000 },
});
