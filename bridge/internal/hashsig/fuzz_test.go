package hashsig

import (
	"bytes"
	"testing"
)

// FuzzVerify: no input verifies with text other than what the key's holder actually signed. Byte changes that only
// alter the encoding (line endings, trailing whitespace, armor line wrapping) may still verify, but the returned
// text must then be exactly one of the genuine signed texts. It must also never panic.
func FuzzVerify(f *testing.F) {
	a, b := loadKey(f, "testkey-a.asc"), loadKey(f, "testkey-b.asc")
	realText, err := Verify(readFile(f, "monero-hashes.txt"), MoneroReleaseKey, now)
	if err != nil {
		f.Fatal(err)
	}
	genuine := map[[20]byte][][]byte{
		MoneroReleaseKey.Fingerprint: {realText},
		a.Fingerprint:                {[]byte(testMessage)},
		b.Fingerprint:                {[]byte(testMessage)}, // B signed the same message (wrong-signer and two-signature files)
	}
	for _, name := range []string{"monero-hashes.txt", "good-sha256.txt", "good-sha512.txt", "good-expires-later.txt",
		"bad-wrong-signer.txt", "bad-subkey-signer.txt", "bad-two-signatures.txt", "bad-sha384.txt", "bad-expired.txt",
		"bad-hash-header-mismatch.txt"} {
		f.Add(readFile(f, name))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		for _, k := range []PublicKey{MoneroReleaseKey, a, b} {
			text, err := Verify(data, k, now)
			if err != nil {
				continue
			}
			ok := false
			for _, g := range genuine[k.Fingerprint] {
				ok = ok || bytes.Equal(text, g)
			}
			if !ok {
				t.Fatalf("verified text that %x never signed:\n%q", k.Fingerprint, text)
			}
			if k.Fingerprint == MoneroReleaseKey.Fingerprint {
				if _, err := ParseHashes(text); err != nil {
					t.Fatalf("verified Monero text doesn't parse: %v", err)
				}
			}
		}
	})
}

// FuzzSignaturePacket feeds arbitrary signature packets under the real signed text: no panic, and anything that
// verifies is over the genuine text by construction (so it would be a real signature by the pinned key).
func FuzzSignaturePacket(f *testing.F) {
	real := readFile(f, "monero-hashes.txt")
	head, sig := splitSigned(f, real)
	pkt, err := decodeArmor(sig, "PGP SIGNATURE")
	if err != nil {
		f.Fatal(err)
	}
	f.Add(pkt)
	for _, name := range []string{"good-sha256.txt", "bad-two-signatures.txt", "bad-expired.txt"} {
		_, s := splitSigned(f, readFile(f, name))
		p, err := decodeArmor(s, "PGP SIGNATURE")
		if err != nil {
			f.Fatal(err)
		}
		f.Add(p)
	}
	f.Fuzz(func(t *testing.T, p []byte) {
		Verify(append(append([]byte{}, head...), armorSignature(p)...), MoneroReleaseKey, now)
	})
}

// FuzzParseHashes: never panics; whatever it accepts has only valid names.
func FuzzParseHashes(f *testing.F) {
	realText, err := Verify(readFile(f, "monero-hashes.txt"), MoneroReleaseKey, now)
	if err != nil {
		f.Fatal(err)
	}
	f.Add(realText)
	f.Add([]byte(testMessage))
	f.Fuzz(func(t *testing.T, text []byte) {
		h, err := ParseHashes(text)
		if err != nil {
			return
		}
		for name := range h {
			if !isFileName(name) {
				t.Fatalf("accepted name %q", name)
			}
		}
	})
}
