# `/btw` aside — QA round 1 (independent), PR #482

Frames from the **independent QA pass** on the running stack, taken at
`feat/btw-aside-panel` = `ffa9ce94dbb917ee06223221b033a6346a60792b` (verified with
`git rev-parse HEAD` in a worktree of its own, `~/local-operator-ui-worktrees/qa-btw-482`).

**These are a SECOND pass.** The frames one level up (`after-*.png`, `after-narrow-*.png`,
`before-*.png`) are the **pre-remediation** capture at `415b38242`; nothing here replaces
them, and the names carry the pass so a reader can tell the two apart:

| Prefix | Pass | Tree |
| --- | --- | --- |
| `after-*`, `before-*` (one level up) | evidence pass, **before** the remediation push `b44123d6e` | `415b38242` / `ff064112f` |
| `qa-wide-*`, `qa-narrow-*`, `qa-wrongid-*`, `qa-reload2-*` (this directory) | **this** independent QA round, after the remediation | `ffa9ce94d` |

## What this round is FOR (the two things the first pass could not do)

1. **Does the panel still STREAM after the stream was made subscription-targeted?** The
   backend now publishes `aside_delta` only to the subscription the ask names, and the panel
   sends `canonical.subscriptionId` with the ask. A stale, wrong or absent id would leave the
   panel with no chunks and only the settled answer — which a still frame cannot show.
2. **Execute the adopt for real**, and exercise the refusal while the session is streaming.

## The rig

* the scripted provider (`stub_provider.py`) and the REAL daemon from the companion worktree
  `~/local-operator-worktrees/aside-guard` (`fix/btw-aside-tool-call-guard` at `ed8b2831`),
  each on an **OS-chosen** port (`--port 0`);
* **my own instrumented proxy** on **8080** (the only port left that
  `src/renderer/index.html`'s `connect-src` allows besides 1111, which is the operator's own
  backend and is never bound). It forwards unbuffered, mirrors the serve record, counts
  `aside_delta` occurrences in the SSE stream, logs the `subscription_id` each aside POST
  named, and can rewrite that id for one marked question (`WRONGID`) — the fault is injected
  in the rig, never in the app;
* 8080 is checked free immediately before the bind, and the whole rig is released by exact
  pid when the capture command returns (`8080 released before this command returned`);
* the app is the BUILT bundle of the head commit, launched by the repo's own driver in
  `--window-mode=headless` (never shown), frames written by `webContents.capturePage()`:
  `node scripts/renderer-driver.mjs --scene btw-qa --backend http://127.0.0.1:8080 …`.
  No browser engine was installed, no `browser` tool, no `screencapture`.

Per capture: one command boots the rig, runs one scene, reaps everything. Passes:

| Pass | Command |
| --- | --- |
| wide | `--scene btw-qa --run-label wide --window-size 1380x900` |
| narrow | `--scene btw-qa --run-label narrow --window-size 700x900` (the app clamps the content viewport to 800x868) |
| wrong-id | `--scene btw-qa-wrongid --run-label wrongid` |
| adopt | `--scene btw-qa-adopt-reload --run-label reload2` |

Theme `localOperatorDark` (the scenes call the app's own `setTheme`), dpr 2.

## The frames

| Frame | Size | What it shows |
| --- | --- | --- |
| `qa-wide-01-aside-thinking.png` | 2760x1736 | the question on the panel, `thinking…`, adopt disabled — before any chunk |
| `qa-wide-02-aside-partial-a.png` | 2760x1736 | the answer **partially written** (28 of 245 characters) |
| `qa-wide-03-aside-partial-b.png` | 2760x1736 | the same answer later (57 characters) — the pair is the streaming claim |
| `qa-wide-04-aside-settled.png` | 2760x1736 | settled: the whole answer, adopt live with its `⌘+F` cap |
| `qa-wide-05-composer-typed-while-panel-up.png` | 2760x1736 | a line typed in the composer while the panel is up, caret and Send live |
| `qa-wide-09-empty-panel-bare-btw.png` | 2760x1736 | the **amended** empty copy (`Type a question in the composer below…` / `Nothing to add yet.`) |
| `qa-wide-11-adopt-refused-while-conversation-working.png` | 2760x1736 | adopt refused **while the session is mid-turn**, with the reason on the panel |
| `qa-wide-12-adopted-into-the-conversation.png` | 2760x1736 | the screen ~20s **after** the adopt: the panel is gone and the transcript has gained nothing |
| `qa-wide-13-panel-error.png` | 2760x1736 | the **amended** error state (the backend's refusal, adopt disabled, no repeated reason line) |
| `qa-wide-14-composer-after-the-refusal.png` | 2760x1736 | the composer still usable after that refusal |
| `qa-narrow-04-aside-settled.png` | 1600x1736 | **the re-captured ceiling at the narrow column** (the frame design round 1 asked for) |
| `qa-wrongid-neg-01-wrong-id-no-chunks-yet.png` | 2760x1736 | with a wrong subscription id: no chunks — the panel is still on `thinking…` while the answer is already written elsewhere |
| `qa-wrongid-neg-02-wrong-id-settled-in-one-piece.png` | 2760x1736 | the same exchange settled: the whole answer arrives at once from the POST |
| `qa-reload2-reload-01-ten-seconds-after-the-adopt.png` | 2760x1736 | 10s after the adopt, read every second: 0 rows |
| `qa-reload2-reload-02-after-re-entering-the-conversation.png` | 2760x1736 | after leaving and re-entering the conversation: still 0 rows |

## What these frames do NOT prove

* **Adopt's effect on the SCREEN is the open question** (see the PR comment): the frames show
  the screen, and the daemon was read separately over its own wire — the spliced exchange is
  in the session snapshot and in `/history` from the moment of the adopt.
* The wrong-id frame is a **fault injected by this rig's proxy** (a well-formed 32-hex id
  nobody holds). It is not a product state; it is the negative control for the streaming
  claim.
* `localOperatorDark` only, macOS only, a scripted provider (the answer's shape, length and
  pacing are the stub's), and none of this is a claim about a real model.
* A `headless` window cannot be focused, so focus rings and carets are outside what these
  stills can show; keyboard behaviour is asserted by driving keys and reading
  `document.activeElement`, not from pixels.

## Frame hashes (sha256, first 16 hex)

| Frame | sha256[:16] |
| --- | --- |
| qa-narrow-04-aside-settled.png | `e4c6d95679cf5ff0` |
| qa-narrow-09-empty-panel-bare-btw.png | `42e36c60f6523164` |
| qa-narrow-13-panel-error.png | `6f940c1d783553f4` |
| qa-reload2-reload-01-ten-seconds-after-the-adopt.png | `397dcc1d03db5f05` |
| qa-reload2-reload-02-after-re-entering-the-conversation.png | `25d9f4df4dc925ea` |
| qa-wide-01-aside-thinking.png | `401a1a887ee13695` |
| qa-wide-02-aside-partial-a.png | `8437128f52726f33` |
| qa-wide-03-aside-partial-b.png | `079110910a78e511` |
| qa-wide-04-aside-settled.png | `106c49bd8cdb965d` |
| qa-wide-05-composer-typed-while-panel-up.png | `2b5ede00573768bc` |
| qa-wide-09-empty-panel-bare-btw.png | `5c00e1872d369aff` |
| qa-wide-11-adopt-refused-while-conversation-working.png | `5fe8553ac4c60036` |
| qa-wide-12-adopted-into-the-conversation.png | `9ef767cce42c6238` |
| qa-wide-13-panel-error.png | `7638387dac179efb` |
| qa-wide-14-composer-after-the-refusal.png | `1d32175adb8cedc5` |
| qa-wrongid-neg-01-wrong-id-no-chunks-yet.png | `a7d35fd40d4fa268` |
| qa-wrongid-neg-02-wrong-id-settled-in-one-piece.png | `7f669eeb1f964cb3` |
