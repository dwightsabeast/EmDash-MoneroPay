// The few Node APIs tests/qr-decode.test.ts uses, declared by hand: @types/node isn't a dependency of this package
// (CLAUDE.md, "Dependency tiers"). Tests only; nothing in src/ may use these.
declare module "node:child_process" {
	export function spawnSync(command: string, args: string[], options?: { encoding?: "utf8" }): { status: number | null; stdout: string; stderr: string; error?: Error };
}
declare module "node:fs" {
	export function mkdtempSync(prefix: string): string;
	export function writeFileSync(path: string, data: Uint8Array): void;
	export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module "node:os" {
	export function tmpdir(): string;
}
declare module "node:path" {
	export function join(...parts: string[]): string;
}
declare const process: { env: Record<string, string | undefined> };
