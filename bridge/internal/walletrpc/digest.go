package walletrpc

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// challenge is one parsed `WWW-Authenticate: Digest …` offer that the client can answer: RFC 7616 with MD5 and
// qop=auth, which is what monero-wallet-rpc's --rpc-login uses. wallet-rpc 0.18.5.1 offers MD5 and MD5-sess with the
// same nonce; MD5 is taken.
type challenge struct {
	realm, nonce, opaque string
	stale                bool
}

var errUnsupportedChallenge = errors.New("walletrpc: unsupported authentication challenge (want Digest, MD5, qop=auth)")

// pickChallenge returns the first usable Digest offer among the header values.
func pickChallenge(values []string) (challenge, error) {
	for _, v := range values {
		scheme, rest, _ := strings.Cut(strings.TrimSpace(v), " ")
		if !strings.EqualFold(scheme, "Digest") {
			continue
		}
		p, err := parseParams(rest)
		if err != nil {
			continue
		}
		if alg, ok := p["algorithm"]; ok && !strings.EqualFold(alg, "MD5") {
			continue
		}
		if !hasToken(p["qop"], "auth") || p["nonce"] == "" {
			continue
		}
		return challenge{realm: p["realm"], nonce: p["nonce"], opaque: p["opaque"], stale: strings.EqualFold(p["stale"], "true")}, nil
	}
	return challenge{}, errUnsupportedChallenge
}

func hasToken(list, want string) bool {
	for _, t := range strings.Split(list, ",") {
		if strings.TrimSpace(t) == want {
			return true
		}
	}
	return false
}

// parseParams parses `k=v, k="quoted, \"value\""` lists. Keys are lowercased.
func parseParams(s string) (map[string]string, error) {
	out := map[string]string{}
	for {
		s = strings.TrimLeft(s, " \t,")
		if s == "" {
			return out, nil
		}
		eq := strings.IndexByte(s, '=')
		if eq <= 0 {
			return nil, errors.New("malformed parameter")
		}
		key := strings.ToLower(strings.TrimSpace(s[:eq]))
		s = strings.TrimLeft(s[eq+1:], " \t")
		var val strings.Builder
		if strings.HasPrefix(s, `"`) {
			i, closed := 1, false
			for ; i < len(s); i++ {
				if s[i] == '\\' && i+1 < len(s) {
					i++
					val.WriteByte(s[i])
					continue
				}
				if s[i] == '"' {
					closed = true
					break
				}
				val.WriteByte(s[i])
			}
			if !closed {
				return nil, errors.New("unterminated quoted value")
			}
			s = s[i+1:]
		} else {
			end := strings.IndexByte(s, ',')
			if end < 0 {
				end = len(s)
			}
			val.WriteString(strings.TrimSpace(s[:end]))
			s = s[end:]
		}
		out[key] = val.String()
	}
}

func md5hex(s string) string {
	h := md5.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}

// authorization builds the Authorization header for one request. nc counts requests under this nonce from 1.
func authorization(ch challenge, user, pass, method, uri string, nc uint32) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	cnonce := hex.EncodeToString(b)
	ncs := fmt.Sprintf("%08x", nc)
	ha1 := md5hex(user + ":" + ch.realm + ":" + pass)
	ha2 := md5hex(method + ":" + uri)
	resp := md5hex(strings.Join([]string{ha1, ch.nonce, ncs, cnonce, "auth", ha2}, ":"))
	h := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", algorithm=MD5, qop=auth, nc=%s, cnonce="%s", response="%s"`,
		quote(user), quote(ch.realm), quote(ch.nonce), quote(uri), ncs, cnonce, resp)
	if ch.opaque != "" {
		h += fmt.Sprintf(`, opaque="%s"`, quote(ch.opaque))
	}
	return h, nil
}

func quote(s string) string { return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) }
