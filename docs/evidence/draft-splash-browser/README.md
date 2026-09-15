# The settled New chat through the operator's own browser — the set at `4e0256d3f`

**These frames were all taken in one pass, at this rebase's head, in the instrument the
repository's rules require.** `after` is this branch at `4e0256d3f`; `before` is `32e3d04b4`
(= `origin/main`, this rebase's merge base) serving the same harness pages copied in
byte-for-byte — so the pair differs by the change under test and nothing else. The previous
generation of these files was a capture at `8f764cb83` and is gone: it was a different commit in
a different tree, and the branch's evidence check was red on its stamp half precisely because
those pixels could not honestly be re-stamped. They were re-taken instead.

The reference implementation of this set's instrument is the runbook the whole repository now
carries: **the `browser` tool driving the operator's paired Chromium (the Local Operator
extension over its loopback bridge)**. Nothing here came from a raw-CDP driver, a private
headless Chrome, a downloaded engine or a scripted screenshot path.
`scripts/draft-splash-capture.mjs` — the raw-CDP instrument the older generation in
`docs/evidence/draft-splash/` was taken with — is still retired and fail-closed, and was not
executed.

| | where | instrument | heads |
| --- | --- | --- | --- |
| **This set** | `docs/evidence/draft-splash-browser/` | the operator's paired browser via the Local Operator extension (`browser` tool), against an isolated mock backend | `after` = `4e0256d3f` (this branch), `before` = `32e3d04b4` (= `origin/main`, this rebase's merge base) |
| **The earlier set** | `docs/evidence/draft-splash/*.png`, `readback-*.json` | a private headless Chrome over raw CDP, through a harness of its own | `after` at pre-rebase heads, `before` at `ef40c81e2` |

The parent `README.md`'s prose and tables stay as they were written for the earlier set, with
its own numbers and its own caveats; they are a record of that generation, not of these frames.
Nothing in this directory re-stamps them, and the earlier PNGs were not overwritten or re-shot.

## What these frames are

A fresh **New chat** (a staged draft: `activeDraftKey` set, no session), settled, at the app's
own default window and at the three sizes the earlier set used — `1380x872`, `900x572`, `830x572`
(the narrowest column at the constrained height) and the minimum window `800x572`. Two
consecutive frames per state, so a pair that moves can be told apart from a still that does not.

The claim the pair is about: on a New chat the band carries the greeting and the suggestion
chips — or, at the minimum window, the compact composer the column's own width selects — and
**nothing anywhere in the document claims to be loading**. The `before` half is the defect as a
measurement: the same draft, the same sizes, three shimmer bars and a "Loading conversation…"
caption where the prompt belongs.

## The instrument, exactly

1. **An isolated backend.** `local-operator serve --host 127.0.0.1 --port 17970` with a
   throwaway `LOCAL_OPERATOR_CONFIG_DIR` and `HOME`, and `hosting: test` / `model_name: mock`, so
   a send settles without a network and without a token. A fresh 32-byte bearer is generated
   inside the launcher and exported into the three child processes only — it is never written to
   a file, printed, or reachable from the page. The operator's config, sessions and live browser
   state are untouched, and every inherited `CMUX_*`/`LOP_*` variable is scrubbed before any
   child starts.
2. **Two trees, one backend.** `after` is this branch's worktree at `4e0256d3f`; `before` is a
   worktree at `32e3d04b4` with **this branch's own harness pages copied in byte-for-byte**
   (`shasum -a 256` identical on all five files), so the pair differs by the change under test
   and nothing else. Each is served by its own Vite process (`15224` and `15225`) running
   `scripts/draft-splash-evidence.vite.mjs`, which registers the same `desktopProxyPlugin()` the
   app's own dev config does — so the renderer under the camera is the SHIPPED `ChatPage`, taking
   the same-origin `/__desktop` branch the product already ships for browser development. The
   bearer and the backend URL are read by the Vite process and never reach the page.
3. **The page under the camera.** `scripts/draft-splash-viewport.html` mounts the real `ChatPage`
   in a fixed-size same-origin iframe (`scripts/draft-splash-evidence.html`), so the frame's
   viewport — which the product reads as `window.innerWidth`/`innerHeight` — is the size under
   test.
4. **The shutter.** `browser` tool `screenshot` on the operator's own tab. It captures the whole
   window, and **the window measured 1728x906 CSS px in this pass** — 34px taller than the 872px
   frame at the app's default size, which is what makes `1380x872` photographable at all. The
   previous pass measured 817px and could not shoot that size; this pass's window was resized by
   the operator mid-session, and the 830x572 pair was shot before that resize with a 2880x1634
   window (572 < 817, so that crop is unaffected — its raw is recorded in the table below).
   `?capture=1` puts the frame at the viewport's own origin with the harness controls below the
   fold, so the crop is the frame's exact device-pixel box
   (`0, 0, width*dpr, height*dpr`, published as `frame.device` in every readback here) instead of
   a guess at the control height. Every frame is the 2x crop of that box downsampled to the app's
   own CSS pixel grid (`magick -crop <box> -resize <WxH>!`). Every pixel is a resample of a real
   render; no content is synthesised, and the pre-resize source is the browser's own PNG.
5. **The draft is staged through the product.** The sidebar's own **New chat** row is clicked (the
   store persists `activeDraftKey`, so the viewport iframe then loads with the draft already
   staged) — the state is not injected into the store, and the frame is not of a story. The
   `before` tree's draft was staged the same way in this pass, on its own origin.

### What the readbacks carry, and one thing they do not

Each `readback-<tree>-<size>.json` is the harness's own published readback for the state the
frames beside it are of: the frame's device box and `dpr`, **when the reading was taken** (`at`,
milliseconds since the harness mounted), the viewport, the focused element, the stack's box, every
chip's label and `disabled`/`aria-hidden`/computed `visibility`/rect, what the frame's own probe
OBSERVED, what this size EXPECTS, its verdict on each, and the **settlement record** — every
distinct layout the page showed with the span of readings that saw it, and whether the reading
that published the file was taken at least `settleWindowMs` (3000ms) after the last observed
layout change. `settled: true` in all eight, and `holds.all: true` on all four AFTER sizes.

**One field is `null` in all eight, and the reason is recorded in the files.**
`draft-splash-viewport.html` publishes `pageProbe` last as a single escaped JSON string exactly
so that a readback truncated by the reader's output budget still carries the geometry a crop
needs. This pass's reader had four of the eight reads cut inside that field by its budget; rather
than ship four files with it and four without, all eight carry `pageProbe: null` and a
`pageProbeNote`, and every field the table, the settlement record or the D2 check uses is a
top-level field of the file. The one reading that lived only there is `store.activeDraftKey`,
which this pass recorded directly: `draft:17fadb82-…` on the `after` origin, `draft:6bbef56d-…`
on the `before` origin, both with `activeSessionId: null`.

## The numbers — the readback's, and the frame's, kept apart

The previous version of this section published one set of numbers and presented it as both,
which is design round 5's D2: two of the four AFTER rows described a state the committed PNG
beside them did not paint. So the numbers are in two columns that cannot be confused — what the
`readback-*.json` files record, and what the committed frame actually paints.

**The frame column is measured off the PNGs**, not read from a file: for each frame, ImageMagick
writes the chat column (x 280 to the window's own width) as raw sRGB, and every row whose pixels
differ from the column's median colour by more than 24 summed over the three channels is ink. The
bands below are those runs, so a reader can re-derive any of them with the same two commands.
Glyph bands are ink; a readback's box is an element's bounding box, which insets its glyphs by
4-5px — that difference is what makes an apples-to-apples check possible.

| Tree | Size | Readback: band (y, h) · rows laid out/inside · composer (y, h) | Frame, measured: what is painted | Verdict |
| --- | --- | --- | --- | --- |
| after | 1380x872 | 104, 768 · 4 / 4 · 370, 278 | greeting glyphs 324-344; composer top 370; four whole rows 506-536 / 542-572 / 581-611 / 617-647 | **matches.** Composer top exact; the four rows within 1px of the chips' recorded rects (506 / 543.5 / 581 / 618.5) |
| after | 900x572 | 104, 468 · 7 / 5 · 185.3, 347.5 | greeting glyphs 140-160; composer top 184; five whole rows 352-382 / 391-421 / 427-457 / 466-496 / 502-532 | **matches.** Five rows painted, and the readback says why: 7 laid out, 5 painted, 2 inert — the capped chips sit at 540.75 and 578.25, below the stack box that ends at 532.8 |
| after | 830x572 | 104, 468 · 4 / 4 · 204, 310 | greeting glyphs 158-178; composer top 204; four rows 372-402 / 408-438 / 447-477 / 483-513 | **matches.** Composer top exact; rows within 1.5px of the recorded tops (372 / 409.5 / 447 / 484.5) |
| after | 800x572 | 104, 468 · no stack · 275, 124 | **no greeting, no chips, no stack**: one composer box 275-398, x-centred on the column | **matches.** The intended SMALL VIEW — the column is 520px, below `chat-content.tsx:343`'s 550px threshold — and the composer box is exact |
| before | 1380x872 | 736, 136 · no stack · 744, 112 | three shimmer bars 639-649 / 659-669 / 679-689; caption 706-718; composer 744-855 | matches |
| before | 900x572 | 404, 168 · no stack · 412, 144 | three shimmer bars 307-317 / 327-337 / 347-357; caption 374-386; composer 412-555 | matches |
| before | 830x572 | 404, 168 · no stack · 412, 144 | the same three bars, caption and composer bands | matches |
| before | 800x572 | 442, 130 · no stack · 444, 124 | three shimmer bars 351-361 / 369-379 / 387-397; caption 412-424; composer 444-567 | matches |

**D2 is discharged by construction, not by correction.** Each row above is one mount: the
readback was taken on the same page instance whose frame is committed beside it, and the
settlement record in the file says when and of what state. The one row that could still have gone
wrong is `after 800x572`, and it is worth stating exactly why, because it is the same failure
mode wearing a new coat: **the settlement predicate is a three-second quiet window, and on this
mount the column's container measurement landed later than that**, so an earlier read published
the splash (greeting + 5 chips) as `settled: true`. The committed frame is of the LAST state in
the settlement record — the compact composer — and the frame measurement above confirms it; the
splash is published as the middle of three states, with its span, rather than as the settled
reading. The instrument's quiet window can therefore be outrun by a late re-measure. That is a
recorded limitation of this probe, not this diff's surface, and the next pass should key the
predicate on the app's own measurement rather than on a timer.

The two columns that are NOT in the table, and why: the band's own top edge (104) is a DOM box and
no frame can be asked for it, because a band edge that paints no fill leaves no ink — what a frame
can be asked is the composer's top border, and every row above answers it; and `AE frame1→frame2`
is a property of the PAIR, re-measured here with `magick compare -metric AE`: **after 0 / 0 / 0 /
0**, **before 10,358 / 10,382 / 10,370 / 10,406**. The AFTER pairs are pixel-identical, so a still
is a picture of a settled state rather than of a moment inside a layout step; the BEFORE pairs
move because the pane's shimmer is an animation. Note that AE 0 is pixel stillness and says
nothing about the layout having stopped moving — which is exactly the `after 800x572` case above,
and the reason the instrument records settlement spans at all.

The raw shutter for each frame, before the crop, was 3456x1812 except the 830x572 AFTER pair,
whose two shutters were taken at 2880x1634 (the window was still 817px tall for that size) and
whose crop box is the same `1660x1144+0+0`.

## What this set does NOT show

- **The draft-to-session flip, or a cold real session's hold.** The pane's hold on a REAL session
  is deliberately unchanged by this branch, and this set does not stage one. The earlier set
  covers those states, with its own instrument and its own caveats.
- **Any state other than the settled draft.** No failure, no slow or cold hydration, no second
  theme: the harness has no theme control and this pass did not route through the app's picker.
- **The packaged app.** There is no Electron main process here and no IPC hop; `desktopRequest`
  reaches the backend by the browser-development branch it already ships. Every frame also carries
  the development-only `Chat|Raw` tab strip in the pane header (`chat-header.tsx`,
  `isDevelopmentMode`-gated), which does not exist in a packaged build — named here because an
  undeclared artefact reads as part of the app.
- **The window's own chrome or any other tab.** The shutter is the whole window and every frame is
  cropped to the frame's published device box, so nothing outside the frame is in the picture.

## Where this set is declared

`draft-splash-browser` is a declared `supplementary` set in `docs/evidence/manifest.json`, at
**0 frames** — the honest count for the sweep's `.webp`-only tally (`check-evidence.mjs`'s
`frames()` counts `.webp`; every frame here is PNG, as the sibling set's are). It is declared
rather than omitted because an undeclared directory is invisible to that gate, and because the
declaration is where a reader outside this session finds the instrument: `source`, `why`,
`capturedAt`, `capturedAtHead` and `capturedAtSrcTree` all name this capture — `capturedAtHead` is
`4e0256d3f` and `capturedAtSrcTree` its `src` tree `49e715140`, which is the same tree the
manifest's aggregate `srcTree`/`scriptsTree` carry, because the frames and the tree under review
are now the same commit. The entry sits beside `docs/evidence/draft-splash/` rather than inside it
because the gate refuses a declaration nested in another declared directory.

## Reproducing

The rig is documented in `~/draft-splash-recap-21131b0/STATE.md`, which is left running and
supervised for the pass that exercises this set next. In outline: start the isolated backend
(`local-operator serve`, `hosting: test` / `model_name: mock`, throwaway `HOME` and config dir,
bearer generated inside the launcher and exported into the children only), start one Vite per tree
with that bearer and backend URL supplied to those processes only, stage a draft by clicking the
product's own New chat row, then `goto .../draft-splash-viewport.html?size=<WxH>&capture=1`, wait
for `settlement.settled`, and shutter twice, reading `#readback` beside the shutters.

Four things about the rig are load-bearing and were learned across these passes:

- **Bind the loopback address literally.** Vite's default host is the string `localhost`, which
  node binds through the resolver and which this machine resolves to the IPv6 loopback; a browser
  that resolves `localhost` to `127.0.0.1` then gets `net::ERR_CONNECTION_REFUSED` from a page
  `curl` fetches fine. The harness config binds `127.0.0.1`, and every URL in this run is that
  literal.
- **The window must be taller than the frame.** The shutter is viewport-only. A 1380x872 frame
  needs at least 872 CSS px of window content; at 817px its bottom 55 rows are simply not in the
  picture, and two shutters cannot be composited into one frame because the before tree animates.
- **Wait on `settlement`, not on a sleep or on a populated band.** The probe publishes the
  distinct layouts it has seen with the span of readings that observed each, so a shutter can be
  taken when `settled` is true and the reading beside it is provably of the settled state — and,
  as `after 800x572` shows, a late re-measure can still invalidate a reading that said `settled`.
  Check the last published frame against the pixels before you publish a number.
- **`goto` on the viewport page times out often, and that is not a failure.** The page's `load`
  event waits on the harness iframe mounting the whole `ChatPage` (about 6s warm, up to 36s cold
  under a loaded host). The navigation completes anyway; `read` afterwards is what tells you
  whether the inner page has mounted. Navigating from a light same-origin page rather than opening
  the heavy one cold is what kept this pass's command path alive.
