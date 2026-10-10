# Composer status row — the goal's and the loop's own rows

The operator's own ask, in the frames that carry it: the goal and the loop each
own a full-width line above the composer, the count strip keeps its own, and the
pair of frames at each of the widths the change is argued at shows what moved and
what did not.

> Btw now that there's a lot in the composer top row, we might want to consider
> putting goal and loop on their own lines, same style, but just on a new row for
> each since goal and loop would be too squished to be properly visible in most
> cases.

`docs/composer-status-tabs.md` § 15 is the design record these frames answer to;
this file says where the pixels came from, what each one is evidence of, and what
they are not.

**The frames come from the OPERATOR'S BROWSER, not from a rig's own headless
Chromium** — the same policy and the same divergence the two earlier sets record
(`docs/evidence/composer-status-clear/README.md`, and
`manifest.json`'s `captureOrigin.browserToolPass`). One background tab, one
`screenshot` per state per palette, `action=close` when done.

## The two halves, and the before half's provenance

| Half | Frames | Shot from |
|---|---|---|
| BEFORE | `before-900/`, `before-240/`, `before-520/` | the BASE component (`b53efe973ea`'s `composer-status-row.tsx`, restored for the pass) with this change's story file — the pair must be the same story and the same args on both sides, so the stories that carry it are this change's; the COMPONENT was untouched, and the frames print the old arrangement's own numbers |
| AFTER | `rows-900/`, `rows-240/`, `rows-520/`, `rows-172/`, `rows-alone/`, `rows-long/`, `rows-expanded/`, `rows-dismiss-focus/`, `rows-empty/` | this change's tree (component and stories), the same stories and args as the before half where a pair exists |

**The story labels are deliberately NEUTRAL** ("900: the goal, the loop and the
four counts"): they were the one pair shot on both sides, and a label describing
either arrangement would be a still asserting a state its own pixels contradict
on the other half.

**Why 520 is a fourth width rather than only the three the design record names:**
measured on both sides, 900 and 240 do not carry the readability delta this
change exists for. At 240 the old wrap had ALREADY separated the two chips (the
frames print the same `goal 141px (text 71/188)` on both sides) and at 900 the
goal showed its whole text on both sides (the loop sat at the trailing edge
instead), so the width band where the two SHARED a line is the one the operator's
ask is about. `140 + 8 + 269 = 417` is what fits a shared line, 460's content box
(412) is five pixels short of it, and 520 is where the frames can show the pair.

## The commands

```sh
# The stories, served from THIS worktree. 6018 and not 6019: a new port is a new
# origin, the browser tool's allow-list is per origin, and 6018 is the origin the
# earlier set's pass left approved (measured: 6019 opened but refused a screenshot
# with `origin_not_allowed`, and the pass walked back rather than raising a new
# approval prompt for one port).
npx storybook dev -p 6018 --no-open --quiet
```

Then, in the operator's browser, one page per frame (theme `localOperatorDark` /
`localOperatorLight` via `args=theme:` — the only palette channel a browser tool
has, `.storybook/preview.tsx`'s own decorator):

```
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-band-240&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-band-520&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-floor&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-alone&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-long&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-expanded&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-dismiss-focus&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-loop-rows-empty&viewMode=story&args=theme:localOperatorDark
```

The conversion: the browser's PNGs (2560x1440 device px for a 1024x576 CSS
viewport, the host's own 2.5x scale) are written as LOSSLESS WebP at that scale
with the repo's `sharp`, three channels like every committed frame in this
repository, and every file was proven pixel-identical (decoded back and compared
byte for byte) before it was kept. The conversion script is a scratch file in the
capture session, deliberately not committed: it is three lines of `sharp`, and the
proof is the equality it printed per frame.

## The reveal: what produced these frames, and what they therefore do NOT show

`:hover` IS BROWSER STATE and the `browser` tool has no hover verb, so
`rows-dismiss-focus/` is the FOCUS path: `useFocusLastDismiss` focuses the goal's
dismiss, which paints the same reveal a pointer would (`group-hover` and
`group-focus-within` are one class string, `DISMISS_REVEAL`, asserted as two equal
SETS in `scripts/composer-tabs.test.mjs`). Two consequences, stated rather than
implied:

- **The HOVER APPEARANCE IS NOT IN THIS SET AND IS NOT VERIFIED BY PIXELS.** No
  frame here paints `hover:bg-accent-wash` or the `hover:text-ink` step; the
  class-string parity pin and `scripts/contrast-contract.mjs`'s `reading button,
  hovered` row stand in for it, exactly as the earlier set recorded.
- **The dismiss's own tooltip IS painted in that frame** (the focus opens it in
  this host), which overlaps the counts row below; the frame's claim is the
  reveal's geometry (`dismiss gap 0px` at the chip's trailing edge in the goal's
  own row), and the caption says the tooltip is open.

## The frames

| Frame (`<theme>.webp`) | What it shows |
| --- | --- |
| [`before-900/`](before-900/) | **The old arrangement at the app's own column**, as this pass measured it on the base component: the six chips on two lines — goal and loop SHARING the first, with the loop pushed to the trailing edge — row `58px` tall, `overflowX 0px`, `goal 257px (text 188/188)`, `loop item 269px in 810px`. The pair's before half. |
| [`rows-900/`](rows-900/) | **The change at the same column**: the goal's line, the loop's line (`Loop: running, 2 of 5 turns`), the four counts on the third — row `84px` tall, `overflowX 0px`, everything else unmoved (`goal 257px (text 188/188)`, `loop item 269px in 810px`). The delta is the arrangement, and the +26px is the loop's own line. |
| [`before-240/`](before-240/) | **The old arrangement at the copy band's own edge** (240, where `@max-[240px]` has NOT fired): one element per line ALREADY — the wrap had stacked it — `goal 141px (text 71/188)`, `loop item 196px in 240px: "Loop: running"`, row `158px`. |
| [`rows-240/`](rows-240/) | **A measured no-op**: identical facts on this side — `goal 141px (text 71/188)`, `loop item 196px`, row `158px`, `overflowX 0px`. The band's frames exist to say what did NOT move, and to pin the copy rules' boundary against the arrangement's retirement. |
| [`before-520/`](before-520/) | **THE MOTIVATING DEFECT, as a number**: `Goal: Reconcil…` — `144px (text 75/188)` — beside `Loop: running, 2 of 5 turns`; row `54px`. This is the band where the two chips shared a line (§ the argument above). |
| [`rows-520/`](rows-520/) | **The fix, measured**: the same story, `goal 257px (text 188/188)` on its own line, the loop below, the counts below that; row `80px`. |
| [`rows-172/`](rows-172/) | **The app's real floor, both sides identical**: `goal 136px (text 67/188)`, `loop item 136px`, `26px` dismisses, row `158px`, `overflowX 0px` — the other width the retired `flex-col` step was argued at. |
| [`rows-alone/`](rows-alone/) | **The three single-source lines**, one band each: goal alone (row `32px`, 1 dismiss `89px`), loop alone (row `32px`, 1 dismiss `86px`), counts alone (row `32px`, 1 chip, 0 dismisses — and the plan chip takes the first-chip cancellation). The gates that keep an absent source from drawing a line. |
| [`rows-long/`](rows-long/) | **The two unbounded values on their own rows**: `goal 695px (text 625/1956)` — the truncation happens against the row's own width — and `loop item 276px in 810px: "Loop: running, 2 of 25 turns"` — the long clause kept whole. Row `84px`. |
| [`rows-expanded/`](rows-expanded/) | **The expanded body in the per-row form**, opened by a click on the real trigger: row `112px` (the body's own 24px and its gap over the 84px collapsed), `goal 257px (text 188/188)`, with the loop and the counts keeping their rows below. |
| [`rows-dismiss-focus/`](rows-dismiss-focus/) | **The goal's dismiss revealed by focus** at `dismiss gap 0px` in the goal's own row; the caption names the open tooltip (see the reveal section above). This is the geometry the move could have broken. |
| [`rows-empty/`](rows-empty/) | **The all-absent state**: no goal, no loop, no counts renders NOTHING above the composer — no empty rows for the missing sources. A `Band` without `RowFacts`, because there is no row to measure. |

## What these frames are not

- **Not a hover frame, and not the twelve-theme sweep.** Two brand palettes —
  `docs/branding.md` § 9.9's minimum, and where contrast defects hide — not
  twelve; the hover paint is unverified for the reason at the top of this file.
  A full sweep still needs the rig, and the rig cannot run under this machine's
  operator policy.
- **Not the story sets next door, and both are stale for this change.** The swept
  `chat-composer-status-row/` set predates the dismiss affordance and the loop
  chip; `composer-status-clear/` predates this change (its frames are the
  clear/stop record and are left in place). Neither is replaced here: this set
  covers the per-row delta, its empty states and its interactions, and a
  re-capture of either earlier set is the sweep's work on a machine where the
  sweep may run.
- **Not a Tab walk.** The focus states are programmatic (`useFocusLastDismiss`),
  which is what a click cannot do for the reveal; the keyboard half of the reveal
  is the class-string parity pin, and the focus ORDER is the DOM order the source
  test pins.
- **Not a live-app capture.** The bands render the production `ComposerStatusRow`
  in Storybook; the composer box under each band is a stand-in whose only jobs
  are the ground and the row's vertical cost. The live app's own composer is
  `docs/evidence/composer-readings/`'s subject.
- **Not a claim about the old set's numbers.** Every `RowFacts` caption printed
  into a frame is that frame's own read, taken at its own capture; where a number
  above is stated as "unchanged", it was read on BOTH sides in this pass.
