package edwards

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha512"
	"encoding/hex"
	"math/big"
	"testing"
)

// clamped is the Ed25519 secret scalar for a seed (RFC 8032 section 5.1.5): SHA-512, first half, clamped.
func clamped(seed []byte) []byte {
	h := sha512.Sum512(seed)
	a := h[:32]
	a[0] &= 248
	a[31] &= 127
	a[31] |= 64
	return a
}

func TestKnownPoints(t *testing.T) {
	zero := make([]byte, 32)
	one := make([]byte, 32)
	one[0] = 1
	if got := hex.EncodeToString(ScalarBaseMult(zero)); got != "0100000000000000000000000000000000000000000000000000000000000000" {
		t.Fatalf("0*B = %s, want the identity", got)
	}
	if got := hex.EncodeToString(ScalarBaseMult(one)); got != "5866666666666666666666666666666666666666666666666666666666666666" {
		t.Fatalf("1*B = %s, want the base point", got)
	}
}

// RFC 8032 section 7.1, TESTs 1 to 3: the public key from the secret seed.
func TestRFC8032(t *testing.T) {
	for _, v := range []struct{ seed, pub string }{
		{"9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"},
		{"4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"},
		{"c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7", "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025"},
	} {
		seed, _ := hex.DecodeString(v.seed)
		if got := hex.EncodeToString(ScalarBaseMult(clamped(seed))); got != v.pub {
			t.Errorf("seed %s…: %s, want %s", v.seed[:8], got, v.pub)
		}
	}
}

// Go's crypto/ed25519 as the oracle: for random seeds, our multiplication of the clamped scalar gives its key.
func TestAgainstStdlib(t *testing.T) {
	for i := 0; i < 300; i++ {
		seed := make([]byte, 32)
		rand.Read(seed)
		want := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
		if got := ScalarBaseMult(clamped(seed)); string(got) != string(want) {
			t.Fatalf("seed %x: %x, want %x", seed, got, want)
		}
	}
}

// k*B == (k mod l)*B: Monero scalars are reduced, Ed25519's clamped ones aren't; both must work.
func TestReductionInvariant(t *testing.T) {
	l, _ := new(big.Int).SetString("1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed", 16)
	for i := 0; i < 100; i++ {
		k := make([]byte, 32)
		rand.Read(k)
		v := new(big.Int).SetBytes(reverse(k))
		v.Mod(v, l)
		r := reverse(v.FillBytes(make([]byte, 32)))
		if string(ScalarBaseMult(k)) != string(ScalarBaseMult(r)) {
			t.Fatalf("k=%x: k*B != (k mod l)*B", k)
		}
	}
}

func reverse(b []byte) []byte {
	out := make([]byte, len(b))
	for i := range b {
		out[len(b)-1-i] = b[i]
	}
	return out
}

func TestRefusesWrongLength(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("no panic for a 31-byte scalar")
		}
	}()
	ScalarBaseMult(make([]byte, 31))
}

func FuzzAgainstStdlib(f *testing.F) {
	f.Add(make([]byte, 32))
	f.Fuzz(func(t *testing.T, seed []byte) {
		if len(seed) != 32 {
			return
		}
		want := ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
		if got := ScalarBaseMult(clamped(seed)); string(got) != string(want) {
			t.Fatalf("seed %x: %x, want %x", seed, got, want)
		}
	})
}
