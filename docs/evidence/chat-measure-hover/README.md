# The conversation column's resize cue, at the hover, before and after

The follow-up to [#848](https://github.com/damianvtran/local-operator-ui/issues/848)'s
line: the cue goes back to the reference's SHORT bar texture - the one #848's
first cut used, re-homed onto the measure's real edge rather than floating in the
margin - and the tooltip panel stops arriving under a hand that is only sweeping
past the gutter. Seven states, two palettes, each photographed on **two trees**:
`before/` is unmodified `origin/main` (`46fd032ed59`, this branch's base) and
`after/` is this branch's head.

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
| `hover-left/` | The **full-height rule** on the column's left edge, in the resting `control` tint. | The **fade bar**: 160px of ink, a 36px solid core fading out 62px each side, centred on the column's middle. No panel. |
| `hover-right/` | The same rule on the right edge. No panel. | The same bar on the right edge. No panel. |
| `hover-with-panel/` | The rule, and the panel above the hand: `Drag to resize. Double-click or Enter to reset.` | The bar, and the same panel - the pointer has now rested past the dwell on BOTH trees. |
| `dragging/` | The rule promoted to `accent`, button still held, the column already at the new width. | The bar promoted to `accent`, its core travelled down to the hand's own Y. |
| `after-reset/` | The rule again, the pointer back on the handle, the column back at the shipped 810px measure. | The bar again, the column back at 810px. |
| `keyboard-focus/` | The rule lit and the panel open - focus opens it at once. | The same: focus opens the panel at once on both trees. This change did not touch that channel. |

The right edge is the state #848's report is about; the left edge is photographed
because the two handles move **one symmetric measure**, so a right-edge-only frame
could not say whether the left one reads the same way. It does, in both halves.

`hover-with-panel` is the *rested* state on both trees (1400ms), which is why the
panel is in both. The beat where the two trees DIFFER - 520ms, past the app's own
400ms tooltip delay and well short of this branch's 1200ms dwell - is recorded as
a reading rather than a frame, because a picture of "no panel" and a picture of
"the cue" are the same picture at this x.

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
| the cue's INK, off the painted gradient | none (the rule paints its own box) | `160px`: a `36px` core, `62px` of fade each side |
| the cue's INK, off the frames themselves | `307` rows - the whole column | `148` rows of 307 in the dark palette and `151` in the light, centred at `169` - the element's own middle |
| the drawn mark against the grab band (`elementFromPoint` at the mark's centre) | **inside the band** | **inside the band** |
| a press 6px INSIDE the text edge | the transcript `DIV` | the transcript `DIV` |
| the band's inner edge against the column's edge | on it (within 1px) | on it (within 1px) |
| `--lo-chat-measure-cue-y` during a drag / after release | absent (no publication) | `244px` at a hand `243.5px` below the column's top, and **removed** on release |

Three of these are the change stated as geometry. The ink reading is the one the
operator's note is about: the cue's element is the same full-height box it was
(`2 x 306.9`), and only its INK is a fraction of the column - read twice, off the
gradient's own stops and off the committed frames (the rows of the cue's column at
`x = 917..918` that differ between `rest` and `hover-right`). The frame reading is
slightly inside the declared span (148-151 against 160) because the outermost stops are
fully transparent and the committed webp quantises a 2px bar; the assertion is a
band, stated once in the rig rather than tuned per palette. The declared 160px is
itself a FRACTION of a real column and not of this story's short one: 160px is 52%
of the story's 307px column, and 17% of the 911px column the same component
measures at a full window - the story's pane is shorter than the app's own minimum,
so 52% is the conservative end of the range rather than a case a reader reaches.

The 520ms panel reading is the second complaint stated as behaviour: the base
tree's panel is up after the app's own 400ms tooltip delay, and this branch's is
not - it waits 1200ms, the dwell `agents-sidebar.tsx` already uses for "only once
the pointer has decided to stay". The 1400ms and focus rows are the other half of
that claim: the panel is not GONE, it is later - and on the keyboard's channel it
is still instant, which is deliberate (see the component's comment and the PR
body: a keyboard reader has no double-click with which to discover the reset).

The cue-Y rows are the reference's own rule - the core follows the hand *during*
the gesture, and only then. The property is absent at rest and during hover, set
to the hand's own Y while the button is down, and REMOVED on release, so the bar
returns to the column's middle rather than holding a hand that has gone.

## What this set is evidence for

- **The cue's ink, not its box, is what shrank.** `before` vs `after`, same
  records, same pane, same palettes, same element: the full-height rule becomes
  160px of bar in the same 2px box. Nothing the attribute, the placement classes or
  the band's containment read off that box moved.
- **The panel waits for the reader.** The 520ms reading is a like-for-like
  comparison of the two dwells, and the 1400ms and focus readings show what the
  panel still does.
- **Nothing was lost with the line.** `rest` is still empty on both edges in both
  halves, the drag still promotes to `accent`, the keyboard channel still opens
  the panel at once, and double-click/Enter still returns the column to the
  shipped measure.
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
- **The cue's ink is read as a colour difference against `rest`**, so it is the
  span of rows a reader could SEE, not the gradient's nominal 160px - the two
  differ by the fully transparent outer stops, and the rig says so rather than
  asserting the nominal number.
- **The dwell is asserted at one beat (520ms) and at rest (1400ms).** The
  transition between them is a timer, not a geometry; a frame between the two
  would be a picture of a `setTimeout`.
- **The panel's own copy is not asserted here.** Radix's panel is the app's shared
  `ui/tooltip.tsx`; its string is in the component and visible in the frames.
- **The panel still crosses the column's edge** (`794..1050` with the column
  ending at `917`) - the same trade #848's set records. It is a tooltip, it is
  `pointer-events-none` so it cannot swallow a click, and the alternative was the
  panel that leaves the pane entirely.
