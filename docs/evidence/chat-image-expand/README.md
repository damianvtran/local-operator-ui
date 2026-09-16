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
  the same browser. **UX round 1 settled what it is**: opening the overlay with a
  real pointer press in the built app leaves the close button focused with
  `outline: none`, and the ring appears only once Tab is pressed — so the ring in
  these frames is an artifact of the story pressing the picture programmatically
  (`button.click()`, which Blink treats as keyboard-ish for `:focus-visible`), not
  something a mouse user sees. It is recorded as REJECTED on that measurement
  rather than re-captured, and the story's press is left as it is because a
  synthetic click is the only press a story can make.

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
rather than implied away. **QA round 1 closed it** with `Input.dispatchMouseEvent`
at hit-tested coordinates (4,4) down to 400x300 — see that round's report; the
frames here still do not carry it.

---

# Round 1 of the review, and what it changed here

Four rounds came back on the first cut of this work (agent review, design, UX,
QA) and six findings were about the EVIDENCE rather than the code. This section
is the record of a second pass: what was re-taken, what was added, and the
numbers each new frame carries. Everything below was measured off the committed
frames on this machine; nothing is read back off the CSS.

## The sets, after the remediation

Nine tuples now, twelve themes each, and the tuples that are the SAME story are
listed as such because they are one surface in several states rather than
several surfaces:

| story / state | what it is | the finding it answers |
| --- | --- | --- |
| `in-thread` | the picture as the message view draws it | what the press acts on |
| `expanded` | the picture fitted to the viewport, over the scrim | the overlay, and the margin |
| `expanded-small-image` | a 240x180 picture in the same overlay | the size rule |
| `expanded-near-viewport` | a 1440x1014 picture — the viewport's own aspect (1.4201 against 1280x900's 1.4222) | design D1-3, QA Q-5: the band where the close button's ring and the picture's corner collide |
| `expanded-portrait` | 828x1792, the phone-aspect capture `image-attachment.tsx` names as a real input | design D1-3, QA Q-5: the other end of the fit |
| `expanded-small-window` | the `expanded` story at 800x760, the smallest shape the app enforces | QA Q-5 |
| `expanded-failed` | the overlay on a source the decoder refuses (`data:image/png;base64,bm90LWEtcG5n`) | review R1-4, QA Q-1: the failure state |
| `legacy` | a path-named picture, its file actions hidden | design D1-4/D1-5: the resting row |
| `legacy-hovered` | the same, under a real pointer | design D1-4: the pointer reveal |
| `legacy-tabbed` | the same, focused by real Tab presses | review R1-1: keyboard reach |
| `legacy-tabbed-open` | the same, then Enter | review R1-1: keyboard ACTIVATION |

`legacy-*` are one story driven four ways by the rig, and `expanded-failed`
carries its own latch: its story withholds the shutter until the failure copy is
painted, so a frame of an overlay whose picture merely had not decoded yet cannot
ship — the capture throws instead.

## The close button's clearance, measured (design D1-3, QA Q-5)

The finding was arithmetic: the button is a 28px box 16px from the top and right,
its ring reaches 48px from each edge, and a picture fitted to a bare `90vh` leaves
`0.05 x 900 = 45px` — so at the viewport's own aspect the ring crosses the
picture's corner. The fit box is now
`max-h-[min(90vh,calc(100vh-104px))] max-w-[min(90vw,calc(100vw-104px))]`, which
takes the button's lane off each axis and guarantees a margin of
`min(5% of the axis, 52px)` — 52 clears 48 by 4px at every viewport the app
allows, and 5% still wins on any axis 1040px or longer (both axes of the default
1380x900 window).

Measured off the committed frames, with the 48px ring reach as the reference:

| frame | viewport | measured picture | margins | clearance to the ring |
| --- | --- | --- | --- | --- |
| `expanded-near-viewport` | 1280x900 | **1132x796 at +74,+52** | 74/74, 52/52 | **+4px on the top edge**, +26px on the right |
| `expanded-portrait` | 1280x900 | **633x796 at +191,+52** | 191/455, 52/52 | +4px top, +441px right |
| `expanded-small-window` | 800x760 | **696x261 at +52,+250** | 52/52, 250/249 | +202px top, **+4px right** |
| `expanded` (the round-1 control) | 1280x900 | **1152x432 at +64,+234** | 64/64, 234/234 | +186px top, +16px right |

The last row is the control that validates the measurement: it reproduces the
round-1 numbers to the pixel (1152x432 at +64,+234). A picture at the viewport's
own aspect used to leave 45px; it now leaves 52, and the frame shows the ring
outside the picture's corner rather than across it.

## The failure state, measured (review R1-4, QA Q-1)

QA induced the old failure and measured the layer collapsing to **1152x38** — a
strip of label text on an empty scrim, for a canonical row the single word
"Screenshot". The overlay now draws the caller's own `BrokenAttachment` inside a
reserved box (`min-h-16 min-w-64` plus the layer's padding), and the frame
measures **549x57 at +364,+423** in `localOperatorDark` and **548x52 at
+364,+428** in `iceberg` — centred on both axes, carrying the icon and the store's
own sentence ("Screenshot could not be displayed. Its stored copy is not
available to this reader."), which is the copy the transcript uses for a digest
rather than the on-disk "moved, renamed, or deleted" sentence.

This is the assertion for that state, and it is a frame rather than a test on
purpose: **jsdom cannot be made to report an image error without leaving a
failing task behind** (measured five ways in `scripts/chat-image-expand.test.mjs`,
where the note is). What the test asserts instead is the precondition the state
rests on — a canonical picture with no bytes is not a button at all, so it cannot
open this overlay.

## The resting row, before and after (design D1-5)

`docs/evidence/chat-image-expand-before/` is a declared supplementary set: the
same story, the same fixture, the same 1280x900 viewport, rendered by
`origin/main`'s own `ImageAttachment` in a base worktree. Its README carries the
method.

The pair answers D1-5's question, and the answer is that the row DID change
shape — but not in this round, and not in the picture:

- **this round did not move it**: the re-taken `in-thread` frame is
  geometry-identical to the round-1 commit (the picture's edges measure 208-825 at
  y=300 in both, and in all four themes re-checked), which is why the drift below
  is raster-only;
- **the round-1 diff did**: against the base, the card's own width changed. On
  `origin/main` the legacy attachment is a **900px-wide** `sunken` card with the
  picture (632px) centred inside it; on this branch the card is **632px wide** and
  sits at the column's left edge. The `div` -> `button` swap is what did it (a
  button shrink-wraps where a block `div` filled the column).
- That makes the legacy surface agree with the CANONICAL one, which has always
  hugged its picture (`canonical-image.tsx` wraps it in `inline-block`), so it is
  a consistency gain rather than obviously a regression — but it is a silent
  change to a reviewed surface and the design round owns the call, so it is
  measured here rather than argued: the frame pair is the evidence, and the
  decision is a class on the wrapper either way.

## What the re-take changed in the existing frames (review R1-2's convergence)

The branch was merged with `origin/main` (`3f1f4e5a3`, which had moved BOTH `src/`
and `scripts/`), and the three round-1 stories were re-captured on the merged
tree rather than re-stamped on trust. Byte-comparison against their committed
copies, per frame:

- **24 of 36 are byte-identical**;
- **12 differ**, and every one of them differs ONLY inside the picture's own box
  (`expanded/monokai` 199 px, `expanded/neon` 1851, `expanded/radient` 7374,
  `expanded-small-image/{dune,localOperatorLight,obsidian,sage,synth}` 105-4089,
  `in-thread/{dracula,iceberg,neon,radient}` 673-14478) — AE 105 to 14,478 pixels
  of 1,152,000 (0.01% to 1.3%), RMSE <= 0.1% in every case, and the card's own
  measured edges are identical in each theme re-checked. That is re-rasterisation
  of the scaled `<img>`, not a layout, token or geometry change: same class as QA
  round 1's Q-6, and the same reason the round-1 note records a re-take rather
  than an argument.

The `in-thread`/`expanded`/`expanded-small-image` frames are therefore
pixel-current on the merged tree, and the rest of the set is new work.
