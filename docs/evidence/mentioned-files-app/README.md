# The Files panel's producer, and the PDF viewer it opens

Two frames from the **real built app**, on a real backend, over a real
transcript — and not one byte of the operator's own data. They exist because the
claims under review are claims about a running application:

- the panel's content is *inferred* from the transcript rather than carried on
  the wire, so nothing in `test:desktop` can show that a path an agent wrote
  becomes a tile;
- the PDF viewer is Chromium's own, over a blob URL, and the only thing that
  proves a PDF renders is pixels.

| frame | what it shows |
| --- | --- |
| [`files-panel/localOperatorDark.webp`](files-panel/localOperatorDark.webp) | The producer fired: five mentioned paths became five tiles — `notes.txt`, `invoice-review.pdf`, `ledger-summary.png`, `ledger.csv`, and `march-export.csv` carrying the **`Not found` receipt** because no file backs it. |
| [`pdf-viewer/localOperatorLight.webp`](pdf-viewer/localOperatorLight.webp) | Clicking the PDF tile opens the document in Chromium's viewer under **our own chrome bar** (the filename, and a way out to the OS) — two pages, `1 / 2`, 60% — with no CSP violation on the PDF path. |

Both are **clipped to the canvas panel** (`[data-tour-tag="canvas-container"]`'s
own measured rect), so neither carries the sidebar, the session list or the
transcript. That is the point of the isolation below, and it is checked rather
than intended: the driver writes the un-cropped window frame beside the cropped
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
encoded with `zlib` so two runs are byte-identical, a CSV and a `.txt`. The
fifth path exists only as text — it is the ghost that exercises the availability
probe. The session is one seeded `transcript.jsonl`
(`out/evidence-harness/seed-mentioned-files.mjs`) whose assistant turn names
those paths in prose, which is the strictest admission tier the extractor has
(absolute path **and** a known extension), plus one `file://` URL for the
second tier.

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
mentionedFilesWritten 5   (text, pdf, image, spreadsheet, spreadsheet/missing)
filesGrid             notes.txt | invoice-review.pdf | ledger-summary.png |
                      ledger.csv | march-export.csv (Not found)
pdfTileClicked        true
pdfFrame              iframe[src^="blob:"], title "PDF: invoice-review.pdf",
                      chrome bar "invoice-review.pdf", cspViolations []
```

## Why these are a declared set rather than swept frames

`check-evidence.mjs` counts everything outside a declared `supplementary` set as
the sweep's own, so a set that belongs to another producer has to say so:

- **The PDF frame cannot come from the sweep.** Headless Chrome — what
  `scripts/capture-evidence.mjs` drives — has no PDF viewer at all; it renders a
  bare `application/pdf` document with no body. This is a fact about the
  harness, measured in the design note's Appendix A, not about our code.
- **The panel frame cannot come from the sweep either.** Its tiles are paths a
  transcript mentioned and its thumbnails come from the backend's static route;
  Storybook has neither. The sweep's `canvas-workspace--files` frame shows the
  same grid from a fixture and says so, with the PNG tile's thumbnail missing —
  which is exactly why the panel's real reading comes from here.

## Known artifacts, all of them about the harness

Each of these is visible in the frames and none is a defect in the code under
review. They are listed so a reader does not have to reverse-engineer them:

1. **The app's own "The server is offline" strip** runs across the top of both
   frames. The renderer bakes its REST base URL at build time, and the app's CSP
   (`src/renderer/index.html`) pins `connect-src` to the literal
   `localhost:1111` / `127.0.0.1:1111` / `:8080` hosts, so the renderer's legacy
   health poll to the isolated port is refused while every desktop operation
   goes through the main process, which is not subject to that CSP. The same
   strip is present in the `chat-title` frames under the same setup, and it is
   unrelated to this change.
2. **The PNG tile has no thumbnail.** Same cause, one directive along: `img-src`
   names only the `:1111` hosts, so the tile's thumbnail — which the grid builds
   from the renderer's REST client — cannot be fetched from the isolated
   backend, and the tile paints its name over an empty box. The tile's own claim
   (a `.png` is classified as an image and gets a tile) is unaffected; the
   thumbnail route against the app's configured backend is exercised by
   `scripts/mentioned-files-app-proof.mjs` on the live backend.
3. **Chromium's PDF toolbar is dark in the light-brand frame**, and that is not
   a theming miss: the platform's viewer draws its own chrome, is not
   addressable from our DOM, and is therefore an accepted platform object. What
   we own is the strip above it, which is themed: `invoice-review.pdf` and the
   open-in-OS control on `surface` under our hairline rule. This is design-note
   risk #1, measured here rather than argued.
4. **The PDF frame is the light brand palette** while the panel frame is the
   dark one. `check-evidence.mjs` asserts every frame's dominant colour is one of
   its own theme's grounds — how it catches a surface that painted nothing — and
   a PDF's paper is white, which no dark palette's ground is near. The document
   frame is therefore captured in the palette it is honestly a picture of,
   rather than cropped or zoomed until the checker stops looking.

## Provenance

- `capturedAt` / `capturedAtHead`: the head that the built `out/` and the
  seeded fixture were taken at, recorded in `manifest.json` beside this set.
- App assertions that the frames cannot show: `cspViolations` is empty for the
  PDF path — the `<iframe src="blob:…">` variant is the one the CSP permits, and
  the `<embed>` variant the design note's probe found blocked is not used.
- The viewport is 1728x966 at device ratio 2, wider than the app's 1380x900
  default on purpose: at the default the Files grid's fourth column and the PDF
  page both fall outside the panel crop. The window size is a harness knob
  (`LOCAL_OPERATOR_UI_WINDOW_SIZE`), not a change to the app.
