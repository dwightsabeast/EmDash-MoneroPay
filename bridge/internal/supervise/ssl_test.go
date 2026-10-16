package supervise

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
)

// Spec change 28: wallet-rpc refuses --daemon-ssl enabled on its own, so an https node also gets the system's CA
// bundle and --daemon-ssl-allow-chained (run B attempt 1).

func bundleFile(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "ca-certificates.crt")
	if err := os.WriteFile(p, []byte("-----BEGIN CERTIFICATE-----\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func argsOf(t *testing.T, h *harness) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := h.s.WaitReady(ctx); err != nil {
		t.Fatal(err)
	}
	recs := h.records(t)
	if len(recs) == 0 {
		t.Fatal("no start recorded")
	}
	return strings.Join(recs[0].Args, " ")
}

func TestHTTPSNodeUsesTheCABundle(t *testing.T) {
	bundle := bundleFile(t)
	missing := filepath.Join(t.TempDir(), "missing.crt")
	h := start(t, "", func(o *Options) {
		o.Node = "https://node.example:38089"
		o.CABundles = []string{missing, bundle}
	})
	args := argsOf(t, h)
	for _, want := range []string{"--daemon-address node.example:38089", "--daemon-ssl enabled",
		"--daemon-ssl-ca-certificates " + bundle, "--daemon-ssl-allow-chained"} {
		if !strings.Contains(args, want) {
			t.Errorf("args lack %q:\n%s", want, args)
		}
	}
}

func TestHTTPNodeGetsNoCAFlags(t *testing.T) {
	h := start(t, "", func(o *Options) { o.CABundles = []string{bundleFile(t)} })
	args := argsOf(t, h)
	if !strings.Contains(args, "--daemon-ssl disabled") || strings.Contains(args, "--daemon-ssl-ca-certificates") || strings.Contains(args, "--daemon-ssl-allow-chained") {
		t.Fatalf("args for an http node:\n%s", args)
	}
}

func TestHTTPSNodeNeedsACABundle(t *testing.T) {
	empty := filepath.Join(t.TempDir(), "empty.crt")
	os.WriteFile(empty, nil, 0o644)
	_, err := New(Options{Binary: "/bin/true", DataDir: "/tmp/x", Network: config.Stagenet, Node: "https://node.example:38089",
		CABundles: []string{filepath.Join(t.TempDir(), "missing.crt"), empty, t.TempDir()}})
	if !errors.Is(err, ErrNoCABundle) {
		t.Fatalf("New: %v", err)
	}
	if !strings.Contains(err.Error(), "ca-certificates") {
		t.Fatalf("the message doesn't say what to install: %v", err)
	}
	// An http node doesn't need one.
	if _, err := New(Options{Binary: "/bin/true", DataDir: "/tmp/x", Network: config.Stagenet, Node: "http://node.example:38089",
		CABundles: []string{filepath.Join(t.TempDir(), "missing.crt")}}); err != nil {
		t.Fatalf("an http node: %v", err)
	}
}

func TestCABundleTakesTheFirstUsableFile(t *testing.T) {
	a, b := bundleFile(t), bundleFile(t)
	if got, err := CABundle([]string{filepath.Join(t.TempDir(), "missing.crt"), a, b}); err != nil || got != a {
		t.Fatalf("CABundle: %q %v", got, err)
	}
	if got := DefaultCABundles; len(got) != 2 || got[0] != "/etc/ssl/certs/ca-certificates.crt" || got[1] != "/etc/pki/tls/certs/ca-bundle.crt" {
		t.Fatalf("defaults %v", got)
	}
}

// The installer quotes wallet-rpc's own reason when wallet-rpc answers "error 0" with no message.
func TestLastError(t *testing.T) {
	dir := t.TempDir()
	if got := LastError(dir); got != "" {
		t.Fatalf("no log: %q", got)
	}
	os.MkdirAll(filepath.Join(dir, "log"), 0o700)
	log := strings.Join([]string{
		"2026-10-16 01:07:21.460\t    7fe293084180\tINFO\tlogging\tcontrib/epee/src/mlog.cpp:274\tNew log categories: *:WARNING",
		"2026-10-16 01:07:25.473\t[RPC0]\tERROR\twallet.wallet2\tsrc/wallet/wallet2.cpp:431\tverification_required && !ssl_options.has_strong_verification(real_daemon). THROW EXCEPTION: tools::error::wallet_internal_error",
		"2026-10-16 01:07:25.473\t[RPC0]\tERROR\twallet.rpc\tsrc/wallet/wallet_rpc_server.h:148\t[127.0.0.1:38450 INC] Failed to on_generate_from_keys(): Enabling --daemon-ssl requires --daemon-ssl-allow-any-cert or --daemon-ssl-ca-certificates or --daemon-ssl-allowed-fingerprints or use of a .onion/.i2p domain",
		"2026-10-16 01:07:25.473\t[SRV_MAIN]\tWARNING\twallet.rpc\tsrc/wallet/wallet_rpc_server.cpp:4997\tStopped wallet RPC server",
		"",
	}, "\n")
	os.WriteFile(filepath.Join(dir, "log", "wallet-rpc.log"), []byte(log), 0o600)
	want := "Enabling --daemon-ssl requires --daemon-ssl-allow-any-cert or --daemon-ssl-ca-certificates or --daemon-ssl-allowed-fingerprints or use of a .onion/.i2p domain"
	if got := LastError(dir); got != want {
		t.Fatalf("LastError:\n got %q\nwant %q", got, want)
	}
	// Long messages are cut, and only the log's tail is read.
	os.WriteFile(filepath.Join(dir, "log", "wallet-rpc.log"), []byte(strings.Repeat("x", 200_000)+"\n2026-10-16 01:07:25.473\t[RPC0]\tERROR\twallet.rpc\tf.cpp:1\t"+strings.Repeat("y", 1000)+"\n"), 0o600)
	if got := LastError(dir); len(got) > 300 || !strings.HasPrefix(got, "yyy") {
		t.Fatalf("long: %d bytes", len(got))
	}
}
