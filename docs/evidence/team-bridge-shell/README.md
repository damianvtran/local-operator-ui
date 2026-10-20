# Team Bridge — panels reach the window top

Operator report (2026-10-20): the Team Bridge sidebar and thread panel were
inset below the titlebar by a hard horizontal edge.

## Frames

- `flush-to-window-top.png` — the fix, at 1280x720 CSS (2x device pixels):
  the 32px traffic-light clearance is padding INSIDE the aside and the thread
  section; both boxes start at y=0 and are 720px tall (measured over CDP:
  `aside rect 260,0 288x720`, `section rect 548,0 732x720`).
- `lane-reserved-comparison.png` — the same page with the old reserving lane
  (the pre-fix shape), kept as the comparison.

Both are Storybook frames of `Team Bridge/Page` taken through the operator's
browser tool; `--chrome-strip-h` is set to 32px on the frame because Storybook
has no native window chrome. They are browser-tool PNGs, not sweep frames.
