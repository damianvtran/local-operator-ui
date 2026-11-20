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
  --scene conversation --scene files --scene canvas --scene file-preview --scene library --scene notifications \
  --theme dark,light
```

Each `--scene` x `--theme` becomes one frame, `<scene>-<theme>.png`, plus a
`receipt.json` and the run's scratch logs in `--out/logs`. The six scenes are
presets: `conversation` (the `--session` view), `files` (the canvas's Files
view), `canvas` (the canvas's Documents view), `file-preview` (one picture from
the `--session` Files view opened in the canvas: `--preview-file`, default
`image-1.png`), `library` (the Library route) and
`notifications` (the notifications route, no detail open), plus three that
need a staged state: `asks` (the `--session` conversation with its asks drawer
open on a suggested-command ask), `notification-detail` (`/notifications/<id>`,
the details page of `--notification-id`) and `update-detail` (the same item's
details inside the `--session` conversation's drawer, Updates tab), and one
that WRITES: `download` (one Files row of a remote `--session` downloaded to the
rig; `--backend-config-root` only, see "The download scene"). `files`,
`canvas`, `file-preview`, `asks`, `update-detail` and `download` need
`--session`; see "Seeded scenes" for staging the state they photograph. `files`,
`file-preview`, `library` and `notifications` each wait for markup only their
SETTLED state renders before the shutter (run #1907 shot `notifications` before
the route repainted; 79's be9379d8 run shot `files` on "Loading session files…");
see "Scene waits: a loading state never takes a frame". The app's
step runner takes at most 64 steps, so a scene list over that is refused before
launch: split it across runs.
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
   never called). The bridged `$.CGPreflightScreenCaptureAccess` is tried first;
   where it is not a function (macOS 27) the harness declares it with
   `ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []])` and calls
   that - measured on Darwin 27.2 as `{"granted":true}`. If it is not granted,
   the run is BLOCKED and names the TCC host to grant: the nearest
   `<X>.app/Contents/MacOS/...` up the parent-pid chain (`ps -A -o
   pid=,ppid=,comm=`, C locale), else the top non-launchd process (an agent's
   renamed process title such as `Local Operator [session] id=...`): "grant
   Screen & System Audio Recording to <X> in System Settings > Privacy &
   Security". The harness never requests or changes TCC. If JXA cannot call the
   preflight by either path, the run is also BLOCKED: there is no guessing
   fallback, because every other signal (window names) answers yes for system UI
   without the permission.
   Each captured PNG must also measure the window's `CGWindowList` bounds times
   one backing scale, or the frame is refused.
3. **A backend the app only ever attaches to** (see *Backend modes*).
4. **On macOS the app is launched through LaunchServices in the background**
   (`open -g -n`, see *Focus* below); on Linux/xvfb it is exec'd directly.
   The app argv is the same either way:
   `<bundle>/Contents/MacOS/<CFBundleExecutable> --user-data-dir=<rig>/profile
   --window-mode=inactive --window-size=1380x900 --use-mock-keychain
   --open-session=<id>`, with no `--` before the switches, `cwd=<rig>`, and an
   environment built from an allowlist (`PATH`, `LANG`, `LC_ALL`, `TMPDIR`,
   `USER`, `LOGNAME`, and the display variables) - never inherited, so no
   `CMUX_*`, `LOP_*`, `LOCAL_OPERATOR_*`, `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS`
   reaches it. Scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR` and
   `LOCAL_OPERATOR_LOG_DIR` keep the app's own writes in the rig; telemetry and
   notifications are off. Under `open` that environment is the one `open`
   itself runs with, which the new instance inherits (open(1)); it is never put
   on `open`'s argv with `--env`, where `ps` would show the rig token.
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

   **The window wait (`--window-wait <s>`, default 6, max 15, `0` = none).** A
   window created to show a specific conversation - which `--open-session` asks
   for - HOLDS its first present until the renderer reports that conversation is
   up, with `CONVERSATION_PAINT_FALLBACK_MS = 3_000` after window creation as the
   bound (`holdPresentUntilConversation`, `src/main/index.ts:1252`; the constant
   at `src/main/index.ts:2347`). The readiness steps can finish inside that
   hold, and the first default-mode Mac run (installed 0.59.2) failed exactly so:
   every DOM step ok, then `the window is not visible at the shutter (... visible=false
   focused=false ...)`, 0 frames. The app has no shutter-free probe for its
   window facts and reads the step list once at launch, so the harness spends
   one bounded wait in the runner after the readiness `state` step and before the
   first scene: `waitFor` on `:not(*)` (matches nothing) with
   `timeoutMs = --window-wait`, optional, so its expected timeout reads
   `skipped (optional)`. 6 s is twice the 3 s hold bound. Nothing is shown,
   focused or activated - the app presents the window on its own schedule - and
   each SHUTTER is still refused unless `visible=true focused=false`.
   `capturepage` runs never show a window and get no wait. The receipt records
   `windowWait: {waitedMs, visibleAtShutter}` (the wait as the harness clock
   measured it, and the first SHUTTER's `visible`).

   **A timeout** - `the window is not visible at the shutter after a <n> ms
   window wait (--window-wait <s>): visible=false focused=false; ...`, exit 1 -
   means the app still had not presented its window when the wait was spent: a
   renderer that never reported and a fallback that did not fire, or a slower
   Mac. Retry once with a longer `--window-wait` (max 15); if it persists, read
   `logs/app-stdout.log` for the `[window-mode] state:` and `[window-raise]`
   lines. Never answer it with `--window-mode normal` or anything that focuses
   the window: the `focused=true` refusal is unchanged.
7. **Reap.** On macOS the LaunchServices-launched app by its pid, only while
   its start time is the one recorded at discovery (SIGTERM, then SIGKILL), then
   every process carrying the run's exact `--user-data-dir` token, then the
   sentinel; never anything selected by name. On Linux the app by exact process group, escalating to SIGKILL, then any
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
when the harness dies; under LaunchServices its launcher is launchd, so the
harness's sentinel does that job, see *Focus*) and capped at 300 s; it banners nothing; and an armed boot
skips the start-up seal repair and app-initiated update checks (S3), so a run of
the shipped bundle can never modify that bundle and no update card can enter a
frame.

## Focus: a run never takes the operator's focus

**What happened (79's run 1907b, app 0.59.2, 2026-11-20).** The app's own log:

```
13:43:11.563 › [window-raise] trigger=initial-present mode=inactive requested=inactive applied=showInactive
[window-mode] state: visible=true focused=true focusable=true size=1380x900 content=1380x900
```

`focused=` is `BrowserWindow.isFocused()`, which is `[window isKeyWindow]`, and
an app that is not active has no key window: the rig app **was the active app**,
so the operator's keystrokes could have reached it. The app's `showInactive`
path activates nothing (Electron 45 `native_window_mac.mm:448-463`); the leading
cause is the launch itself. The harness exec'd the bundle's binary directly, so
the app checked in with LaunchServices as an ordinary foreground app asking to
come forward, and macOS's cooperative activation granted that on some runs and
not on others (architect RCA, R1). A second path is a previous rig instance
handing activation to the next one as it exits (R2).

**Runs that open a conversation were blind to it.** The only focus check the
app prints is that one `[window-mode] state` line, sampled 1.5 s after the
window is created (`src/main/index.ts:1318-1326` at v0.59.2). A run that opens a
conversation holds the present until the conversation paints, so that line read
`visible=false focused=false` before the window was even shown, and nothing was
sampled afterwards. It also reads key state only: "the app is frontmost" was
never measured. The per-SHUTTER `focused=false` check only covers the shutter
instant.

**What prevents the steal now (macOS):**

- **`open -g -n -a <app> --stdout <rig>/logs/app-stdout.log --stderr
  <rig>/logs/app-stderr.log --args <app argv>`** (`scripts/mac-proof-focus.mjs`
  `buildOpenArgv`). `-g` is LaunchServices' no-front launch. `-n` is
  **mandatory**: without it `open -a` hands the request to the operator's
  running Local Operator, whose `activate` handler raises *his* window. The
  argv is checked right before the spawn (`openArgvProblem`: `-g` and `-n`
  before `--args`, an absolute `.app`, no `--env`, no token, the rig's own
  `--user-data-dir`), and a test fails if either flag is ever dropped.
- **The env is proven from the app's own lines**, not assumed: `[dev-driver]
  ARMED`, `[dev-driver-script] ARMED` and `Attached to the backend this launch
  named: http://127.0.0.1:<port>` naming the rig serve's own URL, all before the
  `[window-raise] trigger=initial-present` line (or within the 20 s startup
  window). If any is missing, or the app prints `[dev-driver] not armed`, the
  run is reaped and exits 3, `BLOCKED launch-env-not-inherited`, naming the next
  step. There is no `--env` fallback (it would put the token in `ps`); whether to
  add an explicit opt-in is a later decision.
- **The app's stdout and stderr are files**, tailed every 100 ms into the same
  line parsers (window mode, steps, SHUTTER, the env proof). The token is
  redacted from them after the reap.
- **Pid discovery:** exactly one process whose argv carries the rig's unique
  `--user-data-dir`, with no `--type=` (Electron helpers) and launchd (pid 1) as
  its parent, within 10 s; zero or several refuse the run and every process
  carrying the profile is reaped. Its pid and start time are recorded, and the
  reap goes by both.
- **The sentinel:** under LaunchServices the app's launcher is launchd, so its
  own launcher watch is off (`window-mode.ts:849-861`). A detached `/bin/sh`
  loop watches the harness pid and, if the harness dies, TERMs then KILLs the
  recorded app pid, only while its start time still matches. It exits by itself
  once the app is gone, and the reap kills it too (`launch.sentinel`,
  `reap.sentinel`).
- **The inter-run gate (exit 2):** before launch, no process may still carry a
  rig-style profile of this harness (`<root>/mac-proof-XXXXXX/profile`), and the
  frontmost app may not be one.

**What the watchdog catches (the backstop).** `lsappinfo front`, then `lsappinfo
info -only name -only pid <ASN>` when the ASN changes, every 100 ms from just
before the launch until after the reap. The tool is preflighted once: if it is
missing or its output does not parse, the run is refused (exit 2) before
anything launches. **Measured on the capture Mac (2026-11-20):** both commands
answered in 0.08 s, rc 0, with **no prompt**. The first sample whose front pid
is the rig app, one of its helpers, or any process carrying the rig's
`--user-data-dir` aborts the run, reaps it at once and exits 1 with `the rig app
became frontmost`. Six unreadable samples in a row abort it as blind.
**Matching is by pid only.** On that same Mac the frontmost app was "Local
Operator", pid 18910: the operator's own app, with no `--user-data-dir` and
`NULL` bundle id and paths in `lsappinfo`. The rig app has the same name, so a
match on name or bundle id would abort on his app, or reap it. Neither pid
discovery nor any reap selects by name either.

Every receipt (early exits and refusals after preflight included) carries
`focusEvents: []` (each entry is a rig pid frontmost, or a focused state or
SHUTTER line) and `frontmost: {tool, intervalMs, baseline, samples, unknown,
maxGapMs, transitions: [{atMs, sinceLaunchMs, asn, pid, name, rig}], stolen:
null | {atMs, sinceLaunchMs, pid, asn, helper}}`, plus `launch: {mode, open,
argv, app: {pid, start}, sentinel, envProof}`. `tool` is `null` off macOS. The
`[window-mode] state` and SHUTTER `focused=` checks are kept: they answer a
different question (key state). `maxGapMs` is recorded, not enforced: a
synchronous `screencapture` can stall the loop.

**Mac acceptance** for this change: across a back-to-back matrix (seeded and
held-present runs interleaved), no `frontmost.transitions` entry with `rig:
true`, `stolen: null` in every receipt, and `launch.envProof.verified: true` in
every run. The receipt's `limits` carries `focus-prevention-launchservices`:
`lsappinfo` is measured prompt-free, but that `open -g -n` prevents the
come-forward stays inferred until the first watched Mac run confirms it. Linux
proves the harness side (`scripts/mac-proof-capture.test.mjs`, the `focus:`
cases) against a fake `open` and `lsappinfo`; it cannot prove LaunchServices.

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
    no `network.port` or has `4097`. The harness reads exactly what core reads:
    `values:` > `network:` > `port:`, the layout `lop config edit network.port
    <n>` writes (core `config.py` reads only `values`; `settings_io.py` path
    `("network", "port")`, default 4097). A top-level `network:` block does not
    count - core ignores it and the relay would still use 4097 - and anything
    it cannot read plainly (flow style, anchors, tabs, duplicated keys, a port
    under another parent) also refuses. An unset port makes the relay advertise
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

## Seeded scenes (#1902 asks command, #1907 notification details)

An isolated backend starts on an EMPTY config root, so the asks drawer and a
notification's details page would photograph empty states. `--seed <scenario>`
stages the state instead, with no operator involvement and no write through the
daemon:

```sh
# #1902: the asks drawer, one command for the agent and one for the user
node scripts/mac-proof-capture.mjs --app-zip "$ZIP" --out "$LOCAL_OPERATOR_SCRATCHPAD/proof-1902" \
  --seed ask-command --scene asks --theme dark,light

# #1907: a long multi-paragraph notification with links and earlier revisions,
# on its page and inside the conversation drawer's Updates tab
node scripts/mac-proof-capture.mjs --app-zip "$ZIP" --out "$LOCAL_OPERATOR_SCRATCHPAD/proof-1907" \
  --seed notification-details --scene notification-detail --scene notifications \
  --scene update-detail --theme dark,light
```

- **What is written.** `scripts/mac-proof-seed.mjs` generates a synthetic config
  root from the committed spec `docs/evidence/mac-proof/seeds/<scenario>/seed.json`
  into `<rig>/seed`, just before `lop serve` starts (an ask is open only until its
  `expires_at`, now + 24 h, so nothing with a timestamp is committed). It is then
  vetted and copied exactly like a `--seed-config` template. Every file is in the
  shape core writes, each constant citing its core file:line: the session
  directory, `asks.jsonl` plus the derived `asks/<sid>.json` index (serve never
  rebuilds the index, and `GET /v1/desktop/asks` reads only it), and
  `notifications.db` built from core's `_SCHEMA` verbatim (`user_version` 3,
  journal mode DELETE, closed, no sidecars). `notification-details` needs
  `node:sqlite` (Node >= 22.13, as `.nvmrc` pins) and says so when it is missing.
- **Defaults.** `--session` defaults to the seed's conversation (`fa1902000001`,
  `fa1907000001`) and `--notification-id` to `n_macproofdetailaa`.
- **BLOCKED unless read back.** After `/health`, the harness reads the seeded rows
  from the real daemon (`GET /v1/desktop/asks` must list the open ask with both
  `command`/`command_target` pairs; `GET /v1/desktop/notifications/<id>` must return
  the item and its revision history). If they do not come back within 10 s the run
  is BLOCKED (exit 3) before the app launches, so a frame of an empty state can
  never pass as proof. The receipt records `seed.files` and `seed.check`.
- **The scenes' own waits.** `asks` requires the drawer (`[data-lo-ask-surfaces]`)
  and the command block inside it (`[data-ask-command]`); it presses the composer
  chip only while it still reads minimized, because the open policy may already
  have opened the drawer and the chip toggles. `notification-detail` requires
  `[data-notification-detail="<id>"]`, its title, and the read face: the
  detail's toggle showing its read icon (lucide `svg.lucide-circle`; the toggle,
  notification-detail.tsx:351-378 at v0.59.2, carries no read-state attribute,
  so its icon is the only selector-visible proxy) and no list row for the item
  still `data-notification-unread` (notification-row.tsx:203, the row's own
  state; the Unread count derives from those rows).
  `update-detail` opens the drawer from the panel rail's ask item
  (`[data-panel-rail-item="ask"]`, pressed only while `aria-pressed="false"`;
  the composer chip exists only when the conversation has asks, and this seed
  has none), selects the Updates tab only while it is not selected, switches the
  drawer to its **Read** view (the radio `[data-drawer-read-view="read"]`,
  pressed only while `aria-checked="false"`, drawer-updates.tsx:1033-1064; the
  drawer opens on Unread, :301), requires the item's row in that list by the
  row's own state attribute (`[data-drawer-view-list="read"]
  [data-drawer-update="<id>"]:not([data-unread])`, :952/:1119/:1120), presses
  its `[data-row-action="details"]`, and requires `[data-drawer-detail="<id>"]`
  with its title and the same read icon. The Updates tab's own count badge comes
  from a separate count query and has no attribute to wait on.
- **The detail's read face is SEEDED, not driven.** `n_macproofdetailaa` is
  seeded `read: true`, beside three unread items (`n_macprooffill*`) and one more
  read one, so a run shows both faces without the app writing anything. The live
  unread→read flip cannot be exercised in an unfocused window:
  `notifications.read` is a foreground-receipt op refused outside focus
  (src/main/desktop-ipc.ts:95-101 `FOREGROUND_RECEIPT_OPS`, refused at :166-185
  on `!isFocused()`, v0.59.2), and this harness only ever runs an unfocused
  window. Opening an unread item therefore flips it optimistically and rolls it
  back, so the read icon never arrives. 79's run (main 34a08e97, app 0.59.2)
  failed that way: "Step 16 waitFor `[data-drawer-detail="n_macproofdetailaa"]
  [data-notification-toggle-read] svg.lucide-circle` timed out", and #1907's
  "Unread 3 in dark, 4 in light" fits the same flip and rollback. It was not
  icon drift: lucide-react is 0.507.0 at v0.59.2 and on main. The frame depicts
  the seeded state; it makes no claim that the app marked the item read. Any
  `--notification-id` either scene opens must already be read, or the run fails
  at the row (drawer) or the read icon (page). The receipt records
  `seed.items` (`{id, read}` per item) and lists the `detail-read-seeded`
  limit, and the daemon read-back BLOCKS the run unless the detail item comes
  back with the seeded `read`.
- **Generate a template by hand** (to inspect it, or for `--seed-config`):
  `node scripts/mac-proof-seed.mjs --scenario ask-command --out <abs empty dir>`.
  `--out` is refused when it is, sits inside, or contains your own config root
  (`~/.local-operator`, the app's userData dirs, and `$LOCAL_OPERATOR_CONFIG_DIR`
  when set), compared by realpath; an agent scratchpad under
  `~/.local-operator/sessions/<id>/scratchpad` is the one carve-out.

## The download scene: the harness's one write

79's real-path plan needs proof that ONE file a peer owns downloads through the
desktop app, on the Mac, without touching the operator's app, profile or
`~/Downloads`. Every other scene only looks; `--scene download` presses the Files
row's **Download to this device** once.

**Who writes, and where.** The menu entry (`[data-remote-action="download"]`,
`remote-file-actions-menu.tsx` at v0.59.2) sends the desktop op
`sessions.files.download` = **`POST /v1/desktop/sessions/<sid>/files/<fid>/download`**
(`desktop-contract.ts`) from the **app**, with the app's own token, to the rig's
`lop serve`. The **backend** lands the file (core
`server/routes/desktop_session_files.py` `remote_file_download`,
`server/utils/remote_session_files.py` `downloads_dir`): `Path.home()/Downloads`
when that is a directory, else `<config>/downloads`, never overwriting (an
identical file is reused with `created: false`, a different one goes to
`name (1).ext` ... `name (99).ext`). The harness's own daemon client is not on
that path: its allowlist gains **no** route and still refuses that POST (a
negative-control case and a test pin it).

**What the write can reach.** In `--backend-config-root` mode the lop processes
run with `HOME=--backend-home` and `LOCAL_OPERATOR_CONFIG_DIR=--backend-config-root`,
so the only possible destinations are `<backend-home>/Downloads/<name>` (or its
`(n)` variant) and `<config-root>/downloads/<name>`. Electron's
`app.getPath('downloads')` - the operator's real `~/Downloads` whatever HOME the
rig sets - is reached only by **Save as...** (`guardDownloads`,
`window-guards-electron.ts`), so the harness never presses Save as or Copy image:
the built step list is checked before launch against an exact **allowlist**: a
download run may press only the collapsed Files group header, its own row
trigger and the enabled Download entry (byte-for-byte; any other press,
including another scene's, refuses the run),
and any other run may not press a remote action or Save as at all - except
`file-preview`'s byte-exact Show in canvas entry, a read into the canvas.

```sh
# On the Mac: the rig device already joined to the mesh (see --backend-config-root),
# the fixture owner's manifest copied next to the run.
node scripts/mac-proof-capture.mjs --app-zip "$ZIP" --out "$LOCAL_OPERATOR_SCRATCHPAD/proof-download" \
  --backend-config-root ~/lop-rig/config --session ce618964c88e \
  --scene download --theme dark \
  --manifest "$LOCAL_OPERATOR_SCRATCHPAD/MAC-PROOF-MANIFEST-v0.105.3.json" \
  --download-file notes.md --timeout 240
shasum -a 256 ~/lop-rig/home/Downloads/notes.md      # the receipt's destination
```

The steps (shipped verbs only: `navigate`, `openCanvas`, `waitFor`, `press`): the
Files view reached exactly as `file-preview` reaches it (the same
`filesRowReachSteps`: the settled-data wait `FILES_READY`, then the **optional**
press of a collapsed group header - see "Why it expands a group first" below;
79's download run at main 3673e88232 failed on the same 1043-file session with
`notes.md` inside the collapsed Working files group); the row's `⋯` trigger
(`button[aria-haspopup="menu"]` inside an **index** row of the Files scroller,
`INDEX_ROW`, whose `aria-label` is
**exactly** "Actions for <name>" in any shipped locale, read from
`src/i18n/catalogues/*/ui.common.actions.json` - never a substring, so
`old-notes.md` is not `notes.md`'s row, and never an attachment row of the same
name, the person's upload); the run **refuses** when more than one index
row carries that label (a `gone` wait on a two-rows selector); the trigger is
pressed only while `aria-expanded="false"`; the **enabled** Download entry,
required and then pressed; the outcome toast (`[data-sonner-toast]`
success/error/info, 60 s: twice the app's 30 s re-POST backoff, not a measured
distribution - the receipt records the measured `toastLatency`), then a required
**success** toast; then the shutter `download-<theme>`. As for `file-preview`,
the row must fall on the Files view's first screen once its group is expanded
(rows are virtualised); otherwise the row wait fails the run.

Why the header press is safe in a download run: it matches only a `<button>`
that is the direct child of a group's `<h3>` inside the Files scroller, while
collapsed. Its click only toggles the group (view state; no daemon call, no file
I/O), it holds no row or menu, and every file action (Save as, Copy image,
Download) is a menu item that Radix portals to `<body>`, outside the scroller.
The allowlist admits that exact string, byte-for-byte, not a pattern.

| Refused (exit 2, nothing spawned) | Why |
|---|---|
| `--backend attach` | that daemon runs as the operator: the file would land in the real `~/Downloads` |
| `--backend isolated` (default) | no peer, and the route lands only a peer's row |
| more than one `--theme` | the backend reuses the identical file (`created: false`), so a second pass shows the app's "already downloaded" toast, not a download |
| `--download-file` with `/`, `\`, `"`, a control character, `.`/`..`, or given twice | one plain file name per run |
| `--download-file`/`--manifest` without `--scene download`; no `--session` | |
| `--manifest` not absolute, absent, not a regular file, not JSON, no `files` list, no (or a repeated) entry for the file, an entry without a 64-hex `sha256` and integer `bytes` | the comparison must be machine-checkable |
| `<backend-home>/Downloads` or `<config-root>/downloads` a symlink, resolving outside its root, or inside the operator's `~/Downloads` | the write must land in the rig, and somewhere the stray check can see |
| `<name>` already in either destination | the backend would reuse it and land nothing new; move it out first |
| a download run pressing anything but its exact allowlist; any other run pressing a remote action, Save as or Copy image (case-insensitive), file-preview's exact Show in canvas excepted | Save as writes through Electron to the real `~/Downloads` |
| `MAC_PROOF_TEST_OPERATOR_DOWNLOADS` set outside `node --test`, or not absolute | a test-only seam (below) |
| either rig destination unreadable before the run | a landing could not be told from what was there |

| Fails the run (exit 1) | |
|---|---|
| no enabled Download entry on the row (a local row, an unreadable row, only Save as) | the error says the harness never falls back to Save as |
| an error/info toast instead of success | |
| more than one Files row labelled for `<name>` | the harness refuses to guess which row to download |
| not exactly ONE new file, of any name, across both rig destinations after the success toast, or that one not named `<name>` (or its `(n)` variant); re-checked after the reap | |
| the landed bytes/sha256 differ from the manifest entry | |
| with `--check-operator-downloads` only: **any** new name in the operator's real `~/Downloads` between run start (before the backend or the app starts) and the end (after the reap) | names only; another process saving a file meanwhile also fails it, the safe direction |

**Containment is proven by destination, not by a listing.** The proof is
positive: exactly one new `<name>` landed, as a regular file physically inside
the rig (`destination` + `insideRig` in the receipt), from a backend whose HOME
and config root are the rig's. The comparison of the operator's real
`~/Downloads` is a second, negative check and is **OPT-IN**
(`--check-operator-downloads`, default **off**): on macOS `~/Downloads` is
TCC-protected, and listing it from the hosting app (Terminal, an agent host) can
raise a "Files and Folders" access prompt on the operator's own screen, before
the app starts - the exact class of prompt this harness promises never to raise
on an unattended run. Without the flag nothing of `~/Downloads` is listed and
the receipt records `operatorDownloads: {checked: false}`, so the missing check
is visible rather than implied. With it, the folder (read from the passwd home,
`os.userInfo().homedir`, never `$HOME`) is listed before and after, and one that
cannot be listed is **BLOCKED (exit 3)** with the host to grant, never a pass.
With the flag off the harness touches nothing in `~/Downloads` at all - not
even a realpath: the rig-inside-`~/Downloads` refusal compares against
`<realpath(home)>/Downloads` as spelled, so a symlinked `~/Downloads` is not
followed, and the receipt's `limits` says containment is destination-based.

**Test-only seam.** `MAC_PROOF_TEST_OPERATOR_DOWNLOADS=<abs dir>` makes the
flag-on listing read that folder instead, so the test suite never lists the
real `~/Downloads` of whoever runs it. It is honoured only under `node --test`
(`NODE_TEST_CONTEXT`), refused otherwise; the rig-inside-`~/Downloads` refusal
still compares against the real default, and the receipt records the listed
`path` with `injected: true`.

**The receipt** gains `download`: `route` (the template above, sent by the app),
`file`, `destinations` (`[{dir, exists}]`, the dry-run plan's shape),
`destination` (the landed path), `newInRig` (every new path in the rig, recorded
after the reap on every path, abort and signal included), `insideRig`, `bytes`,
`sha256`, `manifest` (`{path, entry: {filename, bytes, sha256}}` or `null`),
`compared` (`match`, `mismatch`, or `not compared (no --manifest)`),
`operatorDownloads` (`{checked: false}` by default; with the flag `{checked:
true, path, before, after, newEntries}` - counts and the new names only),
`toastLatency` (`{step, waitedMs, boundMs, source}`: the press-to-outcome-toast
wait the renderer measured), `limits` (`[{id, text}]`: what this run cannot
prove - `files-attachments-only` and `preview-first-screen` (the Files wait and
first-screen row it shares with `file-preview`), `toast-latency-unmeasured`, `config-root-only`,
`containment-destination-based` when the stray check is off,
`fixture-proven-actions`) and `verdict` (`PASS`/`FAIL`). Without `--manifest` the run checks
landing and containment only and says so; the Mac proof passes `--manifest`.

**Negative control:** `--negative-control` includes the download refusals
(attach, isolated, a directory as `--manifest`, a Save as press, the harness
client's POST to the download route).

## The harness reads; it never acts

(`--scene download` is the one exception, and the write is the app's, through
the backend, into the rig: see above.)

A read-role rig device can still **start a runtime on the session's owner**: on
core origin/main, `network/types.py` gives `net_session_engage` the `"view"`
capability (`:725`), the same one a read member holds. So the harness never
prompts, sends, engages or resumes anything, and that is enforced in code:

- every daemon HTTP call goes through one client (`daemonRequest`) whose
  allowlist is `GET /health`, `GET /v1/desktop/sessions` (query keys
  `include_peers`, `limit`), the two `--seed` read-backs `GET
  /v1/desktop/asks` and `GET /v1/desktop/notifications/<n_ + 16 of a-z2-7>`
  (one path segment, no query), and the three provenance read-backs `GET
  /v1/desktop/library/assets` (keys `scope`, `limit`), `GET
  /v1/desktop/library/assets/<la_ + 16 hex>` (no query) and `GET
  /v1/desktop/sessions/<12 hex>/files` (keys `q`, `limit`) - all reads; each
  `<id>` is exactly one path segment; a path holding a control character is refused
  outright; anything else - and any path naming prompt, send,
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
  sha256 (hashed again right before extraction; a zip that changed since
  preflight is refused), the bundle version from its `Info.plist`, and on darwin
  the result of `codesign --verify --deep --strict` (recorded, never gating,
  never prompting; bounded at 60 s, with `durationMs` and `timedOut` recorded).
- The bundle's `Info.plist` and executable must resolve inside the extracted
  `.app`: a zip whose `Contents` symlinks elsewhere is refused, so the receipt
  always names the binary that ran. So is any symlink anywhere in the extracted
  tree that resolves outside it, or does not resolve (`app.asar` and
  `Frameworks/*` are loaded too); the real release's 20 relative framework and
  python-runtime links all stay inside.
- The zip is LISTED before anything is extracted: an entry with an absolute
  path or a `..` segment refuses it (`ditto` and `unzip` do not treat those
  alike), and so does a listed unpacked total over 2 GiB (v0.57.3 arm64 unpacks
  to 427,528,786 B).
- **Download with `gh` or curl, never a browser.** A browser download carries
  `com.apple.quarantine`, `ditto` copies it onto the bundle, and launching it
  would show Gatekeeper's first-open dialog. A quarantined zip or bundle is
  refused (exit 2) with the `xattr -d` command to clear it yourself.
- Give the tool call a timeout of at least `--timeout` + 60 s (here 300 s), or
  run it as a background job (see *The command*).

### Fallback: build the branch on a lightly loaded Mac

Only when no release carries the change yet **and** the Mac has headroom: a
`pnpm run pack` competes with everything else on the machine (the run that
motivated `--app-zip` saw load ~120). Build in a worktree that shares the
primary checkout's dependencies; link them only if nothing is there, and only
while the lockfiles match:

```sh
# One subshell, so `exit 8` / `exit 9` end the recipe, never the shell it was
# pasted into (review r3 R3-6, QA r3 Q3-4).
(
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
)
```

A fresh `git worktree add` has no `node_modules`, so the link is all it needs;
an existing path is refused rather than deleted. The receipt labels such a
bundle `kind: "built"` (anything outside `/Applications` is), and the frames are
evidence of that build, not of the installed app or a release.

## Scene waits: a loading state never takes a frame

Every scene's last step before its shutter is a `waitFor` on markup that exists
only in the scene's settled state, from the shipped v0.59.2 verbs and markup
(the app under capture may be an older release than this branch). A `waitFor`
that times out fails the run (exit 1) and no frame is written under the scene's
name: a timeout means "it never settled", never "photograph what is there".

| Scene | Waits for (any of) | Never passes on |
|---|---|---|
| `files` | a row of the session's file index (not an attachment row); the empty state (heading + its detail line); an explicit error or unsupported state (heading + its explanation or Retry/Continue) | "Loading session files…" or "Building the file index…" standing alone, an Attachments section still captioned "Loading session files…", attachment rows alone |
| `file-preview` | the `files` wait, then (optionally) a press on a collapsed group header to expand it, then the menu of the index row named exactly `<name>` → **Show in canvas**, then `<img alt="<name>">` inside the canvas | an attachment row, a row whose name only starts with `<name>` (`image-1.png.bak`), a disabled Show-in-canvas entry (above the relay's ceiling), the lightbox, the canvas's "Opening…" state |
| `library` | the results section with `aria-busy="false"` (cards, the empty state or the listing error) | the skeleton, a refetch in flight, the "indexing" line in the header |
| `notifications` | the list or its empty state, with no detail pane | the skeleton, the previous scene's detail |

Why `file-preview` goes through the row's menu: a picture in the grouped Images
grid is a tile, and a tile's own click opens the lightbox, not the canvas. The
row must be on the Files view's first screen (rows are virtualised).

Why it expands a group first (79's run, main 34a08e97, app 0.59.2: "step 10
press found no file-row with title image-1.png"): that session lists 1043 files,
an expanded Highlights group of one row and a **collapsed** "Working files,
1,042" group, and `image-1.png` sat in the collapsed one, whose rows v0.59.2
never renders. Once a session has a highlighted file, every other file sits
under Working files, which starts closed (finder-layout.ts:18, :224, :227). The
search field would open every group, but no v0.59.2 script verb can type into a
field (dev-driver-script.ts:62-71), so the scene presses the group's header
instead. The header is a `<button>` directly inside the section's `<h3>`, and it
is matched by its own state: `aria-expanded="false"` and not
`aria-disabled="true"` (finder-files-view.tsx:945, :984-:986), never by its
localized label or its chevron icon. The press is optional, because a session
with no highlights has no such group, and a run's second theme finds it already
open. In the harness's fresh profile Working files is the only group that can
start collapsed. After the expand, the row must still be on the first screen
of the list. The exact
selectors and the v0.59.2 file:line behind each are in `scripts/mac-proof-capture.mjs`
(`FILES_READY`, `SCENE_READY`, `filePreviewSceneSteps`), and
`scripts/mac-proof-capture.test.mjs` freezes those lines and re-reads them from
the tag in a full checkout.

Attachment rows and index rows share `data-tour-tag="file-row"` and the
Attachments section has no attribute of its own, so index rows are told apart by
their id: every attachment row's `data-file-id` starts `attachment:`, no index
row's does. A session whose index is settled empty but which holds attachments
therefore shows nothing the wait accepts: the run fails rather than photograph it.

Gaps, stated rather than papered over (the receipt lists them too, `limits`):

- **Paging.** While a file index is still paging with rows already on screen,
  the count line above them appends " · Loading session files…" as bare text no
  v0.59.2 attribute exposes. The rows in that frame are real; the suffix can
  still be visible.
- **Decode.** The canvas `<img>` exists as soon as its URL is set, before the
  browser has decoded it; nothing in v0.59.2's markup marks the decode, so a
  `file-preview` frame can catch a picture not yet painted.
- **Two headings that are not alone.** "Building the file index…" gets a
  Continue button after 60 building polls (~3.7 min), and "Loading session
  files…" gets a Clear button while a search or kind filter is active; either
  would pass the wait. The harness reaches neither: its profile is fresh (no
  filter) and the wait gives up at 20 s.
- **One row of that name.** The shipped verbs cannot count matches, so the
  provenance read-back fails the run when the index holds two or more rows
  named `--preview-file`.
- **No search.** The Files search field is never used (no shipped verb types),
  so a row deep inside a large group is reachable only when it falls on the
  first screen after its group is expanded (`preview-no-search`,
  `preview-first-screen`).

## Provenance: the frame shows a PEER's data

A Library or file-preview frame of local data looks the same as one of a peer's,
so after the frames, while the rig daemon is still up, the harness reads the data
behind them back (allowlisted GETs, below) and **fails the run (exit 1)** when it
is not remote. The receipt keeps what it judged:

- `libraryProvenance: {assetId, remote, localPath, source, pass}` (with the
  `library` scene): the first row of the desktop's own listing (`scope=final`),
  read back by id. `remote` and `localPath` are booleans (the row has a remote
  block / a `ref.path`). Passes only when `remote: true` and `localPath: false` -
  a row only a peer references. `source` is the row's `origin` (core has no
  field named `source`).
- `imagePreview: {assetId, remote, matchingRows, originDeviceKnown, sessionOnRig,
  pass}` (with the `file-preview` scene): the row of `--session`'s file index
  named exactly `--preview-file`. Passes only when exactly one row has that name,
  the daemon stamped it `remote: true`, AND the session is absent from the rig's
  own `<config>/sessions` (a session the rig holds could have been served from
  this disk). Attach mode has no rig config root, so it cannot pass.

A failing check adds `problem` naming why. Receipts get attached to PRs in a
public repository, so neither check copies the peer's device id or name (only
`originDeviceKnown: true/false`) nor a local path (only `localPath: true/false`),
not even in `problem`.

Every receipt also carries `limits: [{id, text}]`, the known measurement limits
of the scenes it ran (`MEASUREMENT_LIMITS` in the script): the paging caption,
attachments-only sessions, the first-screen row, no Files search, no
image-decode wait, the detail scenes' seeded read face, and scene-wait selectors
proven on fixtures rather than in Chromium.

## What a frame may claim

- `screencapture` frames (the darwin default) are labelled **`screencapture -l
  (real vibrancy, pending Mac measurement)`** until the measurement in AGENTS.md
  "Capturing the frame" lands.
  The backdrop blurred into them is whatever sat behind the inactive window on
  the operator's screen during the run; the receipt says so, and reviewers judge
  what is visible in it.
- `--capture capturepage` frames (the default elsewhere; what Linux/xvfb
  exercises) come from the app's own `capturePage()` and are labelled **no
  vibrancy claim; RGBA with translucent glass; do not judge contrast from this
  mode** (on the run's `capture` and every frame's `method`). The bytes are kept
  as captured: glass regions keep their alpha, so a viewer composites them over
  white and dark frames look mid-grey - contrast read off them is falsely low.
- Two frames of **different scenes** with the same sha256 fail the run (exit 1),
  naming both: one of them is a stale frame (run #1907's
  `notifications-light.png` was byte-identical to `notification-detail-light.png`,
  sha256 `cbbbcdc5...`). One scene's two themes are not compared.
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
- the Screen Recording preflight result (BLOCKED when JXA cannot call it; the
  `ObjC.bindFunction` path answered `{"granted":true}` on Darwin 27.2, measured
  standalone, not yet through a full screencapture run), and the
  PNG-size-equals-bounds check at the Mac's backing scale;
- the `files`/`file-preview`/`library`/`notifications`/`update-detail` waits
  against the installed app's real markup (the selectors are read from the
  v0.59.2 source and proven on jsdom fixtures shaped like it, not in Chromium),
  and the provenance read-backs against a real peer's rows;
- `getMediaSourceId()` agreeing with the JXA `CGWindowList` entry;
- `screencapture -x -o -l` of a non-front `inactive` window carrying real
  vibrancy, with no activation or focus change (the frontmost watchdog samples
  it by pid on every run now);
- the LaunchServices launch: `open -g -n` never bringing the rig app forward,
  the env inherited through `open` (the env proof BLOCKs if not), pid discovery
  under launchd, and the sentinel (see *Focus*);
- the `ps -E` config-root sweep on macOS;
- a real boot of the S1 runner in the packaged app, the remote session painting,
  and the reap leaving no `Local Operator` pid carrying the rig profile;
- the `download` scene against the installed app's real Files row and menu (the
  selectors are read from the v0.59.2 source; Linux proves the harness side
  against a fake app whose press sends the same POST to a fake backend that
  lands like core), whether the owner's side needs an in-app Admit (then the
  leg is BLOCKED, not worked around), and - only for a run that passes
  `--check-operator-downloads` - whether listing `~/Downloads` raises a TCC
  prompt for the run's host.
