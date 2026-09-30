# Markdown tables in the chat answer - the AFTER half

The pair to [`../chat-markdown-tables-before/`](../chat-markdown-tables-before/) -
the reported squeeze's frames on the unfixed tree. These are the frames of the
fixed tree at the fix's own commit (`fix(chat): size markdown tables from their
content, and scroll rather than squeeze`, `d5e5261d08`): table cells break at
word boundaries only (`word-break: normal; overflow-wrap: break-word`, plus the
`td code` override `.lo-markdown code` requires), one cell's min-content demand
is capped at `64ch`, and a table whose columns still exceed the 810px measure
scrolls inside a `.lo-md-table-scroll` wrapper instead of squeezing or pushing
the page. The design consult is D1 (`design-note.md` in the lane's session
record); this file is the set's own record.

## What the fix does to the reported shapes

At 1280x900, `localOperatorDark`; the numbers are identical in all four themes
(re-read, not assumed - see "How they were taken"):

| state | before: columns (px) | after: columns (px) | before: row-1 td lines | after | note |
| --- | --- | --- | --- | --- | --- |
| `operator-shape` | 48 / 71 / 690 | 87.5 / 169.1 / 552.4 | 4 / 4 / 1 | **2 / 1 / 1** | no mid-token break anywhere; `#684 (1a)` wraps at the space (see "vs the prototype") |
| `long-prose` | 55.1 / 753.9 | 174.3 / 634.8 | 5 / 7 | 1 / 8 | header single-line (was 2); the prose re-measures one line longer because its column is narrower |
| `long-tokens` | 100.9 / 51 / 657.1 | 129.4 / 60.8 / 618.8 | 2 / 1 / 1 | 1 / 1 / 1 | the `Kind` header is single-line (was `Kin|d`); the full sha is whole |
| `many-columns` (control) | 94.1 / 197.9 / 83.4 / 173.4 / 65.2 / 105.2 / 89.8 | 94.1 / 197.9 / 83.4 / 173.4 / 65.2 / 105.2 / 89.8 | all 1 | all 1 | **identical to the before capture, 0.0px on every column** |
| `few-rows` (control) | 272.9 / 134.2 / 401.9 | 272.9 / 134.2 / 401.9 | all 1 | all 1 | identical |

The cells that wrap, in the after frames: `#684` / `(1a)` and, in row 2,
`MERGED` / `643b5270a8`. No cell anywhere in the seven states breaks inside a
token - the property the fix exists for. The before-side numbers are the
committed capture's own
([`../chat-markdown-tables-before/MEASUREMENTS.md`](../chat-markdown-tables-before/MEASUREMENTS.md)).

## The two edge states (AFTER-only)

- **`three-shas`** (three 40-character sha columns whose min-contents sum past
  the measure): columns `86.2 / 348.1 / 348.1 / 349.6`, table width **1132.9**
  against the 810px wrapper - wrapper `scrollWidth 1133 > clientWidth 810`,
  `overflow-x: auto`, and the page does not scroll (`documentElement.scrollWidth
  == clientWidth`). Identical at 920x900. The label column wraps at its hyphens
  (`fix/markdown-table-widths` over three lines); the shas never break.
- **`giant-token`** (one 263-character digest, no word boundary at all): the
  token's unconstrained single-line width at the cell's face is **2081.8px**; the
  `64ch` cell cap prices its column at `83.6 / 725.4` and the token wraps inside
  its own cell as three lines (`sha256:` + 256 hex characters, measured 3 lines).
  The wrapper does not scroll and the table stays on the 810px measure - the
  ceiling case the cap exists for.
- Both are registered in `capture-evidence.mjs` for the AFTER half only: before
  the fix there is no wrapper to photograph, and these two states are the fix's
  own behaviours rather than the reported reproduction. The before half has the
  five reproduction states alone (its README says so).

## vs the prototype's numbers (design open question 2) - one mismatch, explained

| state | prototype (design note) | real story (after) | verdict |
| --- | --- | --- | --- |
| `operator-shape` | 85 / 164.3 / 559.7; 1/1/1 | 87.5 / 169.1 / 552.4; **2/1/1** | col1 wraps at the space - **mismatch**, cause measured below |
| `long-prose` | 170.7 / 638.3; 1/7 | 174.3 / 634.8; 1/8 | widths within 3.6px; prose one line longer |
| `long-tokens` | 126.6 / 59.3 / 623.1; 1/1/1 | 129.4 / 60.8 / 618.8; 1/1/1 | match |
| `many-columns` | 94.1 / 197.7 / 83.3 / 173.9 / 65.2 / 105.1 / 89.7 | 94.1 / 197.9 / 83.4 / 173.4 / 65.2 / 105.2 / 89.8 | match (0.0px before->after; <=0.5px vs the prototype's own readings) |
| 3 SHA columns | 76.5 / 302.9 / 317 / 328.5 = 1026 | 86.2 / 348.1 / 348.1 / 349.6 = 1132.9 | both scroll; the real table is ~10% wider |
| 263-char digest | 81.4 / 727.6; 1/3 | 83.6 / 725.4; 1/3 | match |

**Why the `operator-shape` mismatch: the prototype page's root type size.** The
prototype's own page sets `html,body{font-size: var(--text-body)}` - and
`--text-body` is `0.875rem`, so the prototype's ROOT is 14px and every `rem`
under it re-bases against 14px: a cell renders at `0.875rem` = **12.25px** with
10.5px horizontal padding (`0.75rem`). The app - and this story - leave the root
at the UA 16px and set `body { font-size: var(--text-body) }`; cells render at
**14px** with 12px padding. Measured on the same face (system-ui) and the same
string: `#684 (1a)` is **56.3px** on the prototype page, **63.2px** in the story,
which gives the column a 61.5px content box - 1.7px short, so the string wraps
at the space. Re-running the prototype page today reproduces its numbers
(84.3 / 164.1 / 561.6, 1/1/1), so the reading is the type size, not a defect in
the prototype; at the app's type size the single-line claim for col1 does not
hold on this geometry. The same ~12.5% ratio shows on the before side (the
note's `44.2 / 67.1 / 697.7` against the committed capture's `48 / 71 / 690`).
This is recorded for the design round rather than adjusted here: accepting the
word wrap, widening the measure, or changing how short columns take their share
is a design decision, and the recipe as implemented is the one the consult
fixed.

## Mid-stream (UX consult U2)

The transcript's streaming row hands the whole accumulated text to the renderer
each frame, so this was probed with a temporary prefix-typing harness over the
`operator-shape` fixture (removed after the probe; its frames live with the
session record, not this set). Three consecutive frames ~350ms apart while rows
were landing, with each column's x position and width:

| frame | t (ms) | col 2 x / width | col 3 x / width | col 1 x |
| --- | --- | --- | --- | --- |
| 1 | 3179 | 381.8 / 261.8 | 643.6 / 400.9 | 235.5 |
| 2 | 3583 | 368.2 / 237.4 | 605.5 / 439.0 | 235.5 |
| 3 | 3967 | 355.8 / 215.2 | 571.0 / 473.5 | 235.5 |

Consecutive-frame movement: col2's left moves 13.6px then 12.4px, col3's 38.1px
then 34.5px, col1 fixed. Across the whole typed run the largest single-tick move
was **89px** (col2, while the header row and delimiter landed at 23->29 chars,
where the columns re-price wholesale); once rows are landing, moves stay under
~35px - less than one word's width at this face (the fixture's longest words
measure 56-63px). Boundaries follow longer words as they arrive; they do not
jitter.

## Keyboard (design note section 2; UX consult Q1)

Tab walks with real key events at 1280x900:

- `three-shas` (scrolls; no focusable descendants): Tab reaches
  `DIV.lo-md-table-scroll` itself - the wrapper is a tab stop and arrows scroll
  it.
- `long-tokens` (contains anchors): Tab reaches the two links inside the cells;
  the wrapper is not its own stop.
- `operator-shape` (fits): the wrapper is not in the tab order at all.

No `tabindex`/`role` was added - this is Chromium's own scrollable-only
focusability, which is the design's reason for not adding one. With the wrapper
focused, the computed ring is `outline: solid 2px rgb(56, 201, 106)` at
`outline-offset: 2px` (the app's global `:focus-visible` treatment), and it
draws fully around the wrapper - not clipped by `.lo-markdown` or any ancestor
(screenshot in the session record).

## Scrollbars in these frames - what is and is not shown

The capture rig passes `--hide-scrollbars` on every run (no switch turns it
off), so no frame in either half shows a scrollbar. Measured in a second launch
WITHOUT that switch, on the same story: the wrapper scrolls
(`scrollWidth 1133` vs `clientWidth 810`) but `offsetHeight - clientHeight = 0`
- Chrome draws overlay scrollbars, and the app's permanent 8px thumb (from
`shared/components/common/global-scrollbar-styles.tsx`, mounted by `main.tsx`,
not by the Storybook preview) does not render in Storybook at all. Rather than
fake a bar into a frame, the affordance is recorded here as numbers, plus the
cut fourth column the frames themselves show (`Gr`, `2C` at the right edge).

## How they were taken

```sh
node scripts/capture-evidence.mjs http://localhost:6271 \
  --only=chat-markdown-tables \
  --themes=localOperatorDark,localOperatorLight,obsidian,githubLight \
  --allow-backend --theme-settle-ms=180000
```

- 44 frames: 11 entries x 4 themes - seven states at 1280x900 (the five
  reported shapes plus `three-shas` and `giant-token`) and four of them also at
  920x900 (`operator-shape`, `long-tokens`, `many-columns`, `three-shas`).
  Captured at head `d5e5261d08` (the fix commit) with a clean code tree; the
  run records `dirtyWorkingTree: false`.
- `--allow-backend` because the operator's live daemon answers on :1111 and
  must not be stopped for a capture, and this story is a static fixture
  (`frontend={null} gate={null}`) that never contacts the backend; the rig's
  theme and paint guards still ran over every frame. `--theme-settle-ms=180000`
  because this host is loaded. Same reasoning as the before half.
- The four themes are the before half's own (`localOperatorDark`,
  `localOperatorLight`, `obsidian`, `githubLight`); the claim is geometry, and
  every number in this file was re-read in all four and came back identical.
- Both widths resolve the same 810px measure (920's container is still 888px,
  above the 750px gate), so the width pairs differ in margins, as in the before
  half.

The numbers behind each read were probed over CDP in the same pages
(`Runtime.evaluate`: computed styles, `getBoundingClientRect`,
`Range.getClientRects` for line counts, canvas `measureText` for single-line
widths) with a one-off session script - this file is the record, the same shape
as the before half's `MEASUREMENTS.md`.

**Stamps this pass read.** `git rev-parse HEAD:src` =
`55c6963cb416628eb771ffda9bdb573fbb42c62a`; `git rev-parse HEAD:scripts` =
`165f1dce01ecd41517d1d908d3348808cfe2dcaa`.

**Not here.** The manifest's `supplementary` declaration for the before set and
the re-stamp over the fold are the lane's last step; this set's own frames are
swept (no supplementary entry, and no extra note machinery).

**Open, for the design round.** (1) The `#684 (1a)` word wrap above (1.7px
short of single-line at the app's type size, every theme). (2) The
`long-prose` prose column taking one more line than the prototype's 1/7 (its
column is 3.6px narrower for the same reason the short columns are wider).
Neither is adjusted here; the recipe is the consult's.
