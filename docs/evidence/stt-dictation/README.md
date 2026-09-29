# The speech-to-text overhaul, proven in the shipped app

Thirteen frames and two wire records from `scripts/stt-dictation-proof.mjs`, which
drives the BUILT app headless against an **isolated** `local-operator` backend
(its own config root, its own bearer), a **fake Radient upstream** bound by the
rig, and a **recording proxy** in front of the backend. The microphone is
Chromium's synthetic capture device (`--use-fake-device-for-media-stream`), so
every press in here lands on a live control deterministically. The baseline this
is measured against is `stt-dictation-baseline/` (same rig, same commands,
pre-change tree).

What the run is FOR, in the operator's own order of complaints: recording no
longer replaces the composer; the mic works mid-turn; push-to-talk engages on
the press; a mid-turn send rides the steer path; and the `input_mode` stamp
rides the wire when - and only when - the harness advertises it.

## How to re-run it

```sh
# 1. the isolated backend: scratch config root, scratch HOME, auto approvals
#    (a rig turn must not park at a gate), and the rig's fake upstream as the
#    Radient base. `--yolo` and `tool_approval_mode: auto` are belt and braces.
SP=<this session's scratch>
env -u XPC_FLAGS HOME="$SP/stt-backend/home" \
  LOCAL_OPERATOR_CONFIG_DIR="$SP/stt-backend/config" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat $SP/stt-backend/token)" \
  RADIENT_API_BASE_URL=http://127.0.0.1:8799 \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  ~/local-operator/.venv/bin/local-operator serve --host 127.0.0.1 --port 1131 --yolo
# config.yml: values: {hosting: test, model_name: mock, tool_approval_mode: auto}

# 2. a placeholder RADIENT_API_KEY in that config root (the mic gates on one):
curl -X PATCH -H "Authorization: Bearer $(cat $SP/stt-backend/token)" \
  -H 'Content-Type: application/json' http://127.0.0.1:1131/v1/credentials \
  -d '{"key":"RADIENT_API_KEY","value":"placeholder-for-the-proof-rig"}'

# 3. the renderer must be BUILT against this run's proxy (its URL is baked):
#    .env: VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080
pnpm build

# 4. the run. LO_PROOF_INJECT=on is the second half of the input_mode contract;
#    off (the default) is the shape that ships - see `INJECT_INPUT_MODE`.
LO_PROOF_TOKEN=$(cat $SP/stt-backend/token) LO_PROOF_BACKEND=http://127.0.0.1:1131 \
  node scripts/stt-dictation-proof.mjs $SP/stt-proof-after
```

The rig needs `LO_PROOF_PROXY_PORT` (default 8080) free, and binds
`LO_PROOF_RADIENT_PORT` (default 8799) itself. It strips every inherited
`CMUX_*`/`LOP_*`, redirects HOME/config/logs/Electron profile into its own
out-dir, sets the notification and telemetry switches, and reaps every process
it starts by pid.

## 1. Recording is a state of the composer (the frames)

`05-recording-space.png` (baseline) is the defect: at the press the field
disappears and a full-width washed panel - `● Recording`, a waveform across the
whole box, a border - takes its place. The draft the user was mid-thought in is
gone from the screen; the record's `sessionA.recordingTreatmentSpace` says it in
data: `textarea:false, draft:null`.

`02-recording-combo.png` (this tree) is the same moment: the draft
("review the stt overhaul") is still in the field, the field is still mounted
(`textarea:true`), and the state is one small line under it - dot, "Recording",
a bounded waveform - with the confirm/cancel controls where they already were.
The record: `textarea:true, indicator:true, draft:"review the stt overhaul"`.
`03-transcribing.png` is the same treatment for the transcribing state
("Processing audio" on one small line, the draft untouched), and
`docs/evidence/stt-dictation-baseline/05-recording-space.png` is the before
frame for the pair. The box grows 110px → 150px for the strip; nothing is
centred across the measure and nothing covers a character.

## 2. Push-to-talk engages on the press (timings, page-side)

Both numbers are `performance.now()` at the keydown the page received →
`performance.now()` when the recording indicator mounted (the rig's own
instrumentation, not a shell clock).

| run | binding | result |
| --- | --- | --- |
| baseline | hold Right-Option | key delivered (`deliveredToPage:true`), NOTHING engages - no handler exists |
| baseline | hold Space | engages after **1810 ms**: the 1000 ms hold-timer plus the first `getUserMedia` of the app instance |
| this tree | hold Right-Option, first use of the session | **1356-2719 ms** across takes - all of it `getUserMedia` + AudioContext init on a synthetic device under fleet load; there is no timer left to wait for |
| this tree | hold Space, warm | **92-241 ms** |
| this tree | hold Right-Option, WARM (mid-turn, frame 10) | **75-196 ms** |

The cold figure is reported rather than averaged away, and macOS TCC is
explicitly NOT part of it: the fake capture device bypasses the OS grant, so
the cold number here is the app's own first-use cost. A real microphone grant
adds the TCC prompt on top and is not measurable headlessly.

## 3. Dictation is available while a turn runs

`09-typed-row-mid-turn.png` follows a `[bash:40]` turn that is genuinely
streaming (checked against the backend, not inferred). The rig samples the
mic's own DOM state across the first ~6 s after the press:

- baseline: `disabledCount:54, firstEnabledAt:2160` - the control is disabled
  for the whole admit-to-first-answer window (the operator's report).
- this tree: `disabledCount:0, firstEnabledAt:0` - enabled from the first
  sample, inside the same window.

`10-dictating-mid-turn.png` is the hold landing mid-turn: the turn's tool row
is still running (`Running sleep 40`, live timer), the composer reads "Steer the
agent. Enter sends now · Esc stops", and the recording strip is live.
`11-dictated-mid-turn.png` is the transcript on the box, mid-turn.

## 4. A mid-turn send rides the steer path

`12-sent-mid-turn-steer.png` is taken at the echo, while the turn still runs:
the dictated message is in the transcript, the composer reads "Sending your
message", and the Stop control is live. The record's own claims, all against
the same press: the recorded wire body says `mode:"steer"` (the app chose it
because the session was busy), `streamingBeforeSteer:true`, and the row is
durable at **588 ms** with `messageLandedWhileStreaming:true`. The steer's own
drain then interrupted the running tool (that is what a steer does at a tool
boundary), which is why `streamingAtSteer` - read after the drain - is false.

## 5. `input_mode` on the wire, and the two shapes it has

The rig records every `POST .../messages` body through its proxy. Two runs
prove the two halves of the capability gate:

- this tree, capability NOT advertised (`stt-proof.json`): all three bodies
  carry NO `input_mode` at all - `input_mode:null, mode:"legacy-body"` for a
  mixed draft, a typed send and a dictated steer. This is the shape that ships
  today: an older harness validates the body with `extra="forbid"`, so the app
  must degrade silently, and does.
- this tree, capability injected by the proxy (`stt-proof-injected.json`):
  `input_mode:"mixed"` (typed draft + two transcripts), `input_mode:"typed"`
  (typed probe), `input_mode:"dictated"` (the steered message).

The injected run is a proxy and is honest about what it drives: the backend in
this tree does not implement the field yet, so it refuses each stamped body
with `422 Unprocessable Entity` (per the daemon's access log) and the turn does
not run - which is exactly the skew the capability gate exists to prevent, and
why the wire evidence and the end-to-end evidence are two runs rather than one.
`input_path` is reserved and carried absent by every caller; the store pins it
beside `input_mode` so a replay stays byte-identical the day its first caller
arrives.

## 6. A dictated row renders exactly like a typed one

`rows.dictatedMatchesTyped.equal:true`, from the same run: the rig finds the
typed row ("typed probe [bash:40]") and the dictated one ("dictated steer
probe from the fake upstream.") by their own text and compares the bubble's
subtree - tag plus class list per element, text excluded. They are identical;
the field is carried and never rendered. (The frames 08/09 and 12 show the two
rows side by side.)

## 7. A transcript landing around a send: the ordering, measured

`13-transcript-in-echo-window.png` and `sessionC.*` in the record. The rig
holds the fake upstream's ANSWER behind a gate, starts a recording, stops it,
lets the transcription park upstream, then sends the typed draft with a
released answer - and instruments the composer FIELD itself (a patched `value`
setter on the node) so every write the app makes to its own box is timestamped
from inside the frame rather than sampled for.

The measured ordering of that run: press at `24086.6`, the send's clear (an
empty write) at `+10.8 ms`, the transcript's write at `+21.9 ms` - so in THIS
rig the transcript rides the fresh-append path: it is not lost, and it does not
resurrect the sent text; both are asserted (`transcriptSurvivedTheEcho`, and
the box ends holding exactly the transcript).

The composed-clear path - the transcript arriving INSIDE the press-to-echo
window, where `appendTranscriptText` waits on `sendClearPendingRef` and
`clearOnce` writes the clear and the transcript as one - is RECORDED, NOT
CLAIMED (`sessionC.composedClear`): this rig's own release plumbing (page ->
rig -> upstream -> backend -> app) costs ~17 ms against a window it measures at
~11 ms, so no construction of it can land inside; the wider window the
machinery exists for is the app's slow-create condition (the pane comment's p50
142 ms / max 409 ms under load, where the clear waits on `sessions.create`),
which this rig does not manufacture. The wait path's correctness therefore
rests on reading, not on this run - stated here rather than buried.

## What this does NOT claim

- **The composed-clear ordering** (§7): the wait machinery's in-window path
  is recorded, not claimed - this rig measures the press-to-echo window at
  ~11 ms against its own ~17 ms release plumbing, so the run rides the
  fresh-append path (asserted: no loss, no resurrection). The in-window path is
  covered by reading; a future rig that delays `sessions.create` could claim it.
- **The main-process chords** (`Cmd/Ctrl+Shift+S`, and the palette chords) are
  bound in `before-input-event`, which a headless window never receives - see
  `docs/agent-driver.md`. They are untouched by this change and unmeasured
  here.
- **macOS TCC** first-use time is not in any number above (fake capture device);
  stated rather than buried.
- **The canvas inline editor's** dictation door was wired to the same hold
  contract but is not driven live by this rig (it needs a canvas document);
  its release path is covered by reading, and the composer is the surface this
  run exercises.
- **The real `local-operator` carriage** of `input_mode` does not exist yet;
  the stamped run therefore uses an injected capability and a backend that
  refuses the field (see §5). The app-side gate is what makes shipping ahead of
  the carriage safe.
- **`input_mode` downgrade note:** a runtime that WRITES the field and then
  reads its own rows again is fine; an OLDER runtime re-reading those rows
  drops the message (`extra="forbid"`). Same-machine forward-only use, per the
  change's own analysis; recorded here so nobody discovers it from a missing
  row.
