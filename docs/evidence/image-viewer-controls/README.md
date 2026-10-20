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
| `reset` | a press, Zoom in, then Reset view | the return — byte-identical to `fit` in ten of the twelve themes; `neon`/`obsidian` differ only by raster noise (max 6/255), and the fitted box is the strongest form this claim takes as a still |
| `carousel-open` | a press on a condensed strip's SECOND tile (a middle one) | the group opens ON the pressed picture — arrows, filmstrip, position — and the tuple claims the viewer's own `src` is that picture, so the frame cannot read as "opened the first" |
| `carousel-next` | the same press, then Next | the forward walk, landing on the picture with no bytes: the store's receipt, and the current ring FOLLOWING to the receipt's own slot |
| `carousel-leftwrap` | a press on the FIRST tile, then a real ArrowLeft | the walk WRAPS (left from the first lands on the last picture) |
| `wide-open` | a press on a group the strip cannot fit (ten tiles) | a strip longer than its viewport, the current at the left end |
| `wide-walk` | the same press, then Previous (wrap 1 -> 10; round-2 re-capture) | the walk's SCROLL: the strip scrolls the current into view, so the last slot is on screen with its ring and the first slots are off it |

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it. 6217 is what this set bound on the 2026-10-20
# re-capture (and its frames record it); 6194 was the round-1 remediation's
# port; 6190 was the first pass's.
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm storybook --port 6217 --no-open

env -u XPC_FLAGS node scripts/capture-evidence.mjs http://localhost:6217 \
  --only=image-viewer-controls \
  --allow-backend \
  --theme-settle-ms=30000
```

The 120 frames are NOT committed: `capture-evidence.mjs` writes them to the
ignored `docs/evidence-frames/image-viewer-controls/<state>/<theme>.webp`, and
only this README, the proof JSONs beside it and the manifest stay tracked. A
fresh checkout has no frames until the rig is run.

`--allow-backend` because something was listening on the schema's default
`http://localhost:1111` for the whole of this pass; nothing these stories render
talks to a backend (the pictures are `data:` URIs and the story column is local
JSX). `env -u XPC_FLAGS` because a tool child that inherits it cannot resolve DNS
on this host (measured; it breaks `getaddrinfo` in children).
`--theme-settle-ms=30000` because the host carried a load average of 33 for this
pass and the shipped 10 s guard window is a 3-7x shortfall under that load (the
flag's own note; the frames are deterministic either way, only the first hit's
timing changes).

The round-1 remediation of 2026-10-12 captured the full set (120 frames); its
round 2 replaced only the 24 wide-group frames, and the 2026-10-20 pass replaced
**all 120 again** for the D1 plate on the shared chrome. That last pass shot at
`46042530e` with the command above and reported `Captured 120 frames`; every
file changed, because every close/nav/zoom control gained the
`bg-surface/85` ground, and the old frame was replaced in place (the tree holds
one frame per state). What the earlier rounds changed visually: the current
ring's ROLE (the slot mark moved from the tile's `border-control` edge to `ink` —
design round 1's D1-1; see the measured table for why not `ink-muted`), the OPEN
FOCUS (D1-2/D1-3: the layer's anchor takes focus instead of the first control,
so no tile wears a ring the walk did not put there and the fade is reachable),
the strip's LANE (D1-4: a tall picture no longer sits under the strip), the
strip's own padding (D1-6: `px-2`, whose wider box the tables below measure),
and three new states (`resting`, from D1-2; `wide-open`/`wide-walk`, from D1-5).
The group fixture also gained its fourth picture (agent review round 1, R1-5), so
every carousel frame discriminates the pressed tile from the first.

The round-2 remediation of PR #1259 (2026-10-20) moved the shared chrome's
resting fade from 0.45 to 0.85 (design round 2's D1) and re-shot **all 120
frames again** at `22d00362de`, with the command above; the `resting` tuple's
shutter claim names `opacity-85`. The pass is a re-capture, not a re-stamp: the
twelve `resting` frames changed, while 104 of the 120 came back BYTE-IDENTICAL
to the previous pass (`fit`, `zoomed`, `zoomed-panned`, `carousel-open`,
`carousel-leftwrap`, `wide-open` and `wide-walk` in all twelve themes). The
remaining four moved only by raster noise: `carousel-next` in
`localOperatorDark`/`localOperatorLight` (1,917 / 782 pixels, max 6/11 per
channel) and `reset` in `neon`/`obsidian` (2,231 / 7,028, max 4/6). The same
pass re-took the Library pair at the same head, two themes each:
`library-tab--media-lightbox` (8 frames) and `library-tab--preview-inline`
(18 frames). Six of the lightbox frames are byte-identical; the two
`media-lightbox-video` frames differ where the clip's decoded frame does (the
tuple makes no decoded-frame claim). The preview frames are pixel-identical to
their predecessors - one re-encode changed bytes only - which is the cheap
confirmation that the panel itself did not move.

The capture run asserted its claims at SHUTTER time, per tuple: `resting`
fails unless the cluster carries `opacity-85`; `carousel-open` fails unless the
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
| the only pixels the pair moves at rest | the diff between `image-viewer-controls-before/fit` and `fit` is **4,402 differing pixels** in `localOperatorDark` (**3,598** in `localOperatorLight`), ALL inside the right-edge control column x1164..1267: the close control's plate (36x36 at +1228,+12; 1,094 px dark / 918 light) and the bottom-right cluster's plate (104x40 at +1164,+852; 3,308 / 2,680). The picture and the page are byte-identical; the increase from the pre-plate 1,100 px is the D1 `surface/85` plate, not a geometry change (QA round 1, Q-1: the earlier "subpixels" wording described the case wrong; the count was always the pixel count) |
| the cluster's lane | those glyphs sit at bottom-right (`fixed right-4 bottom-4`): the glyph box ends at x=1259 against the frame's 1280, y=879 against 900 — 21px of clearance on the frame edge, clear of the picture, which ends at y=665. The cluster's plate boxes span 104x40 at +1164,+852 (13px/9px clearance); the plate moves neither the glyphs nor the picture |
| the arrows | the chevron glyphs paint 24x20 at +24,+444 and 20x20 at +1244,+444 — vertically centred in the viewport (`top-0 bottom-0 my-auto`), which at this fixture's centring is also the picture's mid-line, and in the lane `PICTURE_BOX` reserves: the fitted picture leaves ≥64px on each side at this viewport |
| the filmstrip | painted content x394..885 (492 wide) inside its 508px box (`px-2 py-1` since D1-6), centred; four 117x78 slots at 8px gaps — three tiles and the receipt box — with tiles at y801..878 |
| the zoom crop | sampled along the picture's centre row (y=450): `fit` crosses all EIGHT fixture bands; `zoomed` crosses FOUR, the middle ones — the 2x crop is centred, and the box is the same one `fit` measured |
| the pan's clamp | `panned` crosses four bands with the FIRST band flush at x=64 — the picture's own left edge seated on the frame's, which is the clamp state, arrived at by a real press-drag through CDP input, HELD at the clamp (the rig's `drag` sends no release — agent review round 1, R1-4 — so the tuple's own comment calls it a held gesture). The drag target is the close button's corner: 610px right and ~420px up, both beyond the 2x limits (576, 216), so the frame is a clamp rather than a mid-gesture accident |
| the reset | `reset/<theme>.webp` is BYTE-IDENTICAL to `fit/<theme>.webp` in **all twelve themes** at this pass (`localOperatorDark` sha256 `f6c69371ea9a1e6167a2788f1098a3138bb3ed63b1a8e855c468858b9e36d8ff`, the same bytes the previous pass committed). The previous pass's `neon`/`obsidian` pair differed only sub-perceptually (2,231 / 7,028 pixels, max **4/6** per channel, mean 1.18/1.45) across the picture bands and control antialiasing; this pass re-encoded those two frames onto the identical canvas, so the ten-of-twelve reading was host-side raster noise rather than a rendered move. |
| the switched picture (after the lane) | `carousel-open`'s portrait measures 230 columns at x525..754, rows 104..794 — the 400x1200 fixture at the box's 692px lane ceiling computes 230.7px wide, top (900-692)/2 = 104. Against the strip's tiles at y801 that leaves a 6px scrim gap: nothing of the picture is under chrome (design round 1's D1-4; the pre-fix number was 266 cols at x507..772 with its bottom 47px unrevealable) |
| the current RING (slot 2, `carousel-open`) | `ink` painted 1px outside the slot: per theme, `localOperatorLight` (35,29,20) = **6.43:1** vs its scrim (165,160,153), `sage` 6.02:1, `iceberg` **4.70:1**, the nine dark themes 13.08-18.59:1 (`localOperatorDark` 16.72:1). The role is `ink` and not `ink-muted` because the scrim dims whatever is open under it: measured over each of the eight state grounds' composites, `ink-muted` drops to 2.78:1 (kanagawaLotus over `sunken`) while `ink` clears every composite of every palette (worst 3.37:1, everforestLight over `sunken`) — and `scripts/contrast-contract.mjs` now asserts exactly that ("the lightbox's own ground", 59x8 = 472 assertions) |
| the current ring ON THE RECEIPT (`carousel-next`, slot 3) | the mark follows the walk onto a slot with no control: same role, same numbers — `localOperatorLight` (35,29,22) = 6.43:1, `sage` 6.09:1, `iceberg` 4.89:1, dark 13.42-18.59:1. The receipt's own border remains visible INSIDE the ring; the ring is the only cue that changes |
| the resting state is REAL, measured, not asserted by class alone | the cluster's pixels fade by a median per-pixel alpha of **0.838** in `localOperatorDark` and **0.837** in `localOperatorLight` against the `fit` frame (p5..p95 0.730-0.903 / 0.798-0.881, WebP noise around the 0.85 class; the previous 0.45 frames measure 0.441 / 0.430 by the same method), and the tuple separately claimed `opacity-85` at shutter. The D1 plate fades with the cluster: `localOperatorDark`'s plate reads 38,34,29 over its 14,12,11 scrim at awake and **35,31,25** at rest, with the glyph core 198,194,188 -> **167,164,158**, so the resting glyph-on-plate reading is **6.59:1** (light **5.81:1**); the enabled awake reading is **8.91:1 / 7.84:1**. The pre-plate stroke-core measurements were **3.41:1 dark enabled**, **1.68:1 light enabled**, disabled dark 1.42–1.48:1 (exempt). Designer's round 2 (PR #1259) measured 0.85 as the floor that clears 3:1 on all 59 palettes and superseded the earlier KEEP 0.45 decision; the per-theme table below is this pass's measurement. |
| the D1 plate's ground | every close/nav/zoom control carries `bg-surface/85` (`CHROME_PLATE`); the enabled glyph is `ink-muted`. Measured from the frames in `docs/evidence-frames/image-viewer-controls/`: plate **38,34,29** over the **14,12,11** scrim, glyph core **198,194,188** -> **8.91:1 awake / 6.59:1 resting** in `localOperatorDark`; plate **236,233,225** over **165,160,153**, glyph **73,69,64** -> **7.84:1 / 5.81:1** in `localOperatorLight`. Over the WORST ground a picture can put under the plate (the plate blended over pure white and pure black, the D1 method), the enabled glyph reads **4.32-6.51:1 awake** and **3.20-5.44:1 resting** across the twelve themes — per-theme table below. |
| the walk's SCROLL (`wide-*`, round-2 capture at 1280x720) | The port is x128..1152. Previous-wrap reveals slot 10 at x1034..1151 (117px), leaving its 1px ring inside the port: the side strokes paint at **x1033 and x1151**, y650. Next-wrap reveals slot 1 at x129..246, with its left ring at **x128**. Both ends have **1px border-box clearance**, measured in all twelve themes; `round2-wrap-geometry.json` records the browser's actual rects. The earlier x~1130..1151 caption named only a sample near the end, not the whole ring (D2-1). `scroll-mx-px` adds the ring's outset to `scrollIntoView`'s reveal geometry without changing tile layout. |
| the receipt | `carousel-next`'s card text paints 492x14 at +394,+443, centred — the store's sentence, at the size it is drawn, in the middle where the picture was |

### The D1 plate, per theme

Each row is the enabled glyph (`ink-muted`) on the `surface/85` plate, with the
plate composited over the worst ground a picture can put under it (pure white or
pure black, whichever measures lower — the method in `image-lightbox.tsx`'s D1
note). "Frame" is the same glyph on the plate in the committed frame, whose
actual ground is the lightbox scrim. Values are WCAG contrast ratios measured
2026-10-20 at `22d00362de` from this pass's frames; the disabled step
(`ink-disabled`) is exempt and is not what this table measures. The awake
figure is the state `fit` photographs (byte-identical to the previous pass, so
its values are unchanged); the resting figure applies the cluster's
`opacity-85` to both the plate and the glyph, the state `resting` photographs.

| theme | worst-ground awake | worst-ground resting | frame awake | frame resting |
| --- | --- | --- | --- | --- |
| `localOperatorDark` | 4.85:1 (white) | 3.52:1 (white) | 8.91:1 | 6.59:1 |
| `localOperatorLight` | 5.80:1 (black) | 4.95:1 (black) | 7.84:1 | 5.81:1 |
| `dracula` | 4.32:1 (white) | 3.20:1 (white) | 7.83:1 | 5.86:1 |
| `dune` | 4.86:1 (white) | 3.52:1 (white) | 8.79:1 | 7.06:1 |
| `sage` | 6.20:1 (black) | 5.24:1 (black) | 8.47:1 | 6.24:1 |
| `monokai` | 4.55:1 (white) | 3.34:1 (white) | 7.87:1 | 6.28:1 |
| `tokyoNight` | 5.24:1 (white) | 3.76:1 (white) | 9.20:1 | 7.42:1 |
| `iceberg` | 6.51:1 (black) | 5.44:1 (black) | 8.55:1 | 6.52:1 |
| `radient` | 5.77:1 (white) | 4.06:1 (white) | 9.91:1 | 8.04:1 |
| `neon` | 5.03:1 (white) | 3.62:1 (white) | 8.92:1 | 6.97:1 |
| `obsidian` | 5.16:1 (white) | 3.70:1 (white) | 9.27:1 | 6.93:1 |
| `synth` | 5.15:1 (white) | 3.70:1 (white) | 8.95:1 | 6.85:1 |

The awake numbers clear the 3:1 non-text floor on every theme even at the
worst-ground bound, which is the D1 fix. The resting numbers now clear it too:
the worst-ground bound is **3.20:1** (`dracula` over white) and the worst frame
reading **5.81:1** (`localOperatorLight`), both measured at this pass. 0.85 is
the measured threshold rather than a taste call - over all 59 selectable
palettes the worst composite is **3.05493:1** (`nightfox` over white), the
limiting alpha is **~0.84022**, and 0.80 fails (`nightfox` 2.788:1, `dracula`
2.915:1, `synthwave` 2.901:1). The fade stays because a resting state must
still read as a step down from awake; it now stops above the floor instead of
under it. Re-derive the number if the plate stops being `surface/85` - the two
compose, and a different plate moves the threshold.

## What each frame is evidence FOR, and what it cannot carry

- **The press is real.** Every overlay still is the result of real pointer input
  through CDP's pipeline — the picture pressed, then the controls pressed — and
  the tuples claim their state at shutter time: `zoomed`/`zoomed-panned` fail
  the run unless the viewer's own `<img>` carries `scale(2)` in its style;
  `fit`/`reset` fail if any `scale(` survives; every carousel state fails
  without `[data-image-filmstrip]` on screen.
- **The fade IS in these frames now, and the clock is still jsdom's.**
  `resting` is the post-hold state, claimed by class at shutter (`opacity-85`
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
- **Partial loading:** this set's third picture has no bytes/ref and draws
  the receipt. The new companion [image-viewer-demand](../image-viewer-demand/README.md)
  set stages resolving cold digests through a counted, delayed synthetic media
  bridge: visible/current/wrapped-neighbour demand, deferred distant slots,
  pending selection and stable strip geometry. It is not a deployed relay claim.
  Every known slot remains; only eligible cold tiles mount the existing resolver.
  The previous eager-all-known implementation is superseded, not called lazy.
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
- **The shared chrome's plate (D1, PR #1259's round-1 remediation).** Every
  close/nav/zoom control paints `bg-surface/85` under its glyph. It is visible
  in every frame that draws the chrome — the close button at the top-right, the
  arrows in their lane, the bottom-right cluster — and it fades with the
  cluster in `resting`. The per-theme table above is the measurement; the pair's
  `fit` diff is confined to those plate boxes, so the change adds a ground and
  moves nothing.

## What is NOT covered

- The focus ring's contrast over the scrim is not measured here: it remains a
  named follow-up (the contract's scrim block asserts the CURRENT ring; a
  focus-indicator pair over the scrim is the next row, design round 1's D1-1
  tail).
- No before frame exists for `zoomed`, `zoomed-panned` or `reset` individually:
  zoom does not exist at the base, so `image-viewer-controls-before/fit` IS the
  before of all three, and its README says so.
- These historical frames use inline data and a missing entry. The companion
  demand set adds cold cache misses/resolving strips via a synthetic counted
  media bridge, not an actual daemon/remote media relay. That real-network path
  remains unverified.
- The `wide-*` frames stage ten tiles — the largest group this set carries. A
  group whose strip overflows a whole screenful is the same code path, asserted
  in jsdom rather than framed again.
- `zoomed-panned` photographs one clamp corner (the picture's left edge seated
  on the frame's); the other three corners are the same rule by symmetry,
  asserted in jsdom rather than framed four ways.
- A one-member group and a message-attachment/tool-row group are not stageable
  in Storybook (the story files carry no such fixtures); the count-decides case
  is a jsdom case.
- The D1 plate's **disabled** step (`ink-disabled` on the same plate) is not in
  the per-theme table: the contract exempts disabled text from the non-text
  floor, and `fit`'s zoom-out/Reset are the disabled state in the frame.

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
