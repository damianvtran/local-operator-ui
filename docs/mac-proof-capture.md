# Mac proof capture: one command, real vibrancy, no human step

`scripts/mac-proof-capture.mjs` photographs the **real** app (the installed
`/Applications/Local Operator.app`, a downloaded release zip (`--app-zip`), or
an `electron-builder --dir` build of a PR branch) on a Mac, in light and dark, with the window server's own capture. That
capture is the only one that carries macOS vibrancy: `capturePage()` and CDP
photograph the page, and the blurred desktop behind a glass window is not in the
page. It needs no click, no focus and no sign-in from the operator, which is what
he asked for: *"Do what you can without me, and extend test harnesses as needed to
be able to test without my involvement and use that to complete the task and
continue"*.

## The command

Run from a checkout of this repository (Node built-ins only, nothing to install):

```sh
node scripts/mac-proof-capture.mjs \
  --app "/Applications/Local Operator.app" \
  --out "$LOCAL_OPERATOR_SCRATCHPAD/proof-frames" \
  --session ce618964c88e \
  --scene conversation --scene files --scene canvas --scene library --scene notifications \
  --theme dark,light
```

Each `--scene` x `--theme` becomes one frame, `<scene>-<theme>.png`, plus a
`receipt.json` and the run's scratch logs in `--out/logs`. The five scenes are
presets: `conversation` (the `--session` view), `files` (the canvas's Files
view), `canvas` (the canvas's Documents view), `library` (the Library route) and
`notifications` (the notifications route). `files` and `canvas` need `--session`.
Before it spawns anything, the run prints how many frames it will take and says
it is opening **one** `inactive` window (one Dock tile) for the whole run.

`--dry-run` prints the plan (argv, environment with the token redacted, the
frame names) and spawns nothing. `--negative-control` runs every refusal case
against the real guard code and prints PASS/FAIL per case; it exits 0 only when
every case refused. `--help` lists every flag.

Exit codes: `0` every frame captured; `1` the run failed (a step, a capture, a
leak, a signal, the `--timeout`); `2` refused before anything was spawned; `3`
BLOCKED (a permission or an access decision only the operator can make). Both the
closing line and `receipt.json` name what ended a run early (`interrupted by
SIGHUP`, `the run exceeded --timeout 180 s`, `the app could not run: …`).

**Run it so the harness can always reap.** `--timeout` (default 180, max 290)
bounds the whole run from the moment the harness starts: relay, `/health`,
`--peer-wait` and the app all stop at it. The reap runs after it, typically a few
seconds; its escalation deadlines (app tree, then 5.5 s per lop group, then the
exact-pid sweeps) put the worst case near 20 s, so allow 60 s. SIGINT, SIGTERM and SIGHUP
all run that reap; **SIGKILL cannot be caught**, and a SIGKILLed harness leaves
the rig's `lop serve` (own process groups) running. An agent therefore runs the
command as a background job (lop `bash` with `background: true`), or gives its
tool call a timeout of at least `--timeout` + 60 s. lop's `bash` default of 120 s
is below the default `--timeout` and will SIGKILL the harness.

## What happens, and why it is safe on the operator's own desktop

1. **Preflight refuses before anything is spawned.** `--app` must be an absolute
   `.app` bundle with a `Contents/Info.plist` naming an existing executable
   (`--app-zip`: an absolute `.zip` file, its one bundle checked the same way
   once extracted into the rig, before the backend or the app starts).
   `--out`, the rig and the profile must not be, sit inside, or contain any of
   the operator's roots (`~/Library/Application Support/{Local Operator,
   local-operator-ui,Electron}`, the Linux `~/.config/` and `$XDG_CONFIG_HOME`
   equivalents, and `~/.local-operator`), compared by realpath so a symlink
   cannot smuggle one in. A dangling symlink is followed to its target, and on
   macOS the comparison folds case (APFS is case-insensitive).
   Agent scratchpads (`~/.local-operator/sessions/<id>/scratchpad`) are the one
   carve-out for the rig and `--out`. Only `--window-mode inactive` (window-server
   capture) or `headless` (in-app capture) run; `normal` never does.
2. **Screen Recording is checked without a prompt.** `CGPreflightScreenCaptureAccess`
   through JXA (it never prompts; `CGRequestScreenCaptureAccess`, which would, is
   never called). If it is not granted to the host process (the terminal or agent
   app), the run is BLOCKED with that sentence. If JXA cannot call the preflight
   at all, the run is also BLOCKED: there is no guessing fallback, because every
   other signal (window names) answers yes for system UI without the permission.
   Each captured PNG must also measure the window's `CGWindowList` bounds times
   one backing scale, or the frame is refused.
3. **A backend the app only ever attaches to** (see *Backend modes*).
4. **The app is exec'd directly**, never through `open` (which drops the
   environment and hands the request to the operator's running instance):
   `<bundle>/Contents/MacOS/<CFBundleExecutable> --user-data-dir=<rig>/profile
   --window-mode=inactive --window-size=1380x900 --use-mock-keychain
   --open-session=<id>`, with no `--` before the switches, `cwd=<rig>`, and an
   environment built from an allowlist (`PATH`, `LANG`, `LC_ALL`, `TMPDIR`,
   `USER`, `LOGNAME`, and the display variables) - never inherited, so no
   `CMUX_*`, `LOP_*`, `LOCAL_OPERATOR_*`, `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS`
   reaches it. Scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR` and
   `LOCAL_OPERATOR_LOG_DIR` keep the app's own writes in the rig; telemetry and
   notifications are off.
5. **The app's step runner drives it** (S1, `docs/agent-driver.md` *The step
   runner*). The harness writes a JSON step list; the app walks it with the
   shipped dev-driver verbs and prints one line per step. The harness aborts and
   reaps if the app's `[window-mode]` line names anything but the requested mode,
   if any window state says `focused=true`, if a step fails, or if the opened
   conversation is not `--session`.
6. **One window-server capture per frame.** For each `SHUTTER` line the harness
   checks the window id against the JXA `CGWindowList` entry (owner pid = the app
   it launched, layer 0), runs `screencapture -x -o -l <windowid> <frame>`
   (window only, no shadow, no sound), checks the PNG, and writes the ack the
   runner waits for. Nothing is activated, focused or raised: `screencapture -l`
   reads one window from the window server whether or not it is front.
7. **Reap.** The app by exact process group, escalating to SIGKILL, then any
   process still carrying the run's `--user-data-dir` by exact pid
   (`scripts/app-tree-teardown.mjs`); every lop process by its group, then every
   process carrying the run's config root in its environment plus every
   descendant recorded while they ran (standby runtimes run in their own process
   groups); then the app's recorded descendants by exact pid, and, last, any
   process whose working directory is still the rig (everything was spawned with
   `cwd=<rig>`, a fresh mkdtemp path, so nothing else can be there). The same
   single teardown runs on success, on failure, on `--timeout`, on a spawn
   error of any child, and on SIGTERM/SIGINT/SIGHUP; a signal that lands
   mid-reap waits for that reap. The stray-pid backstop kills a pid only when it
   is still this run's at kill time (cwd, argv or env names the rig or its config
   root), and its group only when that pid leads it. A survivor fails the run.

The app side has its own containment: a scripted run is launcher-bound (it quits
when the harness dies) and capped at 300 s; it banners nothing; and an armed boot
skips the start-up seal repair and app-initiated update checks (S3), so a run of
the shipped bundle can never modify that bundle and no update card can enter a
frame.

## Backend modes

The app never spawns, installs, claims or adopts a daemon in any mode: it gets
`LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL` + `LOCAL_OPERATOR_DESKTOP_TOKEN` +
`VITE_DISABLE_BACKEND_MANAGER=true` (the existing attach seam). The token only
ever travels in a child's environment: never argv, stdout, the receipt or a file
the harness writes.

- **`--backend isolated` (the default).** The harness starts its own
  `lop serve --host 127.0.0.1 --port <free port>` (never 1111) from `--lop <abs>`
  (default: `lop` on `PATH`, made absolute), with `HOME=<rig>/home`,
  `LOCAL_OPERATOR_CONFIG_DIR=<rig>/config`, `TMPDIR=<rig>/tmp`,
  `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0`,
  `GH_CONFIG_DIR=<home>/.gh` and a token it mints. Nothing of the operator's is
  read. `--seed-config <abs dir>` copies a **synthetic** config-root template in
  first - this is how an ask with a suggested command (#1902) or notifications
  with details (#1907) are staged. A template carrying credential material is
  refused; the rules are path segments derived from core's config root:
  `secrets`, `vault`, `credentials*` (also `network/credentials`), `identity*`
  (`network/identity`), `auth.db*`, `auth*.json`, `account.json`,
  `create-keys.json`, `mcp_oauth*`, anything containing `token`, `*.key`,
  `*.pem`, `.env*`, and any symlink.
- **`--backend-config-root <abs dir>`.** As isolated, but `lop serve` runs on a
  durable config root the operator prepared - a rig device joined to the mesh,
  which is how a remote (node2) session is shown. In this mode the harness:
  - refuses (exit 2, nothing spawned) if the root is `~/.local-operator` or
    inside it, if another process already runs on it (the reap sweeps every
    process on the root, so it never shares one), or if `<root>/config.yml` has
    no `network.port` or has `4097`. An unset port makes the relay advertise
    the operator's `:4097`, and peers then dial the operator's real relay -
    measured on node2 as writes to the real audit log;
  - runs the lop processes with `HOME=--backend-home` (default
    `<dirname(root)>/home`; the operator's real home is refused);
  - refuses if anything already listens on `network.port`; starts the rig's
    relay first, in the foreground: `lop network serve --port <network.port>`,
    waits for it to listen, confirms every listener on that port is the relay
    it spawned (or its children), then starts `lop serve`;
  - before launching the app, polls `GET /v1/desktop/sessions?include_peers=true`
    until `--session` is listed with `locality: "remote"` (bounded by
    `--peer-wait`, default 120 s - the first reads on node2 were empty until
    the peer row cache refreshed; the bound is a containment, not a measured
    distribution). If it never appears the run fails and captures nothing.
  - never runs `lop network init/install/start/restart`.
- **`--backend attach --backend-url http://127.0.0.1:<port>`.** Attaches to a
  running daemon. The token is read **only** from that daemon's own serve record
  (`~/.local-operator/run/serve/*.json`, or `--serve-record-dir`): the record for
  the port, with a live pid, `desktop: true` and a non-empty `claim_key`. An
  unclaimed daemon is refused - the only way to use it would be a claim, which is
  a one-way change to the operator's plane. A daemon the desktop app spawned
  publishes `claim_key: ""` (core `server/registry.py:498`) and is **BLOCKED**:
  its only token is the operator's `desktop-token` file
  (`src/main/backend/backend-service.ts:241/4391`). Check which case you are in
  without printing a secret:
  `for f in ~/.local-operator/run/serve/*.json; do jq '{pid,port,desktop,has_key:(.claim_key!="")}' "$f"; done`.
- **`--token-from-operator-profile`** (attach only, OFF by default). **Needs the
  operator's explicit approval for the run.** It reads the 0600 `desktop-token`
  from the operator's app profile straight into the app's environment; it is
  never printed, written or logged. A token in a child environment is visible to
  same-user `ps eww`, the same principal that can already read the file.

## The harness reads; it never acts

A read-role rig device can still **start a runtime on the session's owner**: on
core origin/main, `network/types.py` gives `net_session_engage` the `"view"`
capability (`:725`), the same one a read member holds. So the harness never
prompts, sends, engages or resumes anything, and that is enforced in code:

- every daemon HTTP call goes through one client (`daemonRequest`) whose
  allowlist is `GET /health` and `GET /v1/desktop/sessions` (query keys
  `include_peers`, `limit`); anything else - and any path naming prompt, send,
  engage, message(s), runs, resume, steer, wake, slash, stop, claim, turn, exec,
  history or stream - is refused before a byte is sent;
- every lop invocation is checked (`lopArgvProblem`): only `serve --host
  127.0.0.1 --port N` and `network serve --port N`.

The app itself does what any viewer does when it opens a conversation; the
receipt discloses those side effects (the opened conversation's seen marks, a
45 s presence beat on the daemon that served it).

## A PR branch, before it is released

Seams S1-S3 (the step runner and its gates) exist only in builds that contain
them. Photograph a **release build you download**; do not build on the Mac.

### Primary: download a release zip, capture it (no build, no install)

Every release ships electron-builder's signed
`local-operator-ui-<ver>-arm64.zip` and `-x64.zip` (`gh release view v<ver>
-R damianvtran/local-operator-ui` lists them). `--app-zip` extracts one into the
rig and runs it there:

```sh
OUT="$LOCAL_OPERATOR_SCRATCHPAD/proof-<ver>"
gh release download v<ver> -R damianvtran/local-operator-ui \
  --pattern 'local-operator-ui-<ver>-arm64.zip' -D "$OUT/dl"      # -x64.zip on an Intel Mac
# without gh (the repository is public):
#   mkdir -p "$OUT/dl" && curl -fL -o "$OUT/dl/local-operator-ui-<ver>-arm64.zip" \
#     https://github.com/damianvtran/local-operator-ui/releases/download/v<ver>/local-operator-ui-<ver>-arm64.zip
node scripts/mac-proof-capture.mjs --app-zip "$OUT/dl/local-operator-ui-<ver>-arm64.zip" \
  --out "$OUT" --scene library --scene notifications --theme dark,light --timeout 240
```

- Run it from **any** checkout of this repository at or after the commit that
  added `--app-zip`. The script is stdlib Node: no `node_modules`, no build, no
  `pnpm install`.
- The zip must come from a release that **contains S1-S3**: the first release
  after this harness's pull request (#1936) merged, or later. An older zip boots,
  prints `[window-mode]`, and never prints `[dev-driver-script] ARMED`; the
  harness fails it inside its 20 s startup window with `this build predates the
  step runner (S1)` instead of idling to `--timeout`.
- `--app-zip` must be an absolute path to an existing regular `.zip` file, and is
  refused together with `--app` (exit 2). It is extracted into `<rig>/app/` with
  `/usr/bin/ditto -x -k` (`unzip` off darwin, which only the Linux fake-tree
  tests use), the zip must hold exactly one top-level `.app`, and every `--app`
  guard then runs on that extracted bundle. It is never in `/Applications` and
  is removed once the reap is clean (`--keep-rig` keeps it; a run whose reap
  left a survivor keeps it too, and says so).
- The receipt labels it `kind: "release-zip"` with the zip's basename and
  sha256, the bundle version from its `Info.plist`, and on darwin the result of
  `codesign --verify --deep --strict` (recorded, never gating, never prompting).
- Give the tool call a timeout of at least `--timeout` + 60 s (here 300 s), or
  run it as a background job (see *The command*).

### Fallback: build the branch on a lightly loaded Mac

Only when no release carries the change yet **and** the Mac has headroom: a
`pnpm run pack` competes with everything else on the machine (the run that
motivated `--app-zip` saw load ~120). Build in a worktree that shares the
primary checkout's dependencies; link them only if nothing is there, and only
while the lockfiles match:

```sh
cd ~/local-operator-ui
git fetch origin <branch>
git worktree add .worktrees/<name> origin/<branch>
cd .worktrees/<name>
cmp pnpm-lock.yaml ../../pnpm-lock.yaml || { echo "lockfile differs: install in this worktree instead"; exit 8; }
if [ -e node_modules ] || [ -L node_modules ]; then echo "node_modules exists: refusing"; exit 9; fi
ln -s ../../node_modules node_modules                          # share, never reinstall
pnpm run pack          # electron-vite build + electron-builder --dir ("pnpm pack" is pnpm's own tarball command)
APP="$PWD/dist/mac-arm64/Local Operator.app"                  # dist/mac/ on an Intel Mac
node scripts/mac-proof-capture.mjs --app "$APP" --out "$LOCAL_OPERATOR_SCRATCHPAD/proof-frames" \
  --session <id> --scene conversation --theme dark,light
```

A fresh `git worktree add` has no `node_modules`, so the link is all it needs;
an existing path is refused rather than deleted. The receipt labels such a
bundle `kind: "built"` (anything outside `/Applications` is), and the frames are
evidence of that build, not of the installed app or a release.

## What a frame may claim

- `screencapture` frames (the darwin default) are labelled **`screencapture -l
  (real vibrancy, pending Mac measurement)`** until the measurement in AGENTS.md
  "Capturing the frame" lands.
  The backdrop blurred into them is whatever sat behind the inactive window on
  the operator's screen during the run; the receipt says so, and reviewers judge
  what is visible in it.
- `--capture capturepage` frames (the default elsewhere; what Linux/xvfb
  exercises) come from the app's own `capturePage()` and are labelled **no
  vibrancy claim**.
- A frame exists only after every step before it succeeded: a failed step, a
  conversation that is not `--session`, or a focused window ends the run before
  the next shutter.

## What is proven where

Proven on Linux by `scripts/mac-proof-capture.test.mjs` (fake `.app` tree that
speaks the protocol, ignores SIGTERM and re-parents a child; fake `lop` with a
relay, a daemon and a standby runtime in its own process group) and
`scripts/dev-driver-script-gate.test.mjs`: every refusal guard, the protocol
supervisor, the env/argv builder, the daemon-client and lop allowlists, the three
backend modes end to end, token confinement and the reap.

Mac-only, **pending measurement** on a real Mac:
- the Screen Recording preflight result (BLOCKED when JXA cannot call it), and
  the PNG-size-equals-bounds check at the Mac's backing scale;
- `getMediaSourceId()` agreeing with the JXA `CGWindowList` entry;
- `screencapture -x -o -l` of a non-front `inactive` window carrying real
  vibrancy, with no activation or focus change (sample the frontmost app by pid);
- the `ps -E` config-root sweep on macOS;
- a real boot of the S1 runner in the packaged app, the remote session painting,
  and the reap leaving no `Local Operator` pid carrying the rig profile.
