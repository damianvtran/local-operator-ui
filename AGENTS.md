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
  0.0111% of channels, against 0.0106% between two `headless` runs at that size
  and 0 between two at 800x600: the residual is a blinking caret at the
  composer, not the mode;
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

## Release Bump Runbook (Major/Minor/Patch)

Use this process whenever asked to cut a release.

1. Preflight
- Confirm you are on `main`: `git branch --show-current`
- Check working tree: `git status --short --branch`
- Sync refs/tags: `git fetch --tags origin`

2. Determine new semver
- Current version: `node -p "require('./package.json').version"`
- Bump rule:
  - Patch: `X.Y.Z -> X.Y.(Z+1)`
  - Minor: `X.Y.Z -> X.(Y+1).0`
  - Major: `X.Y.Z -> (X+1).0.0`

3. Update version
- Edit `package.json` version to the target release version.
- Verify: `node -p "require('./package.json').version"`

4. Commit and push branch
- Commit message format:
  - `chore(release): bump version to <version>`
- Commands:
  - `git add package.json`
  - `git commit -m "chore(release): bump version to <version>"`
  - `git push origin main`

5. Create and push tag
- Annotated tag:
  - `git tag -a v<version> -m "v<version>"`
  - `git push origin v<version>`

6. Review diff vs previous tag
- Previous tag: `git describe --tags --abbrev=0 v<version>^`
- Commit range: `git log --oneline <prev_tag>..v<version>`
- File/stat summary: `git diff --stat <prev_tag>..v<version>`

7. Review prior release style
- Inspect recent releases:
  - `gh release list --limit 5`
  - `gh release view <prev_tag> --json name,tagName,body,publishedAt`

8. Draft release notes (match existing template)
- Use this structure:

```md
## What's New

<1-2 sentence summary>

- **<Change Area>**: <description>
- **<Change Area>**: <description>

## Impact

- **No Breaking Changes**: <or explicitly call out breaking changes>
- **<User/Developer Impact>**: <description>

## PRs
- Direct commits included in this release range:
  - `<short_sha>` <commit subject>
  - `<short_sha>` <commit subject>

**Full Changelog**: https://github.com/damianvtran/local-operator-ui/compare/<prev_tag>...v<version>
```

9. Create GitHub release with gh CLI
- `gh release create v<version> --title "<release title>" --notes-file <notes_file>`

10. Post-release verification
- Confirm release exists: `gh release view v<version> --json url,name,tagName,publishedAt`
- Confirm branch/tag pushed:
  - `git ls-remote --heads origin main`
  - `git ls-remote --tags origin v<version>`

## Notes for Future Agents

- If the user asks for a release bump, execute the full workflow end-to-end unless told otherwise.
- If there are unrelated uncommitted changes, do not discard them; proceed carefully and scope your commit.
- Keep release notes aligned with prior repository style and include a compare-link changelog.

## Who may merge: agent review is sufficient for a code owner

Code owners are listed in `.github/CODEOWNERS`. **This repository has no
ruleset requiring an approving review**, so there is no approval gate to clear
here — `CODEOWNERS` routes review requests, it does not block merges. The rule
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
