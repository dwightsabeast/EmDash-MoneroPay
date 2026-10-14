package installer

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// adminCommand returns the install command the plugin's admin page shows (plugin/src/admin.ts, installCommand),
// filled in with installURL, the site and the pairing code.
func adminCommand(t *testing.T, installURL, site, code string) string {
	t.Helper()
	src, err := os.ReadFile("../../../plugin/src/admin.ts")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile("export function installCommand\\(siteUrl: string, code: string\\): string \\{\\n\\treturn `([^`]+)`;").FindSubmatch(src)
	if m == nil {
		t.Fatal("plugin/src/admin.ts no longer has installCommand as one template literal")
	}
	return strings.NewReplacer("${INSTALL_URL}", installURL, "${siteUrl}", site, "${code}", code).Replace(string(m[1]))
}

// The admin page's four-line command, run by sh on machines with curl, with only wget, and with neither (phase 05:
// a clean Ubuntu 24.04 container has no curl).
func TestAdminInstallCommand(t *testing.T) {
	// A stand-in install.sh that records its arguments.
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" > \"$RECORD\"\n"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/install.sh" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(script))
	}))
	defer srv.Close()
	run := func(tools, path string) (string, string) {
		dir := t.TempDir()
		record := filepath.Join(dir, "record")
		cmd := exec.Command("/bin/sh", "-c", adminCommand(t, srv.URL+path, "https://shop.example", "AbCdEfGhIjKlMnOpQrSt_-"))
		cmd.Env = []string{"PATH=" + toolPath(t, tools), "HOME=" + dir, "RECORD=" + record}
		out, _ := cmd.CombinedOutput()
		rec, _ := os.ReadFile(record)
		return strings.TrimSpace(string(rec)), string(out)
	}
	for _, tools := range []string{"curl", "wget"} {
		rec, out := run(tools, "/install.sh")
		if rec != "--site https://shop.example --pair AbCdEfGhIjKlMnOpQrSt_-" {
			t.Errorf("%s: install.sh got %q: %s", tools, rec, out)
		}
		// A failed download says why, and nothing runs.
		rec, out = run(tools, "/missing.sh")
		if rec != "" || !strings.Contains(out, "404") {
			t.Errorf("%s, missing file: record %q, output %q", tools, rec, out)
		}
	}
	// Pasted into a terminal, the four lines reach the shell one by one; it waits for `fi`, then runs the command once.
	dir := t.TempDir()
	record := filepath.Join(dir, "record")
	paste := exec.Command("/bin/sh")
	paste.Stdin = strings.NewReader(adminCommand(t, srv.URL+"/install.sh", "https://shop.example", "AbCdEfGhIjKlMnOpQrSt_-") + "\n")
	paste.Env = []string{"PATH=" + toolPath(t, "wget"), "HOME=" + dir, "RECORD=" + record}
	if out, err := paste.CombinedOutput(); err != nil {
		t.Errorf("pasted: %v: %s", err, out)
	}
	if got, _ := os.ReadFile(record); strings.TrimSpace(string(got)) != "--site https://shop.example --pair AbCdEfGhIjKlMnOpQrSt_-" {
		t.Errorf("pasted: install.sh got %q", got)
	}

	rec, out := run("none", "/install.sh")
	if rec != "" || !strings.Contains(out, "needs curl or wget") || !strings.Contains(out, "sudo apt install curl") || !strings.Contains(out, "paste again") {
		t.Errorf("neither: record %q, output %q", rec, out)
	}
}
