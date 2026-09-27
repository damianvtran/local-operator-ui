# The conversation column's drag handle

Frames and readings for the affordance that lets the reader widen or narrow the
chat column, and for the rule that decides what a gesture is allowed to store.

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
FAILS rather than printing a table if any reading is wrong, which is why the
numbers below and the frames cannot drift apart.

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
| `hover/` | The pointer resting on the right edge. A 2px bar in the resting control tint, 72px tall with a solid 16px core fading over 28px each side, centred on the Y the pointer entered at. It is at the column's edge and entirely outside the text. |
| `dragging/` | Mid-gesture, **button still held**. The bar has promoted to the accent tint (the divider's own two-state convention: control means "grabbable", accent means "moving"), the column is already at the new width, and the store has NOT been written yet - `stored` reads `null` in the same reading. |
| `at-ceiling/` | After releasing at the far end of an outward drag. The store holds **1100** (the clamp); the column renders 992px because the pane in this story is 1024px. That gap is not a defect, it is the resize rule in one frame: a stored width wider than the pane renders at the pane, and the stored value is untouched. |
| `at-floor/` | Released at the other end: the store holds **520**, the column renders 520, and the sample runs 14 lines at **75.6 characters a line** - the floor lands just above the 45-75 guidance, which is what it was chosen for. |
| `after-reset/` | After a double-click on the handle. The property is removed (not set to a number), the store reads `null`, and the column is back at the shipped measure. `deepseek-harness`, which this affordance follows, has no reset at all. |
| `after-restart/` | A **second Chrome process** on the same profile. The width a reader kept before the relaunch comes back: store `1020`, rendered `1020`. |

## The readings the run asserts, in both themes

| Step | stored | rendered max-width | cue opacity |
| --- | --- | --- | --- |
| `rest` | `null` | 900px | 0 |
| `hover` | `null` | 900px | 1 |
| `dragging` (mid-gesture) | `null` | 1100px | 1 |
| `at-ceiling` | `1100` | 1100px | 0 |
| `at-floor` | `520` | 520px | 0 |
| `press-only` (a click) | `520` - **unchanged** | 520px | 0 |
| `after-reset` (double-click) | `null` | 900px | 0 |
| `before-restart` | `1020` | 1020px | 0 |
| `after-restart` | `1020` | 1020px | 0 |

`press-only` is the reading that matters most and the one no frame can carry: a
press with no travel stores **nothing**, so a double-click cannot replace a wide
preference with the width the window happened to allow. The arithmetic behind it
is unit-tested in `scripts/chat-measure-drag.test.mjs`; this is the same rule
driven through a real pointer in a real browser.

## Decisions this set is evidence for

- **The reader's width replaces the shipped default as the cap; the responsive
  rule survives as the physical ceiling.** The stored value is never rewritten
  by a resize - `before-restart` is literally that state: a stored 1020 rendered
  at a 992px pane, with the store still reading 1020.
- **Nothing is committed until the release, and a gesture that did not travel
  commits nothing at all.** `dragging` shows the preview-without-commit half;
  `press-only` shows the refusal.
- **Reset is a deliberate addition.** `deepseek-harness` has none, and its
  absence makes the product's own measure unreachable after one drag.
- **No cue at rest, and the cue is not a full-height rule.** `rest` vs `hover`.

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
