# The conversation column's resize cue, at the hover, before and after

The follow-up to [#848](https://github.com/damianvtran/local-operator-ui/issues/848)'s
line: the cue goes back to the reference's SHORT bar texture - the one #848's
first cut used, re-homed onto the measure's real edge rather than floating in the
margin - and the tooltip panel stops arriving under a hand that is only sweeping
past the gutter. Eleven states, two palettes, each photographed on **two trees**:
`before/` is unmodified `origin/main` (`46fd032ed59`, this branch's base) and
`after/` is this branch's head.

**EXTENDED FOR ROUND 2 (2026-10-06).** Two cells were added because the round's
findings were about the seat's EDGES rather than its middle, and the pair only ever
entered at the pane's middle: `top-entry` (entering 6px below the pane's top, which
painted 80 of the mark's 160 rows before the seat was held clear of the band) and
`drag-out` (a drag whose hand leaves the pane, which painted nothing at all before
the publication was held inside it). The rig also grew a frame-level check that a
panel-free state changes nothing but the cue's own column, and an animation-frame
trace across the release, both described under the readings below.

**RE-SHOT FOR ROUND 1's BLOCKER (2026-10-06).** The first cut rested the bar at
`50%` of the transcript COLUMN, so on any conversation taller than the pane it
painted off-screen while its `opacity` read `1` - the state this change exists for
was absent in the ordinary case (design D1-1, UX U1, reproduced independently by
both reviewers). The bar now rests on the **same seat the tooltip panel anchors
to**: the hand's own entry Y on the pointer's path, `visibleAnchorY()` on the
keyboard's. The pair was re-shot on that head, and the state that would have
caught it is now a frame of its own (`tall-rest`/`tall-hover`) rather than the
arithmetic the first version of this README reached for.

Two complaints, one surface. The operator's first note (issue #848) was that a
mark floating in the transcript's empty margin reads as a mistake, and the line
that answered it reads as a boundary - but a full-height rule also draws a hard
line down the whole transcript for as long as a hover lasts, which is more ink
than a hint wants. The second note is the panel: hovering "parks a box over
prose" (the box is the reset's only mouse channel, so it cannot simply go). This
pair is the evidence for both halves of the answer: a bar that is a fraction of
the column, and a panel that waits for the reader to actually stop.

## How to reproduce

```sh
# The base tree's Storybook, from a worktree at origin/main (any session-unique path)
git worktree add --detach ~/local-operator-ui-worktrees/measure-hover-base-1006 origin/main
(cd ~/local-operator-ui-worktrees/measure-hover-base-1006 && ./node_modules/.bin/storybook dev -p 6393 --ci)
# This branch's Storybook
./node_modules/.bin/storybook dev -p 6391 --ci
# One run drives both, writes every frame and asserts every reading
node scripts/chat-measure-hover-evidence.mjs \
  --before http://localhost:6393 --after http://localhost:6391
```

`scripts/chat-measure-hover-evidence.mjs` launches one private headless Chrome per
(half, palette), each with a scratch profile of its own, drives a real pointer
through CDP, and reads the geometry back out of the page. It FAILS rather than
printing a table if a reading is wrong, and every frame passes
`check-evidence.mjs`'s own `assertFramePaints` before it is written.

The per-run scratch profile is not tidiness: the drag step COMMITS a width, and
the sibling `chat-measure-line` rig measured what a shared profile does - the
second palette opened at the first one's stored width and read as a column the
810px cap had stopped binding on, a defect in the rig that looked exactly like a
defect in the product.

## What each frame shows

| Frame | `before/` (origin/main) | `after/` (this branch) |
| --- | --- | --- |
| `rest/` | No cue at all. The cue element is the column's full height and 2px wide, at `opacity: 0`. | The same element at the same size, `opacity: 0` - only the PAINT changed, not the box. |
| `hover-left/` | The **full-height rule** on the column's left edge, in the resting `control` tint. | The **fade bar**: 160px of ink, a 36px solid core fading out 62px each side, resting on the hand's own entry Y. No panel. |
| `hover-right/` | The same rule on the right edge. No panel. | The same bar on the right edge, on the same seat. No panel. |
| `hover-with-panel/` | The rule, and the panel above the hand: `Drag to resize. Double-click or Enter to reset.` | The bar, and the same panel - the pointer has now rested past the dwell on BOTH trees. |
| `dragging/` | The rule promoted to `accent`, button still held, the column already at the new width. | The bar promoted to `accent`, its core travelled down to the hand's own Y. |
| `after-reset/` | The rule again, the pointer back on the handle, the column back at the shipped 810px measure. | The bar again, the column back at 810px. |
| `keyboard-focus/` | The rule lit and the panel open - focus opens it at once. | The same: focus opens the panel at once on both trees. This change did not touch that channel. |
| `tall-rest/` | The scroller clipped to 240px with the column grown past it, pointer elsewhere, no cue. The diff reference for the frame after it. | The same layout, the same nothing - this is the state round 1's blocker was invisible in. |
| `tall-hover/` | The rule, filling the pane as it always did (it IS the column). | The bar, **inside** the pane on the hand's seat. The first cut of this change painted at the column's middle here - hundreds of pixels above the pane - while `opacity` read 1. |
| `top-entry/` | The rule again - it is the column, so it fills the pane at any entry height. | The bar, WHOLE, entered 6px below the pane's top: the seat is held `CUE_BAR_PX / 2` clear of the band, so the mark's own ends stay on screen instead of being sliced off at the pane's boundary. Same layout as `tall-*`, which is its diff reference. |
| `drag-out/` | The rule again, with the button held. | The bar, held INSIDE the pane with the hand 120px above it: the core stops at the pane's edge rather than travelling behind the scroller's clip with `dragging` reading 1. Same layout as `tall-*`. |

The right edge is the state #848's report is about; the left edge is photographed
because the two handles move **one symmetric measure**, so a right-edge-only frame
could not say whether the left one reads the same way. It does, in both halves.

`hover-with-panel` is the *rested* state on both trees (1400ms), which is why the
panel is in both. The beat where the two trees DIFFER - 520ms, past the app's own
400ms tooltip delay and well short of this branch's 1200ms dwell - is recorded as
a reading rather than a frame, because a picture of "no panel" and a picture of
"the cue" are the same picture at this x.

`tall-rest`/`tall-hover` are one layout with the cue unlit and lit, so their diff
is the cue and nothing else - which is what makes the tall-content reading a pixel
reading rather than an argument. The rig parks the pointer AND drops focus before
`tall-rest`: the step above it is `keyboard-focus`, and a focused separator keeps
the cue lit (the first cut of this step photographed a reference frame with the
bar already showing, and the diff came back empty on one tree and
panel-contaminated on the other).

## The readings the run asserts, in both palettes

| Reading | `before/` | `after/` |
| --- | --- | --- |
| cue opacity at `rest`, both edges | `0` | `0` |
| cue opacity on its own edge's hover | `1` | `1` |
| cue opacity on the OTHER edge, on that same hover | `0` | `0` |
| cue opacity while dragging / under keyboard focus | `1` / `1` | `1` / `1` |
| panel open at **520ms** on the pointer's channel | **open** | **closed** |
| panel open at 1400ms (rested) | open | open |
| panel open under keyboard focus | open | open |
| the cue ELEMENT's box | `2 x 306.9px` (the column's height) | `2 x 306.9px` (unchanged) |
| the cue's INK, off the painted gradient | none (the rule paints its own box) | `160px`: a `36px` core, `62px` of fade each side - and the SAME in every state (rest, hover, drag, tall) |
| the cue's INK, off the frames themselves | `307` rows - the whole column | `148` rows of 307 in the dark palette and `152` in the light |
| WHERE THE RESTING BAR SITS | not its question - the rule IS the column | the hand's own entry Y: the frames' ink centre reads `168.5` against a hand at `169.5` |
| the same reading on **TALL content** (pane clipped to `240px`, column `2725px`) | `221`/`222` rows - the rule fills the pane, bounded only by the column's own box | `148`/`152` rows, all of them INSIDE the pane (`44..191` / `44..195` within `0..240`) |
| the drawn mark against the grab band (`elementFromPoint` at the mark's centre) | **inside the band** | **inside the band** |
| a press 6px INSIDE the text edge | the transcript `DIV` | the transcript `DIV` |
| the band's inner edge against the column's edge | on it (within 1px) | on it (within 1px) |
| `--lo-chat-measure-cue-y` during a drag / after a release | absent (no publication) | `244px` at a hand `243.5px` below the column's top, and **removed** on the release - asserted, not just recorded |
| the cue's mark moving between two frames it is LIT for, traced at one sample per animation frame across the release | nothing to trace (a solid rule has no core to follow) | **it does not move**: `244` on every frame from the last lit one, through the fade, at `opacity 1.000` and below |
| `top-entry`: the mark's ink against the pane | `221`/`222` rows - the rule fills the pane | `140`/`144` rows, all INSIDE the pane - within 16 rows of the same mark read at the pane's middle (`148`/`152`), the difference being the pane's own top edge |
| `drag-out`: the mark's ink with the hand 120px outside the pane | `222`/`223` rows - the rule again | `90`/`94` rows, all INSIDE the pane: the core is held at the pane's edge rather than behind its clip |
| a panel-free state changing anything but the cue's column (`rest` vs the frame, in pixels) | `114..474` scattered encoder noise; a panel would be ~`11,000` | same - the margin is `3000` |

Three of these are the change stated as geometry. The ink reading is the one the
operator's note is about: the cue's element is the same full-height box it was
(`2 x 306.9`), and only its INK is a fraction of the column - read twice, off the
gradient's own stops and off the committed frames (the rows of the cue's column at
`x = 917..919`, the rig's own 3px window, that differ between `rest` and
`hover-right`). The frame reading is slightly inside the declared span (148-152
against 160) because the outermost stops are fully transparent and the committed
webp quantises a 2px bar; the assertion is a band, stated once in the rig rather
than tuned per palette. The declared 160px is itself a FRACTION of a real column
and not of this story's short one: 160px is 52% of the story's 307px column, and
17% of the 911px column the same component measures at a full window.

**The tall-content rows are round 1's blocker as a reading.** The pane is clipped
to 240px and the column grown to 2725px, which is the ordinary shape of a real
conversation and the one this story cannot show on its own. The base half's rule
fills the pane because the rule IS the column, and it stops with the column - 16px
short of the scroller's own box, which keeps its padding. This head's bar must be
INSIDE the pane, and it is, on the hand's seat: the first cut of this change
painted at the column's middle here, some 1,000px above the visible band, while
`opacity` read `1`. That is the reading the pair could not make in round 1 (design
D1-2), and the reason the state was added.

The 520ms panel reading is the second complaint stated as behaviour: the base
tree's panel is up after the app's own 400ms tooltip delay, and this branch's is
not - it waits 1200ms, the dwell `agents-sidebar.tsx` already uses for "only once
the pointer has decided to stay". The 1400ms and focus rows are the other half of
that claim: the panel is not GONE, it is later - and on the keyboard's channel it
is still instant, which is deliberate (see the component's comment and the PR
body: a keyboard reader has no double-click with which to discover the reset).

The cue-Y rows are the reference's own rule - the core follows the hand *during*
the gesture, and only then. The property is absent at rest and during hover, set
to the hand's own Y while the button is down, and REMOVED on release - read rather
than assumed, which is what agent round 2's R2-2 found this set claiming without
doing. The release does not hand the seat back to an older Y: it ADOPTS the seat the
gesture ended on and the pointer's leave is what retires it, so the mark cannot move
between two frames it is lit for. That last reading is the animation-frame trace,
and it is proved to discriminate: with the adoption disabled the same run fails with
`244 -> 154 at opacity 1.000`, which is UX round 2's finding exactly.

**The two edge readings are round 2's findings as geometry, one cell each.** The
first is design D2-1: the seat was inside the pane and the mark's ENDS were not, so
entering the gutter near the pane's top read as a bar sliced off at the boundary
(measured before the fix: `80` of `160` rows). The seat is now held `CUE_BAR_PX / 2`
clear of the visible band, and `top-entry` is the entry that made the old numbers.
The second is agent R2-5, which asked for the drag's behaviour to be decided and
covered rather than inferred: the publication is held inside the pane as well as
inside the column, on the same reading that closed R1-4 - the mark may clip its
fades at a boundary, but it must not disappear behind one while it says you are
moving something. `drag-out` is a hand 120px above the pane, and the mark paints
`90`/`94` rows inside it where an unheld publication paints nothing at all.

**A frame that must be panel-free is checked as a FRAME.** The states above are
photographed ~320ms into a hover (the cue's arrival) and the base tree's tooltip
opens 400ms in, so the claim "no panel in this picture" was being made by a probe
taken at a different moment from the capture - agent round 2's R2-3, which noted
that a slow capture could commit a panel-bearing frame under an assertion taken
before it. The rig now reads the PICTURE: a panel-free state may change the cue's
own 2px column and nothing else, so `rest` against the frame must be within
`3000` changed pixels outside that column. Measured, a panel would put ~`11,000`
there, and this host's encoder noise contributes `114..474`. That is three orders
of magnitude rather than 80ms.

## What this set is evidence for

- **The cue's ink, not its box, is what shrank.** `before` vs `after`, same
  records, same pane, same palettes, same element: the full-height rule becomes
  160px of bar in the same 2px box. Nothing the attribute, the placement classes or
  the band's containment read off that box moved.
- **The cue is visible in the case this change exists for.** On a column grown
  past a 240px pane - an ordinary long conversation - the bar paints inside the
  pane on the hand's seat, where the first cut of this change painted hundreds of
  pixels above it while believing it was showing something.
- **The panel waits for the reader.** The 520ms reading is a like-for-like
  comparison of the two dwells, and the 1400ms and focus readings show what the
  panel still does.
- **Nothing was lost with the line.** `rest` is still empty on both edges in both
  halves, the drag still promotes to `accent`, the keyboard channel still opens
  the panel at once, and double-click/Enter still returns the column to the
  shipped measure.
- **The seat is a seat at every entry height, and the drag at every hand height.**
  The mark is whole on arriving 6px below the pane's top, and it still paints with
  the hand 120px outside the pane - the two edges the pair could not reach in round
  1, both measured off the frames rather than off the arithmetic behind them.
- **The mark is still the target.** Pressing the drawn cue reaches the band, and a
  press 6px inside the text still reaches the transcript - on both halves, so the
  guarantee is a reading rather than a claim about the diff.

## What this set does NOT prove, stated rather than implied

- **`Chat/Measure drag` is a story, not the packaged app.** The pointer path, the
  CSS property chain and the geometry are the shipped ones; the Electron shell
  around them is not exercised.
- **Two of the twelve sweep palettes.** The change is geometry and two theme roles
  (`control`/`accent`), both asserted in the light and dark defaults; the other
  ten sweep themes carry the same two roles.
- **The frames are 1060x620 viewports holding a 1024px pane**, so the column is
  never wider than ~992px and the cue is never drawn at a width past that.
- **The tall state is a grown content column, not a scrolled one.** The clone is
  real rendered prose and the scroller is real, but the rig grows the column past
  the pane rather than driving the scroller to an offset - the story's scroller is
  `flex-col-reverse` and does not take a chosen `scrollTop`. The reading does not
  turn on that difference (the bar's seat is the hand's entry Y measured against
  the wrapper's own top, so it lands on the hand whatever the scroll position),
  but a real conversation with a live loader is the end-to-end check that would.
- **The cue's ink is read as a colour difference against a reference frame**, so it
  is the span of rows a reader could SEE, not the gradient's nominal 160px - the
  two differ by the fully transparent outer stops, and the rig says so rather than
  asserting the nominal number.
- **The two edge cells are the tall cell's clip, entered at the pane's top and
  dragged out of it.** They reproduce the geometry D2-1 and R2-5 are about (a mark
  whose ends meet the pane's boundary; a hand outside it) rather than a particular
  window size or gesture speed.
- **The release trace samples at one frame per animation frame.** A seat change
  shorter than a frame would be invisible to it, and it reads the gradient's stops
  - so it is blind to a change that moved the element without moving the core.
  Neither has a way to happen in this component (the seat is the only input to the
  paint), which is why the instrument's granularity is stated instead of argued
  around.
- **The dwell is asserted at one beat (520ms) and at rest (1400ms).** The
  transition between them is a timer, not a geometry; a frame between the two
  would be a picture of a `setTimeout`.
- **The panel's own copy is not asserted here.** Radix's panel is the app's shared
  `ui/tooltip.tsx`; its string is in the component and visible in the frames.
- **The panel still crosses the column's edge** (`794..1050` with the column
  ending at `917`) - the same trade #848's set records, and recorded in round 1 as
  design D1-3 under the operator's ruling that the box stays. It is a tooltip, it
  is `pointer-events-none` so it cannot swallow a click, and the alternative was
  the panel that leaves the pane entirely.
