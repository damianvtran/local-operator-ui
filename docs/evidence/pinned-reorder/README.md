# Pinned chats can be reordered — rendered evidence

Frames for issue #693 (a desktop-local manual order for the `Pinned chats` section, driven
by a move pair, drag-and-drop and keyboard chords), its round-1 remediation and its round-2
remediation (PR #697). Every frame here is a **headless** launch of the built renderer
against the repository's own stand-in daemon, captured as PNG at a 2760x1800 device-pixel
surface (1380x900 at DPR 2), one launch per slice and palette.

Forty frames across **20 states** and two palettes:

| Frame | State | The claim it carries |
| --- | --- | --- |
| `order-before-240/260/280/320` | three pins, catalogue order, pointer parked | nothing at rest: no grip, no pair, no indicator is painted; the section is the catalogue's own order passed through (rule 1) |
| `grip-hover-240/260/280/320` | pointer on the middle pinned row | the reveal. At **every width**, and since round 4 (2026-09-30) on the same strip: archive, grip, then the mark — three controls on ONE row and no other. The arrow pair that used to sit between the grip and the mark is gone (the row's menu carries the moves), and the shed that hid the grip at 240 and 260 went with it — see "The numbers" and "Round 4" |
| `drag-mid` | pointer down on the grip, moved one place | the held row wears BOTH halves of the held state — the selected ground step and its **inset outline** (round 2's D7/U6, drawn as an outline since round 3's D10) — while the row under the pointer wears the hover fill and no mark; the section draws the insertion line in the gap the row would land in; nothing has been written yet |
| `current-drag-mid` | the conversation the reader is IN, dragged, with the pointer over the next row | the state round 1 could not photograph and round 2 (D7/U6) fixed: the held row KEEPS its `row-selected` fill, so "you are here" survives the gesture, and it is told apart from the hovered drop target by the OUTLINE alone — two rows, two readings, one frame, and the outline covers the row's whole box on this state too (D10's measurement, below) |
| `drag-top` | a drag held ABOVE the first pinned row (round 1, D5b) | slot 0's line: drawn at the first row's own top edge, under the `Pinned chats` heading, with the last row held |
| `after-drop` | released one place down | the order is `p005, p000, p010`; the mark, the outline and the line are gone; the live region says where the row went |
| `order-relaunch` | `Page.reload` on the same profile | the same manual order comes back — the acceptance criterion |
| `search-filtered` | the panel's own search field, query `Chat 00` | the section draws two of the three pins; the third is hidden, not forgotten |
| `search-drag-mid`, `search-after-drop` | a drop under that filter | the move crosses the SHOWN neighbour while the hidden id keeps its stored slot (the stored order stays a permutation of the full list) |
| `many-pins`, `many-pins-drag` | fifteen pins, at 280 | the section overflows the scroller; a drag held at the scroller's edge scrolls it (722.5px of scroll, measured) and the line stays inside the section |
| `single-pin`, `single-pin-hover` | one pin, at 280 | the state where both of the row menu's Move items are inapplicable at once AND the grip is not offered at all (design round 1, D3: with one row there is no second slot a drop could land on). Shot at 280 so the absence is attributable to the count rule, not to the width shed |

The `keys` **slice** produces no frames: it is a readings-only launch (the keyboard walk
after a chord, and the live region's mutation count), and its readings are quoted below.

## The numbers

Measured on the shipped DOM at four panel settings, on a pinned row of a three-pin section
(`measurements/pinned-reorder-geometry-<theme>.json`; both palettes read the same):

| Panel | Row box | Title at rest | Title under the pointer | Revealed cluster |
| --- | --- | --- | --- | --- |
| **240** (a below-default step) | 208 | **126** | **96** | archive + grip + mark = **80** |
| **260** (THE DEFAULT) | 228 | **146** | **116** | the same **80** |
| **280** (widened past the default) | 248 | **166** | **136** | the same **80** |
| **320** (the clamp maximum) | 288 | **206** | **176** | the same **80** |

**ROUND 4 (2026-09-30) REWROTE THIS TABLE.** It read 68 / 88 / 80 / 120 under the pointer with a
108-136 cluster: the two arrow buttons were in the strip, and the grip was shed at or below a
278px panel to give the title back. Both are gone - the move is offered by the row's own context
menu (`Move conversation up` / `down`, with `⌘⇧↑` / `⌘⇧↓` beside them, which is WCAG 2.5.7's
single-pointer path) and by the same chords, and the shed's premise went with the pair it was
protecting. The title under the pointer is `row - 4 - 80 - 24`: **+28 at 240 and 260** against the
round-3 shed, **+56 at 280 and 320** against round 3's drawn grip. Where no grip is drawn (a single
pin, or a filtered section that shows one) the cluster is 52 - archive and mark - and the title
under the pointer is 124 at 240.

**WHAT THE WIDTHS ACTUALLY ARE (round 2, design D8; the rest of this paragraph is round 2's
record and is SUPERSEDED in its last two sentences by round 4 - see below).** The panel's clamp is `220..320`
(`SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH`), the width a reader who has never resized it opens
at is **260** (`SIDEBAR_DEFAULT_WIDTH`), and the overlay arrangement's sheet is a fixed 260
as well (`SIDEBAR_SHEET_WIDTH`). Round 1's frame table called 280 "(default)" and 240
"(clamp min)"; neither is true — 280 is a panel WIDENED past the default, 240 is a step
BELOW it, and the two widths the app actually opens in had no frame at all until 260 was
added here. **Round 2 said the grip was shed at the 260 default, and that sentence is retired:**
since round 4 the shed is deleted (`docs/design/sidebar-row-space.md` §8, "Deleted again"), so
the default 260 and the overlay sheet carry the drag handle like every other width, and the
reorder path there is the handle, the row's menu and the chords.

So the handle costs the title **28px** (its 24px box plus the cluster's 4px gap) where it is
drawn, and **nothing at rest** — it is reveal-only, like the archive beside it. It is drawn at
every width now, which is why the 240 column reads 96 and not the 124 a grip-less cluster would
leave: the 28px is the handle's, measured, not derived.

## The held row, and how it reads

The two grounds a held row can paint, read as computed `background-color` in the same run as
the frame:

| Palette | Held row's ground | The row under the pointer |
| --- | --- | --- |
| `localOperatorDark` | `rgb(55, 47, 36)` = `#372F24` (`--lo-row-selected`) | `rgb(48, 45, 41)` = `#302D29` (`--lo-row-hover`) |
| `localOperatorLight` | `rgb(235, 231, 216)` = `#EBE7D8` (`--lo-row-selected`) | `rgb(237, 236, 231)` = `#EDECE7` (`--lo-row-hover`) |

Before round 1 both rows painted the hover step: the captured pointer keeps `:hover` on the
row, and the hover variant outranked the drag's ground. Round 1 fixed the plain case by
giving the held row its own ground step; **round 2 fixed the case it got wrong** — a held row
that is ALSO the current one was given the `row-hover` role, which is exactly the fill the
drop target wears, so two rows on screen read alike and the held row lost the selected fill
that says "this is the conversation you are in" (design round 2 D7, UX round 2 U6). The held
state is now carried by a **1px inset outline** off `[data-dragging]` on a ground that stays
the row's own role — the `ink-dim` ROLE, whose value is per palette: dark
`rgb(166, 160, 145)`, light `rgb(101, 96, 86)` (round 3's D11/Q-NIT-2: round 2's note quoted
the dark value as though it were both). Measured in both palettes and in both row states,
and the drop target's computed outline is `none` while the held row's is `solid 1px offset
-1px`. The class merge that decides it is asserted in `scripts/sidebar-pin-order.test.mjs`.

**WHY IT IS AN OUTLINE AND NOT AN INSET RING (round 3, design D10).** The first spelling was
`ring-1 ring-inset` — a box-shadow — and a box-shadow is painted UNDER the element's
children: on the CURRENT row, the row's own button carries the opaque `bg-row-selected` fill
and covered the mark everywhere it reached. **One set of coverage numbers, one method, and
everywhere else that quotes them quotes these** (design round 4's D13 — the
`chat-sidebar.tsx` comment and `sidebar-row-space.md` §8 carry the same three). The
measurement is the ink within ±6 per channel of the mark's colour, inside the outermost 3
device px of the held row's box (device x24-519, y1123-1186 on these frames): a complete
outline on a held row that is not current reads **60.2%** of that band (the 66%/55% per-edge
figures are below 100% because the band includes the rounded corners), the held CURRENT row
read **5.3%** before this fix — a fragment along the right-hand slot, which is exactly the
state round 2's D7 was filed about — and reads **32.1%** after it, in both palettes. The
32.1% is three of the row's four edges: the top edge is where the drop indicator sits, so it
is the insertion line's rather than the mark's. The two grounds the two rows wear are 1.04:1
apart, so the mark is the half of the held state a reader can actually see; that is why the
two spellings are not interchangeable.

The gesture's own readings, from the same runs:

- `drag-mid`: `dragging: ["p000"]`, the indicator drawn inside the section's coordinates,
  and `stored: []` — **nothing has been written mid-gesture**.
- `current-drag-mid` (round 2): the held row is `current: true`, its ground equals its own
  resting ground and its outline is painted; the row under the pointer reads the hover ground
  with `mark: "none"`. Escape then cancels it with the order untouched.
- `drag-top`: the indicator's y is **498**, the first pinned row's own top edge, against the
  section box's **474** (the heading sits between them).
- `after-drop`: order `["p005","p000","p010"]`, and the persisted view holds
  `"pins": ["p005","p000","p010"]` — **one write, at the drop**.
- `search-after-drop`: the shown order is `["p005","p000"]` and the stored order is
  `["p005","p000","p010"]` — the hidden id keeps its slot.
- `many-pins-drag`: `scrollTop` 0 → 722.5 while the drag is held at the scroller's edge.
- The **scrolled drop** (round 1, R3): a second drag at that scrolled list, released —
  `scrollTop` 722.5 → **722.5** with the order moving `p000` from first to last, so the
  post-commit correction no longer shifts a scrolled list by a row.
- `single-pin`: one row in the section, both of the row menu's Move items `aria-disabled`, **no grip**.
- `keys` (readings only): after `⌘⇧↑` the caret is on the **moved row's own button**
  (`tag BUTTON`, `data-chat-row`, not the pin mark), and a bare `↓` walks on to another
  row in the same list rather than to the panel's first stop; the live region produced
  **15 mutations** on the way to the boundary and **4** across two repeat presses inside
  its dwell (so a repeated boundary sentence is announced again).

## How these frames were taken

Four launches, one slice each, plus a second set for the other palette — eight in total.
Each launch is the built renderer (`pnpm build`) with `VITE_LOCAL_OPERATOR_API_URL`
pointed at an isolated stand-in daemon on loopback, `--window-mode=headless`, a scratch
HOME/config/user-data-dir, `--use-mock-keychain`, and every inherited `CMUX_*`/`LOP_*`
unset. The scene asserts `visible=false focused=false` before its first capture.

```sh
# per slice: three | many | single | keys, and per palette (localOperatorDark, localOperatorLight)
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs --port 18345 \
  --records <scratch>/records --catalogue 120 --pins p000,p005,p010 &
node scripts/renderer-driver.mjs --scene pinned-reorder --pinned-state three \
  --backend http://127.0.0.1:18345 --backend-records <scratch>/records \
  --seed-onboarding-complete --theme localOperatorDark \
  --out <scratch>/three-dark --window-size 1380x900
```

`--pinned-state many` launches the same stub with fifteen pins (`--pins p000…p014`),
`single` with one (`--pins p000`), and `keys` with the three the walk needs. The `many` and
`single` slices are shot at a **280px panel** — a docked panel WIDENED past the 260 default
(round 2, D8) — because those two frames are about the COUNT rules: at 280 the grip is
drawn at all, so the single-pin frame's absent handle is the count rule and not the width
shed. The `three` slice sweeps 240/260/280/320, which is where the width table above comes
from.

## Round 4's re-shoot (2026-09-30): the strip after the chevrons go

Every frame in this directory was re-shot on the tree of the change that deleted the arrow pair
and the grip's width shed (40 frames, 20 states x two palettes; the `three`, `many`, `single`
and `keys` slices, one launch each, per palette: **53 + 16 + 12 + 14 checks, 0 FAIL**, both
palettes). Two states are changed in MEANING, not just in pixels:

- `grip-hover-240` and `grip-hover-260` photographed the grip ABSENT and the pair drawn; they now
  photograph the grip DRAWN and the pair gone - `archive, grip, mark` on one row at every width.
  Read them against the table above: 96 and 116 under the pointer where they were 68 and 88.
- `many-pins`, `single-pin`, `single-pin-hover` and the drag labels are the same STATES as before
  on a strip without the arrow pair; the `keys` slice's readings are unchanged (the caret on the
  moved row's own button, 15 mutations to the boundary, 4 on a repeat press) - the chord now
  calls the same write path the menu items call, and the reading is the proof it kept its
  behaviour through the rewire.

**The measurement files are re-assembled, not hand-edited**: this directory's
`measurements/pinned-reorder-geometry-<theme>.json` has no writer inside the driver - each slice
logs its readings and the file is the four slices' logs re-keyed. The shape and key order are the
committed ones; only the readings changed.

## Round 1's re-shoot, and how it compares to the set before it

Every frame in the round-1 set was re-shot on the round-1 tree, so each one was a picture of
what shipped then. Against the set before it — `78abb8496c`'s, which carries **32** frames
(the SHA in the first version of this note, `9dd18ab318`, contains **no** pinned-reorder file
at all; design round 2, D9) — **5 of 32 are byte-identical**: `order-before-240/light`,
`order-before-280/dark`, `order-before-320/light`, `order-relaunch/dark` and
`search-filtered/light`. The two `drag-top` frames are new in the round-1 set and have
nothing to be compared to. The rest fall into two groups, both measured with a raw-RGBA
comparison (`sharp`, every channel, with the bounding box of what moved):

**Round 1's intended changes.** `grip-hover-240` (the grip is gone: the shed),
`drag-mid` and `search-drag-mid` (the dragged row's ground), `drag-top` (new), and the
`many-*`/`single-*` frames (those slices are now shot at 280 rather than at the 260
default, so the panel and everything right of it moved).

**Run-to-run non-determinism outside the sidebar's content.** The composer's caret strip
(device x 858-939, y 1597-1629 — **66 changed pixels**, the strip the fold's own report names
in those words; design round 2, N1), the pan phase of a long title, and the rotating
empty-state sentence; the search states differ from their predecessors only by such strips
(12-60px) now that the scene parks the list's scroll before them. The dropped-order frames
also carry a LIST SCROLL OFFSET, because the drag that precedes them brings rows into view
and the offset depends on where the pointer crossed; the rows and the order are the same.

## Round 2's re-shoot, and how it compares to the set before it

Every frame in this directory was re-shot on the **folded** round-2 tree (`origin/main` =
`8712e8684c` folded in, plus the round-2 remediation), so each one is a picture of what
ships. Against the round-1 set (`83f8bbe748`'s, 34 frames), a raw-RGBA comparison gives
**14 of 34 byte-identical** — `order-before-240` (both palettes), `grip-hover-240/dark`,
`many-pins` (both), `many-pins-drag/light`, `order-relaunch/dark`, `search-after-drop/light`,
`search-filtered` (both), `single-pin` (both) and `single-pin-hover` (both) — plus 6 frames
that are new (the three round-2 labels x two palettes) and therefore have nothing to be
compared to.

**That identity is this round's fold evidence.** Main's delta since the branch's last fold
(#662's browser-restore boundary, #698's message-action row, #700's docs note) reaches the
browser surface, the transcript and the docs, and it does not touch a single pixel of the
marks / overflow / shell frames above — including `many-pins` and `single-pin` at both
palettes, which are the frames a row-render change would have moved first. The scenes' own
check confirms the same fact from the DOM side: the stand-in's rows carry no subagent count,
so #691's row mark draws nothing in this fixture.

**This round's intended changes** are the mark on the three drag labels (`drag-mid`,
`drag-top`, `search-drag-mid` — the held row's inset outline, see above), the new
`current-drag-mid` pair, and the new `order-before-260`/`grip-hover-260` pair (the default
width, where the grip is shed; design round 2, D8). **The remainder of the difference is the
same non-determinism as round 1's**, and it is the reason several `DIFFERS` verdicts carry
small bounding boxes: the composer caret strip (66 changed pixels at x 858-939,
y 1597-1629), the rotating empty-state sentence (the widest of them — the whole tip line
between x ~880 and x ~1540), a long title's pan phase, and one- to three-pixel scroll
offsets in the dropped-order and drag frames.

## Round 3's re-shoot, and how it compares to the set before it

Every frame was re-shot on the twice-folded round-3 tree (`origin/main` = `2e866d5d49` folded
in, plus the round-3 remediation). Against the round-2 set at `754b3f1e73`, a raw-RGBA
comparison gives **24 of 40 byte-identical** — every `many-pins`, `single-pin`,
`grip-hover-240/260`, `order-before-260/280` and `order-relaunch` frame among them, i.e. the
whole overflow, count-rule and rest surfaces, untouched by this round.

The 16 that differ are the four DRAG labels the mark's spelling changed on (`drag-mid`,
`drag-top`, `current-drag-mid`, `search-drag-mid` — the inset ring became an inset outline,
D10), plus the same run-to-run strips the set already documents: the rotating empty-state
sentence (whose bbox reaches x ~1554 in `after-drop` and `drag-mid`), the composer caret strip
(66 changed pixels at x 858-939, y 1597-1629, in six labels), a title's pan phase, and 1-60px
scroll/text offsets in `search-filtered` and `search-after-drop`.

The fold itself is covered by the same comparison: main's delta (#699's board time window and
the trains under it) reaches the board surface and the docs, and 24 frames - including
`many-pins` and `single-pin` at both palettes - came back byte-identical across it.

## What these frames cannot show

- **Focus-visible rings.** A headless window never paints them, which is the same limit
  the earlier sets record.
- **The 2px line at the last slot** sits at the section box's own foot (`top =
  section.bottom`), which is why the line's "inside the section" claim reads "inside the
  section's box, at its foot for the last slot" (QA round 1, Q4 — acknowledged, not
  changed).
- **`many-pins-drag`'s held row** scrolled out of view at that scale, so the frame shows
  the line and not the held item (design N1); **`search-after-drop`** shows the reveal on
  the row the moved row swapped with, not on the moved row itself, so the landing is
  marked by the live region rather than by the pixels (design N2).

Round 1's note here said the current-row drag could not be photographed at all ("against the
committed stub neither door opens a conversation"). **Round 2 refutes that** (UX round 2
found it and the scene now asserts it): the row's own door DOES open the conversation at
this stand-in — by a real pointer press on the row's button, and by Enter once the key is
dispatched as a browser-default `keyDown` rather than a `rawKeyDown` (the raw form leaves the
route at `#/chat` with no row current; measured on the first run of the new state). So the
frame exists now, and the scene reports which door the fixture answered rather than assuming
either.
