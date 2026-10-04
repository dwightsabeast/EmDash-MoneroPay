// Package syncsign holds the bridge's Ed25519 key and signs bridge/sync requests exactly as the plugin verifies
// them: the signature covers the UTF-8 bytes of x-xmr-ts, a newline, then the exact body bytes, and travels as
// standard padded base64 (contract/test-vectors/README.md). The key file holds the 32-byte seed, mode 600.
package syncsign

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Message is what gets signed: ts, "\n", body.
func Message(ts string, body []byte) []byte {
	m := make([]byte, 0, len(ts)+1+len(body))
	m = append(m, ts...)
	m = append(m, '\n')
	return append(m, body...)
}

// Sign returns the base64 signature for the x-xmr-sig header.
func Sign(k ed25519.PrivateKey, ts string, body []byte) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(k, Message(ts, body)))
}

// PublicKeyText is the public key as the pairing body carries it (standard base64 of 32 bytes).
func PublicKeyText(k ed25519.PrivateKey) string {
	return base64.StdEncoding.EncodeToString(k.Public().(ed25519.PublicKey))
}

// NewKey makes a fresh key.
func NewKey() (ed25519.PrivateKey, error) {
	_, k, err := ed25519.GenerateKey(rand.Reader)
	return k, err
}

// SaveKey writes the key's seed (base64, one line) to path, mode 600, replacing any old key atomically.
func SaveKey(path string, k ed25519.PrivateKey) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".bridge-key-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := tmp.WriteString(base64.StdEncoding.EncodeToString(k.Seed()) + "\n"); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// LoadKey reads a key written by SaveKey. A missing file returns the os error (os.IsNotExist); a file others can
// read is refused.
func LoadKey(path string) (ed25519.PrivateKey, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if fi.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s is readable by other users; run chmod 600 on it", path)
	}
	raw, err := io.ReadAll(io.LimitReader(f, 128))
	if err != nil {
		return nil, err
	}
	seed, err := base64.StdEncoding.Strict().DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, errors.New("the bridge key file is malformed")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}
