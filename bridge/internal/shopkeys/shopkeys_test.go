package shopkeys

import (
	"bytes"
	"fmt"
	"math/big"
	"strings"
	"testing"
)

// addrFor builds a stagenet primary address (prefix 24) with Monero's base58; not a real wallet's.
func addrFor(t *testing.T) string {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	b := append([]byte{24}, bytes.Repeat([]byte{0x5a}, 68)...)
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

func TestCheckViewKey(t *testing.T) {
	ok := []string{
		strings.Repeat("0", 63) + "1",
		"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00",
		strings.ToUpper("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00"),
	}
	for _, k := range ok {
		if err := CheckViewKey(k); err != nil {
			t.Errorf("%s: %v", k[:6], err)
		}
	}
	seed25 := strings.TrimSpace(strings.Repeat("abbey ", 25))
	bad := map[string]string{
		"25-word seed":       seed25,
		"13-word seed":       strings.TrimSpace(strings.Repeat("abbey ", 13)),
		"one word":           "abbey",
		"short":              strings.Repeat("a", 63),
		"long":               strings.Repeat("a", 65),
		"not hex":            strings.Repeat("g", 64),
		"zero":               strings.Repeat("0", 64),
		"not reduced (>= l)": strings.Repeat("f", 64),
		"inner space":        strings.Repeat("a", 32) + " " + strings.Repeat("a", 32),
	}
	for name, k := range bad {
		err := CheckViewKey(k)
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if strings.Contains(err.Error(), k) || (len(k) > 10 && strings.Contains(err.Error(), k[:10])) {
			t.Errorf("%s: the error echoes the input: %v", name, err)
		}
	}
	if err := CheckViewKey(seed25); !strings.Contains(err.Error(), "seed") {
		t.Errorf("seed message: %v", err)
	}
}

func TestReadKeys(t *testing.T) {
	key := "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00"
	in := strings.NewReader(fmt.Sprintf("  %s \r\n%s\n", addrFor(t), key))
	a, v, err := ReadKeys(in, "stagenet")
	if err != nil {
		t.Fatal(err)
	}
	if a != addrFor(t) || v.Reveal() != key {
		t.Fatal("values not read back")
	}
	if fmt.Sprint(v) != "[redacted]" {
		t.Fatal("the view key is not a secret")
	}
	for name, input := range map[string]string{
		"no view key":     addrFor(t) + "\n",
		"seed instead":    addrFor(t) + "\n" + strings.TrimSpace(strings.Repeat("abbey ", 25)) + "\n",
		"mainnet address": strings.Replace(addrFor(t), "5", "4", 1) + "\n" + key + "\n",
		"extra line":      addrFor(t) + "\n" + key + "\nmore\n",
		"empty":           "",
		"very long line":  strings.Repeat("a", 5000) + "\n" + key + "\n",
	} {
		if _, _, err := ReadKeys(strings.NewReader(input), "stagenet"); err == nil {
			t.Errorf("%s: accepted", name)
		} else if strings.Contains(err.Error(), key) {
			t.Errorf("%s: the error echoes the view key", name)
		}
	}
}
