# The composer's `@` mention layer

Frames of the composer's `@` file mentions: the chip drawn behind the sentence,
and the list that inserts its token.

Each state is reached by **typing its draft into the production composer** in a
story's `play` — real keystrokes through `@storybook/test`'s `userEvent`, into
the real `MessageInput` — and the frame is only taken once that state's own
precondition holds (the chip exists, the list has rows, the notice row is up). So
a frame cannot show a state the composer would not produce: the picker's debounce,
the listing round trip and the chip's re-measure after every keystroke all have
to happen for one to exist.

`node scripts/capture-evidence.mjs --only=chat-mention-chips --allow-backend`
(the `--allow-backend` is this repo's own opt-in for a narrowed set that captures
no surface which talks to a backend; the composer here reaches only the two
channels below), then one narrowed run for
`--only=chat-mention-chips--picker-many-rows` after the row-budget entry below was
added. Both passes ran at `013aad424`, twelve themes each: 204 frames over 17
directories.

**Provenance, stated because it is not a full sweep.** A narrowed run leaves the
manifest's swept count alone, and this pass added frames rather than refreshing
only committed ones, so `frames` was re-derived from the tree the way
`check-evidence.mjs` derives it — every `.webp` under `docs/evidence` outside a
declared supplementary set: **4427**, which is the pre-existing `4223` plus these
204. `surfaces` is the table's own row count and `srcTree`/`scriptsTree` are the
trees this commit ships, both written by the rig.

## What the fixtures stand in for

**The IPC boundary, and only that.** `probe-files` and `list-directory` are
answered from a named tree in the story module (`TREE` and `FILES`). Every
keystroke, every measure and every paint after that boundary is the shipped code.

| fact | what the frame can therefore claim | what it cannot |
| --- | --- | --- |
| a listing's entries | what the picker does with a listing — ranking, the drill, the parent column, the budget | that a particular directory contains those entries |
| a probe's answer | the rule `chip <=> the token resolves`, the two fills, the needs-approval state | that `stat` agrees, or that the containment test is right (that is `scripts/directory-listing.test.mjs`, against real symlinks) |

The live half of both is `scripts/renderer-driver.mjs --scene mentions`, written
in this branch and **not run here**: the composer only exists on a pane with a
live backend, and on a backend-less run the chat route paints its offline card
with no `textarea[aria-label="Message"]` at all (measured — that run is what the
scene's own refusal message records). It needs `--backend` / `--backend-records`
per `docs/agent-driver.md`, which is the QA pass's job, not this set's.

## The surfaces

| directory | state | viewport |
| --- | --- | --- |
| `before-no-mentions` | the same sentence with the file named as **prose** — what `origin/main` paints. The before half of the pair. | 1380x872 |
| `mention-at-rest` | one chip mid-sentence | 1380x872 |
| `mentions-at-the-edges` | a mention opening the draft and one closing it | 1380x872 |
| `adjacent-mentions` | two mentions on one line | 1380x872 |
| `unresolved-stays-prose` | `@src/ap.py` (one character from a real file) beside a resolved one | 1380x872 |
| `chip-needs-approval` | a path outside the workspace beside one inside it | 1380x872 |
| `caret-inside-token` | the caret inside a mention: the list opens on the token | 1380x872 |
| `wrapped-mention` | a token that wraps at a 420px column: two fills, one line gap | 1380x872 |
| `picker-open` | a bare `@`: the working directory, ranked | 1380x768 |
| `picker-drilled` | `@src/`: the drill, with the parent column | 1380x768 |
| `picker-descend` | `@src/com`: a matched directory's children, one level | 1380x768 |
| `picker-no-match` | nothing matches: the notice row, the list still open | 1380x768 |
| `picker-empty-folder` | an empty directory | 1380x768 |
| `picker-unreadable` | a directory that cannot be read | 1380x768 |
| `picker-many-rows` | ten entries: the budget at 7 rows | 1380x768 |
| `budget-800x600` | the same story at the design's narrow case: 4 rows | 800x600 |
| `ceiling-1380x872` | the same story at the band's own window: the 8-row ceiling | 1380x872 |

## Geometry, read back off the rendered story

Measured against the same stories at the same viewports (the reads behind every
number below; the frames are the picture of them):

| quantity | measured | design's prediction |
| --- | --- | --- |
| composer box, ≥550px column | **900 x 112.0** (`top` 376.44) | 111.7px |
| field inside it | 866 x 34 | — |
| chip fill height | **17.69** | 17.7 |
| chip fill overhang, both sides | **6.00 / 6.00** | 6 each side |
| fill's left/right against its glyph run | **0.00 / 0.00** drift | within 1px |
| first chip at the draft's start | fill left **259.0**, glyphs 265.0 — inside the field's own inset (field left 257) | never reaches the box's padding |
| two adjacent chips | fills **259.0..346.86** and **347.86..449.20**: **1.00px** of clear ground | ≈16.5px of clear ground |
| a wrapped token | two fills, fill 1 bottom **381.47**, fill 2 top **385.47**: **4.00px** between the lines | 4px |
| picker shell, 8 rows | **342.78** | 340.8 |
| picker region, 8 / 7 / 4 rows | **288 / 252 / 144** | 288 at its ceiling |
| picker gap to the box | **4.00** (`mb-1`) | 4px |
| picker shell, no matches | **90.28** (header + one 36px notice row + footer) | 36px region |
| box top across every picker state | **324.44** at 1380x768, **376.44** at 1380x872 — identical open, filtered, drilled, no-match, empty, unreadable | unchanged |

### The design's four predictions

1. **The fills sit on their glyphs — CONFIRMED.** Every fill's edges are on its
   token's run with **0.00px** of drift against a 6.00px overhang, at the 900px
   measure and at a 372px column. The mirror and the field are styled by one
   exported class string (`composerTextBox`), which is what the check is for.
2. **A wrapped token paints two fills with a 4px gap — CONFIRMED**, and this is
   the one the design called most likely to be wrong: fill 1 spans
   `549.67..838.91` (glyphs `555.67..832.91`) and fill 2 `523.00..593.25`
   (glyphs `529.00..587.25`), with 4.00px of clear line between them. A fill
   measured as the line box (21.7px) instead of the glyph box would have merged
   them; the height came back 17.69.
3. **The band is unchanged with the list open — CONFIRMED, and it is a
   structural fact rather than a number.** The band's rect is identical in every
   state at a given viewport (`top` 34.39, `bottom` the viewport's), and the
   composer box's top is identical across the four picker states. The picker is
   `absolute` and `bottom-full` from the box, so it is out of flow by
   construction; what the frames add is that nothing else in the band moved.
4. **At a short window the picker is not sliced — CONFIRMED.** At 800x600 the
   shell's top edge is at **19.91** (inside the column) and the region shows
   **4 rows (144px)** where the same story at 1380x872 shows **8 (288px)**: the
   budget falls, and the shell is never pushed off the bottom.

### One prediction the frames falsify, and the fix that came out of it

The design's prediction 10 is that two adjacent mentions leave **≈16.5px** of
clear ground between their fills: "the space's own advance — about 4.5px at 14px
— plus 12px of overhang". The arithmetic is inverted: the overhangs are taken
OUT of the ground, not added to it, so 12px of overhang over a 3.8px space is
**8.2px of overlap**, and the two same-coloured fills merge into one rectangle
covering both tokens and the separator — the one thing the same paragraph's rule
forbids ("the fill covers the token and never the separator").

Measured on this field, the space's advance is **3.8px**, not 4.5px. The drawing
now clamps an overhang to half the clear ground on that side (0.5px less, so the
two fills can never meet), keeping the full 6px wherever there is no neighbour.
`adjacent-mentions` is the frame of the result: two separate rounded fills with
**1.00px** of unpainted separator between them, and the outer overhangs still 6px.
The rule and its numbers are asserted in `scripts/at-mentions.test.mjs` only as
far as they are pure (the reference/directory/space rules); the clamp itself is
geometry and is measured here.

## What this set does not cover

- **The harness's own expansion.** Nothing here sends a message: the feature's
  contract with the backend is the *text* it writes, and the harness half is
  `damianvtran/local-operator#1220`. A frame is evidence about the composer.
- **A mid-turn steer.** The same token expands on a normal submit and not on a
  mid-turn steer, and the composer's submit path routes a mid-turn draft to the
  steer path. The composer shows no preview in either state, so there is no claim
  to falsify here — but it is the reason this feature deliberately makes no
  "this will be sent as a file" promise anywhere in the UI.
- **The needs-approval fact's real source.** The frames show the fill; the
  containment judgement itself is the main process's and is exercised by
  `scripts/directory-listing.test.mjs` against a real symlinked tree.
- **The driver scene.** Written in this branch, refused without a backend, and
  named above with the flags a QA pass needs to run it.
