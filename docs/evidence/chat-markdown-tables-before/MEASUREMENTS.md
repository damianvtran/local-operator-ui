# Markdown table geometry - the numbers behind the BEFORE frames

Read over CDP (`Runtime.evaluate`; computed styles + `getBoundingClientRect`,
`Range.getClientRects` for line counts) inside the Storybook page the frames
were taken from, in `localOperatorDark`, at 1280x900 and 920x900 with the
capture rig's own viewport settings (`deviceScaleFactor` 1, scrollbars hidden,
fonts awaited). The fixtures are the committed ones (`chat-markdown-tables--*`
in `scripts/capture-evidence.mjs`, rendered by `markdown-tables.stories.tsx`);
the rig was a one-off session script - this file is the record, and the probe
and read below are reproduced in full enough to re-run.

## The mechanism, as computed

- On `.lo-markdown`, every `td`/`th`, and the table itself: computed
  `word-break: break-word; overflow-wrap: break-word` (the cells inherit both
  from `.lo-markdown`; `markdown.css` sets them at the root, line 31).
- `table-layout: auto`, and the table's computed `width` is `810px` - its
  `width: 100%` against the 810px measure column.
- `word-break: break-word` is the legacy alias whose behaviour equals
  `overflow-wrap: anywhere`: for intrinsic sizing, soft wraps may be introduced
  INSIDE words. Measured with the cells' own computed face (family, size and
  line-height read off the first body cell), on the reported strings:

| text | min-content under `break-word` | min-content under `normal` |
| --- | --- | --- |
| `#684 (1a)` | 8.9px | 35.1px |
| `MERGED f11952f1d2` | 12.1px | 71.2px |
| `f11952f1d2e7d20c38f8ae9b7cd8d7deecce3f24` | 8.9px | 307.8px |

A 40-character sha asks for 307.8px and can be given 8.9px - a column can be
squeezed to a single character, and in the BEFORE frames the short columns are.

```js
// The probe, verbatim in shape: min-content of `text` under a word-break value,
// at the cell's computed face.
const d = document.createElement("div");
d.style.cssText =
	"position:absolute;top:-9999px;left:0;visibility:hidden;width:min-content;white-space:normal;";
d.style.fontFamily = c.fontFamily;
d.style.fontSize = c.fontSize;
d.style.lineHeight = c.lineHeight;
d.style.wordBreak = wordBreak; // "break-word" vs "normal"
d.textContent = text;
document.body.append(d);
const w = d.getBoundingClientRect().width;
d.remove();
```

## operator-shape at both widths

| width | column widths (px) | row-1 td line counts | th line counts | table |
| --- | --- | --- | --- | --- |
| 1280 | 48 / 71 / 690 | 4 / 4 / 1 | 1 / 1 / 1 | 810, scrollWidth 810 |
| 920 | 48 / 71 / 690 | 4 / 4 / 1 | 1 / 1 / 1 | 810, scrollWidth 810 |

The short cells render as `#6|84|(1a|)` and `MERG|ED|f11952|f1d2` in the
frames; the title column is single-line at 690px. `scrollWidth` equals
`clientWidth` on every box - the squeeze wraps rather than overflows.

### The container chain (operator-shape)

| element | x (1280) | width (1280) | width (920) | max-width |
| --- | --- | --- | --- | --- |
| frame (`flex flex-col bg-canvas`) | 0 | 1280 | 920 | none |
| chat-page inset (`px-4 pt-4`) | 0 | 1280 | 920 | none |
| `@container/chatcol` column | 16 | 1248 | 888 | none |
| scroll box (`scrollbar-gutter: stable both edges`) | 16 | 1248 | 888 | none |
| measure column (`@min-[750px]/chatcol:max-w-[var(--lo-chat-measure)]`) | 235 | 810 | 810 | 810px |
| `.lo-markdown` | 235 | 810 | 810 | none |
| `<table>` | 235 | 810 | 810 | - |

**Both widths resolve the same 810px measure** - at 920 the container is still
888px, above the 750px gate, so the cap binds exactly as it does at 1280. The
920 frames differ from the 1280 frames in margins (x=55 vs x=235 for the table),
not in the table's own box.

## Per state, at 1280 (table 810px, scrollWidth 810 everywhere)

| state | column widths (px) | row-1 td / th line counts | reproduces the character-level squeeze? |
| --- | --- | --- | --- |
| `operator-shape` | 48 / 71 / 690 | td 4 / 4 / 1, th 1 / 1 / 1 | yes - `#6|84|(1a|)` and `MERG|ED|f11952|f1d2` |
| `long-prose` | 55.1 / 753.9 | td 5 / 7, th 2 / 1 | yes - `Loa|der|cont|inuit|y 1a`; header `Cha|nge` |
| `long-tokens` | 100.9 / 51 / 657.1 | td 2 / 1 / 1, th 1 / 2 / 1 | yes - the `Kind` header at 51px renders `Kin|d`; `Merge|commit` |
| `many-columns` | 94.1 / 197.9 / 83.4 / 173.4 / 65.2 / 105.2 / 89.8 | all 1 | no - every column fits its max-content (sum 809.0 <= 810), kept as the no-regression control |
| `few-rows` | 272.9 / 134.2 / 401.9 | all 1 | no - the smallest table, single-line cells |

## The squeeze deepens with the long column's content

Extending the longest cell in column 3 of `operator-shape` in place, re-measured
(this fixture's longest cell is the 399-character `#708` description):

| longest col-3 cell | column widths (px) | row-1 td line counts |
| --- | --- | --- |
| 399 chars (this fixture) | 48 / 71 / 690 | 4 / 4 / 1 |
| 493 | 45.5 / 64.8 / 698.7 | 4 / 4 / 1 |
| 587 | 43.8 / 60.5 / 704.7 | 4 / 5 / 1 |
| 681 | 42.5 / 57.4 / 709.1 | 5 / 5 / 1 |

The same sweep run while the fixture was being calibrated, before the
description cell existed (column 3's longest cell was a 113-character title):

| longest col-3 cell | column widths (px) | row-1 td line counts |
| --- | --- | --- |
| 113 chars (title only) | 75.8 / 140.0 / 593.1 | 2 / 2 / 1 |
| 177 | 63.1 / 108.3 / 637.6 | 2 / 2 / 2 |
| 271 | 53.9 / 85.5 / 669.7 | 3 / 3 / 3 |
| 365 | 49.1 / 73.7 / 686.1 | 4 / 4 / 4 |

Two readings the fix's design can take from the pair: the short columns stay
word-whole while their used width stays above their longest word - between the
177- and 271-character rows the crossover is crossed - and past it every
additional character of column 3's content comes out of the short columns
(48 to 42.5px across 399 to 681 characters), because `break-word` lets the auto
algorithm price a column down to one character.
