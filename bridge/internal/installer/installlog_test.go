package installer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dwightsabeast/EmDash-MoneroPay/bridge/internal/config"
)

func installLog(o Options) string { return filepath.Join(o.Paths.DataDir(), "log", "install.log") }

func TestInstallLog(t *testing.T) {
	opts, sys, tty, st := harness(t)
	if err := Install(context.Background(), opts, sys, tty, st.steps(sys)); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(installLog(opts))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("install log: %v %v", fi, err)
	}
	b, _ := os.ReadFile(installLog(opts))
	log := string(b)
	for _, want := range []string{"Primary address of the shop wallet: [answered]", "Private view key", "Pairing with https://shop.example", "Done."} {
		if !strings.Contains(log, want) {
			t.Errorf("log lacks %q:\n%s", want, log)
		}
	}
	if strings.Contains(log, viewKey) || strings.Contains(log, stagenetAddr) || strings.Contains(log, code) {
		t.Fatalf("the log holds an answer or the code:\n%s", log)
	}
	if !strings.Contains(tty.said.String(), "/var/lib/xmr-bridge/log/install.log") {
		t.Fatalf("the admin isn't told where the log is: %s", tty.said.String())
	}
	// A second run appends.
	tty2 := &fakeTTY{answers: []string{stagenetAddr}, secrets: []string{viewKey}}
	if err := Install(context.Background(), opts, sys, tty2, (&fakeSteps{nodes: stagenetNode()}).steps(sys)); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(installLog(opts))
	if strings.Count(string(b), "xmr-bridge install started") != 2 || !strings.Contains(string(b), "Keeping the existing view-only wallet") {
		t.Fatalf("second run not appended:\n%s", b)
	}
}

func TestInstallLogRecordsAFailure(t *testing.T) {
	opts, sys, tty, st := harness(t)
	steps := st.steps(sys)
	steps.Pair = func(context.Context, config.Config, string) error {
		return errors.New("the site answered PAIRING_REJECTED")
	}
	if err := Install(context.Background(), opts, sys, tty, steps); err == nil {
		t.Fatal("no error")
	}
	b, err := os.ReadFile(installLog(opts))
	if err != nil || !strings.Contains(string(b), "stopped: the site answered PAIRING_REJECTED") {
		t.Fatalf("log %q %v", b, err)
	}
}
