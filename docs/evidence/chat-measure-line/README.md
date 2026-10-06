# The conversation column's resize cue, before and after

Frames for issue #848: the column's resize cue joining the app's one resize
language. Four states, two palettes, each photographed on **two trees** — `before/`
is unmodified `origin/main` (`d70f2645599`, this branch's fold point) and `after/`
is this branch's folded head.

The complaint, verbatim from the issue: the 72px bar floating in the transcript's
empty margin *"reads as a mistake"* rather than as the column's boundary.

## How to reproduce

```sh
# The base tree's Storybook, from a worktree at origin/main
git worktree add --detach /tmp/lo-ui-base origin/main
(cd /tmp/lo-ui-base && ./node_modules/.bin/storybook dev -p 6392 --ci)
# This branch's Storybook
./node_modules/.bin/storybook dev -p 6391 --ci
# One run drives both, writes every frame and asserts every reading
node scripts/chat-measure-line-evidence.mjs \
  --before http://localhost:6392 --after http://localhost:6391
```

`scripts/chat-measure-line-evidence.mjs` launches one private headless Chrome per
(half, palette) with a **scratch profile of its own per run**, drives a real
pointer through CDP, and reads the geometry back out of the page. It FAILS
rather than printing a table if a reading is wrong, and every frame passes
`check-evidence.mjs`'s own `assertFramePaints` before it is written.

The per-run profile is not tidiness: the drag step COMMITS a width, and the first
cut of this rig shared one profile across the whole run — the second palette then
opened at the first one's stored `1100`, rendered at the pane's 992 and read as a
column the 810px cap had stopped binding on. That was a defect in the rig that
looked exactly like a defect in the product, which is what the rig's own comment
now records.

## What each frame shows

| Frame | `before/` (origin/main) | `after/` (this branch) |
| --- | --- | --- |
| `rest/` | No cue at all. The strip is hit-testable; nothing is drawn. | No cue at all — the line is `opacity-0`, not absent. |
| `hover-right/` | The 72px bar, 2px wide, centred on the Y the pointer entered at, floating **28px past** the column's right edge in the empty margin. | The divider family's full-height 2px line, its inner edge **on** the column's right edge, in the resting `control` tint — and the strip's tooltip, `Drag to resize · double-click to reset`. |
| `hover-left/` | The same bar past the column's left edge. | The same full-height line on the column's left edge, tooltip beside it. |
| `dragging/` | The bar promoted to `accent`, button still held, the column already at the new width. | The line promoted to `accent`, full height, on the moved column's edge. |

The right edge is the state the issue's report is about; the left edge is
photographed because the two handles move **one symmetric measure**, so a
right-edge-only frame could not say whether the left one reads the same way. It
does (see `hover-left/` in both halves) — both edges stay, and that is stated
here rather than left for the design round to discover from a single frame.

## The readings the run asserts, in both palettes

| Reading | `before/` | `after/` |
| --- | --- | --- |
| cue opacity at `rest`, both edges | `0` | `0` |
| cue opacity on its own edge's hover | `1` | `1` |
| cue opacity while dragging | `1` | `1` |
| cue height | `72px` | the column's own height (306.9px here) |
| cue width | `2px` | `2px` |
| cue's inner edge against the column's edge | **28px past it** (in the margin) | **on it** (within 1px) |
| the strip's inner edge against the column's edge | 24px out | 24px out (unchanged) |

The strip offset is asserted in BOTH halves because it is the geometric reason
the control cannot swallow a click meant for the text (design round 1's D2), and
this change moved the line without moving the target. `chat-measure-drag`'s rig
asserts the same number from the other direction.

## What this set is evidence for

- **The cue is now the app's one resize language.** `before` vs `after`, same
  records, same pane, same palettes: the mark in the margin becomes the state
  line the five panel dividers draw, on the column's real edge.
- **Nothing was lost with the bar.** `rest` is still empty in both halves, and
  the drag state still promotes to `accent` — the divider family's two states,
  `control` for grabbable and `accent` for moving.
- **The pointer target did not move.** The strip is 24px out in both halves, so
  the click-safety property the geometry exists for is unchanged, not re-argued.

## What this set does NOT prove, stated rather than implied

- **`Chat/Measure drag` is a story, not the packaged app.** The pointer path, the
  CSS property chain and the geometry are the shipped ones; the Electron shell
  around them is not exercised.
- **Two of the twelve sweep palettes.** The change is geometry and two theme
  roles (`control`/`accent`), both asserted in the light and dark defaults; the
  other ten sweep themes carry the same two roles.
- **The frames are 1060x620 viewports holding a 1024px pane**, so the column is
  never wider than ~992px and the line is never drawn at a width past that.
- **Hover is a real pointer, not a CSS class.** The rig moves a pointer and waits
  out the 200ms intent delay, so the tooltip (400ms) is open in the hover frames
  — that IS the state a reader reaches after resting on the strip.
- **The tooltip's own copy is not asserted here.** Radix's panel is the app's
  shared `ui/tooltip.tsx`; its string is in the component and visible in the
  frames.
