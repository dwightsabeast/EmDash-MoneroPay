package syncclient

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/syncsign"
)

var now = time.Unix(1790000000, 0)

type seen struct {
	method, path, ct, ts, sig, origin, auth string
	body                                    []byte
}

func site(t *testing.T, status int, reply string) (*httptest.Server, *seen) {
	s := &seen{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.method, s.path, s.ct = r.Method, r.URL.Path, r.Header.Get("Content-Type")
		s.ts, s.sig = r.Header.Get("x-xmr-ts"), r.Header.Get("x-xmr-sig")
		s.origin, s.auth = r.Header.Get("Origin"), r.Header.Get("Authorization")
		s.body, _ = io.ReadAll(r.Body)
		if strings.HasPrefix(reply, "redirect:") {
			http.Redirect(w, r, strings.TrimPrefix(reply, "redirect:"), http.StatusFound)
			return
		}
		w.WriteHeader(status)
		io.WriteString(w, reply)
	}))
	t.Cleanup(srv.Close)
	return srv, s
}

func client(srv *httptest.Server) *Client {
	return &Client{Site: srv.URL + "/", HTTP: srv.Client(), Now: func() time.Time { return now }}
}

const okReply = `{"success":true,"data":{"ok":true,"poolFree":41,"poolTarget":50,"watch":[12,17]}}`

func TestPoolTop(t *testing.T) {
	// Spec change 15: an optional field; a site without it (an older plugin) reads as 0, which never starts a catch-up.
	for reply, want := range map[string]uint32{
		okReply: 0,
		`{"success":true,"data":{"ok":true,"poolFree":41,"poolTarget":50,"poolTop":312,"watch":[]}}`: 312,
	} {
		srv, _ := site(t, 200, reply)
		k, _ := syncsign.NewKey()
		resp, err := client(srv).Send(context.Background(), k, Body{V: 1, Seq: 1})
		if err != nil || resp.PoolTop != want {
			t.Fatalf("%s: PoolTop %d, %v", reply, resp.PoolTop, err)
		}
	}
}

func TestRestoreHeight(t *testing.T) {
	// Spec change 17: only on a pairing response; absent reads as 0 (no suggestion). A suggestion of 0 reads as 1, so it
	// can never be taken for "today".
	for reply, want := range map[string]uint64{
		okReply: 0,
		`{"success":true,"data":{"ok":true,"poolFree":41,"poolTarget":50,"watch":[],"restoreHeight":2221280}}`: 2221280,
		`{"success":true,"data":{"ok":true,"poolFree":41,"poolTarget":50,"watch":[],"restoreHeight":0}}`:       1,
	} {
		srv, _ := site(t, 200, reply)
		k, _ := syncsign.NewKey()
		resp, err := client(srv).Send(context.Background(), k, Body{V: 1, Seq: 1})
		if err != nil || resp.RestoreHeight != want {
			t.Fatalf("%s: RestoreHeight %d, %v", reply, resp.RestoreHeight, err)
		}
	}
}

func TestSend(t *testing.T) {
	srv, s := site(t, 200, okReply)
	k, _ := syncsign.NewKey()
	body := Body{V: 1, Seq: 1790000000123, Height: 3012345,
		Snapshots: []Snapshot{{Index: 12, Transfers: []Transfer{{TxID: strings.Repeat("a", 64), Amount: "18446744073709551615", Confirmations: 3, Height: 3012343, Timestamp: 1790000000, UnlockTime: "0"}}}}}
	resp, err := client(srv).Send(context.Background(), k, body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.PoolFree != 41 || resp.PoolTarget != 50 || len(resp.Watch) != 2 || resp.Watch[1] != 17 {
		t.Fatalf("response %+v", resp)
	}
	if s.method != "POST" || s.path != "/_emdash/api/plugins/coffer/bridge/sync" || s.ct != "application/json" || s.origin != "" || s.auth != "" {
		t.Fatalf("request %+v", s)
	}
	if s.ts != strconv.FormatInt(now.Unix(), 10) {
		t.Fatalf("ts %s", s.ts)
	}
	sig, _ := base64.StdEncoding.DecodeString(s.sig)
	if !ed25519.Verify(k.Public().(ed25519.PublicKey), syncsign.Message(s.ts, s.body), sig) {
		t.Fatal("the signature doesn't cover the exact bytes sent")
	}
	if len(s.body) > 2 && s.body[0] == 0xef {
		t.Fatal("BOM")
	}
	var got map[string]any
	if err := json.Unmarshal(s.body, &got); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["addresses"].([]any); !ok {
		t.Fatalf("addresses must be an array, not null: %s", s.body)
	}
	if _, ok := got["pair"]; ok {
		t.Fatal("pair sent on an ordinary sync")
	}
	tr := got["snapshots"].([]any)[0].(map[string]any)["transfers"].([]any)[0].(map[string]any)
	if tr["amount"] != "18446744073709551615" || tr["unlockTime"] != "0" || tr["doubleSpendSeen"] != false {
		t.Fatalf("transfer %v", tr)
	}
	if !strings.Contains(string(s.body), `"transfers":[{`) {
		t.Fatalf("body %s", s.body)
	}
}

func TestEmptySnapshotIsAnArray(t *testing.T) {
	srv, s := site(t, 200, okReply)
	k, _ := syncsign.NewKey()
	if _, err := client(srv).Send(context.Background(), k, Body{V: 1, Seq: 1, Snapshots: []Snapshot{{Index: 3}}}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(s.body), `{"index":3,"transfers":[]}`) {
		t.Fatalf("body %s", s.body)
	}
}

func TestErrors(t *testing.T) {
	cases := map[string]struct {
		status int
		reply  string
		code   string
		hint   string
	}{
		"domain error":           {200, `{"success":true,"data":{"error":{"code":"NOT_PAIRED"}}}`, "NOT_PAIRED", "pair"},
		"bad signature":          {200, `{"success":true,"data":{"error":{"code":"BAD_SIGNATURE"}}}`, "BAD_SIGNATURE", "pair"},
		"stale timestamp":        {200, `{"success":true,"data":{"error":{"code":"STALE_TIMESTAMP"}}}`, "STALE_TIMESTAMP", "clock"},
		"too large":              {413, `{"success":false,"error":{"code":"INVALID_PLUGIN_REQUEST"}}`, "INVALID_PLUGIN_REQUEST", "large"},
		"401 bearer":             {401, `{"success":false,"error":{"code":"INVALID_TOKEN"}}`, "INVALID_TOKEN", "Authorization"},
		"403 csrf":               {403, `{"success":false,"error":{"code":"CSRF_REJECTED"}}`, "CSRF_REJECTED", "Origin"},
		"403 access page":        {403, `<html>Forbidden</html>`, "HTTP_403", "/_emdash/api/plugins/coffer/*"},
		"login redirect":         {0, "redirect:https://login.example/", "HTTP_302", "login"},
		"server error":           {502, `bad gateway`, "HTTP_502", ""},
		"not a sync answer":      {200, `{"success":true,"data":{"ok":true,"poolFree":-1,"poolTarget":50,"watch":[]}}`, "BAD_RESPONSE", ""},
		"watch index 0":          {200, `{"success":true,"data":{"ok":true,"poolFree":1,"poolTarget":50,"watch":[0]}}`, "BAD_RESPONSE", ""},
		"negative poolTop":       {200, `{"success":true,"data":{"ok":true,"poolFree":1,"poolTarget":50,"poolTop":-1,"watch":[]}}`, "BAD_RESPONSE", ""},
		"negative restoreHeight": {200, `{"success":true,"data":{"ok":true,"poolFree":1,"poolTarget":50,"restoreHeight":-1,"watch":[]}}`, "BAD_RESPONSE", ""},
		"huge poolTop":           {200, `{"success":true,"data":{"ok":true,"poolFree":1,"poolTarget":50,"poolTop":4294967296,"watch":[]}}`, "BAD_RESPONSE", ""},
		"html":                   {200, `<html>`, "BAD_RESPONSE", "coffer plugin"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			srv, _ := site(t, c.status, c.reply)
			k, _ := syncsign.NewKey()
			_, err := client(srv).Send(context.Background(), k, Body{V: 1, Seq: 1})
			var e *Error
			if !errors.As(err, &e) || e.Code != c.code {
				t.Fatalf("got %v, want code %s", err, c.code)
			}
			if c.hint != "" && !strings.Contains(e.Error(), c.hint) {
				t.Fatalf("hint missing %q: %v", c.hint, e)
			}
		})
	}
}

func TestSizeLimitsBeforeSending(t *testing.T) {
	srv, s := site(t, 200, okReply)
	k, _ := syncsign.NewKey()
	var snaps []Snapshot
	for i := 1; i <= 100; i++ {
		var trs []Transfer
		for j := 0; j < 32; j++ {
			trs = append(trs, Transfer{TxID: strings.Repeat("b", 64), Amount: "1", UnlockTime: "0"})
		}
		snaps = append(snaps, Snapshot{Index: uint32(i), Transfers: trs})
	}
	if _, err := client(srv).Send(context.Background(), k, Body{V: 1, Seq: 1, Snapshots: snaps}); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("got %v", err)
	}
	pair := Body{V: 1, Seq: 1, Pair: &Pair{Code: strings.Repeat("A", 22), PublicKey: syncsign.PublicKeyText(k)},
		Addresses: []Address{{Index: 1, Address: strings.Repeat("5", 95)}, {Index: 2, Address: strings.Repeat("5", 95)}}}
	for i := 3; i < 60; i++ {
		pair.Addresses = append(pair.Addresses, Address{Index: uint32(i), Address: strings.Repeat("5", 95)})
	}
	if _, err := client(srv).Send(context.Background(), k, pair); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("pairing body over 4 KiB: %v", err)
	}
	if s.method != "" {
		t.Fatal("a request was sent")
	}
}

func TestSiteURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://shop.example":  "https://shop.example/_emdash/api/plugins/coffer/bridge/sync",
		"https://shop.example/": "https://shop.example/_emdash/api/plugins/coffer/bridge/sync",
	} {
		if got := (&Client{Site: in}).endpoint(); got != want {
			t.Errorf("%s: %s", in, got)
		}
	}
}

func TestChecksField(t *testing.T) {
	srv, s := site(t, 200, okReply)
	k, _ := syncsign.NewKey()
	c := client(srv)
	if _, err := c.Send(context.Background(), k, Body{V: 1, Seq: 1}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(s.body), "checks") {
		t.Fatalf("checks sent when unset: %s", s.body)
	}
	if _, err := c.Send(context.Background(), k, Body{V: 1, Seq: 2, Checks: &Checks{Node: &Check{State: "unavailable", Detail: "no second node answered"}}}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(s.body), `"checks":{"node":{"state":"unavailable","detail":"no second node answered"}}`) {
		t.Fatalf("body %s", s.body)
	}
}

func TestChecksJSON(t *testing.T) {
	// The shape the plugin parses (plugin/src/sync/protocol.ts, parseChecks).
	b, err := json.Marshal(Checks{Node: &Check{State: "off"}, Wallet: &Check{State: "behind", Detail: "the wallet is at block 1, its node at 9"}})
	if err != nil || string(b) != `{"node":{"state":"off"},"wallet":{"state":"behind","detail":"the wallet is at block 1, its node at 9"}}` {
		t.Fatalf("%s %v", b, err)
	}
}
