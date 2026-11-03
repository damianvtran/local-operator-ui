# Report: opt-in high-quality browser recording (UI half)

Branch `feat/record-quality` in `~/workspace/repos/lo-ui-rec-quality`, off origin/main e6a9b59b8d. Nothing pushed, no PR. 5 local commits, 18 files, +3894/-35.

## Commits
- 365570a776 feat(browser): add an MP4 writer for high-quality recordings
- f658c5f119 feat(browser): add the hidden H.264 encoder window and capture session
- c16c5126a0 feat(browser): add opt-in quality:"high" to record_start
- 40647a08d7 docs(browser): record decisions D15-D22 for high-quality recording
- 7a500017a8 docs(browser): record the declined D15 overturn and the 4K main-CPU A/B

(origin/main had moved two commits at report time: 0.48.10 bump and a composer fix.)

## Gates
- `pnpm lint`, `pnpm check-types`: pass. `check-scripts-lint`: the 3 changed scripts are clean.
- Real `electron-vite` build incl. bytecode step: passes.
- `browser-recording` + `recording-mux` tests: 103/103 pass. 548 tests in neighbouring browser/window/overlay files pass.
- Whole desktop suite (700 files): the repo memory guard killed full `pnpm test:desktop` runs twice (10.3 GB vs 9.5 GB budget, host load 40-80). I ran all 700 files through the same runner in 14 chunks of 50 (concurrency 3, guard on). Every failing test is in a file I did not touch and fails identically on a clean origin/main worktree: app-attention, agent-picture migration, backend-settings fixtures, Muse mirror, three JSDOM top-layer tests, skills-tab U11, session-load-recovery (16 fail on both), update-robustness (file fails on base; individual test names not compared). "focus fetches once" failed under load once and passes alone.
- Not run: CI, electron-builder packaging, scripts/check-packaged-closure.mjs. `out/` contains recording-encoder.html, its script asset and out/preload/recording-encoder.js; package.json ships `out/**/*`.

## Real-path proof
Built app, headless, real record_start/record_stop through the RPC. Page: billing.html from 127.0.0.1; 3 s static, 6 s stepped scroll, 2 s static. All outputs decoded with AVFoundation; viewport returned to 1280x720 each time. Real fps < 10 because of static stretches.

| Case | Decoded | Dur s | Frames | Real fps | Bytes | kbps |
|---|---|---|---|---|---|---|
| 1080 standard (AV1) | av01 1920x1080 | 11.59 | 65 | 5.61 | 1,919,506 | 1325 |
| 1080 high (H.264 hw) | avc1 1920x1080 | 11.01 | 60 | 5.45 | 1,461,106 | 1061 |
| 4K standard | av01 3840x2160 | 11.56 | 65 | 5.62 | 3,772,442 | 2610 |
| 4K high | avc1 3840x2160 | 11.02 | 61 | 5.54 | 2,371,384 | 1722 |

CPU = % of one core, summed across app processes, 1 Hz. "clip" = whole recording, "scroll" = scrolling segment. RSS = peak MB.

| Case | App total clip / scroll | Main CPU clip / scroll | Main RSS | Encoder |
|---|---|---|---|---|
| 1080 standard | 21.4 / 35.4 | 1.3 / 1.7 | 284 | utility process 16.8 / 30.1 %, 148 MB |
| 1080 high | 13.1 / 20.5 | 8.1 / 12.8 | 315 | hidden renderer 2.7 / 4.6 %, all renderers 847 MB |
| 4K standard | 49.4 / 82.8 | 3.1 / 4.6 | 306 | utility process 43.3 / 74.3 %, 341 MB |
| 4K high | 34.4 / 55.2 | 24.7 / 39.6 | 367 | hidden renderer 6.8 / 11.5 %, all renderers 842 MB |

Other peak RSS: GPU 130 / 142 MB (1080 std / high), 210 / 234 MB (4K std / high); VideoToolbox helpers 24 / 69 MB (1080), 66 / 80 MB (4K). Sustained 20 s scroll at 4K: app total 62.9-66.3 % (high) vs 92.5 % (standard).

Sharpness (`.rec-probe/proof/crop-compare-{1080,4k}-step{15,30}.png`: 4x nearest-neighbour crops of the same text region at the same scroll step vs lossless Page.captureScreenshot; crop auto-picked as highest-contrast band, one synthetic page):

| Case | Standard crop / frame PSNR | High crop / frame PSNR |
|---|---|---|
| 1080 step 30 | 23.3 / 26.9 dB | 34.0 / 39.9 dB |
| 1080 step 15 | 21.7 / 26.3 dB | 43.0 / 40.4 dB |
| 4K step 30 | 29.3 / 36.0 dB | 37.9 / 42.4 dB |
| 4K step 15 | 24.5 / 31.6 dB | 36.5 / 42.2 dB |

Chromium `<video>` in Electron: both high clips reach canplay, videoWidth 1920 / 3840, duration 11.01 / 11.02 s, seek at start/middle/end, play with 0 dropped frames; canvas drawImage readback mean luma varied by position (40.4, 49.0, 47.5), so frames decode (lit-pixel count was a weak check). Standard AV1 clips fail there with DEMUXER_ERROR_NO_SUPPORTED_STREAMS: existing path, not investigated.

Other real-path cases: static-page start 453 ms (screenshot nudge) vs 14 ms standard; unsized high gets 1280x720 from the first frame; 300 kB cap ends gracefully with stop_reason max_bytes and a decodable 7-frame file; 2 s limit ends with max_duration and restores the viewport; quality "ultra" refused record_quality with no file; two 1080p high recordings run at once, a third start on the second tab refused record_active (global limit of 2 not exercised on the real path); all outputs mode 600, no .part files.

## Kill tests (mid-clip, 1080p high)
| Test | Caller sees | After |
|---|---|---|
| Encoder renderer SIGKILL | next record_stop: record_failed ("the encoder process exited") | viewport 1280x720, 0 encoder targets, renderer gone, no .part, no file |
| Tab closed | record_stop: tab_closed / unknown_handle | 0 encoder targets, renderer gone, no .part, no file |
| App quit (SIGTERM) | app exited in 201 ms | 0 descendant processes, no .part, no file |

## Main-CPU experiment (D1 overturn trigger fired; declined by manager)
Base64 string pass-through did not bring main under 30 % at 4K: 45-48 % during scroll (25-42 % averaged over mixed clips), 8-13 % at 1080p. 4K scrolling, main CPU over 10 s: shipped string 48-53 %; Buffer decoded in main 50-51 %; JPEG q100 51 %; receive-only (parse CDP message, drop, ack every 100 ms, nothing sent) 50-54 %; receive-only acked every 400 ms 32 %. Cost is Electron's debugger delivering multi-MB frames to main, not our decode or IPC. Whole app tree at 4K is still cheaper than standard. Recorded in the design doc (7a500017a8). State it in the PR body.

## Deviations
- Memo has no D15 table row; D15 written from the memo's D1 prose.
- A test caught a leak (abort while the encoder window was still opening left the window alive); fixed in recording-hq.ts.
- Added sizing for an unscaled nudge screenshot larger than the screencast ceiling, and a build-wiring test (renderer/preload inputs, before-quit disposal).

## Unverified
- Windows and Linux (source only); hardware 4K measured on this Mac only (macOS arm64, Electron 45.1.0).
- Software-encoder path and the record_quality_unavailable reasons: fake-encoder tests only.
- Packaged app never run. core.hooksPath points at another checkout, so no hooks ran.

## Artifacts (untracked, `.rec-probe/proof/`)
crop-compare-*.png, clips/*.mp4, out/*.json* (results-matrix, results-sustained-string, kill-*.json, extra.json, video-playback.json), rig scripts.
