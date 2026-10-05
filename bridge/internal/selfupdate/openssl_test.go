package selfupdate

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestOpenSSLSignature checks that a release signed the way scripts/sign-dev-release.sh does it (openssl pkeyutl
// -sign -rawin over "xmr-bridge-release-v1\n" + release.json, base64) verifies here: XMR_BRIDGE_OPENSSL_DIR holds
// release.json, release.json.sig and pub.b64 (the raw public key, base64). Skipped by default.
func TestOpenSSLSignature(t *testing.T) {
	dir := os.Getenv("XMR_BRIDGE_OPENSSL_DIR")
	if dir == "" {
		t.Skip("set XMR_BRIDGE_OPENSSL_DIR")
	}
	m, _ := os.ReadFile(filepath.Join(dir, "release.json"))
	sig, _ := os.ReadFile(filepath.Join(dir, "release.json.sig"))
	raw, _ := os.ReadFile(filepath.Join(dir, "pub.b64"))
	pub, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(pub) != ed25519.PublicKeySize {
		t.Fatal("pub.b64")
	}
	got, err := VerifyManifest(m, sig, []ed25519.PublicKey{pub})
	if err != nil {
		t.Fatalf("an openssl signature didn't verify: %v", err)
	}
	t.Logf("openssl-signed release %s verifies", got.Version)
	// And a changed byte doesn't.
	if _, err := VerifyManifest(append(m[:len(m)-1:len(m)-1], ' '), sig, []ed25519.PublicKey{pub}); err == nil {
		t.Fatal("a changed release.json verified")
	}
}
