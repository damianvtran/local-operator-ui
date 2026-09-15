# The settled New chat through the operator's own browser — the set at `8f764cb83`

**The frames in this directory are the previous capture and have NOT been re-shot
at the head under review.** `main` has since taken #154's composer-picker change,
which edits `message-input.tsx` and `chat-content.tsx` — two of the files the band
is composed from — so these pixels are of a composer the branch no longer has.
What this pass changed is the INSTRUMENT (readings are now stamped, and the probe
publishes the layouts it saw with the span it saw each for) and this set's account
of itself, including the two rows of its table that contradicted the frames beside
them. The re-shoot is still outstanding; its blocker is recorded in *The
instrument's repair, and the re-shoot that has not happened* below and in the PR's
recapture comment.

The reference implementation of this set's instrument is the runbook the whole
repository now carries: **the `browser` tool driving the operator's paired
Chromium (the Local Operator extension over its loopback bridge)**. Nothing here
came from a raw-CDP driver, a private headless Chrome, a downloaded engine or a
scripted screenshot path. `scripts/draft-splash-capture.mjs` — the raw-CDP
instrument the frames in the parent directory were taken with — is still
retired and fail-closed, and was not executed.

So the two generations in this directory tree are different instruments, and
they are labelled as such rather than merged:

| | where | instrument | heads |
| --- | --- | --- | --- |
| **This set** | `docs/evidence/draft-splash-browser/` | the operator's paired browser via the Local Operator extension (`browser` tool), against an isolated mock backend | `after` = `8f764cb83` (this branch), `before` = `d12fecbcf` (= `origin/main`, this branch's merge base) |
| **The earlier set** | `docs/evidence/draft-splash/*.png`, `readback-*.json` | a private headless Chrome over raw CDP, through a harness of its own | `after` at pre-rebase heads, `before` at `ef40c81e2` |

The parent `README.md`'s prose and tables stay as they were written for the
earlier set, with its own numbers and its own caveats; they are a record of that
generation, not of these frames. Nothing in this directory re-stamps them, and
the earlier PNGs were not overwritten or re-shot.

## What these frames are

A fresh **New chat** (a staged draft: `activeDraftKey` set, no session), settled,
at the app's own default window and at the three sizes the earlier set used —
`1380x872`, `900x572`, `830x572` (the narrowest column at the constrained
height, where design round 1 measured the band's overflow) and the minimum
window `800x572`. Two consecutive frames per state, so a pair that moves can be
told apart from a still that does not.

The claim the pair is about: on a New chat the band carries the greeting and the
suggestion chips — or, at the minimum window, the compact composer the column's own
width selects — and **nothing anywhere in the document claims to be loading**.

## The instrument, exactly

1. **An isolated backend.** `local-operator serve --host 127.0.0.1 --port 17970`
   with a throwaway `LOCAL_OPERATOR_CONFIG_DIR` and `HOME`, and
   `hosting: test` / `model_name: mock`, so a send settles without a network and
   without a token. A fresh 32-byte bearer is generated inside the launcher and
   exported into the three child processes only — it is never written to a file,
   printed, or reachable from the page. The operator's config, sessions and
   live browser state are untouched, and every inherited `CMUX_*` variable is
   scrubbed before any child starts.
2. **Two trees, one backend.** `after` is this branch's worktree at
   `8f764cb83`; `before` is a worktree at `d12fecbcf` with **this branch's own
   harness pages copied in byte-for-byte**, so the pair differs by the change
   under test and nothing else. Each is served by its own Vite process
   (`15224` and `15225`) running `scripts/draft-splash-evidence.vite.mjs`, which
   registers the same `desktopProxyPlugin()` the app's own dev config does — so
   the renderer under the camera is the SHIPPED `ChatPage`, taking the
   same-origin `/__desktop` branch the product already ships for browser
   development. The bearer and the backend URL are read by the Vite process and
   never reach the page.
3. **The page under the camera.** `scripts/draft-splash-viewport.html` mounts the
   real `ChatPage` in a fixed-size same-origin iframe
   (`scripts/draft-splash-evidence.html`), so the frame's viewport — which the
   product reads as `window.innerWidth`/`innerHeight` — is the size under test.
4. **The shutter.** `browser` tool `screenshot` on the operator's own tab. It
   captures the whole window, and the window in the capture this set holds was
   1440x873 CSS px — one pixel taller than the app's default window. **The window
   measured 1440x817 in this pass** (`window.innerWidth`/`innerHeight`, read off
   the harness page's own probe), 55px shorter than the 872px frame at the app's
   default size, which is a constraint on the re-shoot rather than a footnote: at
   817px of viewport an 872px-tall frame cannot be photographed whole however
   correct the crop is, so re-taking `1380x872` needs a taller browser window or a
   screenshot that captures beyond the viewport — and this instrument has verified
   neither. Two consequences, both handled in the harness rather than worked
   around in the pixels:
   - `?capture=1` puts the frame at the viewport's own origin with the harness
     controls below the fold, so the crop is the frame's exact device-pixel box
     (`0, 0, width*dpr, height*dpr`, published as `frame.device` in every
     `readback-*.json` here) instead of a guess at the control height. Without
     it the frame's bottom ~260 rows fall below the fold and cannot be
     photographed at 872px height at all.
   - The screenshot is taken at `devicePixelRatio 2`, so each frame is the
     2x crop of that box downsampled to the app's own CSS pixel grid
     (`magick -crop 2760x1744+0+0 -resize 1380x872!`). Every pixel is a resample
     of a real render; no content is synthesised, and the pre-resize source is
     the browser's own PNG. Each file's dimensions are asserted below.
5. **The draft is staged through the product.** The "New chat" control on the
   shipped page is clicked (the store persists `activeDraftKey`, so the iframe
   loads with the draft already staged) — the state is not injected into the
   store, and the frame is not of a story.

### What the readbacks carry, and one reading they cannot

Each `readback-<tree>-<size>.json` is the harness's own published readback for
the state the frames beside it are of: the frame's device box, the band's box
and text, the greeting/skeleton counts, a document-wide loading-claim count, the
draft stream's composed view, the suggestion stack's box against its content, and
every chip's label, `disabled`/`aria-hidden`/computed `visibility` and rect. They
are the readings of THIS capture, and they predate the instrument repair described
below: none of them carries an `at`, a `settlement`, an `expected` or an
`observed`, which is why the table above keeps their numbers apart from the
frames'.

**`band.chips` reads 0 in these readbacks and that is not a defect in the
frames.** That count is filtered against `window.__draftSplashChipList`, which
the RETIRED raw-CDP driver injected into the page from the product's own
suggestion list. The `browser` tool has no way to inject it and no
`Runtime.evaluate`, so the filter has nothing to match and the band's own chip
count is unreadable here. The chip inventory in this set comes from the
harness's live DOM read instead (`chips[]` in the same files: count, labels and
per-chip disabled/hidden/visibility/rects), which is what the cap's acceptance
actually turns on. Nothing about the frames depends on the injected list.

## The numbers — the readback's, and the frame's, kept apart

The previous version of this section published one set of numbers and presented it
as both, which is design round 5's D2: two of the four AFTER rows described a
state the committed PNG beside them does not paint. So the numbers are now in two
columns that cannot be confused — what the `readback-*.json` files record, and
what the committed frame actually paints — with a verdict on the row.

**The frame column is measured off the PNGs**, not read from a file: for each
frame, ImageMagick writes the chat column (x 280 to the window's own width) as
raw sRGB, and every row whose pixels differ from the column's median colour by
more than 24 summed over the three channels is ink. The bands below are those
runs, so a reader can re-derive any of them with the same two commands. Glyph
bands are ink; a readback's box is an element's bounding box, which insets its
glyphs by 4-5px — that difference is what makes an apples-to-apples check
possible, and comparing the two directly is how the previous table went wrong.

| Tree | Size | Readback: band (y, h) · rows laid out/visible | Frame, measured: what is painted | Verdict |
| --- | --- | --- | --- | --- |
| after | 1380x872 | 104, 768 · 4 / 4, boundary in the gap | greeting glyphs 324-344; composer top 370; four whole rows 506-536 / 542-572 / 581-611 / 617-647 | matches ≤1px |
| after | 900x572 | 104, 468 · 5 / 5, boundary in the gap | greeting glyphs 140-160; composer top 184; five whole rows 352-382 / 391-421 / 427-457 / 466-496 / 502-532 | matches ≤1px |
| after | 830x572 | 104, 473 · 5 / 6, boundary in the gap | greeting glyphs **149-169**; composer top **193**; **four** whole rows 361-391 / 400-430 / 436-466 / 475-523 | **CONTRADICTS.** The readback is the pre-settlement reading: its whole group sits 15-16px above the painted one (greeting box 128 implies glyphs ~133; composer 178 vs 193; rows 346 / 383.5 / 421 / 458.5 vs 361 / 400 / 436 / 475). The settled composition paints FOUR rows, so three of that mount's seven chips are painted nowhere — the cost D5 records, as a row rather than as motion |
| after | 800x572 | 104, 473 (**w 520**) · 5 / 7, boundary in the gap | **no greeting, no chips, no stack**: one composer box 275-398, x-centred on the column | **CONTRADICTS.** The frame is the intended **SMALL VIEW** — the column is 520px, below `chat-content.tsx:343`'s 550px threshold, so the band paints no empty-chat prompt at all. The readback records the TRANSIENT: the splash painted at 520px before the column's container measurement had taken effect, with a band box 104-577 that is 5px taller than the 572px window |
| before | 1380x872 | 736, 136 · no stack | three shimmer bars 639-649 / 659-669 / 679-689; caption 706-718; composer 744-855 | matches |
| before | 900x572 | 404, 168 · no stack | three shimmer bars 307-317 / 327-337 / 347-357; caption 374-386; composer 412-555 | matches |
| before | 830x572 | 404, 168 · no stack | same three bars, caption and composer bands | matches |
| before | 800x572 | 404, 168 · no stack | same three bars, caption and composer bands | matches |

The two columns that are NOT in the table, and why: the band's own top edge
(104) is a DOM box and no frame can be asked for it, because a band edge that
paints no fill leaves no ink — what a frame can be asked is the composer's top
border, and that is where the 830x572 row fails; and `AE frame1→frame2` is a
property of the PAIR, re-measured here with `magick compare -metric AE`: **after
0 / 0 / 0 / 0**, **before 36 / 8,776 / 10,406 / 52,005**. The AFTER pairs are
pixel-identical, so a still is a picture of a settled state rather than of a
moment inside a layout step; the BEFORE pairs move because the pane's shimmer is
an animation. Note that AE 0 is pixel stillness and says nothing about the layout
having stopped moving — the 830x572 AFTER pair is AE 0 and its readback is still
pre-settlement, which is precisely why the instrument now records settlement
separately.

What the corrected table says, in one line each:

- **The band's top edge is the column's own top (y=104) on every AFTER readback,
  and is not on any BEFORE one** (736 at the app default, 404 at the three
  constrained ones). The pane above it owes nothing on a session-less draft, so
  the band takes the whole column; on `main` the pane's hold is live and pushes
  the band down over a `Loading conversation…` that will never resolve.
- **Nothing claims to be loading on any AFTER frame** — read document-wide, not
  just inside the band: 0 placeholders, 0 shimmer bars, no visible caption at
  every size, and no shimmer ink anywhere in the measured bands. The BEFORE half
  reports 1 placeholder, 3 shimmer bars and a visible caption in the readback,
  and the bars and the caption are exactly the ink its frames carry — which is the
  defect the branch removes.
- **The AFTER pairs do not move** (AE 0 at all four sizes) **and the cap holds
  whole rows with the rows it omits inert**. At 1380x872 four rows are laid out
  and four painted; at 900x572 five and five; at 830x572 six are laid out and the
  settled frame paints four (not the readback's five) because the composer's
  readings row resolves and takes a row with it; at 800x572 the stack is not
  painted at all, because the column takes the small view. The omitted chips are
  `disabled`, `aria-hidden` and `visibility: hidden`, so they are in neither the
  sequential-focus order nor the click path — the R2-1 repair, read off the live
  DOM in the same files. Where rows are painted, the boundary falls in the
  inter-row gap, so no row is cut through its glyphs.

**`800x572` is the minimum window and it is BY DESIGN a different screen.** The
column is 520px; `chat-content.tsx:343` measures it with a `ResizeObserver` and
sets `isSmallView` below 550px, and `message-input.tsx:1109-1110` paints the
empty-chat prompt only when that flag is false. So at the minimum window the band
is one compact composer: no greeting, no suggestion stack, and no loading claim.
`main` paints the same small view there — pushed down under the pane's shimmer and
its caption — so the branch removes the loading claim at the minimum window too.
Any reading that shows a splash at 800x572 is a reading of the transient painted
before the observer's first callback, not of the screen the user is left with.

**`1380x872` is the app's default window, and it and `900x572` are the two sizes
this set and the earlier one share exactly.** Those two rows agree to ≤1px between
the readback and the pixels, which is a useful cross-check between two different
instruments. At 830x572 and 800x572 this capture measured a 473px band against the
earlier raw-CDP set's 468, because a taller wrapped sample puts another row above
the composer:
`message-input.tsx` samples 7 of 25 suggestions per mount, so band and stack
heights are comparable within a mount rather than across captures.

### The instrument's repair, and the re-shoot that has not happened

Two of the rows above could contradict their frames silently because the probe
published a reading with no record of WHEN it was taken or of whether the layout
had stopped moving. Both are now fixed in the harness:

- Every reading carries `at` (milliseconds since mount). The field existed in
  `bandNow` and was hardcoded `0`, so no published number could be placed in time
  at all.
- `#probe` publishes `settlement`: every **distinct** layout the page has shown,
  with the span of readings that observed it (`at`/`lastSeenAt`), the
  `stableForMs` since the last layout change, and `settled`. A reading of a
  transient is therefore labelled as one, and a reading of the settled state can
  be shown to be one instead of assumed.
- The outer readback carries the same clock, plus `expected` (derived from the
  small-view rule quoted above), `observed` and per-field `holds`. A readback at
  800x572 that recorded a splash at a 520px column would now publish
  `holds.smallView: false` and `settlement.states` would carry the transient
  beside the settled state, so the contradiction is a failing field in the
  committed file rather than something a reviewer has to find by measuring PNGs.

**The committed `readback-*.json` files predate that repair** and carry none of
it: no `at`, no `settlement`, no `expected`. They are the readings the previous
generation of the harness took, and they are kept as they are rather than
regenerated, because the honest way to replace them is a re-shoot.

**That re-shoot has not run.** This set's frames were captured at `8f764cb83`
(`src` tree `0dcca34f0`), and `main` has since taken #154's composer-picker
change, which edits two of the files the band is composed from
(`message-input.tsx`, `chat-content.tsx`) — so these frames are pictures of a
tree that is no longer the one under review, and the commit that re-takes them is
still outstanding. The attempt made in this pass reached the real surface (a
staged draft read back through the harness: `activeDraftKey` set,
`activeSessionId` null, one greeting, zero loading claims) and then failed on the
instrument: the paired browser's extension worker stopped answering on every
navigation. The failure strings, the attempt count and the host's load and swap
figures are in the PR's `### Evidence recapture at 21131b02a — capture BLOCKED`
comment, and the rig it could not drive is left running and supervised so the
pass that can re-take them starts from a warm harness rather than a rebuild. Until
that happens the manifest's `srcTree`/`scriptsTree` name THIS capture's trees
rather than `HEAD`'s, and the stamp half of `check-evidence.mjs` is red on
purpose.

## What these frames prove, and what they do not

**They prove:** a settled New chat paints the greeting and the suggestion chips at
the three sizes whose column is 550px or wider (`1380x872`, `900x572`,
`830x572`), with the band at the column's top; and at `800x572` — the minimum
window, whose column is 520px — the same New chat paints the intended **SMALL
VIEW**: one compact composer, no greeting, no suggestion stack, and no loading
claim either. In neither state does the document claim to be loading anywhere;
the capped stack keeps a whole number of rows with the boundary in the gap; the
rows it omits are disabled, `aria-hidden` and invisible; and none of that holds on
the merge base, where the pane's placeholder and its `Loading conversation…` are
what a New chat shows at every size.

**They do not prove:**

- **Anything about the tree under review.** The frames are of `8f764cb83`
  (`src` tree `0dcca34f0`); `main` has since taken #154's composer-picker change,
  which edits `message-input.tsx` and `chat-content.tsx`, so the pixels in this
  directory are of a composer the branch no longer has. The re-shoot that would
  fix that has not run — its blocker is in this file's numbers section and in the
  PR's own recapture comment — and nothing here is re-stamped to pretend
  otherwise.

- **Anything about the keyboard.** The `browser` tool exposes no Tab/Enter/Space
  input, and this set used none of the harness's own DOM focus/click probes. The
  chips' `disabled`/`aria-hidden`/`visibility` state is read from the DOM; the
  claim that they are unreachable by a real user rests on those attributes plus
  the R2-1 code path, not on a trusted key event here.
- **Anything after a send.** No frame in this set is of a conversation, of the
  draft-to-session flip, or of a cold real session's hold — the pane's hold on a
  REAL session is deliberately unchanged by this branch, and this set does not
  stage one. The earlier set covers those states, with its own instrument and
  its own caveats.
- **Any state other than the settled draft.** No failure, no slow or cold
  hydration, no second theme: the harness has no theme control and this pass did
  not route through the app's picker.
- **The packaged app.** There is no Electron main process here and no IPC hop;
  `desktopRequest` reaches the backend by the browser-development branch it
  already ships. Every frame also carries the development-only `Chat|Raw` tab
  strip in the pane header (`chat-header.tsx`, `isDevelopmentMode`-gated), which
  does not exist in a packaged build — named here because an undeclared artefact
  reads as part of the app.

## Where this set is declared

`draft-splash-browser` is a declared `supplementary` set in
`docs/evidence/manifest.json`, at **0 frames** — the honest count for the sweep's
`.webp`-only tally (`check-evidence.mjs`'s `frames()` counts `.webp`; every frame
here is PNG, as the sibling set's are). It is declared rather than omitted because
an undeclared directory is invisible to that gate, and because the declaration is
where a reader outside this session finds the instrument: `source`, `why`,
`capturedAt`, `capturedAtHead` and `capturedAtSrcTree` all name this capture.
`capturedAtSrcTree` is `0dcca34f0`, the `src` tree the pixels are of, and it is on
the entry because no readback in this set records a tree field of its own. The
entry sits beside `docs/evidence/draft-splash/` rather than inside it because the
gate refuses a declaration nested in another declared directory.

**The manifest's aggregate stamp is red, on purpose, until the re-shoot runs.**
`srcTree`/`scriptsTree` name this capture's trees (`0dcca34f0` / `ed5a91573`)
rather than `HEAD`'s, so `check-evidence.mjs`'s stamp half reports that the frames
were captured from a different tree than the one under review — which is true, and
is the honest state of a set whose frames have not been re-taken. Re-deriving those
fields against `HEAD` would make the gate green while changing nothing about the
pixels, which is exactly the false claim the set's round-5 review removed.

## Reproducing

The rig is documented in `~/draft-splash-recap-21131b0/STATE.md`, which is left
running and supervised for the pass that re-takes these frames. In outline: start
the isolated backend (`local-operator serve`, `hosting: test` / `model_name:
mock`, throwaway `HOME` and config dir, bearer generated inside the launcher and
exported into the children only), start one Vite per tree with that bearer and
backend URL supplied to those processes only, stage a draft by clicking the
product's own New chat control, then `goto`
`.../draft-splash-viewport.html?size=<WxH>&capture=1` and shutter twice.

Two things about the rig are load-bearing and were learned this pass:

- **Bind the loopback address literally.** Vite's default host is the string
  `localhost`, which node binds through the resolver and which this machine
  resolves to the IPv6 loopback; a browser that resolves `localhost` to
  `127.0.0.1` then gets `net::ERR_CONNECTION_REFUSED` from a page `curl` fetches
  fine. The harness config binds `127.0.0.1`, and every URL in this run is that
  literal.
- **Wait on `settlement`, not on a sleep or on a populated band.** The probe
  publishes the distinct layouts it has seen with the span of readings that
  observed each one, so a shutter can be taken when `settled` is true and the
  reading beside it is provably of the settled state. A shutter taken before the
  app mounts is a picture of an empty document; one taken after the band mounts
  but before the composer's readings row resolves is a picture whose readback is
  16px out — the 830x572 row above. The app takes ~6 s to mount inside the frame
  warm and up to ~36 s cold under a loaded host.
