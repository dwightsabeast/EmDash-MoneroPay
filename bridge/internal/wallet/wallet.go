// Package wallet creates the shop's view-only wallet once (from the primary address and private view key, never a
// spend key) and opens it every time wallet-rpc starts, checking that it is the configured shop address. The
// wallet file and its password live in <dataDir>/wallet/, readable only by the service account.
package wallet

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/moneroaddr"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// FileName is the wallet's name in wallet-rpc's --wallet-dir (<dataDir>/wallet).
const FileName = "shop"

var (
	// ErrViewKeyMismatch: wallet-rpc refused the key for this address, most likely a spend key or another
	// wallet's view key.
	ErrViewKeyMismatch = errors.New("that private view key doesn't belong to this address. Paste the shop wallet's private VIEW key; never enter the spend key or the seed")
	// ErrNoWallet: the installer hasn't created the wallet yet.
	ErrNoWallet = errors.New("no wallet yet: run the installer")
)

// Dir is where wallet-rpc keeps the wallet (the supervisor's --wallet-dir).
func Dir(dataDir string) string { return filepath.Join(dataDir, "wallet") }

func passwordFile(dataDir string) string { return filepath.Join(Dir(dataDir), FileName+".password") }

// Exists reports whether the wallet has been created.
func Exists(dataDir string) bool {
	_, err := os.Stat(filepath.Join(Dir(dataDir), FileName+".keys"))
	return err == nil
}

// Create makes the view-only wallet with wallet-rpc (which must be running with --wallet-dir Dir(cfg.DataDir)).
// node is the node's get_info: it must be on cfg's network and online. The restore height is cfg.RestoreHeight, or
// the node's height ("today") when that is 0. Create never overwrites an existing wallet.
func Create(ctx context.Context, c *walletrpc.Client, cfg config.Config, viewKey secret.String, node noderpc.Info) error {
	if err := moneroaddr.CheckPrimary(cfg.Address, string(cfg.Network)); err != nil {
		return err
	}
	if node.NetType != string(cfg.Network) {
		return fmt.Errorf("the Monero node is on %s, but this wallet host is set up for %s", node.NetType, cfg.Network)
	}
	if node.Offline || node.Height == 0 {
		return errors.New("the Monero node is offline or has no blocks yet")
	}
	restore := cfg.RestoreHeight
	if restore == 0 {
		restore = node.Height
	}
	dir := Dir(cfg.DataDir)
	if Exists(cfg.DataDir) {
		return errors.New("a wallet already exists on this wallet host")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	pass := secret.New(base64.RawURLEncoding.EncodeToString(b))
	pf := passwordFile(cfg.DataDir)
	f, err := os.OpenFile(pf, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("wallet password file: %w", err)
	}
	_, werr := f.WriteString(pass.Reveal() + "\n")
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		os.Remove(pf)
		return fmt.Errorf("wallet password file: %w", werr)
	}
	if err := c.GenerateFromKeys(ctx, FileName, cfg.Address, viewKey, pass, restore); err != nil {
		os.Remove(pf)
		var re *walletrpc.RPCError
		if errors.As(err, &re) {
			m := strings.ToLower(re.Message)
			if strings.Contains(m, "view key") && (strings.Contains(m, "match") || strings.Contains(m, "parse")) {
				return ErrViewKeyMismatch
			}
		}
		return err
	}
	return nil
}

// Open opens the wallet with its saved password and checks it is cfg.Address; a wallet for any other address is
// closed again and refused.
func Open(ctx context.Context, c *walletrpc.Client, cfg config.Config) error {
	pf := passwordFile(cfg.DataDir)
	fi, err := os.Stat(pf)
	if errors.Is(err, os.ErrNotExist) || !Exists(cfg.DataDir) {
		return ErrNoWallet
	}
	if err != nil {
		return err
	}
	if fi.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("%s is readable by other users; run chmod 600 on it", pf)
	}
	raw, err := os.ReadFile(pf)
	if err != nil {
		return err
	}
	pass := secret.New(strings.TrimSpace(string(raw)))
	if err := c.OpenWallet(ctx, FileName, pass); err != nil {
		return err
	}
	got, err := c.GetAddress(ctx)
	if err == nil && got != cfg.Address {
		err = errors.New("the wallet on this host is for a different address than the configured shop address")
	}
	if err != nil {
		c.CloseWallet(ctx)
		return err
	}
	return nil
}
