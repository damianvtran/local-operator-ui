# `interrupt-live` — the press, in the real app, against a real turn

Frames from `scripts/interrupt-esc-proof.mjs`, which presses the composer's Stop
control and then Escape against a turn that is genuinely running, in the built
app paired with a live backend.

## How to re-run it

The backend must be a build that carries the interrupt route
(`POST /v1/desktop/sessions/{id}/interrupt`), started with a bearer of your own
choosing and in its own config directory. The backend's mock provider is what
makes the turn deterministic: `[bash:45]` in the last user message runs the REAL
`bash` tool with `sleep 45`, so a turn that stops in under a second stopped
because it was interrupted and not because its work ran out.

```sh
# 1. an isolated backend, its own config dir, a bearer this run invents
export CONFIG=/tmp/interrupt-e2e/config
export TOKEN=$(python3 -c 'import uuid; print(uuid.uuid4())')
mkdir -p "$CONFIG"
#    The mock provider has to be CONFIGURED, or every turn answers 503 "No model
#    provider is configured yet" and no turn ever streams. `test` is the registry
#    id (its alias is `mock`), and it takes no API key.
cat > "$CONFIG/config.yml" <<'YAML'
values:
  hosting: test
  model_name: mock
YAML
LOCAL_OPERATOR_CONFIG_DIR=$CONFIG LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  <python-with-local-operator>/bin/local-operator serve --port 1131 &

# 2. AND a placeholder Radient credential in that same scratch config dir. The
#    composer gates the dictation control on one (`canEnableRecordingFeature`),
#    so without it the control renders DISABLED and every press this rig makes
#    starts nothing for a reason that has nothing to do with the row's layout -
#    the hazard measurement would pass vacuously. The value is a placeholder in a
#    throwaway directory; it is never sent anywhere (the only route that would
#    use it is transcription, which this run never reaches).
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://127.0.0.1:1131/v1/credentials \
  -d '{"key":"RADIENT_API_KEY","value":"placeholder-for-the-proof-rig"}'

# 3. the app, built, headless, pointed at that backend
pnpm build
```

**The app does not read the API URL from its launch environment.** `main`'s
config dotenv-loads the repository's `.env` with `override: true`
(`src/main/backend/config.ts`), so `VITE_LOCAL_OPERATOR_API_URL=<somewhere else>`
in the spawn environment is rewritten by that file before it is validated -
measured here: with the variable set to `http://127.0.0.1:1199` at launch, the
app still logged `Backend service configured with port 1111 and URL
http://127.0.0.1:1111`, the port that file names, and every request this rig made
went to the run's backend while the app dialled that one. So point the WORKTREE's
`.env` at the run's backend and rebuild:

```sh
sed -i '' 's|^VITE_LOCAL_OPERATOR_API_URL=.*|VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:1131|' .env
pnpm build
```

```sh
# 4. the proof: frames and the machine-readable record land in the out-dir
LO_PROOF_TOKEN=$TOKEN LO_PROOF_BACKEND=http://127.0.0.1:1131 \
  node scripts/interrupt-esc-proof.mjs /tmp/interrupt-live-proof
```

`LO_PROOF_SESSION` reuses an existing session instead of creating one, and
`LO_PROOF_CDP_PORT` pins the devtools port (otherwise one nobody is listening on
is chosen immediately before the spawn).

The run never touches the operator's app: `HOME`, `LOCAL_OPERATOR_CONFIG_DIR` and
the Electron profile are all inside the out-dir, `LOCAL_OPERATOR_UI_WINDOW_MODE`
is `headless` (nothing is ever shown or focused), and the notification kill
switches are exported to the app and to the backend behind it. Every inherited
`CMUX_*`/`LOP_*` variable is removed from the app's environment. The rig also
launches Electron with `--use-fake-device-for-media-stream`, because the dictation
control is one of the things it presses: on a box with no capture device, or one
whose microphone grant the terminal does not hold, Chromium's synthetic device is
what makes that press land on a live control deterministically rather than making
the measurement a property of the machine it ran on.

## What each frame is

| Frame | What it shows |
| --- | --- |
| `turn-running.png` | A turn streaming against the mock provider. The composer says "Waiting for the agent" and the Stop control is offered at the right of the row. This is the state the reported defect was photographed in: pressing the control did nothing, because it posted `sessions.command {command: "stop"}`, which the backend answers with a presentation form. |
| `after-stop.png` | After the control was pressed at its painted pixels, INSIDE the grace window: the transcript carries "Interrupted", the composer is back to "Ask me for help", and the Stop control is gone - but its box is still held, so the row is `[dictation][held box][Send]` exactly as it was while the turn ran. This is the "before" half of the pair below, and it is the state UX round 1's U1 and QA's Q1 measured the hazard in. |
| `after-stop-settled.png` | The SAME run 1.6 s later, once the window has passed: the held box is gone and the row is `[dictation][Send]` adjacent - the operator's report answered. This is the "after" half. The two frames differ in the composer cluster and in one 48x39 patch in the header where an attention indicator cleared between the two instants, measured: 4,521 of the frame's 4,791,360 pixels, bounded by `x 2491..2606, y 19..1670`. |
| `after-stop-settled-recording.png` | The proof that the control is LIVE where it now sits: a real pointer press at the dictation control's own centre from `after-stop-settled.png` starts a recording, its level meter running. Nothing about the recording action was refused or greyed to close the gap. |
| `after-escape.png` | The same, driven by Escape: the aborted `bash sleep 45` row shows the tool was killed 0.3 s in rather than completing, and the turn ends with the session still alive. |
| `idle-escape.png` | Escape with nothing running: the composer keeps its draft and no notice is rendered. A stopped turn with no children and no background jobs says nothing at all, which is the notification bridge's own rule about a completed `interrupted`. |
| `pane-escape.png` | The run-details pane claiming a press that did not come from it: opened from its own trigger, focus in the composer, one Escape - the pane is gone and the turn is STILL streaming (`pane.escape`: `{openBefore: true, openAfter: false, streamingAfter: true}`). QA round 1's Q2 measured the opposite on the previous head, where one press interrupted the turn and left the pane open. |

`interrupt-proof.json` is the same run's record: the capability map the app
negotiated (including `session_interrupt: 1`), the backend's streaming state
before and after each press, the aim point and the hit-test result for the click,
the composer cluster's own boxes in all three states (running, held, settled),
each measurement's distance from the page's own timestamp for the transition, the
second press at the point the first one landed, the press that starts a
recording, and the draft before and after the idle press. Its `claims` array is
empty when every claim held; a claim that does not hold is recorded with
`ok: false` and fails the run.

### The reserved box, measured on both sides of its grace window

UX round 1's U1 and QA's Q1 both found that the dictation control slid into the
Stop control's box, so a reflex second press at the same coordinates started a
microphone recording. The first fix reserved the box permanently, which removed
the hazard and left the standing gap the operator then reported; this branch holds
it for a grace window instead (`src/renderer/src/features/chat/interrupt-slot-
grace.ts`), so an idle composer is `[dictation][Send]` and the window is the half
second a reflex press arrives in. The rig measures both sides of it, so the record
is the claim rather than a description of one - default rung, CSS pixels, stamped
against the page's own clock:

```
slot.clusterRunning  mic x=1235 w=32 centre=1251 | Stop x=1271 w=32 centre=1287 | Send x=1307 w=32
slot.clusterGrace    mic x=1235 w=32 centre=1251 | held box x=1271 w=32 centre=1287 | Send x=1307 w=32
                     at 260 ms after the flip (window 500 ms)
turn1.pressed        rect {w:32,h:32,left:1271,top:803}  (the Stop occupied 1271..1303)
slot.repress         at 260..265 ms after the flip, point {1287,819}
                     owner "div|not-reserved"  after {recording:false, mic:true}
slot.clusterSettled  mic x=1271 w=32 centre=1287 | Send x=1307 w=32
                     at 1869 ms after the flip, gap 4 px = the row's own gap
slot.livePress       point {1287,819} hits button[aria-label="Start recording"], disabled false
                     after {recording:true, mic:false}
```

Four things are being measured there, and none of them is asserted from a
constant:

- the box is at the control's own coordinates to the pixel and of the control's
  own size, so the row does not move when the turn ends - the held row and the
  row the turn ran with are the same boxes, `slot.graceIsTheBusyRow`;
- the second press, arriving 260 ms into a 500 ms window, starts NOTHING
  (`slot.repressStartsNothing`) - and that measurement is only worth anything
  because the SAME point, once the window has passed, starts a recording
  (`slot.livePressStartsRecording`). Same coordinates, same run, same app: one
  press intercepted by the box, one landing on a live control. The rig refuses to
  report either if the dictation control was disabled (`dictation.live`), which is
  what makes the first of those a measurement of the box rather than of a dead
  button;
- the collapse really happened: at 1869 ms the box is absent, the row is the two
  controls with the row's own 4 px between them, and the dictation control's left
  edge is where the box had been held (`slot.settledCollapses`);
- the dictation control's centre at (1287, 819) is owned by a control that is not
  disabled (`slot.micLiveAtItsNewCentre`), which is the operator's own
  requirement - the gap is gone and nothing the user wants to do became inert.

The same claim is asserted without a browser in `scripts/interrupt-control.test.mjs`
at BOTH rungs, from the shipped source: the running row is `[dictation][Stop][Send]`,
the settled row is `[dictation][Send]` with one row gap between the controls, the
held box is the control's own box at whichever rung the row is on, and the box's
mount is gated on the grace predicate - whose own rules (held inside the window,
released after it, not held on a fresh mount, re-armed by a second traversal) are
unit-tested with an injected clock in that file.

## Reproducibility, stated precisely

Two claims, and both are about THIS run rather than carried from an earlier pass:

- **within the run**, `after-stop.png` and `after-stop-settled.png` are 1.6 s
  apart on one session and one turn, and everything outside the composer cluster
  is byte-identical between them except one 48x39 patch in the header (an
  attention indicator that cleared). That is a stricter comparison than a
  before/after across two builds: the only variables are the grace window and the
  clock.
- **across passes**, a re-shoot of an earlier head reproduced every frame byte for
  byte EXCEPT anti-aliasing on a few text pixels, and that was measured twice
  rather than asserted once: reviewer round 1's NIT 3 found
  `chat-message-input/idle/localOperatorDark.webp` moving 246 pixels with a maximum
  channel delta of 2 on the placeholder's glyphs while its Light sibling came back
  byte-identical, and a later re-stamp moved
  `chat-message-input/interrupt-left-work-running/tokyoNight.webp` by 20 pixels
  with a maximum delta of 4. That claim belongs to those passes and the frames here
  were re-taken, so this file does not carry it forward as a property of the
  current set: what these frames state is what the record beside them says.

## What these frames do NOT show

The children-still-running notice. The mock provider runs one tool and no
subagents, so `children_running` and `background_jobs` are always 0 here and the
notice is correctly absent — which is why the notice's copy and its three
branches are pinned by `scripts/interrupt-control.test.mjs` instead, and rendered
by the `InterruptLeftWorkRunning` story. Nor do they show the grace window at a
rung other than the default one: the window and the box's own size are asserted at
both rungs in that test file, and the small-view rung is photographed in
`chat-message-input/stop-slot-settled-small-view`.
