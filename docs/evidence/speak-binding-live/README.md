# speak-binding — the live press, and what the reader sees

Thirteen frames from the app's own rig: a real Electron launch in `headless` window
mode, a real conversation on a daemon this run owns, and real pointer presses on the
two press surfaces the operator reported (the answer row's Speak control, and the
selection toolbar's).

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
(`POST /v1/desktop/sessions {target: {kind: "agent", name: "aida"}}`), which is the
state the reported bug is about; `--speak-arm open` uses the ordinary first send,
which is born with no binding at all. The `speak-binding` scene is a **temporary
rig** and is not committed — this file is the record of what it did.

## The frame set

| file | what it is |
| --- | --- |
| `<arm>-before-press.png` | the answer row with its Speak control, at rest |
| `<arm>-hovered.png` | the pointer on the control: the row is a hover reveal, and this is the moment before the press |
| `<arm>-loading.png` | **the press itself**: the control's own busy state, captured before the response |
| `<arm>-after-press.png` | **the reader's sentence**, on screen (a raw capture held on the toast) |
| `<arm>-selection-raised.png` | a real drag across the answer's text, which raises the selection toolbar |
| `<arm>-selection-after-press.png` | the toolbar's own press, and its sentence |
| `speak-binding-disabled.png` | a daemon with **no speech credential**: the control is rendered disabled, and the run records that state instead of pressing an inert button |

**Why the outcome frames are RAW captures.** `captureSettled` — the helper every
layout frame here uses — waits for the screen to be **toast-free** before it keeps a
frame. That is right for a layout still and exactly wrong for a press whose outcome
*is* a toast: round 1's `after-press` frames photographed the press's chrome and not
its result (design round 1, D1; UX round 1, U2 — the diff between the two was a
13,336-pixel composer focus ring). The `-loading` and `-after-press` frames are
therefore plain `capture` calls: `-loading` is taken on the press, and `-after-press`
waits for the toast to *arrive* (`firstToast` polls the app's own sonner DOM) and
then 500 ms past its entrance, so the card is not photographed mid-slide.

## What the daemon saw, per arm

| arm | surface | the app's request | status | the toast the reader saw |
| --- | --- | --- | --- | --- |
| pre-fix (round 1, base) | answer row | `POST /v1/agents/8756ab151f78/speech` (the **pane's session id**) | 404 | "This conversation's agent is no longer available." |
| **bound** — `aida` → `agent_id 1d9c4467-…` | answer row | `POST /v1/agents/1d9c4467-ac0f-45d9-b529-4a54628ea342/speech` | 401 | "Your Radient sign-in has stopped working. Sign in again in Settings." |
| **bound** | selection toolbar | the same request | 401 | the same sentence |
| **open** — no binding | answer row | `POST /v1/tools/speech` `{"input": "…"}` | 422 | "Couldn't speak this aloud. Try again." |
| **open** | selection toolbar | the same request | 422 | the same sentence |
| **disabled** — no speech credential | answer row | *(no request: the control is disabled)* | — | — |

The 401 is the **daemon's credential step** — the rig carries a placeholder key, so
nothing synthesises. What matters is what it means: the registry **resolved the
agent**. A name or a session id answers 404 with the designed sentence instead
(row 1), which is the defect this branch removes.

The 422 on the agent-less arm is the shipped daemon's schema, not the UI: that
route's `model`/`voice` become optional (as a pair, selecting the descriptor path)
in `local-operator` **#1922**, head `e4f8d9e8e` — which ships **before** this half,
so the window in which an unbound press answers 422 is bounded by that sequencing.

**What is not photographed, and why:** the **playing** state (the control's `Stop`
form) needs a synthesis that actually succeeds, and that needs a working Radient
key — the rig's is a placeholder, and the repo's rules forbid spending the
operator's. The playing state is therefore source-only here; the disabled and
loading states beside it are real.

**Recorded so a later pass does not "fix" them:** the row spaces its pair `gap-1`
and the selection strip `gap-0.5` (28 px controls in a 32 px strip vs a 28 px action
row) — deliberate, and each is right for its own density (design round 1, D5).

`2048x1520` pixels at a `1024x760` viewport, `devicePixelRatio` 2 — the app
photographing itself, via `webContents.capturePage()`, in a window that is never
shown and never focused.
