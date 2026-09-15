# The settled New chat through the operator's own browser — the set at `c5b5b67ed`

**These frames were all taken in one pass, at this rebase's head, in the instrument the
repository's rules require.** `after` is this branch rebased onto `origin/main` `c5b5b67ed`
(#164's session-code-memory work); `before` is `c5b5b67ed` itself, serving the same harness pages
copied in byte-for-byte — so the pair differs by the change under test and nothing else. The
previous generation of these files was a capture at the rebase before this one, and it was
re-taken rather than carried forward precisely because #164's delta touches
`chat-content.tsx` and `chat-page.tsx`, two of the files the band is composed from: a
carried-forward half would have been a picture of a composer this branch no longer has.

The reference implementation of this set's instrument is the runbook the whole repository now
carries: **the `browser` tool driving the operator's paired Chromium (the Local Operator
extension over its loopback bridge)**. Nothing here came from a raw-CDP driver, a private
headless Chrome, a downloaded engine or a scripted screenshot path.
`scripts/draft-splash-capture.mjs` — the raw-CDP instrument the older generation in
`docs/evidence/draft-splash/` was taken with — is still retired and fail-closed, and was not
executed.

| | where | instrument | heads |
| --- | --- | --- | --- |
| **This set** | `docs/evidence/draft-splash-browser/` | the operator's paired browser via the Local Operator extension (`browser` tool), against an isolated mock backend | `after` = this branch rebased onto `c5b5b67ed`, `before` = `c5b5b67ed` (= `origin/main`, this rebase's merge base) |
| **The earlier set** | `docs/evidence/draft-splash/*.png`, `readback-*.json` | a private headless Chrome over raw CDP, through a harness of its own | `after` at pre-rebase heads, `before` at `ef40c81e2` |

The parent `README.md`'s prose and tables stay as they were written for the earlier set, with its
own numbers and its own caveats; they are a record of that generation, not of these frames.
Nothing in this directory re-stamps them, and the earlier PNGs were not overwritten or re-shot.

## What these frames are

A fresh **New chat** (a staged draft: `activeDraftKey` set, no session), settled, at the app's own
default window and at the three sizes the earlier set used — `1380x872`, `900x572`, `830x572` and
the minimum window `800x572`. Two consecutive frames per state, so a pair that moves can be told
apart from a still that does not.

The claim the pair is about: on a New chat the band carries the greeting and the suggestion chips —
or, at the minimum window, the compact composer the column's own width selects — and **nothing
anywhere in the document claims to be loading**. The `before` half is the defect as a measurement:
the same draft, the same sizes, three shimmer bars and a "Loading conversation…" caption where the
prompt belongs, at every size including the minimum window.

## The instrument, exactly

1. **An isolated backend.** `local-operator serve --host 127.0.0.1 --port 17970` with a throwaway
   `LOCAL_OPERATOR_CONFIG_DIR` and `HOME`, and `hosting: test` / `model_name: mock`, so a send
   settles without a network and without a token. A fresh 32-byte bearer is generated inside the
   launcher and exported into the three child processes only — it is never written to a file,
   printed, or reachable from the page. The operator's config, sessions and live browser state are
   untouched, and every inherited `CMUX_*`/`LOP_*` variable is scrubbed before any child starts.
2. **Two trees, one backend.** `after` is this branch's worktree at this rebase's tip; `before` is
   a worktree at `c5b5b67ed` with **this branch's own harness pages copied in byte-for-byte**
   (`shasum -a 256` identical on all five files), so the pair differs by the change under test and
   nothing else. Each is served by its own Vite process (`15224` and `15225`) running
   `scripts/draft-splash-evidence.vite.mjs`, which registers the same `desktopProxyPlugin()` the
   app's own dev config does — so the renderer under the camera is the SHIPPED `ChatPage`, taking
   the same-origin `/__desktop` branch the product already ships for browser development. The
   bearer and the backend URL are read by the Vite process and never reach the page.
3. **The page under the camera.** `scripts/draft-splash-viewport.html` mounts the real `ChatPage`
   in a fixed-size same-origin iframe (`scripts/draft-splash-evidence.html`), so the frame's
   viewport — which the product reads as `window.innerWidth`/`innerHeight` — is the size under
   test.
4. **The shutter.** `browser` tool `screenshot` on the operator's own tab. It captures the whole
   window, and **the window measured 1728x906 CSS px in this pass**, 34px taller than the 872px
   frame at the app's default size, which is what makes `1380x872` photographable at all. `?capture=1`
   puts the frame at the viewport's own origin with the harness controls below the fold, so the crop
   is the frame's exact device-pixel box (`0, 0, width*dpr, height*dpr`, published as
   `frame.device` in every readback here) instead of a guess at the control height. Every frame is
   the 2x crop of that box downsampled to the app's own CSS pixel grid
   (`magick -crop <box> -resize <WxH>!`). Every pixel is a resample of a real render; no content is
   synthesised, and the pre-resize source is the browser's own PNG.
5. **The draft is staged through the product.** The sidebar's own **New chat** row is clicked (the
   store persists `activeDraftKey`, so the viewport iframe then loads with the draft already
   staged) — the state is not injected into the store, and the frame is not of a story. Each tree
   stages its own draft on its own origin, and every viewport readback in this set records
   `activeDraftKey` set with `activeSessionId` null on the mount it describes.

### What the readbacks carry, and two things they do not

Each `readback-<tree>-<size>.json` is the harness's own published readback for the state the frames
beside it are of: the frame's device box and `dpr`, **when the reading was taken** (`at`,
milliseconds since the harness mounted), the viewport, the focused element, the stack's box, every
chip's label and `disabled`/`aria-hidden`/computed `visibility`/rect, what the frame's own probe
OBSERVED, what this size EXPECTS, its verdict on each, and the **settlement record** — every
distinct layout the page showed with the span of readings that saw it, and whether the reading that
published the file was taken at least `settleWindowMs` (3000ms) after the last observed layout
change. `settled: true` in all eight; `holds.all: true` on all four AFTER sizes and `false` on all
four BEFORE sizes, which is the defect stated as a field rather than as prose.

**`pageProbe` is `null` in all eight, with the reason in the files.**
`draft-splash-viewport.html` publishes that field last as a single escaped JSON string exactly so
that a readback truncated by the reader's output budget still carries the geometry a crop needs.
This pass's reader had four of the eight reads cut inside that field; rather than ship four files
with it and four without, all eight carry `pageProbe: null` and a `pageProbeNote`, and every field
the table, the settlement record or the D2 check uses is a top-level field of the file. The one
reading that lived only there is `store.activeDraftKey`; this pass recorded it directly —
`draft:17fadb82-…` on the `after` origin, `draft:6bbef56d-…` on the `before` origin, both with
`activeSessionId: null`.

**A readback can be STALE, and this is the instrument's sharpest trap.** `#readback` is rewritten
by a `setInterval` in the page. Chrome throttles timers in a tab that has been in the background
for a few minutes — measured here as the inner probe's clock advancing **1 second across two reads
47 seconds apart** — so a read can return a reading taken minutes earlier while the rendered frame
has already moved on. It happened in this pass: the `800x572` AFTER read returned the splash
(greeting + 5 chips, `settled: true`) while the frame beside it already painted the compact
composer, and only a later read — after the throttled tick fired — showed the state the pixels
were in. **Read the frame and the pixels together, and publish a readback only once the two agree.**
That is the same failure design round 5's D2 was, arriving through the reader instead of through the
measurement.

## The numbers — the readback's, and the frame's, kept apart

**The frame column is measured off the PNGs**, not read from a file: for each frame, ImageMagick
writes the chat column (x 280 to the window's own width) as raw sRGB, and every row whose pixels
differ from the column's median colour by more than 24 summed over the three channels is ink. The
bands below are those runs, so a reader can re-derive any of them with the same two commands. Glyph
bands are ink; a readback's box is an element's bounding box, which insets its glyphs by 4-5px —
that difference is what makes an apples-to-apples check possible.

| Tree | Size | Readback: band (y, h) · rows laid out/inside · composer (y, h) | Frame, measured: what is painted | Verdict | AE frame1→2 |
| --- | --- | --- | --- | --- | --- |
| after | 1380x872 | 104, 768 · 3 / 3 · 388.8, 240.5 | greeting glyphs 343-363; composer top 389; three whole rows 525-555 / 561-591 / 600-630 | **matches.** Composer within 1px of the box; rows within 1px of the recorded chip rects (524.75 / 562.25 / 599.75) | 0 |
| after | 900x572 | 104, 468 · 6 / 5 · 185.3, 347.5 | greeting glyphs 140-160; composer top 184; five whole rows 352-382 / 391-421 / 427-457 / 466-496 / 502-532 | **matches ≤2px.** 6 painted of 7 laid out; the inert chip sits at 540.75, below the stack box that ends at 532.8 | 0 |
| after | 830x572 | 104, 468 · 6 / 5 · 185.3, 347.5 | greeting glyphs 140-160; composer top 184; the same five rows | **matches ≤2px.** Same shape as 900x572: the column is 550px, so the band keeps the prompt | 0 |
| after | 800x572 | 104, 468 · no stack · 275, 124 | **no greeting, no chips, no stack**: one composer box 275-398, x-centred on the column | **matches exactly.** The intended SMALL VIEW — the column is 520px, below `chat-content.tsx`'s 550px threshold | 0 |
| before | 1380x872 | 736, 136 · no stack · 744, 112 | three shimmer bars 639-649 / 659-669 / 679-689; caption 706-718; composer 744-855 | matches | 10,334 |
| before | 900x572 | 404, 168 · no stack · 412, 144 | three shimmer bars 307-317 / 327-337 / 347-357; caption 374-386; composer 412-555 | matches | 10,346 |
| before | 830x572 | 404, 168 · no stack · 412, 144 | the same three bars, caption and composer bands | matches | 10,340 |
| before | 800x572 | 442, 130 · no stack · 444, 124 | bars 351-361 / 369-379 / 387-397; caption 412-424; composer 444-567 | matches — and the skeleton is still claimed at the minimum window, where the AFTER half paints the compact composer and claims nothing | 8,800 |

**D2 is discharged by construction: each row is one mount.** The readback was taken on the same
page instance whose frame is committed beside it, and in every row the frame's measured bands sit
within 1-2px of the boxes that readback records. The AFTER pairs are pixel-identical (AE 0), so a
still is a settled state and not a moment inside a layout step; the BEFORE pairs move because the
pane's shimmer is an animation. AE 0 is pixel stillness and says nothing about the layout having
stopped moving — which is why the settlement record exists, and why the two rows below carry a
recorded caveat rather than a bare number.

### Two recorded limitations, both measured in this pass

- **The settlement predicate is a three-second quiet window, and a late container re-measure can
  outrun it.** At `after 800x572` the splash was published as `settled: true` and then held for
  **42 readings** before the column's container measurement landed and the band became the compact
  composer; the committed frame and the committed readback are of that last state, and the splash
  is published as the middle of three states with its span. The same happened on the BEFORE side of
  that size (`47 readings` in the 404-height band before the 442-height one). Keying the predicate
  on the app's own measurement rather than on a timer is the fix this needs.
- **The readback can be stale on a throttled tab**, as set out above. Both of these are limitations
  of the probe's *reader-visible* behaviour, not of this diff's surface, and both are now stated
  where a reviewer will meet them.

The two columns that are NOT in the table, and why: the band's own top edge (104) is a DOM box and
no frame can be asked for it, because a band edge that paints no fill leaves no ink — what a frame
can be asked is the composer's top border, and every row above answers it; and the raw shutter for
each frame, before the crop, was 3456x1812 for all sixteen.

## What this set does NOT show

- **The draft-to-session flip, or a cold real session's hold.** The pane's hold on a REAL session is
  deliberately unchanged by this branch, and this set does not stage one. The earlier set covers
  those states, with its own instrument and its own caveats.
- **Any state other than the settled draft.** No failure, no slow or cold hydration, no second
  theme: the harness has no theme control and this pass did not route through the app's picker.
- **The packaged app.** There is no Electron main process here and no IPC hop; `desktopRequest`
  reaches the backend by the browser-development branch it already ships. Every frame also carries
  the development-only `Chat|Raw` tab strip in the pane header (`chat-header.tsx`,
  `isDevelopmentMode`-gated), which does not exist in a packaged build — named here because an
  undeclared artefact reads as part of the app.
- **#164's own surface.** The canvas and session-variables work this rebase carries is not
  photographed: this set is about the composer band, and the only claim it makes about #164 is that
  the band still behaves with that work in the tree.

## Where this set is declared

`draft-splash-browser` is a declared `supplementary` set in `docs/evidence/manifest.json`, at
**0 frames** — the honest count for the sweep's `.webp`-only tally (`check-evidence.mjs`'s
`frames()` counts `.webp`; every frame here is PNG, as the sibling set's are). It is declared rather
than omitted because an undeclared directory is invisible to that gate, and because the declaration
is where a reader outside this session finds the instrument: `source`, `why`, `capturedAt`,
`capturedAtHead` and `capturedAtSrcTree` all name this capture. The entry sits beside
`docs/evidence/draft-splash/` rather than inside it because the gate refuses a declaration nested in
another declared directory.

## Reproducing

The rig is documented in `~/draft-splash-recap-21131b0/STATE.md`, which is left running and
supervised for the pass that exercises this set next. In outline: start the isolated backend
(`local-operator serve`, `hosting: test` / `model_name: mock`, throwaway `HOME` and config dir,
bearer generated inside the launcher and exported into the children only), start one Vite per tree
with that bearer and backend URL supplied to those processes only, stage a draft by clicking the
product's own New chat row, then `goto .../draft-splash-viewport.html?size=<WxH>&capture=1`, wait
for `settlement.settled`, and shutter twice, reading `#readback` beside the shutters.

Five things about the rig are load-bearing and were learned across these passes:

- **Bind the loopback address literally.** Vite's default host is the string `localhost`, which node
  binds through the resolver and which this machine resolves to the IPv6 loopback; a browser that
  resolves `localhost` to `127.0.0.1` then gets `net::ERR_CONNECTION_REFUSED` from a page `curl`
  fetches fine. The harness config binds `127.0.0.1`, and every URL in this run is that literal.
- **The window must be taller than the frame.** The shutter is viewport-only. A 1380x872 frame needs
  at least 872 CSS px of window content; below that its bottom rows are simply not in the picture,
  and two shutters cannot be composited into one frame because the before tree animates.
- **Reuse no tab that has stopped answering.** A `goto` in a tab that has been hidden for a few
  minutes reports `navigation did not complete: goto timed out` and then never mounts the iframe,
  however healthy the server is (`curl` and the Vite log both stay green). A **fresh tab** navigated
  once is what unblocks it — the page then mounts in the ordinary 5-15s.
- **Wait on `settlement`, and then check the pixels.** A late re-measure can invalidate a reading
  that said `settled`, and a throttled timer can freeze the readback at an earlier state. Neither is
  visible from the readback alone; both are visible the moment the frame is measured against it.
- **`goto` on the viewport page times out often, and that is not a failure.** The page's `load`
  event waits on the harness iframe mounting the whole `ChatPage` (about 6s warm, up to 36s cold
  under a loaded host). The navigation completes anyway; a `read` afterwards is what tells you
  whether the inner page has mounted.
