#!/usr/bin/env bash
# The Integrations live-run rig: one isolated lop daemon, one token, no model.
#
# WHY A DAEMON OF THIS RUN'S OWN. The scene's whole claim is that Settings >
# Integrations works with no conversation and no model provider, so the config
# root has to be genuinely fresh and the daemon genuinely this run's. Pointing at
# the operator's own backend would prove the opposite: it has model credentials,
# a roster of real conversations, and MCP servers in use.
#
# ISOLATION, and which knob does what:
#   * HOME is scratch, and LOCAL_OPERATOR_CONFIG_DIR is deliberately NOT set, so
#     config_dir() resolves to $RIG/home/.local-operator - the same path
#     `_scope_path(cwd, "project")` computes for cwd = home. That collision is
#     the reported bug (a Global server showing as "This project"), so this rig
#     reproduces it rather than dodging it: the scene asserts
#     project_scope_available is FALSE here.
#   * LOCAL_OPERATOR_LOG_DIR is scratch, because Electron's `home` is the OS
#     account's home and neither HOME nor --user-data-dir redirects it.
#   * XPC_FLAGS is dropped for the children: inherited, it breaks getaddrinfo in
#     a tool child on this host while the session itself resolves fine.
#
# The token is written 0600 into the rig and never printed: it is the bearer for
# a loopback plane, and both the daemon and the app must present the same one.
set -euo pipefail

RIG="${1:?usage: rig-up.sh <rig-root> <backend-worktree> [port]}"
BACKEND_TREE="${2:?}"
PORT="${3:-8080}"

mkdir -p "$RIG/home" "$RIG/logs"
TOKEN_FILE="$RIG/desktop-token"
if [ ! -f "$TOKEN_FILE" ]; then
	umask 077
	openssl rand -hex 32 > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(cat "$TOKEN_FILE")"

# A fresh config root each time the rig is created, so "no servers" is a fact.
rm -f "$BACKEND_TREE"/../.rig-sentinel 2>/dev/null || true

cd "$RIG/home"
env -u XPC_FLAGS -u CMUX_WORKSPACE_ID -u CMUX_SESSION_ID \
	HOME="$RIG/home" \
	LOCAL_OPERATOR_LOG_DIR="$RIG/logs" \
	LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
	"$BACKEND_TREE/.venv/bin/python" -m local_operator.cli serve \
	--host 127.0.0.1 --port "$PORT" \
	>"$RIG/logs/daemon.log" 2>&1 &
echo $! > "$RIG/daemon.pid"

# The daemon publishes its own 0600 record under the config root it was started
# with; the driver copies it into the app's scratch root so discovery can verify
# the identity it names. Waiting for the file is waiting for the daemon.
for _ in $(seq 1 120); do
	if compgen -G "$RIG/home/.local-operator/run/serve/*.json" > /dev/null; then
		echo "rig up: daemon pid $(cat "$RIG/daemon.pid") port $PORT"
		echo "records: $RIG/home/.local-operator/run/serve"
		exit 0
	fi
	sleep 1
done
echo "rig failed: no serve record after 120s; daemon log tail:" >&2
tail -20 "$RIG/logs/daemon.log" >&2
exit 1
