package selfupdate

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"0.1.1", "0.1.0", true}, {"0.1.0", "0.1.0", false}, {"0.1.0", "0.1.1", false}, {"1.0.0", "0.9.9", true},
		{"0.0.202610050102-dev.abc", "0.0.202610050101-dev.def", true}, {"0.0.5-dev.x", "0.0.5", false},
		{"0.18.5.2", "0.18.5.1", true}, {"0.18.10.0", "0.18.9.9", true}, {"0.18.5.1", "0.18.5.1", false}, {"0.19.0.0", "0.18.99.99", true},
	} {
		if got := Newer(c.a, c.b); got != c.want {
			t.Errorf("Newer(%s, %s) = %v", c.a, c.b, got)
		}
	}
	for _, bad := range []string{"", "1", "1.x.0", "v1.0.0", "1..0"} {
		if _, err := parseVersion(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func keyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func sign(priv ed25519.PrivateKey, manifest []byte) []byte {
	sig := ed25519.Sign(priv, append([]byte(SignaturePrefix), manifest...))
	return []byte(base64.StdEncoding.EncodeToString(sig) + "\n")
}

var manifestJSON = `{"product":"xmr-bridge","version":"0.2.0","date":"2026-10-01T00:00:00Z",
 "files":[{"name":"xmr-bridge-0.2.0-linux-amd64","os":"linux","arch":"amd64","sha256":"` + strings.Repeat("a", 64) + `","size":10}]}`

func TestVerifyManifest(t *testing.T) {
	pub, priv := keyPair(t)
	other, otherPriv := keyPair(t)
	m := []byte(manifestJSON)
	got, err := VerifyManifest(m, sign(priv, m), []ed25519.PublicKey{other, pub})
	if err != nil || got.Version != "0.2.0" || got.Date != time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC) || got.Files[0].Size != 10 {
		t.Fatalf("%+v %v", got, err)
	}
	for name, c := range map[string]struct {
		m, sig []byte
		keys   []ed25519.PublicKey
	}{
		"wrong key":      {m, sign(otherPriv, m), []ed25519.PublicKey{pub}},
		"changed byte":   {[]byte(strings.Replace(manifestJSON, "0.2.0", "0.3.0", 1)), sign(priv, m), []ed25519.PublicKey{pub}},
		"no prefix":      {m, []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, m))), []ed25519.PublicKey{pub}},
		"no keys pinned": {m, sign(priv, m), nil},
		"garbage sig":    {m, []byte("not base64"), []ed25519.PublicKey{pub}},
		"other product":  {[]byte(strings.Replace(manifestJSON, "xmr-bridge\"", "other\"", 1)), nil, []ed25519.PublicKey{pub}},
		"bad version":    {[]byte(strings.Replace(manifestJSON, "\"0.2.0\"", "\"two\"", 1)), nil, []ed25519.PublicKey{pub}},
	} {
		sig := c.sig
		if sig == nil {
			sig = sign(priv, c.m)
		}
		if _, err := VerifyManifest(c.m, sig, c.keys); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestStateFiles(t *testing.T) {
	dir := t.TempDir()
	s := Files{DataDir: dir}
	if p, ok := s.Pending(); ok || p.Kind != "" {
		t.Fatal("pending on a fresh install")
	}
	if err := s.SetPending(Pending{Kind: KindBridge, Version: "0.2.0", Previous: "0.1.0", At: time.Unix(1790000000, 0).UTC()}); err != nil {
		t.Fatal(err)
	}
	p, ok := s.Pending()
	if !ok || p.Kind != KindBridge || p.Version != "0.2.0" || p.Previous != "0.1.0" || p.At.Unix() != 1790000000 {
		t.Fatalf("%+v", p)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "run", "update-pending"))
	if !strings.Contains(string(raw), "kind=bridge\n") {
		t.Fatalf("the guard reads plain lines: %q", raw)
	}
	s.MarkStarted()
	if n := s.StartCount(); n != 0 {
		t.Fatalf("count %d", n)
	}
	os.WriteFile(filepath.Join(dir, "run", "start-count"), []byte("3\n"), 0o600)
	if s.StartCount() != 3 {
		t.Fatal("count not read")
	}
	s.ClearPending()
	if _, ok := s.Pending(); ok {
		t.Fatal("not cleared")
	}
	// Refused versions: the guard appends "<kind>=<version>" lines; only a newer version clears one.
	os.WriteFile(filepath.Join(dir, "run", "refused"), []byte("bridge=0.2.0\nwallet-rpc=0.18.6.0\n"), 0o600)
	if !s.Refused(KindBridge, "0.2.0") || !s.Refused(KindBridge, "0.1.9") || s.Refused(KindBridge, "0.2.1") || !s.Refused(KindWalletRPC, "0.18.6.0") || s.Refused(KindWalletRPC, "0.18.6.1") {
		t.Fatal("refused rule")
	}
	s.Refuse(KindBridge, "0.3.0")
	if !s.Refused(KindBridge, "0.2.5") || s.Refused(KindBridge, "0.3.1") {
		t.Fatal("the highest refused version wins")
	}
	for _, f := range []string{"update-pending", "start-count", "refused", "update-state.json"} {
		if fi, err := os.Stat(filepath.Join(dir, "run", f)); err == nil && fi.Mode().Perm() != 0o600 {
			t.Errorf("%s mode %v", f, fi.Mode().Perm())
		}
	}
}

func TestFirstSeenAndFormat(t *testing.T) {
	dir := t.TempDir()
	s := Files{DataDir: dir}
	t0 := time.Unix(1790000000, 0).UTC()
	if got := s.FirstSeen(KindWalletRPC, "0.18.6.0", t0); !got.Equal(t0) {
		t.Fatal("first sighting")
	}
	if got := s.FirstSeen(KindWalletRPC, "0.18.6.0", t0.Add(time.Hour)); !got.Equal(t0) {
		t.Fatal("first-seen time must stick")
	}
	if got := s.FirstSeen(KindWalletRPC, "0.18.6.1", t0.Add(2*time.Hour)); !got.Equal(t0.Add(2 * time.Hour)) {
		t.Fatal("a new version starts its own wait")
	}
	if err := CheckFormat(dir); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "run", "update-state.json"), []byte(`{"format":99}`), 0o600)
	err := CheckFormat(dir)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "re-run the installer") {
		t.Fatalf("a newer format: %v", err)
	}
	if err := CheckFormat(t.TempDir()); err != nil {
		t.Fatalf("no state yet: %v", err)
	}
}

// The running bridge writes its state format at every start, so an admin copy can always compare (Wyatt, 3g):
// without it, update-state.json only appears once a wallet-rpc version has been seen.
func TestWriteFormat(t *testing.T) {
	dir := t.TempDir()
	f := Files{DataDir: dir}
	if err := f.WriteFormat(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "run", "update-state.json"))
	if err != nil || !strings.Contains(string(raw), `"format":1`) {
		t.Fatalf("%s %v", raw, err)
	}
	// It keeps what else is there.
	f.FirstSeen(KindWalletRPC, "0.18.6.0", time.Unix(1790000000, 0))
	f.WriteFormat()
	if got := f.FirstSeen(KindWalletRPC, "0.18.6.0", time.Unix(1790009999, 0)); got.Unix() != 1790000000 {
		t.Fatal("WriteFormat lost the first-seen time")
	}
}
