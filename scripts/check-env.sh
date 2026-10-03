#!/usr/bin/env bash
# Prints the dev box's tool versions and service state. Prints no secrets.
# Usage: scripts/check-env.sh
set -u

ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; }

echo "Toolchain"
if command -v node >/dev/null 2>&1; then
  v=$(node -v); major=${v#v}; major=${major%%.*}
  if [ "$major" -ge 22 ]; then ok "node $v"; else fail "node $v (EmDash needs 22.16 or later)"; fi
else fail "node not found"; fi
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm -v)" || fail "pnpm not found"
command -v go   >/dev/null 2>&1 && ok "$(go version)"   || fail "go not found"
command -v git  >/dev/null 2>&1 && ok "$(git --version)" || fail "git not found"
command -v jq   >/dev/null 2>&1 && ok "jq $(jq --version)" || warn "jq not found"
command -v claude >/dev/null 2>&1 && ok "claude $(claude --version 2>/dev/null | head -1)" || warn "claude not on PATH"

echo "Monero"
if [ -x /opt/monero/monerod ]; then ok "$(/opt/monero/monerod --version | head -1)"; else fail "/opt/monero/monerod missing"; fi
if command -v systemctl >/dev/null 2>&1; then
  state=$(systemctl is-active monerod-stagenet 2>/dev/null || true)
  [ "$state" = "active" ] && ok "monerod-stagenet is active" || fail "monerod-stagenet is ${state:-unknown}"
fi
info=$(curl -s --max-time 5 http://127.0.0.1:38081/json_rpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_info"}' 2>/dev/null || true)
if [ -n "$info" ] && command -v jq >/dev/null 2>&1; then
  h=$(echo "$info" | jq -r '.result.height // empty')
  t=$(echo "$info" | jq -r '.result.target_height // empty')
  s=$(echo "$info" | jq -r '.result.synchronized // empty')
  net=$(echo "$info" | jq -r '.result.nettype // empty')
  if [ "$s" = "true" ]; then ok "stagenet node synced at height $h ($net)"; else warn "node syncing: height $h of ${t:-?} ($net)"; fi
else
  fail "no answer from http://127.0.0.1:38081/json_rpc"
fi
if [ -f "$HOME/.config/xmr-pay-dev/stagenet.env" ]; then
  perms=$(stat -c %a "$HOME/.config/xmr-pay-dev/stagenet.env")
  [ "$perms" = "600" ] && ok "stagenet.env present (mode 600)" || warn "stagenet.env present but mode $perms (should be 600)"
else
  warn "~/.config/xmr-pay-dev/stagenet.env not created yet (needed from phase 01)"
fi

echo "Dev site"
site="$HOME/sites/xmr-dev-site"
if [ -d "$site" ]; then
  ok "$site exists"
  [ -x "$site/node_modules/.bin/workerd" ] && ok "workerd $("$site/node_modules/.bin/workerd" --version 2>/dev/null)" || fail "workerd not installed in the dev site"
  # sandboxRunner must sit directly inside emdash({...}). A grep or an indentation check is fooled
  # when it is nested in another call (it once sat inside local({...})), so count bracket depth from
  # just after "emdash({" (depth 1), ignoring quoted strings and // comments.
  # ASTRO_CONFIG overrides the file, for testing this check.
  cfg="${ASTRO_CONFIG:-$site/astro.config.mjs}"
  depth=$(awk '
    BEGIN { started = 0; depth = 0; q = ""; found = "none" }
    {
      line = $0; i = 1
      if (!started) {
        p = index(line, "emdash({"); if (p == 0) next
        started = 1; depth = 1; i = p + length("emdash({")
      }
      if (q == "" && found == "none" && substr(line, i) ~ /^[ \t]*sandboxRunner[ \t]*:/) found = depth
      for (n = length(line); i <= n; i++) {
        c = substr(line, i, 1)
        if (q != "") { if (c == "\\") i++; else if (c == q) q = ""; continue }
        if (c == "/" && substr(line, i + 1, 1) == "/") break
        if (c == "\"" || c == "'\''" || c == "`") q = c
        else if (c == "(" || c == "{" || c == "[") depth++
        else if (c == ")" || c == "}" || c == "]") depth--
      }
    }
    END { print found }' "$cfg" 2>/dev/null)
  case "$depth" in
    1)        ok "sandboxRunner configured directly inside emdash({...}) in $cfg" ;;
    none|"")  warn "sandboxRunner not found inside emdash({...}) in $cfg" ;;
    *)        warn "sandboxRunner found at depth $depth, not directly inside emdash({...}) in $cfg (nested in another call?)" ;;
  esac
  # "localhost", not 127.0.0.1: astro dev may listen on the IPv6 loopback (::1) only.
  curl -s -o /dev/null --max-time 5 -w '%{http_code}' http://localhost:4321/ | grep -qE '^(200|30[0-9])$' \
    && ok "dev site answering on localhost:4321" || warn "dev site not answering on localhost:4321 (is it running? tmux ls)"
else
  fail "$site missing"
fi

echo "Disk"
df -h "$HOME" | awk 'NR==2 {print "  " $4 " free of " $2 " on " $6}'
