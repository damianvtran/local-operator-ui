# U12 — the card's close control, with the card scrolled to its end

UX round 2 measured that the card's ✕ travelled with its content: the ✕ was an
absolutely-positioned child of the card's own `overflow-y: auto` box, and an
abspos child of a scroll container scrolls **with** it. On the shipped card at a
300 px viewport (below the app's minimum, which is the point — it is the CSS
mechanic, not a layout judgement):

```
beforeY 24 (visible) -> afterY -20 (NOT visible)
```

The fix splits the card into two boxes: the cap (`max-h-[calc(100vh-2rem)]`), the
clip and the `p-4` moved to an inner scroller, and the control is positioned
against the outer box, which never scrolls. The card's own box, its radius, its
shadow and its geometry at rest are unchanged, and the scroller spans the card
exactly, so the scrollbar still sits on the card's trailing edge.

Head: **`adbd67c793`**. Same story, same viewport (1000×300), same rig discipline.

## Measured

| | before the fix (UX round 2) | after |
|---|---|---|
| element that scrolls | the card itself | the inner box (`isCard: false`) |
| card `overflow-y` | `auto` | `visible` |
| scrollable | yes, `scrollTop 44` of 312 in a 268 box | same |
| ✕ `y` at rest → at the end | `24 → -20` (**not visible**) | `24 → 24` (**visible**) |

Both themes, identically (`probe.json`). `card-scrolled--*.png` are the frames at
the end of the scroll, where the ✕ is still in the corner.

## Files

| File | What it is |
|---|---|
| `card-scrolled--localOperator{Dark,Light}.png` | The card after the scroller was taken to its end; the ✕ is visible at the top-right. |
| `probe.json` | The boxes, the scroll range and the ✕'s rect before and after, both themes. |

## What this does not cover

The rest of the card family (the failure panels, the install panels) is not
measured here; they share the same container, so the split applies to them by
construction, and `scripts/update-indicator-segments.test.mjs` pins the structural
property for the whole family (`the close control is not inside the card's
scrolling box`). Nothing here is a live-app capture.
