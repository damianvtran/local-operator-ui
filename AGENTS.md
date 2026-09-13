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
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Typecheck: `pnpm check-types`
- Build: `pnpm build`
- Theme gates: `pnpm check-themes` (freshness + contrast floors)
- Regenerate theme CSS: `pnpm gen-themes`
- Bundle size: `pnpm bundle-size`, `pnpm startup-closure`
- Component gallery: `pnpm storybook`

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
  1380x872 CSS viewport on macOS. A `--window-size` under the verified 800x600
  floor is clamped to it and reported in the log, so a frame cannot be labelled
  with a size the window never had.
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

- **10.30.3**: the command reports the `debug` node under
  `electron-updater > builder-util-runtime` with `dependencies {}`,
  electron-builder packs 43 packages / 5.2 MB into `app.asar`, and the built app
  dies at load with `Cannot find module 'ms'` (require stack
  `app.asar/node_modules/debug/src/common.js`).
- **10.29.2**: the same command reports `dependencies ["ms"]`, the packager
  copies 96 packages / 6.0 MB, and the app starts.

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

Remove the pin once a pnpm release reports the full closure again - the command
above prints `ms` for the `debug` node - and the launch line still passes.

## Releasing: one owner per window, and no version bumps inside feature PRs

A release here is a **combined release**: one version bump, one tag and one
GitHub Release covering every PR merged since the previous tag, cut by one
**release owner**. PRs do not carry their own bump, and merging is decoupled from
releasing: a merged PR that has not been released yet is the normal state of
`main`, not a problem to fix. The sections below say why, then how.

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

### One release owner per window

Releases are cut by a single **release owner** for a **window**: the set of PRs
merged since the last tag that are ready around the same time — about an hour.
Nobody holds a merge to make a window.

**The lock on a window is an open PR, not a message.** A `send` is not observable
to a session that was not listening, so it cannot be the lock: two sessions that
both look and both announce themselves in the same minute each see "nobody owns
it" and both proceed, which is precisely how two releases ran out of queue. An
open PR whose title starts `chore(release):` is observable to everyone through
the forge, so it is the lock:

```sh
# Quote the phrase. `gh` passes it to GitHub's search, which treats bare
# parentheses as syntax and returns nothing at all.
gh pr list --state open --search '"chore(release)" in:title'
```

An open bump PR means the window is owned. Its body names the owning session's
pid, so `send` that session your PR's number, merge SHA and `Release:` line and
let it aggregate. Do not start a second release.

**Take the lock by opening the claim PR, before announcing anything.** The
release owner's first act is one empty commit on branch `release-next`, opened as
a draft PR titled `chore(release): claim release window`, whose body names the
owner's session pid from `lop sessions` and starts an empty checklist of the
window. Only then announce it with the `send` tool. The number is not known yet —
the bump is decided from the window's contents, which do not exist when the lock
is taken — so the lock starts life as a claim and *becomes* the bump: the same
single commit is amended into the version change and the same PR retitled
`chore(release): bump version to X.Y.Z`. The PR number, and so the lock, never
changes; that is also why the search above keys on the `chore(release):` prefix
and not on the full title.

**Tie-break by `createdAt`.** If two bump PRs are open, the earlier one owns the
window; the author of the later one closes it, deletes its branch, and hands its
window contents to the earlier PR's owner.

**Adopt a dead owner.** An agent arriving cold cannot know how long a pid has
been gone, so the clock is anchored on what the forge shows: if the owner pid is
absent from `lop sessions` *now* **and** the lock PR's `updatedAt` and its last
owner comment are both more than 15 minutes old, any agent may adopt the window —
comment on the PR that it is taking over, put its own pid in the body, and
continue from wherever the checklist stopped. Nothing is reset. An owner still
working therefore keeps the PR's checklist current; silence is what makes a
window adoptable.

**If you merge while a window is open, tell the owner at merge time** — the PR
number and the merge SHA, not "when you next happen to talk to them". The bump
commit is not a barrier: the tag names a SHA and everything reachable from it
ships, so a PR merged after the owner starts cutting may ride *this* window
unlisted. In the backend's v0.51.4 the bump landed at 07:16 on its own release
branch and a PR merged to `main` at 07:18; the two sat on divergent branches and
both were reachable from the tagged merge, so that PR shipped while being absent
from the notes. The owner cannot poll continuously, and a peer who confirms a
window list and then quietly merges into it has broken the protocol even though
every individual step looked correct.

The owner is a role for one window, not a standing job. Whoever cuts the release
is also responsible for telling every contributor in the window where it landed.

### What the release owner does

1. **Collect** from each merger in the window: PR number, merge SHA, and the PR
   body's `Release:` line. Every PR carries one, in this exact shape, under its
   summary:

   ```
   Release: <patch|minor> — <one-line user impact>
   ```

   The bump is the merger's argument, the impact is the sentence the release
   notes will use, and it lives in the body precisely so a merger who is no
   longer running still contributes both. If a merged PR is missing the line, the
   manager coordinating that PR adds it to the body before the window closes; the
   release owner does not guess an impact from commit subjects.

2. **Pick ONE bump for the whole window** by the materiality rule at the end of
   this section: a minor only if some *single* PR in the window clears the
   step-function bar on its own; otherwise a patch. Several patches in a window
   are still one patch. The chosen version is `<last tag> + that bump`, never a
   number someone was "promised" earlier.

3. **Land the bump PR** — the claim PR, now carrying the bump: one commit,
   `chore(release): bump version to X.Y.Z`, touching `package.json` only. It is
   still an agent-authored PR, so the standing review gate applies: an
   **independent reviewer subagent** — not the owner, who is the author — posts
   `### Agent review — round 1` confirming the diff is exactly one line in one
   file, that the version is `<last tag> + the chosen bump`, and that no other PR
   in the window touched `package.json`. The owner replies with the remediation
   comment and merges. **A bump commit that also carries code is a defect** — the
   code belongs in a reviewed PR of its own.

4. **Tag and publish** from the bump's merge commit SHA — the commit
   `origin/main` points at, and the exact object the mechanics step below passes
   as `--target`. `gh release create` with `--target` creates the tag on that
   exact SHA, and *publishing the Release* is what triggers `publish.yml`;
   `scripts/validate-release.mjs` then validates that the tag still points at
   that SHA, so the tag and the tree cannot drift apart between the two steps.
   (If a PR merges after the bump, `origin/main` is a superset of that commit and
   the tag covers that landing too — which is why step 3 re-derives the window
   immediately before tagging.) Publish it as a **pre-release** (see the warnings
   below) so the empty first minutes of the build stay out of `/releases/latest`.
   The notes cover **every PR in the window**, the window's own bump PR
   included. The `## PRs` row shape below is what the owner should produce, not
   a description of any past release: one row per PR, the number followed by
   the PR title in backticks, with GitHub's trailing `(#n)` dropped from that
   title. For the surrounding structure, copy the shape of the previous
   release's body — `gh release view <prev_tag> --json body` — since recent
   releases are not uniform, one older release is a shape to follow, not a
   rule. The `Release:` impact lines a merger contributes are what the summary
   and the `## Impact` bullets are written from, not the `## PRs` rows:

   ```md
   ## What's New

   <1-2 sentence summary naming the version's theme>

   - **<Change Area>**: <description>

   ## Impact

   - **No Breaking Changes**: <or explicitly call out breaking changes>
   - **<User/Developer Impact>**: <description>

   ## PRs
   - #<n> `<the PR title, minus GitHub's trailing (#n)>`
   - #<bump-PR-number> `chore(release): bump version to <version>`

   **Full Changelog**: https://github.com/damianvtran/local-operator-ui/compare/<prev_tag>...v<version>
   ```

5. **Post the refs** — tag, Release URL, the notes, and the promoted state once
   the workflow has closed its window — as a comment on every PR in the window,
   and `send` them to each contributor still running.

### Mechanics, in order

`<repo>` below is your checkout of this repository. The bump branch lives in a
throwaway worktree so the root checkout's branch is untouched. The claim and the
bump are ONE commit on ONE branch: amend and force-push with `--force-with-lease`
rather than stacking a second commit, so the scope check stays "one line in one
file".

```sh
# 1. Confirm the window: everything on origin/main since the last tag.
#    Plain `git log`, never `git log --merges` (see the warnings below).
git -C <repo> fetch origin --tags
git -C <repo> log --oneline "$(git -C <repo> describe --tags --abbrev=0 origin/main)..origin/main"

# 2. Take the lock: an empty claim commit in a throwaway worktree, opened as a
#    draft PR. (No open chore(release) PR was found in the search above.)
git -C <repo> worktree add /tmp/loui-release-next origin/main
git -C /tmp/loui-release-next checkout -b release-next
git -C /tmp/loui-release-next commit --allow-empty -m 'chore(release): claim release window'
git -C /tmp/loui-release-next push -u origin release-next
gh pr create --draft --base main --head release-next \
  --title 'chore(release): claim release window' --assignee damianvtran \
  --body 'Release window claimed. Owner session pid: <pid from lop sessions>.
Window (tick as each merges):
- [ ] #<n> — <Release: line>'
# ... collect the window, write the notes, wait for the last PR in the window to
#     merge; then, with the bump decided:

# 2b. Turn the claim into the bump: amend the SAME commit, retitle the SAME PR.
#     Edit the "version" value in /tmp/loui-release-next/package.json to X.Y.Z.
git -C /tmp/loui-release-next commit --amend -am 'chore(release): bump version to X.Y.Z'
git -C /tmp/loui-release-next push --force-with-lease origin release-next
gh pr edit <claim-pr-number> --title 'chore(release): bump version to X.Y.Z'
gh pr ready <claim-pr-number>
# ... independent scope-check round, merge; then confirm the FORGE's head sha is
#     the amended commit, not your local clone's:
#     gh pr view <claim-pr-number> --json headRefOid --jq .headRefOid

# 3. Re-derive the window IMMEDIATELY before tagging, and check that no merged
#    PR carried its own bump.
git -C <repo> fetch origin --tags
git -C <repo> log --oneline "$(git -C <repo> describe --tags --abbrev=0 origin/main)..origin/main"
git -C <repo> diff "$(git -C <repo> describe --tags --abbrev=0 origin/main)..origin/main" -- package.json   # must print nothing

# 4. Tag and Release in one step, on the bump's merge commit — the same SHA the
#    runbook names: `rev-parse origin/main` is that commit while nothing has
#    merged past it, and a superset of it (also covered by the tag) if something
#    has. --target creates the tag; the Release being published is what triggers
#    publish.yml, which validates that exact SHA in scripts/validate-release.mjs.
#    --prerelease is the hold that keeps an asset-less Release out of `latest`.
$EDITOR /tmp/loui-release-X.Y.Z-notes.md   # the house-style template above
gh release create vX.Y.Z --target "$(git -C <repo> rev-parse origin/main)" \
  --prerelease --title 'X.Y.Z: <theme>' --notes-file /tmp/loui-release-X.Y.Z-notes.md

# 5. Watch publish.yml attach the installers and promote the Release, then verify.
gh run list --workflow publish.yml --limit 1
gh release view vX.Y.Z --json url,name,tagName,isPrerelease,publishedAt

# 6. Reclaim the worktree and delete the release-next branch.
git -C <repo> worktree remove /tmp/loui-release-next
```

### Warnings that still hold, each of which has already cost a release

- **Never pre-create a bare tag** (`git tag vX.Y.Z && git push --tags`) and then
  make a Release from it. `publish.yml` triggers on the *Release* being
  published, so a bare tag publishes nothing, and `gh release create` against an
  existing tag will happily attach notes to whatever SHA that tag already points
  at — which is how a release once shipped the previous version's code under the
  new number. Let `gh release create --target` create the tag.
- **Always publish the Release as a pre-release, and let the workflow promote
  it.** `electron-updater` resolves its feed from GitHub's `/releases/latest`,
  which answers with the newest non-pre-release Release whether or not that
  Release has assets. A Release published as a full release before its
  installers are built therefore points the feed at a Release with no
  `latest*.yml` for the whole 25-35 minute build, the metadata request 404s, and
  every running app filters that into "no updates available" — users are told
  they are current while a newer version is already published (v0.17.2, v0.19.1
  and v0.19.2 all shipped that way). `--prerelease` **is** the hold: a pre-release
  is out of `latest` by definition, so the previous, complete Release keeps
  answering until this one can. `finalize-release` is the only step that may put
  a Release back into `latest`; it runs only on the release event, it verifies
  this Release's assets first, and a `workflow_dispatch` repair never promotes —
  a repair must not mutate release metadata. Close the window by hand instead
  with `gh release edit v<version> --prerelease=false --latest`. Only the newest
  published Release is ever promoted, so re-running an older Release's workflow
  attaches its assets but cannot move `latest` backwards onto an old tag.
- **If the window cannot be opened or closed, the run fails and prints the one
  command that finishes the flip by hand.** The state PATCH is retried on
  transient failures first; reaching that line means it failed three times, and
  nothing is protecting the feed until it is dealt with, so treat it as the
  incident it is: fix the cause and re-run the workflow (`gh run rerun
  <run-id>`), or run the printed line. A failed hold also stops the builds, so on
  that path re-running is what produces the assets. A build that fails leaves the
  Release a pre-release, so an incomplete release is never offered — fix the
  build and re-run rather than promoting it.
- **Derive the window from the commits, not from the commit shape.** Use a plain
  `git log <last-tag>..origin/main` and read the PR references out of it. **Never
  `git log --merges`**: GitHub's *merge* button produces a merge commit that
  `--merges` sees, while its *squash* button produces a single-parent commit that
  `--merges` silently drops. The trap therefore fires **per PR, according to
  which button someone happened to press**, so a wrong window is not empty — it
  is **partially listed**, and a partially correct window looks right and
  survives review. Check it rather than trusting this paragraph:

  ```sh
  git log --oneline --merges       <last-tag>..origin/main
  git log --oneline --first-parent <last-tag>..origin/main
  ```

  `--first-parent` is safe for *counting* the window because both button shapes
  land on that chain, but do not adopt it as a general "show me every PR" idiom:
  for a PR landed with the merge button it shows only `Merge pull request #999
  from feat` and never the substantive commit on the second parent, so when a
  merge subject is uninformative the plain log carries the real description and
  the first-parent walk does not.
- **Re-derive the window immediately before `gh release create`, not once when
  you claim it.** A PR merged after the bump commit and before the tag still
  rides the release, because the tag names a SHA and everything reachable from it
  ships — which is how the backend's v0.51.4 shipped a PR that was absent from
  its notes even though the owner had derived the window correctly when they
  started. Deriving it right once does not help if the derivation is stale by the
  time you tag.
- **Check `git diff <last-tag>..origin/main -- package.json` is empty before
  tagging.** A non-empty diff means a merged PR carried its own version bump and
  has silently consumed the number you are about to use. That is exactly how two
  numbers were burned in the backend — each consumed by a PR's own bump, neither
  ever built, tagged or published, and the next owner had to skip both. The
  `version-bump-guard` now catches this on the PR, but it does **not** block an
  `--admin` merge, because this repository configures no required status checks,
  so the pre-tag check is the backstop.
- **The tag names the commit `origin/main` pointed at when the window was cut,
  and validate-release enforces it.**
  `scripts/validate-release.mjs` refuses a tag that does not match its Release,
  or whose SHA has moved since the event fired, so a Release created without
  `--target` — or against a tag re-pointed afterwards — fails `validate-release`
  rather than shipping the wrong tree.
- **A release note that omits a merged PR is a defect in the release.** It is the
  only record of what changed under a user who is about to update.

### Versioning: choose the bump by materiality, not commit type

The version in `package.json` and the `vX.Y.Z` tag are chosen by the
**user-facing materiality** of the change, **not** by its conventional-commit
type. A `feat:` commit is *not* automatically a minor. Using the commit type as
the version signal is how a run of bug-fix and reliability releases inflates the
minor number and drains its meaning — a minor should mark a step-function
improvement a user would notice and adopt, so that going from `0.N.x` to
`0.(N+1).0` still tells them something.

The bump is chosen **once per release window** by the release owner, for the
window as a whole. A PR argues for a bump through its body's
`Release: <patch|minor> — <impact>` line; it does not apply one.

- **Patch (`0.N.x` → `0.N.(x+1)`) — the default; most releases are patches.** Bug
  fixes, performance and reliability improvements, refactors, internal cleanups,
  docs, and small self-contained features that do not change what the app can
  fundamentally do. A single small `feat:` commit is a patch. **When in doubt,
  patch.**
- **Minor (`0.N.x` → `0.(N+1).0`) — a material, step-function capability.**
  Reserve it for a new surface or subsystem a user would notice and adopt. The
  test is simple — if you cannot name the step-function capability in the release
  title (`X.Y.0: <the new thing>`), it is a patch, not a minor. Several small
  features bundled together are still patches unless one of them clears this bar
  on its own — and that holds for a whole window: ten patches merged in the same
  hour are one patch release, not a minor.
- **Major (`X.y.z` → `(X+1).0.0`) — only on explicit request.** Bump the major
  version *only* when the developer explicitly asks for it, in the rare case
  where the new version is considered a distinct product from its predecessor.
  Never decide a major bump on your own judgement.

Because releases run frequently here, err toward patch: an under-called bump is
trivially corrected by the next release, while an over-called minor permanently
misreports how much changed.

## Notes for Future Agents

- **Merging is not releasing.** Land the PR as soon as its review rounds are
  clean and fresh and CI is green; do not bump the version on your branch and do
  not cut a Release for one PR. If a window is already open — an open PR titled
  `chore(release): ...`, found with the `gh pr list` search above — `send` its
  owner your PR number and merge SHA at merge time.
- **If the developer explicitly asks for a release**, act as the release owner
  and run the runbook above end-to-end unless told otherwise. A request to
  *implement* something is not a request to release it: implement, land, and let
  the window's owner cut the release.
- If there are unrelated uncommitted changes, do not discard them; proceed
  carefully and scope your commit.
- Keep release notes aligned with prior repository style, cover **every** PR in
  the window, and include a compare-link changelog.

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
