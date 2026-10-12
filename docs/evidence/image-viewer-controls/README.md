# Image viewer controls and carousel — chrome over the scrim, and a group you can walk

The operator's report of 2026-10-11, two asks in one surface:

> (2) CONTROLS WHILE ZOOMED IN — "the image lightbox/zoom view has no controls.
> Add sensible zoomed-state controls: zoom in/out (and reset to fit), pan/drag,
> and close — discoverable, not hover-only-hidden. ..."
>
> (3) GROUP CAROUSEL / FILMSTRIP — "when clicking one image, provide LEFT/RIGHT
> navigation WITHIN the image's group, plus a COLLAGE (thumbnail strip/filmstrip)
> of the OTHER images in that group ... The carousel should operate over the
> images within the same group/turn, not the whole conversation. Keyboard
> support: arrow keys (and Esc to close). ..."

These are the states that answer them. Two stories, seven states, twelve themes,
eighty-four frames — and each state answers a different question:

| state | what it is | the question it answers |
| --- | --- | --- |
| `fit` | the overlay after a real press on the picture, controls awake | the chrome at rest — and, against `image-viewer-controls-before/fit`, exactly what this change drew |
| `zoomed` | a press, then Zoom in — 2x | the zoom model: the frame stays the fitted box, the picture scales inside it, the crop is the CENTRE |
| `zoomed-panned` | a press, Zoom in, then a real DRAG to the close button's corner | the pan: available only while zoomed, pointer-captured, and CLAMPED at the picture's own edge |
| `reset` | a press, Zoom in, then Reset view | the return — byte-identical to `fit` in all twelve themes, which is the strongest form this claim takes as a still |
| `carousel-open` | a press on a condensed strip's first tile | the group opens ON the pressed picture: arrows, filmstrip, position |
| `carousel-next` | the same press, then Next | switching, and the current mark moving between tiles |
| `carousel-leftwrap` | the same press, then a real ArrowLeft | the walk WRAPS (left from the first lands on the last), and the picture without bytes answers with the store's own receipt |

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it. 6190 is what this set bound, confirmed on the banner.
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm storybook --port 6190 --no-open

env -u XPC_FLAGS node scripts/capture-evidence.mjs http://localhost:6190 \
  --only=image-viewer-controls \
  --allow-backend
```

`--allow-backend` because something was listening on the schema's default
`http://localhost:1111` for the whole of this pass; nothing these stories render
talks to a backend (the pictures are `data:` URIs and the story column is local
JSX). `env -u XPC_FLAGS` because a tool child that inherits it cannot resolve DNS
on this host (measured; it breaks `getaddrinfo` in children).

The pass was run in three pieces, and the frames on disk are the LAST of each:
the two viewer probes (one theme each) that proved the story rendered and the
press landed; the full 12-theme set; then a re-capture of the three `carousel-*`
states, because the first group frames were TAKEN, LOOKED AT, and found wanting —
the story's second picture was the sibling set's 2x6 fixture, and the overlay's
fit rule (correctly) renders a 2x6 image as a two-by-six-pixel speck, which is
useless as a frame for "the carousel switched". The fixture was re-drawn as a
400x1200 phone-aspect picture and the three group states re-taken; no speck
frame is committed. The `carousel-*` frames therefore carry the last group
capture, and `reset` byte-identity below was verified across the final set.

## The chrome, measured from the frames

Every number below was measured off the committed `localOperatorDark` frames —
band colours classified against the fixture's own eight colours, edges by
transition columns/rows — not read back off the CSS:

| claim | measurement |
| --- | --- |
| the fitted picture is unchanged by this change | `fit` occupies rows 234..665 (432 rows) between x=64..1215; `image-viewer-controls-before/fit` measures the SAME rows and columns |
| the only pixels this change moves at rest | the diff between `image-viewer-controls-before/fit` and `fit` is 1,100 differing subpixels, ALL of them inside one 86x20 box at +1174,+860 — the three cluster glyphs. No pixel anywhere else in the frame differs, which is the pair's whole point: the change adds chrome and moves nothing |
| the cluster's lane | those glyphs sit at bottom-right (`fixed right-4 bottom-4`): the box ends at x=1259 against the frame's 1280, y=879 against 900 — 21px of clearance on the frame edge, clear of the picture, which ends at y=665 |
| the arrows | the chevron glyphs paint 24x20 at +24,+444 and 20x20 at +1244,+444 — vertically centred in the viewport (`top-0 bottom-0 my-auto`), which at this fixture's centring is also the picture's mid-line, and in the lane `PICTURE_BOX` reserves: the fitted picture leaves ≥64px on each side at this viewport |
| the filmstrip | 374x88 at +454,+796, centred (its three 117x78 tiles: 3x117 + 2x8 gap + p-1 = 375), below the picture at this fixture's aspect |
| the zoom crop | sampled along the picture's centre row (y=450): `fit` crosses all EIGHT fixture bands; `zoomed` crosses FOUR, the middle ones — the 2x crop is centred, and the box is the same one `fit` measured |
| the pan's clamp | `panned` crosses four bands with the FIRST band flush at x=64 — the picture's own left edge seated on the frame's, which is the clamp state, arrived at by a real drag (press-drag-release through CDP input). The drag target is the close button's corner: 610px right and ~420px up, both beyond the 2x limits (576, 216), so the frame is a held clamp rather than a mid-gesture accident |
| the reset | `reset/<theme>.webp` is BYTE-IDENTICAL to `fit/<theme>.webp` — same sha256, in all twelve themes (`localOperatorDark`: `d1f16e87845736b1d544e55ed890af2c4ac5e6ac806fc86ea5c7ffdba06ec0b2`). After two presses that move the picture twice, the pixels are the fit state's, exactly |
| the switched picture | `carousel-next`'s portrait measures 266 columns at x=507..772 with its top edge at y=52 — the 400x1200 fixture at the box's 796px ceiling computes 265.3px wide, and the ±1 column is the mask's blend edge |
| the receipt | `carousel-leftwrap`'s card text paints 492x14 at +394,+443, centred — the store's sentence, at the size it is drawn, in the middle where the picture was |

## What each frame is evidence FOR, and what it cannot carry

- **The press is real.** Every overlay still is the result of real pointer input
  through CDP's pipeline — the picture pressed, then the controls pressed — and
  the tuples claim their state at shutter time: `zoomed`/`zoomed-panned` fail
  the run unless the viewer's own `<img>` carries `scale(2)` in its style;
  `fit`/`reset` fail if any `scale(` survives; every carousel state fails
  without `[data-image-filmstrip]` on screen.
- **The fade is NOT in these frames, by design.** The controls rest awake in
  every still; after `SCROLLBAR_HOLD_MS` of idleness they dim to the resting
  floor (`opacity-45`, the scrollbar fade's own idle state) and return on
  pointer, key or focus activity. That is a clocked behaviour a still cannot
  carry — the jsdom suite mounts it, the paint is CSS, and `fit` is the awake
  half every reader compares against.
- **The zoom/pan arithmetic is jsdom's, and deliberately so.** The ladder
  (1x, 2x, 3x, 4x), the clamp's range, and the reset's recentring are pure
  functions (`shared/lib/image-viewer-model.ts`) asserted directly; the frames
  photograph the states those rules produce, at 2x, where the crop is legible.
- **Partial loading is staged the one honest way available here.** The third
  picture has NO bytes and no attachment — a fact, not a race — so its strip
  slot and its selected state both draw the receipt. A tile that is RESOLVING
  (bytes in flight against the media relay) is not photographable from
  Storybook without standing up the relay; the strip's reserved-box state is
  instead covered by `scripts/chat-image-expand.test.mjs` (the tile whose bridge
  never settles).
- **The current mark on a picture with no bytes.** When the walk lands on the
  receipt, the receipt slot has no control to carry `aria-current`, so the mark
  cannot appear there; the position is still announced (`Image 3 of 3`) and the
  arrows still walk. The `carousel-leftwrap` frame shows exactly this, and it is
  the one state where "the current one is marked" is satisfied by the live
  region alone.
- **The keyboard.** `carousel-leftwrap` IS a real ArrowLeft key press (the walk
  wraps, so one frame carries both "left works" and "an end is not a dead end").
  The ArrowRight path is pressed as the Next control in `carousel-next`; the
  arrow-key binding itself is asserted in jsdom, where a chord can be
  discriminated.
- **The story column behind the scrim** is `image-expand.stories.tsx`'s own
  Column (re-stated, same 810px measure): the conversation the overlay dims.

## What is NOT covered

- No frame tests the controls' fade return after inactivity (behaviour; above).
- No before frame exists for `zoomed`, `zoomed-panned` or `reset` individually:
  zoom does not exist at the base, so `image-viewer-controls-before/fit` IS the
  before of all three, and its README says so.
- No frame exercises a real media-relay fetch, a digest-cache miss, or a group
  larger than the strip's cap (the strip scrolls; the frames' three tiles do
  not scroll).
- `zoomed-panned` photographs one clamp corner (left-bottom of the picture
  visible); the other three corners are the same rule by symmetry, asserted in
  jsdom rather than framed four ways.

## The pair

`docs/evidence/image-viewer-controls-before/` is the before half: the same two
surfaces rendered by unmodified `origin/main` at `7a392ecf943` — the overlay
without controls, and a strip tile's press opening one picture with no walk.
Its README carries the method and the worktree; the manifest declares it as a
supplementary set so the sweep's own count stays honest.
