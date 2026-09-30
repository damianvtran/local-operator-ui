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
| `grip-hover-240/260/280/320` | pointer on the middle pinned row | the reveal. At **280 and 320**: grip + move pair + archive appear on ONE row and no other. At **240 and 260 the grip is SHED** (design round 1 D2; the 260 default is round 2's D8) and the pair stays — see "The numbers" |
| `drag-mid` | pointer down on the grip, moved one place | the held row wears BOTH halves of the held state — the selected ground step and, new in round 2, its **inset ring** — while the row under the pointer wears the hover fill and no ring; the section draws the insertion line in the gap the row would land in; nothing has been written yet |
| `current-drag-mid` | the conversation the reader is IN, dragged, with the pointer over the next row | the state round 1 could not photograph and round 2 (D7/U6) fixed: the held row KEEPS its `row-selected` fill, so "you are here" survives the gesture, and it is told apart from the hovered drop target by the ring alone — two rows, two readings, one frame |
| `drag-top` | a drag held ABOVE the first pinned row (round 1, D5b) | slot 0's line: drawn at the first row's own top edge, under the `Pinned chats` heading, with the last row held |
| `after-drop` | released one place down | the order is `p005, p000, p010`; the mark, the ring and the line are gone; the live region says where the row went |
| `order-relaunch` | `Page.reload` on the same profile | the same manual order comes back — the acceptance criterion |
| `search-filtered` | the panel's own search field, query `Chat 00` | the section draws two of the three pins; the third is hidden, not forgotten |
| `search-drag-mid`, `search-after-drop` | a drop under that filter | the move crosses the SHOWN neighbour while the hidden id keeps its stored slot (the stored order stays a permutation of the full list) |
| `many-pins`, `many-pins-drag` | fifteen pins, at 280 | the section overflows the scroller; a drag held at the scroller's edge scrolls it (722.5px of scroll, measured) and the line stays inside the section |
| `single-pin`, `single-pin-hover` | one pin, at 280 | the state where both move controls are inapplicable at once AND the grip is not offered at all (design round 1, D3: with one row there is no second slot a drop could land on). Shot at 280 so the absence is attributable to the count rule, not to the width shed |

The `keys` **slice** produces no frames: it is a readings-only launch (the keyboard walk
after a chord, and the live region's mutation count), and its readings are quoted below.

## The numbers

Measured on the shipped DOM at four panel settings, on a pinned row of a three-pin section
(`measurements/pinned-reorder-geometry-<theme>.json`; both palettes read the same):

| Panel | Row box | Title at rest | Title under the pointer | Revealed cluster |
| --- | --- | --- | --- | --- |
| **240** (a below-default step) | 208 | **126** | **68** | archive + up + down + mark = **108** (the grip is shed) |
| **260** (THE DEFAULT) | 228 | **146** | **88** | the same **108** (the grip is shed) |
| **280** (widened past the default) | 248 | **166** | **80** | the same **108** + the grip = **136** |
| **320** (the clamp maximum) | 288 | **206** | **120** | **136** |

**WHAT THE WIDTHS ACTUALLY ARE (round 2, design D8).** The panel's clamp is `220..320`
(`SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH`), the width a reader who has never resized it opens
at is **260** (`SIDEBAR_DEFAULT_WIDTH`), and the overlay arrangement's sheet is a fixed 260
as well (`SIDEBAR_SHEET_WIDTH`). Round 1's frame table called 280 "(default)" and 240
"(clamp min)"; neither is true — 280 is a panel WIDENED past the default, 240 is a step
BELOW it, and the two widths the app actually opens in had no frame at all until 260 was
added here. That matters because the shed's break sits between them: **at the default 260
(and in the sheet) the grip is not drawn, so the reorder path there is the move pair plus
the keyboard chords** — the drag handle appears only once the docked panel is widened to 279
or more. Reordering is available at every width; the DRAG is the width-gated accelerator,
and `docs/design/sidebar-row-space.md` §3 and §8 carry the rule, the 263-vs-279 arithmetic,
the load-bearing `!` and the measured reason the break was not moved down to cover 260.

So the handle costs the title **28px** (its 24px box plus the cluster's 4px gap) where it is
drawn, and **nothing at rest** — it is reveal-only, like the pair it sits beside. At 240 and
260 it is not drawn at all, which is why those columns read 68 and 88 rather than the 40 the
first pass measured with the grip in the cluster.

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
state is now carried by a **1px inset ring** off `[data-dragging]`:
`rgb(166, 160, 145) 0px 0px 0px 1px inset` (`--lo-ink-dim`, the same in both palettes) on a
ground that stays the row's own role. Measured in both palettes and in both row states, and
the drop target's `box-shadow` is `none` while the held row's is not. The class merge that
decides it is asserted in `scripts/sidebar-pin-order.test.mjs`.

The gesture's own readings, from the same runs:

- `drag-mid`: `dragging: ["p000"]`, the indicator drawn inside the section's coordinates,
  and `stored: []` — **nothing has been written mid-gesture**.
- `current-drag-mid` (round 2): the held row is `current: true`, its ground equals its own
  resting ground and its ring is painted; the row under the pointer reads the hover ground
  with `ring: "none"`. Escape then cancels it with the order untouched.
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
- `single-pin`: one row in the section, both move controls `aria-disabled`, **no grip**.
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

**This round's intended changes** are the ring on the three drag labels (`drag-mid`,
`drag-top`, `search-drag-mid` — the held row's inset ring, see above), the new
`current-drag-mid` pair, and the new `order-before-260`/`grip-hover-260` pair (the default
width, where the grip is shed; design round 2, D8). **The remainder of the difference is the
same non-determinism as round 1's**, and it is the reason several `DIFFERS` verdicts carry
small bounding boxes: the composer caret strip (66 changed pixels at x 858-939,
y 1597-1629), the rotating empty-state sentence (the widest of them — the whole tip line
between x ~880 and x ~1540), a long title's pan phase, and one- to three-pixel scroll
offsets in the dropped-order and drag frames.

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
