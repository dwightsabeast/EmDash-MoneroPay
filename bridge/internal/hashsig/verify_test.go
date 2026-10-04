package hashsig

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

// The message the test files sign, as the verifier must return it: dash-escaping undone, trailing spaces and tabs
// removed, lines joined with CRLF, no final line break.
const testMessage = "# xmr-pay hash-list verifier test file. Not a real Monero release.\r\n" +
	"#\r\n" +
	"## CLI\r\n" +
	"1111111111111111111111111111111111111111111111111111111111111111  monero-linux-x64-v0.18.5.1.tar.bz2\r\n" +
	"2222222222222222222222222222222222222222222222222222222222222222  monero-linux-armv8-v0.18.5.1.tar.bz2\r\n" +
	"-- a line starting with a dash is dash-escaped in the signed file\r\n" +
	"#"

func TestPinnedKeyMatchesPublishedKey(t *testing.T) {
	pub := loadKey(t, "binaryfate.asc")
	if pub.Fingerprint != MoneroReleaseKey.Fingerprint || pub.Created != MoneroReleaseKey.Created ||
		pub.Key.N.Cmp(MoneroReleaseKey.Key.N) != 0 || pub.Key.E != MoneroReleaseKey.Key.E {
		t.Fatal("the pinned key differs from testdata/binaryfate.asc")
	}
	if got := strings.ToUpper(hex.EncodeToString(MoneroReleaseKey.Fingerprint[:])); got != "81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92" {
		t.Fatalf("pinned fingerprint %s", got)
	}
	if MoneroReleaseKey.Key.N.BitLen() != 4096 {
		t.Fatalf("pinned key is %d bits", MoneroReleaseKey.Key.N.BitLen())
	}
}

func TestRealHashesVerify(t *testing.T) {
	text, err := Verify(readFile(t, "monero-hashes.txt"), MoneroReleaseKey, now)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(text, []byte("22a7dda7b0cb699fdd6b7674c3b4a4465b337cc98a54983523b759e1e7cc9958  monero-linux-x64-v0.18.5.1.tar.bz2\r\n")) {
		t.Fatal("verified text lacks the linux-x64 line")
	}
	if bytes.Contains(text, []byte("BEGIN PGP")) {
		t.Fatal("verified text includes armor")
	}
}

func TestGoodTestFiles(t *testing.T) {
	a := loadKey(t, "testkey-a.asc")
	for _, name := range []string{"good-sha256.txt", "good-sha512.txt", "good-expires-later.txt"} {
		text, err := Verify(readFile(t, name), a, now)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if string(text) != testMessage {
			t.Errorf("%s: verified text\n%q\nwant\n%q", name, text, testMessage)
		}
	}
}

func TestBadTestFiles(t *testing.T) {
	a := loadKey(t, "testkey-a.asc")
	cases := map[string]error{
		"bad-wrong-signer.txt":         ErrUnknownSigner,
		"bad-subkey-signer.txt":        ErrUnknownSigner,
		"bad-two-signatures.txt":       nil, // any error
		"bad-sha384.txt":               nil,
		"bad-expired.txt":              ErrExpired,
		"bad-hash-header-mismatch.txt": nil,
	}
	for name, want := range cases {
		_, err := Verify(readFile(t, name), a, now)
		if err == nil {
			t.Errorf("%s: verified", name)
		} else if want != nil && !errors.Is(err, want) {
			t.Errorf("%s: %v, want %v", name, err, want)
		}
	}
}

func TestKeysAreNotInterchangeable(t *testing.T) {
	a, b := loadKey(t, "testkey-a.asc"), loadKey(t, "testkey-b.asc")
	if _, err := Verify(readFile(t, "monero-hashes.txt"), a, now); !errors.Is(err, ErrUnknownSigner) {
		t.Fatalf("real file with test key A: %v", err)
	}
	if _, err := Verify(readFile(t, "good-sha256.txt"), MoneroReleaseKey, now); !errors.Is(err, ErrUnknownSigner) {
		t.Fatalf("test file with the Monero key: %v", err)
	}
	if _, err := Verify(readFile(t, "good-sha256.txt"), b, now); !errors.Is(err, ErrUnknownSigner) {
		t.Fatalf("A's file with B's key: %v", err)
	}
}

// Equivalent encodings of the same signed text verify and return the same text.
func TestCanonicalEquivalents(t *testing.T) {
	real := readFile(t, "monero-hashes.txt")
	want, err := Verify(real, MoneroReleaseKey, now)
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{
		"CRLF line endings":         bytes.ReplaceAll(real, []byte("\n"), []byte("\r\n")),
		"trailing spaces on a line": bytes.Replace(real, []byte("## CLI\n"), []byte("## CLI  \t \n"), 1),
		"no final newline":          bytes.TrimSuffix(real, []byte("\n")),
	} {
		got, err := Verify(data, MoneroReleaseKey, now)
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestTamperedRealFile(t *testing.T) {
	real := readFile(t, "monero-hashes.txt")
	head, sig := splitSigned(t, real)
	rep := func(old, new string) []byte {
		if !bytes.Contains(real, []byte(old)) {
			t.Fatalf("test setup: %q not found", old)
		}
		return bytes.Replace(real, []byte(old), []byte(new), 1)
	}
	sigBody, err := decodeArmor(sig, "PGP SIGNATURE")
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"one hash character changed":    rep("22a7dda7b0cb", "22a7dda7b0cc"),
		"a signed line added":           rep("## GUI\n", "## GUI\n0000000000000000000000000000000000000000000000000000000000000000  monero-linux-x64-v0.18.5.1.tar.bz2\n"),
		"text before the signed block":  append([]byte("22a7dda7b0cb699fdd6b7674c3b4a4465b337cc98a54983523b759e1e7cc9958  evil.tar.bz2\n"), real...),
		"text after the signature":      append(append([]byte{}, real...), []byte("0000000000000000000000000000000000000000000000000000000000000000  monero-linux-x64-v0.18.5.1.tar.bz2\n")...),
		"a blank line after the end":    append(append([]byte{}, real...), '\n'),
		"armor checksum changed":        rep("=WC0m", "=WC0n"),
		"armor checksum missing":        rep("=WC0m\n", ""),
		"header in the signature block": rep("-----BEGIN PGP SIGNATURE-----\n", "-----BEGIN PGP SIGNATURE-----\nVersion: x\n"),
		"extra message header":          rep("Hash: SHA256\n", "Hash: SHA256\nComment: x\n"),
		"hash header missing":           rep("Hash: SHA256\n", ""),
		"hash header twice":             rep("Hash: SHA256\n", "Hash: SHA256\nHash: SHA256\n"),
		"hash header SHA512":            rep("Hash: SHA256\n", "Hash: SHA512\n"),
		"hash header list":              rep("Hash: SHA256\n", "Hash: SHA256,SHA512\n"),
		"unescaped dash line":           rep("## CLI\n", "-x\n## CLI\n"),
		"base64 character corrupted":    rep("iQIzBAEBCAAdFiEEgaxZ", "iQIzBAEBCAAdFiEEgaxY"),
		"signature block cut short":     bytes.Replace(real, []byte("-----END PGP SIGNATURE-----\n"), nil, 1),
		"two signed messages":           append(append([]byte{}, real...), real...),
		"extra packet after signature":  append(append([]byte{}, head...), armorSignature(append(append([]byte{}, sigBody...), 0xcb, 0x01, 0x00))...),
		"signature packet truncated":    append(append([]byte{}, head...), armorSignature(sigBody[:len(sigBody)-1])...),
		"empty signature":               append(append([]byte{}, head...), armorSignature(nil)...),
		"begin line with leading space": append([]byte(" "), real...),
	}
	for name, data := range cases {
		if _, err := Verify(data, MoneroReleaseKey, now); err == nil {
			t.Errorf("%s: verified", name)
		}
	}
}

func TestSizeCap(t *testing.T) {
	real := readFile(t, "monero-hashes.txt")
	big := bytes.Replace(real, []byte("## GUI\n"), append(bytes.Repeat([]byte("#\n"), 40_000), []byte("## GUI\n")...), 1)
	if _, err := Verify(big, MoneroReleaseKey, now); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("want too large, got %v", err)
	}
}

func TestExpiryIsChecked(t *testing.T) {
	a := loadKey(t, "testkey-a.asc")
	// good-expires-later.txt carries a 50-year expiry: it verifies now and fails after expiry.
	data := readFile(t, "good-expires-later.txt")
	if _, err := Verify(data, a, now.AddDate(51, 0, 0)); !errors.Is(err, ErrExpired) {
		t.Fatalf("after expiry: %v", err)
	}
}

// The 2-byte digest prefix is only a quick check: a signature value that doesn't match must fail even when the
// prefix is right, and a wrong prefix must fail even when the value is right.
func TestSignatureValueAndPrefix(t *testing.T) {
	real := readFile(t, "monero-hashes.txt")
	head, sig := splitSigned(t, real)
	pkt, err := decodeArmor(sig, "PGP SIGNATURE")
	if err != nil {
		t.Fatal(err)
	}
	last := append([]byte{}, pkt...)
	last[len(last)-1] ^= 0x01 // the signature value's last byte
	if _, err := Verify(append(append([]byte{}, head...), armorSignature(last)...), MoneroReleaseKey, now); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("altered signature value: %v", err)
	}
	// The prefix sits just before the 2-byte MPI length of a 4096-bit value (512 bytes).
	pre := append([]byte{}, pkt...)
	pre[len(pre)-512-2-2] ^= 0x01
	if _, err := Verify(append(append([]byte{}, head...), armorSignature(pre)...), MoneroReleaseKey, now); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("altered digest prefix: %v", err)
	}
}

// The issuer key ID sits in the unhashed area, outside the signature: changing it must still be refused.
func TestIssuerChecks(t *testing.T) {
	real := readFile(t, "monero-hashes.txt")
	head, sig := splitSigned(t, real)
	pkt, err := decodeArmor(sig, "PGP SIGNATURE")
	if err != nil {
		t.Fatal(err)
	}
	keyID := MoneroReleaseKey.Fingerprint[12:]
	i := bytes.LastIndex(pkt, keyID)
	if i < 0 {
		t.Fatal("test setup: issuer key ID not found")
	}
	alt := append([]byte{}, pkt...)
	alt[i+7] ^= 0x01
	if _, err := Verify(append(append([]byte{}, head...), armorSignature(alt)...), MoneroReleaseKey, now); !errors.Is(err, ErrUnknownSigner) {
		t.Fatalf("unhashed issuer key ID changed: %v", err)
	}
	// A key whose fingerprint differs only outside the last 8 bytes: the key ID matches, the fingerprint doesn't.
	k := MoneroReleaseKey
	k.Fingerprint[0] ^= 0x01
	if _, err := Verify(real, k, now); !errors.Is(err, ErrUnknownSigner) {
		t.Fatalf("issuer fingerprint mismatch with a matching key ID: %v", err)
	}
}

func TestSignatureOlderThanKey(t *testing.T) {
	k := MoneroReleaseKey
	k.Created = uint32(now.Unix()) // the key claims to be newer than the signature
	if _, err := Verify(readFile(t, "monero-hashes.txt"), k, now); err == nil || !strings.Contains(err.Error(), "older than its key") {
		t.Fatalf("got %v", err)
	}
}

// An MPI whose bit count disagrees with its bytes is refused: here the real count minus 3, still 512 bytes long.
func TestNonMinimalMPI(t *testing.T) {
	real := readFile(t, "monero-hashes.txt")
	head, sig := splitSigned(t, real)
	pkt, err := decodeArmor(sig, "PGP SIGNATURE")
	if err != nil {
		t.Fatal(err)
	}
	alt := append([]byte{}, pkt...)
	at := len(alt) - 512 - 2
	bits := int(alt[at])<<8 | int(alt[at+1])
	if (bits+7)/8 != 512 || (bits-3+7)/8 != 512 {
		t.Fatalf("test setup: signature value is %d bits", bits)
	}
	bits -= 3
	alt[at], alt[at+1] = byte(bits>>8), byte(bits)
	if _, err := Verify(append(append([]byte{}, head...), armorSignature(alt)...), MoneroReleaseKey, now); err == nil || !strings.Contains(err.Error(), "MPI") {
		t.Fatalf("got %v", err)
	}
}
