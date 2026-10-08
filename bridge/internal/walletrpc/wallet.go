package walletrpc

import (
	"context"
	"errors"
	"fmt"

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
// the blocks holding them were first scanned (spec change 9). wallet-rpc answers only once the rescan is done, which
// can take far longer than a routine call, so this one call runs without the client's timeout: ctx alone bounds it.
func (c *Client) RescanBlockchain(ctx context.Context) error {
	var r struct{}
	return c.untimed().call(ctx, "rescan_blockchain", struct{}{}, &r)
}

// untimed is a copy of the client without the HTTP client's overall timeout. It starts with its own digest
// challenge, so the two never share a nonce count.
func (c *Client) untimed() *Client {
	hc := *c.http
	hc.Timeout = 0
	return &Client{url: c.url, user: c.user, pass: c.pass, http: &hc, maxResponse: c.maxResponse}
}

// errAddressIndexOutOfBounds is WALLET_RPC_ERROR_CODE_ADDRESS_INDEX_OUT_OF_BOUNDS (wallet-rpc 0.18.5.1).
const errAddressIndexOutOfBounds = -15

// HasSubaddress reports whether the open wallet already has subaddress index (account 0). A fresh wallet restored
// from keys knows only the indexes it has created or seen paid (spec change 15).
func (c *Client) HasSubaddress(ctx context.Context, index uint32) (bool, error) {
	var r struct {
		Addresses []struct {
			Index uint32 `json:"address_index"`
		} `json:"addresses"`
	}
	err := c.call(ctx, "get_address", map[string]any{"account_index": 0, "address_index": []uint32{index}}, &r)
	var re *RPCError
	if errors.As(err, &re) && re.Code == errAddressIndexOutOfBounds {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if len(r.Addresses) != 1 || r.Addresses[0].Index != index {
		return false, fmt.Errorf("walletrpc: get_address: asked for index %d, got another answer", index)
	}
	return true, nil
}
