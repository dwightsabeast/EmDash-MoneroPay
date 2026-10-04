package walletrpc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

const viewKey = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00"
const walletPass = "wallet-pass-not-a-real-one"

func TestGenerateFromKeys(t *testing.T) {
	f, srv := newFake(t)
	f.results["generate_from_keys"] = `{"address":"5abc","info":"Wallet has been generated successfully."}`
	err := client(f, srv).GenerateFromKeys(context.Background(), "shop", "5abc", secret.New(viewKey), secret.New(walletPass), 2220000)
	if err != nil {
		t.Fatal(err)
	}
	var p map[string]any
	json.Unmarshal(f.calls[0].Params, &p)
	want := map[string]any{"filename": "shop", "address": "5abc", "viewkey": viewKey, "spendkey": "", "password": walletPass,
		"restore_height": float64(2220000), "autosave_current": true}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("param %s = %v, want %v", k, p[k], v)
		}
	}
	if len(p) != len(want) {
		t.Errorf("params %v", p)
	}
}

func TestGenerateFromKeysChecksTheAddress(t *testing.T) {
	f, srv := newFake(t)
	f.results["generate_from_keys"] = `{"address":"5other","info":"ok"}`
	if err := client(f, srv).GenerateFromKeys(context.Background(), "shop", "5abc", secret.New(viewKey), secret.New(walletPass), 1); err == nil {
		t.Fatal("a wallet for another address was accepted")
	}
}

func TestWalletErrorsDontLeakSecrets(t *testing.T) {
	f, srv := newFake(t)
	f.results["generate_from_keys"] = `!{"jsonrpc":"2.0","id":"0","error":{"code":-1,"message":"view key does not match standard address"}}`
	f.results["open_wallet"] = `!{"jsonrpc":"2.0","id":"0","error":{"code":-1,"message":"Failed to open wallet"}}`
	c := client(f, srv)
	err1 := c.GenerateFromKeys(context.Background(), "shop", "5abc", secret.New(viewKey), secret.New(walletPass), 1)
	err2 := c.OpenWallet(context.Background(), "shop", secret.New(walletPass))
	var re *RPCError
	if !errors.As(err1, &re) || !strings.Contains(re.Message, "does not match") || err2 == nil {
		t.Fatalf("errors: %v / %v", err1, err2)
	}
	for _, err := range []error{err1, err2} {
		if strings.Contains(err.Error(), viewKey) || strings.Contains(err.Error(), walletPass) {
			t.Fatalf("error leaks a secret: %v", err)
		}
	}
}

func TestOpenCloseAndAddress(t *testing.T) {
	f, srv := newFake(t)
	f.results["open_wallet"] = `{}`
	f.results["close_wallet"] = `{}`
	f.results["get_address"] = `{"address":"5abc","addresses":[{"address":"5abc","address_index":0,"label":"Primary account","used":false}]}`
	c := client(f, srv)
	if err := c.OpenWallet(context.Background(), "shop", secret.New(walletPass)); err != nil {
		t.Fatal(err)
	}
	a, err := c.GetAddress(context.Background())
	if err != nil || a != "5abc" {
		t.Fatalf("GetAddress %q %v", a, err)
	}
	if err := c.CloseWallet(context.Background()); err != nil {
		t.Fatal(err)
	}
	var p map[string]any
	json.Unmarshal(f.calls[0].Params, &p)
	if p["filename"] != "shop" || p["password"] != walletPass || len(p) != 2 {
		t.Fatalf("open_wallet params %v", p)
	}
	json.Unmarshal(f.calls[1].Params, &p)
	if p["account_index"] != float64(0) {
		t.Fatalf("get_address params %v", p)
	}
}
