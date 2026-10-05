package installer

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Detector looks for signs that this machine serves the EmDash site (open question 17). Each signal and how far
// it can be trusted:
//   - a running site process (astro dev or preview, a built Astro server, workerd, an EmDash binary): reliable
//     while the site runs; misses a site that is stopped, or one in a container (its processes still show in /proc
//     on the host, under their own command lines);
//   - an astro.config.* that imports emdash in the usual places (/home, /root, /srv, /var/www, /opt, five folders
//     deep): catches a stopped site; misses one kept elsewhere;
//   - the site's host name resolving to this machine (or loopback): catches a site served directly; misses one
//     behind Cloudflare or another proxy, whose name resolves to the proxy.
//
// Any one is enough to refuse. None of them is proof the machine is clean, so the admin page and docs keep saying
// "a separate machine".
type Detector struct {
	Root     string // "/" on a real machine
	Lookup   func(ctx context.Context, host string) ([]net.IP, error)
	LocalIPs func() ([]net.IP, error)
}

// NewDetector returns a detector for this machine.
func NewDetector() Detector {
	return Detector{
		Root: "/",
		Lookup: func(ctx context.Context, host string) ([]net.IP, error) {
			addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			var ips []net.IP
			for _, a := range addrs {
				ips = append(ips, a.IP)
			}
			return ips, err
		},
		LocalIPs: func() ([]net.IP, error) {
			addrs, err := net.InterfaceAddrs()
			var ips []net.IP
			for _, a := range addrs {
				if n, ok := a.(*net.IPNet); ok {
					ips = append(ips, n.IP)
				}
			}
			return ips, err
		},
	}
}

// Signals returns one plain description per sign found.
func (d Detector) Signals(ctx context.Context, site string) []string {
	var out []string
	out = append(out, d.processes()...)
	out = append(out, d.configs()...)
	if s := d.siteAddress(ctx, site); s != "" {
		out = append(out, s)
	}
	return out
}

func (d Detector) path(p string) string { return filepath.Join(d.Root, p) }

func (d Detector) processes() []string {
	entries, _ := os.ReadDir(d.path("proc"))
	var out []string
	for _, e := range entries {
		if !e.IsDir() || strings.Trim(e.Name(), "0123456789") != "" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(d.path("proc"), e.Name(), "cmdline"))
		if err != nil || len(raw) == 0 {
			continue
		}
		args := strings.Split(strings.TrimRight(string(raw), "\x00"), "\x00")
		if what := siteProcess(args); what != "" {
			out = append(out, fmt.Sprintf("a running site process (%s, pid %s)", what, e.Name()))
		}
	}
	return out
}

func siteProcess(args []string) string {
	if filepath.Base(args[0]) == "workerd" {
		return "workerd"
	}
	for i, a := range args {
		switch {
		case filepath.Base(a) == "astro" && i+1 < len(args) && (args[i+1] == "dev" || args[i+1] == "preview"):
			return "astro " + args[i+1]
		case strings.HasSuffix(a, "dist/server/entry.mjs"):
			return "a built Astro server"
		case strings.Contains(a, "/node_modules/emdash/"):
			return "an EmDash process"
		}
	}
	return ""
}

const (
	maxDepth   = 5
	maxEntries = 50_000
)

func (d Detector) configs() []string {
	var out []string
	seen := 0
	for _, top := range []string{"home", "root", "srv", "var/www", "opt"} {
		base := d.path(top)
		filepath.WalkDir(base, func(p string, e fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			seen++
			if seen > maxEntries {
				return filepath.SkipAll
			}
			rel, _ := filepath.Rel(base, p)
			if e.IsDir() {
				name := e.Name()
				if p != base && (name == "node_modules" || strings.HasPrefix(name, ".") || strings.Count(rel, string(filepath.Separator)) >= maxDepth) {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasPrefix(e.Name(), "astro.config.") || !e.Type().IsRegular() {
				return nil
			}
			f, err := os.Open(p)
			if err != nil {
				return nil
			}
			head, _ := io.ReadAll(io.LimitReader(f, 64<<10))
			f.Close()
			if strings.Contains(string(head), "emdash") {
				out = append(out, "an EmDash site's "+filepath.Join("/", top, rel))
			}
			return nil
		})
	}
	return out
}

func (d Detector) siteAddress(ctx context.Context, site string) string {
	u, err := url.Parse(site)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	host := u.Hostname()
	var ips []net.IP
	if host == "localhost" {
		ips = []net.IP{net.IPv6loopback}
	} else if ip := net.ParseIP(host); ip != nil {
		ips = []net.IP{ip}
	} else {
		lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		ips, _ = d.Lookup(lctx, host)
	}
	local, _ := d.LocalIPs()
	for _, ip := range ips {
		if ip.IsLoopback() {
			return fmt.Sprintf("the site's address (%s) resolves to this machine", host)
		}
		for _, l := range local {
			if ip.Equal(l) {
				return fmt.Sprintf("the site's address (%s) resolves to this machine", host)
			}
		}
	}
	return ""
}
