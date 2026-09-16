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
- Built app, no window: `pnpm app:headless <extra electron args>` (no `--`
  separator — see the launch section)
- Built app, driven by an agent: `pnpm app:driver` (see `docs/agent-driver.md`)
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Lint scope over the scripts tree: `pnpm lint:scripts`. `pnpm lint`'s path list is
  hand-written and leaves `scripts/` out — the proof harnesses, evidence rigs and
  release gates, i.e. the code that decides whether other things are verified —
  which is how a formatter error rode into a merged pull request green. This gate
  runs the same `biome check` over the `scripts/` files a change touches, compared
  against a base ref (`origin/main` locally, the merge commit's first parent in
  CI), so a violation cannot ride in with the diff that introduces it. The rest of
  that tree's pre-existing backlog is burnt down as files are touched; widening
  `pnpm lint` to name `scripts/` outright is the follow-up once it is gone. See
  `scripts/check-scripts-lint.mjs`.
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

**A commit that moves `src/` or `scripts/` costs every open branch two commits.**
`docs/evidence/manifest.json` pins `srcTree`/`scriptsTree` to
`git rev-parse HEAD:src`/`HEAD:scripts`, and the gate fails a mismatch with "re-capture
and re-stamp" rather than a warning - so `main` moving a rig, or any sibling branch
landing one, invalidates the stamp for everybody holding a branch, whether or not
that branch's own frames changed. That is the convergence cost of the file, and the
reason a sync here ends with a re-stamp-only commit whose message says what moved,
what did not, and why. Only `pnpm check-evidence` checks it, and that is the command
that defers (exit 75) while another sweep holds the lease, so a stale stamp is
invisible locally until a sweep actually runs: re-derive both from the tree you are
committing (`git rev-parse HEAD:src`, `HEAD:scripts` after staging) rather than
letting the next author rediscover it.

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

**Every agent-driven launch must name a window mode, or pass a switch that
implies `headless`.** The app resolves it from `--window-mode=<mode>` or
`LOCAL_OPERATOR_UI_WINDOW_MODE` (the argument wins), and takes
`--window-size=WxH` or `LOCAL_OPERATOR_UI_WINDOW_SIZE` for the size:

| Mode | The window | Use it for |
| --- | --- | --- |
| `headless` | created at the requested size, **never shown**, unfocusable, page unthrottled, no native banners | every test, QA, harness and evidence run — the default choice |
| `inactive` | shown with `showInactive()`: visible, but the app is never activated and the window never takes focus | a run somebody wants to watch or click into, and anything focus-dependent |
| `normal` | `show()` — raises and focuses the window | a human starting the app. Never an agent run |

**Leaving the mode out of a rig-shaped launch is `headless`, not `normal`.** A
launch has said it is a run rather than a person using the app in either of two
ways, and either one resolves it to `headless` with the startup line naming which
signal said so. The first is a switch only a rig passes: a scratch
`--user-data-dir` or a `--remote-debugging-port`. The second is shape rather than
vocabulary — **the launch is not a packaged app and has no terminal on either
stream**, which is what every tool-spawned launch looks like: a harness boots
`out/main/index.js` out of a checkout, a QA matrix boots a copy of one under
`/tmp`, and a tool spawns both with pipes where a person's terminal would be.
That second signal is not decoration. Measured on this machine after the
switch-based assumption shipped: every launch in a full afternoon's shared app
log still ran `normal` — including ten boots in seven minutes from a flagless
harness — because the rigs that take the operator's focus are exactly the ones
that never learned to pass a switch. `packaged` is the half that keeps the
shipped app out of it: the `.app` a person double-clicks also has no terminal, so
it is never assumed headless, whatever its streams look like. This is the belt to
the rule's braces: the rule above is enforced by every caller remembering it, and
the afternoon on this machine that left nine Electron windows in the dock — each
of them stealing focus as it appeared — was nine callers that had not. A launch
that names no mode, passes neither switch, and is either packaged or still
attached to a terminal is the operator's own app, and stays `normal`.
An empty or blank `LOCAL_OPERATOR_UI_WINDOW_MODE` (`env MODE="$MODE"` with
`MODE` unset, a harness env block with an empty default) names nothing and is
treated the same way; a value the app cannot parse is a *typo*, keeps its
`normal` fallback, and is reported, because a caller who reached for the mode is
asking to be told rather than defaulted at.

The shape signal is read on **macOS and Linux only**. Windows is deliberately
outside it: a Windows GUI-subsystem process takes its stdio through
`AttachConsole` rather than an inherited handle, so `isTTY` there is not the
terminal fact it is on the platform this rule was measured on, and hiding a
window on an unmeasured signal is the worse failure. A Windows rig keeps the
historical `normal` for a flagless launch and names its mode, exactly as it had
to before the shape rule existed; enabling it is one measured Windows boot away.

Two things follow from the assumption, and neither is only about pixels. The
`--remote-debugging-port` half is the deliberately loose one: attaching DevTools
to your own app is a normal thing to do, and such a launch resolves `headless`
too — name `--window-mode=inactive` when you want to watch a run, since that
mode is shown without ever being activated. And the mode is read by two other
decisions: the renderer dev driver refuses to arm unless the mode is `headless`
or `inactive`, so `LOCAL_OPERATOR_UI_DEV_DRIVER=1` on an assumed-headless launch
now arms instead of printing a refusal, and the browser host takes the plan's
`show` to suppress consent banners. Both directions are the safe one, and both
are why an assumed mode is reported on stdout rather than left implicit.

```bash
# The built app, driven over CDP at an exact size, with no window at all.
#
# NO `--` BEFORE THE EXTRA SWITCHES. `pnpm run <script> -- x` passes that `--`
# through to Electron's argv as well, and CHROMIUM STOPS READING SWITCHES AT
# `--`: everything after it is ignored, so a run that believes it is on a
# scratch profile silently lands on the operator's own one instead (measured,
# QA round 1 Q-1: the flag was in argv and `USER_DATA` stayed
# `~/Library/Application Support/Electron`). pnpm forwards the switches
# themselves without it.
pnpm app:headless --remote-debugging-port=9451 --user-data-dir="$SCRATCH/profile" \
  --window-size=1380x900

# The dev app, same rule.
pnpm dev:headless

# `electron-vite dev` takes its own options and spawns Electron itself, so a
# Chromium switch handed to it — with or without a `--` — does not reach the
# app's argv (measured: the app reported the default 1380x900 when
# ELECTRON_CLI_ARGS asked for 1024x768). A dev run that needs a scratch profile
# therefore cannot get one from argv; build first and use the line above, or
# accept the profile the dev app already uses.

# A harness that already spawns Electron itself: the switch rides the environment.
LOCAL_OPERATOR_UI_WINDOW_MODE=headless npx electron . --remote-debugging-port=9451

# Omit the mode and it is still headless: the scratch profile says what this is.
npx electron . --user-data-dir="$SCRATCH/profile" --remote-debugging-port=9451

# And a launch that passes NOTHING is a run too, when it is not a packaged app
# and has no terminal on either stream. That is a rig's shape rather than a
# person's — a person typing the same command in a terminal still gets a window
# — and it is the shape that was still stealing focus, so name the mode anyway.
npx electron ./out/main/index.js --window-mode=headless --window-size=1380x900
```

`npx local-operator-ui` spawns Electron with this process's environment, so the
same switch covers a check of the published launcher — **from the release that
carries the shape rule**. Two version floors matter, and they are not the same
one. Window mode itself (the `--window-mode` flag and the environment variable)
landed in 0.19.2; the shape rule lands in the release carrying this change. An
install older than 0.19.2 — the one on this machine was 0.17.2 — contains no
window mode at all and **cannot be silenced**: it pops a window however it is
piped, and the environment variable is inert, so naming it there proves nothing
and reads as a broken rule rather than a stale install. Check the launcher from
a checkout's own build, or upgrade, and only then name the mode. From 0.19.2 the
variable works; from the release carrying the shape rule the launcher is also an
unpackaged launch, so a *piped* one (`local-operator-ui | tee run.log`, a
launcher script, a CI job) is assumed `headless` by the shape rule above — a
non-terminal launcher that really wants a window names `--window-mode=normal`,
which wins over every assumption here. Any mode but `normal`
prints a `[window-mode] ...` line to the process's own output, so a run says out
loud that it was headless instead of looking identical to one that popped a
window — including when the mode was assumed, which it names along with the
signal that implied it. A mode or size the app could not honour is printed there
too, not only to the backend log: a typo like
`LOCAL_OPERATOR_UI_WINDOW_MODE=hedless` falls back to `normal`, which is the
difference between a headless run and an interruption, and it must be visible to
whoever launched it.

**A second launch raises the window only as far as the REQUESTING launch asked.**
Why it is not automatic: the single-instance lock is taken PER PROFILE, so a run
that shares the operator's profile is refused by it and the instance that ALREADY
holds the lock is the one that decides what happens next. It used to decide with
its own plan, so an agent's deliberately invisible run answered as an ordinary
launch — `show()` + `focus()` for a running app — and pulled the operator's window
to the front. The mode now travels with the request, and either channel is
enough: the losing launch forwards the mode it resolved (the
`LOCAL_OPERATOR_UI_WINDOW_MODE` it was launched with), and `--window-mode=<mode>`
on its command line is read as well, because that is the spelling that survives a
launcher which drops the environment (macOS `open --args`). An UNDECLARED second
launch keeps today's `show()` + `focus()`, since that is a person double-clicking
the app while it runs; a `headless` request delivers the conversation it names to
the renderer and raises nothing at all.

That last promise holds in every state the running app can be in, INCLUDING the
one where it holds the lock with no window open (Cmd+W on macOS keeps the process
alive), and it is why `never` is the one plan that may not create a window at all.
An `inactive` request that arrives then makes a window, and that window is
presented under the REQUESTER's plan rather than the running app's: whoever
threads a new present site through the window-creation path has to carry that plan
with it, and `scripts/window-mode.test.mjs` fails on a present site that reaches
for the process's own plan instead.

A `headless` request that NAMES A CONVERSATION against an app that already HAS a
window delivers the conversation to that window and raises nothing, which is the
mode's promise; against an app with NO window it creates nothing and parks the
conversation instead, and the operator's next window opens it. An invisible window
is not a harmless one: macOS keeps the app alive with the renderer warm, so the
Dock icon would activate an app showing nothing while a conversation sat in a
screen nobody could reach. Nothing appears and nothing is raised — and a park is
NOT silent: the winner writes `trigger=second-instance mode=headless requested=never
parked=<id> applied=parked` (the conversation that is waiting), so the log answers
"what happened to what I asked for" for the requests that raise nothing.

THE QUEUE IS BOUNDED, AND EVERY WAY AN ENTRY LEAVES IT IS A LINE. At most sixteen
conversations wait in memory; a seventeenth drops the oldest, and the drop is
written (`applied=evicted`) rather than being silent, because a bound nobody can see
is the same class of silence the park line removed. A park that reaches a renderer
says so (`applied=delivered`), which is what lets the log answer "did the
conversation I parked ever arrive?" — the question a park without an ending left
open. AN ENTRY LEAVES THE QUEUE WHEN ITS SEND HAPPENS, not when a window is created:
a window closed before its renderer finished loading leaves the conversation queued
(`applied=left+waiting`) for the next window rather than taking it away silently, and
anything still waiting when the process quits is written as `trigger=app-quit ...
applied=dropped+quit`. All of those names come from the app's own `[window-raise]`
line, and `scripts/window-mode.test.mjs` holds the shapes.

THE PARK IS A QUEUE, AND THE CREATOR OF A WINDOW ALWAYS WINS IT. Every parked
request waits, and the next window drains them in ARRIVAL ORDER: the first becomes
that window's initial session (its first frame, not a swap) when the window's own
request named no conversation, and the rest are delivered to it once its renderer
can hear them. A window opened for something else — a catalogue click, a viewer
`resume_session`, a banner click, a person's launch that named a conversation —
opens what ITS request asked for, and the parked conversations follow it, so the
last one is what the operator lands on and none is dropped.

For the same reason an app with NO window answers a second launch that names no
conversation at all: a request that may come forward opens the app's own window (it
used to do nothing, so launching the app again looked like nothing happening),
while `headless` still opens nothing. A DOCK CLICK PRESENTS THE WINDOW UNDER THE
OPERATOR'S PLAN, not under the launch's: the window mode is a promise about the
LAUNCH, and `app.on("activate")` — which runs when the app has NO window, that being
the only state it creates one in — is a person asking for the app they already have
open. Answering that with a window nobody can see would leave the parked
conversation in an invisible screen with the queue emptied into it.

The losing launch says what it did, because nothing else can: it prints
`[second-instance] this launch did not start a window of its own: the app already
open is the instance answering (profile: <path>), and this launch's window mode
(<mode>) was handed to it — <what the running app will do>. Quit that app to start
a fresh instance. Exiting.` The profile path is the proof a rig needs and the app-is-
already-open fact is what a person can act on; the effect names what the mode can
actually do (a `headless` request's conversation is delivered once a window is open,
not when the request lands). It does NOT print the `[window-mode]` line, which
describes the window this process never creates.

An `inactive` request orders a window that is already on screen and never
un-minimises one, BY ORDERING OR BY RESTORING: `restore()` is a focus-class act, and
macOS deminiaturises a window as part of ordering it, so `showInactive()` alone
brought a Dock-ed window back (measured). A minimised window is therefore left
exactly where it is — and the decline is REPORTED (`applied=skipped+minimised`),
because a request that was declined must not look like one that never arrived.
Undeclared and `normal` requests keep restoring, because those are the ones that
mean "bring this to me".

Every raise writes one line to the backend log, naming the site, the mode and
what it did — ONE line per present: the window's `ready-to-show` handler is
one-shot, because it can fire twice for one window (a reload) and two identical
lines for one window is a log a person cannot read.

```
[window-raise] trigger=second-instance mode=normal requested=focus pid=9182 \
  cwd=/Users/someone/project applied=restore+show+focus
```

The triggers are `initial-present` (this process's own launch, including a window
created for a conversation and presented late), `second-instance`, `banner-click`,
`viewer-focus` and `viewer-resume` — one name per REQUEST, so the three requests
that deliver a conversation before raising are told apart rather than collapsing
into one. `mode` is the mode token a reader greps for; `requested` is the show
policy it produced; `pid`/`cwd` are printed only when the requester declared them
across the single-instance boundary, and their absence means this process asked
itself. A mode that raises nothing writes nothing: a headless run leaves no trace,
its log included.

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
`session-cookie-restart-proof`), the hop rig
(`notification-hop-proof`, which booted with the manager ENABLED on purpose —
the environment that backend child is handed is what it measures, so the switch
is load-bearing twice over there) and the `app:headless` / `dev:headless` scripts.
`scripts/notification-spawn-sites.test.mjs` enumerates those sites and fails on
a new one that is not in its table, because the rig somebody adds next month is
exactly the one that will forget. Its reach is the site, its index and the
kill-switch binding: the tree-ownership rule above - `detached`, the group signal,
the profile reap - is asserted by no test, so it is enforced by review (R4). The
deliberate exceptions
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
of the app→backend hop — which `scripts/notification-hop-proof.mjs` makes
re-runnable rather than a command retyped from the transcript. **A rig that boots
the app owns the whole process TREE**: spawn the runtime binary rather than the
`node_modules/.bin/electron` shim (the shim's child is the app, so a signal to the
pid the rig holds orphans it), spawn `detached` and signal the GROUP, and keep a
profile-match reap as a backstop whose kills are still by exact pid. Measured:
the hand-run hop command left two headless trees of eight processes each with
roots at `ppid 1`, and the app's single-instance lock - PER `--user-data-dir`
rather than machine-wide, as `renderer-driver.mjs` measures - then turned the
following launch in that same tree into "Another instance is already running".

### A `headless` run takes no Dock tile, and leaves when its launcher does

Two things `headless` does differently from every other mode, both of them about
not accumulating on the operator's machine. The behaviour is in
`src/main/window-mode.ts` (`hideDock`, `resolveLauncherWatchPlan`), applied in
`src/main/index.ts`, and the watch itself is `src/main/launcher-watch.ts`. The
three ends a harness can set off — its window closing, its launcher going, a
signal — all funnel through `endHeadlessRun`/`armHeadlessExitDeadline`; the app's
other quit descents (the smoke-test exit, the update-install path) keep the
bounds they already had.

- **No Dock tile (macOS).** A headless run is an app nobody is using — the
  window is never shown, so the tile leads nowhere — and it is the mode this
  repository boots tens of times over on one laptop. Measured: one evidence
  session left ~30 of them in the operator's Dock, which is how the defect below
  was noticed. `inactive` keeps its tile and icon and is the path back for a run
  somebody wants to find and click into; `headless` is for runs nobody is
  watching. (That path back is a MODE, so it also drops the lifetime behaviour:
  only `headless` is launcher-bound, and an `inactive` run is ended by a person
  or by its own window, not by the watch. `LOCAL_OPERATOR_UI_HEADLESS_KEEP_ALIVE=1`
  extends a run's LIFE and not its visibility — it does not bring the tile back.)
- **It leaves when its launcher does.** The pid that launched the app (its
  `ppid` at startup) is polled every 2 s, and the app quits when that process is
  gone — after two consecutive misses, because a single one is a race. Being
  reparented (`process.ppid` no longer naming the launcher) counts as the same
  fact seen from the child's side. `app.quit()` goes first; if the process is
  still alive 10 s later it exits anyway. **An escalated exit is still status
  0**, on all three paths, for the reason each of them is legitimate: the
  launcher path is a run ending because the thing watching it went away, a signal
  or a closed window is a run the caller asked to end, and in every case the
  deadline says only that the graceful descent did not finish in time. So a
  harness must not read the exit status as the signal; the `[window-mode]` line
  (or the `launcher probe` line in the log) is what says which path ended it.
- **A signal ends it too.** `SIGTERM`/`SIGINT` are handled in `headless` only
  (never on the shipped app: Ctrl-C must not change meaning for a person), which
  turns Chromium's shutdown — it closes the window and then leaves the process
  alive — into the same bounded exit. `window-all-closed` covers the other case,
  a genuinely closed window (a driver closing it over CDP reaches it, measured
  at ~1 s), and NOT a signal: an app-initiated quit emits no
  `window-all-closed` at all.

What a rig can read: every mode but `normal` prints the mode line and then the
launcher policy — `window mode headless: 1380x900, window created and never
shown, page throttling off, no Dock tile` (the tile clause is macOS-only, and a
Linux or Windows rig sees the same line without it), then `headless run launched
by pid N; it quits when that process goes` (or the reason it is *not*
launcher-bound).

A launch that was **assumed** to be a run appends the reason it decided that, and
the aside trails the sentence so the prefix above is the same on both spellings:

```
window mode headless: 1380x900, window created and never shown, page throttling off, no Dock tile (mode assumed: --user-data-dir marks an agent-driven launch, and no window mode was named)
```

Both spellings are quoted because a rig anchored on the whole named sentence
never matches an assumed run, which is the common case for a harness. (The aside
trails rather than sitting after the mode because of what an infix cost: 86
characters between `headless` and its colon, which moved the colon to printed offset 120
(106 in the sentence itself, before the `[window-mode] ` prefix) and made a
wrapped row begin with `: 1380x900, …` — design round 4, D18.)

`normal` prints neither, so a harness waiting for a policy line on a `normal`
boot waits forever. The mode line deliberately says nothing about the launcher:
it is printed before that policy is resolved and would be wrong in exactly the
two cases where a run does not leave by itself.

Same defect, both halves of it: a harness that signalled the launcher — the
`node` process the pnpm `electron` shim `exec`s — rather than the app left the
app running with no driver, one instance per boot. Measured here: 13 boots in a
QA round left 13 survivors, all `ppid 1`, and a matrix left ~30. Both halves are
closed as this repository now stands: **the watch** ends a run whose launcher is
gone, and **the driver** (`#190`, `e83ab9b1f`) spawns the app binary itself,
signals the app's own main process by exact pid — `SIGTERM`, then `SIGKILL` on
that same pid — and reaps what it started, however the run ends.

What this does NOT cover, stated because it is easy to over-read:

- A run with **no launcher at startup** (`ppid 1`) is left alone rather than
  guessed at. Note what does and does not produce that: neither `detached: true`
  nor `setsid(2)` reparents a child — only the parent's exit does — so a
  `detached: true` spawn still has a real launcher pid and **is** watched. What
  `ppid 1` at startup means is that the run was orphaned before it could look,
  and such a run **must reap its own instances** — nothing here can end it.
  `LOCAL_OPERATOR_UI_HEADLESS_KEEP_ALIVE=1` is the explicit way to say "this run
  means to outlive its launcher".
- The escalation's emergency stop kills a **registered** owned backend child. A
  boot still installing its managed runtime has no such child yet, so a deadline
  that lands in that window can leave that work behind; the `serve` child a
  harness boots against is registered long before the window is driven.
- A launcher that kills *nothing* still leaks: the watch fires when the launcher
  is **gone**, so a driver that stops the wrapper and stays alive itself holds
  its app until the driver exits.
- A harness of your own is still yours to stop by **pid**: a `pkill` by pattern
  takes the operator's own running app with it. (`stopApp()` in
  `scripts/renderer-driver.mjs` used to signal the launcher rather than the app;
  that half has since landed — see the paragraph above.)

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

### A rig's Chrome does not touch the keychain either

The same rule one runtime over: a capture rig's browser must not reach the
operator's desktop. On 2026-09-15 the rigs below started raising **"Keychain Not
Found — A keychain cannot be found to store "Chrome.""** on the operator's
screen, Chrome's icon and `Cancel` / `Reset To Defaults` included. macOS
resolves the keychain from `HOME`, and these runs are normally invoked with
`HOME` and `TMPDIR` pointed at a scratch directory so a run cannot write into the
operator's own config and session store — in which case there is no login
keychain in reach at all. Chrome then cannot encrypt its cookie store
(`Encryption is not available.` on its stderr), a `Network.setCookie` that
answers `success: true` writes no row to the profile, and macOS logs `authd …
Failed to authorize right 'system.keychain.create.loginkc' by client
'/Applications/Google Chrome.app'` — Chrome trying to CREATE one, which is the
alert. Two such denials two minutes apart (`17:29:36`, `17:31:42`), with the
same log showing five Chrome processes reaching the Security framework in
`17:27:40`–`17:29:36`, is why it kept coming back.

`scripts/chrome-keychain.mjs` exports `withMockKeychain`, which puts
`--use-mock-keychain` on a rig's Chrome argv so OSCrypt uses a constant mock key
and Keychain Services is never called. Every rig that launches Chrome routes its
argv through it — the nine in `scripts/` and the three under
`docs/evidence/<surface>/harness/`, which are archived beside their frames but
are still runnable — and `scripts/chrome-keychain.test.mjs` scans for the calls
that start Chrome and fails on one that does not. That scan states its own
bound rather than promising more than it can see: `.mjs`/`.js`/`.cjs` files under
`scripts/`, `bin/` and each `docs/evidence/<surface>/harness/` tree, a command
token that says `chrome`, and a spawn spelled with one of six call names
(`spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync`, a namespace
prefix like `cp.spawn` included). A rig added as a `.ts` file, or in a directory
outside those roots, is review's business rather than that test's — the test's
own docstring says the same thing, and so does this paragraph.

What this deliberately does not touch: the rigs that boot the PRODUCT are
outside the Chrome scan by construction, and the ones that reach the real
keychain do it on purpose — `session-cookie-restart-proof.mjs` symlinks the
scratch `HOME`'s `Library/Keychains` at the real one, and
`session-cookie-electron.test.mjs` does not override `HOME` at all, because
Electron's own `safeStorage` round-trip is what they prove. The rigs that boot
the app with an EMBEDDED Chromium under a scratch `HOME` (`browser-chrome-proof`,
`browser-host-proof`) do not prompt either, and the reason lives in the app
rather than in them: `src/main/browser/session-cookies.ts` asks the cheap
question first — whether `~/Library/Keychains/login.keychain-db` exists — and
fails closed, because calling `safeStorage` in that state can block the main
thread (measured: 7785 ms in Electron 44.3.0) or wait on a SecurityAgent prompt
an unattended launch can never answer.

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

## Releasing: one owner per window, and no version bumps inside feature PRs

**Releasing is a decision a person makes, separately from merging.** Merging
accumulates commits on `main`; a **release owner** then spends one version number
for the whole window, tags it, writes the Release notes by hand and publishes a
GitHub Release. That Release is what starts `.github/workflows/publish.yml`, which
validates the tag, holds the Release out of `/releases/latest`, publishes to npm,
builds and attaches every platform's installers and update metadata, dispatches the
signed-update verification and promotes the Release once its assets are complete —
with no manual step on the pipeline. So **merging is not releasing**: a merged PR
that has not been released yet is the normal state of `main`, not a problem to fix,
and a request to *implement* something is not a request to *release* it.

That used to be the other way round, and the history is worth keeping because it
explains why the trigger is a *published Release* and nothing else. The deleted
`.github/workflows/auto-release.yml` derived a version from merged commit subjects,
landed the bump on `main`, tagged it and created the Release with `GITHUB_TOKEN`. A
Release created with that token starts no workflow run at all — GitHub's
anti-recursion rule — so the pipeline could only be reached through a
`repository_dispatch` carrying the tag, its commit and the release ID: three moving
parts around a version nobody chose, and both of that design's failures lived in the
dispatch (the node-id spelling documented at the top of `scripts/validate-release.mjs`,
and an empty derivation read downstream as "nothing to release"). A person creating
the Release removes the mechanism instead of maintaining it: a human-created Release
fires `release: published` directly, and the tag, its commit and its ID arrive in
that event's own payload.

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

### Choosing the bump BY MATERIALITY, not by commit type

One bump covers the whole window, and its size is a judgement about what users
receive, argued per window rather than derived per commit:

- **patch** is the default, and it is the right answer for almost every window: a
  set of fixes, internal changes, performance work and small features that together
  make the app better without changing what it is.
- **minor** when a single PR in the window is a step-function capability in its own
  right — something a user would call a new thing the app can do, not more of what
  it already did. One such PR is enough; a window of many ordinary changes is not.
- **major** only for "a version considered a distinct product from its predecessor".
  Nothing in a commit history can assert that, so it is a human decision with a
  human sentence attached to it, and pre-1.0 it does not arise at all.

Two habits make this cheap. The **direction of the error** matters, and this
repository prefers under-calling: an under-called bump is corrected by the next
release, while an over-called minor permanently misreports how much changed. And
every PR carries its own claim in its body — `Release: <patch|minor> — <one-line
user impact>` — which is what the owner reads when collecting a window, and what
the Release notes quote verbatim. A PR without one contributes no sentence, which
the notes say rather than inventing one.

Commit *types* no longer choose anything: the machinery that read them is deleted,
and a `docs:`-only window can be released as a patch if a user-visible fix rode
along with it. Conventional types still describe the change, and the review round
still reads them; they simply stopped being a version.

### The window, and the release owner's procedure

A **window** is the PRs merged since the previous tag that land around the same
time — in practice, everything that merged before the owner starts cutting. The
owner picks **one** bump for all of it, and a PR that lands late rides the *next*
window rather than delaying this one: the owner never waits for an unready PR.

**One owner per window, and the ownership is a claim rather than a lock.** Before
cutting, ask whether somebody already owns the current window — with parallel agent
sessions that means `lop sessions` and a message to the peers you find — and if one
does, hand them the PR number, the merge SHA and the bump you would argue for
rather than tagging over them. If nobody does, say so and become the owner. Two
owners at once produce two tags on two commits, and the second Release is the one
that ships the wrong tree.

```bash
# 0. A fresh tree, never a bump sitting on a feature branch.
git fetch origin --tags && git switch -c chore/release-X.Y.Z origin/main

# 1. Collect the window and pick ONE bump by materiality (see above).
git log --first-parent --oneline v<PREV>..origin/main
gh pr list --state merged --limit 60 --json number,title,mergedAt,mergeCommit

#    BEFORE landing the bump, prove nothing already spent this version:
#    a non-empty diff means a merged PR carried its own bump and consumed a
#    number nobody published. This check is the whole of that guarantee now.
git diff v<PREV>..origin/main -- package.json

# 2. The bump PR: package.json only, one line, title `chore(release): bump version
#    to X.Y.Z`, independent review round on that diff, and green CI. Then merge it.
MERGE_SHA=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)

# 3. Tag and Release in ONE step on that SHA, notes hand-written from the template.
cp .github/RELEASE_TEMPLATE.md /tmp/vX.Y.Z.md && $EDITOR /tmp/vX.Y.Z.md
gh release create vX.Y.Z --target "$MERGE_SHA" --prerelease \
  --title 'X.Y.Z: <theme>' --notes-file /tmp/vX.Y.Z.md

# 4. Confirm the pin and watch; nothing manual follows.
#    Peel it. `git ls-remote --tags origin vX.Y.Z` prints the TAG OBJECT when the
#    tag is annotated - v0.23.5 reads fc5ab4a90 there against a commit of
#    4043e95fd - so the unpeeled form reads as a mismatch on a tag that is
#    perfectly good, at the one moment the check exists for. `^{commit}` answers
#    for both spellings, and the forge is still the one answering it.
git fetch origin --tags
git rev-parse "vX.Y.Z^{commit}"   # must print $MERGE_SHA
gh run list --workflow=publish.yml --limit 3 && gh run watch <id>

# 5. Post the tag and the Release URL on every PR in the window.
```

**Why `--target` and not `git tag vX.Y.Z && git push --tags`.** A bare tag
publishes nothing — `publish.yml` triggers on the *Release* — and `gh release
create` against a pre-existing tag attaches the notes to whatever SHA that tag
already points at, which is how this repository once shipped the previous release's
code under a new number. `--target` creates the tag on exactly that commit, and
`scripts/validate-release.mjs` re-resolves it and pins it before anything is built.

**Always publish the Release as a pre-release.** `--prerelease` is the hold, not a
formality: `electron-updater` reads its feed from `/releases/latest`, which answers
with the newest non-prerelease Release whether or not it has assets, so a full
Release published before its installers exist points the feed at a Release with no
`latest*.yml` for the whole 25-35 minute build, the metadata request 404s, and every
running app filters that into "no updates available". Publishing it as a
pre-release means the previous, complete Release keeps answering until this one
can.

**The writeup is hand-written, and the pipeline enforces it.**
`scripts/release-state.mjs` refuses a Release whose body is empty or is GitHub's
generated draft (`## What's Changed`), and annotates one that carries neither a
`## What's New` heading (matched case-insensitively; every release here since
v0.23.0 spells it `## What's new`) nor a `Full Changelog` compare link. The refusal is
raised in the run's second job, and every job that can ship something — the npm
publish, the three installers and the promote — declares that job as a dependency,
so a refused writeup skips all of them rather than publishing to npm beside them:
Actions never cancels a sibling for another job's failure, and a job gated on
`validate-release` alone would happily run next to a failing window. Recovery is
editing the Release body and re-running the failed run: the re-run replays the
Release event and the script re-reads the Release, so the corrected body passes. A
fix to the workflow's own code is *not* picked up that way. Never
`--generate-notes`, and never the web UI's "Generate release notes".
`.github/RELEASE_TEMPLATE.md` is the shape, and its header carries the rules.

**Repairing a Release** is a `workflow_dispatch` of `publish.yml` with
`release_tag` and `expected_source_sha`. It re-attaches assets for an older tag and
**never promotes** — `scripts/release-state.mjs` refuses a promotion on that path,
and that refusal is load-bearing: a repair must not move `latest` onto an old tag.
It is also not gated on the writeup, because an old Release's body is whatever it
shipped with.

**What this deliberately gave up.** The deleted `scripts/derive-release.mjs` carried
`assertVersionSurface`, an assertion that `main`'s `package.json` version was itself
a released tag before any derivation ran — the check that caught a merged PR
carrying its own bump. There is no on-`main` guard left, because there is no
derivation to guard. What remains:

- **at PR level**, `version-bump-guard` still refuses a version change outside a
  `chore(release):` PR;
- **at release level**, `scripts/validate-release.mjs` still ties the tag, the
  `package.json` at that commit and the resolved SHA together, so a tag cannot name
  a tree whose version disagrees with it;
- **at window level**, the owner's
  `git diff <last-tag>..origin/main -- package.json` check above, which is now the
  only thing standing between a stray bump and a skipped release — run it every
  window, and treat a non-empty diff as a stop rather than a detail.

### Invariants a future agent must not break

- **The artifact gate is the safety net that makes a release from a tag
  defensible, and it must not be weakened.** `build-macos` runs
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
- **Never pre-create a bare tag** (`git tag vX.Y.Z && git push --tags`) and then
  build a Release from it, for the same reason plus one more: a bare tag publishes
  nothing at all, and `gh release create` against an existing tag attaches notes to
  whatever SHA that tag already points at. Let `gh release create --target` create
  the tag.
- **Always publish the Release as a pre-release**, and let `finalize-release`
  promote it. A full Release published before its assets exist is the outage above;
  the flag, not a person, is what holds the window open.
- **Derive the window from the commits, not from the commit shape** — plain
  `git log --first-parent --oneline <the newest released tag>..origin/main`, never
  `--merges`. GitHub's merge button produces a merge commit that `--merges` sees and
  its squash button produces a single-parent commit that `--merges` silently drops,
  so a wrong window is not empty, it is **partially listed**, and a partially
  correct window looks right.
- **A version bump on a feature branch is still a defect.** There is no longer a
  derivation to refuse over it, which makes it *easier* to miss rather than safer:
  `main` advertising a version nobody released is now caught by the owner's
  `git diff <last-tag>..origin/main -- package.json` check in the procedure above and
  by nothing else. A branch that ships its own bump consumes a number the next
  window has to skip, and the tag that finally lands carries code nobody reviewed
  under that number.
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
- **Write access to `main` is release authority, and it is the widest control this
  repository has.** `main` is not protected and carries no ruleset —
  `gh api repos/<owner>/<repo>/rules/branches/main` answers `[]`, the check this file
  already prescribes — so nothing mechanical prevents a direct push. What the
  Release trigger adds is a single, visible act between a merge and a shipped
  version: nothing reaches users until somebody creates a Release, and that Release,
  its notes and its tag are all attributable to whoever ran the command. Read every
  "who can reach the signing key" question against that boundary: the
  `signed-update-candidate` environment does not narrow it (*The release owner's
  procedure* says exactly what does).
- **A bump that lands without a Release leaves `main` advertising a version nobody
  published, and there is no automation left to notice.** Nothing refuses the next
  window any more; the owner's `git diff` check is the detection. Either finish the
  release —
  `gh release create vX.Y.Z --target <the orphaned bump commit> --prerelease --notes-file <notes>`
  — or drop the bump with `git revert <the bump commit>` and cut the version the
  window actually wants. Neither is something to leave unattended: a version that
  was bumped but never tagged is a number the next window has to skip.

## Notes for Future Agents

- **Merging is not releasing, and implementing is not releasing.** Land the PR as
  soon as its review rounds are clean and fresh and CI is green; nothing is
  published by a merge. Do not bump the version on your branch —
  `version-bump-guard` fails that on a PR, and a bump that reaches `main` without a
  Release consumes a number the next window has to skip (there is no longer a
  derivation to refuse it; see *Invariants*).
- **A request to *implement* something is not a request to release it.** The
  default is to land the work, report the merged PR and stop. Cut a Release only
  when the developer asked for one, or when you are acting as the release owner for
  a window in which the work already landed — and when you do, follow *The window,
  and the release owner's procedure* literally, including the ownership claim.
- **Your release notes are hand-written, from the committed template.**
  `.github/RELEASE_TEMPLATE.md` is the shape; `scripts/release-state.mjs` refuses an
  empty body or GitHub's generated draft, so `--generate-notes` and the web UI's
  "Generate release notes" produce a release that will not build. Cover **every** PR
  in the window (`git log --first-parent --oneline <prev>..origin/main`), keep the
  compare link, and write `## What's New` as prose about what a user gets — the PR
  numbers and the `Release:` lines belong under `## PRs`.
- **Choose the bump by materiality, not by commit type**: one bump for the window,
  patch unless a single PR is a step-function capability in its own right. A PR body
  still carries `Release: <patch|minor> — <one-line impact>` as its argument for the
  window, and the notes quote that line verbatim for that PR; a PR without one
  contributes no impact sentence, which the notes say rather than inventing one.
- If there are unrelated uncommitted changes, do not discard them; proceed
  carefully and scope your commit.

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
