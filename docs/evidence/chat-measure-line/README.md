# The conversation column's resize cue, before and after

Frames for issue #848: the column's resize cue joining the app's one resize
language. Five states, two palettes, each photographed on **two trees** — `before/`
is unmodified `origin/main` (`64bd6cc00fe`, this branch's fold point after round 1's
remediation) and `after/` is this branch's head.

The complaint, verbatim from the issue: the 72px bar floating in the transcript's
empty margin *"reads as a mistake"* rather than as the column's boundary.

## How to reproduce

```sh
# The base tree's Storybook, from a worktree at origin/main (any session-unique path)
git worktree add --detach ~/local-operator-ui-worktrees/measure-handle-848-base origin/main
(cd ~/local-operator-ui-worktrees/measure-handle-848-base && ./node_modules/.bin/storybook dev -p 6392 --ci)
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
| `hover-right/` | The 72px bar, 2px wide, centred on the Y the pointer entered at, floating **28px past** the column's right edge in the empty margin. | The divider family's full-height 2px line, its inner edge **on** the column's right edge, in the resting `control` tint — and the tooltip, `Drag to resize. Double-click or Enter to reset.`, just above the hand. |
| `hover-left/` | The same bar past the column's left edge. | The same full-height line on the column's left edge, tooltip just above the hand. |
| `dragging/` | The bar promoted to `accent`, button still held, the column already at the new width. | The line promoted to `accent`, full height, on the moved column's edge, tooltip closed. |
| `hover-scrolled/` | The bar on the scrolled pane (its own Y is the pointer's, so it stays visible). | The line on the scrolled pane, with the tooltip **inside the pane** — the state agent review round 1's M1 was about. |

The right edge is the state the issue's report is about; the left edge is
photographed because the two handles move **one symmetric measure**, so a
right-edge-only frame could not say whether the left one reads the same way. It
does (see `hover-left/` in both halves) — both edges stay, and that is stated
here rather than left for the design round to discover from a single frame.

**`hover-scrolled` is a rig-shaped transcript, and it says so.** The story's own
transcript fits its pane, which is the one shape where a content-height tooltip
anchor still lands somewhere visible; the rig clones the rendered prose block
inside the content column and clips the scroller to 240px, which is what makes
the column taller than the pane. The markup is real rendered output, not a
fixture — the pane height and the transcript length are the rig's, and the
subject (where the panel lands) is the component's.

**Both halves were re-shot when the base moved, and nothing moved.** The fold
that followed round 1 took the base from `d70f2645599` to `64bd6cc00fe`; the pair
was re-taken against the new base and every frame came back byte-identical (the
rig rewrote the files and `git status` stayed clean), which is the byte-level
proof that the fold did not touch this surface. Upstream's own diff agrees: it
touched the header cluster, the ask badge and their scripts, and nothing in the
transcript or the measure.

## The readings the run asserts, in both palettes

| Reading | `before/` | `after/` |
| --- | --- | --- |
| cue opacity at `rest`, both edges | `0` | `0` |
| cue opacity on its own edge's hover | `1` | `1` |
| cue opacity while dragging | `1` | `1` |
| cue height | `72px` | the column's own height (306.9px here) |
| cue width | `2px` | `2px` |
| cue's inner edge against the column's edge | **28px past it** (in the margin) | **on it** (within 1px) |
| the drawn mark against the grab band (`elementFromPoint` at the mark's centre) | **inside the band** — the bar is grabbable | **inside the band** — the line is grabbable |
| the band's inner edge against the column's edge | 24px out | **on it** (within 1px) |
| the tooltip panel vs the pane, at the top / middle / bottom scroll position | no panel on this tree | inside the pane at all three (measured `61..106` in the 240px pane) |

Two of these are the round-1 findings stated as geometry. The mark-in-band
reading is UX round 1's U1: the previous head drew the line on the column's edge
and left the band 24px out, so a press on the rule hit the transcript `DIV` and
moved no width, where the shipped bar was grabbable — *the mark IS the target* is
now an assertion on both halves rather than a claim. The panel-vs-pane reading is
agent review round 1's M1, whose arithmetic said the panel goes off-screen on a
scrolling transcript; with the anchor on the separator's content-height rect it
did (measured in a browser: `1473..1500` mid-scroll and `-49..-22` at the bottom
of a 620px viewport).

The band reads the same in both halves because the base tree's strip already
contained its bar; the head's band now contains the line. The band's own offset
moved (24px → 0px, i.e. onto the column's edge, hugging the line from the gutter
side) and is asserted separately per half, because it is the geometric reason the
control cannot swallow a click meant for the text (design round 1's D2).

## What this set is evidence for

- **The cue is now the app's one resize language.** `before` vs `after`, same
  records, same pane, same palettes: the mark in the margin becomes the state
  line the five panel dividers draw, on the column's real edge.
- **The mark and the grab target are one place again.** Every family divider puts
  its band over its line; so does this now, without reaching inward past the
  column's edge.
- **The tooltip stays with the reader.** Anchored at the hand, it is inside the
  pane at the top, the middle and the bottom of a scrolling transcript.
- **Nothing was lost with the bar.** `rest` is still empty in both halves, and
  the drag state still promotes to `accent` — the divider family's two states,
  `control` for grabbable and `accent` for moving.

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
- **The panel now sits over the prose it is beside.** Anchored to the hand and
  `side="top"`, its 256px box crosses the column's edge — measured
  `794..1050` with the column ending at `917`. That is the trade the
  hand-anchoring buys: it is a tooltip (the app's other 200 do the same), it is
  `pointer-events-none` so it cannot swallow a click, and the alternative was
  the panel that leaves the pane entirely.
