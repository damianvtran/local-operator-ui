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

These are the states that answer them. Two stories, ten states, twelve themes,
one hundred and twenty frames — and each state answers a different question:

| state | what it is | the question it answers |
| --- | --- | --- |
| `fit` | the overlay after a real press on the picture, controls awake | the chrome at rest — and, against `image-viewer-controls-before/fit`, exactly what this change drew |
| `resting` | the same press, then the reader stays off it past `SCROLLBAR_HOLD_MS` | the fade's landing state: the tuple claims the dimmed class at shutter, and the frame is the quiet state design round 1's D1-2 made reachable |
| `zoomed` | a press, then Zoom in — 2x | the zoom model: the frame stays the fitted box, the picture scales inside it, the crop is the CENTRE |
| `zoomed-panned` | a press, Zoom in, then a real DRAG toward the close button's corner | the pan: available only while zoomed, pointer-captured, and CLAMPED at the picture's own edge |
| `reset` | a press, Zoom in, then Reset view | the return — byte-identical to `fit` in all twelve themes, which is the strongest form this claim takes as a still |
| `carousel-open` | a press on a condensed strip's SECOND tile (a middle one) | the group opens ON the pressed picture — arrows, filmstrip, position — and the tuple claims the viewer's own `src` is that picture, so the frame cannot read as "opened the first" |
| `carousel-next` | the same press, then Next | the forward walk, landing on the picture with no bytes: the store's receipt, and the current ring FOLLOWING to the receipt's own slot |
| `carousel-leftwrap` | a press on the FIRST tile, then a real ArrowLeft | the walk WRAPS (left from the first lands on the last picture) |
| `wide-open` | a press on a group the strip cannot fit (ten tiles) | a strip longer than its viewport, the current at the left end |
| `wide-walk` | the same press, then Previous (wrap 1 -> 10; round-2 re-capture) | the walk's SCROLL: the strip scrolls the current into view, so the last slot is on screen with its ring and the first slots are off it |

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it. 6194 is what this set bound on the remediation pass
# (and its frames record it); 6190 was the first pass's port.
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm storybook --port 6194 --no-open

env -u XPC_FLAGS node scripts/capture-evidence.mjs http://localhost:6194 \
  --only=image-viewer-controls \
  --allow-backend
```

`--allow-backend` because something was listening on the schema's default
`http://localhost:1111` for the whole of this pass; nothing these stories render
talks to a backend (the pictures are `data:` URIs and the story column is local
JSX). `env -u XPC_FLAGS` because a tool child that inherits it cannot resolve DNS
on this host (measured; it breaks `getaddrinfo` in children).

The round-1 remediation of 2026-10-12 captured the full set (120 frames).
The current committed set retains 96 of those frames and replaces only the
24 wide-group frames in round 2, as documented below. What the round changed visually: the current ring's ROLE (the
slot mark moved from the tile's `border-control` edge to `ink` — design round
1's D1-1; see the measured table for why not `ink-muted`), the OPEN FOCUS
(D1-2/D1-3: the layer's anchor takes focus instead of the first control, so no
tile wears a ring the walk did not put there and the fade is reachable), the
strip's LANE (D1-4: a tall picture no longer sits under the strip), the strip's
own padding (D1-6: `px-2`, whose wider box the tables below measure), and three
new states (`resting`, from D1-2; `wide-open`/`wide-walk`, from D1-5). The
group fixture also gained its fourth picture (agent review round 1, R1-5), so
every carousel frame discriminates the pressed tile from the first.

The capture run asserted its claims at SHUTTER time, per tuple: `resting`
fails unless the cluster carries `opacity-45`; `carousel-open` fails unless the
viewer's own `<img>` carries the portrait fixture's base64 signature; the zoom
frames fail unless the picture's style carries `scale(2)`; `fit`/`reset` fail
if any `scale(` survives; every carousel frame fails without
`[data-image-filmstrip]` on screen. The run reported `Captured 120 frames`.

The first pass (2026-10-11) had run in three pieces — two viewer probes, the
full set, then a re-capture of the three `carousel-*` states after the frames
were taken, looked at, and the 2x6 speck fixture replaced with a phone-aspect
one. That narrative is superseded: the remediation pass re-shot every tuple
from the fixed tree.

## The chrome, measured from the frames

Every number below was measured off the committed `localOperatorDark` frames —
band colours classified against the fixture's own eight colours, edges by
transition columns/rows — not read back off the CSS:

| claim | measurement |
| --- | --- |
| the fitted picture is unchanged by this change | `fit` occupies rows 234..665 (432 rows) between x=64..1215; `image-viewer-controls-before/fit` measures the SAME rows and columns |
| the only pixels this change moves at rest | the diff between `image-viewer-controls-before/fit` and `fit` is 1,100 differing PIXELS (2,878 differing channel values), ALL of them inside one 86x20 box at +1174,+860 — the three cluster glyphs. No pixel anywhere else in the frame differs, which is the pair's whole point: the change adds chrome and moves nothing (QA round 1, Q-1: the earlier "subpixels" wording described the case wrong; the count was always the pixel count) |
| the cluster's lane | those glyphs sit at bottom-right (`fixed right-4 bottom-4`): the box ends at x=1259 against the frame's 1280, y=879 against 900 — 21px of clearance on the frame edge, clear of the picture, which ends at y=665 |
| the arrows | the chevron glyphs paint 24x20 at +24,+444 and 20x20 at +1244,+444 — vertically centred in the viewport (`top-0 bottom-0 my-auto`), which at this fixture's centring is also the picture's mid-line, and in the lane `PICTURE_BOX` reserves: the fitted picture leaves ≥64px on each side at this viewport |
| the filmstrip | painted content x394..885 (492 wide) inside its 508px box (`px-2 py-1` since D1-6), centred; four 117x78 slots at 8px gaps — three tiles and the receipt box — with tiles at y801..878 |
| the zoom crop | sampled along the picture's centre row (y=450): `fit` crosses all EIGHT fixture bands; `zoomed` crosses FOUR, the middle ones — the 2x crop is centred, and the box is the same one `fit` measured |
| the pan's clamp | `panned` crosses four bands with the FIRST band flush at x=64 — the picture's own left edge seated on the frame's, which is the clamp state, arrived at by a real press-drag through CDP input, HELD at the clamp (the rig's `drag` sends no release — agent review round 1, R1-4 — so the tuple's own comment calls it a held gesture). The drag target is the close button's corner: 610px right and ~420px up, both beyond the 2x limits (576, 216), so the frame is a clamp rather than a mid-gesture accident |
| the reset | `reset/<theme>.webp` is BYTE-IDENTICAL to `fit/<theme>.webp` — same sha256, in all twelve themes (`localOperatorDark`: `d1f16e87845736b1d544e55ed890af2c4ac5e6ac806fc86ea5c7ffdba06ec0b2`). After two presses that move the picture twice, the pixels are the fit state's, exactly |
| the switched picture (after the lane) | `carousel-open`'s portrait measures 230 columns at x525..754, rows 104..794 — the 400x1200 fixture at the box's 692px lane ceiling computes 230.7px wide, top (900-692)/2 = 104. Against the strip's tiles at y801 that leaves a 6px scrim gap: nothing of the picture is under chrome (design round 1's D1-4; the pre-fix number was 266 cols at x507..772 with its bottom 47px unrevealable) |
| the current RING (slot 2, `carousel-open`) | `ink` painted 1px outside the slot: per theme, `localOperatorLight` (35,29,20) = **6.43:1** vs its scrim (165,160,153), `sage` 6.02:1, `iceberg` **4.70:1**, the nine dark themes 13.08-18.59:1 (`localOperatorDark` 16.72:1). The role is `ink` and not `ink-muted` because the scrim dims whatever is open under it: measured over each of the eight state grounds' composites, `ink-muted` drops to 2.78:1 (kanagawaLotus over `sunken`) while `ink` clears every composite of every palette (worst 3.37:1, everforestLight over `sunken`) — and `scripts/contrast-contract.mjs` now asserts exactly that ("the lightbox's own ground", 59x8 = 472 assertions) |
| the current ring ON THE RECEIPT (`carousel-next`, slot 3) | the mark follows the walk onto a slot with no control: same role, same numbers — `localOperatorLight` (35,29,22) = 6.43:1, `sage` 6.09:1, `iceberg` 4.89:1, dark 13.42-18.59:1. The receipt's own border remains visible INSIDE the ring; the ring is the only cue that changes |
| the resting state is REAL, measured, not asserted by class alone | over the cluster's glyph pixels (208 in `localOperatorDark`, 74 in `localOperatorLight`), the mean deviation from the scrim falls to **0.435x / 0.452x** of the `fit` frame's — the paint is the 0.45 floor, and the tuple separately claimed `opacity-45` at shutter  Designer's round-2 decision: **KEEP 0.45**. Its independent stroke-core measurements were **3.41:1 dark enabled**, **1.68:1 light enabled**, disabled dark 1.42–1.48:1 (exempt). The light resting glyph is knowingly below the non-text floor: accepted as the requested scrollbar quiet-state pattern, with awake-on-open discoverability and activity restoring full strength in 0.12s. Source: [design round 2](https://github.com/damianvtran/local-operator-ui/pull/990#issuecomment-6117828097), not a new measurement claimed here. |
| the walk's SCROLL (`wide-*`, round-2 capture at 1280x720) | The port is x128..1152. Previous-wrap reveals slot 10 at x1034..1151 (117px), leaving its 1px ring inside the port: the side strokes paint at **x1033 and x1151**, y650. Next-wrap reveals slot 1 at x129..246, with its left ring at **x128**. Both ends have **1px border-box clearance**, measured in all twelve themes; `round2-wrap-geometry.json` records the browser's actual rects. The earlier x~1130..1151 caption named only a sample near the end, not the whole ring (D2-1). `scroll-mx-px` adds the ring's outset to `scrollIntoView`'s reveal geometry without changing tile layout. |
| the receipt | `carousel-next`'s card text paints 492x14 at +394,+443, centred — the store's sentence, at the size it is drawn, in the middle where the picture was |

## What each frame is evidence FOR, and what it cannot carry

- **The press is real.** Every overlay still is the result of real pointer input
  through CDP's pipeline — the picture pressed, then the controls pressed — and
  the tuples claim their state at shutter time: `zoomed`/`zoomed-panned` fail
  the run unless the viewer's own `<img>` carries `scale(2)` in its style;
  `fit`/`reset` fail if any `scale(` survives; every carousel state fails
  without `[data-image-filmstrip]` on screen.
- **The fade IS in these frames now, and the clock is still jsdom's.**
  `resting` is the post-hold state, claimed by class at shutter (`opacity-45`
  on the cluster), and the jsdom suite pins the cycle with committed cases:
  dim after the hold, wake on a bare `pointermove`, held awake while a control
  has focus. The earlier sentences here said "the jsdom suite mounts it" and
  "the paint is CSS" — agent review round 1's R1-1 measured that no committed
  case covered the fade at all, which is why the claim now names the case in
  `scripts/chat-image-expand.test.mjs` rather than a mount.
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
- **The current mark on a picture with no bytes.** The ring lives on the SLOT,
  so it survives the state the old mark could not: `carousel-next` walks onto
  the receipt and the receipt's own slot carries the ring (UX round 1's U1-1).
  `aria-current` stays a tile attribute — the receipt has no control, and the
  position is still announced (`Image 3 of 4`).
- **The keyboard.** `carousel-leftwrap` IS a real ArrowLeft key press (the walk
  wraps, so one frame carries both "left works" and "an end is not a dead
  end"). The original `wide-walk` used nine ArrowRights; its round-2 replacement
  uses the Previous button's wrap, the direct clipped-ring reproduction.
  The ArrowRight path is also pressed as the Next control in
  `carousel-next`; the arrow-key binding itself is asserted in jsdom, where a
  chord can be discriminated.
- **The story column behind the scrim** is `image-expand.stories.tsx`'s own
  Column (re-stated, same 810px measure): the conversation the overlay dims.

## What is NOT covered

- The focus ring's contrast over the scrim is not measured here: it remains a
  named follow-up (the contract's scrim block asserts the CURRENT ring; a
  focus-indicator pair over the scrim is the next row, design round 1's D1-1
  tail).
- No before frame exists for `zoomed`, `zoomed-panned` or `reset` individually:
  zoom does not exist at the base, so `image-viewer-controls-before/fit` IS the
  before of all three, and its README says so.
- No frame exercises a real media-relay fetch, a digest-cache miss, or a
  RESOLVING strip tile: the storybook pictures are inline `data:` URIs and the
  relay is not stood up for the stories; the reserved-box state is jsdom's (the
  tile whose bridge never settles).
- The `wide-*` frames stage ten tiles — the largest group this set carries. A
  group whose strip overflows a whole screenful is the same code path, asserted
  in jsdom rather than framed again.
- `zoomed-panned` photographs one clamp corner (the picture's left edge seated
  on the frame's); the other three corners are the same rule by symmetry,
  asserted in jsdom rather than framed four ways.
- A one-member group and a message-attachment/tool-row group are not stageable
  in Storybook (the story files carry no such fixtures); the count-decides case
  is a jsdom case.

## Round 2: endpoint clearance, browser-tool capture only

Q2-1/U2-1 reproduced live on `4fb6fe46e7f`: Previous from picture 1
revealed slot 10 with its right border at the port's right edge (1152), and
Next back to picture 1 put its left border at the port's left edge (128).
The 1px outset ring was clipped at both ends. The fix is `scroll-mx-px` on
every slot; the new test pins that reveal contract, while the actual browser
rects (not jsdom layout) prove 1px clearance at both endpoints.

Only **wide-open and wide-walk** were re-captured: 24 frames, twelve themes,
using one session-owned browser-tool tab and one owned Storybook server.
The other 96 frames remain round-1's 1280x900 frames; no full sweep, decoder,
app build or dependency installation ran. These 24 frames are **1280x720**
CSS pixels (the browser host screenshots are 2560x1440, normalised to CSS
pixels with Sharp and encoded as WebP at quality 85). They are not claimed to
be captures by `capture-evidence.mjs`'s 900px tuples.

```
# QA's shared server had been reaped, so this pass owned its replacement.
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  LOCAL_OPERATOR_UI_TELEMETRY=off LOCAL_OPERATOR_NO_NOTIFICATIONS=1 \
  pnpm storybook --port 6221 --no-open
```

For each theme, the browser tool navigated to:
`http://localhost:6221/iframe.html?id=image-viewer-controls--group-wide&viewMode=story&args=theme:<theme>`
and waited for the snapshot to expose `Expand Image 1` before acting:

1. Click `button[aria-label="Expand Image 1"]`; screenshot -> `wide-open/<theme>.webp`.
2. Click `button[aria-label="Previous image"]` (wrap 1 -> 10); read port and
   slot10 rects; assert `port.right - slot10.right >= 1`; screenshot ->
   `wide-walk/<theme>.webp`. This final capture uses the wrap button, not the
   earlier nine ArrowRights, because wrap is the discriminating reproduction.
3. Click `button[aria-label="Next image"]` (wrap 10 -> 1); read slot1 rect;
   assert `slot1.x - port.x >= 1`. Both margins compute to `1px`.

`round2-wrap-geometry.json` carries all twelve results. At y650 in the dark
before screenshot, right x1152 was scrim `(15,14,12)`; after the fix right
x1151 carries the ring `(217,214,207)`. The reverse-wrap left x128 changes
from tile fill `(25,24,25)` to ring `(217,214,206)`. The ring's entire
vertical stroke is visible in both after crops, not only the rounded corners.
All 24 frames were viewed in per-state contact sheets; the endpoint before/
after details were viewed at 3x. The tab and server/process children were
reaped. Console contained only the already-reported placeholder PostHog
404/401 requests; no viewer exception was observed.

## The pair

`docs/evidence/image-viewer-controls-before/` is the before half: the same two
surfaces rendered by unmodified `origin/main` at `7a392ecf943` — the overlay
without controls, and a strip tile's press opening one picture with no walk.
Its README carries the method and the worktree; the manifest declares it as a
supplementary set so the sweep's own count stays honest.
