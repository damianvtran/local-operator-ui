#!/usr/bin/env bash
# The parts both About-panel rigs share: isolation, launch, census, reaping.
#
# Sourced by `run.sh` (the headless behaviour rig) and `identity.sh` (the one
# visible capture per tree). It is a separate file because the two rigs must
# agree on the isolation and, above all, on the reaping: this app is driven on
# the operator's own desktop, and a rig that leaves an Electron behind leaves a
# window behind. `about_reap` is the only teardown either rig uses, and it is
# installed as an EXIT trap by both, so a failure path reaps too.
#
# Where the agent-visible facts come from, and why not from the app:
#   * which application is frontmost, by PID, from `lsappinfo` - no Accessibility
#     permission and no `System Events`, unlike the sibling `window-mode` rig's
#     osascript;
#   * which windows the window server says this pid owns, from `cg-windows`,
#     with the window server's own `onscreen` answer - a headless run's window is
#     listed with `onscreen` false, so "no panel appeared" is a census result
#     rather than an absence of evidence;
#   * the panel's pixels, from `screencapture -l <window id>`, which photographs
#     ONE NAMED WINDOW and never the screen.

# about_init <tree> <label> <mode> <size>
about_init() {
	local tree="$1" label="$2" mode="$3" size="$4"

	TREE="$(cd "$tree" && pwd)"
	LABEL="$label"
	MODE="$mode"
	SIZE="$size"
	HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	SCRATCH="${SCRATCH:-/tmp/about-panel/$LABEL}"
	INSPECT_PORT="${INSPECT_PORT:-9341}"

	rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/home" "$SCRATCH/frames"

	# The tree's own Electron, so this measures the app this checkout builds.
	# `npx electron` from a scratch cwd resolves nothing local and downloads a
	# fresh Electron instead - a different bundle identity, which is the very
	# thing under measurement.
	ELECTRON_BIN="${ELECTRON_BIN:-$TREE/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron}"
	if [ ! -x "$ELECTRON_BIN" ]; then
		echo "FAIL: no Electron at $ELECTRON_BIN - run pnpm install in $TREE" >&2
		exit 1
	fi
	if [ ! -f "$TREE/out/main/index.js" ]; then
		echo "FAIL: $TREE/out/main/index.js is missing - run pnpm build in $TREE first" >&2
		exit 1
	fi

	# An inherited CMUX_* variable has renamed a real workspace from an earlier
	# headless test in this repository, so clear them before anything boots.
	for name in $(env | sed -n 's/^\(CMUX_[A-Z_]*\)=.*/\1/p'); do unset "$name"; done
	unset LOCAL_OPERATOR_CONFIG_DIR LOCAL_OPERATOR_HOME LOCAL_OPERATOR_DESKTOP_TOKEN 2>/dev/null || true

	# A port that is already LISTENING is not a free one: this rig would attach to
	# whatever answers on it, whose menu is not this app's. Fail before launching.
	if lsof -nP -iTCP:"$INSPECT_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
		echo "FAIL: something is already listening on the inspector port $INSPECT_PORT - refusing to drive a process this run does not own (set INSPECT_PORT=)" >&2
		exit 1
	fi

	# `cg-windows` is compiled into the scratch root rather than committed as a
	# binary: the repository carries the source and the flags, not an arm64
	# object nobody can read.
	CENSUS="$SCRATCH/cg-windows"
	clang -O1 -framework CoreGraphics -framework CoreFoundation \
		-o "$CENSUS" "$HARNESS/cg-windows.c"
}

# about_launch: starts the app from a scratch cwd and waits for its inspector.
#
# The cwd is load-bearing rather than tidy: `src/main/backend/config.ts` loads
# `.env` from the working directory with `override: true`, so a launch whose cwd
# is the tree reads whatever another agent left in that file. VITE_DISABLE_BACKEND_MANAGER
# is set because this rig has no backend to attach to and must not spawn one on
# the operator's machine, and the notifications kill switch is set because the
# app's own banner path reaches `osascript` on macOS.
#
# LOCAL_OPERATOR_LOG_DIR is set for the same reason HOME is, and HOME alone does
# not do it: the app's logger composes its default from Electron's `home` — the
# OS ACCOUNT's home, not the `HOME` variable — so without this override every
# launch of this rig appends its lines to the operator's own
# ~/Library/Application Support/Local Operator/logs/*.log, interleaved with his
# app's. See `src/main/backend/log-dir.ts`.
about_launch() {
	echo "== $LABEL: tree=$TREE mode=$MODE window=$SIZE scratch=$SCRATCH"
	(
		cd "$SCRATCH"
		VITE_DISABLE_BACKEND_MANAGER="true" \
			LOCAL_OPERATOR_NO_NOTIFICATIONS="1" \
			LOCAL_OPERATOR_UI_WINDOW_MODE="$MODE" \
			HOME="$SCRATCH/home" \
			LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
			LOCAL_OPERATOR_HOME="$SCRATCH/home" \
			LOCAL_OPERATOR_LOG_DIR="$SCRATCH/logs" \
			nohup "$ELECTRON_BIN" "$TREE" --inspect="$INSPECT_PORT" \
			"--user-data-dir=$SCRATCH/profile" "--window-size=$SIZE" \
			>"$SCRATCH/electron.log" 2>&1 &
	)

	for _ in $(seq 1 60); do
		curl -sf "http://127.0.0.1:$INSPECT_PORT/json/list" >/dev/null 2>&1 && break
		sleep 1
	done

	APP_PID="$(about_main_pid)"
	if [ -z "$APP_PID" ]; then
		echo "FAIL: the app did not start - see $SCRATCH/electron.log" >&2
		tail -20 "$SCRATCH/electron.log" >&2 || true
		exit 1
	fi
	# And the inspector socket must belong to THIS run's app, or the invocation
	# would land in a peer session's menu.
	local owner
	owner="$(lsof -nP -iTCP:"$INSPECT_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
	if [ "$owner" != "$APP_PID" ]; then
		echo "FAIL: the inspector port belongs to pid ${owner:-none}, not this run's app ($APP_PID)" >&2
		exit 1
	fi
}

about_main_pid() {
	# The browser process is the one running the Electron executable itself;
	# helpers carry `--type=`.
	for pid in $(pgrep -f -- "$SCRATCH/profile" 2>/dev/null || true); do
		ps -o command= -p "$pid" 2>/dev/null | grep -q "Electron.app/Contents/MacOS/Electron" || continue
		ps -o command= -p "$pid" 2>/dev/null | grep -q -- "--type=" && continue
		echo "$pid"; return
	done
}

# Which application is frontmost, by pid. `-` is lsappinfo's honest "nobody".
about_frontmost() {
	local asn pid
	asn="$(lsappinfo front 2>/dev/null || true)"
	[ -n "$asn" ] || { echo "-"; return; }
	pid="$(lsappinfo info -only pid "$asn" 2>/dev/null | sed -n 's/.*"pid"=\([0-9]*\).*/\1/p' | head -1)"
	echo "${pid:--}"
}

about_census() {
	"$CENSUS" "$APP_PID" "$@" 2>/dev/null || true
}

about_window_ids() {
	about_census | sed -n 's/.*"id": \([0-9]*\).*/\1/p' | sort
}

# The window server's on-screen set for this pid, reported as its own line because
# it is evidence about the SCREEN rather than what the difference below is
# computed from: it is empty for a background app while the display is asleep or
# the screen is locked, which was measured on this machine (an `inactive` run at
# 00:47 whose window the app reported as `visible=true focused=false` appeared in
# `--onscreen-only` not at all, while the full list carried it with
# `onscreen: false` and `screencapture -l` still rendered it). A diff over the
# on-screen set would read that as "the action created nothing" - the one answer
# this rig must never give for the wrong reason.
about_onscreen_ids() {
	about_census --onscreen-only | sed -n 's/.*"id": \([0-9]*\).*/\1/p' | sort
}

# Wait for the app to have produced its window, read from the app's OWN state
# line rather than from the census.
#
# Why the log and not the window server: in `headless` the window exists and is
# never on screen, so a census-based wait would never return, and in `inactive`
# a census taken before `ready-to-show` is empty - which is how an earlier
# version of this rig counted the app's own window as "created by the action"
# and photographed it instead of the panel. The state line is printed once, after
# the window is created and presented, in every mode.
about_wait_for_window() {
	for _ in $(seq 1 120); do
		grep -q "\[window-mode\] state:" "$SCRATCH/electron.log" 2>/dev/null && return 0
		sleep 0.5
	done
	echo "FAIL: the app never printed its window state line - see $SCRATCH/electron.log" >&2
	return 1
}

# Samples the frontmost application while the action runs, so "the app did not
# activate" is a count over the run rather than a single reading.
about_start_sampler() {
	FRONTMOST_LOG="$SCRATCH/frontmost.log"; : >"$FRONTMOST_LOG"
	(
		for _ in $(seq 1 60); do
			echo "$(date +%s.%N) $(about_frontmost)" >>"$FRONTMOST_LOG"
			sleep 0.25
		done
	) &
	SAMPLER=$!
}

about_stop_sampler() {
	[ -n "${SAMPLER:-}" ] && kill "$SAMPLER" 2>/dev/null || true
	wait "$SAMPLER" 2>/dev/null || true
}

about_frontmost_summary() {
	local total stole
	total=$(wc -l <"$FRONTMOST_LOG" | tr -d ' ')
	stole=$(awk -v pid="$APP_PID" '$2 == pid' "$FRONTMOST_LOG" | wc -l | tr -d ' ')
	echo "== this app was the frontmost application in $stole of $total samples (pid $APP_PID)"
}

about_app_lines() {
	grep -h "\[window-mode\]\|\[about-panel\]" "$SCRATCH/electron.log" | sed 's/^/   /' || echo "   (none)"
}

# The only teardown either rig uses, and the one thing that must never fail.
#
# Why it loops rather than killing once: an Electron browser process that is
# asked to quit takes its helpers with it, so the first pass leaves helpers still
# winding down. An earlier version of this rig killed once, counted after a
# single second, and treated three surviving helper processes as done - which is
# how five runs of it were left to launchd, each holding a window on the
# operator's desktop. This waits for zero, escalates once, and PRINTS the count so
# the run reports what it left behind instead of assuming.
about_reap() {
	local deadline=$((SECONDS + 12)) pids left
	while :; do
		pids="$(pgrep -f -- "$SCRATCH/profile" 2>/dev/null || true)"
		if [ -z "$pids" ]; then break; fi
		if [ "$SECONDS" -ge "$deadline" ]; then
			for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
			break
		fi
		for pid in $pids; do kill "$pid" 2>/dev/null || true; done
		sleep 0.5
	done
	left="$(pgrep -f -- "$SCRATCH/profile" 2>/dev/null | wc -l | tr -d ' ')"
	echo "== processes left from this run: $left"
	[ "$left" = "0" ]
}
