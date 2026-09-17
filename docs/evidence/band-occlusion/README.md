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
which is the moment the app is already announcing a state change. A measured inset
does not remove that shift: it moves the app by the same amount the moment a band
appears or its copy changes, and only a **permanently reserved slot** would remove it,
at the cost of moving the no-band layout for every user on every launch. What the
in-flow shape buys is that a band can never be the reason a row is missing. The cost
as measured on this shape — the mis-aim window at the instant of the shift, the
click swallowed on arrival, the window's three displacements — is recorded on the PR
under its *Accepted trade-offs and recorded costs* section.

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
- **the app's `position: fixed` set grows with the bands** - 0 with no band up, 1 with
  one, 2 with both, and 4 once the first-run wizard is back over them - which is the
  count `app.tsx` reasons about after this change. (An earlier draft of that comment
  claimed one such element; the measurement is why it now states two, and the bands
  leave the set.) An earlier reading of this field said 2/3/4 because it was taken with
  the wizard up, whose own scrim and dialog are two of them: the pair below seeds the
  wizard away, and the JSON the frames ship with carries 0/1/2.

## The measured state after the fix

`after/after-geometry.json`, from the same rig at the same window size, window mode,
stub sequence and dpr (`1380x900` -> a `1380x868` viewport at dpr 2, `headless`), with
the first-run wizard seeded away on this half too. Read it against the table above: the
region now gives up exactly the bands' height, and nothing is covered at any height.

| state | bands | band rect (CSS px) | band total | region (top / height) | sidebar search control (device) | chat list header (device) | covered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | 0 | — | 0 | 0 / 868 | 96-160 | 29-68 | no |
| `one-line` | 1 | y 0, h 53, `static` | 53 | 53 / 815 | 202-266 | 135-174 | no |
| `two-line` | 1 | y 0, h 68, `static` | 68 | 68 / 800 | 232-296 | 165-204 | no |
| `two-bands` | 2 | y 0 h 68 (connectivity), then y 68 h 53 (compatibility), both `static` | 121 | 121 / 747 | 338-402 | 271-310 | no |

The three claims the fix was chosen for, each read off the JSON above:

- **no row is covered at any band height.** Every band-reachable anchor reports
  `coveredByBand: false` in every state. The two anchors the acceptance list names are
  the sidebar search control and the chat list's header, and their displacement is
  exactly the band height in device px: 96-160 -> 202-266 is +106 (53 CSS px at dpr 2)
  and -> 232-296 is +136 (68), while their offset below the REGION's top stays 48 and
  14.25 CSS px in all four states - the region translates and the contents do not
  reflow, which is the same fact from the other side.
- **the region is the window minus the bands**, 868 / 815 / 800 / 747 against a band
  total of 0 / 53 / 68 / 121, and `documentElement.scrollHeight == clientHeight == 868`
  with `overflow-y: hidden` in all four - so nothing the band took has been pushed out
  of view either.
- **two bands stack rather than overlap**: rects at y 0 and y 68, summing to 121, where
  the before half has both at y 0 and 68 CSS px of the 121 painted.

### The pixel claim, which the rects cannot make

The rig asserts one thing about the picture rather than the boxes: for every device row
the bands declare (`0 .. bandTotal*dpr - 1`) the row is the bands' own paint - one flat
colour out to both window edges, either a band's ground or that band's own 1 px bottom
rule - and the row at `bandTotal*dpr` is not. That is "the app's first painted row
starts exactly at the bands' device height".

Measured, per band state: 0 of 106 (one band), 0 of 136 (the other), 0 of 242 (both),
and 0 of 242 for the danger pair. The pair's grounds are `#2b1c19` (danger) over
`#292215` (warning) - 1.040:1 apart, which is the designer's "~1.04:1" confirmed - and
their rules are `#955e54` and `#82713f`, 3.12:1 and 3.29:1 against their own grounds, so
the line between the two bands is what actually divides them.

The rig's other pixel comparison - this frame against the no-band frame of the same
run, shifted by the band height - is REPORTED and not asserted, and the reason is
measured: the app's own content changes under a band (a band IS a signal that the
backend state changed, so the pane paints a different notice), and it changes in the
region's first ~30 CSS px. As an equality assertion it fails for a reason that is not
the defect, on the tree that fixes it.

### The pair is a pair: the cross-tree control

With no band up **on the chat route**, the two halves are **pixel-identical**:
`before/before-none.png` against `after/after-none.png`, 0 of 1736 device rows differ,
asserted by the run (`noneFrameDiff` in `before/before-geometry.json`). So the
restructure costs the layout nothing when nothing is up, and every difference between
the two halves ON THAT ROUTE is the bands.

The control is scoped to the state it asserts, and the scope is measured rather than
assumed (design round 1, D4). On the **`/browser` route** the same no-band pair does
NOT hold: `before/browser-none.png` and `after/browser-none.png` differ in **158 of
1736 device rows**, in two blocks - CSS y 41-87.5 across x 324-1371.5, and CSS y
200-231.5 across x 8-211.5 - by at most 9/255 per channel. No row is added or removed
and no edge moves, so it is not a layout residue of this change; the two likeliest
readings are a tint caught mid-flight between the two runs or a pointer/hover state
that differed between them. It is disclosed rather than re-driven (the host is under
its load hold, and the pair costs one drive per half), and the browser route's own
reading stays qualitative and separate: the whole chrome row is under the band before
and complete below it after.

### The minimum window (C1), and what it moved

`after-min/after-min-geometry.json`, `--window-size 800x600` -> an **`800x568`**
viewport (the number is the record's own `viewport.h`, `region.rect.bottom` and
`documentScroll.clientHeight`; the string `572` this line used to carry occurs nowhere
in the JSON), two bands up. **The bands are taller here: 132 CSS px, not 121**, and the
+11 is ONE wrapped copy rather than two: the compatibility band grows **53 -> 64** CSS
px at this width, while the connectivity band is **68 CSS px in both windows** - its
second line is the refused address, which it carries at 1380x868 as well, where the
`one-line` state measures 53. That is the copy-dependent height the record's first
paragraph is about, measured at a second size. The region is 132 / 436, no anchor is
covered, `scrollHeight == clientHeight == 568`, and the rig's pixel claim holds for all
264 band rows.

Looked at, not only measured: no glyph row is cut at the region's bottom edge - the last
8 CSS px below the app's lowest text are flat ground, in three clean columns - and the
reduced height is absorbed by the app's own scroll containers (the chat list column
paints its own scrollbar in the frame). The **composer is not in this scene at all**: a
sessionless draft paints no message input at either window size, so "fully visible and
operable" is not something this evidence measures; it is named here rather than
implied. The committed min frame paints the pane's DRAFT branch (`Start a chat`), which
is why it cannot answer the operability half of the design round's C1 - a composer
reachable with two bands up, and a press on either band's `Retry` - and that half is
handed to QA's drive (design D5, QA Q5) rather than asserted from this frame. Nothing
needs a region floor at 800x600.

### The two copies, seen together (C2)

`after/after-two-bands.png` is the first frame in which the connectivity band and the
compatibility band are visible at once: "Not connected to a Local Operator server. If
one is still running, the app reconnects on it on its own." (with the refused address
under it) directly above "The Local Operator server is missing auth, settings, commands,
catalogues, lifecycle, mcp, radient support. Update it to enable those surfaces." The
pair reads as one stacked block split by a hairline rather than as two notices: the
washes are 1.04:1 apart, so the ground does not separate them and only the 1 px rule
does. The copies do not contradict each other - one is cause, one is consequence - but
they are two independent notices of equal weight, and the second's imperative ("Update
it") reads oddly beside the first's promise that the app is reconnecting by itself.
`after/after-two-bands-danger.png` is the same stack with the connectivity band's
`danger` copy ("The Local Operator server stopped. The app keeps looking for one and
attaches to it when it appears."), and `after/after-scrim.png` puts the first-run
wizard's scrim over both bands: the scrim dims them like everything else on screen,
which is the whole point of the band being in flow.

## The frames

| frame | state |
| --- | --- |
| `before/before-none.png` | attached daemon, every required capability advertised: no band, the control (pixel-identical to `after/after-none.png` on the chat route; the browser route's no-band pair is not, by 158 rows - design D4) |
| `before/before-one-line.png` | six of the seven required features withdrawn: the compatibility band alone, covering the pane's first row and the search control's top |
| `before/before-two-line.png` | the address quiet, main's own second line in the copy: the connectivity band alone, device 0-136 |
| `before/before-two-bands.png` | both bands up at once, overlapping at `y 0` — the case that decided the shape |
| `after/after-none.png` | the same state on the fixed tree: the control, and the half the cross-tree diff is against |
| `after/after-one-line.png` | 53 CSS px taken out of the region, nothing covered |
| `after/after-two-line.png` | 68 CSS px, the connectivity band alone, the region keeping 800 |
| `after/after-two-bands.png` | the two bands STACKED (y 0 h 68 over y 68 h 53): the case that decided the shape, now photographable as two bands |
| `after/after-two-bands-danger.png` | the same stack with the connectivity band's `danger` copy |
| `after/after-none-reattached.png` | both bands cleared by an answering daemon, region back to 868 |
| `after/after-scrim.png` | the first-run wizard's scrim over both bands — an in-flow band is dimmed like everything else |
| `after-min/after-min-two-bands.png` | C1 at `800x600`: both bands up, 132 CSS px of band, region 132/436 |

The two halves also carry the states the rig drives on the way through but that this
record does not tabulate - `before/before-*` and `after/after-*` for
`browser-none`/`browser-one-line`/`browser-two-bands` (the `/browser` route, where the
content rect `use-browser-chrome` measures is recorded: device 156-1736, 262-1736 and
398-1736), `two-bands-danger`, `none-reattached` and `scrim` - all in the same two
`*-geometry.json` files.

## What produced them

```bash
# each half, against its own build; the full recipe and its order are below
node scripts/band-occlusion-evidence.mjs --expect uncovered \
  --out docs/evidence/band-occlusion/after --label after
node scripts/band-occlusion-evidence.mjs --expect covered --compare-against \
  docs/evidence/band-occlusion/after/after-none.png \
  --out docs/evidence/band-occlusion/before --label before
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

Proven, from the frames and the JSON above, on BOTH halves: the defect as described
(covered rows, by intersection, and the two bands overlapping rather than stacking),
the copy-dependent band height (53 against 68 CSS px in one window, and 132 at
`800x600`), the region's height and the absence of a document scrollbar in every state
of both halves, the fix's own three acceptance claims (no row covered at any height, the
region keeping exactly the window minus the bands, two bands stacking at 68 + 53), and
the cross-tree control that says the restructure costs the layout nothing when no band
is up - asserted on the chat route's `none` state, which is the state it holds on (D4).

NOT proven here, and named rather than implied:

- **the frames were taken on the pass's OWN tree, not on this head, and the rig that
took them was touched in the same pass** - the four defects below are the record of
that. The frames are pictures of the pre-fold tree the pass ran on (`src`
`d19dbadc6ed3`, the tree of `141e5219e`/`51ce4aea1`; the manifest's `srcTree` is the
tree they SHIP IN, `dcff3db3f591`, and the two are different on purpose), with a real
`pnpm build` on each half, and the same rig took both halves, which is what the pair
requires. This bullet used to say the frames are pictures of the `src/` they ship with;
that is the opposite provenance and it was wrong (review 2, F1).
- **the three folds onto `main`'s `013aad424`, `e89142ac6` and `ace40b3b6` are STAMPED,
  NOT RE-CAPTURED**, and the delta each one moves is measured rather than summarised.
  The frames were taken on the head *before* the folds, so the window that has to be
  accounted for is the pass's tree against this head: `git diff --name-status 141e5219e
  44b68172b -- src/` is **110 files**, and every surface this scene paints is either
  byte-identical or comment-only. Byte-identical: `app.tsx` (`b09cb3b2e67e`), both band
  components (`880bcad3c23b`, `4dc6a06799c0`), `chat-page.tsx` (`a02a5b518855`),
  `dialog.tsx` (`6b694466a8b5`) and the command palette (`e1fcdcae0fe7`). Comment-only
  (comment-stripped text identical, hashes given): `chat-sidebar.tsx` (`2dd925edde7d` ->
  `6f3956b76303` - the chat list's own column, and the `⌘ + N` cap visible in the
  two-band frame), `alert.tsx` (`61b64d97f147` -> `f34101ef6111` - the component BOTH
  bands render), `keyboard-shortcut.tsx`, `chat-content.tsx`, `markdown.css`,
  `message-input.tsx`, `destination-pickers.tsx` and `base-theme.ts`. The two palettes
  this scene paints are byte-identical across the window: the `localOperatorDark` and
  `localOperatorLight` blocks in `themes.generated.css` are 914 and 924 bytes in both
  trees, unchanged. The window's code changes are in surfaces no frame mounts - the
  chat header, the canonical transcript and its timestamps, the trace rows, the
  analytics panels, `data-table.tsx`, `date-utils.ts`, `theme-selector.tsx` - which is
  the same argument from the other side as the draft branch: the pane paints `Start a
  chat` and the chat list has no rows to stamp.
- **the third fold's own delta, since it is the one a summary got wrong** (review 2,
  F1; QA Q1). `git diff --name-status e89142ac6 ace40b3b6 -- src/` moves **86 files**:
  **49** added - **47** of them palettes, the other two the theme grid's own new
  `theme-grid-navigation.ts` and a `theme-selector.stories.tsx` (an addition repaints
  nothing that already exists) - **32** comment-only, and **5** that change code:
  `settings/components/theme-selector.tsx`, `shared/themes/index.ts`,
  `shared/themes/palette-contract.ts`, `shared/types/theme.ts` and
  `styles/themes.generated.css`. None of the five is on the captured `#/chat` or
  `#/browser` route, and in `themes.generated.css` all twelve pre-existing theme blocks
  are byte-identical (47 theme blocks are added). "Palettes and generated theme CSS"
  was the summary this record carried; it describes 48 of the 86 files - the palettes
  and `themes.generated.css` - and leaves the 32 comment-only files, the other four code
  changes and the two non-palette additions out of the account, `alert.tsx` among them,
  which is the face of the surface under review. A reviewer who would rather see the
  frames re-taken on the fold's own tree should say so: that is one drive per half.
- **`headless` is not a focus path**: the bands' `Retry` controls render as they do for
  nobody, and nothing here measures a press. The minimum-window state says the same
  about the composer: it is not painted at all in this scene, so C1 measures geometry
  and not operability.
- **the stub is a stub**: these frames are evidence about the renderer and the shell
  they describe, not about main's daemon state machine, which
  `scripts/daemon-health-state.test.mjs` and `scripts/daemon-discovery-evidence.mjs`
  own.
- **the re-wired rigs.** `attach-frame-evidence.mjs` and `browser-chrome-proof.mjs` were
  re-wired to read the bands structurally in the previous round and NOT re-run here:
  this drive does not cover them, so those two edits remain read-verified only.
- **the pane's own first row as an asserted anchor.** The rig records it in every state
  (`paneFirstRow`), and asserts it is clear only where a band could reach it: measured,
  it sits at the region's top in the states where the pane paints a notice and 374.3 /
  408.3 CSS px below it in the states where the pane has nothing else to say and centres
  its statement. That is the app's copy moving, not a probe drifting, which is why the
  third acceptance anchor is `chatListHeader` rather than this row.

### The four defects this pass found in the rig, and what each was

Named here because they are why the pass exists and because the next author should not
re-find them. All four are fixed in `scripts/band-occlusion-evidence.mjs`.

1. **The expression the rig sends did not parse.** `MEASURE` is one template literal, and
   a description inside it spelled an apostrophe with a backslash - which a template
   literal consumes, closing the string early. Measured: every read answered
   `SyntaxError: missing ) after argument list`, the rig reported only "the page answered
   nothing: no context yet", and the run died at its FIRST state after the full 180 s
   wait with the app perfectly healthy. The rig now parses its own expression before it
   launches anything and exits 2 with the reason.
2. **The band detector's replacement could not see the pane it named.** `paneFirstRow`
   resolved the pane as the chat list's parent, and on this tree the chat list's parent is
   a sidebar-column `div` holding the nav and nothing else - 0 elements, six times, which
   failed every state. The scope is `main`, the element that holds both columns.
3. **The pixel assertion never ran.** `assertState` is handed the MEASUREMENT and the
   pixel result was parked on the record entry, so `m.pixels` was always undefined and
   the check was dead code - the exact "recorded rather than asserted" failure review
   round 1's N4 was about, surviving one round. What runs now is the designer's own
   claim (see above), and it is computed from the frame's pixels.
4. **The scrim state could not be reached, by construction.** It un-seeds the first-run
   wizard at the point in the run where the daemon is DOWN (that is what the connectivity
   band is), and the wizard is not a stored preference: the app decides it from the
   backend's provider census, so with no backend the decision stays "pending" and no
   wizard opens. Measured: 150 s of `onboardingVisible: false`, which killed the run. The
   state now starts the stub again with the feature set narrowed but `auth` kept, which is
   the one capability the census is asked through.

## Reproducing the pair

The two halves differ in `src/` and in NOTHING else: the same rig, the same stub
sequence, the same window mode and size, the same dpr, and the first-run wizard
seeded away on both. **Both halves are built**, one after the other, because
`out/` is what the rig drives and a `before` run over an `after` build is a frame
labelled as the wrong tree (review round 1, M4).

```bash
FIX=$(git rev-parse e142fee59)                    # the fix, on the rebased lineage
RIG=HEAD                                          # the rig, which arrives AFTER the fix

# BEFORE: the fix's parent's src, with the rig from $RIG, built and driven. The
# pixel-identity control against the other half's no-band frame runs HERE, in the
# direction-agnostic `none` state, because this pass took the after half first (see
# below) and this run is the one that could see both frames.
git checkout "$FIX^" -- src
pnpm build
node scripts/band-occlusion-evidence.mjs --expect covered \
  --compare-against docs/evidence/band-occlusion/after/after-none.png \
  --out docs/evidence/band-occlusion/before --label before
git checkout HEAD -- src

# AFTER: the fixed src, built, driven - the half the PR exists for, so it is taken
# FIRST on a machine where a host budget allows only one drive at a time. The two
# halves are still one pair: same rig, same stub sequence, same window mode and size,
# same dpr, the wizard seeded away on both, and a real `pnpm build` on each tree.
# (The command the previous revision of this recipe gave here - the before half
# followed by an after half carrying `--compare-against` - is equivalent; the control
# is asserted in the `none` state of either run.)
node scripts/band-occlusion-evidence.mjs --expect uncovered \
  --out docs/evidence/band-occlusion/after --label after
```

The rig is not on the pre-fix commit - it arrived in the commit AFTER the fix, so
`git worktree add /tmp/band-before <rig commit>` checks out a tree that already
carries the fix, and the fix's parent carries no rig at all. Taking `src/` from
`"$FIX^"` and leaving `scripts/` at `$RIG` is what makes the pair a pair.

Two further states, both taken on the fixed tree because both are about the shape
this change chose:

```bash
# C1: the minimum window (800x600 -> an 800x568 viewport on Electron 44.3.0), two
# bands up. MEASURED: 132 CSS px of band against a 436 px region, not the 121/~451
# this line used to predict - and the +11 is ONE wrapped copy, the compatibility
# band's (53 -> 64 CSS px), while the connectivity band is 68 in both windows
# because its second line is the refused address, not a wrap.
node scripts/band-occlusion-evidence.mjs --expect uncovered --only two-bands \
  --window-size 800x600 --out docs/evidence/band-occlusion/after-min --label after-min
```

Each run also records every state it passes through, whether or not this record
tabulates it: `--only` gates what is asserted, not what is driven, so both halves
carry the `browser-*`, `two-bands-danger`, `none-reattached` and `scrim` frames and
states as the run reaches them.

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
