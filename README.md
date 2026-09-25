# The composer cwd chip: intrinsic width, capped at the old width

Frames and DOM readings for the change that turns the composer chip's **fixed
16ch path column** into a **16ch cap** (`CHIP_PATH_COLUMN` in
`src/renderer/src/features/chat/components/directory-indicator.tsx`). The
operator asked for the chip to "not take up extra space unless needed … up to the
current as max width"; that request supersedes design finding D7, whose answer
the reserved column was.

This branch is **PR evidence only** - no product code, no committed frames. It is
mirrored from the `evidence/*` branch convention this repository already uses.

## Method (and what is real in these frames)

* **Two worktrees at the same story list.** `after` is the branch
  `feat/cwd-chip-compact-width`; `before` is a detached worktree at `origin/main`
  (`a7df70995`) whose ONLY modification is the two story files, so that each case
  can be photographed at the identical story, column and fixture on both sides.
  The `before` tree's product code is untouched `origin/main`.
* **Storybook, one story at a time**, served from each worktree
  (`pnpm exec storybook dev -p <port> --no-open --quiet`), driven through the
  local **`browser` tool** against the *prose* stories rather than a headless
  rig, which is this feature's own evidence convention
  (`docs/evidence/chat-cwd-move-live/README.md`).
* **Viewport 1280 x 720 CSS at 2x** (the tab's own size, 2560 x 1440 device
  pixels). Every story's chat column is an inline width the story sets, so the
  tab size does not decide any number here.
* **Theme** is the preview's default (`localOperatorDark`): the `args=theme:…`
  URL parameter is dropped by Storybook for args the preview does not declare,
  measured while taking these frames, so no frame claims a theme selection it
  did not make.
* **The numbers are the primary instrument** and come from
  `getBoundingClientRect`/`getComputedStyle` in the same rendered state, not from
  the frames: `numbers-{before,after}.json` beside them, in the shape
  `docs/evidence/composer-readings/README.md` uses (row children with role,
  order, `offsetLeft`, `marginLeft` and box; `display: contents` flattened; the
  row's `clientWidth`/`scrollWidth`/`overflowX`; the path span's
  `clientWidth`/`scrollWidth`; the box's `clientWidth`).
* **Every frame here was looked at before it was kept**, and the two pairs were
  viewed stacked (`*-pair-*-crop.png`) as well as individually.

## The numbers

Chip box (`clientWidth`), path span client/scroll (px), the readings cluster's
`offsetLeft` in the composed row, and the controls group's `offsetLeft`. `ch` is
resolved by the DOM: 7.2 px per character at `--text-mono-sm` (16ch = 115.2px),
so the freed width is exactly one column minus one character.

| case | story | before | after |
| --- | --- | --- | --- |
| the operator's report: `~`, 1000px column | `chat-cwd-move--editable-shortest-path` | box **303.9**, span 115/115 | box **195.9**, span **7/7** |
| 16-character path (exactly the cap) | `chat-cwd-move--editable-at-cap` | box 303.9, span 115/115, no ellipsis | box **303.9**, span 115/115, no ellipsis |
| 32-character path (past the cap) | `chat-cwd-move--editable-past-cap` | box 303.9, span 115/230, ellipsis | box **303.9**, span 115/230, ellipsis |
| the same long path grown live after mount | `chat-cwd-move--grown-path` | box 303.9, span 115/295 | box **303.9**, span 115/295 |
| 13-character path, 880px column (below the 900px threshold) | `chat-cwd-move--editable` | box 260, span 71/94 | box **260**, span 71/94 |
| composed row, 1024px column (`/Users/you`) | `chat-message-input--cwd-chip-editable-with-readings` | box 303.9; **cluster 367**; controls **815**; 1 line; row overflow 0 | box **260.7**; **cluster 324**; controls **815**; 1 line; row overflow 0 |
| composed row, 240px column (the icon-only floor) | `chat-message-input--cwd-chip-in-row` | box 44; span 1/158 | box **44**; span 1/158 |

Falsifiable statements these carry:

* **the chip's left edge is invariant** - 147px in both trees in the composed row
  (`rows[0].children`, `chipGroupOffsetLeft` 17px in both);
* **the controls group is invariant** - `offsetLeft` 815 in both, which is the
  `ml-auto` group pinned to the row's right edge;
* **the readings cluster moves by exactly the chip's own delta** - 367 -> 324 is
  43.2px against the chip's 303.9 -> 260.7 (both 43.2), i.e. the cluster is the
  ONE moving block and it moves by the path's own width change;
* **the row's demand never grows** - `rowOverflowPx` 0 and one line in every
  measured state, and the box ceilings (260px below 900, 304px at/above 900) are
  unchanged, so the cap can only ever be narrower or equal;
* **nothing changes below the 900px threshold** - 880px column, identical box and
  span either side;
* **the cap still truncates and the tooltip still carries the path** -
  `--editable-past-cap` (1000px column) ellipsises with span 115/230 and its
  tooltip reads `~/src/a-project-with-a-long-name - Click to change the working
  directory. A running session's runtime restarts there.`; the 16ch path does
  NOT ellipsise and keeps the generic hint.

## Frames

| file | what it is |
| --- | --- |
| `chip-before-tilde-1000.png` / `chip-after-tilde-1000.png` | the full frames of the operator's report: the chip at `~` at a 1000px column, before (303.9px box, the path column empty) and after (195.9px) |
| `chip-pair-tilde-1000-crop.png` | the two above, cropped to the chip row and stacked (BEFORE on top) - the pair the decision rests on |
| `row-before-1024.png` / `row-after-1024.png` | the full composed row at 1024px with the editable chip and the session's readings |
| `row-pair-1024-crop.png` | the two above, cropped to the row and stacked (BEFORE on top): the chip's reserved column is what the readings cluster sits behind in the top frame |
| `cap-after-past-cap.png` / `cap-after-truncated-path.png` | the cap still truncating: a 32-character path at a 1000px column, and the older `--truncated-path` fixture at its own 880px column with its tooltip (the regression frame) |
| `*-crop.png` | crops of the frames above, labelled as such; crops are never the published frame's only form - the full frame sits beside each |

## Honest limits

* **`--truncated-path` is at 880px, not above the threshold.** The story - and
  the committed `chat-cwd-move-live/truncated-path/` frames - render at an 880px
  column, where there is no cap at all (the box's own 260px ceiling squeezes the
  span instead). It is included as the regression frame that still shows an
  ellipsis and a path-carrying tooltip, not as evidence about the cap; the
  1000px-column cap frame is `cap-after-past-cap.png`.
* **No live (menu-driven) path change in the composed row.** The chip's commit
  path displays the RECEIPT's `cwd`, which in a story comes from a fixed stub, so
  a story cannot show a moved path at all; the composed-row translation here is
  measured across two rendered states rather than through an interaction. The
  live half is covered on the chip alone by `chat-cwd-move--grown-path`, which
  changes its path after mount (and, per the numbers above, lands on exactly the
  same 303.9px box before and after the change).
* **One theme, two palettes of twelve.** Everything here is `localOperatorDark`;
  the twelve-theme sweep for this surface belongs to the repository's own
  capture pipeline, not to this set.
* **The floors at 900/750/620/220px were not swept.** What was measured is the
  binary either side of the threshold (1000 and 880) plus the icon-only floor
  (240). The intermediate widths run the same code path with no threshold
  between them.
* **`before` is a worktree whose story files are this branch's.** That is what
  makes the cases comparable; the product code in it is untouched `origin/main`.
