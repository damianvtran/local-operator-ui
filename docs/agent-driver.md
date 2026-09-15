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
`--scene states` (the default) writes a before/after pair of one screen plus a
real control press; `--scene none` boots and arms the driver without running a
scene. `--window-size WxH` sets the window (default 1380x900, the app's own
default). The scratch tree is kept and its path printed; `--clean` removes it,
`--out <dir>` puts frames somewhere you choose.

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

Off means the process is indistinguishable from the app as it was:

- main registers no `dev-driver-*` channel at all, so a call is refused by
  Electron itself (`No handler registered for 'dev-driver-capture'`);
- the window carries no `additionalArguments` entry, so the preload exposes no
  `window.__loDevDriver` — not a disabled object, nothing;
- the renderer's install module returns immediately.

`node scripts/renderer-driver.mjs --gate-check` measures that on two real boots
and fails the run if any of it is untrue: the unarmed boot must paint normally,
expose no bridge, refuse the channel, write no frame and print no banner; the
armed boot must produce all five. `scripts/dev-driver-gate.test.mjs` pins the
same decision in-process (it is in `pnpm test:desktop`), because the module
imports nothing from Electron and can be bundled in a test.

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
  single-instance lock, so the second boot of a two-boot run prints "Another
  instance is already running" and exits without a window — which reads exactly
  like a broken driver. The harness gives each launch its own profile directory.

## Isolation: what the run cannot reach

A driver run happens on the operator's desktop, next to his real app. Every path
that could reach his state is redirected, and the run prints all of them:

- `HOME` **and** `LOCAL_OPERATOR_CONFIG_DIR` are scratch. The config dir alone is
  not enough: caches and hardcoded home roots follow `HOME`, and this repository
  has already written 612 rows into the operator's live analytics database from a
  run somebody believed was sandboxed.
- `--user-data-dir` is scratch **per launch**, so the Electron profile (the
  localStorage the UI preferences persist into) cannot see or touch the real one.
- The app's **cwd is outside the checkout**, and the scratch cwd holds a `.env`
  with `VITE_LOCAL_OPERATOR_API_URL` pointing at a port the script picked and
  verified to be dead. `src/main/backend/config.ts` loads `.env` from
  `process.cwd()` with dotenv `override: true`, so a repository `.env` cannot win
  and the run has no reachable backend. That is the difference between a run that
  shows a disconnected app and one that writes into the operator's backend — and
  it is why every frame can be pasted into a PR.
- The run asserts, with `lsof` on the app's own pid, that the app holds **no TCP
  connection to the URL the renderer was built with** (`VITE_LOCAL_OPERATOR_API_URL`
  is inlined into the renderer bundle, and a few renderer-direct features —
  attachments, the canvas edit API, the updates panel — would use it). The probe
  says "unavailable" rather than "no connections" if `lsof` is missing.
- `CMUX_*` and `LOP_*` are stripped from the child environment: an inherited
  workspace id has already renamed the operator's real cmux workspaces from a test
  run in this repository.
- Nothing raises the window: `headless` is never shown, and the run asserts
  `visible=false`, `focused=false` from main before it captures anything.

## The verbs

`window.__loDevDriver` exists only in an armed launch. Its own methods are the
bridge; the verbs are registered by the renderer's install module.

| Call | What it does |
| --- | --- |
| `call("hello")` | Where the app is: route, theme, viewport, dpr, `visibilityState`, `hasFocus`, and the renderer's baked API base URL |
| `call("state")` | The state the verbs write into: route, theme, panel flags, active session, session count |
| `call("navigate", path)` | Navigates the hash router and waits for the route |
| `call("setTheme", name)` | The settings picker's own action |
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

## What it can prove

- What the app actually paints, at a real viewport and device pixel ratio, of the
  built app the operator runs.
- A visual **before/after of one screen** — the shape a visual-change review
  needs, and the reason `--scene states` captures the same surface twice.
- That a control is real enough to be driven: the press reports the element at
  the painted point, and the scene checks the app's state moved.
- That the run stayed out of the way: window mode, size, visibility and focus
  come from main, not from the page's own belief about itself.

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
- **A backend-gated screen is a loading state here.** The run has no backend, so
  `/settings`, `/agents`, `/agent-hub` and `/schedules` sit on their spinners
  until React Query gives up. A scene must not present one of those as a reviewed
  screen; `--scene states` says so instead of capturing one.
- **Pressed events are synthetic.** `press` dispatches a pointer sequence from
  inside the page, which reaches the app's handlers but bypasses the browser's own
  hit testing and input pipeline. Whether a control is genuinely hit-testable is a
  different question with its own tool: `scripts/click-proof.mjs`.
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
