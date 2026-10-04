package monerodl

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/hashsig"
)

var now = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

func fixture(t testing.TB, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// fixtureKey builds the fixture signer from testdata/fixture-key.params (written by make-fixtures.sh).
func fixtureKey(t testing.TB) hashsig.PublicKey {
	t.Helper()
	var created uint64
	var n, e []byte
	for _, line := range strings.Split(strings.TrimSpace(string(fixture(t, "fixture-key.params"))), "\n") {
		k, v, _ := strings.Cut(line, " ")
		var err error
		switch k {
		case "created":
			created, err = strconv.ParseUint(v, 10, 32)
		case "n":
			n, err = hex.DecodeString(v)
		case "e":
			e, err = hex.DecodeString(v)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	key, err := hashsig.NewRSAKey(uint32(created), n, e)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

// server serves path -> body over HTTPS; a body starting with "redirect:" redirects there.
func server(t *testing.T, files map[string][]byte) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if to, ok := strings.CutPrefix(string(b), "redirect:"); ok {
			http.Redirect(w, r, to, http.StatusFound)
			return
		}
		w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func fetcher(t *testing.T, srv *httptest.Server, arch string) *Fetcher {
	return &Fetcher{
		HashesURL:   srv.URL + "/downloads/hashes.txt",
		ArchiveBase: srv.URL + "/cli/",
		Key:         fixtureKey(t),
		Arch:        arch,
		HTTP:        srv.Client(),
		Now:         func() time.Time { return now },
	}
}

func TestArchFor(t *testing.T) {
	for goarch, want := range map[string]string{"amd64": "x64", "arm64": "armv8"} {
		if got, err := ArchFor(goarch); err != nil || got != want {
			t.Errorf("%s: %q %v", goarch, got, err)
		}
	}
	for _, goarch := range []string{"386", "arm", "riscv64", ""} {
		if _, err := ArchFor(goarch); err == nil {
			t.Errorf("%s: accepted", goarch)
		}
	}
}

func TestLatest(t *testing.T) {
	srv := server(t, map[string][]byte{"/downloads/hashes.txt": fixture(t, "hashes-good.txt")})
	for arch, archive := range map[string]string{"x64": "good-x64.tar.bz2", "armv8": "good-armv8.tar.bz2"} {
		rel, err := fetcher(t, srv, arch).Latest(context.Background())
		if err != nil {
			t.Fatalf("%s: %v", arch, err)
		}
		want := sha256.Sum256(fixture(t, archive))
		if rel.Version != "0.18.5.1" || rel.Name != "monero-linux-"+arch+"-v0.18.5.1.tar.bz2" || rel.SHA256 != want {
			t.Fatalf("%s: %+v", arch, rel)
		}
	}
}

func TestLatestRefuses(t *testing.T) {
	other := server(t, map[string][]byte{"/hashes.txt": fixture(t, "hashes-good.txt")})
	cases := map[string]struct {
		hashes []byte
		tweak  func(*Fetcher)
		want   error
	}{
		"unknown signer":    {fixture(t, "hashes-good.txt"), func(f *Fetcher) { f.Key = hashsig.MoneroReleaseKey }, hashsig.ErrUnknownSigner},
		"two x64 releases":  {fixture(t, "hashes-two-x64.txt"), nil, nil},
		"no x64 release":    {fixture(t, "hashes-no-x64.txt"), nil, nil},
		"tampered list":     {bytes.Replace(fixture(t, "hashes-good.txt"), []byte("0.18.5.1"), []byte("0.18.5.2"), 1), nil, hashsig.ErrBadSignature},
		"list too large":    {append(fixture(t, "hashes-good.txt"), bytes.Repeat([]byte("#"), 70_000)...), nil, nil},
		"redirect off host": {[]byte("redirect:" + other.URL + "/hashes.txt"), nil, nil},
		"not found":         {nil, func(f *Fetcher) { f.HashesURL += "-missing" }, nil},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			srv := server(t, map[string][]byte{"/downloads/hashes.txt": c.hashes})
			f := fetcher(t, srv, "x64")
			if c.tweak != nil {
				c.tweak(f)
			}
			_, err := f.Latest(context.Background())
			if err == nil {
				t.Fatal("accepted")
			}
			if c.want != nil && !errors.Is(err, c.want) {
				t.Fatalf("got %v, want %v", err, c.want)
			}
			if name == "list too large" && !strings.Contains(err.Error(), "larger than") {
				t.Fatalf("want the size error, got %v", err)
			}
		})
	}
}

// A plain-http address is refused before any request, even when a server would answer it.
func TestPlainHTTPRefused(t *testing.T) {
	var hits int
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Write(fixture(t, "hashes-good.txt"))
	}))
	defer plain.Close()
	f := &Fetcher{HashesURL: plain.URL + "/hashes.txt", ArchiveBase: plain.URL + "/cli/", Key: fixtureKey(t), Arch: "x64", HTTP: plain.Client(), Now: func() time.Time { return now }}
	if _, err := f.Latest(context.Background()); err == nil || hits != 0 {
		t.Fatalf("plain http: err %v, %d requests", err, hits)
	}
	// An https list that redirects to plain http on the same host and port is refused too.
	srv := server(t, map[string][]byte{"/downloads/hashes.txt": nil})
	f = fetcher(t, srv, "x64")
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://"+r.Host+"/x", http.StatusFound)
	})
	if _, err := f.Latest(context.Background()); err == nil || !strings.Contains(err.Error(), "redirect") {
		t.Fatalf("redirect to http: %v", err)
	}
}

func TestRedirectWithinHost(t *testing.T) {
	srv := server(t, map[string][]byte{
		"/downloads/hashes.txt": []byte("redirect:/mirror/hashes.txt"),
		"/mirror/hashes.txt":    fixture(t, "hashes-good.txt"),
	})
	if _, err := fetcher(t, srv, "x64").Latest(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func install(t *testing.T, hashes, archive string, tweak func(*Fetcher), served []byte) (string, Installed, error) {
	t.Helper()
	if served == nil {
		served = fixture(t, archive)
	}
	srv := server(t, map[string][]byte{
		"/downloads/hashes.txt":                   fixture(t, hashes),
		"/cli/monero-linux-x64-v0.18.5.1.tar.bz2": served,
	})
	f := fetcher(t, srv, "x64")
	if tweak != nil {
		tweak(f)
	}
	rel, err := f.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "bin")
	inst, err := f.Install(context.Background(), rel, dir)
	return dir, inst, err
}

func TestInstall(t *testing.T) {
	dir, inst, err := install(t, "hashes-good.txt", "good-x64.tar.bz2", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, BinaryName)
	got, err := os.ReadFile(bin)
	if err != nil || string(got) != "fake monero-wallet-rpc for linux-x64\n" {
		t.Fatalf("binary: %q %v", got, err)
	}
	fi, _ := os.Stat(bin)
	if fi.Mode().Perm() != 0o755 {
		t.Fatalf("mode %v", fi.Mode().Perm())
	}
	archiveSum := sha256.Sum256(fixture(t, "good-x64.tar.bz2"))
	binSum := sha256.Sum256(got)
	if inst.Version != "0.18.5.1" || inst.Archive != "monero-linux-x64-v0.18.5.1.tar.bz2" ||
		inst.ArchiveSHA256 != hex.EncodeToString(archiveSum[:]) || inst.BinarySHA256 != hex.EncodeToString(binSum[:]) {
		t.Fatalf("installed: %+v", inst)
	}
	read, err := ReadInstalled(dir)
	if err != nil || read != inst {
		t.Fatalf("ReadInstalled: %+v %v", read, err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatalf("leftover files: %v", entries)
	}
}

func TestInstallRefuses(t *testing.T) {
	tampered := fixture(t, "good-x64.tar.bz2")
	tampered[len(tampered)/2] ^= 0x01
	cases := map[string]struct {
		hashes, archive string
		tweak           func(*Fetcher)
		served          []byte
	}{
		"tampered archive":     {"hashes-good.txt", "good-x64.tar.bz2", nil, tampered},
		"archive over the cap": {"hashes-good.txt", "good-x64.tar.bz2", func(f *Fetcher) { f.MaxArchive = 100 }, nil},
		"symlink entry":        {"hashes-bad-symlink.txt", "bad-symlink.tar.bz2", nil, nil},
		"two entries":          {"hashes-bad-two.txt", "bad-two.tar.bz2", nil, nil},
		"no entry":             {"hashes-bad-missing.txt", "bad-missing.tar.bz2", nil, nil},
		"nested entry":         {"hashes-bad-nested.txt", "bad-nested.tar.bz2", nil, nil},
		"entry over the cap":   {"hashes-big-entry.txt", "big-entry.tar.bz2", func(f *Fetcher) { f.MaxBinary = 1024 }, nil},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			dir, _, err := install(t, c.hashes, c.archive, c.tweak, c.served)
			if err == nil {
				t.Fatal("installed")
			}
			if entries, _ := os.ReadDir(dir); len(entries) != 0 {
				t.Fatalf("left files behind: %v", entries)
			}
			if name == "archive over the cap" && !strings.Contains(err.Error(), "larger than") {
				t.Fatalf("over the cap: want the size error, got %v", err)
			}
		})
	}
}

// A failed install leaves the previous one untouched.
func TestFailedInstallKeepsPrevious(t *testing.T) {
	dir, prev, err := install(t, "hashes-good.txt", "good-x64.tar.bz2", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	tampered := fixture(t, "good-x64.tar.bz2")
	tampered[10] ^= 0x01
	srv := server(t, map[string][]byte{
		"/downloads/hashes.txt":                   fixture(t, "hashes-good.txt"),
		"/cli/monero-linux-x64-v0.18.5.1.tar.bz2": tampered,
	})
	f := fetcher(t, srv, "x64")
	rel, err := f.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Install(context.Background(), rel, dir); err == nil {
		t.Fatal("tampered archive installed")
	}
	got, err := ReadInstalled(dir)
	if err != nil || got != prev {
		t.Fatalf("previous install changed: %+v %v", got, err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, BinaryName))
	if string(b) != "fake monero-wallet-rpc for linux-x64\n" {
		t.Fatal("previous binary changed")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 2 {
		t.Fatalf("leftover files: %v", entries)
	}
}
