package moneroaddr

import (
	"bytes"
	"math/big"
	"strings"
	"testing"
)

// encode is Monero's base58 (8-byte blocks to 11 characters, a short last block to fewer), for building test
// addresses. Checksums are not computed: Parse doesn't check them (wallet-rpc does).
func encode(b []byte) string {
	sizes := map[int]int{0: 0, 1: 2, 2: 3, 3: 5, 4: 6, 5: 7, 6: 9, 7: 10, 8: 11}
	var out strings.Builder
	for len(b) > 0 {
		n := 8
		if len(b) < 8 {
			n = len(b)
		}
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

func address(prefix byte, extra int) string {
	b := append([]byte{prefix}, bytes.Repeat([]byte{0xa5}, 64+extra)...)
	return encode(append(b, 1, 2, 3, 4)) // checksum bytes: not checked here
}

func TestParse(t *testing.T) {
	cases := []struct {
		prefix byte
		extra  int // 8 for integrated (payment id)
		net    string
		kind   Kind
		first  byte
	}{
		{18, 0, "mainnet", Standard, '4'},
		{42, 0, "mainnet", Subaddress, '8'},
		{19, 8, "mainnet", Integrated, '4'},
		{24, 0, "stagenet", Standard, '5'},
		{36, 0, "stagenet", Subaddress, '7'},
		{25, 8, "stagenet", Integrated, '5'},
		{53, 0, "testnet", Standard, '9'},
		{63, 0, "testnet", Subaddress, 'B'},
		{54, 8, "testnet", Integrated, 'A'},
	}
	for _, c := range cases {
		a := address(c.prefix, c.extra)
		if a[0] != c.first {
			t.Fatalf("test setup: prefix %d encodes to %q", c.prefix, a[:1])
		}
		net, kind, err := Parse(a)
		if err != nil || net != c.net || kind != c.kind {
			t.Errorf("prefix %d: %s %v %v", c.prefix, net, kind, err)
		}
	}
}

func TestCheckPrimary(t *testing.T) {
	if err := CheckPrimary(address(24, 0), "stagenet"); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct{ addr, net, want string }{
		"other network":  {address(18, 0), "stagenet", "mainnet"},
		"subaddress":     {address(36, 0), "stagenet", "subaddress"},
		"integrated":     {address(25, 8), "stagenet", "integrated"},
		"empty":          {"", "stagenet", "address"},
		"bad character":  {"0" + address(24, 0)[1:], "stagenet", "address"},
		"too short":      {address(24, 0)[:94], "stagenet", "address"},
		"too long":       {address(24, 0) + "1", "stagenet", "address"},
		"block overflow": {"5zzzzzzzzzz" + address(24, 0)[11:], "stagenet", "address"},
		"unknown prefix": {address(99, 0), "stagenet", "address"},
		"spaces":         {" " + address(24, 0), "stagenet", "address"},
	} {
		err := CheckPrimary(c.addr, c.net)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v (want a message mentioning %q)", name, err, c.want)
		}
	}
}
