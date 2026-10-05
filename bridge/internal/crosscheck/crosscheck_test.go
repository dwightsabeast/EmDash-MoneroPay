package crosscheck

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// node is a fake monerod: a chain of block hashes (with the transactions in each) and a network.
type node struct {
	net    string
	height uint64 // block count
	hashes map[uint64]string
	txs    map[uint64][]string
	calls  atomic.Int32
	blocks atomic.Int32
	down   bool
}

func (n *node) serve(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.calls.Add(1)
		if n.down {
			http.Error(w, "down", 502)
			return
		}
		var req struct {
			Method string
			Params struct{ Height uint64 }
		}
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &req)
		h := req.Params.Height
		switch req.Method {
		case "get_info":
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","nettype":"%s","height":%d}}`, n.net, n.height)
		case "get_block_header_by_height", "get_block":
			if req.Method == "get_block" {
				n.blocks.Add(1)
			}
			hash, ok := n.hashes[h]
			if !ok || h >= n.height {
				io.WriteString(w, `{"jsonrpc":"2.0","id":"0","error":{"code":-2,"message":"Requested block height greater than current top block height"}}`)
				return
			}
			txs, _ := json.Marshal(append([]string{}, n.txs[h]...))
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","block_header":{"hash":"%s","height":%d},"tx_hashes":%s}}`, hash, h, txs)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

var (
	hash1 = strings.Repeat("a1", 32)
	fake1 = strings.Repeat("f1", 32)
	tx1   = strings.Repeat("11", 32)
	tx2   = strings.Repeat("22", 32)
)

func chain(height uint64) *node {
	return &node{net: "stagenet", height: height, hashes: map[uint64]string{100: hash1, 101: strings.Repeat("a2", 32)}, txs: map[uint64][]string{100: {tx1, tx2}}}
}

func transfer(txid string, height, conf uint64) walletrpc.Transfer {
	return walletrpc.Transfer{TxID: txid, Index: 3, Amount: "1000", Height: height, Confirmations: conf, UnlockTime: "0"}
}

func checker(t *testing.T, primary *node, seconds ...*node) *Checker {
	var urls []string
	for _, s := range seconds {
		urls = append(urls, s.serve(t).URL)
	}
	return New(primary.serve(t).URL, "stagenet", urls, nil)
}

func TestHonestNodes(t *testing.T) {
	c := checker(t, chain(110), chain(108))
	got, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10), transfer(tx2, 0, 0)})
	if rep.State != OK {
		t.Fatalf("report %+v", rep)
	}
	if got[0].Confirmations != 8 { // the smaller count: the second node is at 108
		t.Fatalf("confirmations %d", got[0].Confirmations)
	}
	if got[1] != transfer(tx2, 0, 0) {
		t.Fatal("an unmined transfer changed")
	}
}

func TestFabricatedBlock(t *testing.T) {
	primary := chain(110)
	primary.hashes[100] = fake1
	c := checker(t, primary, chain(110))
	got, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10)})
	if rep.State != Mismatch || got[0].Confirmations != 0 || !strings.Contains(rep.Detail, "100") {
		t.Fatalf("report %+v, confirmations %d", rep, got[0].Confirmations)
	}
}

func TestTransactionNotInBlock(t *testing.T) {
	second := chain(110)
	second.txs[100] = []string{tx2}
	c := checker(t, chain(110), second)
	got, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10)})
	if rep.State != Mismatch || got[0].Confirmations != 0 {
		t.Fatalf("report %+v, confirmations %d", rep, got[0].Confirmations)
	}
}

func TestSecondNodeBehind(t *testing.T) {
	c := checker(t, chain(110), chain(100)) // block 100 not there yet on the second node
	got, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10)})
	if rep.State != OK || got[0].Confirmations != 0 {
		t.Fatalf("report %+v, confirmations %d", rep, got[0].Confirmations)
	}
}

func TestNoSecondNode(t *testing.T) {
	down := chain(110)
	down.down = true
	wrongNet := chain(110)
	wrongNet.net = "mainnet"
	c := checker(t, chain(110), down, wrongNet)
	got, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10)})
	if rep.State != Unavailable || got[0].Confirmations != 10 {
		t.Fatalf("report %+v, confirmations %d", rep, got[0].Confirmations)
	}
	if wrongNet.blocks.Load() != 0 {
		t.Fatal("a node on another network was used")
	}
}

func TestFallsBackToAnotherSecondNode(t *testing.T) {
	down := chain(110)
	down.down = true
	c := checker(t, chain(110), down, chain(109))
	got, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10)})
	if rep.State != OK || got[0].Confirmations != 9 {
		t.Fatalf("report %+v, confirmations %d", rep, got[0].Confirmations)
	}
}

func TestVerifiedOnceThenCached(t *testing.T) {
	second := chain(110)
	c := checker(t, chain(110), second)
	for i := 0; i < 3; i++ {
		if _, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 100, 10)}); rep.State != OK {
			t.Fatalf("round %d: %+v", i, rep)
		}
	}
	if n := second.blocks.Load(); n != 1 {
		t.Fatalf("the block was fetched %d times", n)
	}
	// A reorg moves the transaction: checked again at the new height.
	second.txs[101] = []string{tx1}
	if _, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 101, 9)}); rep.State != OK || second.blocks.Load() != 2 {
		t.Fatalf("after a reorg: %+v, %d fetches", rep, second.blocks.Load())
	}
}

func TestNothingMinedNoQueries(t *testing.T) {
	primary, second := chain(110), chain(110)
	c := New(primary.serve(t).URL, "stagenet", []string{second.serve(t).URL}, nil)
	if _, rep := c.Check(context.Background(), []walletrpc.Transfer{transfer(tx1, 0, 0)}); rep.State != OK {
		t.Fatalf("report %+v", rep)
	}
	if primary.calls.Load()+second.calls.Load() != 0 {
		t.Fatal("queried nodes with nothing to check")
	}
}

func TestIsOwnNode(t *testing.T) {
	for u, want := range map[string]bool{
		"http://127.0.0.1:38081":     true,
		"http://localhost:38081":     true,
		"http://[::1]:38081":         true,
		"http://192.168.1.20:38089":  true,
		"http://10.0.0.5:18081":      true,
		"http://172.16.4.4:18081":    true,
		"http://[fd12::1]:18081":     true,
		"http://169.254.1.1:18081":   true,
		"https://8.8.8.8:18089":      false,
		"http://[2001:db8::1]:18081": false,
		"https://203.0.113.7:18089":  false,
	} {
		got, err := IsOwnNode(context.Background(), u)
		if err != nil || got != want {
			t.Errorf("%s: %v %v, want %v", u, got, err, want)
		}
	}
	if _, err := IsOwnNode(context.Background(), "not a url"); err == nil {
		t.Error("garbage accepted")
	}
}

func TestDefaultNodes(t *testing.T) {
	st := DefaultNodes("stagenet")
	if len(st) < 3 {
		t.Fatalf("stagenet list %v", st)
	}
	for _, u := range st {
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			t.Errorf("%s", u)
		}
	}
	if DefaultNodes("regtest") != nil {
		t.Fatal("unknown network has a list")
	}
}
