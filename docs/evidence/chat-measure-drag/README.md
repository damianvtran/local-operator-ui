# The conversation column's drag handle

Frames and readings for the affordance that lets the reader widen or narrow the
chat column, and for the rule that decides what a gesture is allowed to store.

RE-CAPTURED FOR ISSUE #848 (2026-10-06): the cue is now the app's one resize
language - a full-height 2px state line on the measure's real edge, the same line
the five panel dividers draw - instead of the 72px bar that used to float in the
transcript's margin. Every frame here was re-taken on that head, and the rig's
readings now assert the line's geometry. The before/after pair for that change
is its own set, `docs/evidence/chat-measure-line/`.

## How to reproduce

```sh
# Storybook on any free port
./node_modules/.bin/storybook dev -p 6185 --ci
# Drives a real pointer, writes the frames, asserts every reading
node scripts/chat-measure-drag-evidence.mjs http://localhost:6185 --json
```

`scripts/chat-measure-drag-evidence.mjs` launches Chrome **twice against one
`--user-data-dir`** (a real relaunch: a new process and a fresh JavaScript
context reading the profile the first one wrote - not a page reload, which
would keep the in-memory store), drives the handle through the CDP input
pipeline, and reads the store back after each step. Every frame passes
`check-evidence.mjs`'s own `assertFramePaints` before it is written. The run
FAILS rather than printing a table if any reading is wrong, so a wrong reading
cannot reach the frames. The table's literals are re-stamped from each run by
hand: the rig asserts relations (a reset against the parsed shipped value),
not these literals, so a stale number here is a docs defect rather than
something a run can catch (agent review round 1's R1-4 and QA's Q-1).

The failure this rig was built against: its first run showed the double-click
reset storing nothing AND the relaunch losing the last write. Both were real -
`onDoubleClick` never fired on a handle whose press starts a drag (the reset is
now decided from the press's own click count), and `SIGKILL` was taking
`localStorage`'s last unflushed batch with it (Chrome is now closed gracefully,
with `SIGKILL` only as a fallback). A rig that asserted only pixels would have
missed both.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| `rest/` | The column at the shipped measure with the pointer elsewhere: **no cue at all**. The strip is there and hit-testable, but nothing is drawn - this is the frame that makes "subtle" checkable rather than asserted. |
| `hover/` | The pointer resting on the RIGHT edge. The full-height 2px state line in the resting `control` tint, its inner edge on the column's right edge, plus the strip's tooltip (`Drag to resize · double-click to reset`). It REPLACED a 72px bar centred on the Y the pointer entered at and floating 24px clear of the content edge (design round 1's D2); the bar's geometry, and the before/after pair, are in `docs/evidence/chat-measure-line/`. |
| `hover-left/` | The same hover on the LEFT edge, at the same 450ms wait: the two handles move one symmetric measure, so the mirror is read rather than assumed. |
| `dragging/` | Mid-gesture, **button still held**. The line has promoted to the accent tint (the divider's own two-state convention: control means "grabbable", accent means "moving"), the column is already at the new width, and the store has NOT been written yet - `stored` reads `null` in the same reading. |
| `at-ceiling/` | After releasing at the far end of an outward drag. The store holds **1100** (the clamp); the column renders 992px because the pane in this story is 1024px. That gap is not a defect, it is the resize rule in one frame: a stored width wider than the pane renders at the pane, and the stored value is untouched. |
| `at-floor/` | Released at the other end: the store holds **520**, the column renders 520, and the sample runs 14 lines at **75.6 characters a line** - the floor lands just above the 45-75 guidance, which is what it was chosen for. |
| `after-reset/` | After a double-click on the handle. The property is removed (not set to a number), the store reads `null`, and the column is back at the shipped measure. `deepseek-harness`, which this affordance follows, has no reset at all. |
| `after-restart/` | A **second Chrome process** on the same profile. The width a reader kept before the relaunch comes back: store `930`, rendered `930`. |

## The readings the run asserts, in both themes

| Step | stored | rendered max-width | line opacity (right / left) |
| --- | --- | --- | --- |
| `rest` | `null` | 810px | 0 / 0 |
| `hover` | `null` | 810px | 1 / 0 |
| `hover-left` | `null` | 810px | 0 / 1 |
| `dragging` (mid-gesture) | `null` | 1100px | 1 / 0 |
| `at-ceiling` | `1100` | 1100px | 0 / 0 |
| `at-floor` | `520` | 520px | 0 / 0 |
| `press-only` (a click) | `520` - **unchanged** | 520px | 0 / 0 |
| `after-reset` (double-click) | `null` | 810px | 0 / 0 |
| `before-restart` | `930` | 930px | 0 / 0 |
| `after-restart` | `930` | 930px | 0 / 0 |

(Opacities are the post-transition values; the rig reads a few `1e-06`-scale
residues on the `at-ceiling`/`at-floor` rows and asserts the sizes that matter
rather than those digits.)

`press-only` is the reading that matters most and the one no frame can carry: a
press with no travel stores **nothing**, so a double-click cannot replace a wide
preference with the width the window happened to allow. The arithmetic behind it
is unit-tested in `scripts/chat-measure-drag.test.mjs`; this is the same rule
driven through a real pointer in a real browser.

## Decisions this set is evidence for

- **The reader's width replaces the shipped default as the cap; the responsive
  rule survives as the physical ceiling.** The stored value is never rewritten
  by a resize - `at-ceiling` is literally that state: a stored 1100 rendered at
  the 992px pane this story's column allows, with the store still reading 1100.
- **Nothing is committed until the release, and a gesture that did not travel
  commits nothing at all.** `dragging` shows the preview-without-commit half;
  `press-only` shows the refusal.
- **Reset is a deliberate addition.** `deepseek-harness` has none, and its
  absence makes the product's own measure unreachable after one drag.
- **No cue at rest, and the cue is the app's one resize language.** `rest` vs `hover`: invisible until asked for, and then a full-height rule on the column's edge rather than a mark in the margin (issue #848).

## What this set does NOT prove, stated rather than implied

- **`Chat/Measure drag` is a story, not the packaged app.** The pointer path,
  the store, the CSS property chain and the persistence are all the shipped
  ones; what is not exercised is the Electron shell around them.
- **Two of the twelve sweep palettes.** The change is geometry and two theme
  roles (control/accent), both of which are asserted in the light and dark
  defaults; the other ten sweep themes carry the same two roles.
- **The frames are 1060x620 viewports holding a 1024px pane**, so the column is
  never wider than ~992px. A reader's 1100px choice is therefore asserted
  numerically (`at-ceiling`, stored 1100) and shown as the pane's own width
  rather than drawn at 1100.
- **Hover is a real pointer, not a CSS class.** The rig moves a pointer and
  waits out the 200ms intent delay; a frame taken without that wait would show
  the resting state under a name that claims a hover.
