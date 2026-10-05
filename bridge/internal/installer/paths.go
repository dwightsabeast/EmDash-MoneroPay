package installer

import "path/filepath"

// The installed layout (spec, Bridge service, "Configuration"; 3f plan): the bridge binary lives in the data folder
// so a signed update can replace it under ProtectSystem=strict, with a symlink for the admin.
const (
	ServiceUser = "xmr-bridge"
	ServiceName = "xmr-bridge.service"
	dataDir     = "/var/lib/xmr-bridge"
	etcDir      = "/etc/xmr-bridge"
	binaryPath  = dataDir + "/bin/xmr-bridge"
	linkPath    = "/usr/local/bin/xmr-bridge"
	unitPath    = "/etc/systemd/system/" + ServiceName
	configPath  = etcDir + "/config"
)

// Paths places the layout under Root ("/" on a real install; a temporary folder in tests).
type Paths struct{ Root string }

func (p Paths) at(path string) string {
	if p.Root == "" || p.Root == "/" {
		return path
	}
	return filepath.Join(p.Root, path)
}

func (p Paths) DataDir() string { return p.at(dataDir) }
func (p Paths) BinDir() string  { return p.at(dataDir + "/bin") }
func (p Paths) Binary() string  { return p.at(binaryPath) }
func (p Paths) Link() string    { return p.at(linkPath) }
func (p Paths) EtcDir() string  { return p.at(etcDir) }
func (p Paths) Config() string  { return p.at(configPath) }
func (p Paths) Unit() string    { return p.at(unitPath) }
