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
pending, cleared by the resolve, a refusal, or a release inside the window (the
last of those is a fix of this round: the release arm returned before the arm
that cleared the face, so a hold shorter than the acquisition left it up for
the whole remaining wait until agent review round 2, MAJOR 1) -
is pinned in `scripts/shared-composer.test.mjs` ("the mic acknowledges the
press while the stream is still pending..."); those cases drive the shipped
React wiring with a deferred stream and are not visual evidence.

## The frames, and WHICH HEAD each one is from

**Read this before reading a frame as this head's.** The set holds two
treatments and one base:

| frames | head | treatment |
| --- | --- | --- |
| `before/01-click-idle/`, `before/02-click-still-idle/`, `before/03-recording/` | `af6fffa899` (base tree, no acknowledgment) | the silence the report describes |
| `after/01-ack-just-after-click/`, `after/02-ack-300ms-into-wait/`, `after/03-ack-600ms-into-wait/`, `after/04-recording/` | `94368b7057` (**the FIRST treatment**) | the acknowledgment as a line of its own in the lane's slot - **the placement design round 1's D2 deleted** |

So the `after/` frames are NOT what this head does: they show the version that
moved the composer on the press. **No frame of this head's treatment exists**
(the host refused every app run on 2026-10-02 - see below), and this head is
carried by numbers rather than by pixels:

- the geometry table above (rest 774/110, preparing 774/110 at five samples,
  lane 690/194, mic x 1141), measured on this head's own build;
- the acknowledgment's own timing from the same record (`click -> ack`
  committed 1.3 ms, 0 transport calls / 0 fetches before `getUserMedia`);
- the pinned behaviour in `scripts/shared-composer.test.mjs`, which drives the
  shipped wiring and is not a picture.

The claim "**the press costs the composer 0 px**" is scoped to what was
measured: 1380x900 @ dpr 2, the size every number here was taken at (agent
review round 2, minor d - a second width was not measured, because the host
allowed no further runs). The row the caption sits in is `flex-nowrap` with
this row's own yield rules (the cwd chip truncates, the usage reading drops
below 480px of composer), and the caption is `shrink-0`; a narrower width is
therefore a thing to MEASURE rather than to assume, and it is the first thing a
re-run should take.

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
  (+414 ms), `after/03-ack-600ms-into-wait/` (+600 ms): **the FIRST treatment**
  (`94368b7057`) - the acknowledgment as a line in the lane's slot, with the
  control showing its busy spinner (`aria-busy`) - while that run's acquisition
  is still pending (it resolved at +793 ms). This head puts the same words in
  the control row instead, which is why there is no geometry movement; there is
  no frame of it, and the table above is what says so.
- `after/04-recording/`: the same recording lane as before, same treatment.

## Remediation round 1: the press costs the composer no geometry

The agent review's first round on #766 found the acknowledgment had bought its
frame with layout: a line of its own, in the slot the recording lane takes.
Card top, measured by the design round on the base tree, against a bottom edge
pinned at 884: **774 at rest -> 734 while preparing (+40) -> 690 at the
recording lane (+44 more)** - two movements for one press, one of them new.

The acknowledgment now rides in the control row, which exists at every width
and in every state, so the press costs **0 px** and the only movement left is
the recording lane's own, unchanged. Re-measured on the fixed head by the
committed rig (`after/stt-ack-remediation.json`, 1380x900 @ dpr 2; the same
`data-lo-composer-measure` box and the same `[aria-label="Start recording"]`
control the design round measured):

| state | card top | card height | card bottom | mic control x | ack caption |
| --- | --- | --- | --- | --- | --- |
| at rest | **774** | **110** | 884 | 1141 | - |
| preparing +41 ms | **774** | **110** | 884 | 1141 | x 1024.4, 112.6x19.5 |
| preparing +150 ms | **774** | **110** | 884 | 1141 | x 1024.4 |
| preparing +300 ms | **774** | **110** | 884 | 1141 | x 1024.4 |
| preparing +600 ms | **774** | **110** | 884 | 1141 | x 1024.4 |
| preparing +1200 ms | **774** | **110** | 884 | 1141 | x 1024.4 |
| recording, settled | 690 | 194 | 884 | (start control absent) | - |

So: idle and preparing are the SAME box, to the tenth of a pixel, at five
sample points across the wait; the caption sits inside the 32px row it was
added to (y 842.3-861.8, ending 4px - the row's own gap - left of the mic);
and the recording lane's geometry is the pre-existing one (`y 760, 64px`),
which is what "the lane stays as it was" means as a number rather than a claim.

The same record carries the acknowledgment's own timing with the acquisition
HELD open (the capture hold below, so the numbers that describe the wait are
not this run's): `click -> ack` committed **1.3 ms** after the click (painted
75.4 ms under a load average above 60) with `ackKind: "preparing"`, and **0
desktop-transport calls and 0 fetches** between the click and `getUserMedia` -
the gates are read, not called, so the press is not waiting on them.

The lifecycle the findings pinned is in `scripts/shared-composer.test.mjs`:
not-`disabled` with a second press refused by the handler's own guard, the
Escape ladder's presence covering the press window, and Escape settling the
pending start (the stream still lands, and it lands on a discarded take).

## What this round could not re-shoot, and why

The design round asked for this head's frames in BOTH themes, a re-paired
before pair, and a mini-view frame with the mini window's height before and
after. **The host refused all four on 2026-10-02.** Between 12:03 and 12:07
local, with the fleet's load average at 91-137, `vm.swapusage` at 46.7 GB of
48.1 GB used and ~5,100 free pages (≈80 MB), every app run was SIGKILLed
within seconds of its click phase - six attempts, including one with the
harness's memory ceiling disabled, plus one jsdom suite - while the same rig
had completed a full run an hour earlier at load 25. The app is the only
instrument that can produce these frames (AGENTS.md: a hand-built substitute
cannot reach the desktop plane, and a rendered frame is the evidence), so what
is NOT here is stated rather than implied:

- the `after/` frames and the `before/` frames in this set are the PREVIOUS
  round's dark ones, captured at `af6fffa899`; the light pair, the re-paired
  before stills and the mini-view frame are **not** re-shot on this head;
- the numbers above ARE re-measured on this head (`after/stt-ack-remediation.json`),
  with one caveat stated: that run's build predates one line of the D3 fix -
  the spinner's track role - which is a border COLOUR and moves no geometry;
- the mini's own capture is wired and unrun: `scripts/renderer-driver.mjs`'s
  mini-view scene now gates the fake acquisition (`window.__miniMicGate`) so the
  acknowledgment can be photographed in the mini window, and asserts
  `miniPendingGeom.height === miniResting.height` while it is on screen. The
  command is `--scene mini-view --backend http://127.0.0.1:11877
  --backend-records <config>/run/serve --theme localOperatorDark`, and it needs
  the same quiet host.

## Records

- `before/stt-ack-before.json` - the base-tree run: 8 click cycles, the three
  before frames taken from cycle 1.
- `after/stt-ack-after.json` - the frames run: 3 cycles, the four after frames
  from cycle 1.
- `after/stt-ack-after-timing.json` - the numbers run: 8 cycles, no captures
  (`LO_ACK_SHOTS=off`; under heavy load the capture requests themselves slow
  the acquisition they are photographing).
- `after/stt-ack-probe.json` - the mic-health probe described above.
- `after/stt-ack-remediation.json` - the remediation round's run on this head:
  one click cycle with the acquisition HELD (the capture hold), which is where
  the geometry table above and its `click -> ack` timings come from. Its
  acquisition figures are the hold's and are not quotable as the app's; the
  numbers that describe the acquisition are the earlier runs'.

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

# 4. the remediation round's two switches, both of which the record carries:
#    LO_ACK_THEME=localOperatorDark|LocalOperatorLight is the palette the run
#    photographs (one per run - the pair of frames a visual round asks for is
#    two runs), and LO_ACK_HOLD_MS=<ms> holds the acquisition open inside the
#    page (a `getUserMedia` wrapper the rig installs) so the pending state can
#    be PHOTOGRAPHED - and it makes that run's acquisition numbers the hold's,
#    which is why they are read only from runs that leave it unset.
LO_ACK_THEME=localOperatorLight LO_ACK_SHOTS=on ...
LO_ACK_HOLD_MS=2500 LO_ACK_SHOTS=on ...
#    LO_ACK_WARMUP=1 primes the device path with one bare acquisition first, so
#    a short capture run's own acquisition is the warm one (milliseconds) and
#    the run finishes inside the windows a loaded host leaves a rig. Capture
#    runs only: a run that measures the acquisition leaves it off, or it would
#    be measuring its own warm-up.
```

The rig keeps the scratch tree, writes `stt-ack.json` + `app.log` beside the
frames, strips every inherited `CMUX_*`/`LOP_*`, and reaps every process it
started by pid. The committed frames were arranged into the sweep's
`<stem>/<theme>.webp` shape by hand from the run's flat `frames/` output (the
brand dark theme; the run logs `viewport {w:1380,h:900,dpr:2}`).

**Not exercisable headlessly, stated rather than implied:** macOS TCC. The
synthetic capture device bypasses the OS microphone grant, so a real first-use
permission prompt is on top of every number above and is not measured here.
