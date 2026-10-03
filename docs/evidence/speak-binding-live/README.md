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
  --speak-hold-pid <the daemon's pid> \
  --seed-onboarding-complete \
  --backend http://127.0.0.1:8080 \
  --backend-records <rig>/config/run/serve \
  --window-size 1024x760 --out <out>
```

`--speak-arm bound` creates the conversation **on a role target**
(`POST /v1/desktop/sessions {target: {kind: "agent", name: "aida"}}`), which is the
state the reported bug is about; `--speak-arm open` uses the ordinary first send,
which is born with no binding at all. `--speak-hold-pid` is described under the
loading frame below. The `speak-binding` scene is a **temporary rig** and is not
committed — this file is the record of what it did.

## The frame set

| file | what it is |
| --- | --- |
| `<arm>-before-press.png` | the answer row with its Speak control, at rest, before any press - **in the `open` arm this frame carries no row at all** (measured: 0 lit pixels in the row band against 790 in the `bound` arm's), so that set's first frame showing the row is its `hovered`. The two arms' `before-press` frames are two different app states, not a regression between them: the `open` arm installs no role profile, so its sidebar list differs (35,072 device px), and its transcript had not painted the row when the frame was taken |
| `<arm>-hovered.png` | the pointer on the control: the row's actions are painted at rest on this head (measured 790 lit pixels in the row band at `before-press`, unchanged by the hover), so the hover paints the row's wash rather than revealing it. This is the moment before the press |
| `<arm>-loading.png` | **the press itself**: the control in its busy state |
| `<arm>-after-press.png` | **the reader's sentence**, on screen (a raw capture held on the toast) |
| `<arm>-selection-raised.png` | a real drag across the answer's text, which raises the selection toolbar |
| `<arm>-selection-after-press.png` | the toolbar's own press: the toolkit raised over the selection, with the selection still shown. The **`bound`** frame carries the sentence on a card caught **mid-entrance** (dimmed, sitting low, running to the frame's last row) - the entrance state, not the settled one. In the **`open`** frame the notice is not in the picture at all: the run reads it out of the app's own toast DOM and it has gone before the capture lands, so that press's sentence is quoted from the read, not from the pixels. Both are stated in the frame table rather than explained twice below |
| `speak-binding-disabled.png` | a daemon with **no speech credential**: the control is rendered disabled, and the run records that state instead of pressing an inert button |


**How the outcome frames were taken, because the round-1 set got this wrong.**
`captureSettled` — the helper every layout frame here uses — waits for the screen to
be **toast-free** before it keeps a frame, so an outcome frame taken with it could
never show a press's result (design round 1, D1; UX round 1, U2 — the round-1
`after-press` diff was a 13,336-pixel composer focus ring and nothing else). The
`-loading` and `-after-press` frames are therefore plain `capture` calls:

- `-loading` is taken with **the daemon held**: the rig sends `SIGSTOP` to the
  daemon's pid for the press and the capture, and `SIGCONT`s it in a `finally`. The
  state exists only while the request is in flight, and this daemon answers in tens
  of milliseconds, so a capture taken after the press photographs the control back at
  rest. Held, the control's own label at capture time is
  `Loading speech. Press again to cancel.` — the busy state the reader sees while
  they wait.
- `-after-press` waits for the toast to **arrive** (`firstToast` polls the app's own
  sonner DOM) and then 500 ms past its entrance, so the card is not photographed
  mid-slide. That is what the row frames do, and the card is in them.
- The toolbar press's sentence is **not** in the `open` frame, and the `bound` one
  catches its card mid-entrance; both are stated in the frame table above, and the
  sentence the run read is quoted there rather than claimed of the image.
- The toolbar press waits for the row's toast to clear **and** for
  `DEFAULT_ERROR_COOLDOWN` to expire first: `toast-manager.ts` drops an identical
  message inside those 5 s, and this arm's two presses produce the same sentence, so
  without that gap the toolbar's own notice is never shown.

## What the daemon saw, per arm

Daemon: the installed generation **`lop` v0.66.0** (`4f097fb9`, the daemon half of
this work, live at capture time). The rig carries a **placeholder** `RADIENT_API_KEY`,
so nothing synthesises — every press stops at the credential step, which is exactly
what makes the *routing* visible in the access log.

| arm | surface | the app's request | status | the toast the reader saw |
| --- | --- | --- | --- | --- |
| pre-fix (round 1, base) | answer row | `POST /v1/agents/8756ab151f78/speech` (the **pane's session id**) | 404 | "This conversation's agent is no longer available." |
| **bound** — `aida` → `agent_id 1d9c4467-…` | answer row | `POST /v1/agents/1d9c4467-ac0f-45d9-b529-4a54628ea342/speech` | 401 | "Your Radient sign-in has stopped working. Sign in again in Settings." |
| **bound** | selection toolbar | the same request | 401 | the same sentence |
| **open** — no binding | answer row | `POST /v1/tools/speech` | 401 | the same sentence |
| **open** | selection toolbar | the same request | 401 | the same sentence |
| **disabled** — no speech credential | answer row | *(no request: the control is disabled)* | — | — |

The 401 is the daemon's credential step, and the point of each row is what it proves:
the bound press **resolved the agent** (the registry id is the one the daemon
publishes beside the binding's name), and the agent-less press was **accepted by the
route** — it reached the credential step rather than being refused on schema.
A name or a session id answers 404 with the designed sentence instead (row 1), which
is the defect this branch removes.

**The skew window is closed.** On `lop` 0.65.1 the agent-less route answered `422`,
which is what the earlier rounds recorded; on v0.66.0 it answers `401` — the daemon
half (`local-operator` #1922, `4f097fb9`) is installed, so the fallback path this
branch routes to now works where the reader's own credential allows it.

**What is not photographed, and why:** the **playing** state (the control's `Stop`
form) needs a synthesis that actually succeeds, and that needs a working Radient key
— the rig's is a placeholder, and the repo's rules forbid spending the operator's. No
key was spent. The disabled and loading states beside it are real.

**The flip the design round asked about (D2), stated correctly:** the enabled
presentation delta between base and this head is reachable only where a surface is
given a `conversationId` and **no** `agentId`. `chat-content.tsx:908` is
`const conversationId = agentId;`, so the pane identity reaches both props and they
cannot diverge on the chat surfaces; the diverging site is `message-paper.tsx:109`.
The frames here are the canonical transcript, so the *presentation* is photographed
through the disabled arm (same control, same `--lo-ink-disabled` role) and the gate
itself is pinned by a mounted component test (disabled with no scope, enabled with
one; mutation-verified).

**Recorded so a later pass does not "fix" them:** the row spaces its pair `gap-1` and
the selection strip `gap-0.5` (28 px controls in a 32 px strip vs a 28 px action row)
— deliberate, and each is right for its own density (design round 1, D5).

`2048x1520` pixels at a `1024x760` viewport, `devicePixelRatio` 2 — the app
photographing itself, via `webContents.capturePage()`, in a window that is never
shown and never focused.
