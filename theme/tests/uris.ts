// Real-shaped monero: URIs for the QR tests: 95-character stagenet subaddresses (base58, made up, not real addresses),
// 12-decimal amounts, percent-encoded descriptions, as the plugin's paymentUri builds them (spec change 32).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const address = (seed: number) => `7${Array.from({ length: 94 }, (_, i) => B58[(seed * 31 + i * 17 + i * i) % B58.length]).join("")}`;

export const URIS = {
	product: `monero:${address(1)}?tx_amount=0.080000000000&tx_description=Test%20handbook`,
	awkwardTitle: `monero:${address(2)}?tx_amount=12.345678901234&tx_description=${encodeURIComponent("Mugs & Tea? 100% — café ☕")}`,
	longTitle: `monero:${address(3)}?tx_amount=0.000000000001&tx_description=${encodeURIComponent("x".repeat(100))}`,
	testTip: `monero:${address(4)}?tx_amount=0.000100000000&tx_description=Coffer%20test%20tip`,
	addressOnly: `monero:${address(5)}`,
} as const;
