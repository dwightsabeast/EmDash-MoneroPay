package noderpc

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Shaped like monerod 0.18.5.1's get_info on the dev box's stagenet node.
const infoJSON = `{"jsonrpc":"2.0","id":"0","result":{"nettype":"stagenet","stagenet":true,"mainnet":false,"testnet":false,
 "height":2222128,"target_height":0,"synchronized":true,"offline":false,"restricted":false,"version":"0.18.5.1-release",
 "status":"OK","difficulty":12345,"tx_count":99}}`

func node(t *testing.T, body string, status int) (*httptest.Server, *string) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = r.Method + " " + r.URL.Path + " " + string(b)
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func TestGetInfo(t *testing.T) {
	srv, got := node(t, infoJSON, 200)
	info, err := GetInfo(context.Background(), srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := Info{NetType: "stagenet", Height: 2222128, Synchronized: true, Version: "0.18.5.1-release"}
	if info != want {
		t.Fatalf("got %+v", info)
	}
	if !strings.HasPrefix(*got, "POST /json_rpc ") || !strings.Contains(*got, `"method":"get_info"`) {
		t.Fatalf("request: %s", *got)
	}
	// A trailing slash on the node URL is fine.
	if _, err := GetInfo(context.Background(), srv.URL+"/", nil); err != nil {
		t.Fatal(err)
	}
}

func TestGetInfoRefuses(t *testing.T) {
	cases := map[string]struct {
		body   string
		status int
	}{
		"HTTP 500":        {infoJSON, 500},
		"not JSON":        {"<html>", 200},
		"RPC error":       {`{"jsonrpc":"2.0","id":"0","error":{"code":-32601,"message":"Method not found"}}`, 200},
		"status BUSY":     {strings.Replace(infoJSON, `"status":"OK"`, `"status":"BUSY"`, 1), 200},
		"no nettype":      {strings.Replace(infoJSON, `"nettype":"stagenet",`, ``, 1), 200},
		"unknown nettype": {strings.Replace(infoJSON, `"nettype":"stagenet"`, `"nettype":"fakenet"`, 1), 200},
		"too large":       {infoJSON[:len(infoJSON)-2] + `,"pad":"` + strings.Repeat("a", 1<<20) + `"}}`, 200},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			srv, _ := node(t, c.body, c.status)
			_, err := GetInfo(context.Background(), srv.URL, nil)
			if err == nil {
				t.Fatal("accepted")
			}
			if name == "too large" && !strings.Contains(err.Error(), "too large") {
				t.Fatalf("want the size error, got %v", err)
			}
		})
	}
	for _, bad := range []string{"127.0.0.1:38081", "ftp://127.0.0.1:38081", "http://"} {
		if _, err := GetInfo(context.Background(), bad, nil); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestGetInfoTimeout(t *testing.T) {
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-done:
		}
	}))
	defer srv.Close()
	defer close(done)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := GetInfo(ctx, srv.URL, nil); err == nil {
		t.Fatal("no timeout")
	}
}
