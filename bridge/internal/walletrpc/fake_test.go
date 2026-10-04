package walletrpc

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// fakeRPC is a wallet-rpc stand-in with its own digest check (RFC 7616, MD5, qop=auth), written independently of
// the client's: a fresh nonce per challenge, nc must rise per nonce, and a nonce can be made stale.
type fakeRPC struct {
	t          *testing.T
	user, pass string
	// challenges is what the 401 offers, in order; %s is replaced by the nonce. Defaults to wallet-rpc 0.18.5.1's
	// pair (MD5-sess listed after MD5 there; reversed here so the client must choose, not take the first).
	challenges []string
	results    map[string]string // method -> raw JSON for "result" (or a full response body if it starts with "!")

	mu       sync.Mutex
	nonce    string
	nonceN   int
	lastNC   map[string]uint64
	requests int
	unauth   int
	calls    []fakeCall
}

type fakeCall struct {
	Method string
	Params json.RawMessage
}

func newFake(t *testing.T) (*fakeRPC, *httptest.Server) {
	f := &fakeRPC{
		t: t, user: "bridge", pass: "pa55-w0rd-xyz",
		challenges: []string{
			`Digest qop="auth",algorithm=MD5-sess,realm="monero-rpc",nonce="%s",stale=%s`,
			`Digest qop="auth",algorithm=MD5,realm="monero-rpc",nonce="%s",stale=%s`,
		},
		results: map[string]string{},
		lastNC:  map[string]uint64{},
	}
	f.rotate()
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	return f, srv
}

func (f *fakeRPC) rotate() {
	f.nonceN++
	f.nonce = fmt.Sprintf("bm9uY2U%d==", f.nonceN)
}

// staleNonce makes the current nonce stale: the next request with it gets 401 stale=true.
func (f *fakeRPC) staleNonce() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rotate()
}

func (f *fakeRPC) challenge(w http.ResponseWriter, stale bool) {
	for _, c := range f.challenges {
		w.Header().Add("WWW-Authenticate", fmt.Sprintf(c, f.nonce, strconv.FormatBool(stale)))
	}
	f.unauth++
	w.WriteHeader(http.StatusUnauthorized)
}

func fakeMD5(s string) string { h := md5.Sum([]byte(s)); return hex.EncodeToString(h[:]) }

func (f *fakeRPC) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests++
	if r.Method != http.MethodPost || r.URL.Path != "/json_rpc" {
		http.Error(w, "bad path", http.StatusNotFound)
		return
	}
	p, ok := parseFakeAuth(r.Header.Get("Authorization"))
	if !ok {
		f.challenge(w, false)
		return
	}
	if p["username"] != f.user || p["realm"] != "monero-rpc" || p["uri"] != "/json_rpc" || p["qop"] != "auth" || p["algorithm"] != "MD5" || p["cnonce"] == "" {
		f.challenge(w, false)
		return
	}
	if p["nonce"] != f.nonce {
		f.challenge(w, true)
		return
	}
	nc, err := strconv.ParseUint(p["nc"], 16, 64)
	if err != nil || len(p["nc"]) != 8 || nc <= f.lastNC[p["nonce"]] {
		f.challenge(w, false)
		return
	}
	ha1 := fakeMD5(f.user + ":monero-rpc:" + f.pass)
	ha2 := fakeMD5("POST:/json_rpc")
	want := fakeMD5(strings.Join([]string{ha1, p["nonce"], p["nc"], p["cnonce"], "auth", ha2}, ":"))
	if p["response"] != want {
		f.challenge(w, false)
		return
	}
	f.lastNC[p["nonce"]] = nc

	body, _ := io.ReadAll(r.Body)
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.JSONRPC != "2.0" {
		f.t.Errorf("bad JSON-RPC request: %s", body)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	f.calls = append(f.calls, fakeCall{req.Method, req.Params})
	res, ok := f.results[req.Method]
	if !ok {
		res = `!{"jsonrpc":"2.0","id":"0","error":{"code":-32601,"message":"Method not found"}}`
	}
	w.Header().Set("Content-Type", "application/json")
	if strings.HasPrefix(res, "!") {
		io.WriteString(w, res[1:])
		return
	}
	io.WriteString(w, `{"jsonrpc":"2.0","id":"0","result":`+res+`}`)
}

func parseFakeAuth(h string) (map[string]string, bool) {
	rest, ok := strings.CutPrefix(h, "Digest ")
	if !ok {
		return nil, false
	}
	out := map[string]string{}
	for _, part := range strings.Split(rest, ", ") {
		k, v, ok := strings.Cut(part, "=")
		if !ok {
			return nil, false
		}
		out[k] = strings.Trim(v, `"`)
	}
	return out, true
}
