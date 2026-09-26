# Conversation start: the press, the flip, the failure, the return

Two halves, one rig. `after/` is this branch (`feat/conversation-start`) at its
current head, folded onto `origin/main` = `eddfae750b` (#537, #540, #541, #542)
and re-shot AFTER the round-1 remediation; `before/` is unmodified `origin/main`
at that same `eddfae750b`, in its own detached worktree, with an identical build
configuration. Same tap, same backend, same message, same window (1380x900,
plus the 800x600 floor run): the difference between the halves is the change.

**THE RUNTIME, and why this set exists twice over the same code path.** The
first cut was shot against a throwaway daemon that did not advertise
`session_draft_warm`, which is how the press-row loss on a warm runtime went
unseen (UX round 1's U1, QA's Q-1). This set is shot against the installed
runtime as it now ships - `lop --version` `0.63.3`, whose `/v1/capabilities`
answer carries `"session_draft_warm": 1` - so the press frame is taken on the
same code path a user's daemon runs, mint and all. The round-1 frames were
replaced in place; the readings below are this set's.

Every frame is `…/<state>/localOperatorDark.webp`, a lossless conversion of the
PNG the app photographed of itself (`webContents.capturePage()`), at the
original device pixels - 2760x1800 for the 1380x900 window, 1600x1144 for the
800x600 floor run (the CSS viewport the runs report is 1380x872 / 800x572; the
run logs carry it). The set is declared supplementary in
`docs/evidence/manifest.json`, which is why no story sweep owns it: the driver
produced it, and the logs beside the frames are the readings the claims are read
from.

## Which frame is which claim

| Frame | What it shows | The claim it is evidence for |
| --- | --- | --- |
| `after/press/` | The press frame: the row is on the conversation, the composer is empty, the working line reads `starting the session 1s`, the band has no greeting, the header reads "New chat · Starting the session", and the sidebar lists the chat as `Draft: Summarise yesterday's QA run.` | T1/J1/J5 + D3: the message is a store-level fact from the press, before `sessions/create` answers, and the chat keeps a sidebar presence through the hop. |
| `after/flip/` + `after/flip-plus-1s/` | The same row, same id, same place; the line reads `waiting for the agent 2s` (no restart: the press's clock was already at 2s). | T2/J1/J2/J5: one row, no position jump, one clock across the identity flip. |
| `after/failure/` (+ `failure-before-retry/`) | A message the owner refused AFTER the paint: its row carries `Couldn't confirm your message was sent. Sending it again is safe.` with `Send again` · `Edit`; the composer is empty and no alert is up. The `failure-before-retry` frame is the run's retry arm, shipped because the run took that path - the failure frame above is the retry's. | T4/J4: one failure, one sentence, one home. |
| `after/reload/` | `Page.reload` after the failure and its resolution: the row is back with `Not delivered` · `Send again` · `Edit`, and **no wait line** - the settled claim is not "still going out". | T6 + D1/D2: a painted-but-failed (or resolved-undelivered) row survives a reload, and one message cannot be both `Not delivered` and waited on. |
| `after/dead-create/`, `after/dead-create-reload/` | The tap KILLED the create's socket inside the press window (`POST /__tap/kill-creates`): the row keeps its place and the failure's statement (`Couldn't reach Local Operator. Your message may not have been sent.` with both controls), the composer stays empty, and the sidebar still lists the chat; the reload brings the row back. | U2: a create that dies in the hop leaves the message with a row, a statement and a sidebar presence - not only a reload. |
| `after/away-press/`, `after/away/`, `after/return/` | A second message pressed with its POST held by the tap for 60 s; the run elsewhere; the return with the in-flight row and `waiting for the agent 13s`. A toast ("The unread mark was not cleared...") is up in the away/return frames - see "What these frames do not prove". | T5: away/back keeps the row and the true elapsed. |
| `before/press/` | The pre-change press: `rows 0`, the composer holding the text (`"Summarise yesterday's QA run."`), no wait line. | The state this change removes. |
| `before/flip/` | The row appears only with the create's answer, at `rowTops [678]` (packed over the composer), clock `0s`. | The pre-change flip: bottom-packed and a restarted clock. |
| `before/failure/`, `before/reload/` | The same failure moment and the same reload: the payload is back in the composer (`"A refusal the owner raises after the paint."`) and, at the failure, the composer's own alert (`Couldn't confirm … Retry Clear`) is up beside the row's controls; the reload keeps the text in the box. | The two-homes contradiction the boundary rule removes, and #495's keep-it-in-the-composer behaviour for the post-paint arm. |
| `before/dead-create/`, `before/dead-create-reload/` | The same killed create on the pre-change tree: `rows 0`, the composer still holding the text, no controls; the reload finds nothing to put back (`back: false`). | What U2 looked like before: no row, no statement, no recovery but re-pressing. |
| `before/return/` | The return on the pre-change tree: the composer accumulates BOTH texts; no wait line. | The accumulate-on-return behaviour this change removes. |
| `after/first-send-empty|sent|settled/` (and the `first-send-floor-*` trio at 800x600) | The short conversation after a real first send. | The layout half (S1): the row sits just under the top inset, not over the composer; the composer's box is identical before and after the send. The before half's two anchor assertions fail BY DESIGN (the row is bottom-packed there). |

## The readings (J1-J6), from the logs beside the frames

- **J1 one row.** After: `press` ids `["2498bfbc-3ea2-40ef-8549-4e41a715f2b8"]`
  (1 row, on the draft pane's own identity, on a warm runtime); `flip`'s ids are
  that same id once, the owner's answer's row beside it. Before: the press has
  `rows 0` and the composer holds the text - the row did not exist yet.
- **J2 no position jump.** The row's top is **132** in both `after/press` and
  `after/flip` (`rowTops [132]` in both notes), a 0 px delta against the scene's
  1 px tolerance. Before: the press has no row; the flip's is at 678.
- **J3 no scroll jump.** `scrollTop 0`, `overflow 0` at press and flip, in both
  halves - the scroller never moves.
- **J4 no contradictory claims.** After: at the press and again at the failure,
  `composer ""` and `alert ""` (the failure's sentence and its two controls are
  on the row); at the reload the only message's statement is `Not delivered` and
  the wait line is `null` (D1). Before: the same moment reads the payload back in
  the composer with `Couldn't confirm your message was sent. Sending it again is
  safe.RetryClear` as the composer's alert.
- **J5 one continuous clock.** After: `starting the session 2s` (press) →
  `waiting for the agent 2s` (flip) → `waiting for the agent 13s` (return, read
  off the away message's own press). Before: the flip's line reads `waiting for
  the agent 0s` - the clock starts at the flip - and the return carries no line
  at all.
- **J6 one payload.** The tap's wire (`wire.log`) shows exactly ONE
  `POST …/messages` per press, each answered exactly once - the failure's 503
  `runtime_unreachable`, the away press's 60000 ms hold and the dead create's
  socket kill are the tap's own substitutions, and each row carries the request
  id the attempt used. `POST /v1/desktop/sessions` is NOT a per-press count: the
  pane's own mint-adjacent creates ride it too, and the same shape appears in the
  before half's wire.

## What produced these frames

**Instrument: `scripts/renderer-driver.mjs`, the repository's own renderer
driver** - the built app, launched headless by its own Electron, photographed
with `webContents.capturePage()`. `--scene conversation-start` (press/flip/
failure/reload/away/return in one run), `--scene conversation-start-create-failure`
(the killed create, U2) and `--scene first-send` (the layout half, extended with
the anchor reading). No `capture-evidence`, no `screencapture`, nothing that
takes the operator's focus.

**The backend** is the installed `local-operator` runtime (`0.63.3`, advertising
`session_draft_warm`) run as a throwaway `lop serve` (`hosting: test`,
`model_name: mock`) in its own `LOCAL_OPERATOR_CONFIG_DIR`, its bearer generated
inside this rig, every inherited `CMUX_*`/`LOP_*` variable stripped. The renderer
is built against `http://127.0.0.1:7391`.

**The tap: `harness/create-tap.mjs`.** One hop in front of that backend that can
(a) hold `POST /v1/desktop/sessions` for 2500 ms, so the press frame is taken
while the create is genuinely in flight; (b) answer the next message POST with
the owner's captured `runtime_unreachable` body, which is how the post-paint
failure is real; (c) hold message POSTs (60 s for the away trip - long enough to
outlive the scene's own frame captures, whose toast clearance the driver bounds
per capture); (d) KILL the next create's socket, which is how U2's dead create is
reproduced; and it connects to the backend only when it forwards, so a held
request cannot idle-die upstream. Every request it forwarded is in `wire.log`.

**The two halves, one scene.** `--expect before` runs the same steps against the
pre-change tree and RECORDS the same moments; the after-only claims are notes
there. The before tree carried only the driver and the tap, built against the
same tap and the same warm daemon.

## Reproducing

```sh
# 1. a throwaway daemon of the INSTALLED runtime (warm-capable), on a port of your own
LOCAL_OPERATOR_CONFIG_DIR=<scratch>/root LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  lop serve --host 127.0.0.1 --port 7392 --hosting test --model mock &
# with <scratch>/root/config.yml carrying `values: {hosting: test, model_name: mock}`
# 2. the tap in front of it, WITH TAP_LOG so the wire is recorded
TAP_PORT=7391 TAP_TARGET=http://127.0.0.1:7392 CREATE_DELAY_MS=2500 TAP_LOG=<scratch>/wire.log \
  node docs/evidence/conversation-start/harness/create-tap.mjs &
# 3. the renderer built against the tap's port
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:7391 … pnpm build
# 4. the scenes (after; the before half runs the same commands in its own tree
#    with --expect before)
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene conversation-start --backend http://127.0.0.1:7391 \
  --tap-control http://127.0.0.1:7391 --out <frames> --clean --seed-onboarding-complete
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene conversation-start-create-failure --backend http://127.0.0.1:7391 \
  --tap-control http://127.0.0.1:7391 --out <frames> --clean --seed-onboarding-complete
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene first-send --backend http://127.0.0.1:7391 --out <frames> --clean --seed-onboarding-complete
# and once more at the floor: --window-size 800x600
```

The app boot needs `VITE_GOOGLE_CLIENT_ID`/`VITE_GOOGLE_CLIENT_SECRET`/
`VITE_MICROSOFT_CLIENT_ID`/`VITE_MICROSOFT_TENANT_ID` set to any non-empty
placeholder for `pnpm build` (`scripts/vite-plugins/replace-backend-config.ts`),
and the checkout's `.env` must give `VITE_PUBLIC_POSTHOG_HOST` a URL (the
template ships it EMPTY and `src/main/backend/config.ts` refuses `""` as a URL).

## What these frames do not prove

- **Not an overflowing conversation.** The "nothing else moved" control for the
  overflow path is the paging suites (`transcript-paging*`, run unchanged and
  green) and `docs/evidence/chat-scrolling/`'s own set; no overflowing frame is
  photographed here, and `mb-auto`'s zero-free-space case is argued from the
  mechanism (a column that overflows has no positive free space for the margin
  to absorb) plus the measured 16 px gap under the slot in BOTH halves - not from
  a photograph.
- **Not the real owner.** The failure's body is the captured
  `runtime_unreachable` response, and the mock provider's answers are not turns
  an agent ran.
- **A toast is up in `after/away/` and `after/return/`** ("The unread mark was
  not cleared. Click the chat to try again."). It is the fold's own unread-mark
  surface reacting to the rig's sidebar clicks, and it is left in rather than
  waited out: the driver's per-capture toast clearance is bounded to 500 ms for
  these three frames because the default would sit out the toast's lifetime and
  push the run past the app's own 25 s send deadline, which is exactly what the
  first re-shoot did (the T5 pair went red on a FINISHED send). No claim above is
  read from the toast's area.
- **Not the model gate.** A press that beats the model's resolution can still
  clear the box with the composer's own refusal (QA round 1's note, reproducible
  on the base tree): the scene presses after the pane's own target chips settle,
  and no frame here stages that race.
