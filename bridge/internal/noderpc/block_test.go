package noderpc

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var (
	hashA = strings.Repeat("ab", 32)
	txA   = strings.Repeat("11", 32)
	txB   = strings.Repeat("22", 32)
)

// methodNode answers by JSON-RPC method name.
func methodNode(t *testing.T, replies map[string]string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		for m, reply := range replies {
			if strings.Contains(string(b), `"method":"`+m+`"`) {
				io.WriteString(w, reply)
				return
			}
		}
		io.WriteString(w, `{"jsonrpc":"2.0","id":"0","error":{"code":-32601,"message":"Method not found"}}`)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestBlockHash(t *testing.T) {
	srv := methodNode(t, map[string]string{"get_block_header_by_height": `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","block_header":{"hash":"` + hashA + `","height":2221449}}}`})
	h, err := BlockHash(context.Background(), srv.URL, nil, 2221449)
	if err != nil || h != hashA {
		t.Fatalf("%q %v", h, err)
	}
	if _, err := BlockHash(context.Background(), srv.URL, nil, 2221450); err == nil {
		t.Fatal("a header for another height was accepted")
	}
}

func TestBlock(t *testing.T) {
	srv := methodNode(t, map[string]string{"get_block": `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","block_header":{"hash":"` + hashA + `","height":2221449},"tx_hashes":["` + txA + `","` + txB + `"],"blob":"00","json":"{}"}}`})
	b, err := GetBlock(context.Background(), srv.URL, nil, 2221449)
	if err != nil || b.Hash != hashA || b.Height != 2221449 || len(b.TxHashes) != 2 || !b.Has(txB) || b.Has(strings.Repeat("33", 32)) {
		t.Fatalf("%+v %v", b, err)
	}
}

func TestBlockRefuses(t *testing.T) {
	for name, reply := range map[string]string{
		"node error":    `{"jsonrpc":"2.0","id":"0","error":{"code":-2,"message":"Requested block height: 9999999 greater than current top block height"}}`,
		"bad hash":      `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","block_header":{"hash":"xyz","height":2221449},"tx_hashes":[]}}`,
		"bad tx hash":   `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","block_header":{"hash":"` + hashA + `","height":2221449},"tx_hashes":["nothex"]}}`,
		"wrong height":  `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","block_header":{"hash":"` + hashA + `","height":5},"tx_hashes":[]}}`,
		"status not OK": `{"jsonrpc":"2.0","id":"0","result":{"status":"BUSY","block_header":{"hash":"` + hashA + `","height":2221449},"tx_hashes":[]}}`,
		"too large":     `{"jsonrpc":"2.0","id":"0","result":{"status":"OK","pad":"` + strings.Repeat("a", 5<<20) + `"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			srv := methodNode(t, map[string]string{"get_block": reply})
			if _, err := GetBlock(context.Background(), srv.URL, nil, 2221449); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}
