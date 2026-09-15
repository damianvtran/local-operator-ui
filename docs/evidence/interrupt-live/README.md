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

`interrupt-proof.json` is the same run's record: the capability map the app
negotiated (including `session_interrupt: 1`), the backend's streaming state
before and after each press, the aim point and the hit-test result for the click,
and the draft before and after the idle press.

## What these frames do NOT show

The children-still-running notice. The mock provider runs one tool and no
subagents, so `children_running` and `background_jobs` are always 0 here and the
notice is correctly absent — which is why the notice's copy and its three
branches are pinned by `scripts/interrupt-control.test.mjs` instead, and rendered
by the `InterruptLeftWorkRunning` story.
