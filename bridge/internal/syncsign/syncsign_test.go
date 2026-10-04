package syncsign

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The published RFC 8032 section 7.1 secret keys (TEST 1 plays the paired bridge, TEST 2 a wrong key). CLAUDE.md:
// signature test vectors use these and no other private key.
var rfcSeeds = map[string]string{
	"test1": "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
	"test2": "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
}

type vectorFile struct {
	Keys  map[string]struct{ PublicKey string } `json:"keys"`
	Cases []struct {
		Name, Ts, SignedWith, Expected, Body, Message, Signature string
	} `json:"cases"`
}

func rfcKey(t *testing.T, name string) ed25519.PrivateKey {
	seed, _ := hex.DecodeString(rfcSeeds[name])
	return ed25519.NewKeyFromSeed(seed)
}

// The shared vectors (contract/test-vectors/sync-signature.json) bind the Go bridge to the plugin byte for byte.
func TestSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("../../../contract/test-vectors/sync-signature.json")
	if err != nil {
		t.Fatal(err)
	}
	var vf vectorFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		t.Fatal(err)
	}
	for name, k := range vf.Keys {
		if got := base64.StdEncoding.EncodeToString(rfcKey(t, name).Public().(ed25519.PublicKey)); got != k.PublicKey {
			t.Fatalf("key %s: the RFC seed gives %s, the vectors say %s", name, got, k.PublicKey)
		}
	}
	if len(vf.Cases) < 9 {
		t.Fatalf("%d cases", len(vf.Cases))
	}
	paired := rfcKey(t, "test1").Public().(ed25519.PublicKey)
	for _, c := range vf.Cases {
		body, _ := base64.StdEncoding.DecodeString(c.Body)
		msg, _ := base64.StdEncoding.DecodeString(c.Message)
		if got := Message(c.Ts, body); string(got) != string(msg) && c.Expected != "BAD_SIGNATURE" {
			t.Errorf("%s: message differs", c.Name)
		}
		if c.Expected != "BAD_SIGNATURE" {
			// Ed25519 is deterministic: the bridge's signer must reproduce the plugin side's signature exactly.
			if got := Sign(rfcKey(t, c.SignedWith), c.Ts, body); got != c.Signature {
				t.Errorf("%s: signature %s, want %s", c.Name, got, c.Signature)
			}
		}
		sig, _ := base64.StdEncoding.DecodeString(c.Signature)
		ok := ed25519.Verify(paired, Message(c.Ts, body), sig)
		if ok != (c.Expected != "BAD_SIGNATURE") {
			t.Errorf("%s: verifies=%v, expected %s", c.Name, ok, c.Expected)
		}
	}
}

func TestKeyFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "bridge.key")
	k, err := NewKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := SaveKey(p, k); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(p)
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", fi.Mode().Perm())
	}
	got, err := LoadKey(p)
	if err != nil || !got.Equal(k) {
		t.Fatalf("round trip: %v", err)
	}
	// Replacing it is atomic and leaves nothing behind.
	k2, _ := NewKey()
	if err := SaveKey(p, k2); err != nil {
		t.Fatal(err)
	}
	if got, _ := LoadKey(p); !got.Equal(k2) {
		t.Fatal("not replaced")
	}
	if e, _ := os.ReadDir(dir); len(e) != 1 {
		t.Fatalf("leftovers %v", e)
	}
	os.Chmod(p, 0o640)
	if _, err := LoadKey(p); err == nil || !strings.Contains(err.Error(), "chmod 600") {
		t.Fatalf("readable key: %v", err)
	}
	os.Chmod(p, 0o600)
	os.WriteFile(p, []byte("short"), 0o600)
	if _, err := LoadKey(p); err == nil {
		t.Fatal("a malformed key loaded")
	}
	if _, err := LoadKey(filepath.Join(dir, "none")); !os.IsNotExist(err) {
		t.Fatalf("missing key: %v", err)
	}
}

func TestPublicKeyText(t *testing.T) {
	k := rfcKey(t, "test1")
	if got := PublicKeyText(k); got != "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=" {
		t.Fatalf("got %s", got)
	}
}
