# The speech-to-text overhaul, proven in the shipped app

Sixteen frames and two wire records from `scripts/stt-dictation-proof.mjs`,
which drives the BUILT app headless against an **isolated** `local-operator`
backend (its own config root, its own bearer), a **fake Radient upstream** bound
by the rig, and a **recording proxy** in front of the backend. The microphone is
Chromium's synthetic capture device (`--use-fake-device-for-media-stream`), so
every press in here lands on a live control deterministically. The baseline this
is measured against is `stt-dictation-baseline/` (same rig, same commands,
pre-change tree).

Every number below is quoted from the two records in THIS directory
(`stt-proof.json` = the shipping run; `stt-proof-injected.json` = the proxy-
injected capability run). PROVENANCE: both records are from the QA-round-1
remediation build of this branch's tip - the tree they ship beside, containing
the PTT/Esc claim and the settle-retire fix - and every earlier pair is
superseded. Budgets in the
rig are the run's PATIENCE (cold `getUserMedia` on this fleet has measured
595 ms to >3000 ms under load), not ceilings on the gesture: the measured
latency is recorded whatever it is.

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
`LO_PROOF_RADIENT_PORT` (default 8799) itself - if that port is taken, move the
rig with `LO_PROOF_RADIENT_PORT` and point the backend's `RADIENT_API_BASE_URL`
at the same number (this session ran on 8783 for exactly that reason). It strips every inherited
`CMUX_*`/`LOP_*`, redirects HOME/config/logs/Electron profile into its own
out-dir, sets the notification and telemetry switches, and reaps every process
it starts by pid.

## 1. Recording is a state of the composer (the frames)

`docs/evidence/stt-dictation-baseline/05-recording-space/localOperatorDark.webp` is the defect: at
the press the field disappears and a full-width washed panel - `● Recording`, a
waveform across the whole box, a border - takes its place. The draft the user
was mid-thought in is gone from the screen; the baseline record says it in data:
`textarea:false, draft:null`.

`02-recording-combo/localOperatorDark.webp` (this tree) is the same moment: the draft ("review the
stt overhaul") is still in the field, the field is still mounted
(`textarea:true`), and the state is one small line under it - dot, "Recording",
a bounded waveform - with the confirm/cancel controls where they already were.
The record: `textarea:true, indicator:true, draft:"review the stt overhaul"`
(`sessionA.recordingTreatment`). `03-transcribing/localOperatorDark.webp` is the same treatment for
the transcribing state ("Processing audio" on one small line, the draft
untouched). The box grows 110px → 150px for the strip; nothing is centred across
the measure and nothing covers a character.

The waveform lane is captured SETTLED (design round 1, D4): the shots are taken
450 ms after the engage flip, so the analyser has drawn its first bars - the
earlier capture raced the first frame and photographed an empty lane.

## 2. Push-to-talk engages on the press (timings, page-side)

Both numbers are `performance.now()` at the keydown the page received →
`performance.now()` when the recording indicator mounted (the rig's own
instrumentation, not a shell clock). Quoted from `stt-proof.json`:

| run | binding | result |
| --- | --- | --- |
| baseline | hold Right-Option | key delivered (`deliveredToPage:true`), NOTHING engages - no handler exists |
| baseline | hold Space | engages after **1810 ms**: the 1000 ms hold-timer plus the first `getUserMedia` |
| this tree | hold Right-Option, first use | **574 ms** (`sessionA.comboEngages`, `cold:true`) - `getUserMedia` + AudioContext init on a synthetic device under fleet load; there is no timer left to wait for |
| this tree | hold Space, warm | **158 ms** (`sessionA.spaceEngages`) |
| this tree | hold Right-Option, warm, mid-turn | **47 ms** (`sessionB.midTurnComboEngages`) |

The cold figure is reported rather than averaged away, and macOS TCC is
explicitly NOT part of it: the fake capture device bypasses the OS grant, so the
cold number here is the app's own first-use cost. A real microphone grant adds
the TCC prompt on top and is not measurable headlessly.

## 3. Dictation is available while a turn runs

`09-typed-row-mid-turn/localOperatorDark.webp` follows a `[bash:40]` turn that is genuinely
streaming (checked against the backend, not inferred). The rig samples the
mic's own DOM state across the first ~6 s after the press:

- baseline: `disabledCount:54, firstEnabledAt:2160` - the control is disabled
  for the whole admit-to-first-answer window (the operator's report).
- this tree: `disabledCount:0, firstEnabledAt:0` - enabled from the first
  sample, inside the same window.

## 4. A mid-turn send rides the steer path

`12-sent-mid-turn-steer/localOperatorDark.webp` is taken at the echo, while the turn still runs:
the dictated message is in the transcript, and the composer shows its
send-unsettled line "Sending your message" (the steer line - "Steer the agent.
Enter sends now · Esc stops" - is the NEXT state, once the echo settles). The
record's claims, all against the same press: the recorded wire body says
`mode:"steer"` (`sessionB.midTurnSendIsSteer`,
asserted), the turn was streaming before the press
(`streamingBeforeSteer:true`, read from the backend), and the snapshot flag's
whole series across the send - with its samples - reads
`{"streamingBeforeSteer":true,"streamingAtSteer":false,"streamingAtDelivery":false,"messageLandedWhileStreaming":false,"landedAtMs":526,"streamingObservedAfterSend":true}`
with `true` at 19 ms, then `false` at 346/733/906/1043/1223 ms. So the
delivery-window reads caught the tool-segment boundary dip and this run's
series shows NO comeback inside the sampled window; `streamingObservedAfterSend`
is the rig's `some(samples)` read, satisfied by the press-side sample - it is
not a recovery claim. The row landed at 526 ms (the poll's read, not a
delivery SLA).

## 5. `input_mode` on the wire, and the two shapes it has

The rig records every `POST .../messages` body through its proxy. Two runs
prove the two halves of the capability gate:

- this tree, capability NOT advertised (`stt-proof.json`): all bodies carry NO
  `input_mode` - `input_mode:null, mode:"legacy-body"` for a mixed draft, a
  typed send and a dictated steer. This is the shape that ships today: an older
  harness validates the body with `extra="forbid"`, so the app must degrade
  silently, and does.
- this tree, capability injected by the proxy (`stt-proof-injected.json`):
  `input_mode:"mixed"` (typed draft + transcript), `input_mode:"typed"` (typed
  probe), `input_mode:"dictated"` (the mid-turn message), `input_mode:"typed"`
  (the echo-window send).

The injected run is a proxy and is honest about what it drives: the backend in
this tree does not implement the field yet, so it refuses each stamped body
(`422`, per the daemon's access log) and the turn does not run - which is
exactly the skew the capability gate exists to prevent, and why the wire
evidence and the end-to-end evidence are two runs rather than one. `input_path`
is reserved and carried absent by every caller; the store pins it beside
`input_mode` so a replay stays byte-identical the day its first caller arrives.

## 6. A dictated row renders exactly like a typed one

`rows.dictatedMatchesTyped.equal:true`, from the same run: the rig finds the
typed row ("typed probe [bash:40]") and the dictated one ("dictated steer
probe from the fake upstream.") by their own text and compares the bubble's
subtree - tag plus class list per element, text excluded. They are identical;
the field is carried and never rendered.

## 7. A transcript landing around a send: the ordering, measured

`13-transcript-in-echo-window/localOperatorDark.webp` and `sessionC.*` in the record. The rig
holds the fake upstream's ANSWER behind a gate, starts a recording, stops it,
lets the transcription park upstream, then sends the typed draft with a
released answer - and instruments the composer FIELD itself (a patched `value`
setter on the node) so every write the app makes to its own box is timestamped
from inside the frame.

The measured ordering of this run: press at `30448.8`, the send's clear (an
empty write) at `+10.1 ms`, the transcript's write at `+16.6 ms` - so in THIS rig
the transcript rides the fresh-append path: it is not lost, and it does not
resurrect the sent text; both are asserted. The composed-clear path - the
transcript arriving INSIDE the press-to-echo window, where
`appendTranscriptText` waits on `sendClearPendingRef` and `clearOnce` writes the
clear and the transcript as one - is RECORDED, NOT CLAIMED
(`sessionC.composedClear.observed:false`): this rig's own release plumbing
(page → rig → upstream → backend → app) costs ~15 ms against a window it
measures at ~9 ms, so no construction of it can land inside; the wider window
the machinery exists for is the app's slow-create condition (p50 142 ms / max
409 ms under load, where the clear waits on `sessions.create`), which this rig
does not manufacture. The wait path's correctness therefore rests on reading,
not on this run - stated here rather than buried.

## 8. The recording's own edges (review round 1)

`15-edge-takes-settled/localOperatorDark.webp` and `sessionD.*`. Three takes whose release or
abort lands INSIDE the `getUserMedia` window, plus the control:

- release-in-window (a tap): `recording:false, transcribing:false` after the
  settle, the draft untouched, and 0 transcription calls;
- double tap inside the window: same - the second start is refused while the
  first attempt is still resolving, and the releases still settle it;
- abort inside the window (the binding's keydown, then Shift): same, and the
  take is DISCARDED rather than transcribed;
- the control: a normal take afterwards still records and lands
  (`edge take probe fourth dictation from the fake upstream.`), which is what a
  wedged recorder - the silent-mic ordering the review found - would fail.

`14-mic-tooltip/localOperatorDark.webp` is the tooltip, hovered through the trusted input pipeline:
`Start recording (Cmd+Shift+S or hold Right-Option)` - the binding named from
the same resolver the dispatcher matches (design round 1, D1), so the tooltip
can no longer teach the old hold-Space gesture.

`16-esc-ptt-cancels-take-not-turn/localOperatorDark.webp` and `sessionE.*` (QA round 1, Q-1): with
a turn genuinely streaming (`streamingBeforeEsc:true`), the binding is held
until the strip is up and Escape is pressed once. The take is cancelled
(`recording:false` after the settle), the discarded take never reached the
transcription upstream (`calls:0`), and the turn is STILL streaming ~1.2 s
later with its outcome not `aborted` (`streamingAfterEsc:true,
lastTurnOutcome:""`) - rung 4's promise, on the door where round 1's fix did
not hold. In the injected run the same sequence is recorded as an observation
(`observed:false`): that run's sends are refused by the legacy backend, so no
turn exists for the press to spare - the shipping run, the shape that ships,
asserts it.

And the transcript's boundary (design round 1, D2; UX round 1, U2): the same
records show the join - `review the stt overhaul dictated words from the fake
upstream.` (one space, no glued word), including the mid-turn send.

## 9. The push-to-talk row is the binding (the keymap seam)

Session F is this follow-up's live leg: `keymap.push_to_talk` landed in the
harness's registry (local-operator #1750 - the six-token bare-modifier hold
family), and the app now READS it through the desktop transport instead of
hard-coding the platform pair. The rig patches the persisted row on the
isolated backend, reloads the window (a fresh registration re-reads it), and
the record carries every answer: `sessionF.rowPatched {status:200}`,
`sessionF.tooltipFollowsTheRow {ok:true}` with the tooltip reading "...or hold
Left-Command" (label follows the token), `sessionF.rowCodeEngages {ok:true}`
(`MetaLeft` flips the recording indicator), the negative control
`sessionF.oldDefaultNoLongerEngages {ok:true}` (the previous default no longer
engages), and the restore leg reading the default back
(`sessionF.rowRestored {status:200}`, `defaultRestored {ok:true}` with "...or
hold Right-Option", `defaultCodeEngages {ok:true}`, `AltRight`).

Two rig consequences ride with it. The row is reset to its registry default
at boot (`boot.pushToTalkReset {status:200}`) because the rig MUTATES
persistent config now: an interrupted run must not leave the app bound to a
key the next run's earlier sessions do not hold - the first run after the
seam landed did exactly that, and every earlier engage claim fell with it.
And the wire claims FOLLOW the capability the backend advertises
(`advertisedInputMode`), because with the carriage landed, "what ships" is
whatever this process advertises rather than a fixed shape.

## What this does NOT claim

- **The composed-clear ordering** (§7): recorded, not claimed - the rig cannot
  land inside the window it measures; the in-window path rests on reading.
- **The main-process chords** (`Cmd/Ctrl+Shift+S`, and the palette chords) are
  bound in `before-input-event`, which a headless window never receives. They
  are untouched by this change and unmeasured here.
- **macOS TCC** first-use time is not in any number above (fake capture device);
  stated rather than buried.
- **The canvas inline editor's** recording arm was rebuilt onto the same
  attempt-ref contract (review round 1, M1) and its release/abort settles are
  covered by reading, not by a live take - the rig does not open a canvas
  document. Its composer-side arm is what session D drives.
- **`pnpm check-evidence`** (the frame sweep) is a job in `ci.yml` now (`evidence`,
  gated on any diff that can move a frame, the manifest, a palette or the
  decoder) - wiring it in is what made the 20 findings already sitting on `main`
  visible at all. What runs on EVERY pull request is the other half, the desktop
  suite's `scripts/evidence-manifest.test.mjs` (the manifest/stamp half). The frames
  ship as WebP on the sweep's canonical `<stem>/<theme>.webp` layout (theme
  `localOperatorDark`, measured - worst `\u0394E00 0.00` across all 22), re-encoded
  losslessly from this rig's PNG captures (pixel-identical to the originals, ICC
  profile carried; verified by a direct decode comparison, 0 differing bytes), so
  the set resolves in the sweep - counts and per-frame theme - and the rig now
  captures WebP directly into the same layout (`format: "webp"`, `quality: 88`,
  the convention `capture-evidence.mjs` uses).
- **The real `local-operator` carriage** of `input_mode` does not exist yet;
  the stamped run therefore uses an injected capability and a backend that
  refuses the field (see §5). The app-side gate is what makes shipping ahead of
  the carriage safe.
- **`input_mode` downgrade note:** a runtime that WRITES the field and then
  reads its own rows again is fine; an OLDER runtime re-reading those rows
  drops the message (`extra="forbid"`). Same-machine forward-only use, per the
  change's own analysis; recorded here so nobody discovers it from a missing
  row.
