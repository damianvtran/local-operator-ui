# The mic press's acknowledgment, before and after

The operator report (via Aida, 2026-10-01): the STT button "sometimes lags on
click - no immediate loading/preparing indication; a beat passes before
anything visible happens". This set is the measurement that separated the
causes and the before/after pair for the fix: **the press now carries its own
acknowledgment in the click's frame, while the acquisition it covers stays as
long as it is.**

Both halves were captured against the same upstream base - `origin/main` =
`af6fffa899`, this branch's fork point - with the same rig, the same commands
and the same isolated backend, so the pair reads as one variable changed:
`before/` is the untouched base tree, `after/` is the base plus this branch's
one source commit (the composer acknowledgment). The fold onto
`origin/main` = `bc642ccd49` landed after both captures and touches no file
either half renders.

## What the click path costs (page clock, the part the fix moves)

Every number is `performance.now()` in the page, from the run records committed
beside the frames (see *Records*). The click is driven through CDP's trusted
input pipeline; the microphone is Chromium's synthetic capture device, so every
press lands on a live control deterministically.

| stage | before (base tree) | after (this tree) |
| --- | --- | --- |
| click -> `getUserMedia` called | 0-7 ms | 0-6.4 ms |
| desktop-transport / fetch calls in that window | 0 and 0 (8/8 cycles) | 0 and 0 (8/8) |
| `getUserMedia` resolve, cold | 831.9 ms | 792.8-832.6 ms |
| `getUserMedia` resolve, warm (7 more cycles) | 5.6-15.3 ms | 7.8-25.8 ms |
| resolved -> `MediaRecorder.start()` | 0-3.6 ms | 0.1-6.3 ms |
| **click -> FIRST visible change, cold** | **866.4 ms** (painted 869.9) | **14.9 ms committed, painted 26.6** (frames run: committed 1.6, painted 19.3) |
| **click -> first visible change, warm** | 9-19.8 ms - i.e. the recording state itself, nothing earlier | **1-4.1 ms committed**, painted 17.4-30.7 |
| click -> recording state in place, cold | 866.4 ms | 796-859.5 ms committed (the acquisition's own end, unchanged) |
| click -> recording state painted, warm | 34.2 ms (the one cycle whose paint was sampled; sampler nulls under load elsewhere) | 26.8-47.5 ms |

Read the two bold rows together: before, the FIRST thing the press put on
screen was the recording state, ~866 ms into the cold wait (and, on warm
cycles, the acquisition's own end); after, the acknowledgment is committed
1-15 ms in (sub-frame) and painted within ~30 ms, and the recording state
still arrives when the stream does. The acquisition itself is untouched -
that is stated rather than implied: `after/stt-ack-after-timing.json` and
`after/stt-ack-after.json` show the same 0.8 s cold resolve as the before run.

**The five provider gates are NOT on the click path** (they are
already-resolved booleans the press reads; the run counts **0
desktop-transport calls and 0 fetches between the click and `getUserMedia`,
8/8 cycles in both halves**), so the fix moved no gate - there was nothing on
the click path to move. `getUserMedia` is the wait, cold `getUserMedia` is the
"sometimes", and under this host's worst swap pressure it can be far worse
than a beat: `after/stt-ack-probe.json` is a bare acquisition with no UI and
no click involved, and it measured **126,955 ms** cold (5 ms warm).

The acknowledgment's own lifecycle - on screen while the acquisition is
pending, cleared by the resolve, a refusal, or a release inside the window -
is pinned in `scripts/shared-composer.test.mjs` ("the mic acknowledges the
press while the stream is still pending..."); those cases drive the shipped
React wiring with a deferred stream and are not visual evidence.

## The frames

Each frame is the app photographing itself (`Page.captureScreenshot`, webp,
1380x900 @ dpr 2 - 2760x1800 actual pixels), captured in the FROZEN
`--window-mode=headless` (never shown, never focused). A capture under load is
not instantaneous, so every frame is labelled by the state read taken
immediately before AND after it in the run record (`shot.*` keys); the
quoted offsets are the page clock at capture request time, relative to that
cycle's click.

- `before/01-click-idle/` (+68 ms) and `before/02-click-still-idle/` (+381 ms):
  identical to the resting composer - mic present, no recording controls, no
  indicator. These two frames ARE the report: ~0.4 s into a wait the run says
  lasts 866 ms, nothing on screen has changed.
- `before/03-recording/`: after the flip, settled 650 ms - the recording lane.
- `after/01-ack-just-after-click/` (+41 ms), `after/02-ack-300ms-into-wait/`
  (+414 ms), `after/03-ack-600ms-into-wait/` (+600 ms): the acknowledgment -
  the "Starting recording" line in the lane's slot, the control showing its
  busy spinner (`aria-busy`) - while the run's acquisition is still pending
  (it resolved at +793 ms in this run).
- `after/04-recording/`: the same recording lane as before, same treatment.

## Records

- `before/stt-ack-before.json` - the base-tree run: 8 click cycles, the three
  before frames taken from cycle 1.
- `after/stt-ack-after.json` - the frames run: 3 cycles, the four after frames
  from cycle 1.
- `after/stt-ack-after-timing.json` - the numbers run: 8 cycles, no captures
  (`LO_ACK_SHOTS=off`; under heavy load the capture requests themselves slow
  the acquisition they are photographing).
- `after/stt-ack-probe.json` - the mic-health probe described above.

## How to re-run it

The rig is `scripts/stt-ack-latency-proof.mjs` (committed). It needs the app
BUILT from the tree under test and an ISOLATED backend - scratch HOME, scratch
config root, its own bearer, `RADIENT_API_KEY` seeded so the mic's gate
answers:

```sh
SP=<a scratch dir>
# 1. the isolated backend (a placeholder Radient key is enough for the gate;
#    nothing here transcribes - takes are cancelled with Esc):
env -u XPC_FLAGS HOME="$SP/backend/home" \
  LOCAL_OPERATOR_CONFIG_DIR="$SP/backend/config" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat $SP/backend/token)" \
  RADIENT_API_BASE_URL=http://127.0.0.1:8799 \
  <local-operator>/.venv/bin/local-operator serve --host 127.0.0.1 --port 11877 --yolo
curl -X PATCH -H "Authorization: Bearer $(cat $SP/backend/token)" \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:11877/v1/credentials \
  -d '{"key":"RADIENT_API_KEY","value":"placeholder-for-the-proof-rig"}'

# 2. the app, built against that backend (`.env`:
#    VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:11877, pnpm build), then:
LO_ACK_REPO=<worktree> LO_ACK_BACKEND=http://127.0.0.1:11877 \
  LO_ACK_TOKEN=$(cat $SP/backend/token) \
  node scripts/stt-ack-latency-proof.mjs <out-dir> 8

# 3. the frames pass (same command; captures on by default) and the
#    environment probe, if wanted:
LO_ACK_SHOTS=off ... node scripts/stt-ack-latency-proof.mjs <out-dir> 8
LO_ACK_PROBE=1  ... node scripts/stt-ack-latency-proof.mjs <out-dir> 0
```

The rig keeps the scratch tree, writes `stt-ack.json` + `app.log` beside the
frames, strips every inherited `CMUX_*`/`LOP_*`, and reaps every process it
started by pid. The committed frames were arranged into the sweep's
`<stem>/<theme>.webp` shape by hand from the run's flat `frames/` output (the
brand dark theme; the run logs `viewport {w:1380,h:900,dpr:2}`).

**Not exercisable headlessly, stated rather than implied:** macOS TCC. The
synthetic capture device bypasses the OS microphone grant, so a real first-use
permission prompt is on top of every number above and is not measured here.
