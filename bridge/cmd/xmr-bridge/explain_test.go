package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// Run B attempt 1 stopped at "walletrpc: wallet-rpc error 0: ." (spec change 28): wallet-rpc answers code 0 with no
// message when an exception escapes its handler. The installer quotes wallet-rpc's log instead.
func TestExplainWalletRPC(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "log"), 0o700)
	os.WriteFile(filepath.Join(dir, "log", "wallet-rpc.log"), []byte("2026-10-16 01:07:25.473\t[RPC0]\tERROR\twallet.rpc\tsrc/wallet/wallet_rpc_server.h:148\t[127.0.0.1:38450 INC] Failed to on_generate_from_keys(): Enabling --daemon-ssl requires a CA file\n"), 0o600)

	bare := &walletrpc.RPCError{Code: 0, Message: ""}
	got := explainWalletRPC(bare, dir)
	if got == nil || !strings.Contains(got.Error(), "Monero's wallet program refused: Enabling --daemon-ssl requires a CA file") || strings.Contains(got.Error(), "error 0") {
		t.Fatalf("bare error: %v", got)
	}
	if !errors.As(got, new(*walletrpc.RPCError)) {
		t.Fatal("the RPC error is no longer wrapped")
	}
	// A real message, another error, or no log: unchanged.
	withMsg := &walletrpc.RPCError{Code: -1, Message: "Failed to parse public address"}
	other := errors.New("connection refused")
	for _, e := range []error{withMsg, other, nil} {
		if got := explainWalletRPC(e, dir); got != e {
			t.Fatalf("%v became %v", e, got)
		}
	}
	if got := explainWalletRPC(bare, t.TempDir()); got != error(bare) {
		t.Fatalf("no log: %v", got)
	}
}
