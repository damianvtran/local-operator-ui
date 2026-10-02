# speak-binding — the live press, before and after

Ten frames from the app's own rig: a real Electron launch in `headless` window
mode, a real conversation on a daemon this run owns, and real pointer presses on
the two press surfaces the operator reported (the answer row's Speak control, and
the selection toolbar's).

## The command

```sh
# the daemon: the installed generation, its own HOME and config root
HOME=<rig>/home LOCAL_OPERATOR_CONFIG_DIR=<rig>/config lop serve --host 127.0.0.1 --port 8080

# the app: built from this branch, pointed at that daemon
LOCAL_OPERATOR_DESKTOP_TOKEN=<the serve record's claim_key> \
node scripts/renderer-driver.mjs --scene speak-binding \
  --speak-arm bound --speak-binding-name aida --speak-selection \
  --seed-onboarding-complete \
  --backend http://127.0.0.1:8080 \
  --backend-records <rig>/config/run/serve \
  --window-size 1024x760 --out <out>
```

`--speak-arm bound` creates the conversation **on a role target**
(`POST /v1/desktop/sessions {target: {kind: "agent", name: "aida"}}`), which is
the state the reported bug is about; `--speak-arm open` uses the ordinary first
send, which is born with no binding at all. The `speak-binding` scene is a
**temporary rig** and is not committed — this file is the record of what it did.

## What the daemon saw, per arm

| arm | surface | the app's request | status | the toast the reader saw |
| --- | --- | --- | --- | --- |
| pre-fix (`0b0b4cd099`'s base, recorded in round 1) | answer row | `POST /v1/agents/8756ab151f78/speech` (the **pane's session id**) | 404 | "This conversation's agent is no longer available." |
| **bound** — `aida` → `agent_id 1d9c4467-…` | answer row | `POST /v1/agents/1d9c4467-ac0f-45d9-b529-4a54628ea342/speech` | 401 | "Your Radient sign-in has stopped working. Sign in again in Settings." |
| **bound** | selection toolbar | the same request | 401 | the same sentence |
| **open** — no binding | answer row | `POST /v1/tools/speech` `{"input": "…"}` | 422 | "Couldn't speak this aloud. Try again." |
| **open** | selection toolbar | the same request | 422 | the same sentence |

The 401 is the **daemon's credential step** — the rig carries a placeholder
key, so nothing synthesises. What matters is what it means: the registry
**resolved the agent**. A name or a session id answers 404 with the designed
sentence instead (row 1), which is the defect this branch removes.

The 422 on the agent-less arm is the shipped daemon's schema, not the UI: that
route's `model`/`voice` become optional (as a pair, selecting the descriptor
path) in `local-operator` **#1922**, head `e4f8d9e8e`. Until it ships, a
conversation with no role agent fails with the generic sentence — which is what
row 4 is a photograph of.

## The frames

| file | what it is |
| --- | --- |
| `speak-binding-<arm>-before-press.png` | the answer row with its Speak control, at rest |
| `speak-binding-<arm>-hovered.png` | the pointer on the control: the row is a hover reveal, and this is the moment before the press |
| `speak-binding-<arm>-after-press.png` | the press's outcome |
| `speak-binding-<arm>-selection-raised.png` | a real drag across the answer's text, which raises the selection toolbar |
| `speak-binding-<arm>-selection-after-press.png` | the toolbar's own press |

The toast in the `after-press` frames is the run's own reading taken *while it
was up* (the failure toast lands on the store's async path, so a read at the
instant of the pointer release can beat it); nothing in these frames is a
composite.

`2048x1520` pixels at a `1024x760` viewport, `devicePixelRatio` 2 — the app
photographing itself, via `webContents.capturePage()`, in a window that is never
shown and never focused.
