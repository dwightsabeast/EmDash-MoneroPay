package wallet

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/edwards"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/secret"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/testaddr"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// A made-up key pair (reduced scalars) and the stagenet address it gives.
const (
	viewKey  = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00"
	spendKey = "a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf00"
)

var shopAddr = func() string {
	v, _ := hex.DecodeString(viewKey)
	sp, _ := hex.DecodeString(spendKey)
	return testaddr.FromKeys(24, edwards.ScalarBaseMult(sp), edwards.ScalarBaseMult(v))
}()

// rpc is a wallet-rpc stand-in without a login: method -> raw "result" JSON, or a full body starting with "!".
type rpc struct {
	results map[string]string
	calls   []call
}

type call struct {
	Method string
	Params map[string]any
}

func newRPC(t *testing.T) (*rpc, *walletrpc.Client) {
	f := &rpc{results: map[string]string{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		f.calls = append(f.calls, call{req.Method, req.Params})
		res, ok := f.results[req.Method]
		if !ok {
			res = `!{"jsonrpc":"2.0","id":"0","error":{"code":-32601,"message":"Method not found"}}`
		}
		if strings.HasPrefix(res, "!") {
			io.WriteString(w, res[1:])
			return
		}
		io.WriteString(w, `{"jsonrpc":"2.0","id":"0","result":`+res+`}`)
	}))
	t.Cleanup(srv.Close)
	return f, walletrpc.New(srv.URL, "u", secret.New("p"), srv.Client())
}

func (f *rpc) methods() []string {
	var m []string
	for _, c := range f.calls {
		m = append(m, c.Method)
	}
	return m
}

func cfg(t *testing.T) config.Config {
	return config.Config{Site: "https://shop.example", Network: config.Stagenet, Address: shopAddr,
		Node: "http://127.0.0.1:38081", DataDir: t.TempDir()}
}

var stagenetNode = noderpc.Info{NetType: "stagenet", Height: 2222128, Synchronized: true}

func TestCreate(t *testing.T) {
	f, c := newRPC(t)
	f.results["generate_from_keys"] = `{"address":"` + shopAddr + `","info":"ok"}`
	conf := cfg(t)
	if err := Create(context.Background(), c, conf, secret.New(viewKey), stagenetNode); err != nil {
		t.Fatal(err)
	}
	p := f.calls[0].Params
	if p["restore_height"] != float64(2222128) || p["viewkey"] != viewKey || p["spendkey"] != "" || p["filename"] != FileName {
		t.Fatalf("params %v", p)
	}
	pw := filepath.Join(conf.DataDir, "wallet", FileName+".password")
	fi, err := os.Stat(pw)
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("password file: %v %v", fi, err)
	}
	b, _ := os.ReadFile(pw)
	if p["password"] != strings.TrimSpace(string(b)) || len(strings.TrimSpace(string(b))) < 40 {
		t.Fatal("the wallet password and the saved one differ, or it is short")
	}
}

func TestCreateUsesConfiguredRestoreHeight(t *testing.T) {
	f, c := newRPC(t)
	f.results["generate_from_keys"] = `{"address":"` + shopAddr + `","info":"ok"}`
	conf := cfg(t)
	conf.RestoreHeight = 2100000
	if err := Create(context.Background(), c, conf, secret.New(viewKey), stagenetNode); err != nil {
		t.Fatal(err)
	}
	if f.calls[0].Params["restore_height"] != float64(2100000) {
		t.Fatalf("restore height %v", f.calls[0].Params["restore_height"])
	}
}

func TestCreateRefuses(t *testing.T) {
	cases := map[string]struct {
		node   noderpc.Info
		result string
		before func(config.Config)
		want   error
	}{
		"node on another network": {noderpc.Info{NetType: "mainnet", Height: 1}, "", nil, nil},
		"node offline":            {noderpc.Info{NetType: "stagenet", Height: 1, Offline: true}, "", nil, nil},
		"node at height 0":        {noderpc.Info{NetType: "stagenet"}, "", nil, nil},
		"wallet exists": {stagenetNode, "", func(c config.Config) {
			os.MkdirAll(filepath.Join(c.DataDir, "wallet"), 0o700)
			os.WriteFile(filepath.Join(c.DataDir, "wallet", FileName+".keys"), []byte("x"), 0o600)
		}, nil},
		"the spend key":           {stagenetNode, "spend", nil, ErrSpendKey},
		"another address's key":   {stagenetNode, "other", nil, ErrViewKeyMismatch},
		"view key does not match": {stagenetNode, `!{"jsonrpc":"2.0","id":"0","error":{"code":-1,"message":"view key does not match standard address"}}`, nil, ErrViewKeyMismatch},
		"view key unparsable":     {stagenetNode, `!{"jsonrpc":"2.0","id":"0","error":{"code":-1,"message":"Failed to parse view key secret key"}}`, nil, ErrViewKeyMismatch},
		"other wallet-rpc error":  {stagenetNode, `!{"jsonrpc":"2.0","id":"0","error":{"code":-1,"message":"disk full"}}`, nil, nil},
	}
	for name, cs := range cases {
		t.Run(name, func(t *testing.T) {
			f, c := newRPC(t)
			// wallet-rpc would succeed unless the case says otherwise, so only the check under test can refuse.
			f.results["generate_from_keys"] = `{"address":"` + shopAddr + `","info":"ok"}`
			key := viewKey
			switch cs.result {
			case "spend":
				key, cs.result = spendKey, ""
			case "other":
				key, cs.result = "1112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f00", ""
			case "":
			default:
				f.results["generate_from_keys"] = cs.result
			}
			conf := cfg(t)
			if cs.before != nil {
				cs.before(conf)
			}
			err := Create(context.Background(), c, conf, secret.New(key), cs.node)
			if err == nil {
				t.Fatal("created")
			}
			if cs.want != nil && !errors.Is(err, cs.want) {
				t.Fatalf("got %v, want %v", err, cs.want)
			}
			if cs.result == "" && len(f.calls) != 0 {
				t.Fatalf("wallet-rpc was asked to create the wallet: %v", f.methods())
			}
			if strings.Contains(err.Error(), key) {
				t.Fatal("the error leaks the view key")
			}
			if _, err := os.Stat(filepath.Join(conf.DataDir, "wallet", FileName+".password")); !os.IsNotExist(err) && name != "wallet exists" {
				t.Fatal("a password file was left behind")
			}
		})
	}
}

func TestOpen(t *testing.T) {
	f, c := newRPC(t)
	f.results["generate_from_keys"] = `{"address":"` + shopAddr + `","info":"ok"}`
	f.results["open_wallet"] = `{}`
	f.results["get_address"] = `{"address":"` + shopAddr + `"}`
	conf := cfg(t)
	if err := Create(context.Background(), c, conf, secret.New(viewKey), stagenetNode); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(conf.DataDir, "wallet", FileName+".keys"), []byte("x"), 0o600) // what wallet-rpc writes
	if !Exists(conf.DataDir) {
		t.Fatal("Exists")
	}
	if err := Open(context.Background(), c, conf); err != nil {
		t.Fatal(err)
	}
	created := f.calls[0].Params["password"]
	if got := f.calls[1]; got.Method != "open_wallet" || got.Params["password"] != created || got.Params["filename"] != FileName {
		t.Fatalf("open_wallet %+v", got)
	}

	// The wrong wallet: closed again, refused.
	f.results["get_address"] = `{"address":"` + testaddr.Make(24, 0x11) + `"}`
	f.results["close_wallet"] = `{}`
	f.calls = nil
	if err := Open(context.Background(), c, conf); err == nil {
		t.Fatal("opened a wallet for another address")
	}
	if m := f.methods(); len(m) != 3 || m[2] != "close_wallet" {
		t.Fatalf("calls %v", m)
	}

	// A password file others can read is refused.
	os.Chmod(filepath.Join(conf.DataDir, "wallet", FileName+".password"), 0o644)
	if err := Open(context.Background(), c, conf); err == nil || !strings.Contains(err.Error(), "chmod 600") {
		t.Fatalf("readable password file: %v", err)
	}
}

func TestOpenWithoutWallet(t *testing.T) {
	_, c := newRPC(t)
	conf := cfg(t)
	if Exists(conf.DataDir) {
		t.Fatal("Exists")
	}
	if err := Open(context.Background(), c, conf); !errors.Is(err, ErrNoWallet) {
		t.Fatalf("got %v", err)
	}
}
