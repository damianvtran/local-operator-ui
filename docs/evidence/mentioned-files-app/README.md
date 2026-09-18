# The Files panel's producer, and the viewers it opens

Four frames from the **real built app**, on a real backend, over a real
transcript — and not one byte of the operator's own data. They exist because the
claims under review are claims about a running application:

- the panel's content is *inferred* from the transcript rather than carried on
  the wire, so nothing in `test:desktop` can show that a path an agent wrote
  becomes a tile;
- the PDF viewer is Chromium's own, over a blob URL, and the only thing that
  proves a PDF renders is pixels;
- the video viewer is the one viewer that streams through the backend's media
  route with Range requests rather than reading bytes over IPC, so its working
  state cannot be produced offline at all.

| frame | what it shows |
| --- | --- |
| [`files-panel/localOperatorDark.webp`](files-panel/localOperatorDark.webp) | The producer fired, on the surface as it was when this frame was taken: six mentioned paths became six **tiles** under the panel head — `notes.txt`, `invoice-review.pdf`, `ledger-summary.png`, `ledger.csv`, `reconcile-clip.mp4` and `march-export.csv`, the last carrying the **`No longer on disk` receipt** because no file backs it. The Files view is a LIST now, so this frame is the record of the producer path rather than a picture of the current surface; the list's own pictures are the twelve-theme Storybook set under [`../canvas-workspace/`](../canvas-workspace/README.md), which stands in for an app-level frame of the new surface and says why. Its video tile paints a real frame of the clip from the media route, which is half of what that producer path was taken to prove. |
| [`pdf-viewer/localOperatorLight.webp`](pdf-viewer/localOperatorLight.webp) | Clicking the PDF tile opens the document in Chromium's viewer under **our own chrome bar** (the way out to the OS; the name is on the tab above it), with no CSP violation on the PDF path. |
| [`video-viewer/localOperatorDark.webp`](video-viewer/localOperatorDark.webp) | The video viewer PLAYING: a decoded frame of `reconcile-clip.mp4` at 0:01/0:02 over `sunken`, with the platform player's controls, the document tab above and the bar's open-in-OS action. |
| [`video-viewer/localOperatorLight.webp`](video-viewer/localOperatorLight.webp) | The same state in the light brand palette, where the player's own chrome and the surface under it are the closest of any pairing in the set. |

All four are **clipped to the canvas panel** (`[data-tour-tag="canvas-container"]`'s
own measured rect), so none carries the sidebar, the session list or the
transcript. That is the point of the isolation below, and it is checked rather
than intended: the driver writes the un-cropped window frame beside each cropped
one (`window-*.png`, not committed) precisely so a reader can confirm the crop
decides nothing important.

## What produced these frames

**The real built app, not Storybook and not a browser.** `pnpm build`, then
`electron .` from the tree's own `out/` with
`LOCAL_OPERATOR_UI_WINDOW_MODE=headless`, its own `--user-data-dir` and its own
CDP port, driven over raw CDP (the built-in WebSocket is the transport — no
dependency). Headless is a window mode the app ships: the process is a real
window that is neither visible nor focusable, so the run never steals focus.

**The backend is isolated, and the isolation is enforced.** A scratch
`LOCAL_OPERATOR_CONFIG_DIR` / `LOCAL_OPERATOR_HOME`, an isolated
`local-operator serve` on a port this harness owns, paired to the app through a
shared `LOCAL_OPERATOR_DESKTOP_TOKEN`. Two details are load-bearing rather than
incidental:

- the app is launched with a **scratch `cwd`** and the app path passed
  absolutely, because `src/main/backend/config.ts` loads `.env` from
  `process.cwd()` with `override: true` — launched from the worktree its
  `VITE_LOCAL_OPERATOR_API_URL` wins and every request lands on the operator's
  live backend;
- the app is **built** with `VITE_LOCAL_OPERATOR_API_URL` pointing at the
  scratch backend, because the renderer bakes that value at build time and the
  image tiles fetch through the renderer's own REST client.

**Every file is invented.** `out/evidence-harness/make-fixtures.mjs` generates
them: a hand-built two-page PDF (no dependency, no real document), a PNG
encoded with `zlib` so two runs are byte-identical, a CSV, a `.txt`, and — since
design round 1 asked for the video viewer's working state — a two-second H.264
clip. The clip is the one fixture a script cannot compose (a bitstream is not
hand-writable the way the PDF above is), so that one step shells out to
`ffmpeg`, and the harness REFUSES to run without it rather than substituting a
still or the viewer's error state. The sixth path exists only as text — it is
the ghost that exercises the availability probe. The session is one seeded
`transcript.jsonl` (`out/evidence-harness/seed-mentioned-files.mjs`) whose
assistant turn names those paths in prose, which is the strictest admission tier
the extractor has (absolute path **and** a known extension), plus one `file://`
URL for the second tier.

The harness lives in gitignored `out/evidence-harness/` — `make-fixtures.mjs`,
`seed-mentioned-files.mjs`, `drive-mentioned-files.mjs`,
`run-mentioned-files.sh` — matching the `chat-title` and `sidebar-new-chat`
precedent. To reproduce:

```sh
bash out/evidence-harness/run-mentioned-files.sh   # SKIP_BUILD=1 to reuse out/
```

It prints, and refuses to capture unless: the isolated backend answers
`/v1/desktop/sessions` with our token, the built renderer actually carries the
isolated origin, and the app reports `desktop_available: true` (an unpaired
instance renders an empty panel, which is indistinguishable from a producer that
never fired). The readings at this head:

```
mentionedFilesWritten 6   (text, pdf, image, spreadsheet, video, spreadsheet/missing)
filesGrid             notes.txt | invoice-review.pdf | ledger-summary.png |
                      ledger.csv | reconcile-clip.mp4 | march-export.csv (No longer on disk)
pdfTileClicked        true
pdfFrame              iframe[src^="blob:"], title "PDF: invoice-review.pdf",
                      open-in-OS control present, cspViolations []
videoTileClicked      true
videoFrame            src scheme "http", isMediaRoute true, readyState 4,
                      currentTime 1.2, duration 2, 480x270, error null
```

`readyState 4` with a non-zero `videoWidth` is what makes the video frames
evidence rather than a picture of a poster: the driver seeks to 1.2s, waits for a
decoded frame, and only writes the frame when that reading comes back — the
script refuses (loudly, and without writing) if the clip does not decode, because
the alternative would be to commit the viewer's error state under a name that
claims the working one.

## Why these are a declared set rather than swept frames

`check-evidence.mjs` counts everything outside a declared `supplementary` set as
the sweep's own, so a set that belongs to another producer has to say so:

- **The PDF frame is the one that exercises the real read path.** Everything
  else in this set is a claim about the panel; the PDF frame is the only one that
  runs main-process `readFileBytes` over IPC on real bytes and shows a document
  the platform viewer actually painted, which a story fixture cannot.
- **The panel frame's tiles are transcript-inferred.** They are paths a
  transcript mentioned and its thumbnails come from the backend's static route;
  Storybook has neither. The sweep's `canvas-workspace--files` frame shows the
  same grid from a fixture and says so — and the PNG tile's thumbnail is missing
  in BOTH frames, for the CSP reason in artifact 2 below rather than because one
  of them is Storybook: this set's own live frame paints the same broken box, so
  neither image is evidence about the thumbnail route.
- **The video frame cannot come from the sweep at all.** It needs a backend
  answering the media route's Range requests, and `canvas-workspace--video-viewer`
  is only able to render the viewer's failure state under the story's stub — which
  is exactly why the working state has a live frame here. The design round asked
  for this frame by name.

**Correction, 2026-09-13 (round-2 evidence pass).** The PDF bullet above is
falsified, and the frames that falsify it are in this tree: the six committed
`canvas-workspace/pdf-viewer` frames — added when `cb804bc44` declared that story
in `STORIES` — show Chromium painting the fixture document (heading, subheading,
accent rule) under our own name bar in all twelve themes. The same capture wiring
that measured `childBodyKids: 0` therefore has a PDFium attached here, which
makes this a difference between the browser build the probe ran and the one
`capture-evidence.mjs` spawns rather than a property of the harness. The bullets
above are left standing as what was measured at the time. The set stays declared
for the reasons that do not depend on that measurement: the panel frame's tiles
are transcript-inferred and its thumbnails come from the backend, the PDF frame
here is the only one that exercises the real read path over IPC on real bytes,
and the video frame is the only committed picture of that viewer playing
anything at all.

## Known artifacts, all of them about the harness

Each of these is visible in the frames and none is a defect in the code under
review. They are listed so a reader does not have to reverse-engineer them:

1. **The app's own "The server is offline" strip** runs across the top of the
   panel frames. The renderer bakes its REST base URL at build time, and the
   app's CSP (`src/renderer/index.html`) pins `connect-src` to the literal
   `localhost:1111` / `127.0.0.1:1111` / `:8080` hosts, so the renderer's legacy
   health poll to the isolated port is refused while every desktop operation
   goes through the main process, which is not subject to that CSP. The same
   strip is present in the `chat-title` frames under the same setup, and it is
   unrelated to this change.
2. **The PNG tile has no thumbnail, in this set's frames as well as the
   sweep's.** Same cause, one directive along: `img-src` names only the `:1111`
   hosts, so the tile's thumbnail — which the grid builds from the renderer's
   REST client — cannot be fetched from the isolated backend, and the tile paints
   its name over an empty box. The live panel frame in this directory carries
   that same box (the alt text sits over it), so this is a property of the
   isolated origin and NOT of Storybook: neither frame can show a real thumbnail.
   The tile's own claim (a `.png` is classified as an image and gets a tile) is
   unaffected; the thumbnail route against the app's configured backend is
   exercised by `scripts/mentioned-files-app-proof.mjs` on the live backend.
3. **`media-src`, for the video frame, is widened in the BUILD OUTPUT and
   nowhere else.** The same CSP names only the `:1111` hosts there too, so the
   video would not load at all from the isolated backend — which would leave the
   one frame the design round asked for showing the viewer's error state. The
   harness therefore rewrites that one directive in `out/renderer/index.html`
   after the build (see `run-mentioned-files.sh`). `out/` is gitignored and
   `src/renderer/` is untouched: the shipped CSP still refuses every origin that
   is not the app's own backend, and script two is why the video tile in the
   panel frame plays while the PNG tile beside it does not need to.
4. **No frame shows a platform PDF toolbar, and `#toolbar=0` is why.** An
   earlier version of this note described a dark platform toolbar in the
   light-brand frame as an accepted platform object; no committed frame shows
   one, because the viewer opens the document with `#toolbar=0` and the platform's
   own chrome is suppressed — the white page fills the panel under the strip we
   DO own, which is themed (`surface` under the hairline rule, carrying the
   open-in-OS action). What the platform still paints for itself is the field
   around the page at other zoom levels (point 5), which is the boundary this
   pull request does not close; the PR's "Not addressed" section names it.
5. **The platform's PDF field is a fixed colour in every theme, and
   `color-scheme` does not reach it.** The field around the page — the majority
   of the surface under the bar in the swept `canvas-workspace/pdf-viewer`
   frames — measures `#282828` in all twelve palettes, and in the light brand
   palettes that puts a near-black field under a cream bar with the white page
   floating in it (design round 1, D2). It was tried and measured, and it cannot
   be pinned from CSS: neither the inherited `color-scheme` the palettes publish
   on `[data-theme]`, nor an explicit `color-scheme: light` on the PDF
   `<iframe>`, nor the same property set on the viewer document's own root, nor
   an emulated `prefers-color-scheme: light`, moves the field — the platform
   paints from the BROWSER's preferred colour scheme, not from anything this app
   authors. The knob that does reach it is the process-wide
   `nativeTheme.themeSource`, which is a decision about every platform surface in
   the app rather than about this viewer; it is recorded as an accepted platform
   boundary in `pdf-preview.tsx` beside the toolbar note in point 4, for the
   review to weigh. Note that the field is NOT visible in the live frame below:
   with `#toolbar=0` the platform's default zoom fills the panel with the page,
   so the field is a property of other zoom levels and of the swept set, where it
   was measured.
6. **The PDF frame is the light brand palette** while the panel and the video
   frames are the dark one. `check-evidence.mjs` asserts every frame's dominant
   colour is one of its own theme's grounds — how it catches a surface that
   painted nothing — and a PDF's paper is white, which no dark palette's ground
   is near. The document frame is therefore captured in the palette it is
   honestly a picture of, rather than cropped or zoomed until the checker stops
   looking. The video frames are captured in BOTH brand palettes, because the
   platform player's own chrome sits on the `sunken` ground and that pairing is
   the one design round 1 measured as marginal in the light palettes (D7).

## Provenance

- `capturedAt` / `capturedAtHead`: the head that the built `out/` and the
  seeded fixture were taken at, recorded in `manifest.json` beside this set.
- App assertions that the frames cannot show: `cspViolations` is empty for the
  PDF path — the `<iframe src="blob:…">` variant is the one the CSP permits,
  and the `<embed>` variant the design decisions' own probe found blocked is not
  used — and the video reading (`readyState`, `duration`, video dimensions) is
  what distinguishes a playing clip from a poster.
- The viewport is 1728x966 at device ratio 2, wider than the app's 1380x900
  default on purpose: at the default the Files grid's fourth column and the PDF
  page both fall outside the panel crop. The window size is a harness knob
  (`LOCAL_OPERATOR_UI_WINDOW_SIZE`), not a change to the app.
- The design decisions these frames illustrate, and the deviations this
  implementation forced, are in the pull request's own description:
  https://github.com/damianvtran/local-operator-ui/pull/128 (the design document
  itself is not in this repository and is not published here).
