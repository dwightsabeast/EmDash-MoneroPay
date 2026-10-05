package selfupdate

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/monerodl"
)

var t0 = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)

// release builds a signed release served over HTTP: a fake bridge binary that answers "version".
type release struct {
	srv   *httptest.Server
	files map[string][]byte
	pub   ed25519.PublicKey
	priv  ed25519.PrivateKey
}

func newRelease(t *testing.T) *release {
	r := &release{files: map[string][]byte{}}
	r.pub, r.priv = keyPair(t)
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		b, ok := r.files[strings.TrimPrefix(req.URL.Path, "/")]
		if !ok {
			http.NotFound(w, req)
			return
		}
		w.Write(b)
	}))
	t.Cleanup(r.srv.Close)
	return r
}

// publish signs a release of version v dated date, whose binary reports reports.
func (r *release) publish(v string, date time.Time, reports string) {
	bin := []byte("#!/bin/sh\necho \"xmr-bridge " + reports + " (go, linux/amd64)\"\n")
	name := "xmr-bridge-" + v + "-linux-amd64"
	sum := sha256.Sum256(bin)
	m, _ := json.Marshal(Manifest{Product: "xmr-bridge", Version: v, Date: date,
		Files: []File{{Name: name, OS: "linux", Arch: "amd64", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(bin))}}})
	r.files["release.json"] = m
	r.files["release.json.sig"] = sign(r.priv, m)
	r.files[name] = bin
}

func updater(t *testing.T, r *release, current string) (*Updater, string) {
	d := t.TempDir()
	os.MkdirAll(filepath.Join(d, "bin"), 0o755)
	os.MkdirAll(filepath.Join(d, "wallet"), 0o700)
	os.WriteFile(filepath.Join(d, "bin", "xmr-bridge"), []byte("current bridge"), 0o755)
	return &Updater{BaseURL: r.srv.URL, Keys: []ed25519.PublicKey{r.pub}, Delay: 48 * time.Hour, Current: current, Arch: "amd64",
		DataDir: d, HTTP: r.srv.Client(), Now: func() time.Time { return t0 }}, d
}

func TestBridgeUpdate(t *testing.T) {
	r := newRelease(t)
	r.publish("0.2.0", t0.Add(-49*time.Hour), "0.2.0")
	u, d := updater(t, r, "0.1.0")
	p, err := u.PrepareBridge(context.Background())
	if err != nil || p == nil || p.Version != "0.2.0" {
		t.Fatalf("%+v %v", p, err)
	}
	if read(t, d, "bin/xmr-bridge") != "current bridge" {
		t.Fatal("preparing must not touch the running binary")
	}
	f := Files{DataDir: d}
	if err := p.Apply(f, t0); err != nil {
		t.Fatal(err)
	}
	if read(t, d, "bin/xmr-bridge.prev") != "current bridge" || !strings.Contains(read(t, d, "bin/xmr-bridge"), "0.2.0") {
		t.Fatal("not swapped")
	}
	if fi, _ := os.Stat(filepath.Join(d, "bin/xmr-bridge")); fi.Mode().Perm() != 0o755 {
		t.Fatalf("mode %v", fi.Mode().Perm())
	}
	pend, ok := f.Pending()
	if !ok || pend.Kind != KindBridge || pend.Version != "0.2.0" || pend.Previous != "0.1.0" {
		t.Fatalf("%+v", pend)
	}
}

func TestBridgeNothingToDo(t *testing.T) {
	for name, c := range map[string]struct {
		version, reports, current string
		date                      time.Time
	}{
		"same version":        {"0.1.0", "0.1.0", "0.1.0", t0.Add(-100 * time.Hour)},
		"older version":       {"0.0.9", "0.0.9", "0.1.0", t0.Add(-100 * time.Hour)},
		"inside the 48 hours": {"0.2.0", "0.2.0", "0.1.0", t0.Add(-47 * time.Hour)},
	} {
		t.Run(name, func(t *testing.T) {
			r := newRelease(t)
			r.publish(c.version, c.date, c.reports)
			u, d := updater(t, r, c.current)
			if p, err := u.PrepareBridge(context.Background()); err != nil || p != nil {
				t.Fatalf("%+v %v", p, err)
			}
			if _, err := os.Stat(filepath.Join(d, "bin/xmr-bridge.new")); !os.IsNotExist(err) {
				t.Fatal("downloaded anyway")
			}
		})
	}
}

func TestBridgeRefuses(t *testing.T) {
	cases := map[string]func(r *release, u *Updater){
		"tampered binary": func(r *release, u *Updater) {
			r.files["xmr-bridge-0.2.0-linux-amd64"] = append(r.files["xmr-bridge-0.2.0-linux-amd64"], ' ')
		},
		"wrong key": func(r *release, u *Updater) {
			other, _ := keyPair(t)
			u.Keys = []ed25519.PublicKey{other}
		},
		"no key pinned":                  func(r *release, u *Updater) { u.Keys = nil },
		"binary reports another version": func(r *release, u *Updater) { r.publish("0.2.0", t0.Add(-49*time.Hour), "0.1.9") },
		"no file for this CPU":           func(r *release, u *Updater) { u.Arch = "arm64" },
		"plain http to elsewhere":        func(r *release, u *Updater) { u.BaseURL = "http://127.0.0.1:1" },
	}
	for name, tweak := range cases {
		t.Run(name, func(t *testing.T) {
			r := newRelease(t)
			r.publish("0.2.0", t0.Add(-49*time.Hour), "0.2.0")
			u, d := updater(t, r, "0.1.0")
			tweak(r, u)
			p, err := u.PrepareBridge(context.Background())
			if err == nil || p != nil {
				t.Fatalf("accepted: %+v", p)
			}
			if name == "no key pinned" && !errors.Is(err, ErrNoKey) {
				t.Fatalf("%v", err)
			}
			if read(t, d, "bin/xmr-bridge") != "current bridge" {
				t.Fatal("the running binary changed")
			}
			if e, _ := filepath.Glob(filepath.Join(d, "bin", ".xmr-bridge-*")); len(e) != 0 {
				t.Fatalf("leftovers %v", e)
			}
		})
	}
}

// Wyatt's 1a: update -> rollback -> the next daily check skips that version; only a newer one is installed.
func TestRefusedAfterRollback(t *testing.T) {
	r := newRelease(t)
	r.publish("0.2.0", t0.Add(-49*time.Hour), "0.2.0")
	u, d := updater(t, r, "0.1.0")
	f := Files{DataDir: d}
	p, _ := u.PrepareBridge(context.Background())
	p.Apply(f, t0)
	pend, _ := f.Pending()
	if err := Rollback(f, pend); err != nil {
		t.Fatal(err)
	}
	if read(t, d, "bin/xmr-bridge") != "current bridge" {
		t.Fatal("not rolled back")
	}
	if p, err := u.PrepareBridge(context.Background()); err != nil || p != nil {
		t.Fatalf("the refused version came back: %+v %v", p, err)
	}
	r.publish("0.2.1", t0.Add(-49*time.Hour), "0.2.1")
	if p, err := u.PrepareBridge(context.Background()); err != nil || p == nil || p.Version != "0.2.1" {
		t.Fatalf("a newer version must clear the refusal: %+v %v", p, err)
	}
}

// Wyatt's 1b: the 10-minute rule counts only answers from the site.
func TestDecide(t *testing.T) {
	p := Pending{Kind: KindBridge, Version: "0.2.0", At: t0}
	for name, c := range map[string]struct {
		h    Health
		now  time.Time
		want Action
	}{
		"synced":                         {Health{WalletOpen: true, Synced: 1}, t0.Add(time.Minute), Commit},
		"early":                          {Health{WalletOpen: true, SiteRefused: 3}, t0.Add(9 * time.Minute), Wait},
		"site refused, never synced":     {Health{WalletOpen: true, SiteRefused: 5}, t0.Add(11 * time.Minute), RollBack},
		"site unreachable (no rollback)": {Health{WalletOpen: true, Unreachable: 50}, t0.Add(3 * time.Hour), Wait},
		"network down at first":          {Health{WalletOpen: true, Unreachable: 30, Synced: 1}, t0.Add(time.Hour), Commit},
		"wallet never opened":            {Health{}, t0.Add(11 * time.Minute), RollBack},
	} {
		if got := Decide(p, c.h, c.now); got != c.want {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
	w := Pending{Kind: KindWalletRPC, Version: "0.18.6.0", At: t0}
	if Decide(w, Health{WalletRPCRestarts: 3}, t0.Add(time.Minute)) != RollBack {
		t.Error("wallet-rpc failing 3 times must roll back")
	}
	if Decide(w, Health{}, t0.Add(6*time.Minute)) != RollBack {
		t.Error("wallet-rpc not ready in 5 minutes must roll back")
	}
	if Decide(w, Health{WalletOpen: true, Unreachable: 9}, t0.Add(time.Hour)) != Wait {
		t.Error("wallet-rpc fine, site unreachable: wait")
	}
}

// fakeMonero stands in for monerodl: a release and an install into a folder.
type fakeMonero struct {
	version string
	fail    bool
}

func (m fakeMonero) Latest(context.Context) (monerodl.Release, error) {
	return monerodl.Release{Name: "monero-linux-x64-v" + m.version + ".tar.bz2", Version: m.version}, nil
}
func (m fakeMonero) Install(_ context.Context, rel monerodl.Release, dir string) (monerodl.Installed, error) {
	if m.fail {
		return monerodl.Installed{}, errors.New("hash mismatch")
	}
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, monerodl.BinaryName), []byte("wallet-rpc "+rel.Version), 0o755)
	os.WriteFile(filepath.Join(dir, "installed.json"), []byte(`{"version":"`+rel.Version+`"}`), 0o644)
	return monerodl.Installed{Version: rel.Version}, nil
}

func TestWalletRPCUpdate(t *testing.T) {
	r := newRelease(t)
	u, d := updater(t, r, "0.1.0")
	f := Files{DataDir: d}
	os.WriteFile(filepath.Join(d, "bin", monerodl.BinaryName), []byte("wallet-rpc 0.18.5.1"), 0o755)
	os.WriteFile(filepath.Join(d, "bin", "installed.json"), []byte(`{"version":"0.18.5.1"}`), 0o644)
	os.WriteFile(filepath.Join(d, "wallet", "shop"), []byte("wallet v1 format"), 0o600)
	os.WriteFile(filepath.Join(d, "wallet", "shop.keys"), []byte("keys"), 0o600)
	u.Monero = fakeMonero{version: "0.18.6.0"}

	// First sighting starts the 48 hours.
	if p, err := u.PrepareWalletRPC(context.Background(), "0.18.5.1"); err != nil || p != nil {
		t.Fatalf("installed on first sight: %+v %v", p, err)
	}
	u.Now = func() time.Time { return t0.Add(49 * time.Hour) }
	p, err := u.PrepareWalletRPC(context.Background(), "0.18.5.1")
	if err != nil || p == nil {
		t.Fatalf("%+v %v", p, err)
	}
	if read(t, d, "bin/monero-wallet-rpc") != "wallet-rpc 0.18.5.1" {
		t.Fatal("preparing replaced the running wallet-rpc")
	}
	if err := p.Apply(f, t0.Add(49*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if read(t, d, "bin/monero-wallet-rpc") != "wallet-rpc 0.18.6.0" || read(t, d, "bin/monero-wallet-rpc.prev") != "wallet-rpc 0.18.5.1" ||
		read(t, d, "wallet/backup/shop") != "wallet v1 format" || read(t, d, "wallet/backup/shop.keys") != "keys" {
		t.Fatal("swap or wallet backup missing")
	}
	// The new wallet-rpc upgrades the wallet file, then fails: rollback restores binary and wallet, and refuses it.
	os.WriteFile(filepath.Join(d, "wallet", "shop"), []byte("wallet v2 format"), 0o600)
	pend, _ := f.Pending()
	if err := Rollback(f, pend); err != nil {
		t.Fatal(err)
	}
	if read(t, d, "bin/monero-wallet-rpc") != "wallet-rpc 0.18.5.1" || read(t, d, "wallet/shop") != "wallet v1 format" || !f.Refused(KindWalletRPC, "0.18.6.0") {
		t.Fatal("wallet-rpc rollback incomplete")
	}
	if p, _ := u.PrepareWalletRPC(context.Background(), "0.18.5.1"); p != nil {
		t.Fatal("the refused wallet-rpc came back")
	}
	// A failed download changes nothing.
	u.Monero = fakeMonero{version: "0.18.7.0", fail: true}
	u.Files().FirstSeen(KindWalletRPC, "0.18.7.0", t0)
	if p, err := u.PrepareWalletRPC(context.Background(), "0.18.5.1"); err == nil || p != nil {
		t.Fatalf("%+v %v", p, err)
	}
	if read(t, d, "bin/monero-wallet-rpc") != "wallet-rpc 0.18.5.1" {
		t.Fatal("a failed download touched wallet-rpc")
	}
}
