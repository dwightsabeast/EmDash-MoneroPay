// Package testaddr builds Monero-shaped addresses for tests (any prefix, filler key bytes, no real checksum). Only
// test files import it, so it is never compiled into the bridge.
package testaddr

import (
	"bytes"
	"math/big"
	"strings"
)

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// Stagenet, Mainnet and Testnet are primary addresses built with Make.
var (
	Stagenet = Make(24, 0x5a)
	Mainnet  = Make(18, 0x5a)
	Testnet  = Make(53, 0x5a)
)

// Make encodes prefix, 64 key bytes of fill and a 4-byte placeholder checksum with Monero's base58.
func Make(prefix, fill byte) string {
	b := append([]byte{prefix}, bytes.Repeat([]byte{fill}, 68)...)
	sizes := map[int]int{5: 7, 8: 11}
	var out strings.Builder
	for len(b) > 0 {
		n := min(8, len(b))
		v := new(big.Int).SetBytes(b[:n])
		chars := make([]byte, sizes[n])
		for i := len(chars) - 1; i >= 0; i-- {
			m := new(big.Int)
			v.DivMod(v, big.NewInt(58), m)
			chars[i] = alphabet[m.Int64()]
		}
		out.Write(chars)
		b = b[n:]
	}
	return out.String()
}
