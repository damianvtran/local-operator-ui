# chat-device-persist — the chip across the create, the recall and the ring

The chat header's device chip, in the states a story cannot hold because they
need a SEND or a MOVE: what it reads once a new chat aimed at a peer becomes a
live conversation, what it reads once that conversation is recalled home and its
arrival notice dismissed, how it sits on the header's baseline line, and whether
its focus ring survives the title line's clip. It began as one operator report
(2026-09-30) — *"he selected the remote device in the new-chat window. Sent a
test probe ('what OS are you on') expecting the node's OS. On hitting enter, the
device selection reverted to local."* — and round 2's review added the two the
fixed head still carried (a clipped ring; a stale placement a dismissal could
resurrect). Every frame below is the app photographing itself.

## The instrument

`harness/drive.mjs` boots the BUILT app (`out/main`, `--window-mode=headless`,
never shown or focused), stages a new chat, picks `cloud-node-1` in the chip's
picker, types a message with CDP's own input pipeline and sends it with a real
Enter, then reads the chip, the header geometry, the clipping rule and the
captured pixels back. `harness/server.mjs` is the endpoint it talks to: the two
mesh reads, the catalogue, the create, the message route, the transfer route and
a minimal session stream, all fixtures in the wire's own shape. The app's
transport, store, chip, picker, create and move flows are the shipped ones.

### Round 2's additions to the instrument

- **The recall chain.** After the send the drive opens the picker, presses the
  `rig-mac` ("this device") row, takes the confirmation's `Recall` verb, holds
  the transfer's answer open (the endpoint waits on a file the drive writes) so
  the in-flight `Moving to this device` state is photographable, releases it,
  reads the landed `On this device`, then presses the arrival notice's
  `Dismiss` — the step that used to resurrect the stale `remote` mark. Every
  state is a frame.
- **The ring scan.** `scanChipEdges` decodes a captured frame (`sharp`, the
  sweep's own decoder) and counts, inside the chip's own box, the accent-
  coloured pixels of the focus ring's four edges plus the ink in the chip's
  last two pixels (the band the clip cut before this round's fix). `--expect-ring
  closed|open-bottom` and `--expect-below-clip inked|none` make each arm assert
  its own reading, so the before/after pair cannot pass by both being loose.
- **The variants.** `--palette` wears a named palette for the whole run (the
  light frames) and `--peer-name`/`--window-size` widen the device's label and
  narrow the window (the narrow-header frames). The clipping row's own rule —
  `has-[[data-device-chip]]:[overflow-clip-margin:4px]` — is read live
  (`getComputedStyle(...).overflowClipMargin`) and printed in each arm's
  `clip:` step, so the mechanism is on the record beside the frames.

**Disclosure — what was and was not driven live.** No real mesh peer exists in
these runs: the installed daemon predates the `peer` admission on
`sessions.create` and the transfer route's own admission, so a real one would
refuse the paths before anything could be measured (the same disclosure the
`chat-device-live` set carries). The create the app posted named the peer —
`{"peer":"d_rig_node0001", …}` — and the recall posted `{"to":"local",…}`, both
recorded in each arm's `wire.jsonl`; the chip's post-send and post-recall states
are decided by the app's own store and placement model, which is the code under
test. The full live drive against a real peer belongs to the workstream's E2E.

The rig runs once per arm, each with its own expectation:

```sh
# THE BASE TREE — the original defect (the revert), still the set's first half
node docs/evidence/chat-device-persist/harness/drive.mjs --arm before --expect-chip "On this device"

# THE ROUND-1 HEAD (the review head) — the clipped ring and the stale mark
node docs/evidence/chat-device-persist/harness/drive.mjs --arm review-head \
  --expect-chip "On cloud-node-1" --expect-aligned \
  --expect-ring open-bottom --expect-below-clip none \
  --expect-recall-dismissed "On cloud-node-1"

# THE FIXED TREE — both fixed, and no regression
node docs/evidence/chat-device-persist/harness/drive.mjs --arm after \
  --expect-chip "On cloud-node-1" --expect-aligned \
  --expect-ring closed --expect-below-clip inked \
  --expect-recall-dismissed "On this device"

# THE VARIANTS (design D4)
node docs/evidence/chat-device-persist/harness/drive.mjs --arm after-light --palette localOperatorLight --short \
  --expect-chip "On cloud-node-1" --expect-aligned --expect-ring closed --expect-below-clip inked
node docs/evidence/chat-device-persist/harness/drive.mjs --arm after-narrow \
  --peer-name cloud-node-1-with-a-very-long-device-name --window-size 820x900 --short \
  --expect-chip "cloud-node-1" --expect-aligned
```

`--expect-chip` is required and asserted after the first AND the second send; the
other flags assert the readings tabled below. A sixth invocation,
`--experiments`, ran the mechanism probes the alignment fix was chosen from — its
table is quoted in `chat-header-device.tsx`'s carrier comment.

## What the frames show

### Defect 1 — the revert (the operator's report)

| state | before (base tree) | after (fix) |
| --- | --- | --- |
| `draft-peer` | `New on cloud-node-1` | `New on cloud-node-1` (unchanged) |
| `after-send` | **`On this device`** — the defect | **`On cloud-node-1`** |
| `second-send` | `On this device` again | `On cloud-node-1` (no revert) |

The chip after the send, `after` arm, verbatim: `On cloud-node-1`, its
`aria-label` `This conversation runs on cloud-node-1. Click to recall it here or
move it on.`

### Defect 2 — the alignment (round 1)

The header row, measured live at 1380x900 (`getBoundingClientRect` + the font's
own ascent, in CSS px):

| reading | before (base tree) | after (fix) |
| --- | --- | --- |
| chip box `y` | 42.0 | 44.2 |
| identity pair box `y` | 44.2 | 44.2 |
| chip label text baseline | 55.25 | 57.45 |
| identity label text baseline | 57.5 | 57.5 |
| baseline delta (chip − selects) | −2.25 | −0.05 |

The chip's horizontal geometry is byte-identical across the arms in the same
state (`x` 346.04 / width 171.06 on `draft-peer`), which is the check that the
alignment fix's padding compensation moves nothing.

**Which partner the reading is against** (design review round 1, D2): the table
above is the `after-send` row, where the chip's neighbours are the two identity
SELECTS. The `draft-peer` row has a different partner — the title alone, no
selects — and there the chip sits roughly 1px BELOW the title's baseline where
before the fix it sat ~1px above: the same magnitude, flipped in sign. That is
not a regression (the carrier joins the row's text baseline either way), and it
is left as measured rather than retuned, because the row above is the state the
operator's report is about; the numbers are in each arm's `geometry:draft-peer`
step.

### Defect 3 — the clipped focus ring (round 2, design D1)

The pick leaves focus on the chip, so `draft-peer` is a FOCUSED control (the
drive asserts `document.activeElement` and says whether the pick left it there
or the DOM had to). The scan of the committed pixels, inside the chip's own box:

| reading | `review-head` (before) | `after` (fixed) |
| --- | --- | --- |
| ring stroke pixels — top / left / right | 328 / 26 / 26 | 328 / 26 / 26 |
| ring stroke pixels — **bottom** | **0** — cut away | **328** — a full ring |
| ink in the chip's last 2px (`newInk`) | **0** — nothing paints | **492** |
| hover fill reaching the box's bottom edge | **0** | **320** |

`review-head`'s ring is an open-bottomed bracket; `after`'s is a closed box, in
both the dark and the light palette. The same reading was taken on the
`draft-peer-hover` frame (the real pointer moved onto the control, never a click).

### Defect 4 — the stale mark a dismissal could resurrect (round 2, agent review F1)

The chain, all in the creating window: pick a peer → send (row stamped) → recall
the conversation home → dismiss the arrival notice.

| state | `review-head` (before) | `after` (fixed) |
| --- | --- | --- |
| `recall-moving` | `Moving to this device` | `Moving to this device` |
| `recall-settled` | `On this device` | `On this device` |
| `recall-dismissed` | **`On cloud-node-1`** — the stale mark | **`On this device`** |

### The common state (design D3)

`local-live` — a plain conversation created with no pick at all — reads `On this
device` in both arms, and the carrier sits it on the identity pair's line.

## The variants (design D4)

| frame | what it holds |
| --- | --- |
| `after-light/*` | the light palette (`localOperatorLight`), ring closed and fill reaching the bottom edge, same readings |
| `after-narrow/draft-peer` | an 820px window and a 45-character device label: the chip grows to 364px and reads whole (no truncation at this width), the identity selects yield — the competition the design asked to see |

## What a reader may verify without re-running

- Each full-window `*/*.webp` is a `Page.captureScreenshot` of the built app in
  `--window-mode=headless` (the mode's own line, `visible=false focused=false`,
  is recorded in each run's report), 1380x900 (window size and CDP metric
  override; the narrow arm is 820x900), one palette per arm, and passed
  `assertFramePaints` at capture. `header-row` IS A CROP, not a full window:
  1120x48 in the four 1380-wide arms and 764x48 in `after-narrow`, taken from
  the header band alone (`Page.captureScreenshot`'s `clip`), so its pixel counts
  are comparable only with each other.
- `before/` holds four states from the set's first pass (the base tree, the
  revert); `review-head/`, `after/`, `after-light/` and `after-narrow/` hold
  round 2's.
- The wire log behind each arm (`wire.jsonl` in the run scratch, not committed)
  holds the create bodies, the two message posts and the recall's transfer body
  (`{"to":"local","keep":false}`); each report records them.
- The runs' exact tool versions: Electron 44.3.0 from the worktree's
  `node_modules`, Node 26.5.0 for the harness.
