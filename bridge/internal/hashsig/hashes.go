package hashsig

import (
	"encoding/hex"
	"strings"
)

// ParseHashes reads the "<sha256 hex>  <file name>" lines of a verified hashes.txt. It takes the canonical text
// Verify returns (lines joined with CRLF) and nothing else. Comment lines ("#…") and empty lines are skipped; any
// other line, a duplicate name, or a list with no entries is refused.
func ParseHashes(text []byte) (map[string][32]byte, error) {
	out := map[string][32]byte{}
	for _, line := range strings.Split(string(text), "\r\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		h, name, ok := strings.Cut(line, "  ")
		if !ok || len(h) != 64 || !isLowerHex(h) || !isFileName(name) {
			return nil, malformed("unexpected line in the hash list")
		}
		if _, dup := out[name]; dup {
			return nil, malformed("file listed twice in the hash list")
		}
		var sum [32]byte
		hex.Decode(sum[:], []byte(h))
		out[name] = sum
	}
	if len(out) == 0 {
		return nil, malformed("hash list has no entries")
	}
	return out, nil
}

func isLowerHex(s string) bool {
	for i := 0; i < len(s); i++ {
		if !('0' <= s[i] && s[i] <= '9' || 'a' <= s[i] && s[i] <= 'f') {
			return false
		}
	}
	return true
}

// isFileName allows plain release file names only: letters, digits, '.', '-', '_', not starting with '.'.
func isFileName(s string) bool {
	if s == "" || s[0] == '.' {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' || c == '.' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
