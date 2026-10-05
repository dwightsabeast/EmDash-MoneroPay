package walletrpc

import (
	"context"
	"errors"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

// GenerateFromKeys creates a view-only wallet file from the primary address and the private view key (no spend
// key), scanning from restoreHeight. The secrets go only into the request body; wallet-rpc refuses a view key that
// doesn't belong to the address. The wallet stays open.
func (c *Client) GenerateFromKeys(ctx context.Context, filename, address string, viewKey, password secret.String, restoreHeight uint64) error {
	params := map[string]any{
		"filename":         filename,
		"address":          address,
		"viewkey":          viewKey.Reveal(),
		"spendkey":         "",
		"password":         password.Reveal(),
		"restore_height":   restoreHeight,
		"autosave_current": true,
	}
	var r struct {
		Address string `json:"address"`
	}
	if err := c.call(ctx, "generate_from_keys", params, &r); err != nil {
		return err
	}
	if r.Address != address {
		return errors.New("walletrpc: generate_from_keys: the wallet was created for a different address")
	}
	return nil
}

// OpenWallet opens a wallet file in wallet-rpc's --wallet-dir.
func (c *Client) OpenWallet(ctx context.Context, filename string, password secret.String) error {
	var r struct{}
	return c.call(ctx, "open_wallet", map[string]any{"filename": filename, "password": password.Reveal()}, &r)
}

// CloseWallet saves and closes the open wallet.
func (c *Client) CloseWallet(ctx context.Context) error {
	var r struct{}
	return c.call(ctx, "close_wallet", struct{}{}, &r)
}

// GetAddress returns the open wallet's primary address (account 0, index 0).
func (c *Client) GetAddress(ctx context.Context) (string, error) {
	var r struct {
		Address string `json:"address"`
	}
	err := c.call(ctx, "get_address", map[string]any{"account_index": 0}, &r)
	return r.Address, err
}

// RescanBlockchain rescans the open wallet from its restore height, finding payments to subaddresses created after
// the blocks holding them were first scanned (spec change 9). wallet-rpc answers once the rescan is done.
func (c *Client) RescanBlockchain(ctx context.Context) error {
	var r struct{}
	return c.call(ctx, "rescan_blockchain", struct{}{}, &r)
}
