# Chat image expand — one picture, expanded over the app

The operator's report: a screenshot in a conversation could not be read at the
ceiling the transcript gives a picture (`max-h-[240px]`), and on a canonical row
clicking one did nothing at all — `ImageAttachment` rendered a plain `<div>`
there, with no handler of any kind.

These are the states that answer it. Three stories, twelve themes, thirty-six
frames, and each story answers a different question:

| story | what it is | the question it answers |
| --- | --- | --- |
| `in-thread` | the picture as the message view draws it, untouched | what the press acts on |
| `expanded` | the same picture fitted into the viewport, over the scrim | the overlay itself — and the margin |
| `expanded-small-image` | a 240x180 picture in the same overlay | the size rule, on the side the margin rule does not cover |

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it. 6017 was held by another worktree's Storybook when
# this set was taken; 6117 is what this set bound, confirmed on the banner.
pnpm storybook --port 6117 --no-open

node scripts/capture-evidence.mjs http://localhost:6117 \
  --only=chat-image-expand \
  --allow-backend

pnpm check-evidence
```

`--allow-backend` because something was listening on the schema's default
`http://localhost:1111` for the whole of this pass. Nothing these stories render
talks to a backend: the picture is a `data:` URI, the column is local JSX, and
`ImageAttachment`'s file-actions menu is not opened by any of them.

**`reactDocgen: false` was NOT needed here**, although `capture-evidence.mjs`'s
own header still says it is: that header was written against
`react-docgen-typescript`, and `.storybook/main.ts` on this base already uses the
built-in `react-docgen`. The rig built and captured with the committed config.

**The pass was run twice, and the frames on disk are the second run's.** The
first run photographed a 960x600 fixture, which is SMALLER than the box the
overlay offers a picture — so `expanded` showed the picture at its natural size
and the fit-to-viewport path was never exercised. The fixture was re-drawn
larger and the set re-taken; `partialCapture` records the accumulation (816
refreshed frames over the pass, 50 added), and no frame here is a leftover of the
first run — `expanded` came back byte-different because the picture did.

## The size rule, measured rather than asserted

`max-w`/`max-h` and never a width. An `<img>` constrained only by its maxima
renders at its intrinsic size and is **never enlarged**, so the two frames below
are the two halves of the rule. Both numbers were measured off the committed
frames by thresholding the picture's own light ground and trimming to it, not
read back off the CSS:

| frame | frame size | measured picture | what that is |
| --- | --- | --- | --- |
| `expanded/localOperator{Dark,Light}` | 1280x900 | **1152x432 at +64,+234** | 90vw wide — the cap binding on the widest axis — with 64px on each side, exactly the 5% margin, and 234px above and below because the picture's aspect is wider than the viewport's |
| `expanded-small-image/localOperator{Dark,Light}` | 640x420 | **240x180 at +200,+120** | the picture's own size, centred in a box of 576x378 that was never used — it would be a 2.4x blur if the overlay fitted instead of capped |

The `expanded` measurement also settles a geometry question a still cannot show
directly. The overlay's content box is the PICTURE's box, not the viewport's —
which is what makes a press on the scrim a genuine outside press for Radix
rather than a `pointer-events` trick — and a surviving `w-full`/`p-6` would have
left the picture at x=0 (or x=24) instead of the 64/64 it measures. The centring
is symmetric on both axes, so `translate-none` + `m-auto` landed as written and
the primitive's own `-translate-x-1/2 -translate-y-1/2` did not.

**The fixture's ASPECT is chosen, and the constraint is this repository's own
gate.** `check-evidence` requires a frame's dominant colour to sit within ΔE00 25
of one of that theme's four grounds. A picture fitted to a 1280x900 viewport with
a near-square aspect fills most of the frame, so the picture's own white becomes
the dominant colour — measured: a 1200x750 fixture at this viewport failed at
**ΔE00 79.41** from the nearest `localOperatorDark` ground, which is the same
number the check's header records for the blank frame the check was written for.
The fixture is therefore WIDER than the viewport (1600x600), so the cap binds on
the width, the scrim still covers the most pixels, and the binding axis carries
the margin this set exists to show.

## What is in the frames, and what a design round should look at

- The picture is **alone on the scrim** — no `bg-elevated` surface, no border, no
  padding, no title bar, no shadow-boxed card — with the conversation visible
  behind it. The scrim is `bg-scrim`, a per-theme role: it reads warm-grey at
  0.35 alpha in the six light themes and near-black at 0.6-0.65 in the dark ones,
  which is the reason a hardcoded black alpha is wrong here.
- The close button is a ghost `icon-sm` in the viewport's top-right corner, clear
  of the picture in both overlay frames (the picture's top edge is 234px down in
  `expanded`, and the button ends at 44px).
- **The close button carries a focus ring in every overlay frame.** That is
  Radix's modal autofocus landing on the first tabbable element inside the
  dialog, and this composition has exactly one — so it lands there. It is not
  new behaviour and not specific to this surface: the shared primitive's own
  story (`design-system-primitives--all-primitives`) shows the SAME ring on that
  dialog's **Cancel** button after a real mouse press on its trigger, driven in
  the same browser. Whether a mouse user should see it at all is a decision for
  the design round, and suppressing it means either autofocusing the layer's
  container (which rings the whole picture box instead) or overriding
  `onOpenAutoFocus` (which takes focus out of the dialog a modal is supposed to
  hold).

## The frames are one half of the evidence

Driven in the real browser too, on the running Storybook, with the `browser`
tool: a real mouse press on the picture in `in-thread` opens the overlay (the
full-page capture is what confirmed the focus ring above), and the browser tab
was closed afterwards. Pressing **Escape**, pressing the **scrim**, and pressing
the **close button** are asserted in `scripts/chat-image-expand.test.mjs`, which
also asserts focus returns to the picture and that the overlay carries an
accessible name.

**What no frame and no browser press here covers:** a real-engine pointer press
aimed at a POINT outside the picture. The `browser` tool clicks an element by
selector and cannot aim at a coordinate, and this surface's centre is the picture
— so the scrim press is evidenced by the element the press lands on (jsdom,
dispatched on the overlay) plus the measured geometry above that makes that
element genuinely outside the layer. Closing that last gap needs a
coordinate-capable harness; QA is the right place for it, and it is named here
rather than implied away.
