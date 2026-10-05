package installer

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrompter(t *testing.T) {
	var out strings.Builder
	var echo []bool
	p := newPrompter(strings.NewReader("  5abc  \r\nsecret-value\n"), &out, func(on bool) error { echo = append(echo, on); return nil })
	a, err := p.Ask("Address: ")
	if err != nil || a != "5abc" {
		t.Fatalf("%q %v", a, err)
	}
	s, err := p.AskSecret("Key: ")
	if err != nil || s.Reveal() != "secret-value" {
		t.Fatalf("%v", err)
	}
	if len(echo) != 2 || echo[0] || !echo[1] {
		t.Fatalf("echo must be turned off then back on: %v", echo)
	}
	if strings.Contains(out.String(), "secret-value") || !strings.Contains(out.String(), "Address: ") || !strings.Contains(out.String(), "Key: ") {
		t.Fatalf("output %q", out.String())
	}
	if _, err := p.Ask("More: "); err == nil {
		t.Fatal("no input left, but no error")
	}
}

func TestPrompterRestoresEchoOnError(t *testing.T) {
	var echo []bool
	p := newPrompter(strings.NewReader(""), &strings.Builder{}, func(on bool) error { echo = append(echo, on); return nil })
	if _, err := p.AskSecret("Key: "); err == nil {
		t.Fatal("no error at end of input")
	}
	if len(echo) != 2 || !echo[1] {
		t.Fatalf("echo not restored: %v", echo)
	}
	p = newPrompter(strings.NewReader("x\n"), &strings.Builder{}, func(on bool) error {
		if !on {
			return errors.New("not a terminal")
		}
		return nil
	})
	if _, err := p.AskSecret("Key: "); err == nil || !strings.Contains(err.Error(), "terminal") {
		t.Fatalf("a key must not be read when echo can't be turned off: %v", err)
	}
}

func TestPrompterLineCap(t *testing.T) {
	p := newPrompter(strings.NewReader(strings.Repeat("a", 5000)+"\n"), &strings.Builder{}, func(bool) error { return nil })
	if _, err := p.Ask("x: "); err == nil {
		t.Fatal("a 5000-character line was accepted")
	}
}

func TestChownWalksWithoutFollowingLinks(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a/b"), 0o700)
	os.WriteFile(filepath.Join(dir, "a/b/f"), []byte("x"), 0o600)
	os.Symlink(outside, filepath.Join(dir, "a/link"))
	// Chown to ourselves (tests aren't root): it must walk the tree and not fail on the symlink.
	if err := (realSystem{}).Chown(dir, os.Getuid(), os.Getgid()); err != nil {
		t.Fatal(err)
	}
}
