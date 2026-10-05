package crosscheck

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/noderpc"
	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/walletrpc"
)

// The phase 01 spike's stagenet payment (spikes/wallet/evidence/q7-normal-payment.txt).
const (
	spikeTx     = "c6f28a7ad264583f911f8bc6da4cebbf67b10eb1b92988726ec48315bbc538fd"
	spikeHeight = 2221449
)

// TestLiveStagenet checks the real spike payment through the local stagenet node (XMR_BRIDGE_LIVE_NODE) against the
// built-in public stagenet nodes, then a made-up txid, then a dishonest node (a proxy rewriting block hashes).
// Skipped by default. The public nodes see block-height queries only.
func TestLiveStagenet(t *testing.T) {
	local := os.Getenv("XMR_BRIDGE_LIVE_NODE")
	if local == "" {
		t.Skip("set XMR_BRIDGE_LIVE_NODE (the local stagenet node) to run against public stagenet nodes")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	info, err := noderpc.GetInfo(ctx, local, nil)
	if err != nil {
		t.Fatal(err)
	}
	conf := info.Height - spikeHeight
	tr := func(txid string) walletrpc.Transfer {
		return walletrpc.Transfer{TxID: txid, Index: 1, Amount: "1000000000", Height: spikeHeight, Confirmations: conf, UnlockTime: "0"}
	}

	c := New(local, "stagenet", DefaultNodes("stagenet"), nil)
	got, rep := c.Check(ctx, []walletrpc.Transfer{tr(spikeTx)})
	t.Logf("real payment: %s via %s, confirmations %d -> %d (%s)", rep.State, rep.Node, conf, got[0].Confirmations, rep.Detail)
	if rep.State != OK || got[0].Confirmations == 0 || got[0].Confirmations > conf {
		t.Fatalf("the real payment didn't check out: %+v", rep)
	}

	c = New(local, "stagenet", DefaultNodes("stagenet"), nil)
	got, rep = c.Check(ctx, []walletrpc.Transfer{tr(strings.Repeat("ab", 32))})
	t.Logf("made-up txid: %s via %s: %s", rep.State, rep.Node, rep.Detail)
	if rep.State != Mismatch || got[0].Confirmations != 0 {
		t.Fatalf("a made-up txid passed: %+v", rep)
	}

	// A dishonest node: the local node's answers with the block hash at spikeHeight replaced.
	realHash, err := noderpc.BlockHash(ctx, local, nil, spikeHeight)
	if err != nil {
		t.Fatal(err)
	}
	liar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		resp, err := http.Post(strings.TrimSuffix(local, "/")+r.URL.Path, "application/json", bytes.NewReader(body))
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		w.Write(bytes.ReplaceAll(out, []byte(realHash), []byte(strings.Repeat("0f", 32))))
	}))
	defer liar.Close()
	c = New(liar.URL, "stagenet", DefaultNodes("stagenet"), nil)
	got, rep = c.Check(ctx, []walletrpc.Transfer{tr(spikeTx)})
	t.Logf("dishonest node: %s via %s: %s", rep.State, rep.Node, rep.Detail)
	if rep.State != Mismatch || got[0].Confirmations != 0 {
		t.Fatalf("a dishonest node's block passed: %+v", rep)
	}
}
