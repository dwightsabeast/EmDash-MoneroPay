package installer

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The fake bridge: "version" succeeds unless it runs from below FAKE_NOEXEC (standing in for a /tmp mounted
// noexec); anything else records its arguments.
const fakeBridge = `#!/bin/sh
case "$0" in "$FAKE_NOEXEC"*) [ -n "$FAKE_NOEXEC" ] && exit 126 ;; esac
if [ "$1" = version ]; then exit 0; fi
printf '%s\n' "$0 $*" > "$RECORD"
`

type shCase struct {
	uname, arch, uid string
	served           map[string][]byte // path -> body
	template         bool              // leave the placeholders
	noexecTmp        bool
	redirect         bool   // the server answers each download with a redirect to the file
	tools            string // "": the system PATH; "curl", "wget" or "none": only that downloader (see toolPath)
}

// toolPath returns a folder holding links to the programs install.sh and the admin page's command use, plus the
// named downloader ("curl", "wget", or "none" for neither), so a test can stand in for a machine without curl.
func toolPath(t *testing.T, downloader string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "tools")
	os.MkdirAll(dir, 0o755)
	names := []string{"sh", "mktemp", "rm", "sha256sum", "cut", "chmod", "cp", "cat"}
	if downloader != "none" {
		names = append(names, downloader)
	}
	for _, n := range names {
		p, err := exec.LookPath(n)
		if err != nil {
			t.Skipf("%s isn't on this machine", n)
		}
		if err := os.Symlink(p, filepath.Join(dir, n)); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func runInstallSh(t *testing.T, c shCase) (code int, out, record, sudoLog string, tmp string) {
	t.Helper()
	tpl, err := os.ReadFile("../../../installer/install.sh")
	if err != nil {
		t.Fatal(err)
	}
	amd, arm := []byte(fakeBridge), []byte(fakeBridge+"# arm64\n")
	sum := func(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
	files := c.served
	if files == nil {
		files = map[string][]byte{"/xmr-bridge-0.0.0-test-linux-amd64": amd, "/xmr-bridge-0.0.0-test-linux-arm64": arm}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c.redirect && !strings.HasPrefix(r.URL.Path, "/moved/") {
			http.Redirect(w, r, "/moved"+r.URL.Path, http.StatusFound)
			return
		}
		b, ok := files[strings.TrimPrefix(r.URL.Path, "/moved")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(b)
	}))
	defer srv.Close()
	script := string(tpl)
	if !c.template {
		script = strings.NewReplacer("__RELEASE_BASE__", srv.URL, "__VERSION__", "0.0.0-test",
			"__SHA256_AMD64__", sum(amd), "__SHA256_ARM64__", sum(arm), "__CURL_PROTO__", "=http,https").Replace(script)
	}
	dir := t.TempDir()
	fake := filepath.Join(dir, "fakebin")
	os.MkdirAll(fake, 0o755)
	tool := func(name, body string) {
		os.WriteFile(filepath.Join(fake, name), []byte("#!/bin/sh\n"+body+"\n"), 0o755)
	}
	tool("uname", `[ "$1" = -s ] && echo "$FAKE_S" || echo "$FAKE_M"`)
	tool("id", `echo "$FAKE_UID"`)
	tool("sudo", `printf '%s\n' "$*" >> "$SUDO_LOG"; exec "$@"`)
	tmp = filepath.Join(dir, "tmp")
	home := filepath.Join(dir, "home")
	os.MkdirAll(tmp, 0o755)
	os.MkdirAll(home, 0o755)
	scriptPath := filepath.Join(dir, "install.sh")
	os.WriteFile(scriptPath, []byte(script), 0o644)
	recordPath, sudoPath := filepath.Join(dir, "record"), filepath.Join(dir, "sudo.log")
	cmd := exec.Command("/bin/sh", scriptPath, "--site", "https://shop.example", "--pair", "AbCdEfGhIjKlMnOpQrSt_-")
	path := fake + ":/usr/bin:/bin"
	if c.tools != "" {
		path = fake + ":" + toolPath(t, c.tools)
	}
	cmd.Env = []string{"PATH=" + path, "HOME=" + home, "TMPDIR=" + tmp, "RECORD=" + recordPath, "SUDO_LOG=" + sudoPath,
		"FAKE_S=" + c.uname, "FAKE_M=" + c.arch, "FAKE_UID=" + c.uid}
	if c.noexecTmp {
		cmd.Env = append(cmd.Env, "FAKE_NOEXEC="+tmp)
	}
	o, err := cmd.CombinedOutput()
	code = 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	r, _ := os.ReadFile(recordPath)
	s, _ := os.ReadFile(sudoPath)
	return code, string(o), strings.TrimSpace(string(r)), string(s), tmp
}

func linuxAmd64() shCase { return shCase{uname: "Linux", arch: "x86_64", uid: "1000"} }

func TestInstallShGood(t *testing.T) {
	code, out, rec, sudo, tmp := runInstallSh(t, linuxAmd64())
	if code != 0 {
		t.Fatalf("exit %d: %s", code, out)
	}
	if !strings.HasSuffix(rec, "/xmr-bridge install --site https://shop.example --pair AbCdEfGhIjKlMnOpQrSt_-") {
		t.Fatalf("handed off as %q", rec)
	}
	if !strings.Contains(sudo, "/xmr-bridge install --site") {
		t.Fatalf("not run with sudo: %q", sudo)
	}
	if !strings.Contains(out, "SHA-256 matches") {
		t.Fatalf("output %s", out)
	}
	if e, _ := os.ReadDir(tmp); len(e) != 0 {
		t.Fatalf("download folder left behind: %v", e)
	}
}

func TestInstallShAsRoot(t *testing.T) {
	c := linuxAmd64()
	c.uid = "0"
	code, out, rec, sudo, _ := runInstallSh(t, c)
	if code != 0 || rec == "" || sudo != "" {
		t.Fatalf("exit %d, record %q, sudo %q: %s", code, rec, sudo, out)
	}
}

func TestInstallShArm64(t *testing.T) {
	c := linuxAmd64()
	c.arch = "aarch64"
	code, out, rec, _, _ := runInstallSh(t, c)
	if code != 0 || rec == "" {
		t.Fatalf("exit %d: %s", code, out)
	}
}

func TestInstallShRefuses(t *testing.T) {
	bad := map[string][]byte{"/xmr-bridge-0.0.0-test-linux-amd64": []byte(fakeBridge + "# tampered\n")}
	for name, c := range map[string]struct {
		c    shCase
		want string
	}{
		"tampered download": {shCase{uname: "Linux", arch: "x86_64", uid: "1000", served: bad}, "doesn't match"},
		"missing download":  {shCase{uname: "Linux", arch: "x86_64", uid: "1000", served: map[string][]byte{}}, "download failed"},
		"template":          {shCase{uname: "Linux", arch: "x86_64", uid: "1000", template: true}, "template"},
		"other CPU":         {shCase{uname: "Linux", arch: "riscv64", uid: "1000"}, "CPU"},
		"not Linux":         {shCase{uname: "Darwin", arch: "arm64", uid: "1000"}, "Linux only"},
	} {
		t.Run(name, func(t *testing.T) {
			code, out, rec, _, _ := runInstallSh(t, c.c)
			if code == 0 || rec != "" || !strings.Contains(out, "xmr-bridge installer: ") || !strings.Contains(out, c.want) {
				t.Fatalf("exit %d, record %q: %s", code, rec, out)
			}
		})
	}
}

func TestInstallShNoexecTmp(t *testing.T) {
	c := linuxAmd64()
	c.noexecTmp = true
	code, out, rec, _, tmp := runInstallSh(t, c)
	if code != 0 || !strings.Contains(rec, "/home/.xmr-bridge.") {
		t.Fatalf("exit %d, record %q: %s", code, rec, out)
	}
	if e, _ := os.ReadDir(tmp); len(e) != 0 {
		t.Fatalf("the /tmp download folder was left behind: %v", e)
	}
}

// A wallet host without curl (a clean Ubuntu 24.04 container, phase 05): wget does the download, and the checksum
// check is the same.
func TestInstallShWget(t *testing.T) {
	c := linuxAmd64()
	c.tools = "wget"
	code, out, rec, _, tmp := runInstallSh(t, c)
	if code != 0 || !strings.HasSuffix(rec, "/xmr-bridge install --site https://shop.example --pair AbCdEfGhIjKlMnOpQrSt_-") || !strings.Contains(out, "SHA-256 matches") {
		t.Fatalf("exit %d, record %q: %s", code, rec, out)
	}
	if e, _ := os.ReadDir(tmp); len(e) != 0 {
		t.Fatalf("download folder left behind: %v", e)
	}
	c.tools = "curl"
	if code, out, rec, _, _ := runInstallSh(t, c); code != 0 || rec == "" {
		t.Fatalf("curl only: exit %d: %s", code, out)
	}
}

func TestInstallShWgetRefuses(t *testing.T) {
	bad := map[string][]byte{"/xmr-bridge-0.0.0-test-linux-amd64": []byte(fakeBridge + "# tampered\n")}
	for name, c := range map[string]struct {
		c    shCase
		want string
	}{
		"tampered download": {shCase{uname: "Linux", arch: "x86_64", uid: "1000", served: bad, tools: "wget"}, "doesn't match"},
		"missing download":  {shCase{uname: "Linux", arch: "x86_64", uid: "1000", served: map[string][]byte{}, tools: "wget"}, "download failed"},
		// GNU wget can't limit a redirect's protocol the way curl's --proto does, so it follows none (Wyatt, 2026-10-12).
		"redirect": {shCase{uname: "Linux", arch: "x86_64", uid: "1000", redirect: true, tools: "wget"}, "download failed"},
		"neither":  {shCase{uname: "Linux", arch: "x86_64", uid: "1000", tools: "none"}, "needs curl or wget"},
	} {
		t.Run(name, func(t *testing.T) {
			code, out, rec, _, _ := runInstallSh(t, c.c)
			if code == 0 || rec != "" || !strings.Contains(out, "xmr-bridge installer: ") || !strings.Contains(out, c.want) {
				t.Fatalf("exit %d, record %q: %s", code, rec, out)
			}
			if name == "neither" && (!strings.Contains(out, "sudo apt install curl") || !strings.Contains(out, "paste the install command again")) {
				t.Fatalf("doesn't say what to install: %s", out)
			}
		})
	}
	// curl follows a redirect within the protocols the release allows, as before.
	c := linuxAmd64()
	c.redirect, c.tools = true, "curl"
	if code, out, rec, _, _ := runInstallSh(t, c); code != 0 || rec == "" {
		t.Fatalf("curl and a redirect: exit %d: %s", code, out)
	}
}
