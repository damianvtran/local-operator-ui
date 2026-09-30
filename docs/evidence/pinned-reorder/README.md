# Pinned chats can be reordered - rendered evidence

Frames and readings for issue #697: the Pinned section's desktop-local manual order
(issue #693) becomes directly manipulable - a **drag handle** on the pinned row's hover
strip reorders the section, with an insertion line between rows, alongside the move pair
and the `⌘⇧↑`/`⌘⇧↓` chords #693 shipped.

This directory is the `pinned-reorder` scene's output (`scripts/renderer-driver.mjs`),
three state **slices** x two palettes, one headless launch each. The numbers behind the
frames are in `measurements/`.

## What each frame is for

| Frame | State | The claim it carries |
| --- | --- | --- |
| `order-before-240/280/320` | three pins, catalogue order, pointer parked | nothing at rest: no grip, no pair, no indicator is painted; the section is the catalogue's own order passed through (rule 1) |
| `grip-hover-240/280/320` | pointer on the middle pinned row | the reveal: grip + move pair + archive appear on ONE row and no other; the title pays for them, and the numbers are in §"The numbers" |
| `drag-mid` | pointer down on the grip, moved one place | the dragged row carries `data-dragging`'s ground step and the section draws the insertion line in the gap the row would land in - nothing has been written yet |
| `after-drop` | released one place down | the order is `p005, p000, p010`; the mark and the line are gone; the live region says where the row went |
| `order-relaunch` | `Page.reload` on the same profile | the same manual order comes back - the acceptance criterion |
| `search-filtered` | the panel's own search field, query `Chat 00` | the section draws two of the three pins; the third is hidden, not forgotten |
| `search-drag-mid`, `search-after-drop` | a drop under that filter | the move crosses the SHOWN neighbour while the hidden id keeps its stored slot (the stored order stays a permutation of the full list) |
| `many-pins`, `many-pins-drag` | fifteen pins | the section overflows the scroller; a drag held at the scroller's edge scrolls it (722.5px of scroll, measured) and the line stays inside the section |
| `single-pin`, `single-pin-hover` | one pin | the one state where both move controls are inapplicable at once, and the state the boundary sentence speaks about; the grip is still offered (a drag can leave the section) |

Every frame in the set is a **headless** launch (`--window-mode` resolves to `headless`
for a rig-shaped launch, and the scene asserts `visible=false focused=false` before its
first capture).

## The numbers

Measured on the shipped DOM at the three panel settings, on a pinned row of a three-pin
section (`measurements/pinned-reorder-geometry-<theme>.json`):

| Panel | Row box | Title at rest | Title under the pointer | Revealed cluster |
| --- | --- | --- | --- | --- |
| **240** (clamp min) | 208 | **126** | **40** | grip + up + down + archive = 136px |
| **280** (default) | 248 | **166** | **80** | the same 136px |
| **320** | 288 | **206** | **120** | the same 136px |

So the handle costs the title **28px** (its 24px box plus the cluster's 4px gap) at every
width, and **nothing at rest** - it is reveal-only, like the pair it sits beside. At the
240 clamp that leaves 40px of title, about five characters, which is the number
`docs/design/sidebar-row-space.md` §3 records for a designer to weigh (a shed for the
handle alone, the handle drawn only where the row already truncates, or the moves left to
the chords).

The gesture's own readings, from the same run:

- `drag-mid`: `dragging: ["p000"]`, the indicator drawn inside the section's coordinates,
  and `stored: []` - **nothing has been written mid-gesture**.
- `after-drop`: order `["p005","p000","p010"]`, and the persisted view holds
  `"pins": ["p005","p000","p010"]` - **one write, at the drop**.
- `search-after-drop`: the shown order is `["p005","p000"]` and the stored order is
  `["p005","p000","p010"]` - the hidden id keeps its slot.
- `many-pins-drag`: `scrollTop` 0 -> 722.5 while the drag is held at the scroller's edge,
  and the Escape that follows leaves the order untouched (`stored` unchanged).
- `single-pin`: one row in the section, both move controls `aria-disabled`, the grip
  still offered.

## How these frames were taken

`scripts/renderer-driver.mjs`, scene **`pinned-reorder`**, against the repository's own
stand-in (`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs`, extended with a
`--pins` flag that is inert without it). One launch per palette per **slice**, because the
stub's fixture is per process and the many-pins / single-pin states are about how many
pins the section holds:

```sh
cd <worktree>
set -a; . ~/local-operator-ui/.env; set +a
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18336 pnpm build

# per slice: three | many | single, and per palette
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 18336 --records "$SCRATCH/records-three-dark" --catalogue 120 \
  --pins p000,p005,p010 > "$SCRATCH/stub-three-dark.log" 2>&1 &
LOCAL_OPERATOR_DESKTOP_TOKEN=<any non-empty bearer: the stub checks none> \
  node scripts/renderer-driver.mjs \
    --scene pinned-reorder --pinned-state three \
    --backend http://127.0.0.1:18336 --backend-records "$SCRATCH/records-three-dark" \
    --seed-onboarding-complete --theme localOperatorDark \
    --out "$SCRATCH/frames-three-dark" --window-size 1380x900
# … then --theme localOperatorLight, then --pinned-state many
#     (--pins p000..p014) and --pinned-state single (--pins p000)
```

The frames land as `<out>/<label>.png`; each label's committed directory here holds one
file per palette. `measurements/` holds the per-palette geometry JSON the scene printed.

- **The stub is a responder, not a backend** - no store, no turns, no transcript. Its
  pin route mutates the rows it SERVES; the rig's first version had it mutating the
  six-row fixture while `--catalogue` served the large one, so a press the app answered
  about a row it never asked about looked like a control that did nothing. Both sides
  were fixed before this set was taken.
- **The three slices are one set**: frame names do not change between them, so
  `docs/evidence/pinned-reorder/<label>/<theme>.png` is complete only with all three
  launches per palette.
- **`captureSettled` is what makes a frame evidence at all**: each capture is retried
  until two consecutive frames are byte-identical with no toast on screen.
- The RELAUNCH step is a `Page.reload` against the same `--user-data-dir` profile, not a
  second process: the order is a PERSISTED preference, and the claim is that a fresh boot
  of the renderer rehydrates it (the `turn-collapse` and row-space scenes' own restart
  step). A second process would say the same thing about the same bytes.
- Every rig was reaped by exact pid; the stub's records and logs live outside the repo.

## What these frames cannot show

- **A real hand**: every gesture goes through `Input.dispatchMouseEvent`, so it enters
  Chromium's own pipeline and the element under it is found the way a hand's would be -
  but there is no pressure, no jitter and no trackpad momentum, so no frame says "a real
  hand finds this".
- **Focus rings**: a headless window is never shown, so `:focus-visible` never paints.
- **The pan** (§5 of the row-space design): the 240 hover frame shows a 40px title; what a
  reader sees beyond it is the pan's own subject, photographed by the row-space set.
- **Scrollbars**: macOS overlay scrollbars take no width, so the frames are of the full
  row box.
