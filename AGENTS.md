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
- **Fifty-nine themes are user-selectable.** A "Dracula" theme is a promise to a
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

One source, two consumers. `shared/themes/palettes/*.ts` holds one `ThemePalette` object per selectable
theme — fifty-nine of them today; MUI consumes them as hex (≈299 `alpha()` call sites
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
- Change scope, and the local equivalent of the whole CI job set:
  `pnpm check-changed`. It runs `scripts/ci-scope.mjs`, the same module the
  `Change Scope` job in `ci.yml` runs, so a developer's run and the workflow
  cannot drift into two opinions about which jobs apply — the same ethos as
  `pnpm lint:scripts` above, and the same reason this repository states it. See
  *Change scope* below.
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
what did not, and why. `scripts/evidence-manifest.test.mjs` checks the stamp and
needs no lease: it runs inside `pnpm test:desktop`, fails in well under a second, and
it is what caught the stale stamps that reached `main` once - so a stale stamp is
visible locally without a sweep, contrary to what this paragraph used to say. Only
the sweep half, `pnpm check-evidence`, takes the machine-wide lease and defers (exit
75) while another sweep holds it. Re-derive both from the tree the commit names -
which is the MERGED tree, so the derivation happens after the merge or sync commit
exists. Deriving them while the change is still in the working tree asks `git
rev-parse HEAD:src` about the PRE-merge head and gets its trees: real trees, so the
diff looks right, just not this one's (fold 11 shipped exactly that to `main`; fold
10 was stale from the other side one commit earlier, its merge commit declaring its
second parent's trees until a follow-up re-derived them). When the change also
touches `scripts/`, that stamp cannot include the edit until the edit is committed,
so the order is commit, derive, write the values in, `--amend` - the amendment moves
`docs/` only, and the value written stays true.

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

## Running only the desktop tests a diff can reach

`pnpm test:desktop:changed` runs `scripts/run-desktop-tests.mjs --scope=origin/main`,
which computes its own file list from `scripts/desktop-test-scope.mjs`: the subset of
`test:desktop` the diff can reach, the WHOLE suite when that module refuses to narrow,
or NOTHING when nothing in the suite can be observing the diff. It is the same runner
and the same concurrency cap either way, it prints which of the three it decided,
and it exits 0 with that line as its only output in the third case - an empty run is
an answer about reachability, not a green suite.

The rule is that a test file may be skipped only when every way it could observe the
changed paths has been enumerated: its module specifiers resolved (the esbuild entry
strings included), their imports followed, every repo-rooted path literal it carries
recorded, and a literal directory covering its subtree. A file access the graph cannot
ground in a path - a loop over a variable directory, a helper parameter - is not
grounded and not skipped: that file is selected for EVERY diff, and the scope line
reports how many files ride on that rule, which is the number to weigh before
trusting a narrowed run. `src/**` and the suite's own test files are the only paths it
will narrow; a manifest, a lockfile, a workflow, a `docs/evidence/**` frame, or any
other `scripts/` file runs everything, with the offending path printed.

CI is unchanged and still runs the whole suite on every pull request. The narrowed
run is the loop's convenience on a developer's machine; a green narrowed run is not
evidence that the whole suite passes, and the PR body says which one was run.

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

The `packaged` half cuts the other way for a RIG, and the shape rule is the part
it blinds. A launch of a **staged `.app`** — an artifact smoke test, a signature
or update rehearsal, anything that boots a built bundle out of `/tmp` — is
`packaged === true`, which is the half that keeps a double-clicked app out of the
assumption, so shape alone resolves it `normal` **however it is piped**. The
switch signal is packaging-blind and still applies: a scratch `--user-data-dir`
or a `--remote-debugging-port` resolves `headless` for a bundled launch exactly as
it does for a checkout. So a staged-bundle rig passes one of those, or names the
mode — `headless` for a run, `inactive` for the one capture that cannot render
hidden (*Capturing the frame*) — and the bundle was staged to exercise the
artifact, not to put it in front of the operator.

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

**The mode governs the WINDOW; it cannot promise what the rig does afterwards.**
A launch that resolves `headless` is never shown and is unfocusable — that is the
property the mode owns. The property an operator actually feels is a different
one: whether anything the run does *afterwards* asks the OS to make it frontmost.
Measured on this machine while the policy was holding exactly as documented —
zero windows across every rig launch sampled, and one windowless, unfocusable
instance still the frontmost application for seconds at a time — so "never shown"
is not "cannot take the operator's focus". Re-derive it rather than take that on
faith: `docs/evidence/window-mode/harness/run.sh` prints the
`frontmost application in <STOLE> of <TOTAL> samples` line for a run, which is
where this section's other numbers come from too.

So a rig never calls `window.focus()` (which asks macOS to order the window *and*
activate the app) and never sends `Page.bringToFront` or `Target.activateTarget`
over CDP. Element focus — `input.focus()`, `document.body.focus()` — moves a
caret inside the page, and `Emulation.setFocusEmulationEnabled` makes a page that
is not on screen read as focused; between them they cover every focus assertion a
rig needs, which is why the rule bans the three calls that leave the page rather
than focus itself. `scripts/window-mode.test.mjs` scans for those three the same
way it scans `src/main` for off-site raises: `scripts/` in every executable a
driver is written in (`.mjs`, `.js`, `.cjs`, `.ts`, `.tsx`, `.html`), the CDP
harnesses under `docs/evidence/*/harness/`, and `bin/` — because the `src/main`
scan cannot see a request a rig makes from the renderer side, which is where a rig
reaches the OS. Comments are blanked with the repository's own `blankComments`
helper, so the rule can be documented in prose while a call hiding behind a
comment is still found.

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
mode's promise — with ONE exception, the refusal below: when that window is the one
the operator is USING, a `second-instance` delivery is PARKED rather than applied
(`applied=parked+in-use`), because installing it re-keys the panel and costs him the
caret he was typing into. Against an app with NO window it creates nothing and parks
the conversation instead, and the NEXT WINDOW THE APP CREATES opens it — a park is
drained by a window's creation, not by a window being open, which is why a park can
be waiting while the app has a window up. An invisible window
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
open. AN ENTRY LEAVES THE QUEUE WHEN IT HAS ACTUALLY REACHED A RENDERER, not when a
window is created — and that includes the entry that becomes the next window's
INITIAL SESSION, which is CLAIMED at creation and released when that window's first
frame has loaded, because a window that dies before its first paint used to destroy
that one conversation while every other entry survived (review round 4, MAJOR-1). A
window closed before its renderer finishes loading therefore leaves the conversation
queued (`applied=left+waiting`, one line PER entry, each with its own requester) for
the next window rather than taking it away silently, and anything still waiting when
the process quits is written as `trigger=app-quit ... applied=dropped+quit`. A park
that was a REFUSAL is written as `applied=parked+in-use` rather than
`applied=parked`, and that token is the only one here that means somebody tried to
take the screen the operator was working on: the delivery it names leaves no other
trace, because the one plan a refusal applies to is `never`, which is silent by
design. A delivery that REPLACES the conversation an existing window was showing
says so, whatever verb it arrived on
(`delivered=<id> applied=conversation+replaced` — logged by the send rather than by
the trigger, because under `never` nothing else is written for one). All of
those names come from the app's own `[window-raise]` line, and
`scripts/window-mode.test.mjs` holds the shapes.

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
actually do (a `headless` request's conversation is delivered when the app has a
window to deliver it to — the one already open, or the next one it creates when that
window is in use — and not when the request lands). It does NOT print the
`[window-mode]` line, which
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
its log included. The one line near this that is not a raise is
`reportConversationReplaced`'s (`delivered=<id> applied=conversation+replaced`),
which records a delivery that installed a conversation over the one an existing
window was showing — written for EVERY such delivery rather than for the viewer's
only, because under `never` it moves the window nowhere and reports nothing, so that
line is the only account of it.

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
unaffected: `node scripts/capture-evidence.mjs <storybook-origin>` already drives a
private `--headless=new` Chrome.

**Driving the renderer is a supported path now, not a rig per agent.**
`scripts/renderer-driver.mjs` boots the built app headless in an isolated
scratch profile, arms an opt-in bridge that exists only when the launch asked for
it, and captures frames with the app's own `capturePage()`. `docs/agent-driver.md`
is the contract: the exact commands, the verbs, what it can and cannot prove, and
the reason it is not a substitute for the `browser` tool. Reach for it before
writing a new rig — and read its limitations section before you present a frame
from it as evidence for anything it cannot see (focus-dependent rendering, an
embedded browser page, and backend-gated screens among them).

When the thing being captured genuinely cannot render hidden — a native macOS
panel or sheet, a compositor effect, a frame that exists only while a window is
ordered front — `inactive` is the mode for it, as it is for a run somebody means
to watch or click into and for focus-dependent rendering (*`headless` is a
full-fidelity rendering path, not a degraded one* **above**). In every one of
those cases it is **one self-contained command**: launch, capture, reap by exact
pid before it returns. A visible window held across the steps of a run is
indistinguishable, to the person whose screen it is on, from the leak this section
exists to prevent — and the run's own `[window-mode]` line, which names the mode
it resolved (`window mode inactive`), is not what they see.

### Probes and carrier scripts are not the app

A scratch script that boots Electron and constructs its own `BrowserWindow` — a
mechanism probe, a carrier hosting a fragment of the app, a one-file reproduction
— inherits **none** of the above. The mode is resolved by this app's main process,
so a probe that never loads it has no guard to inherit, and a `show: true` in such
a script is a window on the operator's screen with nothing in the app to stop it.
This is not hypothetical. On 2026-09-18 a probe of this class swept five
visibility configurations as **five processes** — each one launching Electron
once, calling `showInactive()` once, and exiting — and left a window titled after
the mechanism itself in front of the operator for the length of the sweep. Every
launch was, in isolation, exactly the "one launch" this repository asks for; what
made it noise was the MATRIX, and the app-side guard on `main` could not see any
of it, because that is the one surface it does not reach.

The rule for the class is therefore about the sweep as much as the launch:

- **Measure hidden.** `win.isVisible()`, `BrowserWindow.getFocusedWindow()` and
  `capturePage()` answer visibility questions without a window on screen — and for
  a carrier that DOES load this app, so does its `[window-mode]` line, which a
  bare probe has no equivalent of and must not be told to read. Do NOT reach for
  `win.isFocused()` as the proof of anything — the measured warning under
  *`headless` is a full-fidelity rendering path, not a degraded one* applies to
  probes too.
- **A sweep of N configurations is not N launches.** A matrix whose every cell
  shows a window is the incident above. Bound the question to one launch where it
  allows it; where a shown window is genuinely required per configuration, use
  `showInactive()` rather than `show()`, reap by exact pid in the same command as
  its capture, and **announce the count before you start** — a sweep that will put
  up five windows is five windows on somebody's screen, not a detail discovered by
  watching.
- **Never sweep `show()`/`focus()` variants to find the one that reproduces.**
  Visibility that is only announced and reaped is one thing; the focus-taking half
  is another, and a matrix of THOSE is never acceptable whatever it measures,
  because the interruption is the measurement's side effect rather than its
  subject. If the question genuinely needs focus, measure it once.

### What already opens no window, so a rebase does not re-introduce one

`pnpm test:desktop` bundles modules in process; the CI npx smoke test prints its
marker from `whenReady()` and exits before a window exists; the Storybook and
CDP capture scripts run headless Chrome. The windows come from live-app
harnesses — `pnpm dev`, `npx electron .`, `npx local-operator-ui` — which is why
the mode belongs in the harness's own spawn call and not in whatever the shell
happened to export.

### A page that reloads on its own does not sit in the operator's browser

The rules above are about windows this repository's code *opens*. This one is about
the window a run can leave *misbehaving*: **a page whose reload cadence the run does
not control does not get parked in the operator's browser — this app's Browser pane
included — and a sweep of many states does not run there either.**

That is narrower than it first sounds, because their browser is a sanctioned
instrument in this repository and this rule does not replace it:
`docs/agent-driver.md` sends you to the `browser` tool "when the real browser is what
is under test"; `docs/evidence/draft-splash-browser/` was shot with it, `chat-search/`
was re-shot through it, and `chat-image-expand/`'s README calls its browser pass "one
half of the evidence" beside the rig that produced the other. The `manifest.json`
entries that record a re-capture as OWED — `chat-run-panel/mcp-grant-confirm` and the
`mcp-key-*` set — record it because a scripted headless Chromium is not the instrument
there. What none of those passes does is leave a page looping in their browser while
they work, or turn a story sweep into N unattended navigations of it.

Measured on 2026-09-19, and the reason the sweep half is a rule. Two Storybooks were
being looked at through this app's own Browser pane while the app was frontmost, each
loaded as a **bare `…/iframe.html?id=<story>&viewMode=story` top-level page — the
form that carries no server-channel token** (Storybook 9 mints that token per run and
validates it on `/storybook-server-channel`; it is not a flag a caller can pass or
drop. This repository pins 8.6.x, where that channel is ungated, so the actionable
half below is the URL form, which holds either way). Every reload of those pages was
paired in the server's log with
`Rejecting WebSocket connection: Error: Invalid websocket token`, and the pane
navigated continuously: **773 navigations on one port, 364 on another, 76 in a single
minute at the peak, for half an hour.** The operator reported being unable to type
while it ran.

What was measured, and what was not. The app's host process logged every navigation it
was handed (`did-navigate` in `src/main/browser/index.ts` fires for page-initiated
navigations too), no CDP client was connected to the app's debugging ports, and no file
in those worktrees was being rewritten — so nothing outside the page was driving it.
**Whether a pane navigation is what took the composer's keyboard focus was never
established**, which is why the durable half is a follow-up rather than a claim here:
park a pane that navigates in a loop, and never let a background pane's load take the
keyboard focus. The pairing between the refused channel and each reload is likewise an
observation rather than a sourced mechanism, so the rule below is written to avoid the
pairing rather than to explain it.

What follows for a run:

- **Open a story through the manager URL that carries the token**, never a bare
  `iframe.html?id=…` as the page's top-level URL: the bare form is the one the server
  channel refuses, and that refusal is what each reload was paired with.
- **A sweep belongs in a browser the run launched and reaped itself, in one of the two
  shapes this repository already has.** `scripts/capture-evidence.mjs` and
  `scripts/click-proof.mjs` spawn their own private `--headless=new` Chrome with a
  scratch `--user-data-dir`, argv routed through `scripts/chrome-keychain.mjs`;
  `scripts/renderer-driver.mjs` launches no Chrome at all — it boots the built app in
  `--window-mode=headless` and photographs it with `capturePage()`. Those are not the
  only instruments in `docs/evidence/`: each set's README —
  `docs/evidence/<surface>/README.md`, one level above its `harness/` tree — says which
  one produced its frames, and `composer-status-clear/` records a third (the operator's
  own browser for the story states, its own Vite-served harness for the interaction).
  Spawn the binary directly: **do not hand the URL to `open`**, which delivers it to
  whatever Chrome is already running — the operator's.
- **What decides is the cadence and who is watching, not whose page it is.** A
  watched, deliberately-stepped pass in their browser is what the committed sets
  above did — `chat-image-expand`'s was on a running Storybook — and that stays
  sanctioned. What this rule forbids is a sweep of many states run there
  unattended, and any page left reloading while nobody is looking at it.
- **If you find a page looping in their pane, stop the loop and say which stop you
  used** — close the tab, or stop the server feeding it. A loop does not end by
  itself, and their UI stays unusable until somebody acts on it.

## The code-sealed bundle, and what may write in it

Four mechanisms keep CPython's bytecode cache out of an installed app, and they
are a set: read `src/main/python-bytecode-cache.ts` and the heal's own docstrings
in `src/main/update-install.ts` before changing one, because each covers a case
the others cannot and the bug they exist for comes back when one is dropped on
the assumption that another already has it.

1. Every python the app spawns is handed `PYTHONPYCACHEPREFIX` pointing under the
   app's userData, with `PYTHONDONTWRITEBYTECODE=1` beside it
   (`withPythonBytecodeCache`, and the same defaults in the three shipped install
   scripts). The prefix is the half that keeps the cache *working* and the flag is
   the refusal. An operator's own prefix is kept when it is absolute and outside
   every `.app`, and replaced when it is not - a **relative** value resolves
   against whatever cwd the writing process happens to have, which may be inside a
   bundle, so it is not a placement anyone chose.
2. The pair above reaches only the pythons this app starts, and this app does not
   start every python that runs under its runtime: one started by a shell, a CLI
   script, launchd or an agent carries no environment of ours (measured: a venv
   over the bundled tree wrote 25 `.pyc` into it that way, which is the class the
   operator's own 163 in-bundle `.pyc` belong to), and a child can ignore the
   environment by design - `-I`/`-E` mean "do not read `PYTHON*`", and the app's
   own smoke child for the managed runtime is started exactly that way (`-I -B`
   in `src/main/backend/managed-python.ts`) - so an environment alone cannot be
   the whole answer. The app-managed venv therefore carries the refusal *inside*
   it:
   `ensureVenvBytecodeGuard` writes a `sitecustomize.py` into the venv's own
   `site-packages`, which `site` imports on every start. Since the interpreter
   moved out of the bundle this guard protects the managed runtime's **identity**
   - the sha256 of the signed bytes it was copied from, which a stray cache file
   must not disturb - rather than a sealed tree. It is the cheap half and not
   sufficient alone: `site.py`'s own startup imports are compiled before
   `sitecustomize` runs.
3. Nothing we ship is a `.pyc` at all, and that is enforced at build time
   (`scripts/setup-python-resource.sh`, with the release gate in
   `scripts/verify-macos-artifacts.mjs`), because a *shipped* `.pyc` that gets
   rewritten is `file modified:` - the one class codesign cannot accept again and
   the heal cannot repair. It is also what makes the next mechanism safe: a
   `.pyc` found inside the interpreter trees has no legitimate way to be there, so
   `added` + our tree + `.pyc` is the whole entitlement.
4. A bundle an interpreter has already written into is repaired in place, at
   start-up and in the update pre-flight, by `healPythonBytecode`
   (`update-install.ts`): every path `codesign` reported `file added:` that is a
   `.pyc` under `BUNDLED_PYTHON_DIRS` in the bundle being healed is unlinked, one
   file at a time, and a bundle broken any other way keeps the reinstall refusal.
   There is deliberately **no `__pycache__` segment test** any more: an
   interpreter under `PYTHONPYCACHEPREFIX` mirrors the absolute source path under
   the prefix with no such segment, and the field incident of 2026-09-15 was 19
   added `.pyc` in exactly that layout, which the old test called "outside the
   bundled python trees" and which cost the operator an in-place repair the heal
   exists to perform. The directories such a write leaves behind are left behind
   on purpose - an added empty directory still verifies - so the re-probe, not a
   tidy tree, is what decides whether the heal worked.

**The ACL seal that used to be mechanism 2 is retired, deliberately** - no
`sealPythonInterpreterTrees` symbol exists in `src`. It could not be a
correctness mechanism: `ditto` carries an access-control entry but the ZIP
Squirrel stages does not, so a bundle that
arrives by in-app update is unsealed from the swap until something re-applies it,
and the writers in that window are pythons this app never starts. Re-applying it
at startup or from the update watchdog only narrows a race it cannot close. The
durable half is structural: no venv resolves its stdlib inside any `.app` at all
(`backend/managed-python.ts`), so there is no interpreter left in a bundle for a
cache write to land in, and mechanisms 1-4 above are defense in depth for the
processes that still run one.

**Do not reintroduce a seal built on `chmod`/mode bits.** One write bit on a
directory covers both creating an entry and unlinking one, so clearing it refuses
the write but also makes the app undeletable (`rm -rf` exits 1 with `Directory
not empty`, and emptying the Trash cannot reclaim the tree) and stops the app
healing its own bundle, because mechanism 4 repairs one by *unlinking* the `.pyc`
CPython added. Measured on a mode-sealed copy: `healable=false removed=0`. The
symptom of a regression in any of this is a `file added:` violation the heal can
no longer remove.

## Updates: the managed runtime, the inert seed, and the start-up repair

The interpreter is the one part of an install that an in-place update must not be
standing on. Three mechanisms make that true, and they are a set: the seed, the
managed runtime outside the bundle, and the bytecode guards described above.

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

### A launch during a live install stands down

Squirrel's ShipIt asks whether any instance of the target app is running ONCE, as its
last check before it swaps the bundle, and abandons the install when one is (`App Still
Running Error`, `SQRLInstallerErrorDomain Code=-9`). So a launch that finds a LIVE
install does not open a window: `holdLaunchForLiveInstall`
(`src/main/update-service.ts`) reads the pending marker, asks launchd what the install's
job is doing, tells the user and quits - inside `whenReady`, before the menu, the backend
or a window exists. Measured on this machine against a packaged bundle by
`scripts/hold-lifetime-rig.mjs`: 0.79 s, 2.29 s and 2.48 s of process, exit 0, no window
and no `Update service initialized` line (QA measured 4.03 s and 5.98 s on a host at load
165-190, so quote the bound rather than the small number). The facts that decide it: 

- **A RUNNING job plus a current marker is an install in flight** (`isInstallInFlight`),
  and the launch is held. NOT a merely registered one, and this is the part that was
  wrong first: launchd keeps the job registered after the install ends - measured here,
  the app's job is still listed 72 minutes after a successful install with
  `state = not running`, and so are other applications' ShipIt jobs, indefinitely. Read
  as liveness, a registration turned the gate into "a marker younger than ~29 minutes",
  so the launch the watchdog made after a SUCCESSFUL update showed a banner and quit and
  every click for the next half hour did the same, with no way to open the app at all.
  `installJobState` separates `running` from `registered` (`launchctl list` carries the
  job's `"PID" = n;` field only while its program executes), and the same reading decides
  recovery: a marker the running version has REACHED is `succeeded` and a job that is not
  running is not an install, so the app opens, clears the marker, and - when the install
  really did fail - draws the "the last update didn't finish" panel a person goes looking
  for. A marker past `PENDING_INSTALL_LAUNCH_HOLD_SECONDS` opens too; the marker, the
  install's job and its staging tree are never touched by the hold.
- **The hold ends before the watchdog's hard bound** (`LAUNCH_HOLD_END_MARGIN_SECONDS`).
  That bound is where the relaunch watchdog deliberately starts the app into a live
  install rather than leave a user with no app; a hold that swallowed it would ensure a
  watchdog on its way out and repeat forever. The WATCHDOG still asks the registered
  question deliberately - its job is to keep the app from opening back into its own
  install, and a registration that outlives an install is the conservative direction - so
  the two readings differ by design, and `shipItJobLabel` says why.
- **The notice is bounded, the caller bounds it again, and the quit is bounded twice.**
  The app's own banner gets `LAUNCH_HOLD_NOTICE_DEADLINE_MS`, then the notice falls back
  to the channel the install's own messages use (`osascript`, the same one the relaunch
  watchdog notifies through) when the banner does not report itself shown, and the whole
  notice budget is also armed by the caller (`LAUNCH_HOLD_NOTICE_BUDGET_MS`) so a notice
  that wedges costs the message and never the quit; a quit that wedges is forced
  (`LAUNCH_HOLD_FORCE_QUIT_DEADLINE_MS`). The delivered channel is written to
  `update-service.log` before the quit, and `LOCAL_OPERATOR_NO_NOTIFICATIONS` silences it,
  because a rig that switches notifications off must not put a banner on the operator's
  screen. The relaunch promise holds here too, and it is stated only when
  `ensureRelaunchWatchdog` actually arranged one - the watchdog is ensured BEFORE the
  quit, which is the rule every other quit path follows.

`scripts/update-window-report.mjs` measures the closed window this is about (read-only,
with the baselines in its header, and it names a running installer's own `ps` facts), and
`scripts/sec-check.c` times the call the install blocks in:
`pnpm sec-check --via-launchd <path>` measures it from an ordinary process and as a job
submitted to launchd, and `--background` under `taskpolicy -b` - seconds against minutes
on identical content, with under a second of CPU. **What that difference IS, stated no
further than the measurement goes (review R1):** the same validation costs 0.25-3.85 s
from a shell (eight runs), 33.3 s when submitted as a launchd job on the same bundle in
the same minute, and 331-777 s under the background class, while the 11:59 install spent
4 min 27 s inside it at 4.3% of a core. Which part of that context costs the time -
launchd's scheduling, the Security framework's own worker threads, or this machine's
contention - is NOT established, and the installer's own job carries `nice = -1` with no
background process type, so an earlier "it is the scheduling class" reading does not
survive the machine. What IS established is that the cost belongs to the context, not to
this app's bundle: file count is refuted as the lever (a `ditto` of the full 1808-file
bundle produced 19-21 Gatekeeper scans; the same write with the Python seed removed, 269
files, produced 32 and 17). `scripts/hold-lifetime-rig.mjs` measures the launch side of
this against a packaged build with the machine's own launchd (`--job running|registered|
absent`), so the numbers above can be re-derived rather than quoted; it says so in its
header, including what it does NOT show (a headless run cannot prove a window's absence).

## Which pnpm may install and package

Every workflow that INSTALLS pnpm pins it to **10.29.2** (the `version:` input
on `pnpm/action-setup`) — `ci.yml`'s `changes` and `runtime-deps` are the two
jobs that install nothing at all, the first because the change-scope classifier
is node builtins plus two sibling files and must not go red for a dependency
reason (see *Change scope*), the second because its check reads `package.json`
and nothing else — and that pin is load-bearing rather than a preference:
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

## Change scope

CI used to run its whole job set on every pull request: a one-line `docs/` edit
paid for a typecheck, a build, the 108-file desktop suite and a two-runner pack
and launch. Each job is now gated on a **change-scope classifier**,
`scripts/ci-scope.mjs` — the SAME module `pnpm check-changed` runs locally, so
the local gate and CI cannot drift into two opinions.

What that means when you read a check list:

- **A skipped job is a CLAIM, not a pass.** The `Change Scope` job writes the diff
  base and its SHA, every changed path with the category it got, every flag with
  its reason and the resulting run/skip job list into that run's step summary, and
  into the job's own log. Read it before treating a green PR as evidence, and treat
  a skip you cannot justify as a finding. Two checks on a diff that only touched
  prose is the design working, not a truncated run.
- **The inert set is `docs/**` (minus `docs/evidence/**`) and root `*.md`.**
  `docs/evidence/**` is committed test INPUT — several `test:desktop` files read it
  at runtime — so it keeps the desktop suite. Anything unrecognised counts as live.
- **Some diffs run everything on purpose.** Any `.github/**` path (the gating
  itself), anything that is not a `pull_request` event (`main` is the safety net
  for the narrowed pull-request matrix), and every fail-open path: an unresolvable
  diff base or a failed `git diff` sets every flag true and prints a `::warning::`
  rather than guessing.
- **No gate can be skipped silently.** Every job reads `<flag> != 'false'` and
  never `== 'true'`, because an output that was never written is empty — so a
  classifier that died runs the jobs rather than skipping them.
- **A version-only `package.json` bump runs nothing in `ci.yml`**, so on a release
  bump the PR-side evidence is the version guard plus the classifier that decided
  so. See *PRs do not bump the version; merging is not releasing*.

`pnpm check-changed` is the local equivalent of the whole job set: it classifies
the index, the working tree and untracked files against the merge base with
`origin/main`, then runs the selected jobs' own commands. It prints each job it
does not run locally and why — `audit` would red for findings CI deliberately
tolerates and needs the npm registry, and the pack and launch legs need the four
`VITE_*` build secrets and a macOS runner. A green `pnpm check-changed` means
"the gates CI will run on this diff passed", never "everything passed".

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

**On a release-bump PR that guard is the only check.** A version-only
`package.json` diff is classified as a release bump, so every job in `ci.yml` is
a deliberate skip and that pull request's whole PR-side evidence is
`Version Bump Guard` plus the `Change Scope` job that decided so (see *Change
scope*). Do not read those two green checks as a matrix: the review round on the
one-line diff is the rest of the assurance.

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

**Green means the jobs that ran passed, so read the classification.** CI runs only
the jobs a diff can affect (see *Change scope*), which makes the `Change Scope`
job's step summary part of the merge decision rather than a curiosity: it names
the diff base, every changed path with its category, every flag with its reason and
every job as run or skipped. **A skipped job is a claim, not a pass** — the owner
justifies each skip before merging, and a skip they cannot justify is a finding.

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

#    BEFORE landing the bump, prove nothing already spent this version: the two
#    version entries must be identical. A moved version line means a merged PR
#    carried its own bump and consumed a number nobody published; a diff that
#    touches only other fields (`scripts`) is expected. This check is the whole of
#    that guarantee now.
git diff v<PREV>..origin/main -- package.json | grep '^[-+].*"version"'

# 2. The bump PR: package.json only, one line, title `chore(release): bump version
#    to X.Y.Z`, independent review round on that diff, and green CI. Then merge it.
#    Green CI here is ONE guard plus the classifier: a version-only package.json
#    diff is a release bump, so every other job in ci.yml is a deliberate skip
#    (see *Change scope*). The one-line diff's review round is the rest.
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

**Attaching an asset is repairable by re-running the job, and the rule that makes
that true is about the asset, not about its name.** `scripts/upload-release.mjs`
streams each installer to the pinned release ID — never buffered whole, since the mac
dmg alone is 158 MB — with a per-attempt timeout and a bounded backoff retry on a
transient failure (a timeout, a reset connection, a 5xx), because a stall nothing
bounds is a job that hangs until the runner kills it. The one write the path makes to
the release's own records, the DELETE of an incomplete upload, carries its own
deadline for the same reason. The recoverability lives in how
what is already attached is reconciled, decided per artifact by name and size: an
absent name is uploaded; a complete asset at **our** byte count is skipped, so a
re-run over an intact release writes nothing at all; a complete asset at a
**different** byte count is refused, naming both sizes, because that is a genuine
collision with somebody else's asset; and an asset still in the `starter` state — the
record the upload endpoint creates when an upload *starts* — is deleted and
re-uploaded, because it is the wreckage of an attempt that never finished, not an
asset. **Never replace a complete asset; never treat a `starter` record as a
collision.** That last case is what cost three releases on 2026-09-16: after v0.26.5
published, a stalled POST of the 158 MB arm64 dmg left a `starter` record, and every
later attempt — a re-run, a repair dispatch — was refused over the name that record
held, so the release could not be repaired without hand-surgery on the API. A failure
reports the HTTP status and the endpoint's own message for the file that failed, and
calls something a collision only when the reconciliation really found one.

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
  `git diff <last-tag>..origin/main -- package.json | grep '^[-+].*"version"'` check
  above, which is now the only thing standing between a stray bump and a skipped
  release — run it every window, and read it against the right field. The stop is
  on the **version** entry: compare `git show <last-tag>:package.json | grep
  '"version"'` against `git show origin/main:package.json | grep '"version"'`, and
  stop only if those disagree. The `^[-+]` in the diff form is load-bearing rather
  than decoration: `git diff` prints an unchanged line as context when it falls
  inside a hunk, and `"version"` sits on line 3, so an unanchored grep cannot tell
  an unmoved version line from a moved one. A non-empty diff that touches only
  other fields is expected rather than alarming — a feature PR adding a `scripts`
  entry makes the diff non-empty most windows, and an owner who reads the diff's
  non-emptiness as the signal stalls a window that is perfectly legitimate.

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
  `git diff <last-tag>..origin/main -- package.json | grep '^[-+].*"version"'` check
  in the procedure above and by nothing else. A branch that ships its own bump
  consumes a number the next window has to skip, and the tag that finally lands
  carries code nobody reviewed under that number.
- **A `DIRTY` branch gets no CI at all, so a green head is not evidence on its
  own.** GitHub does not run workflows on a merge commit it cannot create: a PR with
  a conflict keeps the *older* green run and acquires no new one. Check
  `gh pr view <n> --json mergeStateStatus` (or `gh pr checks <n>`) before you rely
  on green, and re-check after any rebase. The same trap in a different costume is
  reviewing a SHA that is no longer the head.
- **A classified-inert head is the second way a green check list can mean little.**
  A diff that only touches prose deliberately runs `Change Scope` and
  `Version Bump Guard` and nothing else, so two green checks on such a PR are the
  whole of what CI has to say about it — not a matrix that happened to be short.
  Read the classification summary (see *Change scope*) before treating either
  shape as evidence.
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
  soon as its review rounds are clean and fresh and CI is green (having read the
  run's classification summary — a skipped job is a claim, not a pass; see
  *Change scope*). Nothing is published by a merge. Do not bump the version on
  your branch —
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

## Who may merge: the agent review round

Code owners: none are declared. `.github/CODEOWNERS` carried a `*` line until
2026-09-16 that routed an automatic review request to `bbqben` on every PR the
moment it opened -- including the ones still churning through review rounds --
and a matching pattern is the only thing that creates that request (GitHub has no
setting that keeps the map and drops the notification). It is now pattern-free.
**This repository has no
ruleset requiring an approving review**, so there is no approval gate to clear
here -- with no owners declared, nothing is requested and nothing blocks merges.
Confirm that with `gh api repos/damianvtran/local-operator-ui/rules/branches/main` (`[]`
means nothing is enforced), never with the legacy
`branches/main/protection` endpoint: that one answers `404 Branch not protected`
even for a branch a modern ruleset *is* enforcing, so it is the wrong question.
The rule
below is therefore about what makes a merge *legitimate*, not about what the
forge will let through.

**PRs are opened non-draft, and no reviewer is added unless the operator asks
for reviewers on that PR.** The draft flag existed here only to suppress the old
auto-request; it now only delays the merge, since a draft PR cannot be merged at
all. A human review is a deliberate act when one is wanted -- `gh pr edit <n>
--add-reviewer bbqben` (no leading `@`: gh <= 2.100 only strips it for `@me` and
`@copilot`) -- the handles with write access are `bbqben`, `jcobhams` and
`damianvtran` (verify with
`gh api repos/damianvtran/local-operator-ui/collaborators`); tagging a person in
a *comment* is what says the PR is waiting on them.

When the agent is **acting for the owner** — the operator, running on their
machine and under their account, which is the normal case here — the standing
agent review gate is what authorizes the merge. A clean, fresh, independent
agent review round plus green CI (with the run's classification summary read —
a skipped job is a claim, not a pass; see *Change scope*) is sufficient; do not
wait for a second human to click approve. Nothing here is permission to merge on a *weaker* basis than
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

An agent that is **not** acting for the owner prepares the PR, records the
review rounds, and hands it to the owner to merge.
