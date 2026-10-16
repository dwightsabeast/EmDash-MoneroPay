// Vite's `?raw` imports (a file's text), used by tests/vendor.test.ts to hash the vendored QR encoder.
declare module "*?raw" {
	const text: string;
	export default text;
}
