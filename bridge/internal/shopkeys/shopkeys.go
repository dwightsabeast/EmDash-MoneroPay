// Package shopkeys reads and checks the two values an admin types once at the installer's prompt: the shop
// wallet's primary address and its private view key. The view key is held as a secret.String from the moment it is
// read. Nothing here can tell a private spend key from a view key (both are 64 hex characters); wallet-rpc refuses
// a key that doesn't belong to the address, and the wallet package turns that into a plain message.
package shopkeys

import (
	"bufio"
	"encoding/hex"
	"errors"
	"io"
	"math/big"
	"strings"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/moneroaddr"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

// l is the order of the ed25519 base point; Monero private keys are scalars below it.
var l, _ = new(big.Int).SetString("1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed", 16)

var errSeed = errors.New("that looks like a mnemonic seed. Never enter a seed or a spend key here: paste the shop wallet's private view key (64 hexadecimal characters)")

// CheckViewKey checks the format of a private view key: 64 hex characters, a nonzero scalar below the curve order.
// Errors never repeat the input.
func CheckViewKey(k string) error {
	if strings.ContainsAny(k, " \t") || (len(k) != 64 && isWord(k)) {
		return errSeed
	}
	b, err := hex.DecodeString(k)
	if err != nil || len(b) != 32 {
		return errors.New("a private view key is 64 hexadecimal characters (0-9, a-f)")
	}
	le := make([]byte, 32) // Monero scalars are little-endian
	for i := range b {
		le[31-i] = b[i]
	}
	v := new(big.Int).SetBytes(le)
	if v.Sign() == 0 || v.Cmp(l) >= 0 {
		return errors.New("that is not a valid private view key")
	}
	return nil
}

func isWord(s string) bool {
	for _, c := range s {
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z') {
			return false
		}
	}
	return s != ""
}

// maxLine bounds each input line (an address is 95 characters, a view key 64).
const maxLine = 512

// ReadKeys reads two lines from r (the installer's prompt): the primary address, then the private view key, and
// checks both for network. Surrounding spaces and a CR are trimmed.
func ReadKeys(r io.Reader, network string) (string, secret.String, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, maxLine), maxLine)
	var lines []string
	for sc.Scan() {
		lines = append(lines, strings.TrimSpace(sc.Text()))
		if len(lines) > 2 {
			return "", secret.String{}, errors.New("expected two lines: the primary address, then the private view key")
		}
	}
	if err := sc.Err(); err != nil {
		return "", secret.String{}, errors.New("input line too long")
	}
	if len(lines) != 2 {
		return "", secret.String{}, errors.New("expected two lines: the primary address, then the private view key")
	}
	if err := moneroaddr.CheckPrimary(lines[0], network); err != nil {
		return "", secret.String{}, err
	}
	view := secret.New(strings.ToLower(lines[1]))
	if err := CheckViewKey(view.Reveal()); err != nil {
		return "", secret.String{}, err
	}
	return lines[0], view, nil
}
