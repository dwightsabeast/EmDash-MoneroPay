package main

import (
	"context"
	"os"
	"strings"
	"testing"
)

// The command layer: flags and the root check (the flow itself is tested in internal/installer).
func TestInstallCommandNeedsRoot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root")
	}
	code, _, errOut := run(context.Background(), "install", "--site", "https://shop.example", "--pair", "AbCdEfGhIjKlMnOpQrSt_-")
	if code != 1 || !strings.Contains(errOut, "sudo") {
		t.Fatalf("%d %q", code, errOut)
	}
	code, _, errOut = run(context.Background(), "uninstall")
	if code != 1 || !strings.Contains(errOut, "sudo") {
		t.Fatalf("uninstall: %d %q", code, errOut)
	}
}

func TestInstallCommandFlags(t *testing.T) {
	for _, args := range [][]string{
		{"install"},
		{"install", "--site", "https://shop.example"},
		{"install", "--pair", "AbCdEfGhIjKlMnOpQrSt_-"},
		{"install", "--site", "https://shop.example", "--pair", "x", "extra"},
		{"install", "--site", "https://shop.example", "--pair", "x", "--restore-height", "-5"},
		{"uninstall", "--bogus"},
	} {
		if code, _, _ := run(context.Background(), args...); code != 2 {
			t.Errorf("%v: exit %d, want 2", args, code)
		}
	}
}
