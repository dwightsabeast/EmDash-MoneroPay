package shopkeys

import (
	"errors"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/edwards"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/testaddr"
)

// Reduced scalars (below l), as Monero private keys are; made up for the test.
const (
	testView  = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00"
	testSpend = "a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf00"
	otherKey  = "1112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f00"
)

func pub(t *testing.T, hexKey string) []byte {
	t.Helper()
	b := make([]byte, 32)
	for i := range b {
		var v byte
		for _, c := range hexKey[2*i : 2*i+2] {
			v <<= 4
			if c <= '9' {
				v |= byte(c - '0')
			} else {
				v |= byte(c-'a') + 10
			}
		}
		b[i] = v
	}
	return edwards.ScalarBaseMult(b)
}

func shopAddress(t *testing.T) string {
	return testaddr.FromKeys(24, pub(t, testSpend), pub(t, testView))
}

func TestViewKeyMatches(t *testing.T) {
	a := shopAddress(t)
	if err := CheckViewKeyMatches(a, secret.New(testView)); err != nil {
		t.Fatal(err)
	}
	if err := CheckViewKeyMatches(a, secret.New(strings.ToUpper(testView))); err != nil {
		t.Fatalf("upper case: %v", err)
	}
	if err := CheckViewKeyMatches(a, secret.New(testSpend)); !errors.Is(err, ErrSpendKey) {
		t.Fatalf("the spend key: %v", err)
	}
	if err := CheckViewKeyMatches(a, secret.New(otherKey)); !errors.Is(err, ErrViewKeyMismatch) {
		t.Fatalf("another key: %v", err)
	}
	if err := CheckViewKeyMatches(a, secret.New("zz")); err == nil {
		t.Fatal("garbage accepted")
	}
	for _, k := range []string{testView, testSpend, otherKey} {
		err := CheckViewKeyMatches(a, secret.New(k))
		if err != nil && strings.Contains(err.Error(), k) {
			t.Fatal("an error repeats the key")
		}
	}
}

func TestReadKeysChecksTheMatch(t *testing.T) {
	a := shopAddress(t)
	if _, _, err := ReadKeys(strings.NewReader(a+"\n"+testView+"\n"), "stagenet"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadKeys(strings.NewReader(a+"\n"+testSpend+"\n"), "stagenet"); !errors.Is(err, ErrSpendKey) {
		t.Fatalf("spend key: %v", err)
	}
	if _, _, err := ReadKeys(strings.NewReader(a+"\n"+otherKey+"\n"), "stagenet"); !errors.Is(err, ErrViewKeyMismatch) {
		t.Fatalf("other key: %v", err)
	}
}
