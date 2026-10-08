package walletrpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func TestRescanBlockchain(t *testing.T) {
	f, srv := newFake(t)
	f.results["rescan_blockchain"] = `{}`
	if err := client(f, srv).RescanBlockchain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := f.calls[len(f.calls)-1].Method; got != "rescan_blockchain" {
		t.Fatalf("called %s", got)
	}
}

func TestRescanBlockchainOutlastsTheClientTimeout(t *testing.T) {
	// rescan_blockchain answers only when the rescan is done, which takes far longer than a routine call's timeout.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.Write([]byte(`{"jsonrpc":"2.0","id":"0","result":{}}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "u", secret.New("p"), &http.Client{Timeout: 50 * time.Millisecond})
	if _, err := c.GetHeight(context.Background()); err == nil {
		t.Fatal("routine calls should keep their timeout")
	}
	if err := c.RescanBlockchain(context.Background()); err != nil {
		t.Fatalf("rescan: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := c.RescanBlockchain(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("the context still bounds a rescan, got %v", err)
	}
}

func TestHasSubaddress(t *testing.T) {
	f, srv := newFake(t)
	c := client(f, srv)
	f.results["get_address"] = `{"address":"x","addresses":[{"address":"y","address_index":7,"label":"","used":false}]}`
	if ok, err := c.HasSubaddress(context.Background(), 7); err != nil || !ok {
		t.Fatalf("present: %v, %v", ok, err)
	}
	var params map[string]any
	json.Unmarshal(f.calls[len(f.calls)-1].Params, &params)
	if params["account_index"] != float64(0) || fmt.Sprint(params["address_index"]) != "[7]" {
		t.Fatalf("get_address params = %v", params)
	}
	// wallet-rpc 0.18.5.1: WALLET_RPC_ERROR_CODE_ADDRESS_INDEX_OUT_OF_BOUNDS.
	f.results["get_address"] = `!{"jsonrpc":"2.0","id":"0","error":{"code":-15,"message":"address index is out of bound"}}`
	if ok, err := c.HasSubaddress(context.Background(), 900); err != nil || ok {
		t.Fatalf("absent: %v, %v", ok, err)
	}
	f.results["get_address"] = `!{"jsonrpc":"2.0","id":"0","error":{"code":-13,"message":"No wallet file"}}`
	if _, err := c.HasSubaddress(context.Background(), 7); err == nil {
		t.Fatal("other errors must not read as absent")
	}
	f.results["get_address"] = `{"address":"x","addresses":[{"address":"y","address_index":8}]}`
	if _, err := c.HasSubaddress(context.Background(), 7); err == nil {
		t.Fatal("a different index must not read as present")
	}
}

func TestCreateAddresses(t *testing.T) {
	f, srv := newFake(t)
	c := client(f, srv)
	a := func(i int) string { return fmt.Sprintf("7%094d", i) }
	f.results["create_address"] = fmt.Sprintf(`{"address":%q,"address_index":12,"address_indices":[12,13,14],"addresses":[%q,%q,%q]}`, a(12), a(12), a(13), a(14))
	got, err := c.CreateAddresses(context.Background(), "coffer", 3)
	if err != nil || len(got) != 3 || got[0] != (NewAddress{12, a(12)}) || got[2] != (NewAddress{14, a(14)}) {
		t.Fatalf("CreateAddresses = %+v, %v", got, err)
	}
	var params map[string]any
	json.Unmarshal(f.calls[len(f.calls)-1].Params, &params)
	if params["account_index"] != float64(0) || params["label"] != "coffer" || params["count"] != float64(3) {
		t.Fatalf("create_address params = %v", params)
	}
	for name, res := range map[string]string{
		"fewer than asked": fmt.Sprintf(`{"address_indices":[12,13],"addresses":[%q,%q]}`, a(12), a(13)),
		"lengths differ":   fmt.Sprintf(`{"address_indices":[12,13,14],"addresses":[%q,%q]}`, a(12), a(13)),
		"empty address":    fmt.Sprintf(`{"address_indices":[12,13,14],"addresses":[%q,"",%q]}`, a(12), a(14)),
		"not consecutive":  fmt.Sprintf(`{"address_indices":[12,14,15],"addresses":[%q,%q,%q]}`, a(12), a(14), a(15)),
	} {
		f.results["create_address"] = res
		if _, err := c.CreateAddresses(context.Background(), "coffer", 3); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	for _, n := range []int{0, -1, MaxCreate + 1} {
		if _, err := c.CreateAddresses(context.Background(), "coffer", n); err == nil {
			t.Errorf("count %d accepted", n)
		}
	}
}
