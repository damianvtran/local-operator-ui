# Canvas file freshness

Fifteen frames from the **real built app**, driven by the repo's own harness
(`scripts/renderer-driver.mjs --scene canvas-freshness`): six of the document
line this change adds and of the behaviour behind it, and nine added later on
the same surface by the same command, of the CLOSE (below).

Provenance: the six freshness frames were captured from a built app on
`78e46042b` - the commit that gives the note its floor and lets the stamp
ellipsise - so that is the tree their pixels came from, and the manifest entry's
`capturedAtHead` names it. The manifest's
`srcTree`/`scriptsTree` are a different pair by design: the manifest test binds them to the trees of the commit the manifest ships in, and the fold that
followed re-serialised this entry without touching a pixel.

The nine **close** frames were re-taken, whole set, from the tree that ships them:
the five that were already here (`close-clean`, `close-settled`, `close-held`,
`close-held-after`, `close-reopen`) plus the four the first review rounds asked
for - `close-kept` (what a close whose write fails now says), `close-neighbour`
and `close-preceding` (where a close leaves the reader, both arms of the rule),
and `close-overflow` (the selected tab's ✕ in a strip that scrolls). Every one of
them came out of ONE run of the scene, which is also the run that produced the six
frames above; the six are left as they were captured (`1c5fae31d`), and the entry's
`capturedAtHead` names this branch's head, the tree the nine came from.

The re-take is not tidiness. Three of this round's changes move pixels the old set
showed: the tab a close selects (D1) and the focus that moves with it (D3/U2), the
strip's own scroll target (U3), and the sentence a failed write now raises (U1).
The close-pass story from the earlier fold - the write-time materialisation cache
that made the five byte-different, `shasum -a 256` on the re-run - is kept below in
the manifest entry, which is where a reader checks provenance.

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
| [`close-settled/localOperatorDark.webp`](close-settled/localOperatorDark.webp) | **A closed tab stays closed.** The same window **4.2 seconds after** the press on that ✕ - past the markdown editor's three-second debounce and two of the pane's two-second polls, which is the window the bug lived in: the close itself was always correct (the tab left `files` at the press), and the viewer's UNMOUNT commit is what put the document back, so a frame taken at the press would have proved nothing. `close-clean.md` is still absent from the strip, its ✕ is gone from the DOM, and the app's own persisted `canvas-store` snapshot holds no document **and no tab** for it - the run asserts all three, `openTabs` included (agent review round 1, M1, which is what the third read is for). What is left is the second subject, `close-held.md`, selected and showing `held-version`. |
| [`close-kept/localOperatorDark.webp`](close-kept/localOperatorDark.webp) | **What a close that could not write the reader's words says about it** (UX round 1, U1). The held document has just been closed, the pane is on its empty state, and the app's own toast carries the sentence: `Closed close-held.md. Your edits could not be saved, and are kept until the app quits — opening it again brings them back.` The words are in the sentence because a boundary the reader cannot read is one they will get wrong: the registries that hold them are module state, so "kept" means until the app quits. The run asserts the toast's text against `close-copy.ts` - parsed out of the module rather than spelled out a second time in the scene - and asserts that a CLEAN close raises no toast at all, so the message is a report and not a reflex. This is the one frame in the set that is meant to have a toast on it: every other one is captured with `captureSettled`, which waits for the app's toasts to clear. |
| [`close-neighbour/localOperatorDark.webp`](close-neighbour/localOperatorDark.webp) | **Where a close leaves the reader** (design review round 1, D1; UX round 1, U2). Four documents of this phase's own, because with two tabs "first" and "neighbour" are the same tab and this defect is invisible: the middle tab (`neighbour-b.md`) was selected, its ✕ pressed, and the reader is on `neighbour-c.md` - the tab that took its place - with the focus ring on it, rather than on `close-held.md`, the oldest document open. The run reads the strip's own `aria-selected`, the store's `selectedTabId` and `document.activeElement`, so the landing and the focus are asserted where the reader would see them. On the `origin/main` this branches from, the same press lands on the FIRST tab (`typing.py`, the oldest open) and focus falls to the document body - measured, same scene, same command, same daemon. |
| [`close-preceding/localOperatorDark.webp`](close-preceding/localOperatorDark.webp) | **The rule's other arm.** The last tab (`neighbour-d.md`) closed, and the reader is on the one before it - the preceding tab, not the oldest one. Both arms are asserted in the driven run, and the module suite asserts the rule itself on the shipped `tabFollowingClose` (`scripts/canvas-tab-close.test.mjs`, case (a3)). |
| [`close-overflow/localOperatorDark.webp`](close-overflow/localOperatorDark.webp) | **The selected tab's ✕ in a strip that scrolls** (UX round 1, U3). Eleven documents open, the strip `scrollWidth > clientWidth`, and the selected tab - `many-8.md`, rightmost - showing its ✕ inside the strip's own box. Measured in the run: `{"visiblePx":20,"widthPx":20,"hitIsControl":true,"atCentre":"Close many-8.md"}` - the pixel at the ✕'s centre is the ✕, so a press there closes the document the reader is on. Before this round the strip scrolled the tab's LABEL into view while the ✕ is its sibling, and the same measurement on the base answered `visiblePx 0` with `atCentre: "All open files"`: the reader aiming at the close opened the overflow menu, which cannot close anything. |
| [`close-held/localOperatorDark.webp`](close-held/localOperatorDark.webp) | The second subject in the state that makes the asked-for promise interesting: a dirty buffer - the reader's own `CLOSEREADER` (already written through the gate) and `CLOSEDIRTY` (not) - over a file rewritten from outside, so the row says `Changed on disk — load it, or save to replace it.` This is the tab the next press closes, and the state its words have to survive. |
| [`close-held-after/localOperatorDark.webp`](close-held-after/localOperatorDark.webp) | The HELD tab closed too: the strip is empty and the pane is back to its own empty state. This frame is the SETTLED one - captured after `close-kept`'s toast has retired, which is why the report is a separate frame rather than a line in this one. The run asserts the file's sha256 either side of that press - it is still the EXTERNAL version, nothing was written over the version the app refused to overwrite - and that the store lists neither the document nor a tab for it, and that the close's own writes never re-list it. This is the half the old upsert was reaching for and getting wrong: the words had to be kept, and the tab had to stay closed. |
| [`close-reopen/localOperatorDark.webp`](close-reopen/localOperatorDark.webp) | **What the promise actually is.** The same PATH opened again in the same session, the way the files grid opens a document: the file is re-read (the store's copy is the external version), and the canvas is handed the buffer owner's words instead - `held-versionCLOSEREADERCLOSEDIRTY` is back on screen, under a row that still says the file moved on, with the re-read control beside it. The run asserts the row's sentence, that the external body is NOT what the editor shows, and that the store's own copy is still the FILE's version - the projection is a read, not a second `files`. The promise is a session one (the words do not survive a restart, and the same boundary applies to an OPEN held document, which the module suite measures); that is stated on `documentsForCanvas` and in the pull request. |
| [`html-after/localOperatorDark.webp`](html-after/localOperatorDark.webp) | The same viewer after the file was rewritten from outside: `html-second-version` is on screen, the line moved with it, and the row says `Re-read` (its ANSWER register, which now retires after 8s rather than standing for ever). This is code review round 1's M1, which the store write alone could not reach: before the fix the line moved, the store held the new bytes, and the preview kept showing the old document. The run asserts the re-fetch directly as well - a new request for `panel.html` appears on the renderer's own request log - because the iframe is cross-origin from the app and its DOM cannot be read back. |

All fifteen are full-window frames of an **isolated** run: a scratch `HOME`, a
scratch `LOCAL_OPERATOR_CONFIG_DIR`, a scratch `--user-data-dir`, the app's own
`headless` window mode (never shown, never focusable), `CMUX_*`/`LOP_*` stripped
from the child environment, and a backend this run started and reaped itself. The
sidebar's session list is empty and the conversation is a staged draft, so
nothing in these frames is the operator's data. The window is 1380x900 and the
frames are the app photographing itself with `webContents.capturePage()`.

## What produced these frames

**Both passes** - the six freshness frames and the nine close frames - came from the
same command, the same scene and the same isolation; the close phase is simply the
scene's last, so one run produces the whole set. The run quoted on the pull request
reported `ALL CHECKS PASSED` over 109 checks with all fifteen frames captured:

`scripts/renderer-driver.mjs --scene canvas-freshness`, against a live, isolated
`lop serve` this run owns. The renderer has to have been built against that
backend's URL (the address is inlined at build time). The run RECORDS the URL the app
reports at boot rather than asserting it - that value is adopted at runtime, so a check
against the build flag is phase-dependent (it passed on three runs and failed on a fourth
of one tree, with every app claim passing) - and asserts the wiring instead: the app holds
a connection to this run's backend and to nothing else, which is the isolation claim:

```bash
# 1. build the renderer against the port the scratch backend will listen on
#    (the four VITE_* client ids the build refuses to start without are stubbed for
#    this run rather than read out of the operator's own .env - see the
#    accommodations below)
env VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:54881 \
  VITE_DISABLE_BACKEND_MANAGER=true \
  VITE_GOOGLE_CLIENT_ID=canvas-close-evidence \
  VITE_GOOGLE_CLIENT_SECRET=canvas-close-evidence \
  VITE_MICROSOFT_CLIENT_ID=canvas-close-evidence \
  VITE_MICROSOFT_TENANT_ID=canvas-close-evidence \
  pnpm build

# 2. a scratch backend, with a token only this run holds
#    (keep it in a 0600 file: the driver requires the SAME token in its own
#    environment, and it must never be printed)
export LOCAL_OPERATOR_CONFIG_DIR=$(mktemp -d)/config
export LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32)
lop serve --port 54881 &            # its record lands in $LOCAL_OPERATOR_CONFIG_DIR/run/serve

# 3. the scene, which writes the subject files itself
node scripts/renderer-driver.mjs --scene canvas-freshness \
  --backend http://127.0.0.1:54881 \
  --backend-records "$LOCAL_OPERATOR_CONFIG_DIR/run/serve" \
  --seed-onboarding-complete \
  --out /tmp/canvas-freshness-frames --clean
```

Four harness accommodations are worth knowing, because none is a property of
the app and all are visible from outside:

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
- **The four `VITE_*` client ids are stubbed for the BUILD.**
  `scripts/vite-plugins/replace-backend-config.ts` refuses to configure the build
  unless `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET`,
  `VITE_MICROSOFT_CLIENT_ID` and `VITE_MICROSOFT_TENANT_ID` are set, and the
  operator's own `.env` has them; this run stubs all four with
  `canvas-close-evidence` instead of reading that file, because a scene that never
  signs in with either provider has no use for a real one and the run's isolation
  claim is easier to believe when the renderer was built from nothing private. It
  changes what the app can do (no OAuth sign-in) and nothing this scene shows.
- **The frames are converted from the app's own captures.** The driver writes PNGs
  through `webContents.capturePage()`; the committed frames are WebP at quality
  88, the same encoding the Storybook sweep uses (`capture-evidence.mjs`'s
  `Page.captureScreenshot` call), converted with sharp and then validated with the
  repo's own `assertFramePaints` guard over the files that were committed.

THE WRITE LOG, in the close phase, is the third instrument here and the one this
round added (QA round 1, Q1). It records every write of the `canvas-store` key with
its `files` and `openTabs` ids and its selected tab, wraps `Storage.prototype.setItem`
in the page, and is PROVED before it is trusted - the two `openCanvasDocument` opens
must appear in it. It exists because the close's harm is a write ORDER and the scene's
two readings (at the press, and 4.2s later) are both correct on the tree without the
fix: the phase now asserts that the close reaches the store as a write that drops the
document from `files`, from `openTabs` and from the selection, and that NO later write
re-lists it. On `origin/main` that second assertion fails, on the unmount commit's own
upsert - which is the flicker the reader reported, as a write that does not happen.
That is what makes this set a comparison rather than a set of stills: the same scene,
the same command and the same daemon were run against the base as well, and every
finding this round fixes fails there (the rows are quoted on the pull request). The
same window on the base also shows the closed document STILL re-listed when the settle
frame is taken, so a settled read sees it there too on this base - which is why the
settle check fails on it.

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
- **The hold sentence itself, as a photograph.** The boundary this round adds - `kept
  until the app quits` - is in `FACT_DETAIL["disk-changed"]`, which is the row's
  TOOLTIP and the control's accessible description, not the visible line (that one is
  width-budgeted and has no room for it). The scene has no hover verb, so it is not
  photographed: it is asserted in `scripts/canvas-file-freshness.test.mjs`, pinned as
  copy the way the rest of the row's sentences are, and the close - where the reader
  actually needs it - is the `close-kept` frame.
- **The pre-fix arm is a copy of the SCENE, not of the app.** The failure rows quoted
  on the pull request came from `origin/main`'s own build, driven by the same scene
  file, copied into a detached worktree at the base with the one module the scene
  PARSES for the close's sentence (`close-copy.ts`, added by this branch). The app under
  test is entirely the base's; the harness is entirely this branch's, which is what
  makes the two runs comparable.
- **The other byte viewers.** Every document in the canvas gets the line and the
  control, and pdf/image/audio re-read by moving the object URL's cache key while
  video re-keys on both of the document's version fields - the same store write
  the tests assert, not a second mechanism. Nothing here plays a video or paints a
  PDF: this set trades those for the HTML case, which was the one viewer kind the
  store write could not reach at all.
