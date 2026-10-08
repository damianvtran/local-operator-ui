# Design review round 1 - frames for PR #879 (turn lifecycle honesty)

Evidence-only branch. No product code. Reviewer's own captures of
`fix/turn-lifecycle-honesty` @ `eaed6e00254` (AFTER) against base `c14e07d95b0` (BEFORE).

Left half of every paired `NN-*` frame = BEFORE (base), right half = AFTER (head), red bar between.
`NN-after-*` frames are AFTER only (full window, 1380x900 unless the name says 760px).

## Method
- Both trees built with `LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build` (dummy VITE_* auth ids, build only).
- ONE headless Electron per run (`--window-mode=headless`: window created and never shown; the app's own
  `[window-mode]` line was read back each run), scratch `--user-data-dir`, scratch HOME/config, telemetry and
  notifications off.
- ONE real isolated daemon per run (`local-operator serve --hosting test --model mock-model`,
  `tool_approval_mode: auto`; `[bash:N]` turns = a real running tool call). The app reaches it through a small
  loopback proxy (`rig.mjs`), the only harness aid: it can end the session SSE with the daemon's own `gap`
  frame and hold the reconnect, freeze SSE forwarding, and delay or swallow `POST /interrupt`. Everything else
  is the real app and the real daemon.
- Frames: CDP `Page.captureScreenshot` on the hidden window (no OS screenshot, no focus change). Every process
  was reaped by process group at the end of its run.
- Theme default `localOperatorDark`; `13-` is `localOperatorLight`; `14-16` are 760x640.

## Frames
01 gap 3.4s | 02 stop pending 2.3s | 03 stop pending + gap | 04/05 answer lost 14s/22s | 06 idle receipt |
07 receipt delivered inside a gap | 08/08b receipt delivered, SSE frozen | 09 Esc x3 inside a gap |
10 idle notice after the turn ended | 11/12 bound fired, then the stop landed | 13-16 light + narrow |
17 long gap (terminal statement) | 18/19 restore with the press unanswered

`rig.mjs` is the exact script used.
