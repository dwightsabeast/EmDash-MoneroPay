package hashsig

// The Monero release signing key (binaryFate), pinned. Its public key is published in the monero-project repository
// (utils/gpg_keys/binaryfate.asc; a copy is in testdata). It signs hashes.txt with the primary key itself (checked
// 2026-10-04: v4, RSA, SHA-256, class 0x01). A new Monero key reaches wallet hosts only through a signed bridge
// update (spec revision 70, "Key rotation"). init recomputes the v4 fingerprint from these values and panics if it
// differs, so a wrong constant can't ship; TestPinnedKeyMatchesPublishedKey compares them with the published file.
const (
	moneroKeyFingerprint = "81ac591fe9c4b65c5806afc3f0af4d462a0bdf92"
	moneroKeyCreated     = 1576144572 // 2019-12-12
	moneroKeyE           = "010001"
	moneroKeyN           = "" +
		"b55200922c82ec6ddad293991f70460a32f8fb949a48223f43e8b79ec88be8be03bb6de334eb7705093d2ff911f70952" +
		"95f1b08226bf2d791dd9824f88788e82d02424fa872a96ed2a04000b759c86c99a27a336dc94718e7d0d2b584cb4d55f" +
		"d3077e9b1a1aec13f70cf27848089ef63e4bf7aebba4664a6bc6f109f88602936e949a2b9e2b5f8f9b4b1432bc404146" +
		"25be0f2bd6cc0e80b3aea3bafc73581962f1a2c5d6f4b7b981cd482449d98551e01afd7f165b304f165b963327ad1942" +
		"b3ad5eba5b52121c78bfd80c978a6db7e4ba9ce0c6cad8e6ca7e46490a30bbcb669fb39312b7eb9e8f3f1b7212cc33f2" +
		"ef5764f12886de9e1a3b671b4677c6e535100f7ba153380fb238ce746ad25a8755b70662f1b3193882f208dbfce5cda5" +
		"b844d132d4c6bfe3b0c834fc1807d040ec5a85ec14d5b7c5b1a49e58dbef1a479f19b4cfaa39b6cee6cd8ef24b838fde" +
		"2a40a013f1bb5eb5b6ffa4c2a11775d74804643593f334516d4b2f714a29fe84b016a4cd1b71fb44b49ac4ec763b0c73" +
		"9af49e0fff116a2d2427646a42960e65c91c37e2453597cb00ce8bc59e0376667f91624896cb5e08fae855385ceba07d" +
		"b2988613c10d1cad027839882dab3bf445cf94da64eb4c4f8c446dbc08eb01aa832f59aa3d2b86e1b0feaa526953b4c5" +
		"45a1be003f7785a85df083df3bcea79e0aa6a274073b9f97ee2474c318d585c5"
)
