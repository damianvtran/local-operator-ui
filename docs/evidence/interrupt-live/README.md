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
LOCAL_OPERATOR_CONFIG_DIR=$CONFIG LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  <python-with-local-operator>/bin/local-operator serve --port 1131 &

# 2. the app, built, headless, pointed at that backend
pnpm build

# 3. the proof: frames and the machine-readable record land in the out-dir
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
`CMUX_*`/`LOP_*` variable is removed from the app's environment.

## What each frame is

| Frame | What it shows |
| --- | --- |
| `turn-running.png` | A turn streaming against the mock provider. The composer says "Waiting for the agent" and the Stop control is offered at the right of the row. This is the state the reported defect was photographed in: pressing the control did nothing, because it posted `sessions.command {command: "stop"}`, which the backend answers with a presentation form. |
| `after-stop.png` | After the control was pressed at its painted pixels: the transcript carries "Interrupted", the composer is back to "Ask me for help", and the control is GONE. The backend reports `streaming: false` with `last_turn_outcome: aborted` while `[bash:45]` had ~44 s left to run. |
| `after-escape.png` | The same, driven by Escape: the aborted `bash sleep 45` row shows the tool was killed 0.3 s in rather than completing, and the turn ends with the session still alive. |
| `idle-escape.png` | Escape with nothing running: the composer keeps its draft and no notice is rendered. A stopped turn with no children and no background jobs says nothing at all, which is the notification bridge's own rule about a completed `interrupted`. |
| `pane-escape.png` | The run-details pane claiming a press that did not come from it: opened from its own trigger, focus in the composer, one Escape - the pane is gone and the turn is STILL streaming (`pane.escape`: `{openBefore: true, openAfter: false, streamingAfter: true}`). QA round 1's Q2 measured the opposite on the previous head, where one press interrupted the turn and left the pane open. |

`interrupt-proof.json` is the same run's record: the capability map the app
negotiated (including `session_interrupt: 1`), the backend's streaming state
before and after each press, the aim point and the hit-test result for the click,
the composer cluster's own boxes in both states, the second press at the point the
first one landed, and the draft before and after the idle press.

### The reserved slot, measured

UX round 1's U1 and QA's Q1 both found that the dictation control slid into the
Stop's box, so a reflex second press at the same coordinates started a
microphone recording. The fix reserves the box, and the rig measures it rather
than describing it (`slot.*` steps, default rung, CSS pixels):

```
slot.clusterIdle    mic x=1235 w=32 centre=1251 | reserved-slot x=1271 w=32 centre=1287 | Send x=1307
turn1.pressed       rect {w:32,h:32,left:1271,top:803}  (the Stop occupies 1271..1303)
slot.repress        owner "div|not-reserved"  after {recording:false, mic:true}
```

The reserved box is at the control's own coordinates to the pixel, the dictation
control does not move between the two states, and pressing the point the first
press landed in afterwards starts nothing. The same claim is asserted without a
browser in `scripts/interrupt-control.test.mjs` at BOTH rungs (the small view
reserves a 28px box, matching the `icon-sm` control it stands in for).

## Reproducibility, stated precisely

A re-shoot of these frames reproduces every frame byte for byte EXCEPT for
anti-aliasing on a few text pixels, and that is measured twice rather than
asserted once:

- reviewer round 1's NIT 3: `chat-message-input/idle/localOperatorDark.webp`
  moved 246 pixels with a maximum channel delta of 2 in a 16x24 box on the
  placeholder's glyphs, while its Light sibling came back byte-identical from the
  same run;
- the pass that re-stamped this branch after the remediation commit moved
  `chat-message-input/interrupt-left-work-running/tokyoNight.webp` by 20 pixels
  with a maximum delta of 4 in a 4x6 box, on the first line of the notice's own
  text.

So the difference is not confined to a pass's first frame (where it would be a
settle race), it is not a layout or colour change - box edges, control positions
and every ground and ink role are identical across passes - and the cause is
unresolved rather than explained away. The claim this file makes is therefore "no
layout or colour change between passes", not "byte-identical".

## What these frames do NOT show

The children-still-running notice. The mock provider runs one tool and no
subagents, so `children_running` and `background_jobs` are always 0 here and the
notice is correctly absent — which is why the notice's copy and its three
branches are pinned by `scripts/interrupt-control.test.mjs` instead, and rendered
by the `InterruptLeftWorkRunning` story.
