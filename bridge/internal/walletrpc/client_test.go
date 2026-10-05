package walletrpc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
)

func client(f *fakeRPC, srv *httptest.Server) *Client {
	return New(srv.URL, f.user, secret.New(f.pass), srv.Client())
}

func TestDigestHandshakeThenReuse(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_height"] = `{"height":2220727}`
	c := client(f, srv)
	h, err := c.GetHeight(context.Background())
	if err != nil || h != 2220727 {
		t.Fatalf("GetHeight = %d, %v", h, err)
	}
	if f.requests != 2 || f.unauth != 1 {
		t.Fatalf("first call: %d requests, %d challenges; want 2 and 1", f.requests, f.unauth)
	}
	for i := 0; i < 3; i++ {
		if _, err := c.GetHeight(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if f.requests != 5 || f.unauth != 1 {
		t.Fatalf("later calls reuse the challenge with a rising nc: %d requests, %d challenges", f.requests, f.unauth)
	}
	if f.lastNC[f.nonce] != 4 {
		t.Fatalf("nc = %d, want 4", f.lastNC[f.nonce])
	}
}

func TestStaleNonceRetriesOnce(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_height"] = `{"height":1}`
	c := client(f, srv)
	if _, err := c.GetHeight(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.staleNonce()
	before := f.requests
	if _, err := c.GetHeight(context.Background()); err != nil {
		t.Fatalf("after a stale nonce: %v", err)
	}
	if f.requests-before != 2 {
		t.Fatalf("stale nonce: %d requests, want 2 (stale challenge, then retry)", f.requests-before)
	}
}

func TestWrongPassword(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_height"] = `{"height":1}`
	const wrong = "not-the-password-77"
	c := New(srv.URL, f.user, secret.New(wrong), srv.Client())
	_, err := c.GetHeight(context.Background())
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
	if f.requests != 2 {
		t.Fatalf("wrong password: %d requests, want 2 (no loop)", f.requests)
	}
	if strings.Contains(err.Error(), wrong) || strings.Contains(err.Error(), f.pass) {
		t.Fatalf("error leaks a password: %v", err)
	}
	// A later call tries again (once), still without looping.
	_, err = c.GetHeight(context.Background())
	if !errors.Is(err, ErrUnauthorized) || f.requests > 4 {
		t.Fatalf("second call: %v after %d requests", err, f.requests)
	}
}

func TestUnsupportedChallenge(t *testing.T) {
	for name, ch := range map[string][]string{
		"MD5-sess only": {`Digest qop="auth",algorithm=MD5-sess,realm="monero-rpc",nonce="%s",stale=%s`},
		"SHA-256 only":  {`Digest qop="auth",algorithm=SHA-256,realm="monero-rpc",nonce="%s",stale=%s`},
		"no qop":        {`Digest algorithm=MD5,realm="monero-rpc",nonce="%s",stale=%s`},
		"Basic":         {`Basic realm="monero-rpc%s%s"`},
	} {
		t.Run(name, func(t *testing.T) {
			f, srv := newFake(t)
			f.challenges = ch
			_, err := client(f, srv).GetHeight(context.Background())
			if err == nil || !strings.Contains(err.Error(), "unsupported") {
				t.Fatalf("want an unsupported-challenge error, got %v", err)
			}
			if f.requests != 1 {
				t.Fatalf("%d requests, want 1", f.requests)
			}
		})
	}
}

func TestRPCError(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_height"] = `!{"jsonrpc":"2.0","id":"0","error":{"code":-13,"message":"No wallet file"}}`
	_, err := client(f, srv).GetHeight(context.Background())
	var re *RPCError
	if !errors.As(err, &re) || re.Code != -13 || re.Message != "No wallet file" {
		t.Fatalf("want RPCError -13, got %v", err)
	}
}

func TestHTTPStatusAndBadBodies(t *testing.T) {
	for name, h := range map[string]http.HandlerFunc{
		"500":       func(w http.ResponseWriter, r *http.Request) { http.Error(w, "boom", 500) },
		"not JSON":  func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>")) },
		"no result": func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"jsonrpc":"2.0","id":"0"}`)) },
		"trailing data": func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"jsonrpc":"2.0","id":"0","result":{"height":1}} x`))
		},
	} {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(h)
			defer srv.Close()
			if _, err := New(srv.URL, "u", secret.New("p"), srv.Client()).GetHeight(context.Background()); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

func TestResponseSizeCap(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":"0","result":{"height":1,"pad":"` + strings.Repeat("a", 2000) + `"}}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "u", secret.New("p"), srv.Client())
	c.maxResponse = 1000
	if _, err := c.GetHeight(context.Background()); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("want too large, got %v", err)
	}
}

func TestContextTimeout(t *testing.T) {
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-done:
		}
	}))
	defer srv.Close()
	defer close(done) // runs first: releases the handler so Close doesn't wait
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := New(srv.URL, "u", secret.New("p"), srv.Client()).GetHeight(ctx)
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 2*time.Second {
		t.Fatalf("want a prompt deadline error, got %v after %v", err, time.Since(start))
	}
}

func TestGetVersionAndCreateAddress(t *testing.T) {
	f, srv := newFake(t)
	f.results["get_version"] = `{"release":true,"version":65562}`
	f.results["create_address"] = `{"address":"7` + strings.Repeat("B", 94) + `","address_index":51,"address_indices":[51],"addresses":["x"]}`
	c := client(f, srv)
	v, err := c.GetVersion(context.Background())
	if err != nil || v.Version != 65562 || !v.Release {
		t.Fatalf("GetVersion = %+v, %v", v, err)
	}
	a, err := c.CreateAddress(context.Background(), "coffer")
	if err != nil || a.Index != 51 || a.Address != "7"+strings.Repeat("B", 94) {
		t.Fatalf("CreateAddress = %+v, %v", a, err)
	}
	var params map[string]any
	json.Unmarshal(f.calls[len(f.calls)-1].Params, &params)
	if params["account_index"] != float64(0) || params["label"] != "coffer" {
		t.Fatalf("create_address params = %v", params)
	}
}
