# Composer send/stop slot: before and after frames

Frames and numbers for the PR that makes Send, Stop and Send recording share one
slot. Every frame is the shipped `MessageInput` in the geometry rig
(`scripts/composer-readings-geometry.mjs --states=<state>`), cropped to the
composer row, at a 1024px column (`w1024`) or the 520px small view (`w520`), dark
and light.

- `before-*`: origin/main `e6a9b59b8d` plus the rig only.
- `after-*`: the PR head.
- `numbers-<tree>.json`: the probe for every frame (button boxes, cluster width,
  what the composer handed `onSendMessage`, the textarea value).
- `slot-proof-<tree>.json`: `scripts/composer-slots-proof.mjs` over those numbers.
  after = PASS (mic x and primary-slot x equal their idle values in all 12 states
  x 2 widths x 2 themes); before = FAIL (the mic moves 36px when a turn starts).
- `strip-sweep-numbers-<tree>.json`: the status-strip width ladder at content
  widths 640/652/705/712/750/752/780/792, idle, running and recording.
- `sheet-*-dark-1024.png`: the frames stacked for a quick read.

## Round 1 (`round-1/`)

Regenerated on head `cb2df47a81` after the round-1 review, QA, design and UX
findings; the first set above is the head `1df62ff` it replaces.

- `after-*` / `before-*`: the composer row, 12+ states, 1024 and 520px, dark and
  light. `*-card-*` frames crop the WHOLE card (caption row, recording lane).
  `after-rtl-*`: the same states with `--dir=rtl`.
- `slot-proof-*.json`, `rtl-proof-*.json`: mic x and primary-slot x equal their
  idle values in every state, and the row never overflows (the check QA Q1 added).
- `preparing-sweep-*.json`, `preparing-proof-*.json`: the mic pressed and the
  recorder still being acquired, at 1024/900/840/780/720/700px, both readings
  fixtures. before = FAIL (the caption grew the cluster 68 to 131-179px and pushed
  Send 17-53px past the card edge); after = PASS (68px, overflow 0).
- `stop-arrival-numbers-after.json`: Stop reached by clearing the box (opacity 1,
  never guarded) and Stop reached from a Send press (slot B timeline
  `Sending your message@1` then `Stop@0.6`, the ramp while the guard is armed).

## Round 2 (`round-2/`)

Regenerated on head `8ca363d464` (review R2-1, design D9/D11/D13, UX U1).

- `preparing-*-card-*`: the whole card with "Starting recording" in the caption row
  under the field. Nothing is painted over a reading, the cluster is 68px.
- `prep-*`, `numbers-prep.json`, `proof-prep.txt`: idle vs preparing at column
  widths 1024/900/840/780/720/700, both readings fixtures, both themes - A and B x
  identical, row overflow 0 (PASS).
- `stop-*`, `numbers-stop.json`: Stop after clearing the box (opacity 1, never
  guarded) and Stop after a send press (`Sending your message@1` then `Stop@0.72`).
- `loc-recording-w520-{fr,ru}-card-*`: the recording hint line in French and
  Russian at 520px (`--locale=fr|ru`): "insere . annule . envoie maintenant" and
  the Russian equivalent both fit.
- `rtl-*`, `proof-rtl.txt`: RTL. `numbers-frames.json`, `proof-frames.txt`: all
  states at 1024 and 520, dark and light.
