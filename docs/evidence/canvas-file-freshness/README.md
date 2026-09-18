# Canvas file freshness

Eleven frames from the **real built app**, driven by the repo's own harness
(`scripts/renderer-driver.mjs --scene canvas-freshness`): six of the document
line this change adds and of the behaviour behind it, and five added later on
the same surface by the same command, of the CLOSE (below).

Provenance: the six freshness frames were captured from a built app on
`78e46042b` - the commit that gives the note its floor and lets the stamp
ellipsise - so that is the tree their pixels came from, and the manifest entry's
`capturedAtHead` names it. The manifest's
`srcTree`/`scriptsTree` are a different pair by design: the manifest test binds them to the trees of the commit the manifest ships in, and the fold that
followed re-serialised this entry without touching a pixel.

The five **close** frames (`close-clean`, `close-settled`, `close-held`,
`close-held-after`, `close-reopen`) were captured from the tree of `f04baecf3`,
the commit that carries the fix they are about and the scene phase that drives
it - which is the head the manifest entry's `capturedAtHead` names, with the six
earlier frames' own tree (`1c5fae31d`) recorded in the same entry's
`closePassNote`. They were taken once and then RE-TAKEN, after this branch folded
onto `origin/main` = `e3f9fec32` (the 0.29.1 release), because the fix itself
gained a write-time materialisation cache in between; the fold moves nothing
they show either - `git diff 896b19134..e3f9fec32` over the canvas components,
`chat-content.tsx` and `canvas-store.ts` is empty, and the two bases differ only
in `package.json`'s version line. Four of the five frames came back
byte-identical on the re-run (`shasum -a 256`), and the two that did not are the
two whose stamp renders the app's own write time rather than the file's fixed
epoch - a wall-clock string in the picture, not a change of state.

They exist because the claims under review are claims about a running
application, and a unit test with a fake bridge cannot reach any end of them:

- a file written **by another process, on disk**, while its tab is open has to
  appear with no interaction. Only a real `statSync` in main, a real `readFile`
  over IPC and a real mount can show that;
- the rewrite that matters most is the one no probe can see - same mtime,
  different bytes - so its only witness is a frame before and after a press;
- "the tab that is not on screen is left alone" is a claim about what does NOT
  happen, which is why the run counts the app's own `fs` calls rather than
  trusting a frame;
- the HTML viewer renders a URL the **backend** serves, inside an iframe, so the
  store write alone changed nothing on screen until this round: its proof is a
  request, and the frame is what that request produced.

| frame | what it shows |
| --- | --- |
| [`before/localOperatorDark.webp`](before/localOperatorDark.webp) | The document opened from disk: the line reads the file's own mtime, rendered in the capturing machine's local timezone (the exact string tracks the capture's own clock, so it is not quoted here) with the re-read control at the right, above the markdown toolbar. The editor holds `first-version`, which is what the file says. |
| [`after/localOperatorDark.webp`](after/localOperatorDark.webp) | The same tab after a rewrite whose mtime was restored to the value the app already held - a write the two-second poll cannot see, because the mtime is what decides. The press on the re-read control is what applied it, the editor now holds `third-version`, and the row's register says `Re-read`. |
| [`activation/localOperatorDark.webp`](activation/localOperatorDark.webp) | Two tabs, the second document on screen, and `notes.md` re-selected after its file was rewritten off screen. The switch applied the new bytes (`fourth-version`) and the line moved with them. The off-screen window is where the run counted **0 probes** for this document and 2 for the one on screen. |
| [`held/localOperatorDark.webp`](held/localOperatorDark.webp) | **The state this round is about**: a code document with the reader's unsaved edits in the editor, the file rewritten from outside, and the row saying `Changed on disk — load it, or save to replace it.` beside the file's mtime The sentence is on screen in full, with no ellipsis - which is design round 3's D10 and UX round 3's U10, both measured against this frame's own row: the region is 607px and the sentence is 49 characters, so the way out fits beside the stamp instead of hiding behind a scrollbar. The window this frame is taken in is the heart of QA round 3's Q9: no in-app write reached the file for 4.2s (two polls, four debounce windows), asserted by comparing the file's sha256 before and after. The same phase then presses the control and asserts the file is still the EXTERNAL version - the press that used to destroy the version it was loading - and finally drives a real Meta+S and asserts the reader's bytes are the ones on disk. |
| [`html-before/localOperatorDark.webp`](html-before/localOperatorDark.webp) | An HTML document in the viewer whose bytes the BACKEND fetches, showing `html-first-version` and the file's mtime. The viewer's own bar carries one control now - the Edit toggle - because its separate reload button was dropped (design round 2, D8): the row's press re-keys the iframe below, so the two were the same action 32px apart. |
| [`close-clean/localOperatorDark.webp`](close-clean/localOperatorDark.webp) | **The reported bug, at the moment before the press.** Two tabs, the selected one (`close-clean.md`) carrying the ✕ this frame's phase is about to press - revealed on the selected tab, which is where a reader's pointer goes. The strip is deliberately this small: the earlier phases leave six documents open, and with those the strip scrolls, which puts a tab's ✕ under the strip's pinned overflow control. The driver's own `press` reported exactly that (`hitTest: false`, naming the overflow button as the element at the point) before this phase closed those six first, so every press it asserts on now carries `hitTest: true` - a claim about where a reader's click lands, not only about a dispatched event reaching the handler. |
| [`close-settled/localOperatorDark.webp`](close-settled/localOperatorDark.webp) | **A closed tab stays closed.** The same window **4.2 seconds after** the press on that ✕ - past the markdown editor's three-second debounce and two of the pane's two-second polls, which is the window the bug lived in: the close itself was always correct (the tab left `files` at the press), and the viewer's UNMOUNT commit is what put the document back, so a frame taken at the press would have proved nothing. `close-clean.md` is still absent from the strip, its ✕ is gone from the DOM, and the app's own persisted `canvas-store` snapshot holds no document and no tab for it - the run asserts all three. What is left is the second subject, `close-held.md`, selected and showing `held-version`. |
| [`close-held/localOperatorDark.webp`](close-held/localOperatorDark.webp) | The second subject in the state that makes the asked-for promise interesting: a dirty buffer - the reader's own `CLOSEREADER` (already written through the gate) and `CLOSEDIRTY` (not) - over a file rewritten from outside, so the row says `Changed on disk — load it, or save to replace it.` This is the tab the next press closes, and the state its words have to survive. |
| [`close-held-after/localOperatorDark.webp`](close-held-after/localOperatorDark.webp) | The HELD tab closed too: the strip is empty and the pane is back to its own empty state, 1.5s after the press. The run asserts the file's sha256 either side of that press - it is still the EXTERNAL version, nothing was written over the version the app refused to overwrite - and that the store lists neither the document nor a tab for it. This is the half the old upsert was reaching for and getting wrong: the words had to be kept, and the tab had to stay closed. |
| [`close-reopen/localOperatorDark.webp`](close-reopen/localOperatorDark.webp) | **What the promise actually is.** The same PATH opened again in the same session, the way the files grid opens a document: the file is re-read (the store's copy is the external version), and the canvas is handed the buffer owner's words instead - `held-versionCLOSEREADERCLOSEDIRTY` is back on screen, under a row that still says the file moved on, with the re-read control beside it. The run asserts the row's sentence, that the external body is NOT what the editor shows, and that the store's own copy is still the FILE's version - the projection is a read, not a second `files`. The promise is a session one (the words do not survive a restart, and the same boundary applies to an OPEN held document, which the module suite measures); that is stated on `documentsForCanvas` and in the pull request. |
| [`html-after/localOperatorDark.webp`](html-after/localOperatorDark.webp) | The same viewer after the file was rewritten from outside: `html-second-version` is on screen, the line moved with it, and the row says `Re-read` (its ANSWER register, which now retires after 8s rather than standing for ever). This is code review round 1's M1, which the store write alone could not reach: before the fix the line moved, the store held the new bytes, and the preview kept showing the old document. The run asserts the re-fetch directly as well - a new request for `panel.html` appears on the renderer's own request log - because the iframe is cross-origin from the app and its DOM cannot be read back. |

All eleven are full-window frames of an **isolated** run: a scratch `HOME`, a
scratch `LOCAL_OPERATOR_CONFIG_DIR`, a scratch `--user-data-dir`, the app's own
`headless` window mode (never shown, never focusable), `CMUX_*`/`LOP_*` stripped
from the child environment, and a backend this run started and reaped itself. The
sidebar's session list is empty and the conversation is a staged draft, so
nothing in these frames is the operator's data. The window is 1380x900 and the
frames are the app photographing itself with `webContents.capturePage()`.

## What produced these frames

**Both passes** - the six freshness frames and the five close frames - came from the
same command, the same scene and the same isolation; the close phase is simply the
scene's last, so one run produces the whole set:

`scripts/renderer-driver.mjs --scene canvas-freshness`, against a live, isolated
`lop serve` this run owns. The renderer has to have been built against that
backend's URL (the address is inlined at build time). The run RECORDS the URL the app
reports at boot rather than asserting it - that value is adopted at runtime, so a check
against the build flag is phase-dependent (it passed on three runs and failed on a fourth
of one tree, with every app claim passing) - and asserts the wiring instead: the app holds
a connection to this run's backend and to nothing else, which is the isolation claim:

```bash
# 1. build the renderer against the port the scratch backend will listen on
env VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:54881 \
  npx dotenv-cli -e .env -- pnpm build

# 2. a scratch backend, with a token only this run holds
export LOCAL_OPERATOR_CONFIG_DIR=$(mktemp -d)/config
export LOCAL_OPERATOR_DESKTOP_TOKEN=<64 chars, never printed>
lop serve --port 54881 &            # its record lands in $LOCAL_OPERATOR_CONFIG_DIR/run/serve

# 3. the scene, which writes the subject files itself
node scripts/renderer-driver.mjs --scene canvas-freshness \
  --backend http://127.0.0.1:54881 \
  --backend-records "$LOCAL_OPERATOR_CONFIG_DIR/run/serve" \
  --seed-onboarding-complete \
  --out /tmp/canvas-freshness-frames --clean
```

Two harness accommodations are worth knowing, because neither is a property of
the app and both are visible from outside:

- **The CSP is widened in the BUILD OUTPUT.** The renderer's `frame-src` names
  the operator's own `:1111` hosts and this run's backend is on a port picked for
  it, so the HTML viewer's iframe is refused before a request is made (`src/` is
  untouched and `out/` is gitignored; the run says what it widened). The
  `mentioned-files-app` rig records the same accommodation for its media frames.
- **The probe counter is installed in MAIN.** The page cannot be counted from
  itself (`window.api` is a `contextBridge` object, so a wrapper assigned over one
  of its properties is silently ignored - measured, and it is why this scene's
  first version read zero for a run in which probes happened), so the run launches
  with `--inspect=<port>` and wraps the `fs` calls `probe-files` makes, limited to
  the run's own scratch root. Every run PROVES the instrument before measuring: a
  probe issued from the renderer through the app's own bridge must appear in the
  log (`{"before":2,"after":3,"counted":true}` in the captured run).

The scene writes its subject files (`notes.md`, `report.py`, `panel.html`) and
sets their mtimes explicitly - to a FIXED epoch, not to `Date.now()` - so every
claim in it is exact rather than clock-dependent and the frames reproduce
byte-for-byte on a re-run (measured: two runs on a folded head produced identical
PNGs, `shasum -a 256`). It fails rather than skips if any claim does not hold.
The run's own output is quoted on the pull request.

## What it does not show

- **The Files-grid press that opens a document again.** The close pass reopens the
  held document with the driver's own `openCanvasDocument` verb, which is what every
  document in this scene is opened with: in a run whose conversation has no
  transcript there are no grid tiles to press. The verb is built from the same
  pieces the tile's click handler uses (the probe's mtime, the `viewerFor`/
  `READ_ENCODING` table, `readFile`, `canvasDocumentForPath`) and reads the file's
  bytes exactly as that handler does, so what is missing is the grid's own
  branching and its toasts - which this change does not touch. The scene's own
  comment states this rather than implying a pressed tile.
- **A restart.** The words a refused write could not save survive the session, and
  the frames above are the session; the promise's other side - that the registries
  holding them are module state, and that an OPEN held document loses the same
  words at the same moment - is measured in `scripts/canvas-tab-close.test.mjs`,
  which is where a restart can be simulated at all.
- **A genuinely hidden window.** The run's renderer reports
  `document.visibilityState === "visible"` (a headless Electron window is not a
  hidden one), so the `visibilitychange` half of the trigger cannot be produced
  here. The check it guards is the same check the poll runs, and the `hidden`
  half is asserted in `scripts/canvas-file-freshness.test.mjs` at the level the
  decision lives at.
- **A real reader's typing, and what it does to the FILE.** The scene types through
  the app's own input pipeline (`typeText`, one dispatch per character) on every
  surface it covers, and the module suite drives the dirty-buffer rules against the
  shipped modules (`scripts/canvas-file-freshness.test.mjs`). From round 5 the scene
  also asserts the file's BYTES around each resolution - the press, the explicit
  save, and the cross-document phase - because a check on the screen said nothing
  about what a control did to the file underneath it, which is exactly how a press
  that destroyed the file's version stayed green.
- **The other byte viewers.** Every document in the canvas gets the line and the
  control, and pdf/image/audio re-read by moving the object URL's cache key while
  video re-keys on both of the document's version fields - the same store write
  the tests assert, not a second mechanism. Nothing here plays a video or paints a
  PDF: this set trades those for the HTML case, which was the one viewer kind the
  store write could not reach at all.
