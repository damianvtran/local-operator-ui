# Quick send mini view — scene frames (PR evidence, not committed to main)

These are the `--scene mini-view` frames for the Quick send PR
(`feat/global-hotkey-quick-send`, #631), attached from this standalone branch so
the PR's own diff carries no binaries.

Re-captured 2026-09-29 at the remediation head, on the tree of
`de35746f06` (the fold onto `origin/main` = `f3ce13cee7`, PR #626, touched
nothing the mini view draws — no file under `src/renderer/src/shared`,
`src/renderer/src/styles`, `src/main` or `src/preload` moved in it, so the
frames stand re-stamped rather than re-shot).

## How they were taken

Two runs on one build (`pnpm build` with the four `VITE_*` vars the build's
plugin requires; rig placeholders), headless, isolated scratch profile, and —
since the exerciser landed — the app's OWN mini window: the armed dev driver in
`headless` mode creates it (`headlessExerciserAllowed`), the scene finds it and
drives it over the real `mini-view:summoned` channel. Registration stays
normal-only in these runs (a rig answers no keyboard).

```sh
# run 1 — no backend: 40 PASS / 0 FAIL. Contributes mini-view-error.png.
node scripts/renderer-driver.mjs --scene mini-view --out <dir>

# run 2 — an isolated daemon this lane owned (scratch config root seeded with
# `hosting: test` / `model_name: mock-model`, its own desktop token):
# 46 PASS / 0 FAIL. Contributes the other six.
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$ROOT/token.hex")" \
node scripts/renderer-driver.mjs --scene mini-view \
  --backend http://127.0.0.1:18080 --backend-records "$ROOT/run/serve" \
  --seed-onboarding-complete --out <dir>
```

Every frame is the app's own window at 1280x336 device px (640x168 CSS at dpr
2), captured through MAIN's `capturePage` with `visible=false` and
`focused=false` asserted per frame, and every capture polls the field's and the
Send button's computed styles to two consecutive agreeing reads before the
shutter (design round 1, D6) — the stills are the settled paint, not a phase of
the 120 ms fade the first round photographed.

## The seven states

| Frame | State |
| --- | --- |
| `mini-view-empty.png` | the resting state: the hint line, Send disabled, the chord drawn as the app's key caps (⌘ ⌥ Space) |
| `mini-view-typing.png` | a draft; the shared focus ring on the field, Send enabled |
| `mini-view-long.png` | a five-line draft scrolled inside the fixed box |
| `mini-view-dictating.png` | recording (fake `MediaRecorder`), the stop control, the amended sentence, Send disabled while the mic is live (U2) |
| `mini-view-sending.png` | in flight: the field locked, the Send spinner |
| `mini-view-sent.png` | the "Sent" flash, after the run's daemon admitted the message |
| `mini-view-error.png` | the refusal with the draft kept and Retry up (run 1, a machine with no backend) |

## The two harness aids behind the transient frames, disclosed

- The `sending` frame needs the in-flight state to outlive a loopback round
  trip, so the run SIGSTOPs the run's OWN daemon process — exact pid from the
  linked serve record, loopback-only, never 1111 — for the frame, and
  SIGCONTinues it in a `finally` before the same request completes. The request
  is real, and the `sent` frame is that request's admission; the run also reads
  the message back from the daemon's own
  `/v1/desktop/sessions/<id>/history` route.
- The composer's own 600 ms flash timer (`SENT_FLASH_MS`, read from its
  declaration) is stretched in that window's page so a settled still of the
  flash exists at all.

Both are page/process-level and neither changes shipped code; the scene's
docstring and `docs/agent-driver.md` say the same where the code lives.

## What headless cannot prove

A real OS chord reaching the registrar (no synthetic OS key crosses a headless
run honestly — the one live press is a human step), focus returning to the
operator's previous app, the microphone permission prompt (the dictating frame
is a fake recorder), the macOS cross-app conflict case `register()` cannot
detect (QA round 1, Q2), and Wayland.

The hidden window's renderer measured **115.5 MB working set / 162 MB peak** in
run 2 — risk K6's decided number (hidden-persistent, instant first press).
