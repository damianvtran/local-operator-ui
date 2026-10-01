# chat-device-persist — the chip after the send, before and after the fix

Two states the swept set cannot hold, because they need a SEND: what the chat
header's device chip reads once a new chat aimed at a peer becomes a live
conversation, and how the chip sits on the header's baseline line beside the
identity pair. Both were reported by the operator on 2026-09-30 — *"he selected
the remote device in the new-chat window. Sent a test probe ('what OS are you
on') expecting the node's OS. On hitting enter, the device selection reverted
to local."* — and both frames below are the app photographing itself.

## The instrument

`harness/drive.mjs` boots the BUILT app (`out/main`, `--window-mode=headless`,
never shown or focused), stages a new chat, picks `cloud-node-1` in the chip's
picker, types a message with CDP's own input pipeline and sends it with a real
Enter, then reads the chip and the header geometry back. `harness/server.mjs`
is the endpoint it talks to: the two mesh reads, the catalogue, the create, the
message route and a minimal session stream, all fixtures in the wire's own
shape. The app's transport, store, chip, picker and create flow are the shipped
ones.

**Disclosure — what was and was not driven live.** No real mesh peer exists in
this run: the installed daemon predates the `peer` admission on
`sessions.create`, so a real one would refuse the path before anything could be
measured (the same disclosure the `chat-device-live` set carries for its
transfer route). The create the app posted named the peer —
`{"peer":"d_rig_node0001", …}` on the wire, recorded in each arm's
`wire.jsonl` — and the chip's post-send state is decided by the app's own store
and placement model, which is exactly the code under test. The full live drive
against a real peer belongs to the workstream's E2E.

The identical rig ran twice, against the same built tree at two revisions:

```sh
# BEFORE — the base tree, the fix absent (the defect, reproduced)
node docs/evidence/chat-device-persist/harness/drive.mjs --arm before --expect-chip "On this device"

# AFTER — the fix present (the acceptance)
node docs/evidence/chat-device-persist/harness/drive.mjs --arm after --expect-chip "On cloud-node-1" --expect-aligned
```

`--expect-chip` is required and asserted after the first AND the second send;
`--expect-aligned` asserts the text-baseline reading below. A third invocation,
`--experiments`, ran the mechanism probes the fix was chosen from — its table
is quoted in `chat-header-device.tsx`'s carrier comment, and the raw readings
are in the run report.

## What the frames show

| state | before (base tree) | after (fix) |
| --- | --- | --- |
| `draft-peer` | `New on cloud-node-1` | `New on cloud-node-1` (unchanged) |
| `after-send` | **`On this device`** — the defect | **`On cloud-node-1`** |
| `second-send` | `On this device` again | `On cloud-node-1` (no revert) |

The chip after the send, both arms, verbatim from the runs; the second line of
each is the button's own `aria-label`:

- before: `This conversation runs on this device. Click to move it to another device or recall it later.`
- after: `This conversation runs on cloud-node-1. Click to recall it here or move it on.`

The header row, measured live at 1380x900 (`getBoundingClientRect` + the font's
own ascent, in CSS px):

| reading | before | after |
| --- | --- | --- |
| chip box `y` | 42.0 | 44.2 |
| identity pair box `y` | 44.2 | 44.2 |
| chip label text baseline | 55.25 | 57.45 |
| identity label text baseline | 57.5 | 57.5 |
| box delta (chip − selects) | −2.2 | 0 |
| baseline delta (chip − selects) | −2.25 | −0.05 |

The chip's horizontal geometry is byte-identical across the arms in the same
state (`x` 346.04 / width 171.06 on `draft-peer`; `x` 565.24 on `after-send`),
which is the check that the alignment fix's padding compensation — the
zero-width carrier takes one `gap-1` slot at the leading edge — moves nothing.

## What a reader may verify without re-running

- Each `*/*.webp` is a `Page.captureScreenshot` of the built app in
  `--window-mode=headless`, 1380x900 (window size and CDP metric override),
  one palette (the app's own default, `localOperatorDark`), and passed
  `assertFramePaints` at capture.
- The wire log behind each arm (`wire.jsonl` in the run scratch, not committed)
  holds the create body that names the peer and the two message posts; the
  report records `createPeer` for both arms as `d_rig_node0001`.
- The runs' exact tool versions: Electron 44.3.0 from the worktree's
  `node_modules`, Node 26.5.0 for the harness.
