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

Two further behaviours are pinned there and DECIDED here rather than left to the
implementation (UX round 2): a release inside the window re-opens it, so the
next press is a fresh acknowledged attempt rather than a silent no-op on a
control that paints at rest - and the abandoned stream is stopped by an IDENTITY
check in the resolve arm, because an orphan recorder is a live microphone
nothing can end; and a take whose turn went busy inside the window is KEPT - the
acknowledgment and its control survive the transition, and the deferred stream
still becomes the recording state, since discarding it would throw away speech
the user asked for in a composer that stays dictatable mid-turn.

## The frames, and WHICH HEAD each one is from

**Read this before reading a frame as this head's.** The set holds THREE
treatments and one base:

| frames | head | treatment |
| --- | --- | --- |
| `before/01-click-idle/`, `before/02-click-still-idle/`, `before/03-recording/` | `af6fffa899` (base tree, no acknowledgment) | the silence the report describes |
| `after/01-ack-just-after-click/`, `after/02-ack-300ms-into-wait/`, `after/03-ack-600ms-into-wait/`, `after/04-recording/` | `94368b7057` (**the FIRST treatment**) | the acknowledgment as a line of its own in the lane's slot - **the placement design round 1's D2 deleted** |
| `shipped/*`, `narrow/*`, `mini/*` | this round's follow-up on `origin/main` = `9d9cd4be63f` (**the SHIPPED treatment**) | the acknowledgment as a caption in the control row - zero geometry movement at every width and palette measured below |

So the `after/` frames are NOT what this head does: they show the version that
moved the composer on the press. They are kept as that round's record, and the
three directories this round adds are the re-shoot the design round asked for:

- **`shipped/`** - the shipped treatment at the size every earlier number was
  taken at (1380x900 @ dpr 2), **dark and light**, four states: the caption in
  the click's frame (`01`), 300 ms and 600 ms into the wait (`02`, `03`), and the
  recording lane (`04`). These are the frames the previous round owed and could
  not take.
- **`narrow/`** - the same four states, dark and light, at the app's declared
  minimum width (`LO_ACK_WINDOW_SIZE=800x900`; `WINDOW_MIN_WIDTH = 800` is the
  floor `window-mode.ts` clamps a request to, so this is the narrowest composer
  the shipped app ever draws). This is the measurement the earlier round named
  as the first thing a re-run should take, and had to leave unmeasured.
- **`mini/`** - the mini quick-send view (the second renderer document a global
  hotkey summons), dark and light: the acknowledgment while the acquisition is
  held (`01`) and the recording lane (`02`), each with the window's own height
  reading beside it.

The claim "**the press costs the composer 0 px**" is measured at TWO widths and
in BOTH palettes, not one: 1380x900 and the app's 800 px floor, plus the mini
view's own 640 px window, whose HEIGHT is the number that matters there. The row
the caption sits in is `flex-nowrap` with this row's own yield rules (the cwd chip
truncates, the usage reading drops below 480px of composer) and the caption is
`shrink-0`, so the floor is where it was most likely to give - and it does not:
at 800 the composer is 696 px wide and the caption is the SAME 112.6 px in the
SAME row, ending 4 px left of the mic, with the card's box identical to rest
(774/110/884) at every sample point. The numbers are in the tables below, beside
the frames they describe, and the run records they come from are in the set.

## The frames

Each frame is the app photographing itself (`Page.captureScreenshot` for the
main window, webp q88; `webContents.capturePage` for the mini document, encoded
to webp q88), captured in the FROZEN `--window-mode=headless` (never shown,
never focused). The main-window frames are 1380x900 @ dpr 2 (2760x1800 actual
pixels) except `narrow/`, which is 800x900 @ dpr 2 (1600x1800); the mini frames
are the mini document at its own fixed width (1280 px device = 640 CSS, heights
336-480 device px = 168-240 CSS as the window sizes to content - the shortest,
336 device px, is the 168 CSS base the mini table below reads at rest). A capture under
load is not instantaneous, so every frame is labelled by the state read taken
immediately before AND after it in the run record (`shot.*` keys); the quoted
offsets are the page clock at capture request time, relative to that cycle's
click.

- `before/01-click-idle/` (+68 ms) and `before/02-click-still-idle/` (+381 ms):
  the resting composer - mic present, no recording controls, no indicator. **The
  two panes are not the same state, and the pair is about the COMPOSER rather
  than the transcript**: `01` was taken while the conversation was still loading
  ("Loading conversation...") and `02` after it settled, so what the two carry is
  that the composer's own region is byte-identical between them - nothing in it
  changed during the wait (design round 2, D7: the bullets used to leave that
  difference unsaid). These two frames ARE the report: ~0.4 s into a wait the run
  says lasts 866 ms, nothing on screen has changed.
- `before/03-recording/`: after the flip, settled 650 ms - the recording lane.
- `after/01-ack-just-after-click/` (+41 ms), `after/02-ack-300ms-into-wait/`
  (+414 ms), `after/03-ack-600ms-into-wait/` (+600 ms): **the FIRST treatment**
  (`94368b7057`) - the acknowledgment as a line in the lane's slot, with the
  control showing its busy spinner (`aria-busy`) - while that run's acquisition
  is still pending (it resolved at +793 ms). This head puts the same words in
  the control row instead - see `shipped/`, `narrow/` and `mini/` below, which are
  the frames of it this round took.
- `after/04-recording/`: the same recording lane as before, same treatment.
- `shipped/01-ack-just-after-click/` (+41-45 ms), `shipped/02-ack-300ms-into-wait/`
  (+300 ms), `shipped/03-ack-600ms-into-wait/` (+600 ms), `shipped/04-recording/`:
  **the SHIPPED treatment**, dark and light. The acknowledgment is the word pair in
  the control row ("Starting recording") with the mic carrying the busy ring; the
  acquisition is held open by the rig (`LO_ACK_HOLD_MS=2500`, so this run's
  acquisition numbers are the hold's and are not quoted as the app's), and `04` is
  the same lane after the release. Geometry is unchanged at every sample: see the
  table below.
- `narrow/01-`..`narrow/04-`: the same four states at `--window-size=800x900`,
  dark and light - the app's own floor width. Nothing in the treatment moves with
  the width: the caption is the same 112.6 px, the card the same 774/110/884, the
  mic the same 32 px box.
- `mini/01-ack-while-pending/` and `mini/02-recording/`: the mini quick-send
  view's own window, dark and light, with the height reading taken at rest and
  during the press recorded beside the frames (`mini/stt-ack-mini.json`): the
  window is 168 CSS tall at rest and 168 during the acknowledgment, and the
  composer box stays 80 tall with the mic at x 560.

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

### Round 2 (2026-10-02): the same measurement at a second width, in both palettes, and in the mini

The tables below are this round's re-shoot: the deferred half of design round 1's
D4 (both palettes) and the whole of the width question, plus the mini view. They
were taken with the rig as committed (`LO_ACK_WINDOW_SIZE` for the width,
`--theme` for the palette) against the tree this commit ships, with the
acquisition held open so the waiting state stands still. Each table names its own
run records, which sit beside the frames.

**1380x900 @ dpr 2, dark and light** - `shipped/stt-ack-shipped-dark-1380.json`,
`shipped/stt-ack-shipped-light-1380.json`:

| state | card top | card height | card bottom | mic control x | ack caption |
| --- | --- | --- | --- | --- | --- |
| at rest (both palettes) | **774** | **110** | 884 | 1141 | - |
| preparing, all five samples (both palettes) | **774** | **110** | 884 | 1141 | x 1024.4, 112.6x19.5, y 842.3-861.8 |
| recording, settled (both palettes) | 690 | 194 | 884 | (start control absent) | lane x 431, 778x64 |

**800x900 @ dpr 2 (the app's floor), dark and light** -
`narrow/stt-ack-narrow-dark-800.json`, `narrow/stt-ack-narrow-light-800.json`:

| state | card top | card height | card bottom | mic control x | ack caption |
| --- | --- | --- | --- | --- | --- |
| at rest (both palettes) | **774** | **110** | 884 | 692 | - |
| preparing, all five samples (both palettes) | **774** | **110** | 884 | 692 | x 575.4, 112.6x19.5, y 842.3-861.8 |
| recording, settled (both palettes) | 690 | 194 | 884 | (start control absent) | lane x 96, 664x64 |

At the floor the composer box is 696 px wide (x 80) instead of 810, so 114 px of
row width is gone; the caption is the SAME 112.6 px and still ends 4 px left of
the mic (x 575.4 + 112.6 = 688, mic at 692), and the card's top, height and bottom
are unchanged from rest through every preparing sample. "Costs 0 px" is therefore
a reading at both widths and in both palettes, not a claim about one size.

**The mini quick-send view (640 CSS wide)** - the driver scene's own readings,
recorded in `mini/stt-ack-mini.json`:

| reading | window height | window width | composer box | mic x |
| --- | --- | --- | --- | --- |
| at rest | **168** | 640 | y 38, h **80** | 560 |
| while acknowledging the press | **168** | 640 | y 38, h **80** | 560 |

The window's height is the number that matters here: the mini view is
measure-driven at a 168 px base, and the specific worry was that the caption
would grow it. It does not - the height, the box and the mic are identical
during the press - and `mini/01-...` is that state in both palettes. The
recording lane (`mini/02-...`) does grow the window to 240 CSS; that is the
pre-existing lane behaviour, not this round's.


The same record (`after/stt-ack-remediation.json`) carries the acknowledgment's
own timing with the acquisition **held open** (the capture hold below, so the
numbers that describe the wait are not this run's): `click -> ack` committed
**1.3 ms** after the click (painted 75.4 ms under a load average above 60) with
`ackKind: "preparing"`, and **0 desktop-transport calls and 0 fetches** between
the click and `getUserMedia` -
the gates are read, not called, so the press is not waiting on them.

The lifecycle the findings pinned is in `scripts/shared-composer.test.mjs`:
not-`disabled` with a second press refused by the handler's own guard, the
Escape ladder's presence covering the press window, and Escape settling the
pending start (the stream still lands, and it lands on a discarded take).

## What was re-shot, and what the re-shoot could not exercise

The design round asked for this head's frames in BOTH themes, a narrow width, and
a mini-view frame with the mini window's height before and after the press; the
previous round could not take any of them (the host refused every app run on
2026-10-02, load 91-137 with swap at 46.7 of 48.1 GB). **All of them are in this
set now**, taken on 2026-10-02 evening with the fleet recovered (instantaneous
load fell from ~160 to ~14 across the runs), each run's own first accepted
attempt and none re-touched:

- `shipped/` and `narrow/` - dark and light, at 1380x900 and at the 800 px floor
  (the rig's `LO_ACK_WINDOW_SIZE`), four states each;
- `mini/` - the driver scene's `--scene mini-view` against the same isolated
  backend, dark and light, with the window's height read at rest and during the
  press (`mini/stt-ack-mini.json`).

**One run was discarded rather than published.** The first light narrow attempt
captured a transport blip - the pane read "Lost the connection to this
conversation" and the composer showed its provider footnote, so its resting card
sat 25.4 px higher than every other run's (748.6 against 774). It is not in the
set; the light narrow run committed here is a clean one whose resting geometry
matches the dark narrow run exactly. A frame of the app having lost its socket is
not a measurement of this change, and publishing it beside the others would have
made the pair read as a theme difference.

**What the re-shoot could not exercise, stated rather than implied:**

- **The real macOS microphone permission prompt (TCC).** Every run uses
  Chromium's synthetic capture device (`--use-fake-device-for-media-stream`) and,
  for the mini document, the driver's page-side fake `getUserMedia`, so the
  acknowledgment is photographed over a synthetic acquisition with no OS consent
  dialog in it. The prompt's own latency, and its interaction with the
  acknowledgment, are not measured here and cannot be from this rig.
- **The mini scene run reports six failing checks, none of them in the mic
  walk.** With `--backend` pointed at a FRESH isolated daemon, the scene's
  send/model checks find no model catalog (`backend=null` for the resolved model
  name) and no chief-of-staff conversation (`/v1/desktop/sessions/<id>/history`
  answers 404), so "the frame renders the name the backend resolves", "the
  readings strip offers a model chip to press", "the chip opened the frame's own
  compact sheet", "admission painted the Sent flash", "the daemon reports a
  chief-of-staff conversation" and "the daemon's own history carries the message
  the composer sent" FAIL. The mic walk's own checks - the press acknowledged
  before the recorder exists, the acknowledgment costs the mini window no height,
  the recording state, no Send control while a take is live, Enter confirming
  rather than sending - all PASS, and the frames committed here come from that
  walk. The six are named rather than filtered out, and they are a property of
  the scratch daemon this rig owns (no seeded agent, no conversation), not of the
  change.
- **A width below the app's floor.** `window-mode.ts` clamps a requested size up
  to `WINDOW_MIN_WIDTH`/`HEIGHT` (800x600), so 800 px is the narrowest composer
  the shipped app can draw; there is no narrower one to measure.

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
- `shipped/stt-ack-shipped-dark-1380.json`, `shipped/stt-ack-shipped-light-1380.json`
  - the shipped treatment at 1380x900, one hold cycle each, dark and light. The
  source of the `shipped/` frames and of both 1380 rows of the round-2 table.
- `narrow/stt-ack-narrow-dark-800.json`, `narrow/stt-ack-narrow-light-800.json` -
  the same treatment and the same hold cycle at `LO_ACK_WINDOW_SIZE=800x900`,
  dark and light (the app clamps to its 800 floor; the rig asks for exactly it).
  The source of the `narrow/` frames and of the 800 rows.
- `mini/stt-ack-mini.json` - the mini-view driver run's own readings, extracted
  from its log: the two `miniGeom` notes (window height/width, composer box, mic
  x) verbatim, the frame sizes, the theme, and the six failing check names, so the
  disclosure above is a record rather than a paragraph.

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
`<stem>/<theme>.webp` shape by hand from the run's flat `frames/` output, and each
run logs the size it actually got (`viewport`): `{w:1380,h:900,dpr:2}` for
`shipped/`, `{w:800,h:900,dpr:2}` for `narrow/`.

The width is a run parameter, not a constant (round 2):

```sh
LO_ACK_WINDOW_SIZE=800x900 LO_ACK_THEME=localOperatorLight LO_ACK_HOLD_MS=2500 \
  LO_ACK_WARMUP=1 LO_ACK_SHOTS=on LO_ACK_LABEL=shipped-light-800 \
  LO_ACK_REPO=<worktree> LO_ACK_BACKEND=http://127.0.0.1:11877 \
  LO_ACK_TOKEN=$(cat $SP/backend/token) \
  node scripts/stt-ack-latency-proof.mjs <out-dir> 1
```

The mini-view set is the same backend and a different rig - the driver arms its
own dev-driver exerciser, and the bearer comes from the environment, never argv:

```sh
LOCAL_OPERATOR_DESKTOP_TOKEN=$(cat $SP/backend/token) \
  node scripts/renderer-driver.mjs --scene mini-view \
    --backend http://127.0.0.1:11877 \
    --backend-records $SP/backend/config/run/serve \
    --seed-onboarding-complete --theme localOperatorDark --out <dir> --clean
# its frames are PNG (capturePage); the committed ones are webp q88, the rig's
# own encoding, converted with sharp.
```

**Not exercisable headlessly, stated rather than implied:** macOS TCC. The
synthetic capture device and the driver's page-side fake `getUserMedia` bypass
the OS microphone grant, so a real first-use permission prompt is on top of every
number above and is not measured here.
