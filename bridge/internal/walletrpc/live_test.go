package walletrpc

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

// TestLiveWalletRPC checks the digest login against a real monero-wallet-rpc started with --rpc-login and no wallet
// open. Skipped unless XMR_BRIDGE_LIVE_RPC (base URL) and XMR_BRIDGE_LIVE_LOGIN_FILE (a file holding user:password)
// are set.
func TestLiveWalletRPC(t *testing.T) {
	base, file := os.Getenv("XMR_BRIDGE_LIVE_RPC"), os.Getenv("XMR_BRIDGE_LIVE_LOGIN_FILE")
	if base == "" || file == "" {
		t.Skip("set XMR_BRIDGE_LIVE_RPC and XMR_BRIDGE_LIVE_LOGIN_FILE to run against a real wallet-rpc")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	user, pass, ok := strings.Cut(strings.TrimSpace(string(raw)), ":")
	if !ok {
		t.Fatal("login file must hold user:password")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	c := New(base, user, secret.New(pass), nil)
	v, err := c.GetVersion(ctx)
	if err != nil || v.Version == 0 {
		t.Fatalf("get_version: %+v, %v", v, err)
	}
	t.Logf("wallet-rpc RPC version %d.%d, release %v", v.Version>>16, v.Version&0xffff, v.Release)
	for i := 0; i < 3; i++ { // reuses the challenge with a rising nc
		if _, err := c.GetVersion(ctx); err != nil {
			t.Fatalf("get_version again (%d): %v", i, err)
		}
	}
	var re *RPCError
	if _, err := c.GetHeight(ctx); !errors.As(err, &re) {
		t.Fatalf("get_height with no wallet open: want wallet-rpc's error object, got %v", err)
	} else {
		t.Logf("get_height with no wallet: %d %s", re.Code, re.Message)
	}

	_, err = New(base, user, secret.New(pass+"x"), nil).GetVersion(ctx)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("wrong password: want ErrUnauthorized, got %v", err)
	}
}
