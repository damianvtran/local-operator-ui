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
