package main

import (
	"context"
	"errors"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/testaddr"
)

func TestStagenetWallet(t *testing.T) {
	addr := func(a string, err error) func(context.Context) (string, error) {
		return func(context.Context) (string, error) { return a, err }
	}
	if err := stagenetWallet(context.Background(), addr(testaddr.Stagenet, nil)); err != nil {
		t.Fatalf("stagenet refused: %v", err)
	}
	for name, get := range map[string]func(context.Context) (string, error){
		"mainnet wallet":          addr(testaddr.Mainnet, nil),
		"testnet wallet":          addr(testaddr.Testnet, nil),
		"wallet-rpc says nothing": addr("", errors.New("No wallet file")),
		"garbage address":         addr("not an address", nil),
	} {
		if err := stagenetWallet(context.Background(), get); err == nil {
			t.Errorf("%s: a dev update was allowed", name)
		}
	}
}
