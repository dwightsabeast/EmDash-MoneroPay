// Package moneroaddr reads the network and kind of a Monero address from its prefix, so the bridge can refuse an
// address of the wrong network or kind before anything reaches wallet-rpc. It decodes Monero's base58 (8-byte
// blocks) but doesn't verify the Keccak checksum: wallet-rpc does that when the wallet is created.
package moneroaddr

import (
	"errors"
	"fmt"
	"math/bits"
	"strings"
)

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// Kind is the address kind its prefix encodes.
type Kind int

const (
	Standard Kind = iota + 1
	Subaddress
	Integrated
)

func (k Kind) String() string {
	switch k {
	case Standard:
		return "primary address"
	case Subaddress:
		return "subaddress"
	case Integrated:
		return "integrated address"
	}
	return "unknown"
}

type prefixInfo struct {
	net  string
	kind Kind
}

// Prefixes from Monero's cryptonote_config.h (all fit in one varint byte).
var prefixes = map[uint64]prefixInfo{
	18: {"mainnet", Standard}, 42: {"mainnet", Subaddress}, 19: {"mainnet", Integrated},
	24: {"stagenet", Standard}, 36: {"stagenet", Subaddress}, 25: {"stagenet", Integrated},
	53: {"testnet", Standard}, 63: {"testnet", Subaddress}, 54: {"testnet", Integrated},
}

var errNotAddress = errors.New("not a Monero address")

// Parse returns the network ("mainnet", "stagenet" or "testnet") and kind of addr.
func Parse(addr string) (string, Kind, error) {
	b, err := decode(addr)
	if err != nil {
		return "", 0, err
	}
	// 1 prefix byte + 64 key bytes + 4 checksum bytes; integrated addresses add an 8-byte payment id.
	p, ok := prefixes[uint64(b[0])]
	if !ok || b[0]&0x80 != 0 {
		return "", 0, errNotAddress
	}
	want := 69
	if p.kind == Integrated {
		want = 77
	}
	if len(b) != want {
		return "", 0, errNotAddress
	}
	return p.net, p.kind, nil
}

// CheckPrimary returns nil if addr is a primary (standard) address on network, and otherwise a message an admin
// can act on.
func CheckPrimary(addr, network string) error {
	net, kind, err := Parse(addr)
	if err != nil {
		return errors.New("that is not a Monero address; paste the shop wallet's primary address")
	}
	if net != network {
		return fmt.Errorf("that is a %s address, but this wallet host is set up for %s", net, network)
	}
	if kind != Standard {
		return fmt.Errorf("that is a %s; paste the shop wallet's primary address (it starts with %s)", kind, primaryStart(network))
	}
	return nil
}

func primaryStart(network string) string {
	switch network {
	case "mainnet":
		return "4"
	case "stagenet":
		return "5"
	}
	return "9"
}

// blockChars[n] is the number of characters that encode an n-byte block.
var blockChars = [9]int{0, 2, 3, 5, 6, 7, 9, 10, 11}

// decode is Monero's base58: 11-character blocks for 8 bytes, a shorter last block for fewer.
func decode(s string) ([]byte, error) {
	if len(s) == 0 || len(s) > 200 {
		return nil, errNotAddress
	}
	var out []byte
	for len(s) > 0 {
		n := 11
		if len(s) < 11 {
			n = len(s)
		}
		size := -1
		for k, c := range blockChars {
			if c == n {
				size = k
			}
		}
		if size <= 0 {
			return nil, errNotAddress
		}
		var v uint64
		for i := 0; i < n; i++ {
			d := strings.IndexByte(alphabet, s[i])
			if d < 0 {
				return nil, errNotAddress
			}
			hi, lo := bits.Mul64(v, 58)
			lo, carry := bits.Add64(lo, uint64(d), 0)
			if hi != 0 || carry != 0 {
				return nil, errNotAddress
			}
			v = lo
		}
		if size < 8 && v>>(8*size) != 0 {
			return nil, errNotAddress
		}
		for i := size - 1; i >= 0; i-- {
			out = append(out, byte(v>>(8*i)))
		}
		s = s[n:]
	}
	return out, nil
}
