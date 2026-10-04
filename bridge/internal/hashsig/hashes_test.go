package hashsig

import (
	"encoding/hex"
	"strings"
	"testing"
)

func TestParseRealHashes(t *testing.T) {
	text, err := Verify(readFile(t, "monero-hashes.txt"), MoneroReleaseKey, now)
	if err != nil {
		t.Fatal(err)
	}
	h, err := ParseHashes(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 19 {
		t.Fatalf("%d entries, want 19", len(h))
	}
	got := h["monero-linux-x64-v0.18.5.1.tar.bz2"]
	if hex.EncodeToString(got[:]) != "22a7dda7b0cb699fdd6b7674c3b4a4465b337cc98a54983523b759e1e7cc9958" {
		t.Fatalf("linux-x64: %x", got)
	}
	if _, ok := h["monero-linux-armv8-v0.18.5.1.tar.bz2"]; !ok {
		t.Fatal("linux-armv8 missing")
	}
}

func TestParseHashesRefuses(t *testing.T) {
	const ok = "1111111111111111111111111111111111111111111111111111111111111111  a.tar.bz2"
	cases := map[string]string{
		"no entries":             "# only comments\r\n#",
		"one space":              "1111111111111111111111111111111111111111111111111111111111111111 a.tar.bz2",
		"three spaces":           "1111111111111111111111111111111111111111111111111111111111111111   a.tar.bz2",
		"uppercase hex":          "AAAA111111111111111111111111111111111111111111111111111111111111  a.tar.bz2",
		"short hash":             "111111111111111111111111111111111111111111111111111111111111111  a.tar.bz2",
		"long hash":              "11111111111111111111111111111111111111111111111111111111111111111  a.tar.bz2",
		"path in name":           "1111111111111111111111111111111111111111111111111111111111111111  ../a.tar.bz2",
		"slash in name":          "1111111111111111111111111111111111111111111111111111111111111111  x/a.tar.bz2",
		"binary-mode star":       "1111111111111111111111111111111111111111111111111111111111111111 *a.tar.bz2",
		"space in name":          "1111111111111111111111111111111111111111111111111111111111111111  a b.tar.bz2",
		"empty name":             "1111111111111111111111111111111111111111111111111111111111111111  ",
		"dot name":               "1111111111111111111111111111111111111111111111111111111111111111  ..",
		"duplicate name":         ok + "\r\n" + strings.Replace(ok, "1111", "2222", 1),
		"stray text":             ok + "\r\nhello",
		"bare LF (not verified)": ok + "\n#",
	}
	for name, text := range cases {
		if _, err := ParseHashes([]byte(text)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	h, err := ParseHashes([]byte("# c\r\n\r\n" + ok + "\r\n#"))
	if err != nil || len(h) != 1 {
		t.Fatalf("valid text: %v, %v", h, err)
	}
}
