# The settled New chat through the operator's own browser — the set at `8f80697c8`

**Every frame in this directory was taken in this pass, at this rebase's head, and every
published number was measured against the PNG beside it.** `after` is this branch rebased onto
`origin/main` `8f80697c8` (#202, `release-next-0236`); `before` is `8f80697c8` itself, serving the
same harness pages copied in byte-for-byte — so the pair differs by the change under test and
nothing else, and each tree staged its own draft on its own origin. The set carries across the two
rebases since it was last shot (`c5b5b67ed`, then here) because the band's own files keep moving in
`main`: this rebase's merge touches `chat-content.tsx`, `chat-page.tsx` and `message-input.tsx`.

The instrument is the one the repository's rules require: **the `browser` tool driving the
operator's paired Chromium (the Local Operator extension over its loopback bridge)**. Nothing here
came from a raw-CDP driver, a private headless Chrome, a downloaded engine or a scripted screenshot
path. `scripts/draft-splash-capture.mjs` — the raw-CDP instrument the older generation in
`docs/evidence/draft-splash/` was taken with — is retired and fail-closed, and was not executed.

## What these frames are

A fresh **New chat** (a staged draft: `activeDraftKey` set, no session), settled, at the app's own
default window and at the three sizes the earlier set used — `1380x872`, `900x572`, `830x572` and
the minimum window `800x572`. Two consecutive frames per state, so a pair that moves can be told
apart from a still that does not.

The claim the pair is about: on a New chat the band carries the greeting and the suggestion chips —
or, at the minimum window, the compact composer the column's own width selects — and **nothing
anywhere in the document claims to be loading**. The `before` half is the defect as a measurement:
the same draft, the same sizes, a "Loading conversation…" placeholder, three shimmer bars and the
caption at every size including the minimum window, where `after` paints the compact composer.

## The instrument, exactly

| | |
| --- | --- |
| `after` tree | `~/local-operator-ui-worktrees/draft-splash-fix` at the rebased head — Vite on `127.0.0.1:15224` |
| `before` tree | `~/draft-splash-recap-21131b0/before` at `8f80697c8` with this branch's harness pages byte-for-byte (`shasum -a 256` identical on all five) — Vite on `127.0.0.1:15225` |
| backend | one `local-operator serve` on `127.0.0.1:17970`, `hosting: test` / `model_name: mock`, throwaway `HOME` + config dir, its bearer generated inside the launcher and exported into the three children only; every inherited `CMUX_*`/`LOP_*` stripped |
| staging | the draft is staged through the product's own sidebar New chat row on each origin, and each mount's probe records `activeDraftKey` set with `activeSessionId: null` |
| shutter | `browser` tool `screenshot`, window **1728x962 CSS px** at dpr 2 (raw 3456x1924), cropped to each frame's published device box (`0, 0, width*dpr, height*dpr`) and resampled to the frame's CSS pixel grid |
| proxy | `POST /__desktop {"op":"capabilities"}` from **both** origins → `200`, `desktop_available: true`, `desktop_auth: bearer`, with `GET /v1/capabilities 200` twice in the backend's own log |

Both trees' pages serve `200`; the harness module transforms `200` on both ports. The window is
measured, not assumed: the previous pass's window was 34px shorter (1728x906), and the harness
publishes the viewport it actually got on every mount.

## The numbers — the readback's, and the frame's, kept apart

Readback column: the published file beside each frame. Frame column: measured off the PNG (chat
column x≥280 as raw sRGB; rows departing from the column's median colour by >24 summed channels are
ink). Glyph bands are ink; a readback's box is an element's bounding box, which insets its glyphs by
4-5px — that difference is what makes an apples-to-apples check possible.

| Tree | Size | Readback: band (y, h) · rows laid out/inside · composer (y, h) | Frame, measured | Verdict | AE frame1→2 |
| --- | --- | --- | --- | --- | --- |
| after | 1380x872 | 104, 768 · 4 / 4 · 370, 278 | greeting glyphs 324-344; composer top 370; four whole rows 506-536 / 542-572 / 581-611 / 617-647 | matches (composer exact, rows within 1px of the recorded chip rects, greeting within 4px as an ink box) | 0 |
| after | 900x572 | 104, 468 · 5 / 5 · 185.3, 347.5 | greeting glyphs 140-160; composer top 184; five rows 352-382 / 391-421 / 427-457 / 466-496 / 502-532 | matches ≤2px | 0 |
| after | 830x572 | 104, 468 · 7 / 5 · 185.3, 347.5 | greeting glyphs 140-160; composer top 184; the same five painted rows | matches ≤2px; 7 laid out, 5 painted, the two inert rows at 540.75 / 578.25 below the stack box that ends at 532.8 | 0 |
| after | 800x572 | 104, 468 · no stack · 275, 124 | no greeting, no chips: one composer box **275-398** | matches exactly — the intended SMALL VIEW at a 520px column | 0 |
| before | 1380x872 | 736, 136 · no stack · 744, 112 | bars 639-649 / 659-669 / 679-689; caption 706-718; composer 744-855 | matches | 10,382 |
| before | 900x572 | 404, 168 · no stack · 412, 144 | bars 307-317 / 327-337 / 347-357; caption 374-386; composer 412-555 | matches | 10,382 |
| before | 830x572 | 404, 168 · no stack · 412, 144 | the same three bars, caption and composer bands | matches | 10,370 |
| before | 800x572 | 404, 168 · no stack · 412, 144 | bars 351-361 / 369-379 / 387-397; caption 412-424; composer 444-567 | matches — and the skeleton is still claimed at the minimum window, where the AFTER half paints the compact composer and claims nothing | 8,776 |

**D2 is discharged by construction: each row is one mount.** The readback was taken on the same page
instance whose frame is committed beside it, and in every row the frame's measured bands sit within
1-2px of the boxes that readback records. All eight readbacks are `settled: true`; `holds.all` is
`true` on all four AFTER sizes and `false` on all four BEFORE sizes — the defect stated as a field.
The AFTER pairs are pixel-identical, so a still is a settled state and not a moment inside a layout
step; the BEFORE pairs move because the pane's shimmer is an animation.

## Two instrument limitations met here, published rather than smoothed

1. **The probe's three-second quiet window can be outrun by a late container re-measure.** The
   sharpest instance is the one this pass's own gap produced: at `after 800x572` the page first
   settled on the SPLASH (greeting and five chip rows in a 520px column) and held it for **52
   readings** before the app's own column measurement landed and the band became the compact
   composer. The committed pair is of that last state, and the splash is published in the settlement
   record as a labelled transient with its span. Keying the predicate on the app's own measurement
   rather than on a timer is the fix this needs.
2. **Two frames taken across that flip are not a pair.** The first shutter at that size caught the
   transient and the second caught the settled state (AE 114,752 between them); both were discarded
   and re-shot from the settled state, which is why the committed pair is AE 0. A pair is only
   evidence of stillness if its two shutters also agree with the reading beside them — which is what
   caught this.
3. **A readback can be STALE on a throttled tab.** `#readback` is rewritten by an in-page
   `setInterval`, and a background tab's timers are throttled — measured here as the inner probe's
   clock standing at 31.8s while the readback's own `at` said 137.6s. So a read can describe a state
   the pixels have left, and every published number in this set was checked against its PNG.

`pageProbe` is `null` in all eight readbacks with a note: the page publishes it last as one escaped
JSON string and this reader's output budget cut it on two of the eight reads, so all eight carry
`null` and every field the table, the D2 check or the settlement record uses is a top-level field of
the file. The one reading that lived only there is `store.activeDraftKey` — recorded in the note of
each file (`draft:17fadb82-…` after, `draft:6bbef56d-…` before, each `activeSessionId: null`).

## What this set does NOT show

- **The draft-to-session flip, or a cold real session's hold.** The pane's hold on a REAL session is
  deliberately unchanged by this branch. The earlier set covers those states, with its own
  instrument and its own caveats.
- **Any state other than the settled draft** — no failure, no slow hydration, no second theme: the
  harness has no theme control and this pass did not route through the app's picker.
- **The packaged app.** There is no Electron main process here and no IPC hop; `desktopRequest`
  reaches the backend by the browser-development branch it already ships. Every frame carries the
  development-only `Chat|Raw` tab strip in the pane header, which does not exist in a packaged build.
- **The rebase's own delta.** This set is about the composer band; the only claim it makes about the
  226 upstream commits in this rebase is that the band still behaves with them in the tree. The
  rebase's semantic resolutions (the pane's props, the composer's imports, two story call sites) are
  argued in the PR's recapture comment, not here.

## Where this set is declared

`draft-splash-browser` is a declared `supplementary` set in `docs/evidence/manifest.json`, at **0
frames** — the honest count for the sweep's `.webp`-only tally (`check-evidence.mjs`'s `frames()`
counts `.webp`; every frame here is PNG). It is declared rather than omitted because an undeclared
directory is invisible to that gate, and because the declaration is where a reader outside this
session finds the instrument. The entry sits beside `docs/evidence/draft-splash/` rather than inside
it because the gate refuses a declaration nested in another declared directory.

## Reproducing

The rig is documented in `~/draft-splash-recap-21131b0/STATE.md`, which is left running and
supervised for the pass that exercises this set next. In outline: start the isolated backend
(`local-operator serve`, `hosting: test` / `model_name: mock`, throwaway `HOME` and config dir,
bearer generated inside the launcher and exported into the children only), start one Vite per tree
with that bearer and backend URL supplied to those processes only, stage a draft by clicking the
product's own New chat row, then `goto .../draft-splash-viewport.html?size=<WxH>&capture=1`, wait
for `settlement.settled`, and shutter twice, reading `#readback` beside the shutters.

Four things about the rig are load-bearing, learned across these passes:

- **Bind the loopback address literally.** Vite's default host is the string `localhost`, which node
  binds through the resolver and which this machine resolves to the IPv6 loopback; a browser that
  resolves `localhost` to `127.0.0.1` then gets `net::ERR_CONNECTION_REFUSED` from a page `curl`
  fetches fine. The harness config binds `127.0.0.1`, and every URL here is that literal.
- **The window must be taller than the frame.** The shutter is viewport-only, so a 1380x872 frame
  needs at least 872 CSS px of window content.
- **Reuse no tab that has stopped answering.** A tab that has been hidden for a few minutes reports
  `navigation did not complete: goto timed out` and then never mounts the harness iframe, however
  healthy the server is (`curl` and the Vite log both stay green).
- **Wait on `settlement`, then check the pixels.** A late re-measure can invalidate a reading that
  said `settled` (the 52-reading transient above), and a throttled timer can freeze the readback at
  an earlier state. Neither is visible from the readback alone; both are visible the moment the frame
  is measured against it.
