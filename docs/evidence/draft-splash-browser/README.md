# The settled New chat through the operator's own browser — the fresh set at `8f764cb83`

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
suggestion chips, and **nothing anywhere in the document claims to be loading**.

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
   captures the whole window, and the operator's window is 1440x873 CSS px —
   one pixel taller than the app's default window. Two consequences, both
   handled in the harness rather than worked around in the pixels:
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
every chip's label, `disabled`/`aria-hidden`/computed `visibility` and rect.

**`band.chips` reads 0 in these readbacks and that is not a defect in the
frames.** That count is filtered against `window.__draftSplashChipList`, which
the RETIRED raw-CDP driver injected into the page from the product's own
suggestion list. The `browser` tool has no way to inject it and no
`Runtime.evaluate`, so the filter has nothing to match and the band's own chip
count is unreadable here. The chip inventory in this set comes from the
harness's live DOM read instead (`chips[]` in the same files: count, labels and
per-chip disabled/hidden/visibility/rects), which is what the cap's acceptance
actually turns on. Nothing about the frames depends on the injected list.

## The numbers

Read from the `readback-*.json` files committed beside each frame; the last
column is ImageMagick `compare -metric AE` over the two consecutive frames.

| Tree | Size | Band box (y, h) | Greeting / skeleton | Stack box vs content | Rows visible / laid out | Chips (inert) | Loading claims in the document | AE frame1→frame2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| after | 1380x872 | 104, 768 | 1 / 0 | 142 of 142 | 4 / 4, boundary in the gap | 7 (0) | placeholders 0, outside band 0, shimmer 0, caption none | **0** |
| after | 900x572 | 104, 468 | 1 / 0 | 179.5 of 180 | 5 / 5, boundary in the gap | 7 (0) | 0 / 0 / 0 / none | **0** |
| after | 830x572 | 104, 473 | 1 / 0 | 199 of 237 | 5 / 6, boundary in the gap | 7 (1) | 0 / 0 / 0 / none | **0** |
| after | 800x572 | 104, 473 | 1 / 0 | 199 of 274 | 5 / 7, boundary in the gap | 7 (2) | 0 / 0 / 0 / none | **0** |
| before | 1380x872 | 736, 136 | 0 / 0 | none — no suggestion stack | — | 0 | placeholders 1, outside band 1, shimmer 3, `Loading conversation…` visible | 36 |
| before | 900x572 | 404, 168 | 0 / 0 | none | — | 0 | 1 / 1 / 3 / visible | 8,776 |
| before | 830x572 | 404, 168 | 0 / 0 | none | — | 0 | 1 / 1 / 3 / visible | 10,406 |
| before | 800x572 | 404, 168 | 0 / 0 | none | — | 0 | 1 / 1 / 3 / visible | 52,005 |

What that table says, in one line each:

- **The band's top edge is the column's own top (y=104) on every AFTER size, and
  it is not on any BEFORE size** (736 at the app default, 404 at the three
  constrained ones). The pane above it owes nothing on a session-less draft, so
  the band takes the whole column; on `main` the pane's hold is live and pushes
  the band down over a `Loading conversation…` that will never resolve.
- **Nothing claims to be loading on any AFTER frame** — read document-wide, not
  just inside the band: 0 placeholders, 0 shimmer bars, no visible caption at
  every size. The BEFORE half reports 1 placeholder, 3 shimmer bars and a
  visible caption at every size, which is the defect the branch removes.
- **The AFTER pairs do not move** (AE 0 at all four sizes), which is what makes a
  still a picture of a settled state rather than of a moment inside a layout
  step. The BEFORE pairs move (36 / 8,776 / 10,406 / 52,005 pixels): the pane's
  shimmer is an animation, and a single still of it would not say so.
- **The cap holds whole rows and the rows it omits are inert**: at 830x572 six
  rows are laid out and five are inside the capped box; at 800x572 seven are
  laid out and five fit. The omitted chips are `disabled`, `aria-hidden` and
  `visibility: hidden` (1 and 2 respectively), so they are in neither the
  sequential-focus order nor the click path — the R2-1 repair, read off the
  live DOM in the same files. At every size the boundary between the painted and
  omitted rows falls in the inter-row gap, so no row is cut through its glyphs.

**`1380x872` is the app's default window, and it and `900x572` are the two
sizes this set and the earlier one share exactly.** The band's box at 1380x872
(1100 x 768) and at 900x572 (620 x 468) matches the earlier set's numbers for
the same sizes, which is a useful cross-check between two different
instruments. At 830x572 and 800x572 this run measured a 473px band against the
earlier 468, because a taller wrapped sample puts another row above the composer:
`message-input.tsx` samples 7 of 25 suggestions per mount, so band and stack
heights are comparable within a mount rather than across captures.

## What these frames prove, and what they do not

**They prove, at this head:** a settled New chat paints the greeting and the
suggestion chips at all four sizes with the band at the column's top; the
document makes no loading claim anywhere in that state; the capped stack keeps a
whole number of rows with the boundary in the gap, and the rows it omits are
disabled, `aria-hidden` and invisible; and none of that holds on the merge base,
where the pane's placeholder and its `Loading conversation…` are what a New chat
shows.

**They do not prove:**

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
`capturedAt` and `capturedAtHead` all name this pass. It sits beside
`docs/evidence/draft-splash/` rather than inside it because the gate refuses a
declaration nested in another declared directory.

## Reproducing

The rig is documented in `/tmp/pr169-recapture/STATE.md` for this session's QA
pass; in outline: start the isolated backend, start Vite on both trees with the
bearer and backend URL supplied to that process only, stage a draft by clicking
the product's own "New chat", then `goto`
`.../draft-splash-viewport.html?size=<WxH>&capture=1` and shutter twice. Poll the
published readback for a populated state rather than sleeping a fixed time: the
app takes ~6 s to mount inside the frame warm and up to ~36 s cold under a loaded
host, and a shutter taken before it mounts is a picture of an empty document.
