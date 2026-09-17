# The full-bleed bands, in flow (D9)

This directory was the brief for the band's occlusion. It is now the record of the
fix, the measurements it was decided on, and the frames that carry them.

## The defect, in one paragraph

Both bands used to be `fixed inset-x-0 top-0` strips rendered inside the shell's
`relative flex h-screen overflow-hidden` root
(`connectivity-banner.tsx:258` at `z-2200`, `backend-compatibility-banner.tsx:150`
at `z-2100` on `main`). A `fixed` band is painted OVER the layout, so every row it
covered was **absent, not displaced**. Measured below, on the app itself: with either
band up, the pane's own first text row and the top of the sidebar's search control
were band paint, and the band's own height follows its copy.

## The decision, and the trade-off that was accepted

**The bands are the shell's first children, in flow, above a `flex-1 min-h-0`
region** (`app.tsx`). Nothing can be covered at any band height, by construction.

The alternative was a **reserving inset**: keep the bands `fixed` and give the shell
a top inset measured from them. It lost on measurement rather than taste:

- the band's height is **copy-dependent** — 53 CSS px with one line, 68 with two, in
  the same 1380x868 window (below) — so an inset would have to be measured from the
  band rather than chosen, and re-measured on every copy change;
- **two bands can be up at once** (`ConnectivityBanner` and
  `BackendCompatibilityBanner` have independent triggers), and both were pinned to
  `y 0`, so they OVERLAPPED rather than stacked: `before-two-bands.png` photographs
  two bands whose DOM heights are 68 and 53 CSS px with only 68 CSS px painted, and
  the inset would have to sum the two the moment the shape changed to stack them.

What was given up: an in-flow band **shifts the app down** at the moment it appears —
which is the moment the app is already announcing a state change — where a reserving
inset would not. What that buys is that a band can never be the reason a row is
missing.

## What the fix is

| file | change |
| --- | --- |
| `src/renderer/src/app.tsx` | the shell root becomes a flex COLUMN, the two bands are its first children, and the app's own region becomes `flex-1 min-h-0` in a `flex overflow-hidden` row below them |
| `src/renderer/src/shared/components/common/connectivity-banner.tsx` | root `fixed inset-x-0 top-0 z-2200 w-full` -> `w-full`; the comment records the new shape and why it replaced the old |
| `src/renderer/src/shared/components/common/backend-compatibility-banner.tsx` | root `fixed inset-x-0 top-0 z-2100 w-full` -> `w-full`; same, with the two-bands case named |
| `src/renderer/src/features/command-palette/components/command-palette.tsx`, `src/renderer/src/shared/components/ui/dialog.tsx` | the two stacking comments that justified `z-[2300]` by "the banner is `fixed` and 68px tall" now say what the modal actually clears |
| `scripts/palette-contract.test.mjs` | the geometric invariant is kept and re-expressed: no band declares a stacking level, the modal declares one |

No colour, no copy, no radius and no spacing changed: this is geometry.

## The measured state before the fix

`before/before-geometry.json`, from the rig below: 1380x900 window -> **1380x868
viewport at dpr 2** (Electron 44.3.0), window mode named by the app's own
`[window-mode]` line (`headless`, window created and never shown, page throttling
off, no Dock tile).

| state | bands | band rect (CSS px) | band rows (device px) | sidebar search control | pane's first text row | region height |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 0 | — | — | css y 48-80, device 96-160 | css y 14.25-33.75, device 29-68 | 868 |
| `one-line` | 1 | y 0, h 53, `fixed`, z 2100 | 0-106 | **covered** | **covered** | 868 |
| `two-line` | 1 | y 0, h 68, `fixed`, z 2200 | 0-136 | **covered** | **covered** | 868 |
| `two-bands` | 2 | both at `y 0`, h 68 (z 2200) over h 53 (z 2100) | 0-136 painted | **covered** | **covered** | 868 |

"Covered" is an **intersection test**, not a pixel judgement: the band's
`getBoundingClientRect()` against the anchor's, which is the probe the brief asked
for. Reproducing the brief's own numbers: its device rows for the search control
(96-105, its top border and rounded corners) and for the daemon-absent band (0-134 at
67 CSS px) sit inside these to within the copy difference between its state and this
one.

Three things this table says that a frame cannot:

- **the region keeps the window at 868 in every band state** — a `fixed` band takes no
  height from the layout, which is what makes the covered rows absent rather than
  displaced (and what the after half must show changing to 868 minus the bands);
- **`documentElement.scrollHeight == clientHeight == 868` with `overflow-y: hidden`**
  in all four states: no scrollbar appears, so the band is not hiding a row that
  scrolled out of view;
- **the app's `position: fixed` set grows with the bands** — 2 with no band up, 3 with
  one, 4 with both — which is the count `app.tsx` reasons about after this change.
  (An earlier draft of that comment claimed one such element; the measurement is why
  it now states two, and the bands leave the set.)

## The frames

| frame | state |
| --- | --- |
| `before/before-none.png` | attached daemon, every required capability advertised: no band, the control |
| `before/before-one-line.png` | six of the seven required features withdrawn: the compatibility band alone, covering the pane's first row and the search control's top |
| `before/before-two-line.png` | the address quiet, main's own second line in the copy: the connectivity band alone, device 0-136 |
| `before/before-two-bands.png` | both bands up at once, overlapping at `y 0` — the case that decided the shape |

## What produced them

```
node scripts/band-occlusion-evidence.mjs --out docs/evidence/band-occlusion/before --label before
```

The rig boots the BUILT app in the documented `headless` window mode, in an isolated
HOME, config dir, `--user-data-dir` and port pair, with `VITE_DISABLE_BACKEND_MANAGER=true`
so no backend of the operator's can be spawned, an allowlisted environment, `CMUX_*`/
`LOP_*` stripped, notifications off through `scripts/notifications-off.mjs`, and it
asserts the app's own `[window-mode]` line rather than trusting the variable it set.
Frames come from the app's own `Page.captureScreenshot` over CDP - never macOS
`screencapture`, and never a mode that takes the operator's focus.

Nothing in the app can force a band on: the connectivity band is MAIN's daemon status
and the compatibility band is the backend's capability answer, so the rig IS a stub
daemon and walks the four states in one boot (attached and complete -> features
withdrawn -> address quiet -> both up). It is the same instrument the D9 brief's own
frames came from (`docs/evidence/daemon-attach-live-app/`), extended with the
measurement above. The app's own `scripts/renderer-driver.mjs` reaches only the
daemon-absent state - it has no backend, so it cannot photograph "no band" or a
one-line band at all - which is why the band states are taken here; its
`--scene states` boot reproduces that one state independently.

## What is proven, and what is not

Proven, from the frames and the JSON above: the defect as described (covered rows, by
intersection), the copy-dependent band height (53 against 68 CSS px in one window),
two bands overlapping rather than stacking, and the region's height and the absence
of a scrollbar in every state.

NOT proven here, and named rather than implied:

- **the AFTER half of this pair.** It needs a rebuild of the changed tree and a second
  app drive, and this box is under a HOST HOLD (measured by a peer session: load
  635/502/497, swap 21.5 GB of 23.5 GB used) that forbids another build or drive. The
  set therefore carries the before frames only, and the fix's own acceptance claims -
  no row covered at any of the three heights, the region's exact extent when no band
  is up, two bands stacking at 68 + 53 - are **unverified by frames** until the
  resumed pass takes them. That pass must re-take BOTH halves, because the state
  sequence has to be identical on both trees for the pair to mean anything.
- **the first-run wizard is up in these frames** (a fresh profile: "Connect a
  provider", step 1 of 6). It is a `fixed` overlay, so it is one of the two baseline
  `fixed` elements in the table and it sits over the middle of the pane; it touches no
  anchor (the numbers are rects), but the resumed pass should seed it away the way
  `attach-frame-evidence.mjs` does, on both halves, and the pair above should then be
  re-shot.
- **`headless` is not a focus path**: the band's `Retry` control renders as it does
  for nobody, and nothing here measures a press.
- **the stub is a stub**: these frames are evidence about the renderer and the shell
  they describe, not about main's daemon state machine, which
  `scripts/daemon-health-state.test.mjs` and `scripts/daemon-discovery-evidence.mjs`
  own.

## Reproducing the pair

The two halves differ in `src/` and in NOTHING else: the same rig, the same stub
sequence, the same window mode and size, the same dpr, and the first-run wizard
seeded away on both. **Both halves are built**, one after the other, because
`out/` is what the rig drives and a `before` run over an `after` build is a frame
labelled as the wrong tree (review round 1, M4).

```bash
FIX=$(git rev-parse <the fix commit>)          # 3ff404632 on this line
RIG=HEAD                                        # the rig, which arrives AFTER the fix

# BEFORE: the fix's parent's src, with the rig from $RIG, built and driven.
git checkout "$FIX^" -- src
pnpm build
node scripts/band-occlusion-evidence.mjs --expect covered \
  --out docs/evidence/band-occlusion/before --label before

# AFTER: the fixed src again, built, driven, and diffed against the before half's
# own no-band frame - the designer's "the restructure costs the layout nothing"
# control, which the run FAILS on if any device row differs.
git checkout "$RIG" -- src
pnpm build
node scripts/band-occlusion-evidence.mjs --expect uncovered \
  --compare-against docs/evidence/band-occlusion/before/before-none.png \
  --out docs/evidence/band-occlusion/after --label after
```

The rig is not on the pre-fix commit - it arrived in the commit AFTER the fix, so
`git worktree add /tmp/band-before <rig commit>` checks out a tree that already
carries the fix, and the fix's parent carries no rig at all. Taking `src/` from
`"$FIX^"` and leaving `scripts/` at `$RIG` is what makes the pair a pair.

Two further states, both taken on the fixed tree because both are about the shape
this change chose:

```bash
# C1: the minimum window (800x600 -> an 800x572 viewport on Electron 44.3.0),
# two bands up: 121 CSS px of band against a region with no floor.
node scripts/band-occlusion-evidence.mjs --expect uncovered --only two-bands \
  --window-size 800x600 --out docs/evidence/band-occlusion/after-min --label after-min
```

**Where a frame ends up is in the JSON.** Each state records `frame` as the path
relative to the repository when the run wrote inside it (and `out` as the
directory), so a state maps to a committed file without knowing the scratch
`--out` of the run that produced it; a run that writes outside the repository
records the absolute path it used (review round 1, N3).

A run leaves nothing behind: each boot is spawned in its own process group, the
teardown signals the group (the `node_modules/.bin/electron` shim's CHILD is the
app, so a signal to the shim's pid would orphan it), and a profile-match reap is
the backstop. The rig FAILS rather than records when a state breaks an acceptance
claim, so the exit status is the verdict.
