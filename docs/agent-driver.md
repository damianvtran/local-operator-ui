# Driving the app's renderer from an agent run

An agent could read this app's JSX and could not see it run. The `browser` tool
drives the operator's own browser and cannot enter an Electron renderer, and
loading the renderer under a bare Vite server dies immediately at
`Cannot read properties of undefined (reading 'ipcRenderer')` because `App`
assumes its preload bridge (`src/renderer/src/app.tsx:102`). Two review rounds
followed from that: a UX round for a browser-chrome change was recorded as
blocked because nobody could walk the flow, and a design round could only argue
from the source.

This is the supported way through, and it is deliberately built out of the app's
own mechanisms:

- the **built app**, launched by its own Electron and driven in the documented
  `headless` window mode (`src/main/window-mode.ts`);
- an **opt-in dev-driver bridge** (`src/main/dev-driver.ts`,
  `src/preload/dev-driver.ts`, `src/renderer/src/dev-driver/install.ts`) whose
  verbs are the app's own code paths — stores, the hash router, DOM controls;
- **`webContents.capturePage()`** for the pixels, so every frame is the app
  photographing itself.

No browser engine is installed or scripted for any of this: no Playwright, no
Puppeteer, no downloaded Chromium, and no macOS `screencapture` (which
photographs the frontmost window and would require exactly the focus theft the
window modes exist to remove).

## The commands

```bash
pnpm build                                          # the harness drives the BUILT app
node scripts/renderer-driver.mjs --scene states --out /tmp/frames
node scripts/renderer-driver.mjs --gate-check       # proves the gate fails closed
```

`pnpm app:driver` and `pnpm app:driver:gate-check` are the same two commands.
`--scene new-chat` drives the app-wide `⌘N` with a real CDP key chord
(`Input.dispatchKeyEvent`). It asserts whichever claim the run is in: with
`--backend`, the feature — a fresh draft staged and the app on the chat route,
plus the two presses that are deliberately not it (`⌘⇧N`, a bare `n`); without,
the gate — the same press changing nothing, because the shortcut takes the New
chat row's own `session_catalogue` gate and a driver run has no backend. `--scene states` (the default)
writes a before/after pair of one screen plus a
real control press; `--scene none` boots and arms the driver without running a
scene. `--window-size WxH` sets the window (default 1380x900, the app's own
default). The scratch tree is kept and its path printed; `--clean` removes it,
`--out <dir>` puts frames somewhere you choose.

**`--backend <url>` points the app at a live, ISOLATED backend this run owns.**
Absent (the default) the app is aimed at a port the script verified dead, so a
scene captures an app that cannot reach a backend and every frame is publishable
by construction. Set, the app's own transport uses that backend instead, which is
what a surface gated on a backend ANSWER needs — a capability-gated row cannot be
driven at all while the capability is unreachable. The bearer is read from
`LOCAL_OPERATOR_DESKTOP_TOKEN` in the script's environment, never from argv; the
run refuses to start without it. **The renderer must have been built against the
same URL** (`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> pnpm build`): the
renderer's copy of that address is inlined at build time, so a tree built for the
default would leave the renderer talking to the operator's own backend while main
talked to the run's. The run asserts which URL the renderer was built with and
fails by name if it is not the one `--backend` named.

**The run refuses before its first boot if the tree is not on the Electron this
branch pins** (`package.json` `optionalDependencies.electron`, the version
`pnpm install --frozen-lockfile` gives and `build.electronVersion` moves with).
It prints `[refusing] this tree is not on the pinned runtime …` and exits 1 with
nothing booted and no frame written, so a worktree inheriting a stale shared
`node_modules` cannot populate a frames directory at all — which is what makes
the pin worth stating: a committed frame is only reproducible on the runtime that
produced it (a 35.x build renders this window as a 1380x872 viewport against
44.3.0's 1380x868, and every pixel hash differs). With `--keep` the scratch tree
is named rather than removed; otherwise the refusal removes the tree it had just
created, since nothing has run in it.

The frames below came from exactly that command —
`docs/evidence/renderer-driver/`:

| Frame | Surface |
| --- | --- |
| `chat-dark.png` | `/chat`, `localOperatorDark` |
| `chat-light.png` | `/chat`, `localOperatorLight` — the same screen, same size |

## The gate: off unless the launch asked for it

Arming needs **both** `LOCAL_OPERATOR_UI_DEV_DRIVER=1` (or `true`) and an
absolute `LOCAL_OPERATOR_UI_DEV_DRIVER_OUT` frames directory, and the launch must
not be in `normal` window mode. Anything else is off, and a value that was set
and not understood is off *loudly*: `LOCAL_OPERATOR_UI_DEV_DRIVER=yes` prints a
`[dev-driver] not armed: ...` line naming the accepted values rather than looking
like a harness bug.

Both are read from the environment the process was **launched** with, and that is
a narrower thing than `process.env`. `src/main/backend/config.ts` applies a
`.env` from the app's working directory with dotenv `override: true`, so from
that line onward `process.env` is the launch plus that file, and the file wins;
the launch facts (this opt-in, and `LOCAL_OPERATOR_UI_WINDOW_MODE` with it) are
resolved from the snapshot taken before the fold. So a `.env` in the checkout
**cannot** arm the driver, cannot choose its frames directory, and cannot
override an explicit `LOCAL_OPERATOR_UI_DEV_DRIVER=0` — which matters because a
`.env` is exactly where an agent reaching for "an environment variable" would put
one, and a control surface a config file can switch on is not opt-in.

Off means the process is indistinguishable from the app as it was:

- main registers no `dev-driver-*` channel at all, so a call is refused by
  Electron itself (`No handler registered for 'dev-driver-capture'`);
- the window carries no `additionalArguments` entry, so the preload exposes no
  `window.__loDevDriver` — not a disabled object, nothing;
- the renderer's install module returns immediately.

`node scripts/renderer-driver.mjs --gate-check` measures that on four real boots
and fails the run if any of it is untrue. Three of them must be inert, in every
respect the list above names — the plain launch, one asked to arm by a `.env` in
its own working directory, and that same file asking while the environment says
`=0` — and the armed launch must have the bridge, write a real PNG through it,
and print the banner. `scripts/dev-driver-gate.test.mjs` pins the same decision
in-process (it is in `pnpm test:desktop`), because the module imports nothing
from Electron and can be bundled in a test.

Two mistakes are recorded here because they are the two ways this gate fails:

- **A `sendSync` handshake deadlocks an unarmed launch.** The first version had
  the preload call `ipcRenderer.sendSync("dev-driver-handshake")`, and a
  `sendSync` to a channel with no listener never answers: the normal launch
  blocked inside its preload, the window never painted (the page target was
  still `index.html` nine seconds later and CDP answered nothing), and the log
  carried `called ipcRenderer.sendSync() with 'dev-driver-handshake' channel
  without listeners`. The gate now travels as an `additionalArguments` entry,
  which is synchronous, cannot be forged from outside the process, and does not
  block. `--gate-check` asserts the paint first for that reason.
- **Do not share one `--user-data-dir` between two boots.** The app takes a
  single-instance lock **per profile**, so two boots sharing one profile collide:
  the second prints "Another instance is already running" and exits without a
  window — which reads exactly like a broken driver (that is what the first
  two-boot run of this harness did, one profile directory for both). Two boots on
  *different* profiles do coexist — a peer session measured that, on different
  `HOME`/config as well as on the same config — so the requirement is one profile
  per launch, which is what the harness does, and not serialisation of runs.

## Isolation: what the run cannot reach

A driver run happens on the operator's desktop, next to his real app. Every path
that could reach his state is redirected, and the run prints all of them:

- `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` are scratch. The config dir alone is
  not enough: caches and hardcoded home roots follow `HOME`, and this repository
  has already written 612 rows into the operator's live analytics database from a
  run somebody believed was sandboxed.
- `--user-data-dir` is scratch **per launch**, so the Electron profile (the
  localStorage the UI preferences persist into) cannot see or touch the real one.
- `LOCAL_OPERATOR_LOG_DIR` is scratch. The app's own log directory is the user's
  real home — Electron's `home` is the OS account's home, and neither the scratch
  `HOME` nor `--user-data-dir` redirects it — so without the app's own override
  every run appended its lines to the operator's
  `~/Library/Application Support/Local Operator/logs/*.log`. The harness sets the
  override and asserts, from the `Log path: …` line the app writes at logger
  init, that the app resolved it. The app resolves it from the pre-dotenv launch
  snapshot (`src/main/backend/launch-env.ts`), so the scratch cwd `.env` in the
  next bullet cannot move it either — a `--gate-check` boot names its own log
  directory in that file and the run asserts the app logged into this run's tree
  instead.
- The app's **cwd is outside the checkout**, and the scratch cwd holds a `.env`
  with `VITE_LOCAL_OPERATOR_API_URL` pointing at a port the script picked and
  verified to be dead — or, under `--backend`, at the backend this run started.
  `src/main/backend/config.ts` loads `.env` from `process.cwd()` with dotenv
  `override: true`, so a repository `.env` cannot win and the run has no reachable
  backend. That is the difference between a run that shows a disconnected app and
  one that writes into the operator's backend — and it is why every frame can be
  pasted into a PR.
- The run asserts, with `lsof` on the app's own pid, that the app holds **no TCP
  connection to the URL the renderer was built with** (`VITE_LOCAL_OPERATOR_API_URL`
  is inlined into the renderer bundle, and a few renderer-direct features —
  attachments, the canvas edit API, the updates panel — would use it). The probe
  says "unavailable" rather than "no connections" if `lsof` is missing. Under
  `--backend` that URL IS the run's own backend, so the two halves are asked
  separately instead: the app holds a connection to the run's backend, and holds
  none to `http://localhost:1111`, the address the operator's own backend listens
  on and the one a careless build would leave inlined.
- `CMUX_*` and `LOP_*` are stripped from the child environment: an inherited
  workspace id has already renamed the operator's real cmux workspaces from a test
  run in this repository.
- Nothing raises the window: `headless` is never shown, and the run asserts
  `visible=false`, `focused=false` from main before it captures anything.

## The app's lifecycle: one boot, one process, stopped by pid

A run boots the app several times (four in `--gate-check`) and each of those apps
is a real Electron process on the operator's desktop, so how it is stopped is
part of what this harness has to get right:

- Each launch spawns the **Electron binary itself** (`require("electron")`,
  the same resolution `bin/local-operator-ui.js` uses) and not
  `node_modules/.bin/electron`. That shim spawns the app as *its* child, so a pid
  taken from it is the shim's — the teardown then signals a process that has
  already exited and the app is re-parented to launchd, still running, still
  holding the profile `--clean` is about to delete. Measured before the change: a
  `--gate-check --clean` run printed "scratch removed" with all four of its apps
  alive under `ppid 1`, one still answering on its debugging port.
- Teardown is **SIGTERM, then SIGKILL, both to that same app pid**, and both
  wait for the exit. Signals are never pattern-matched (`pkill`, `pgrep -f`): the
  operator's own app matches any pattern wide enough to find a headless one, and a
  sibling session's pattern-derived kill here matched eleven orphaned apps from
  runs that had already finished.
- Every boot is registered before anything can throw, and a reaper stops all of
  them on `SIGINT`, on `SIGTERM` and on a thrown error — an interrupted run
  (Ctrl+C, a supervisor's timeout) is the common way this harness is stopped, and
  it used to leave every app booted so far running.
- The run **measures** the result rather than asserting it in prose: the armed
  boot checks that the leftover probe can see it while it is running, and every
  run ends by checking that no process carrying this run's own tag survived
  (detection can be a pattern, because the tag is `lo-renderer-driver-<this run's
  pid>` and cannot match another session). `--clean` deletes the scratch tree only
  after that check passes: an app still running re-creates the profile directory
  under it the moment it is removed.
- **An INTERRUPTED run leaves its scratch tree, and reclaiming it is yours to
  do.** `SIGINT` and `SIGTERM` go straight to `process.exit` after the reaper
  stops the apps this run started, so `--clean`'s removal never runs and the tree
  stays at `$TMPDIR/lo-renderer-driver-<pid>` — about 1.9 MB holding a dead
  profile and the app's own log, which is the file you want after an interrupt.
  Nothing else reclaims it: `--out` frames live outside it and survive, and a
  later run uses a different pid, so a tree left by run 4711 is never touched by
  run 4712. Delete it when you are done with the log:

  ```bash
  rm -rf "${TMPDIR:-/tmp}/lo-renderer-driver-<pid>"   # the path the run printed
  ```

  A run that refuses on the pin check leaves one too, and prints its path: that
  path removes the tree only when `--clean` was passed without `--keep`. With the
  default flags — neither `--clean` nor `--keep` — it prints `scratch: <path>` and
  keeps the tree, so a refused run needs the same `rm -rf` an interrupted one does.

## The verbs

`window.__loDevDriver` exists only in an armed launch. Its own methods are the
bridge; the verbs are registered by the renderer's install module.

| Call | What it does |
| --- | --- |
| `call("hello")` | Where the app is: route, theme, viewport, dpr, `visibilityState`, `hasFocus`, and the renderer's baked API base URL |
| `call("state")` | The state the verbs write into: route, theme, panel flags, active session, session count |
| `call("navigate", path)` | Navigates the hash router and waits for the route |
| `call("setTheme", name)` | The settings picker's own action, waiting out the 120ms `transition-colors` it starts so a frame taken after it is the settled palette rather than a blend of the two |
| `call("press", selector)` | Waits for the element, hit-tests its painted centre, dispatches a pointer sequence, returns what was hit |
| `facts()` | From main: window mode, window vs content size, visible/focused/minimized, app version |
| `capture(label)` | `webContents.capturePage()` → `<out>/<label>.png`, reporting pixels and the CSS viewport |

Verb names are enumerable (`verbs()`), so a scene that calls one that does not
exist is told what does. `capture` is deliberately not a verb: it goes through
main, which is the only side that can photograph the window.

Scenes live in the harness script, not in the app: a scene is assertions and
captures composed from those verbs, so a new one costs a function rather than a
release. Add a *verb* only when a scene needs to reach a path none of these can
— and keep it named and reviewable. A generic "eval this string in the page" hook
is refused on purpose: its blast radius grows with every PR, and the review
question "what can this reach" would have no answer.

- **It is isolated from the operator's state, not from the network.** The run
  reaches no backend — the scratch `.env` points the app at a port the script
  verified dead, and the run asserts the app holds no connection to the URL the
  renderer was built with — but the app's own telemetry still leaves the machine:
  `us.i.posthog.com` and `us-assets.i.posthog.com` hold ESTABLISHED connections
  during a driver run, and `capture_exceptions` is enabled in both processes.
  There is no telemetry-disable switch in the app today, so this is a stated
  limit rather than a redirected path: a run through this harness is not
  "offline", and adding a first-class switch is a product decision rather than
  something this script can do from outside.

## What it can prove

- What the app actually paints, at a real viewport and device pixel ratio, of the
  built app the operator runs.
- A visual **before/after of one screen** — the shape a visual-change review
  needs, and the reason `--scene states` captures the same surface twice. The
  pair is asserted to be *two renders* (the frames on disk are compared, and
  their hashes printed) as well as the same route and viewport, because those two
  checks are satisfied by one frame written twice — which is exactly what shipped
  once, with `chat-light.png` a byte copy of `chat-dark.png`.
- That a control is real enough to be driven: the press reports the element at
  the painted point, and the scene checks the app's state moved.
- That the run stayed out of the way: window mode, size, visibility and focus
  come from main, not from the page's own belief about itself.
- That a committed frame is one the app **held still for**. The theme verb waits
  out the app's own colour transitions (three consecutive frames with nothing
  running) and the scene then captures twice, 150ms apart, committing the second
  only if the two are byte-identical and no transient toast is on it. Both halves
  are checks, not notes, because both have already been wrong on this harness: a
  light frame captured mid-transition (the rail's pill at 46% of its colour
  change in a run that reported a settled frame), and a dark frame carrying the
  app's own `List agents request failed: 503` toast in one run out of two.

## What it cannot prove, and what it is not for

- **It is not a substitute for the `browser` tool.** This drives the app's own
  Electron; it says nothing about a page's behaviour in the operator's real
  browser — different profile, cookies, extensions and permissions. When the real
  browser is what is under test, use the `browser` tool.
- **It cannot see inside the embedded browser's page.** That page lives in a
  native `WebContentsView` (`src/main/browser/`), and a renderer frame does not
  include it — measured: with a tab navigated to a magenta local page, the
  captured frame contained none of it. The chrome and the page are two surfaces,
  so capturing a browser-flow change means capturing both and, if a single image
  is wanted, composing them — and a composed image must be labelled as composed,
  never presented as one screenshot. The page half has its own supported path:
  the browser host's `screenshot` RPC, driven by `scripts/browser-host-proof.mjs`.
- **Focus-dependent rendering is not covered.** A `headless` window is never
  shown and cannot be focused, so `:focus`/`:focus-visible` rings, text carets and
  anything gated on `document.hasFocus()` do not render as they do for a user.
  For those, run with `--window-mode=inactive` or force focus over CDP
  (`Emulation.setFocusEmulationEnabled`) and say which you did — the same caveat
  `AGENTS.md` records for the window modes.
- **A backend-gated screen does not reach a reviewed state here.** The run has no
  backend, so `/settings`, `/agents`, `/agent-hub` and `/schedules` render the
  app's offline surface (measured at 6s) rather than a reviewed screen, and a
  spinner is what an earlier cut of the app showed instead. A scene must not
  present either as a reviewed screen; `--scene states` says so instead of
  capturing one — which is also why it presses the rail's Agent hub button and
  asserts the route moved without capturing the destination.
- **Pressed events are synthetic.** `press` dispatches a pointer sequence from
  inside the page, which reaches the app's handlers but bypasses the browser's own
  hit testing and input pipeline. Whether a control is genuinely hit-testable is a
  different question with its own tool: `scripts/click-proof.mjs`.
- **Transient toasts are excluded, deliberately.** A run has no backend, so the
  app raises its own error toast on a timer the scene does not control; the scene
  waits for toasts to clear and discards a capture that has one. So a frame here
  is not evidence about toast styling, placement or timing — that needs a scene
  that triggers and captures one on purpose.
- **It is not a way to answer an approval, and must not be used as one.** A verb
  can press an in-app approval control, so a scene that did would make every "it
  works" captured through it worthless: approvals are the operator's, and the
  harness is not a second way to give them.
- **It is not a way to see the operator's data.** The isolation above is what
  makes that true, and it holds only while every launch uses this script rather
  than an ad-hoc `electron .` invocation with a real profile.

## The frames in this repository

`docs/evidence/renderer-driver/` holds the pair above with a README naming the
command that produced them. They are live-app frames, not Storybook captures, so
the Storybook sweep (`pnpm check-evidence`, which walks `.webp`) does not cover
them — the same position as the other committed live-app PNG sets.
