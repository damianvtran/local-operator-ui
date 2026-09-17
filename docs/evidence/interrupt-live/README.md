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
#    the hazard measurement would pass vacuously, and the dictation-in-flight
#    step could not run at all. The value is a placeholder in a throwaway
#    directory; it is never sent anywhere (the only route that would use it is
#    transcription, which this run never reaches).
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
http://127.0.0.1:1111`, the port that file names. So point the WORKTREE's `.env`
at the run's backend and rebuild:

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

**Give the backend a moment before the first request.** Measured twice: the
server logs `Starting server at …` and still refuses connections for several
seconds afterwards while it seeds its config directory, so a `curl` fired at the
log line times out rather than erroring.

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
| `after-stop-settled.png` | The SAME run 1.7 s later, once the window has passed: the held box is gone and the row is `[dictation][Send]` adjacent - the operator's report answered. This is the "after" half. The two frames differ **only** in the composer cluster: 4,297 of the frame's 4,791,360 pixels, bounded at `x 2491..2606, y 1606..1670` - the dictation control's 36px arrival and nothing else. Not one pixel outside that box changes. |
| `after-stop-settled-recording.png` | The proof that the control is LIVE where it now sits: a real pointer press at the dictation control's own centre from `after-stop-settled.png` starts a recording, its level meter running. Nothing about the recording action was refused or greyed to close the gap. |
| `after-stop-recording-held.png` | The DICTATION-IN-FLIGHT shape, inside the window: a recording is running and a turn was stopped under it, so the row is `[Confirm recording][Cancel recording][held box]` - the box holds the rightmost slot, exactly where the Stop control was drawn in this shape. |
| `after-stop-recording-settled.png` | The same row AFTER the window has passed. The **cluster region of this frame is byte-identical to the one above it** (0 differing pixels in `250x90+2450+1600`): with a dictation in flight the box is not released at the window's end, so nothing moves under a press. |
| `after-recording-ends.png` | The recording cancelled: the row collapses to `[dictation][Send]` - and only now, when the recording ends, is the dictation control released to its idle position. |
| `after-escape.png` | The same as `after-stop.png`, driven by Escape: the aborted `bash sleep 45` row shows the tool was killed 0.3 s in rather than completing, and the turn ends with the session still alive. |
| `idle-escape.png` | Escape with nothing running: the composer keeps its draft and no notice is rendered. A stopped turn with no children and no background jobs says nothing at all, which is the notification bridge's own rule about a completed `interrupted`. |
| `pane-escape.png` | The run-details pane claiming a press that did not come from it: opened from its own trigger, focus in the composer, one Escape - the pane is gone and the turn is STILL streaming (`pane.escape`: `{openBefore: true, openAfter: false, streamingAfter: true}`). QA round 1's Q2 measured the opposite on the previous head, where one press interrupted the turn and left the pane open. |

`interrupt-proof.json` is the same run's record: the capability map the app
negotiated (including `session_interrupt: 1`), the backend's streaming state
before and after each press, the aim point and the hit-test result for each click,
the composer cluster's own boxes in every state (running, held, settled, and the
three dictation-in-flight states), each measurement's distance from the page's own
timestamp for the transition, the second press at the point the first one landed,
the press that starts a recording, the whole run's row-transition timeline, and
the draft before and after the idle press. Its `claims` array is empty when every
claim held; a claim that does not hold is recorded with `ok: false` and fails the
run.

### The reserved box, measured on both sides of its grace window

UX round 1's U1 and QA's Q1 both found that the dictation control moved into the
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
                     at 74 ms after the flip (window 500 ms)
turn1.pressed        rect {w:32,h:32,left:1271,top:803}   (the Stop occupied 1271..1303)
slot.repress         at 161..170 ms after the flip, point {1287,819}
                     owner "div|not-reserved"  after {recording:false, mic:true}
slot.clusterSettled  mic x=1271 w=32 centre=1287 | Send x=1307 w=32
                     at 1776 ms after the flip, gap 4 px = the row's own gap
slot.micPoint        {1287,819} owned by button[aria-label="Start recording"], disabled false
slot.livePress       after {recording:true, mic:false}
```

**Send never moves, in any state.** It is pinned to the composer's right edge
(1307, width 32) while running, inside the window and after it; the control that
moves is the **dictation** control, 1235 → 1271 as the box is released, which is
exactly the Stop's own 32px plus the row's 4px gap. That is what makes the window
necessary rather than decorative: an idle row whose dictation control sits beside
Send is the row in which the control has arrived in the vacated box.

Four things are being measured there, and none of them is asserted from a
constant:

- the box is at the control's own coordinates to the pixel and of the control's
  own size, so the row does not move when the turn ends - the held row and the row
  the turn ran with are the same boxes (`slot.graceIsTheBusyRow`);
- the second press, arriving 161-170 ms into a 500 ms window, starts NOTHING
  (`slot.repressStartsNothing`) - and that measurement is only worth anything
  because the SAME point, once the window has passed, starts a recording
  (`slot.livePressStartsRecording`). Same coordinates, same run, same app: one
  press intercepted by the box, one landing on a live control. The rig refuses to
  report either if the dictation control was disabled (`dictation.live`), which is
  what makes the first of those a measurement of the box rather than of a dead
  button;
- the collapse really happened: at 1776 ms the box is absent, the row is the two
  controls with the row's own 4 px between them, and the dictation control's left
  edge is where the box had been held (`slot.settledCollapses`);
- the dictation control's centre at (1287, 819) is owned by a control that is not
  disabled (`slot.micLiveAtItsNewCentre`), which is the operator's own
  requirement - the gap is gone and nothing the user wants to do became inert.

### The dictation-in-flight shape, where the arriving control would be destructive

While a recording runs, Send is not rendered at all: the row draws
`[Confirm recording][Cancel recording]` where the dictation control and Send were,
and the held box renders AFTER them. With only the grace term the release would
move BOTH of them 36 px right, and the control that arrived in the Stop's own box
was **Cancel recording** - a press more than a window after a turn ended would
throw away in-flight audio. Every figure below is a committed one; the pair of rows
is assembled from two records this repository carries, because the term-absent
shape itself was measured in a scratch run whose record was not retained (the
"held" row is this record's own `inFlight.grace`, which the recording term holds;
the "released" row is the previous head's own record of the same row once the box
is gone, `git show 043b0b7c3:docs/evidence/interrupt-live/interrupt-proof.json`,
`slot.recordingCancelled.aim.rect.left = 1307`):

```
inFlight.grace           at 205 ms    [Confirm x=1235][Cancel x=1271][box x=1307]  ← the box holds the Stop's own slot
inFlight.pressed                       the Stop's rect in this shape: left 1307 w 32
043b0b7c3, released                    [Confirm x=1271][Cancel x=1307]              ← both moved +36, Cancel in the Stop's box
```

So `message-input.tsx` holds the box whenever the dictation controls are rendered
as well as during the window. Measured in the shipped run:

```
inFlight.grace           at 205 ms    [Confirm 1235 w=32][Cancel 1271 w=32][held box 1307 w=32]
inFlight.afterWindow     at 1226 ms   identical boxes; the cluster region of the two frames differs by 0 pixels
inFlight.recordingEnded  the recording is cancelled → [dictation 1271][Send 1307], gap 4
```

**What the shape costs, stated because it is not "nothing visible":** for the whole
recording the row's rightmost *visible* control sits one control-plus-gap short of
the row's right edge, because the third slot is held empty and the box draws no
ink - `after-stop-recording-settled.png` decodes to `[✓][✗]` ending at 1302.5 with
the interior's right edge at 1338.5. It is a **trailing** void rather than the
operator's defect: both controls are drawn where the right-justified cluster puts
them, nothing is displaced, and the row's rightmost element is flush to the edge.
It is also not introduced here - it is `origin/main`'s own recording row, whose
reservation was unconditional (that half is a source reading: `main` carries no
frame of the state) - so against `main` this change removes the void from the idle
row and leaves this one alone, and removing it here would reopen the destructive
arrival above.

**Starting a recording moves the pair 36 px left**, and that is recorded rather
than left to be discovered: the third slot fills from the instant `isRecording` is
true, so `[dictation 1271][Send 1307]` becomes `[Confirm 1235][Cancel 1271][box
1307]` - the slot that was just pressed (the dictation control's own, 1271) comes
back as **Cancel recording** where it would otherwise be Confirm. Legible and one
press from recovery, and the alternative (filling the slot only once a window
opens under a recording) trades it for a 36 px jump at the moment a turn ends
under a recording, which is the re-layout class this change exists to bound. It is
`main`'s own geometry too, at the same 36 px.

`isTranscribing` deliberately gets no such term, and that is a statement rather
than an omission: `!isTranscribing` gates both the dictation control and Send, so
while a transcription is in flight the row draws nothing a press could reach in
the vacated box.

**The sibling hazard this deliberately does not fix**, measured from the same
step: after the recording ends, the dictation control comes back into the box the
recording's own Cancel control had been in (`inFlight.recordingEnded.takesBack`:
`"Cancel recording"`) - a press aimed at Cancel's position during the recording
lands on the dictation control once it ends. It predates this change, is unchanged
by it, and is recorded in the PR's "not addressed" list rather than fixed here.

### The arrival, and what it costs (UX round 1, U1)

The window turns one re-layout into two, and the second one happens with no input
from the user: the row is still for 500 ms after the turn ends and then the
dictation control arrives in the vacated box and takes hover, if the pointer is
resting on the control that was pressed. A turn that ends with nobody touching the
composer pays the same 500 ms and the same arrival.

That is inherited rather than introduced - on the unreserved build the control slid
into the same box instantly, at the moment of the press (the hazard this branch
bounds) - and the trade stated here is WHERE the change lands rather than whether
one happens: delaying it past the moment the user's attention has moved to the
transcript, in exchange for a reflex press landing on nothing. Every alternative
was argued at the site: a permanent reservation reinstates the operator's defect,
holding the box while the pointer rests in it makes the row change shape on hover,
and greying the control is a lie. The release itself is instant, with no
interpolation (`getComputedStyle(cluster).transitionProperty = "all"`,
`transitionDuration = "0s"`).

### The one-frame re-derivation, attributed rather than silenced (QA Q1 / UX U4)

QA round 1 saw the Stop control flash back for a single frame in ~4 of 14
settlements (more often at the 800 rung) and sampled it unproven; UX round 1
sampled one 5.8 ms frame of the same shape. The rig now records every transition
of the Stop, the box and the composer's own placeholder for the whole run, from a
MutationObserver - not a rAF sampler, which can miss a pulse shorter than a frame
and which measurably slowed the rig's own measurements when it was one.

What that found, and what it does not:

- **In this run: none.** 70 DOM mutations and 26 transitions over 16.0 s, 0 pulses
  - consistent with QA's own 0 of 9 at 1380 in round 1. The claim is checkable
  against the timeline rather than asserted: the rig admits 5 turns, and the
  record's 5 Stop appearances are exactly those 5 admissions, so no
  `{stop: true, slot: false}` episode stands inside a live window.
- **The pulse is real, and it is not this wiring's.** QA round 1 saw it in ~4 of 14
  settlements (a 534-550 ms collapse instead of 500) and UX round 1 sampled one
  5.8 ms frame of it; in round 2 QA reproduced it on this head at **14 ms after a
  settle, 165 ms wide**, with the box back at its falling edge and released 501 ms
  after the second edge - and that same report is where the rate comes from, **1
  pulse in 10 settlements at 1380 and 0 in 8 at the small-view rung** (round 1:
  0 of 9 at 1380, 4 of 14 overall). Those figures are their authors' and are cited
  as such: the observations behind them are in the PR's review rounds, and this
  repository ships no record of them.
- **Attribution, which their reports and this one agree on:** the composer's own
  placeholder is the busy string, `"Waiting for the agent"`, in the pulse's own
  transition - so the pulse is the canonical layer re-deriving the turn as active.
  This wiring cannot make the composer say the turn is running: the fold only
  follows `active`.
- **Effect, bounded by construction rather than by a timer.** The pulse drops the
  live deadline and its falling edge opens a fresh window, so the arrival lands one
  window after the pulse and no further - QA round 2 measured exactly that (501 ms
  after the second edge) and found the end state correct. During the pulse the
  point belongs to the Stop control, never to the dictation control, so the hazard
  stays closed. That is why this is documented rather than debounced: a
  minimum-hold heuristic would trade a bounded delay for a rule nobody can check
  against the tree.

`scripts/interrupt-control.test.mjs` replays that sequence through the fold as the
regression pin ("a one-frame re-derivation of the control's own state restarts the
window, bounded"): the shape, the fresh window and the bound are asserted there
against the fold, so the property does not depend on any run's record.

## Reproducibility, stated precisely

Three claims, all measured rather than carried from an earlier pass:

- **within a run**, `after-stop.png` and `after-stop-settled.png` are 1.7 s apart
  (74 ms and 1,776 ms after the composer's own flip) on one session and one turn,
  and their whole-frame difference is 4,297 pixels bounded at
  `x 2491..2606, y 1606..1670` - inside the cluster, with a masked trim over the
  same two frames reporting NOTHING outside it. That is a stricter comparison than
  a before/after across two builds: the only variables are the window and the
  clock;
- **the in-flight pair** is the same comparison with a recording running:
  `after-stop-recording-held.png` and `after-stop-recording-settled.png` are
  1.0 s apart, and their cluster region is byte-identical (0 of 22,500 pixels in
  `250x90+2450+1600`) - the release moves nothing while a dictation is in flight;
- **across passes**, a re-shoot of an earlier head reproduced every frame byte for
  byte EXCEPT anti-aliasing on a few text pixels, measured twice rather than
  asserted once (reviewer round 1's NIT 3 found
  `chat-message-input/idle/localOperatorDark.webp` moving 246 pixels with a
  maximum channel delta of 2, and a later re-stamp moved
  `chat-message-input/interrupt-left-work-running/tokyoNight.webp` by 20 pixels
  with a maximum delta of 4). That claim belongs to those passes and the frames
  here were re-taken, so this file does not carry it forward: what these frames
  state is what the record beside them says.

## What these frames do NOT show

- **The children-still-running notice.** The mock provider runs one tool and no
  subagents, so `children_running` and `background_jobs` are always 0 here and the
  notice is correctly absent — which is why the notice's copy and its three
  branches are pinned by `scripts/interrupt-control.test.mjs` instead, and rendered
  by the `InterruptLeftWorkRunning` story.
- **The small-view rung.** The rig's measurements are taken at the default rung;
  the rung's own box sizes and the equal invariant are pinned at both rungs in
  `scripts/interrupt-control.test.mjs`, and the settled row is photographed by
  `chat-message-input/stop-slot-settled-small-view`.
- **The transcribing row, the legacy `isLoading && currentJobId` row and the
  keyboard shortcuts** (QA round 1's Q2-Q4). All three were BLOCKED live on this
  machine: with a placeholder Radient credential the transcription fails before the
  row paints, the legacy Stop-agent row needs a backend without the canonical chat
  layer, and `Cmd+Shift+S` is bound in main's `before-input-event`, which
  synthesised CDP events do not reach. Each is covered at unit or source level
  (see the PR's testing evidence) and none is claimed as exercised here.
