# Team Bridge's composer bar — the frames

Eight frames of `Team Bridge/Page`, at 1280×720 (the browser host's own viewport,
captured at DPR 2), in the two brand palettes: `empty`, `two-lines`, `at-cap` and
`attachment`, each in `localOperatorLight` and `localOperatorDark`. Plus one frame
of the story board's own defect, explained below.

They are captured from the Storybook the branch builds, through the Local
Operator desktop app's browser host — not from a throwaway headless Chromium, so
what is photographed is the same profile and engine a reviewer would use.

| file | story | state |
| --- | --- | --- |
| `light-empty.png`, `dark-empty.png` | `team-bridge-page--populated-direct-message` | nothing staged: one line, placeholder at the left |
| `light-two-lines.png`, `dark-two-lines.png` | same | a draft that wraps to two lines (box grew upward) |
| `light-at-cap.png`, `dark-at-cap.png` | same | a draft past six lines: the field holds at its cap and scrolls |
| `light-attachment.png`, `dark-attachment.png` | `team-bridge-page--composer-with-attachment` | one staged image chip above an otherwise empty bar |

## The numbers behind them

Read from `getBoundingClientRect` in the same session:

| state | bar rect | bar height | bar bottom | pane bottom | gap |
| --- | --- | --- | --- | --- | --- |
| empty | 379,658 810×46 | 46 | 704 | 720 | 16 |
| two lines | 379,638 810×66 | 66 | 704 | 720 | 16 |
| at the cap | 379,558 810×146 | 146 | 704 | 720 | 16 |
| one chip staged | 379,658 810×46 | 46 | 704 | 720 | 16 |

At the cap the field itself is 136px (`6 × 20px` of leading plus its own 16px of
padding) and carries `overflow-y: auto`; back at one line it is 36px and the bar
returns to 46px. The bar's border is 1px `border-control` at a 10px radius.

## What these frames cannot say

`scrollHeight` and `clientHeight` were NOT read back: the browser host the frames
come from has no JS-evaluate action, and a measurement tool that can only read
computed styles cannot see those two. The cap is evidenced instead by the two
observable consequences — the field pinned at 136px while the draft keeps
growing, and `overflow-y: auto` appearing on it, which is the branch this
composer takes only when its own measurement exceeds the cap — together with the
frame itself, where the first line has scrolled out and the caret sits on the
last visible one. A reviewer who wants the raw pair can read them from any
devtools session; this directory does not claim them.

## `board-before-dark.png` — the instrument, not the product

This one is deliberately not a "before" of the product. It is the **story board's**
defect with the NEW composer mounted: the decorator rendered the page in a bare
`h-dvh` block, where the page's `flex-1` is inert, so the pane collapsed to its
content height — measured 459.7px of pane (and 565px on an earlier capture of a
longer transcript) inside a 720px frame, leaving a band of empty canvas under
everything. The app's shell is a flex column and does not do this.

Which means the frames committed for the previous composer change were measuring
the fixture rather than the product: their band under the composer was partly the
board, not the composer. The branch fixes the decorator (`flex h-dvh flex-col`)
and this frame is kept beside the corrected ones so the two causes stay
distinguishable — the 46px-tall bar is the composer's fix, and the filled window
is the board's.
