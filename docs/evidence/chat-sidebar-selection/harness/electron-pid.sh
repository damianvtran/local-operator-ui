#!/usr/bin/env bash
# Launch the tree's real Electron in a way this run can stop BY PID.
#
#     SIDEBAR_ELECTRON=<app binary> SIDEBAR_PID_FILE=<file> electron-pid.sh <tree> ...
#
# WHY THIS FILE EXISTS. The window-mode harness launches whatever `ELECTRON_BIN`
# names and stops the run with a pattern (`pgrep -f <scratch profile>`). Both
# halves are wrong in a way that leaves apps running on the operator's desktop,
# and `docs/agent-driver.md` § "The app's lifecycle: one boot, one process,
# stopped by pid" is the contract this follows:
#
#   - `npx electron` / `node_modules/.bin/electron` is a SHIM that spawns the app
#     as its own child, so the pid a launcher holds is the shim's: the teardown
#     signals a process that has already exited and the real Electron re-parents
#     to launchd, still running, still holding the profile.
#   - A pattern-matched kill is also unsound for the opposite reason: any pattern
#     wide enough to find a headless app here also matches the operator's own app.
#
# `exec` is the load-bearing line. It replaces this shell with the app, so the
# pid appended below IS the app's browser process — the process that owns the
# helpers — and the caller can SIGTERM-then-SIGKILL exactly that pid and wait for
# it to go. Measured after this change: a full run ends with no process carrying
# its scratch path, checked by the caller.
#
# APPEND, not overwrite, because the harness boots the app TWICE: the second
# launch is its own `second-instance` case, and it goes through this same
# wrapper. Overwriting is how the first fix leaked anyway — the file ended up
# naming the second process, which exits on the single-instance lock within a
# second, so the teardown waited on a pid that was already gone while the real
# app (and its helpers) stayed up. The caller stops every pid in the file.
#
# `SIDEBAR_ELECTRON` is the tree's own binary under
# `node_modules/electron/dist/...`, which is the same resolution
# `bin/local-operator-ui.js` uses (`require("electron")`) and not the
# `.bin/electron` shim.
set -euo pipefail

: "${SIDEBAR_ELECTRON:?SIDEBAR_ELECTRON must name the app's Electron binary}"
: "${SIDEBAR_PID_FILE:?SIDEBAR_PID_FILE must name where the app's pid is recorded}"

echo "$$" >> "$SIDEBAR_PID_FILE"
exec "$SIDEBAR_ELECTRON" "$@"
