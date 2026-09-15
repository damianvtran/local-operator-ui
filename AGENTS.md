# AGENTS.md

This file defines project-specific operating guidelines for AI coding agents working in this repository.

## Repository Context

- Project: `local-operator-ui`
- Stack: Electron + React + TypeScript, **Tailwind v4 + shadcn** (migrating off MUI 6 + Emotion)
- Primary branch for releases: `main`
- Version source of truth: `package.json` (`version`)
- Release tag format: `v<semver>` (example: `v0.12.8`)
- Package/build tooling: `pnpm` scripts in `package.json`

## General Project Guidelines

- Keep changes scoped to the requested task; do not refactor unrelated areas.
- Do not revert or overwrite user changes that are outside your task.
- Never launch the app in a way that takes the operator's window focus. Every
  agent-driven run names a window mode; see *Running the app without taking the
  operator's focus* below.
- Prefer small, explicit commits with clear conventional-style messages.
- Before finalizing, run the narrowest relevant checks for touched code.
- Follow existing code style and project conventions (Biomes/TS settings already configured).
- No emojis in code, comments, UI copy, or commit messages.

## Design and branding — read before any visual change

**`docs/branding.md` is the design contract.** Read it before changing any
visual surface, and read § 7 before touching anything that renders agent
output. The short version of the parts most often got wrong:

- **Name roles, never colours.** `bg-surface`, `text-ink-muted`,
  `border-control` — never a hex, never `theme.palette.*` in ported files. If a
  value maps to no role, the system is missing one; add it to the contract
  rather than working around it.
- **Twelve themes are user-selectable.** A "Dracula" theme is a promise to a
  user, so the brand ports as roles with contrast floors, not as brand green
  applied everywhere. Only the two `localOperator*` palettes are the brand.
- **`hairline` vs `border-control`.** Decorative rules vs the sole boundary of
  a control. The second has a 3:1 floor; conflating them is how the app once
  shipped inputs bounded at 1.25:1.
- **Elevation is a lightness step, not a shadow.** One shadow exists, only for
  things that leave the flow (menu, dialog, drawer, popover, tooltip, select).
- **Disabled changes colour, never opacity. Focus is `outline`, never
  `box-shadow`** — this app is mostly scroll containers, and box-shadow rings
  get clipped by `overflow: hidden`.
- **Nothing lifts, scales or translates on hover.** Hover is a colour step.
- **Agent output has a hierarchy** (§ 7): a question for the user is the most
  prominent thing on screen; internal reasoning is hidden by default. A
  completed action is one quiet line, not a card.
- Sentence case everywhere. Monospace is machine voice only.

### Where colour comes from

One source, two consumers. `shared/themes/palettes/*.ts` holds twelve
`ThemePalette` objects; MUI consumes them as hex (≈299 `alpha()` call sites
cannot take a `var()`), and Tailwind consumes CSS variables generated from the
same objects. After editing any palette run `pnpm gen-themes`, and never
hand-edit `styles/themes.generated.css`.

`pnpm check-themes` enforces both freshness and the contrast floors, asserting
over component triples (ground + fill + border + ink) rather than token pairs.
**Adding a component with its own fill and border means adding a row to
`CONTROLS` in `scripts/contrast-contract.mjs`** — green output about a
component nobody listed is not evidence about that component.

### One trap worth knowing

Always route `className` through `cn` from `@shared/lib/utils`. It registers
our custom scales with `tailwind-merge`; without that, a type step and an ink
role in the same call collide and one is dropped **silently** — the component
still looks right because colour inherits from `body`, until it renders on a
ground where it does not.

## Useful Commands

- Install deps: `pnpm install`
- Dev app: `pnpm dev` (needs `.env`; copy from `.env.template`)
- Dev app, no window: `pnpm dev:headless`
- Built app, no window: `pnpm app:headless -- <extra electron args>`
- Built app, driven by an agent: `pnpm app:driver` (see `docs/agent-driver.md`)
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Typecheck: `pnpm check-types`
- Build: `pnpm build`
- Theme gates: `pnpm check-themes` (freshness + contrast floors)
- Regenerate theme CSS: `pnpm gen-themes`
- Bundle size: `pnpm bundle-size`, `pnpm startup-closure`
- Component gallery: `pnpm storybook`

`pnpm check-evidence` admits **one sweep per machine**, across worktrees and
isolated `HOME`/`TMPDIR` runs. It requires Python 3 with POSIX `flock` (macOS/Linux)
and uses the permanent `/tmp/local-operator-ui-check-evidence.lock` file. A busy
lease exits **75** with `DEFERRED` and checks no frames; retry after the owner
finishes, rather than waiting inside the command. The image child inherits the
lease, so a killed sweep cannot admit another while that child is still alive.
Dead holders recover automatically when the last descriptor closes: **never
delete the lock file** or reclaim it by PID/age, which splits the lock inode.
Missing locking support or a file owned by another OS user fails closed. The
worker and image children inherit niceness of at least 10 where permitted; a
priority failure warns without disabling admission. This bounds the full sweep,
not independent capture scripts importing the single-frame predicate. Run
`node --test --test-concurrency=1 scripts/evidence-run-guard.test.mjs` for the
lightweight subprocess/CLI contract tests; they use isolated synthetic evidence,
not the committed image set.

`pnpm test:desktop` runs focused desktop transport/security contract checks with
Node's built-in runner. It bundles the actual TypeScript modules in memory and
uses real loopback HTTP; its Electron IPC fixture is not native-app or visual
proof. Broader verification remains typecheck, lint, the theme gates, a real
build, and rendered evidence from the live app or Storybook as appropriate.

**The desktop suite caps its own concurrency.** It runs through
`scripts/run-desktop-tests.mjs` rather than `node --test` directly, so node's
default of one file worker per core (minus one) — 13 on a 14-core box — never
applies here. The cap is the smaller of half the cores and a memory budget,
resolved by `scripts/desktop-test-concurrency.mjs`, and the runner prints the
number it chose, the term that bound and the inputs behind it before the first
test, because that line is what a reviewer reads to know what actually ran.

It exists because this repo is worked through many concurrent git worktrees and
several agent sessions run this suite at once on one laptop. **What reproduces is
the concurrency it removes**, not one RSS figure: 13 file workers by default
against 5-7 under the cap, and with them the peak process count (this branch's
rounds: 25-28 processes uncapped against 15-19 capped; QA's pass: 32 against 24)
in two independent passes — this branch's own, run before the rebases onto main
(23 files then, base `79d0dc889`), and QA's at a cap of 7. Peak tree RSS is round-
and pressure-dependent and a single band should not be quoted as the property of
the change: this branch measured 666-892 MB at caps of 5-7 against 1,187-1,291 MB
uncapped, while QA's pass at cap 7 measured a 998 MB / 24-process peak against a
1,253 MB / 32-process baseline with median and p95 RSS essentially unchanged. A
suite's peak is dominated by whichever heavy file is in flight, not by how many
run at once. Wall time overlaps in the unpressured case: 91.5-93.3 s uncapped
against 93.1-95.7 s capped.

**Know the pressure mode's cost before judging the cap.** The memory arm has a
floor: at or below **3,648 MB available** on this host — the 3,072 MB reserve
plus three workers' worth, where the arm returns 3 and one byte less returns 2 —
it can return nothing above `_MIN_WORKERS`. Wall time then grows by roughly half
to double, because two workers serialise the whole suite: **+47% to +98%** across
QA's two A/B passes (+46.7%: 133.4 s against 91.0 s, both arms in one window on
the head QA tested; +98%: 180.6 s against 91.4 s, on a busier box in round 1).
The direction is the point and the multiple follows what else the host is doing.
That is the deliberate trade rather than a regression to tune away: the condition
is a host already swapping, and the point of the floor is that this suite is not
what pushes it over. A `test:desktop` run that looks slow should be read as its
concurrency line first and its timer second.

**Anything that spawns `node --test` must drop `NODE_TEST_CONTEXT`.** Node
exports it into every test-file process, and a nested `node --test` that inherits
it does not run the files at all: it warns (`node:test run() is being called
recursively within a test file. skipping running files.`), writes **0 bytes** to
stdout and **exits 0**. Measured on node 26.5.0. So an inherited copy turns a red
suite green — `env NODE_TEST_CONTEXT=child-v8 pnpm test:desktop` reported success
in 0.41 s on a deliberately failing tree, which is the false-green class this
whole change exists to remove. `scripts/run-desktop-tests.mjs` filters that one
key out of the environment it hands its child (`_TEST_CONTEXT_ENV`), and
`run-desktop-tests.test.mjs` pins it by running a failing suite through the
runner with the variable genuinely ambient.

Several files here also spawn real children — the esbuild binary that most of
them bundle through, a real `/usr/bin/codesign` run in
`update-robustness.test.mjs`, node subprocesses in `linux-sandbox.test.mjs` —
which is why the memory budget divides by a 192 MB per-worker envelope the
measurements do not themselves justify; the constant's own comment in
`scripts/desktop-test-concurrency.mjs` says exactly what those measurements do
and do not bound.

Override the number, or bypass the governor entirely:

```sh
LOCAL_OPERATOR_UI_TEST_CONCURRENCY=12 pnpm test:desktop        # honoured unclamped
node scripts/run-desktop-tests.mjs --test-concurrency=12 <files...>  # bypasses it
```

An explicit `--test-concurrency=N` is forwarded untouched; whoever passed it
knows how wide they want to run. **CI keeps every core:** `CI` set without
`LOCAL_OPERATOR_AGENT_SHELL` takes node's own default untouched, because a
hosted runner is dedicated and taking parallelism away from it is a regression
paid on every run. Our own bash tool sets `CI=1` on agent-run commands, so it
also sets `LOCAL_OPERATOR_AGENT_SHELL=1`; the governor denies that marker and
takes the developer path, which is the only reason agent-run suites on a laptop
are capped at all. A probe failure degrades to a CPU-only cap, and the governor
never raises a machine's parallelism above what node itself would have used.

## Running the app without taking the operator's focus

Agents run this app on the operator's own desktop, several at a time. Until the
window mode existed, every one of those runs ended at `ready-to-show` with
`show()`, which activates the app and takes the keyboard focus away from
whatever the operator was doing — a seven-cycle QA matrix is seven
interruptions, and it is the most disruptive thing an agent can do in this
repository.

**Every agent-driven launch must name a window mode.** The app resolves it from
`--window-mode=<mode>` or `LOCAL_OPERATOR_UI_WINDOW_MODE` (the argument wins),
and takes `--window-size=WxH` or `LOCAL_OPERATOR_UI_WINDOW_SIZE` for the size:

| Mode | The window | Use it for |
| --- | --- | --- |
| `headless` | created at the requested size, **never shown**, unfocusable, page unthrottled, no native banners | every test, QA, harness and evidence run — the default choice |
| `inactive` | shown with `showInactive()`: visible, but the app is never activated and the window never takes focus | a run somebody wants to watch or click into, and anything focus-dependent |
| `normal` | `show()` — raises and focuses the window | a human starting the app. Never an agent run |

```bash
# The built app, driven over CDP at an exact size, with no window at all.
pnpm app:headless -- --remote-debugging-port=9451 --user-data-dir="$SCRATCH/profile" \
  --window-size=1380x900

# The dev app, same rule.
pnpm dev:headless

# A harness that already spawns Electron itself: the switch rides the environment.
LOCAL_OPERATOR_UI_WINDOW_MODE=headless npx electron . --remote-debugging-port=9451
```

`npx local-operator-ui` spawns Electron with this process's environment, so the
same switch covers a check of the published launcher. Any mode but `normal`
prints a `[window-mode] ...` line to the process's own output, so a run says out
loud that it was headless instead of looking identical to one that popped a
window. A mode or size the app could not honour is printed there too, not only
to the backend log: a typo like `LOCAL_OPERATOR_UI_WINDOW_MODE=hedless` falls
back to `normal`, which is the difference between a headless run and an
interruption, and it must be visible to whoever launched it.

### An agent-driven run does not banner either

`headless` silences the **app's** own notification (`window-mode.ts` feeds
`DesktopNotifier`) and has no reach into the **backend's**: a session parking on
a gate announces itself from `session/runtime/serving.py::_announce_pending`
through `local_operator/tui/notify.py`, and on macOS that ends at `osascript -e
'display notification'` — a banner in the operator's ACTUAL Notification Center,
wearing Script Editor's identity. That is where the ~46 that arrived in six
minutes came from.

Where they came from *mechanically* is worth stating exactly, because it is easy
to get wrong in the direction that makes this guard look like it covers a path it
does not (review round 1). **No file in `test:desktop` spawns Electron** —
measured over the whole list — so the suite does not boot the app. Its live
backend is a python `serve` started directly by `scripts/submit-latency.test.mjs`,
which builds its child environment from the runner's, and that is the leg the
runner's switch closes. The five app-proof rigs DO boot the app, but each sets
`VITE_DISABLE_BACKEND_MANAGER=true`, so their app spawns no backend at all; the
switch is set at their launch because a rig that stops disabling the manager, or
the next rig somebody writes, would otherwise spawn one. The app-spawns-backend
hop (`backendSpawnEnv`) is the shipped app's own path — the one a `.env` could
reach — and it is protected on the app side rather than here.

`scripts/notifications-off.mjs` is that switch applied to a child environment,
and every path in this repo that spawns the app or the suite sets it:
`run-desktop-tests.mjs`, the app-proof rigs (`browser-chrome-proof`,
`renderer-driver`, `browser-host-proof`, `mentioned-files-app-proof`,
`session-cookie-restart-proof`) and the `app:headless` / `dev:headless` scripts.
`scripts/notification-spawn-sites.test.mjs` enumerates those sites and fails on
a new one that is not in its table, because the rig somebody adds next month is
exactly the one that will forget. The deliberate exceptions
(`notification-evidence.mjs`, interactive `pnpm dev` / `pnpm start`) are named in
that module and in the table.

**The switch is about PRESENCE, not about the value.** `notify.py` reads it with
`os.environ.get()` and silences on any non-empty string, so `0`, `1` and `no` all
mean SILENCED — `LOCAL_OPERATOR_NO_NOTIFICATIONS=0` does **not** "keep your own
banners on", and in a `.env` it is the spelling that silently re-arms the
incident behind a variable that looks switched off. The only way back on is to
unset the key for that launch:

```sh
env -u LOCAL_OPERATOR_NO_NOTIFICATIONS pnpm start   # banners on, one launch
export -n LOCAL_OPERATOR_NO_NOTIFICATIONS           # banners on, this shell
```

An absent value therefore means "banners on"; an EMPTY one is not a choice
anybody made — a stale export, or a `.env` line in the empty shape — so the
helper reads it as OFF rather than leaving every banner armed behind a variable
that looks switched off, and the app reads an empty value that reached its LAUNCH
the same way. An empty value that only ever existed in the folded file, on a
launch that stated nothing, is left alone: that is a person's own app, where the
banner is the feature.

**A `.env` in the working directory cannot replace it.** The app resolves the
key from its own launch environment (`src/main/backend/notification-launch.ts`,
applied in `backendSpawnEnv`) rather than from `process.env`, because
`backend/config.ts` folds a `.env` from the working directory over the launch
with dotenv `override: true` and `loadMacOSEnvironment` merges the operator's
shell rc on top of that. Measured before the fix, through `pnpm app:headless`: a
`.env` carrying `0` or an empty value reached the backend child as exactly that
— and the empty one reads as ENABLED, i.e. the incident back with every gate
still green. The value the launch was given now wins, so a stale `.env` cannot
defeat an agent-driven run — and an empty value that reaches the launch at all
still silences the backend, because empty is not a choice.

**What this pin does not cover — two folds and one rename.** The consumer is
`local_operator/tui/notify.py`, which lives in a SEPARATELY INSTALLED backend
package that this repo does not pin (`src/main/update-install.ts` installs it with
`pip install --upgrade local-operator`). Nothing here reads that file, so if
upstream ever renames `_ENV_DISABLE`, every switch this repo sets becomes a
variable nobody reads: the incident returns with all of these tests green. The pin
guards the local spelling, not the contract; a cheap pin would need the installed
backend's own NAME asserted against this repo's — a version assertion would not
close it, because the contract is the name rather than the number — and nothing
here can reach that name today.

The same package folds a `.env` of its OWN, one hop past the app: `env.py:18-19`
runs `load_dotenv(Path(__file__).parent.parent / ".env", override=True)` at
import time — `…/site-packages/.env` for a wheel, uv or pipx install, the source
checkout root for an editable one — inside the backend process the app has just
handed `1` to. Reproduced against the shipped consumer with the package root in
scratch: inherited `1` → `''` → `notifications_enabled()` True. It is latent on
this machine (neither of those paths exists, and the backend's own `.env.template`
does not carry the key), and it is the same class as the fold this PR fixes, one
layer further in: what the app-side resolution guarantees is that a `.env` in the
APP's working directory cannot replace the launch, not that nothing downstream of
the app ever can.

`docs/evidence/desktop-notifications-off/` carries the before/after proof, stood
on a shim `osascript` so neither case can touch the real one, and the measurement
of the app→backend hop.

### `headless` is a full-fidelity rendering path, not a degraded one

That is what makes it usable as evidence rather than only as a way to stay out
of the way. Measured on Electron 35.5.1 / macOS 25.6, with a 1380x900 window:

- `document.visibilityState` stays `"visible"` and `requestAnimationFrame`
  keeps ticking (124-132 frames/s in the runs below), so a run is not measuring
  a paused page;
- CDP `Page.captureScreenshot` — and `webContents.capturePage()` on a
  `show: false` window in a platform probe — return a complete frame: 2760x1744
  pixels at devicePixelRatio 2, the same size a shown window gives. The settled
  chat frame differs from the one captured from a shown (`inactive`) window in
  one `62x19` box and nowhere else: the seeded transcript's message time, which
  the seeder stamps with `Date.now()`. Two `headless` runs differ in that same
  box, so the residual is the wall clock rather than the mode, and apart from it
  the frames reproduce pixel-for-pixel;
- the app is never the frontmost application while it runs. Sampled from
  outside, by pid, in a headless run: **0 of 8** samples, and that run includes
  a second launch on the same profile (the `second-instance` path, which raises
  a window in the other modes). The control is the same harness in `normal`: the
  app was frontmost in 5 of 8, 4 of 7, 3 of 3, 2 of 4 and 1 of 3 samples across
  runs, and never in a `headless` or `inactive` one.

Do not reach for `win.isFocused()` as the proof of that, and do not trust
`focusable: false` to save you: on macOS `NativeWindowMac::Show()` calls
`activateIgnoringOtherApps:YES` for every non-panel window whatever `focusable`
says, so a `show()` on a non-focusable window makes the app frontmost while
`isFocused()` keeps reading false (measured). What makes a headless run safe is
that nothing raises the window at all — `src/main/window-raise.ts` is the only
module in the main process that calls `show`, `showInactive` or `focus` on a
window, and `scripts/window-mode.test.mjs` asserts that.

Four consequences for how you take evidence:

- **Read the viewport from the page and label frames with it.** A
  `BrowserWindow` size includes the platform's window chrome, so 1380x900 is a
  1380x872 CSS viewport on macOS **on Electron 35.5.1 and a 1380x868 one on
  44.3.0** (both measured; the chrome the runtime reserves moved between them), so
  treat the number as something the run reports rather than a constant to recall —
  a committed frame labelled with the other version's viewport is a caption that
  does not match its bytes. A `--window-size` under the verified 800x600 floor is
  clamped to it and reported in the log, so a frame cannot be labelled with a size
  the window never had.
- **Focus-dependent rendering differs.** A window that is never shown cannot be
  focused: text carets, `:focus`/`:focus-visible` rings, and anything gated on
  `document.hasFocus()`. For a change about those, drive it in `inactive` mode,
  or force focus with CDP `Emulation.setFocusEmulationEnabled(true)` — and say
  which you did.
- **Focus-dependent behaviour differs too**, which is easy to miss because it
  is silent: the watch lease reports `visible && focused`, so a headless run
  reads as "nobody is watching", and the `sessions.seen` ack is gated on
  `document.hasFocus()`. `headless` is therefore the wrong mode for anything
  about read receipts, leases, or the notifier's own focus gate.
- **Native dialogs have no parent window** in `headless` (`dialog.showOpenDialog`
  is called with the window). A change that opens a file picker needs
  `inactive`.

Native banners are suppressed entirely in `headless` (the notifier's delivery
gate), because the run has nobody at the screen and a toast would interrupt
whoever is really at the machine — and because a banner's own click handler is
a path that raises a window.

### Capturing the frame

Capture from inside the app — `webContents.capturePage()` or CDP — never with
macOS `screencapture`, which works only on the frontmost window and so requires
exactly the focus theft this section exists to remove. Storybook evidence is
unaffected: `pnpm capture:evidence` already drives a private `--headless=new`
Chrome.

**Driving the renderer is a supported path now, not a rig per agent.**
`scripts/renderer-driver.mjs` boots the built app headless in an isolated
scratch profile, arms an opt-in bridge that exists only when the launch asked for
it, and captures frames with the app's own `capturePage()`. `docs/agent-driver.md`
is the contract: the exact commands, the verbs, what it can and cannot prove, and
the reason it is not a substitute for the `browser` tool. Reach for it before
writing a new rig — and read its limitations section before you present a frame
from it as evidence for anything it cannot see (focus-dependent rendering, an
embedded browser page, and backend-gated screens among them).

### What already opens no window, so a rebase does not re-introduce one

`pnpm test:desktop` bundles modules in process; the CI npx smoke test prints its
marker from `whenReady()` and exits before a window exists; the Storybook and
CDP capture scripts run headless Chrome. The windows come from live-app
harnesses — `pnpm dev`, `npx electron .`, `npx local-operator-ui` — which is why
the mode belongs in the harness's own spawn call and not in whatever the shell
happened to export.

## The code-sealed bundle, and what may write in it

Two mechanisms keep CPython's bytecode cache out of
`Contents/Resources/python*`, and they are a pair: change one without reading the
other's docstring (`src/main/python-bytecode-cache.ts`,
`sealPythonInterpreterTrees` carries the measurements) and the bug they exist for
comes back.

1. Every spawn that can run the bundled interpreter is handed
   `PYTHONPYCACHEPREFIX` pointing under the app's userData
   (`withPythonBytecodeCache`, and the same default in the three shipped install
   scripts). This is the half that keeps the cache *working*.
2. On macOS the app also seals the trees themselves at launch, with an
   access-control entry that denies `add_file`/`add_subdirectory` on every
   directory and `write`/`append` on existing `.pyc`. That is the half no spawner
   can evade, and it is needed because the app does not spawn every python that
   runs this interpreter: the venv's own `python` resolves its stdlib to the
   bundled tree, and a python started by anything else - a shell, a CLI script,
   launchd, an agent - carries no `PYTHONPYCACHEPREFIX` at all (measured: a venv
   over the bundled tree wrote 25 `.pyc` into it that way, which is the class the
   operator's own 163 in-bundle `.pyc` belong to). A child can also ignore the
   environment by design: `-E`/`-I` mean "do not read `PYTHON*`", and the
   backend's evaluation supervisor spawns workers with `-I -s -E -B`.

**Do not "simplify" the seal back to `chmod`/mode bits.** One write bit on a
directory covers both creating an entry and unlinking one, so clearing it refuses
the write but also makes the app undeletable (`rm -rf` exits 1 with `Directory
not empty`, and emptying the Trash cannot reclaim the tree) and stops the app
healing its own bundle, because `healPythonBytecode` (`update-install.ts`)
repairs an unsealed one by *unlinking* the `.pyc` CPython added. Measured on a
mode-sealed copy: `healable=false removed=0`. Withholding the two rights
separately is what lets a tree refuse new files and stay deletable and healable
at once; the symptom of a regression here is a `file added:` violation the heal
can no longer remove.

Load-bearing, and enforced at build time: nothing may ship a `.pyc` at all
(`scripts/setup-python-resource.sh`, with the release gate in
`scripts/verify-macos-artifacts.mjs`), because a *shipped* `.pyc` that gets
rewritten is `file modified:` - the one class codesign cannot accept again and
the heal cannot repair.

## Updates: the managed runtime, the inert seed, and the start-up repair

The interpreter is the one part of an install that an in-place update must not be
standing on. Three mechanisms make that true, and they are a set: the seed, the
managed runtime outside the bundle, and the seal described above.

**1. The bundle ships the interpreter as inert data, under a namespace of its own.**
The tree is `Contents/Resources/python-runtime-seed/<arch>` — one architecture per
artifact (`arm64` or `x64`, matching the `-<arch>.zip`/`-<arch>.dmg` filename, and
asserted against it), carrying the *complete* runtime (`bin/python3` and
`lib/python3.12/encodings`, not just the executable), no `.pyc` anywhere, no
absolute or escaping symlinks, no hardlinks or special files. `python-runtime-seed`
is a **namespace, not a name**: nothing may read or execute it in place, and the
point of the name is that an incumbent venv cannot reach it by accident between
ShipIt's swap and the candidate's first instruction.

**2. The runtime the app actually runs lives outside every bundle.** On first use the
app copies the seed into its own managed root under
`~/Library/Application Support/Local Operator/managed-python/`, hashes what it
copied, and builds its venv against that copy. Two properties come out of this: an
in-place update replaces a bundle that has no running interpreter under it, and the
runtime's identity is the **signed bytes** — `runtimeManifest`/`runtimeIdentity`
hash the tree with bytecode caches excluded, because a cache is derived data and
counting it once made every later comparison disagree with a tree that had not
changed. Nothing outside `managedPythonRoot` may be read, walked or removed, and
`outsideApp` refuses any managed path that resolves inside a `.app`.

**3. Nothing may reintroduce a legacy in-bundle interpreter.** `Contents/Resources/python`
and `Contents/Resources/python_aarch64` are the layout this repository shipped
*before* the split, and their existence in a new artifact is a release failure:
`privatePythonSeedCheck` (`scripts/python-artifact-layout.mjs`) refuses either name
in the packaged app, alongside the empty/aliased seed, the wrong-architecture seed
and an incomplete one. The app keeps the same two names in
`BUNDLED_PYTHON_DIRS` (`isPythonBytecodePath`, `src/main/update-install.ts`) even
though it no longer creates them, because a bundle being **replaced** may still be
the old layout and its stale bytecode has to stay healable. Why it matters: those
aliases are exactly what let an incumbent venv resolve into the new signed seed.

The single definition of all of this is `src/shared/bundled-python-layout.json`
(`seedNamespace`, `architectures`, `legacyResourceNames`). The app, the packer and
the release gate read that one file so their lists cannot diverge — they did once,
and a bundle built by the branch that had moved the interpreter reported every
bytecode violation as unhealable, which is the reinstall refusal on exactly the
install the heal exists to repair.

### The start-up repair

Every launch probes the installed bundle's code seal with `codesign` and repairs the
one break this project causes itself: a CPython bytecode cache written *into* the
sealed tree, which macOS reports as `file added:` and which the next in-place update
would refuse with `-67028 errSecCSBadBundleFormat`. `healPythonBytecode` deletes
exactly those files — never a `modified` violation, never a file outside the
interpreter's own directories — and a bundle broken any other way gets the reinstall
refusal with its remedy, because the alternative is a half-healed bundle the app
believes in. The probe, its single retry and the heal are shared with the
update-time pre-flight (`readBundleSeal`/`repairBundleSeal` in
`src/main/update-service.ts`): the pre-flight is the update policy on top of them,
and it must not grow a second copy of either. A probe that *could not run* is
retried and then allowed to proceed — "we could not ask" is not "the bundle is bad".

`docs/PYTHON_BUNDLING.md` predates this layout (it still describes
`resources/python` and a `pnpm setup-python-standalone` script that no longer
exists); this section and the files it names are authoritative for anything about
where the interpreter lives or how it is updated.

## Which pnpm may install and package

Every workflow pins pnpm to **10.29.2** (the `version:` input on
`pnpm/action-setup`), and that pin is load-bearing rather than a preference:
**pnpm 10.29.3 through at least 10.34.x drops dependency edges from
`pnpm list --prod --json --depth Infinity`**, which is the command
electron-builder runs to decide what goes inside `app.asar`
(`app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector.js`). The
packaged app then ships without a module it needs, and nothing about the build
looks wrong until it is launched.

Measured on this repository, one tree, only pnpm changed:

- **10.30.3**: the command reports the `debug` node reached through
  `electron-updater > builder-util-runtime` without its `ms` dependency - that
  node's `dependencies` map is empty, and the edge survives only on copies of
  `debug` the production closure does not reach - so the packager copies 43
  packages / 5.2 MB and the built app dies at load with `Cannot find module
  'ms'` (require stack `app.asar/node_modules/debug/src/common.js`).
- **10.29.2**: the same command reports that edge, the packager copies 96
  packages / 6.0 MB, and the app starts.

Upstream: pnpm/pnpm#10601, open at the time of writing, last known good 10.29.2.
CI's copy is whatever the workflows pin, but a local `pnpm build` followed by
`electron-builder` uses whatever pnpm is on `PATH`, and an affected one produces
the broken asar silently. So when packaging locally from a newer pnpm, put a good
one in front of the packaging step only:

```bash
npm install --prefix /tmp/pnpm-good pnpm@10.29.2
PATH=/tmp/pnpm-good/node_modules/.bin:$PATH CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm exec electron-builder --dir --arm64
```

**The end-to-end check is the launch, not the build.** With a valid build env -
note that an empty `VITE_PUBLIC_POSTHOG_KEY` throws inside `new PostHog(...)` at
module load, before `app.whenReady()`, and surfaces as a main-process error
dialog rather than a log line - the marker proves the closure came through:

```bash
LOCAL_OPERATOR_UI_SMOKE_TEST=true "dist/mac-arm64/Local Operator.app/Contents/MacOS/Local Operator"
# expect: LOCAL_OPERATOR_UI_READY electron=35.5.1, exit 0
```

### Removing the pin

Three checks, in order of cost. All three must pass on the candidate version
before the `version:` inputs change:

```bash
# 1. Does this pnpm still hide dependency edges? Expect ["ms"]. An empty array
#    means the regression is still there and the pin stays.
pnpm list --prod --json --depth Infinity | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s)[0];const d=t.dependencies["electron-updater"].dependencies["builder-util-runtime"].dependencies["debug"];console.log(Object.keys(d.dependencies ?? {}))})'

# 2. Does the package it produces contain the whole runtime closure? Expect
#    "OK: every resolved production dependency is present".
pnpm exec electron-builder --dir --arm64   # with that pnpm on PATH, see above
node scripts/check-packaged-closure.mjs --dist dist

# 3. Does the packaged app start? Expect the marker line and exit 0.
LOCAL_OPERATOR_UI_SMOKE_TEST=true LOCAL_OPERATOR_UI_WINDOW_MODE=headless \
  "dist/mac-arm64/Local Operator.app/Contents/MacOS/Local Operator"
```

## Releasing is automatic

Every push to `main` runs the **Auto Release** workflow
(`.github/workflows/auto-release.yml`). Nobody picks the bump, mints the version,
tags a commit or creates the Release: the workflow reads the commits that have
landed since the last released tag, decides whether they ask for a release, lands
the one-line bump on `main`, tags that commit, publishes the Release as a
**pre-release** and hands it to `publish.yml` to build, sign, gate and promote.
The signed-update verification then runs itself too.

So **merging is releasing**. There is no release owner, no claim PR, no lock and no
window protocol: a `feat:` or `fix:` merged to `main` is on its way to a version as
soon as the run finishes, and a "window" is only ever *who landed between two
tags*. The sections below say what the run does, what it deliberately cannot
decide, and which invariants a future agent must not break.

### PRs do not bump the version; merging is not releasing

`package.json` stays at the **last released version** on every feature and fix
branch. A PR never touches it, and the reviewer round treats a version change
inside a feature PR as a finding.

**CI checks this**, in the `Version Bump Guard` workflow
(`.github/workflows/version-bump-guard.yml`, `scripts/version-bump-guard.mjs`). A
pull request whose diff changes the `version` line fails unless its title starts
with `chore(release):`. Dependency and metadata edits to `package.json` are
unaffected — the guard reads the version line, not the file.

It makes the violation loud; it does not make it impossible. This repository's
`main` configures **no required status checks**, so an `--admin` merge lands over
a red guard. Treat a failing `version-bump-guard` as a stop signal rather than an
obstacle to route around: the job is the reviewer's missing memory, not a lock.

The guard fails the **mirror-image** case too: a PR titled
`chore(release): bump version to X.Y.Z` whose diff does not change the version.
That one is the more dangerous direction, because it ships the *previous*
release's code under a new number — the tag, the Release and the installers all
agree with each other about the wrong tree, so nothing looks wrong. It has
already happened: an owner amended the bump onto a detached HEAD, the branch ref
never followed the amend, `push --force-with-lease` reported success honestly
(nothing needed overwriting, so the lease was never violated), the retitle and
un-draft applied because PR metadata is independent of the ref, CI went green,
and the guard passed through its early exit. Four green signals on a broken
state, because each answered a question about a different object than the one
being released.

The job exists because prose was not enough. In the backend repository
(`local-operator`) the rule was already written and already told reviewers to
treat a bump as a finding, when two feature PRs each landed one and both review
rounds passed anyway: `main` then advertised a version that no tag, GitHub
Release or artifact had ever been built from, two numbers were consumed without
ever being published, and the next window had to skip them because a published
version cannot be reused. A rule that depends on every reviewer remembering to
look is a rule that fails on the day someone does not.

### The PR owner merges; nobody queues for a number

**The owner of a PR merges it the moment its review rounds are clean and fresh
and CI is green** — no release queue, no waiting for a predecessor, no handing
the "next number" to whoever is behind you.

The failure this prevents is measured, not theoretical. The backend repository
used to have each PR bump its own patch. On 2026-09-05, with ten agent sessions
each holding a reserved patch number, `0.47.1` → `0.48.0` took close to five
hours of agents serialising behind one another — the tags land at 05:24, 05:58,
06:16, 06:50, 07:38, 08:27 and 10:08 UTC, each one a PR that could not merge
until its predecessor had released. Every rebase across another session's bump
was a version-file conflict, several were resolved into **dirty merge states**,
and two out-of-queue releases consumed numbers other sessions had been told were
theirs. None of that work needed a distinct version; it needed to land.

### What the run does, in order

1. **Skips a push that carries nothing to release** —
   `scripts/release-push-guard.mjs`, executed over every shape a bump lands in by
   `scripts/release-push-guard.test.mjs`. Two readings, and either one answers
   "nothing to release": **what this push landed** (its own diff against its first
   parent is nothing but `package.json`'s version line) and **what is unreleased**
   (nothing since the newest released tag, or nothing but the version line).
   The guard asks what the push **contains** rather than how its head is **spelled**,
   because this repository lands its bumps as merge commits: `8f80697c8` is `Merge
   pull request #202 from …/release-next-0236`, whose second parent is `d7e7d63b7
   chore(release): bump version to 0.24.0`, and its own landing is one line —
   `git diff --name-only 8f80697c8^ 8f80697c8` is `package.json`. Against the newest
   released *tag* that same push looks like 177 files, because the window's PRs
   landed before the bump PR did; a guard that tested one subject shape (or one
   anchor) answers "not the release commit" for exactly the push it exists to catch,
   and what follows is a second release of a window that has already shipped. (A
   `GITHUB_TOKEN` push starts no run at all, so this guard is what stops a loop if
   the repository's credential is ever changed to an App or a PAT, which *would*
   start one.)
2. **Derives the next version** — `scripts/derive-release.mjs`, unit-tested in
   `scripts/derive-release.test.mjs` and exercisable on demand (see *Exercising the
   derivation without releasing*). The range is `git log <the newest released tag
   of any kind>..HEAD`, and it is the newest **tag** rather than the newest release
   a user could be running, because a release this workflow creates stays a
   pre-release until `publish.yml` promotes it 25-50 minutes later: anchoring the
   range at the newest non-pre-release would leave the release-in-flight's own
   commits inside it for the whole of every publish, so a `docs:`-only merge would
   release a version no content asked for and a window that carried a `feat:` would
   cut an over-called minor whose notes re-listed the previous release. The mapping
   is stated below. Nothing to release is a real answer: a window of `docs:`,
   `chore:`, `ci:`, `test:`, `refactor:`, `style:` or `build:` commits releases
   nothing, exits cleanly, and says so in the run summary rather than spending a
   version.
3. **Bumps `package.json`** — one line in one file, asserted by
   `scripts/apply-release-bump.mjs` *before* the commit exists rather than in a
   review of it afterwards. The commit is
   `chore(release): bump version to X.Y.Z` and it is pushed to `main` as a
   fast-forward or not at all; no run of this workflow force-pushes anything.
4. **Tags that bump commit and publishes the Release as a pre-release** —
   `gh release create vX.Y.Z --target <bump commit> --prerelease`. The tag names
   the bump commit, never `main`'s head: `scripts/validate-release.mjs` reads
   `package.json` at the tag and requires it to equal the tag's number.
5. **Dispatches `publish.yml`** (`repository_dispatch`, `release-published`). This
   is not decoration. The Release was created with the repository's
   `GITHUB_TOKEN`, and an event created by that token starts no workflow run — so
   neither the `release` event nor a tag `push` would build anything.
   `repository_dispatch` is one of the two documented exceptions, which is why the
   chain uses it.
6. **`publish.yml` builds, gates and promotes** — its build, gate and promote
   steps are unchanged: the installers and the
   npm package, then the artifact gate, then the promotion of the Release to
   `latest`. Its trigger set now includes `repository_dispatch`, its tag/SHA/release
   ID are resolved from whichever trigger fired, and the npm steps are gated on
   "this is not a manual repair" rather than on "this is a `release` event" — the
   old spelling would have shipped installers while silently skipping npm on the
   automated path.
7. **The signed-update verification runs itself.**
   `.github/workflows/signed-update-candidate.yml` is dispatched by `publish.yml`
   (`verify-signed-update`) once the release's assets are attached. It derives its
   own inputs: the **candidate** is the commit the published tag points at, and the
   **incumbent** is the newest release *below* it that a user could actually be
   running — published, not a pre-release, carrying the architecture-matched
   archive (`scripts/release-candidate.mjs`). It never publishes anything, and its
   verdict is PASS, FAIL or **BLOCKED**: a run that could not exercise the update
   says so and names the capability it lacked, and it never reports a pass it did
   not earn.

   **Who can reach the signing key, exactly.** No human approves this run: the
   `signed-update-candidate` environment's approval gate was removed on 2026-09-15
   so a release needs nobody in the loop. Do not read the environment as a bound it
   is not — a branch policy is evaluated against the **dispatch ref**, which on the
   automated path is the default branch by construction (so it constrains nothing
   there) and on the manual path is already enforced by `ref-guard` and by the
   `build` job's own `if:`. What actually bounds the job is:

   - **on the automated path, the pin**: the tree that receives the key must be the
     commit `derive` resolved from the published Release's tag. It proves *which*
     tree is signed, and never that anyone vetted that tree;
   - **on the manual path, nothing else**: `expected_source_sha` is a free-form SHA,
     shape-checked and then proved equal to `HEAD`, and that path exists precisely
     for candidates that are not releases yet. So anyone who can dispatch from
     `main` — that is, anyone with **write access to this repository** — can name an
     unmerged commit and have it built in the job that holds the Developer ID
     keychain. The Apple secrets are repository-level, which is why
     `publish.yml` signs with the same ones and declares no environment at all.

   Narrowing that is a change of its own (a reviewer-gated environment for the
   hand-named path, or the Apple secrets moved into an environment that is required
   wherever they are referenced). It is **deferred** rather than half-done, and this
   paragraph is the boundary statement that replaces the claim that was wrong.

### The version mapping, and what it is not

`!:` or a `BREAKING CHANGE:` footer, or a `feat:` | **minor**
`fix:`, `perf:`, `revert:`, and the `Revert "…"` subject `git revert` writes | **patch**
`docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:`, `build:` alone | **no release**
a conventional type on neither list (`deps:`, `security:`) | **patch**, and the notes name it
the revert of this workflow's own release bump, `Revert "chore(release): bump version to X.Y.Z"` | **no release**: it restores the version surface rather than removing anything a user can see

Three things follow, and they are worth reading before you write a commit subject:

- **Your commit type chooses the version.** This replaces the rule that governed
  this repository while releases were cut by hand ("choose the bump by user-facing
  materiality, not commit type"). Automation cannot read materiality, so a hundred
  chores plus one `feat:` is a minor, and a window of `fix:`es is one patch. The
  direction of the error is the one this file already preferred: an under-called
  bump is corrected by the next release, an over-called minor permanently
  misreports how much changed.
- **Pre-1.0, a breaking change is a minor — never a major.** Majors stay reserved
  for "a version considered a distinct product from its predecessor", which no
  commit type can assert. `bumpVersion` will produce one only from a hand-written
  `--force-bump major`.
- **A window no conventional type describes releases nothing.** Hand-written
  subjects, or a squash-landed history with no conventional types, leave the
  derivation with nothing to classify: it lists those landings in the run summary
  and stops, because inventing a version from an unreadable window is worse than
  saying the window is unreadable. This is the one case that needs a human, and the
  escape hatch is the workflow's own input:

  ```sh
  gh workflow run auto-release.yml -f dry_run=false -f bump=patch
  ```

  A forced class is disclosed in the release notes for that release.

### Exercising the derivation without releasing

The workflow ships with a dry run, and the derivation can be driven locally against
the repository's real state. Neither pushes, commits, tags or releases anything.

```sh
# The workflow's own dry run; `dry_run` defaults to true on the dispatch path.
gh workflow run auto-release.yml

# The same question locally. With no flags it resolves BOTH bases from the newest
# released tag of any kind (that is the bound on what has not been released yet);
# `--base`/`--version-base` replay a past window instead (this is how the v0.24.0
# derivation was checked against the release that actually shipped).
node scripts/derive-release.mjs
node scripts/derive-release.mjs --base v0.23.5 --version-base 0.23.5

# What the loop guard answers for the current head, before the derivation runs:
# `"skip": true` means this push carries nothing the newest released tag does not.
node scripts/release-push-guard.mjs --json
```

### The one-off path, still needed

The automation covers the ordinary release, not every release. A window that must
ship without a conventional commit to derive from, a release cut while the workflow
itself is broken, a repaired Release, or a candidate that is not on `main` at all —
each of those still goes through a human. The manual path is now the exception
rather than the rule, and the pieces of it are:

1. **Land the bump as its own PR** — one commit, one file, one line, titled
   `chore(release): bump version to X.Y.Z`, with an independent review round on that
   diff (the guards below still apply to it). Landing it triggers Auto Release, whose
   loop guard then **skips** that push rather than failing on it: the bump PR lands
   nothing but the version line, so "nothing to release" is the designed answer. It
   has to be the designed answer in *this* shape too — this path lands the bump as a
   merge commit whose diff against the newest released tag is a whole window, which is
   the shape the guard used to miss.
2. **Tag the bump's merge commit and publish the Release as a pre-release**:
   `gh release create vX.Y.Z --target "$(git -C <repo> rev-parse origin/main)" --prerelease --notes-file <notes>`.
   While nothing else has merged past the bump, `rev-parse origin/main` *is* the
   bump commit. `publish.yml` still fires on the Release being published, which is
   what makes this path work at all. Keep the gap between 1 and 2 short: nothing is
   lost while it is open, but the next push to `main` refuses loudly until it closes
   (the recovery is under *Invariants*).
3. **Repairing an older Release** is a `workflow_dispatch` of `publish.yml` with
   `release_tag` and `expected_source_sha`. It attaches assets and **never
   promotes** — `scripts/release-state.mjs` refuses a promotion on that path, and
   that refusal is load-bearing: a repair must not move `latest` onto an old tag.

What still bites, and why, unchanged from when this file described only the manual
path:

- **Never pre-create a bare tag** (`git tag vX.Y.Z && git push --tags`) and then
  build a Release from it. `publish.yml` triggers on the *Release*, so a bare tag
  publishes nothing, and `gh release create` against an existing tag will attach
  notes to whatever SHA that tag already points at — which is how a release once
  shipped the previous version's code under the new number. Let
  `gh release create --target` create the tag.
- **Always publish the Release as a pre-release.** `electron-updater` reads its feed
  from `/releases/latest`, which answers with the newest non-pre-release Release
  whether or not it has assets; a full release published before its installers
  exist points the feed at a Release with no `latest*.yml` for the whole 25-35
  minute build, the metadata request 404s, and every running app filters that into
  "no updates available". `--prerelease` **is** the hold.
- **Derive the window from the commits, not from the commit shape** — plain
  `git log <the newest released tag>..origin/main`, never `--merges`. GitHub's merge button
  produces a merge commit that `--merges` sees and its squash button produces a
  single-parent commit that `--merges` silently drops, so a wrong window is not
  empty, it is **partially listed**, and a partially correct window looks right.
- **`git diff <last-tag>..origin/main -- package.json` must be empty before you
  tag.** A non-empty diff means a merged PR carried its own bump and consumed a
  number nobody published. The automated path checks the same thing itself
  (`assertVersionSurface` in `scripts/derive-release.mjs`) and refuses, naming both
  numbers, rather than deriving a version on top of a version surface it cannot
  account for.

### Invariants a future agent must not break

- **The artifact gate is the safety net that makes automatic releases defensible,
  and it must not be weakened to make automation easier.** `build-macos` runs
  `pnpm verify-macos-artifacts` and `check-packaged-closure.mjs` before anything is
  attached, and `finalize-release` promotes a Release to `latest` only once its
  assets are attached and verified. A release that fails the gate stays a
  pre-release with no assets, out of `/releases/latest` — which is exactly what
  `v0.23.2` did, and it worked.
- **The tag goes on the bump commit, never on `main`'s head.** `validate-release.mjs`
  re-reads `package.json` at the tag and requires it to equal the tag's number;
  tagging the head publishes the previous release's code under a new number, and the
  tag, the Release, the installers and `package.json` all agree with each other about
  the wrong tree, so nothing looks wrong. Do not "simplify" that check away — it is
  the only thing tying four artifacts to one tree.
- **A `DIRTY` branch gets no CI at all, so a green head is not evidence on its
  own.** GitHub does not run workflows on a merge commit it cannot create: a PR with
  a conflict keeps the *older* green run and acquires no new one. Check
  `gh pr view <n> --json mergeStateStatus` (or `gh pr checks <n>`) before you rely
  on green, and re-check after any rebase. The same trap in a different costume is
  reviewing a SHA that is no longer the head.
- **Never force-push, and never merge on a red required job.** `main` has no
  ruleset requiring checks, so nothing makes a violation impossible — the
  `version-bump-guard` and CI make it *loud*, and the merge is still the agent's to
  refuse.
- **A version bump on a feature branch is still a defect**, and the automated path
  depends on that staying true: it derives the next version from the last released
  tag, and a stray bump on `main` makes that derivation refuse (see
  `assertVersionSurface`). The workflow's own bump is the one commit exempt from
  this, which is why it is committed directly to `main` and skipped by the push
  guard on its **content** rather than its subject (see *The automatic release*).
- **Write access to `main` is release authority, and it is the widest control this
  repository has.** `main` is not protected and carries no ruleset —
  `gh api repos/<owner>/<repo>/rules/branches/main` answers `[]`, the check this file
  already prescribes — so nothing mechanical prevents a direct push, and under the
  automation a direct push **is** a version, a tag and a signed Release. The agent
  review round is therefore the only thing standing between a change and a shipped
  release. Read every "who can reach the signing key" question against that boundary:
  the `signed-update-candidate` environment does not narrow it (*The automatic
  release* says exactly what does).
- **A run that dies between the bump push and the tag stops the train, and the
  recovery is a tag.** `main` then advertises a version no Release explains, so every
  later push refuses on `assertVersionSurface`, naming both numbers, until somebody
  closes it. Either finish the release —
  `gh release create vX.Y.Z --target <the orphaned bump commit> --prerelease --notes-file <notes>`
  — or drop the bump with `git revert <the bump commit>`, which the loop guard
  recognises as carrying nothing to release. Both need only the write access a
  release always needs, and neither is something to leave unattended: this is the one
  state the automation cannot get itself out of.

## Notes for Future Agents

- **Merging is releasing.** Land the PR as soon as its review rounds are clean and
  fresh and CI is green; the Auto Release workflow derives the version from what
  you merged and cuts the Release with nobody deciding anything. Do not bump the
  version on your branch: `version-bump-guard` fails that on a PR, and a stray bump
  on `main` makes the next derivation refuse (see `assertVersionSurface`).
- **Your commit type chooses the bump, so choose it deliberately.** `feat:` is a
  minor, `fix:`/`perf:`/`revert:` are patches, and a window of docs/chore/ci/test/
  refactor/style/build releases nothing at all. A PR body may still carry
  `Release: <patch|minor> — <impact>`: the generated notes quote that line verbatim
  for that PR, and a PR without one contributes no impact sentence, which the notes
  say rather than filling in.
- **A request to *implement* something is still not a request to release it** — but
  under this workflow, landing it *is* what releases it, so a user-visible change
  belongs in the PR description where the notes will not have to guess at it. If the
  developer asks for a release the automation cannot serve (a window no conventional
  type describes, or a broken workflow), use the one-off path or the `bump` input
  above and say which you used.
- If there are unrelated uncommitted changes, do not discard them; proceed
  carefully and scope your commit.
- Keep release notes aligned with prior repository style, cover **every** PR in the
  window, and include a compare-link changelog. The workflow generates the
  mechanical part; a human may edit the body afterwards, and nothing re-renders it.

## Who may merge: agent review is sufficient for a code owner

Code owners are listed in `.github/CODEOWNERS`. **This repository has no
ruleset requiring an approving review**, so there is no approval gate to clear
here — `CODEOWNERS` routes review requests, it does not block merges. Confirm
that with `gh api repos/damianvtran/local-operator-ui/rules/branches/main` (`[]`
means nothing is enforced), never with the legacy
`branches/main/protection` endpoint: that one answers `404 Branch not protected`
even for a branch a modern ruleset *is* enforcing, so it is the wrong question.
The rule
below is therefore about what makes a merge *legitimate*, not about what the
forge will let through.

When the agent is **acting for a code owner** — running on a code owner's
machine and under their account, which is the normal case here — the standing
agent review gate is what authorizes the merge. A clean, fresh, independent
agent review round plus green CI is sufficient; do not wait for a second human
to click approve. Nothing here is permission to merge on a *weaker* basis than
that just because the forge would allow it: with no ruleset in the way, the
agent review round is the only real control this repository has.

If a code-owner ruleset is ever enabled here, read the backend's
`AGENTS.md` § "Who may merge" first — it documents a self-approval limitation
that bites the moment such a rule exists.

This is a statement about *authority*, not about rigour. Every requirement
still holds in full: an **independent** reviewer subagent (never the agent that
wrote the code), rounds repeated until no blocker or major remains, review
freshness against the current head, QA evidence from the real running surface,
and a design/UX round for anything user-visible — which, in this repository, is
most changes. Merging is authorized by the review being genuinely clean, never
by the merger being entitled to it.

Two things this does not license:

- **Never approve your own work to satisfy the rule.** The author and the
  reviewer must be different agents. GitHub cannot tell them apart, because
  every agent here pushes as the same account — so this separation is a
  discipline the agents keep, not one the forge enforces.
- **`--admin` stays a last resort, and stays disclosed.** If a bypass is ever
  genuinely necessary, say plainly on the PR and in the release notes that the
  merge bypassed rather than cleared review. A tag that implies a review it
  never had is the failure this section exists to prevent.

An agent that is **not** acting for a code owner prepares the PR, records the
review rounds, and hands it to an owner to merge.
