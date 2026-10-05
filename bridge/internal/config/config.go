// Package config reads and writes the bridge's one config file (/etc/xmr-bridge/config on a real install). It is
// JSON, written only by xmr-bridge subcommands, readable by the service account alone (mode 600), and holds no
// secrets: the view key lives in the wallet, the bridge key in its own file.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/moneroaddr"
)

// Network is the Monero network the wallet host runs on.
type Network string

const (
	Mainnet  Network = "mainnet"
	Stagenet Network = "stagenet"
	Testnet  Network = "testnet"
)

// maxSize caps the file read; a real config is a few hundred bytes.
const maxSize = 64 << 10

// Config is the bridge's configuration.
type Config struct {
	// Site is the EmDash site's base URL (scheme, host, optional port). The bridge posts to
	// /_emdash/api/plugins/xmr-pay/bridge/sync under it.
	Site    string  `json:"site"`
	Network Network `json:"network"`
	// Address is the shop wallet's primary address (not secret). The bridge checks the opened wallet against it.
	Address string `json:"address"`
	// Node is the monerod RPC address the wallet uses.
	Node string `json:"node"`
	// RestoreHeight is where the wallet starts scanning; 0 means the node's height when the wallet is created.
	RestoreHeight uint64 `json:"restoreHeight,omitempty"`
	AutoUpdate    bool   `json:"autoUpdate"`
	// DataDir holds the wallet, the bridge key and wallet-rpc (absolute path).
	DataDir string `json:"dataDir"`
	// AllowSameMachine is the development flag that lets the bridge run beside the site. Stagenet only.
	AllowSameMachine bool `json:"allowSameMachine,omitempty"`
}

// Validate checks every field. It never echoes values that could be private beyond the field name.
func (c Config) Validate() error {
	if err := validateSite(c.Site); err != nil {
		return err
	}
	switch c.Network {
	case Mainnet, Stagenet, Testnet:
	default:
		return fmt.Errorf("config: network must be mainnet, stagenet or testnet, not %q", c.Network)
	}
	if err := moneroaddr.CheckPrimary(c.Address, string(c.Network)); err != nil {
		return fmt.Errorf("config: address: %w", err)
	}
	if err := validateNode(c.Node); err != nil {
		return err
	}
	if c.DataDir == "" || !filepath.IsAbs(c.DataDir) {
		return errors.New("config: dataDir must be an absolute path")
	}
	if c.AllowSameMachine && c.Network != Stagenet {
		return errors.New("config: running beside the site is allowed on stagenet only")
	}
	return nil
}

// CheckSite checks a site URL the way Validate does (https, or http on loopback; the base address only).
func CheckSite(s string) error { return validateSite(s) }

func validateSite(s string) error {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || u.Opaque != "" {
		return errors.New("config: site must be a URL such as https://shop.example")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("config: site must be the site's base address only (no path, query or login)")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !isLoopback(u.Hostname()) {
			return errors.New("config: site must use https (plain http is allowed only for a site on this machine)")
		}
	default:
		return errors.New("config: site must use https")
	}
	return nil
}

// CheckNode checks a node URL the way Validate does.
func CheckNode(s string) error { return validateNode(s) }

func validateNode(s string) error {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return errors.New("config: node must be an http or https URL such as http://127.0.0.1:18081")
	}
	if u.User != nil {
		return errors.New("config: node must not carry a login in the URL")
	}
	return nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Load reads and validates the config. The file must not be readable by group or others.
func Load(path string) (Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	if fi.Mode().Perm()&0o077 != 0 {
		return Config{}, fmt.Errorf("config: %s is readable by other users; run chmod 600 on it", path)
	}
	data, err := io.ReadAll(io.LimitReader(f, maxSize+1))
	if err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	if len(data) > maxSize {
		return Config{}, fmt.Errorf("config: %s is too large", path)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var c Config
	if err := dec.Decode(&c); err != nil {
		return Config{}, fmt.Errorf("config: %s: %w", path, err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return Config{}, fmt.Errorf("config: %s: unexpected data after the config object", path)
	}
	if err := c.Validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

// Save validates the config and replaces the file atomically (temporary file, fsync, rename), mode 600.
func Save(path string, c Config) error {
	if err := c.Validate(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*")
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("config: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("config: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("config: %w", err)
	}
	return nil
}
