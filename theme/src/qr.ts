/**
 * QR codes for monero: payment URIs, drawn on the server as inline SVG (phase 06; the theme's privacy rules: no QR web
 * service, no third-party asset). The symbol comes from Project Nayuki's encoder, vendored at a pinned commit
 * (src/vendor/qrcodegen/SOURCE.md): byte mode, error correction M.
 *
 * A QR bug can't send money to a different valid address, but it can make paying impossible, so tests decode every
 * symbol with an independent decoder (tests/qr-decode.test.ts, ZBar in CI).
 */
import { qrcodegen } from "./vendor/qrcodegen/qrcodegen";

/** Light modules around the symbol, in modules: the 4 the standard requires. */
export const QUIET_ZONE = 4;

/** The symbol's modules, row by row (true is dark), for the URI's UTF-8 bytes. */
export function qrModules(text: string): boolean[][] {
	const qr = qrcodegen.QrCode.encodeBinary(Array.from(new TextEncoder().encode(text)), qrcodegen.QrCode.Ecc.MEDIUM);
	return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.getModule(x, y)));
}

/**
 * The symbol as an SVG string: a light background and one path of dark modules (each row's runs merged), scaled by
 * its container. Colors are presentation attributes, black on white, which CSS overrides through the classes
 * `coffer-qr-light` and `coffer-qr-dark`. No style attribute, so a page's CSP needs no 'unsafe-inline'.
 */
export function qrSvg(text: string): string {
	const modules = qrModules(text);
	const side = modules.length + 2 * QUIET_ZONE;
	const runs: string[] = [];
	modules.forEach((row, y) => {
		for (let x = 0; x < row.length; ) {
			if (!row[x]) {
				x++;
				continue;
			}
			let w = 1;
			while (x + w < row.length && row[x + w]) w++;
			runs.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${w}v1h-${w}z`);
			x += w;
		}
	});
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" class="coffer-qr" role="img" aria-label="QR code of the payment link" shape-rendering="crispEdges">` +
		`<rect class="coffer-qr-light" width="${side}" height="${side}" fill="#fff"/>` +
		`<path class="coffer-qr-dark" fill="#000" d="${runs.join("")}"/>` +
		`</svg>`
	);
}
