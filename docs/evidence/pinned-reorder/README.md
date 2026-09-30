# Pinned chats can be reordered — rendered evidence

Frames for issue #693 (a desktop-local manual order for the `Pinned chats` section,
driven by a move pair, drag-and-drop and keyboard chords) and its round-1 remediation
(PR #697). Every frame here is a **headless** launch of the built renderer against the
repository's own stand-in daemon, captured as PNG at a 2760x1800 device-pixel surface
(1380x900 at DPR 2), one launch per slice and palette.

Thirty-four frames across **17 states** and two palettes:

| Frame | State | The claim it carries |
| --- | --- | --- |
| `order-before-240/280/320` | three pins, catalogue order, pointer parked | nothing at rest: no grip, no pair, no indicator is painted; the section is the catalogue's own order passed through (rule 1) |
| `grip-hover-240/280/320` | pointer on the middle pinned row | the reveal. At 280 and 320: grip + move pair + archive appear on ONE row and no other. At **240 the grip is SHED** (design round 1, D2) and the pair stays — see §"The numbers" |
| `drag-mid` | pointer down on the grip, moved one place | the dragged row carries `data-dragging`'s ground step — a step the hover does NOT paint (measured, below) — and the section draws the insertion line in the gap the row would land in; nothing has been written yet |
| `drag-top` | a drag held ABOVE the first pinned row (design round 1, D5b) | slot 0's line: drawn at the first row's own top edge, under the `Pinned chats` heading, with the last row held |
| `after-drop` | released one place down | the order is `p005, p000, p010`; the mark and the line are gone; the live region says where the row went |
| `order-relaunch` | `Page.reload` on the same profile | the same manual order comes back - the acceptance criterion |
| `search-filtered` | the panel's own search field, query `Chat 00` | the section draws two of the three pins; the third is hidden, not forgotten |
| `search-drag-mid`, `search-after-drop` | a drop under that filter | the move crosses the SHOWN neighbour while the hidden id keeps its stored slot (the stored order stays a permutation of the full list) |
| `many-pins`, `many-pins-drag` | fifteen pins, at 280 | the section overflows the scroller; a drag held at the scroller's edge scrolls it (722.5px of scroll, measured) and the line stays inside the section |
| `single-pin`, `single-pin-hover` | one pin, at 280 | the state where both move controls are inapplicable at once AND the grip is not offered at all (design round 1, D3: with one row there is no second slot a drop could land on). Shot at 280 so the absence is attributable to the count rule, not to the width shed |

The `keys` **slice** produces no frames: it is a readings-only launch (the keyboard walk
after a chord, and the live region's mutation count), and its readings are quoted below.

## The numbers

Measured on the shipped DOM at the three panel settings, on a pinned row of a three-pin
section (`measurements/pinned-reorder-geometry-<theme>.json`; both palettes read the same):

| Panel | Row box | Title at rest | Title under the pointer | Revealed cluster |
| --- | --- | --- | --- | --- |
| **240** (clamp min) | 208 | **126** | **68** | archive + up + down + mark = **108** (the grip is shed) |
| **280** (default) | 248 | **166** | **80** | the same **108** + the grip = **136** |
| **320** | 288 | **206** | **120** | **136** |

So the handle costs the title **28px** (its 24px box plus the cluster's 4px gap) where it
is drawn, and **nothing at rest** - it is reveal-only, like the pair it sits beside. At
the 240 clamp it is not drawn at all (round 1), which is why that column reads 68 rather
than the 40 the first pass measured with the grip in the cluster;
`docs/design/sidebar-row-space.md` §3 and §8 carry the rule, the 263-vs-279 arithmetic
and the load-bearing `!`.

**The dragged row's ground, measured rather than judged (round 1, D1/U1).** The rig reads
the computed `background-color` of the dragged row and of a merely hovered one in the
same launch:

| Palette | Dragged row | Merely hovered row |
| --- | --- | --- |
| `localOperatorDark` | `rgb(55, 47, 36)` = `#372F24` (`--lo-row-selected`) | `rgb(48, 45, 41)` = `#302D29` (`--lo-row-hover`) |
| `localOperatorLight` | `rgb(235, 231, 216)` = `#EBE7D8` (`--lo-row-selected`) | `rgb(237, 236, 231)` = `#EDECE7` (`--lo-row-hover`) |

Before the fix both rows painted the hover step: the captured pointer keeps `:hover` on
the row, and the hover variant outranked the drag's ground. A dragged row that is ALSO
the current one takes the panel's other row role (`rowDraggingCurrent`), because the
selected step is that row's resting fill; the class merge that decides it is asserted in
`scripts/sidebar-pin-order.test.mjs`. **No frame shows that state** — see "cannot show".

The gesture's own readings, from the same runs:

- `drag-mid`: `dragging: ["p000"]`, the indicator drawn inside the section's coordinates,
  and `stored: []` — **nothing has been written mid-gesture**.
- `drag-top`: the indicator's y is **498**, the first pinned row's own top edge, against
  the section box's **474** (the heading sits between them).
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
`single` with one (`--pins p000`), and `keys` with the three the walk needs. All four
slices run at a **280px panel** where the grip matters (the scene sets it: the panel's
260 default is below the shed's break), which is why the many and single frames differ
in width from the first pass's.

## Round 1's re-shoot, and how it compares to the set before it

Every frame in this directory was re-shot on the round-1 tree, so each one is a picture
of what ships. Against the previously committed set (the fold's, `9dd18ab318`), **5 of
34 are byte-identical** and the rest fall into two groups, both measured with a raw-RGBA
comparison (`sharp`, every channel, with the bounding box of what moved):

**This round's intended changes.** `grip-hover-240` (the grip is gone: the shed),
`drag-mid` and `search-drag-mid` (the dragged row's ground), `drag-top` (new), and the
`many-*`/`single-*` frames (those slices are now shot at 280 rather than at the 260
default, so the panel and everything right of it moved).

**Run-to-run non-determinism outside the sidebar's content.** The composer's caret strip
(device x 858-939, y 1597-1629 — 66px, the strip the fold's own report names), the pan
phase of a long title, and the rotating empty-state sentence; the search states differ
from their predecessors only by such strips (12-60px) now that the scene parks the list's
scroll before them. The dropped-order frames also carry a LIST SCROLL OFFSET, because the
drag that precedes them brings rows into view and the offset depends on where the pointer
crossed; the rows and the order are the same.

## What these frames cannot show

- **A dragged row that is also the current one.** The `current` state is the ROUTE's, and
  against the committed stub neither door opens a conversation: the large catalogue's ids
  (`p000`) are not the contract's shape, so `/chat/p000` is read as a legacy agent link
  (measured: `#/chat/p005`, no `aria-current`), and the six-conversation fixture's
  twelve-hex ids reach a stub that cannot open a session (measured: the route stays at
  `#/chat` and a refusal toast appears). The mechanism is asserted at the merge level
  instead; a rendered frame needs a daemon that can open a session (QA's own rig).
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
