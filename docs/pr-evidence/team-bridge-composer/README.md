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
| `light-attachment.png`, `dark-attachment.png` | `team-bridge-page--composer-with-attachment` | one staged image chip above an otherwise empty bar — the media tile, no filename printed (see below) |

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

## `board-defect-dark.png` — the instrument's defect, and NOT a "before"

This frame is deliberately not a before/after of the product, and it must not be
read as one. It is the **story board's** defect with the NEW composer already
mounted: the decorator rendered the page in a bare `h-dvh` block, where the
page's `flex-1` is inert, so the pane collapsed to its content height — measured
459.7px of pane inside a 720px frame, leaving ~261px of empty canvas under
everything, rail included. The bar inside it is the new 46px one (measured
397.7..443.7), which is exactly what disqualifies the frame as evidence about
the old composer.

The consequence, stated rather than glossed: **no true before can be
reconstructed from this repository state.** The frames that showed the
operator's actual regression — a 110px card with a 56px strip under it — are not
in this PR, and `origin/main`'s decorator is still the collapsing `h-dvh`, so a
fresh capture of the old arrangement from main would carry the board's 261px
band on top of the composer's own. That is why this directory holds no
before/after pair: the instrument was measuring wrong, and an old "before" taken
through it cannot be trusted.

What this directory does show is the two causes kept apart: the eight after-frames
are the 46px bar in a window the page actually fills, and this frame is the same
new composer as it looked in the old board.

## The chip in the attachment frames

The chip is `AttachmentsPreview`'s MEDIA branch — the image tile with its remove
control, plus the strip's own status line. It prints **no filename**: that
caption strip only renders when the card can derive a name for the attachment,
and this fixture stages a `data:` URL rather than a file path. Earlier drafts of
this README called it "the real card — thumbnail, name, remove control"; the
name never appears in the rendered frame, and the sentence was corrected rather
than the frame retaken (design round 1, D3).
