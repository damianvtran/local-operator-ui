# Mini-view dictation swap — live evidence (2026-09-29)

Two headless runs of the **built app** that prove the mini view's dictated send
end to end, for PR "the mini composer rides the shared speech manager and stamps
input_mode" (branch `feat/mini-view-shared-dictation`).

Each directory holds the run's record (`mini-dict-proof.json`) and one frame of
the dictated draft (`01-dictated-draft.png`, captured from the hidden window via
`capturePage`).

- `capability-on/` — backend advertises `features.input_mode: 1` (worktree
  `hide-crosssession-0929-ce48`, v0.64.1): the wire body carries
  `"input_mode": "dictated"` and the daemon ACCEPTS it (200); its history row
  carries the stamp too.
- `capability-off/` — backend without the key (worktree `ci-red-c-desktop`,
  v0.64.1): the same dictated flow, and the wire body is the LEGACY shape — no
  `input_mode` key at all (200, landed).

## What the rig does

`mini-dict-proof.mjs` (run with the SESSION's scratch dirs, not committed to the
PR) drives:

1. an **isolated** `local-operator serve` (its own scratch config root and
   bearer; a placeholder `RADIENT_API_KEY` seeded; `RADIENT_API_BASE_URL`
   pointed at the rig's fake upstream);
2. a **recording proxy** the app is configured against (`VITE_LOCAL_OPERATOR_API_URL`,
   baked at build): it forwards everything and records every
   `POST .../messages` body with the upstream's status;
3. the **built app** (`out/`), headless, dev-driver armed
   (`LOCAL_OPERATOR_UI_DEV_DRIVER=1` + `_OUT`), so the app creates its own mini
   window (`headlessExerciserAllowed`); `--use-fake-device-for-media-stream`
   gives the mic Chromium's synthetic audio; `--use-mock-keychain` keeps the
   scratch HOME away from macOS Keychain;
4. the flow: the real `mini-view:summoned` channel from MAIN → mic press →
   `Recording…` observed → mic release → the fake upstream's transcript lands in
   the draft → Send → the recorded wire body + the daemon's own history.

The window is never shown or focused (asserted at boot and at the end); every
process is reaped by pid; HOME/config/logs/Electron profile all live under the
run's own out dir, and the app's config root is deliberately SEPARATE from the
backend's (sharing one makes the app discover the backend directly and bypass
the proxy — measured; both configs are listed in the record).

## How to re-run

```sh
# 1. the renderer is built against this run's proxy (its URL is baked):
cd <ui-worktree> && .env with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080
pnpm build

# 2. the rig (it starts the serve, proxy, upstream and the app itself):
LO_MINI_HALF=on  LO_MINI_SERVE_BIN=<worktree .venv/bin/local-operator> \
  LO_MINI_TOKEN=$(openssl rand -hex 16) LO_MINI_APP_ROOT=$PWD \
  node mini-dict-proof.mjs <out-dir>
# LO_MINI_HALF=off is the legacy-body half (a backend without the key).
```

Ports: the proxy defaults to 8080 and the fake Radient upstream to 8799; both
must be free (`LO_MINI_RADIENT_PORT` moves the upstream).

## Limits, stated plainly

- The microphone is the synthetic device: macOS TCC is not in this path, and a
  real grant is not measurable headlessly.
- The OS hotkey chord is a main-process key this rig never presses; it drives
  the same `mini-view:summoned` channel the chord's handler sends.
- The transcripts are the fake upstream's fixtures, by construction.

## The Escape-claim cell (review round 1, M2)

`run-esc/mini-dict-proof.json` — `LO_MINI_SCENARIO=esc` on the built app at the
remediation head (`5f615e0f88`), a fourth headless run of the same rig. The
manager-dispatched hold engaged on the keydown alone
(`Stop dictation|Recording. Press the stop button when you're done.`); Escape
then aborted the take with ZERO calls to the dismiss channel and zero hide
events (the dismiss handler is re-registered in main with a recorder in front of
the same hide, the app's own idempotent-registration pattern); nothing was
transcribed from the aborted take; and a plain Escape (no hold) still dismissed
(`{"reason":"escape"}` recorded in main). ALL CLAIMS HELD. This cell exercises no
send, so the carriage half is off (`LO_MINI_HALF=off`) and the serve is the
installed v0.64.1, which does not advertise `features.input_mode` — the two
carriage runs above were captured against the worktree builds that do.
