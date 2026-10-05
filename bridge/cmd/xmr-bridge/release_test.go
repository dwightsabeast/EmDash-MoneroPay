package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// A release build must not contain the dev public key or the dev release address, even when the dev values are
// passed to the linker (a normal build has nowhere to put them). A devrelease build with the same values must
// contain both: the control that shows the check would notice.
func TestReleaseBuildHasNoDevValues(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the bridge twice")
	}
	const key = "U0VOVElORUwtZGV2LWtleS1kby1ub3Qtc2hpcC0wMDA=" // "SENTINEL-dev-key-do-not-ship-000", base64
	const url = "http://sentinel-dev-release.invalid:8099"
	ldflags := "-X main.devReleaseKey=" + key + " -X main.devReleaseURL=" + url
	build := func(tags string) []byte {
		out := filepath.Join(t.TempDir(), "xmr-bridge")
		args := []string{"build", "-trimpath", "-ldflags", ldflags, "-o", out}
		if tags != "" {
			args = append(args, "-tags", tags)
		}
		cmd := exec.Command("go", append(args, ".")...)
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOTOOLCHAIN=local")
		if b, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("go build %s: %v %s", tags, err, b)
		}
		b, _ := os.ReadFile(out)
		return b
	}
	release, dev := build(""), build("devrelease")
	if bytes.Contains(release, []byte(key)) || bytes.Contains(release, []byte(url)) {
		t.Fatal("the release build contains a dev value")
	}
	if bytes.Contains(release, []byte("main.devReleaseKey")) || bytes.Contains(release, []byte("main.devReleaseURL")) || bytes.Contains(release, []byte("main.devBreak")) {
		t.Fatal("the release build has the dev variables")
	}
	if !bytes.Contains(dev, []byte(key)) || !bytes.Contains(dev, []byte(url)) {
		t.Fatal("control failed: the devrelease build should contain both values")
	}
}
