// Vite's `?raw` imports (a file's text), used by tests/manifest.test.ts to read emdash-plugin.jsonc in the sandbox.
declare module "*?raw" {
	const text: string;
	export default text;
}
