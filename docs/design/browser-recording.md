# Agent-callable browser recording (desktop host)

Decision record: the architect's `recording-design.md` (2026-10-29), carried into
this repository with its Decisions table verbatim below so the file and the code
it governs cannot drift apart. This document covers the DESKTOP host slice (PR-B:
`record_start` / `record_stop` in the Electron main process). The harness slice
(PR-C, `local-operator`) and the extension slice (PR-D, conditional) are not in
this repository.

Where it lives: `src/main/browser/actions/recording.ts` (state, capture, publish),
`src/main/browser/protocol.ts` (methods, budgets, capabilities),
`src/main/browser/host.ts` (dispatch and the two scoping sets),
`src/main/browser/cdp.ts` (`dropCaptures`, the one place every debugger boundary
ends a capture), `scripts/browser-recording.test.mjs` (the rule-level suite), and
the real-path driver recorded in the PR's evidence matrix.

## What the host promises

- A call to `record_start` names an absolute `.mp4` path the harness has already
  approved. The host refuses a relative path, a non-`.mp4`, a missing or
  unreadable parent, an existing file and a symlink — before it touches the tab.
- Without `width`/`height` the tab records at up to 1280x720 (a ceiling, not a
  promise: the clip is scaled to fit inside it), 10 fps, no audio (D14). A hidden
  agent tab recorded at exactly 1280x720; a presented 1380x868 view recorded at
  1144x720. Such a result reports no width or height.
- `width`/`height` ask for a REAL viewport (`Emulation.setDeviceMetricsOverride`
  applied before the recorder starts), and the clip is exactly that size: the
  probe decoded 854x480 through 10240x5760 at the requested dimensions and the
  page's own `innerWidth`/`innerHeight` matched. The request is refused before
  any CDP call unless both sides are even integers in 240..3840 and the area is
  at most 3840x2160. A sized result carries the measured `width`/`height`.
- A sized start waits for the tab to DRAW a frame at the new size before the
  recorder starts. The encoder captures the compositor's surface, not the DOM:
  starting as soon as `innerWidth` matched left the opening frames of large
  clips holding the old 1280x720 raster (QA Q1 — the old layout stretched across
  a 3840x2160 clip, and a 1280x720 patch on black at 2160x3840 and 3840x1080,
  while the clip was coded at the right size and its last frame was correct).
  Two `requestAnimationFrame` callbacks are that wait: 8-14 ms on a hidden view,
  bounded at 2 s, after which a tab that still has not drawn one is refused
  `record_size`/`not_applied` rather than recorded at the old layout. That wait
  only runs because `attach` enables `Emulation.setFocusEmulationEnabled`
  (`cdp.ts`); on a view the app never raises, the same evaluate never replied
  within 2.5 s without it.
- A sized start on the PRESENTED (user-visible) tab is refused: growing the user's
  own view to the requested size would cover the app around it. Tab close and
  detach drop the emulation with the debugger session; stop, abort, replace and a
  failed start clear it explicitly.
- `record_stop` writes the clip to the approved path and reports its byte count.
  A reported path always names a COMPLETE file: bytes go to a `.<name>.part`
  inode, are fsync'd, and are published with `linkSync`, which cannot overwrite.
  Every failure path unlinks the part, so no error leaves a partial or empty file.
  `duration_ms` is wall-clock time from start to stop; the container's own duration
  measured about 0.3-0.8 s longer (QA Q2).
- Audio is never captured, and no bytes cross the RPC wire (D3): the harness
  learns a path and a size, and verifies both from disk itself.
- Two recordings may run at once, app-wide (D6). A third is refused with `busy`.

## What the host cannot promise

- A recording that outlives its harness session only exists on a RETAINED tab, and
  even there it ends at the duration cap. `owner_finish` closes owned tabs, and a
  closed tab's clip is gone (proven by PID: the encoder exits).
- A hard kill (SIGKILL) leaves no file, because nothing touches disk until stop.
- A debugger detach EVENT (DevTools taking the tab, or the page going away) discards
  the clip and leaves a `record_aborted` tombstone for the next `record_stop`; the
  bytes are not salvaged (D7). The tombstone does not name a cause: Electron 45.1.0
  emits the constant reason `"target closed"` for every detach, DevTools included,
  so the wording is neutral and quotes the raw reason. A forced renderer crash
  (`Page.crash`) with no stop in flight does NOT detach the debugger (QA case A8):
  a later `record_stop` answered normally and published a playable 8.1 s clip, so a
  crashed page is not a discarded clip. An abort that lands while a stop is saving
  stops the save: nothing is published after the tombstone says nothing was
  written.
- The origin is checked ONCE, at start. A page that navigates itself to an
  unapproved origin while the clip is running is captured until the stop. The
  result-side check discards a capture whose document changed during the START
  itself, and stops the engine's recorder before the refusal returns (review
  N5/F1); it does not re-check per frame, and it cannot: the capture is one
  continuous stream, not a series of reads.

## Frozen contract (D8)

No `PROTO_VERSION` bump: the methods are additive and capability-gated.

```
record_start  {tab, requester, label.., path (abs, *.mp4), max_duration_s 1..600, max_bytes <= 64 MiB,
               width?, height? (ints, both or neither, even, 240..3840, area <= 3840*2160)}
              -> {recording:true, path, max_duration_s, max_bytes, fps:10, container:"mp4", codec:"av1",
                  width?, height? (only when the call was sized)}
record_stop   {tab, requester}
              -> {path, bytes, duration_ms, auto_stopped:bool, fps, container, codec, width?, height?}
errors        code + data.reason (reasons below); Python renders copy by reason, host `message` is the fallback.
```

Reason values carried in `data.reason`: `record_unsupported` (Chromium < 153 or
"not found" from start), `record_av1_unavailable`, `record_failed` (any other
start or stop failure; Chromium's text verbatim), `record_path`, `record_size`
(`param` in width/height/size, `why` in incomplete/range/odd/area/visible/
not_applied), `record_active` (`busy`), `record_not_active`, `record_limit`
(`busy`), `record_too_large`, `record_aborted` (the debugger-detach tombstone).
`record_size` is also the capability name that advertises the two params; it is
not a wire method.

## Decisions

| id | Decision |
|---|---|
| **D1** | Slice and order: A (Electron bump alone) -> B (ui actions, stacked on A) and C (harness) in parallel after D8 -> D (extension, conditional). One repo per PR. No version bump in any. |
| **D2** | PR-A regression gate: pnpm-pinned lockfile regen (diff ~electron only); `check-types`, `lint`, `check-changed`, full desktop suite; build + headless launch; browser navigate/screenshot; `node-pty` spawn from a packaged `--dir` build; `test-publish-workflow` pins test; built-app preload smoke; OAuth popup scripts; viewport re-measure + `check-evidence` count; re-measure the hidden-view screenshot stall. |
| **D3** | The host (Electron main) writes the file directly; bytes never cross RPC. The harness composes, polices and approves the path; the host enforces invariants only. |
| **D4** | Path is chosen and approved at `record_start`. `record_start` is tier `write`; `record_stop` is tier `read`. A denied start writes and starts nothing. |
| **D5** | Default `<config>/browser/recordings/<session8>/rec-<stamp>-<4hex>.mp4` (0700/0600), explicit path allowed, `.mp4` only, **never overwrite**, `.part` + `linkSync` publish, Python verifies size + `ftyp` from disk. |
| **D6** | Caps: 120 s default / 600 s max duration (auto-stop finalizes); 64 MiB (32 MiB under a scratchpad), `record_too_large` deletes and saves nothing; max 2 concurrent recordings (unmeasured). |
| **D7** | State/teardown: per-webContents map keyed by owner; abort-and-discard on every debugger boundary via one `dropCaptures` in `cdp.ts`; tombstone only for DevTools detach; same-owner second start `busy`; an other-owner replace STOPS the old recorder before starting (measured on Electron 45.1.0: Chromium refuses a second start while it is live with "Screencast is already active", so discarding the bookkeeping alone cannot hand the tab over); owned-tab session end reaches teardown, retained tabs rely on the timer. |
| **D8** | Wire contract and protocol: `record_start`/`record_stop`, timeouts 20/60, `CAPABILITY_GATED` + `DESKTOP_ONLY`, static `HOST_CAPABILITIES`, `record_start` `DOCUMENT_SCOPED`, no `PROTO_VERSION` bump. |
| **D9** | Error taxonomy by `data.reason`; classify a missing command by Chromium major < 153 first, text second; AV1 text taken from `media_recorder.cc:231-234`; Python renders the copy. |
| **D10** | Extension host: conditional on the pending probe and on Ben approving a default-OFF operator switch. Bytes cross the wire in <= 4 MiB pages; Python writes the file; `record_stop` is stateless; `chrome.alarms` for the cap. |
| **D11** | Test seams as listed (ui `browser-recording.test.mjs` on the network-capture fake-CDP rig; lo `test_browser_recording.py` beside `test_browser_network.py`), red first, plus the real-path matrix. |
| **D12** | PR-C fixes `_capability_message` so a desktop-only method on the extension host says "desktop app only", not "toggle the extension". |
| **D13** | No new `BrowserParams` fields: reuse `path` and `timeout_s`. |
| **D14** | Capture params: fps 10 and audio off are fixed. Size is the fixed 1280x720 ceiling when `width`/`height` are omitted; when given (even ints 240..3840, area <= 3840x2160) they replace the ceiling with a real emulated viewport and the result reports the measured size. Raising the 4K ceiling is one constant per side plus docs. |

## What the real-path run measured

Electron 45.1.0 (Chromium 156.0.8078.49), built from the PR-B worktree, headless,
isolated `HOME`/config/profile, driven over the host's own loopback RPC:

- A 6 s recording of a local animating page landed as a 174-197 KB mp4
  (`ftyp` at offset 4, mode 0600, no `.part` left). AVFoundation decoded both ends: `av01`,
  1280x720, ~9 fps nominal, first frame luma ~111 and last ~160, mean per-channel
  difference ~48/255 — moving pictures, not one repeated frame.
- The encoder utility process (`DevTools Media Encoding Service`) appears during a
  recording and is GONE after `record_stop`, after a tab close mid-recording, and
  after the app quits. D7's "the encoder may linger" concern did not reproduce.
- **A REPLACE cannot be a pure discard.** Chromium refuses a second
  `Page.startScreenRecording` on the same target with `Screencast is already
  active` while the previous recorder is live, so `record_start` stops the
  displaced owner's stream (2 s deadline, bytes discarded unread) before starting
  the new one. Discovered by the real-path run, not by the design.
- The duration timer finalizes on its own: a 2 s cap produced a clip and the next
  `record_stop` reported `auto_stopped: true`.
- A clip over `max_bytes` is refused with `record_too_large` and leaves no file.
- A third concurrent recording is refused with `record_limit` (`busy`); two
  concurrent recordings each produced a file and each had its own encoder.
- App quit and tab close mid-recording write nothing, and leave no encoder behind.
- A plain CDP client attached to the driven view's target does NOT detach the
  host's `webContents.debugger`; the DevTools detach event is reachable only from
  Electron's DevTools UI, which a headless rig cannot open. The handler itself is
  covered by `browser-recording.test.mjs` against a real `CdpPool` with the event
  emitted; the end-to-end row stays BLOCKED and is named as such in the matrix.

### Sized recordings (probe, 2026-11-02)

Measured on the same runtime with a raw CDP client on the tab's own debugger
target (`width`/`height` had no UI implementation yet), local animating page:

- `Emulation.setDeviceMetricsOverride {width,height,deviceScaleFactor:1,mobile:false}`
  applied before `Page.startScreenRecording` produced a clip at exactly the
  requested size from 854x480 through 10240x5760; the page's `innerWidth`/
  `innerHeight` matched, and one `window` resize event fired per change.
- Cost grows with pixel count, not with `maxWidth`: 4K = 227 % CPU and about
  370-390 MB encoder RSS (374 MB at 6 s, 389 MB at 30 s), 8K = 778 % / 1.2 GB,
  10K = 715 % / 1.9 GB. The stop flush took under 20 ms at 4K, 109 ms at 8K
  and 2.1 s at 10K. Each figure is one clip per size from this probe, with 4K
  RSS sampled at 6 s and 30 s; unless a bullet says otherwise, none is an
  average or a bound.
- Bytes per second on a page where every frame differs: 720p ~68 KB/s, 1080p
  ~146 KB/s, 4K ~434 KB/s. The unchanged 64 MiB cap is therefore ~150 s at 4K,
  and the scratchpad's 32 MiB ~75 s; a longer clip is refused at stop with
  `record_too_large`, not truncated.
- A REAL REFLOW IS THE PRICE. The page sees the change: a popover listening to
  `resize` closed, a right-anchored control moved (x 1197 -> 3757 at 4K), and
  responsive layouts reflow. `screenshot` on that tab returns the larger
  surface. Asking for 4K asks for a different layout, not a scaled image of the
  1280x720 one.
- THE FIRST FRAME NEEDS A FRAME, NOT JUST A LAYOUT (QA Q1, 2026-11-02). With no
  wait between the matching `innerWidth` and `Page.startScreenRecording`, the
  encoder's first frames carried the PREVIOUS raster: QA's run through the host
  path recorded a 1280x720 layout across 3840x2160, 2160x3840 and 3840x1080
  clips, and this rig reproduced it at 2160x3840 in 3 of 3 control runs (a
  1280x720 patch on black, 31.6 % of the frame painted). Two
  `requestAnimationFrame` callbacks (8-14 ms) made frame 0 correct in 8 of 8
  runs at each of 3840x2160, 2160x3840 and 1920x1080; one unclipped
  `Page.captureScreenshot` (27-50 ms) and a fixed 500 ms wait did the same, and
  the screenshot was rejected for the smaller margin it buys at a larger cost.
  Those callbacks only arrive on an unfocused view because `attach` turns on
  `Emulation.setFocusEmulationEnabled` (`cdp.ts`): without it the same evaluate
  never replied within 2.5 s.

## Still unverified

- CPU and memory of TWO concurrent encoders: one 4K clip measured 227 % /
  about 370-390 MB and the byte rates above exist, but a second encoder at the
  same time is unmeasured — which is why the provisional rule allows only one
  >1080p clip.
- The emulated viewport while the user ACTIVATES the tab mid-clip. A sized start
  on a presented tab is refused; what the encoder does if presentation changes
  during the clip was never measured.
- The DevTools detach path end to end, for the reason above.
- That a retained tab's recording keeps running past its owning session until the
  timer (D7's last row): the run covered owned tabs only.
