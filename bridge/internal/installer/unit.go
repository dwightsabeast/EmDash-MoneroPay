package installer

// UnitText is the systemd unit (phase 03 rules: a dedicated user, NoNewPrivileges, ProtectSystem=strict with explicit
// ReadWritePaths, ProtectHome, PrivateTmp, RestrictAddressFamilies, no inbound listeners: wallet-rpc binds loopback).
func UnitText() string {
	return `[Unit]
Description=xmr-pay wallet host (xmr-bridge)
Documentation=https://github.com/dwightsabeast/EmDash-MoneroPay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=` + ServiceUser + `
Group=` + ServiceUser + `
ExecStart=` + binaryPath + ` run --config ` + configPath + `
Restart=on-failure
RestartSec=10
UMask=0077

NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=` + dataDir + `
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
MemoryDenyWriteExecute=yes
ProtectProc=invisible
RemoveIPC=yes
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
`
}
