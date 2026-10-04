package hashsig

import (
	"bytes"
	"encoding/base64"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// now is a fixed "current time" for tests: after every test signature, before the 50-year expiry.
var now = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

func readFile(t testing.TB, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// loadKey reads an armored public key (test helper only; the shipped bridge never parses key files: its one key
// is pinned as constants). It takes the primary key packet (tag 6), v4 RSA.
func loadKey(t testing.TB, name string) PublicKey {
	t.Helper()
	data := readFile(t, name)
	body, err := decodeArmor(data, "PGP PUBLIC KEY BLOCK")
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	tag, pkt, _, err := readPacket(body)
	if err != nil || tag != 6 {
		t.Fatalf("%s: first packet tag %d, %v", name, tag, err)
	}
	if len(pkt) < 6 || pkt[0] != 4 || pkt[5] != 1 {
		t.Fatalf("%s: not a v4 RSA key", name)
	}
	created := uint32(pkt[1])<<24 | uint32(pkt[2])<<16 | uint32(pkt[3])<<8 | uint32(pkt[4])
	n, rest, err := readMPI(pkt[6:])
	if err != nil {
		t.Fatal(err)
	}
	e, _, err := readMPI(rest)
	if err != nil {
		t.Fatal(err)
	}
	k, err := NewRSAKey(created, n, e)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// armorSignature re-armors signature packet bytes (for tampering tests), with a correct checksum.
func armorSignature(pkt []byte) string {
	var b strings.Builder
	b.WriteString("-----BEGIN PGP SIGNATURE-----\n\n")
	enc := base64.StdEncoding.EncodeToString(pkt)
	for len(enc) > 64 {
		b.WriteString(enc[:64] + "\n")
		enc = enc[64:]
	}
	b.WriteString(enc + "\n")
	c := crc24(pkt)
	b.WriteString("=" + base64.StdEncoding.EncodeToString([]byte{byte(c >> 16), byte(c >> 8), byte(c)}) + "\n")
	b.WriteString("-----END PGP SIGNATURE-----\n")
	return b.String()
}

// splitSigned splits a cleartext-signed file at its signature armor.
func splitSigned(t testing.TB, data []byte) (head, sig []byte) {
	t.Helper()
	i := bytes.Index(data, []byte("-----BEGIN PGP SIGNATURE-----"))
	if i < 0 {
		t.Fatal("no signature armor")
	}
	return data[:i], data[i:]
}

func bigFromHex(t testing.TB, h string) *big.Int {
	n, ok := new(big.Int).SetString(h, 16)
	if !ok {
		t.Fatal("bad hex")
	}
	return n
}
