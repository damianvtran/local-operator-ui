# Conversation start — the frames and the readings

The evidence for the change that moves a New chat's first message out of the
composer and onto the conversation **at the press**, before `sessions/create`
answers: the row is painted on the draft pane's own identity, the identity is
re-keyed to the session the create makes in the same synchronous block, the
failure stays where the row is, and a switch away and back changes none of it.
Every claim below is read from the logs this directory ships - the driver's own
notes beside each frame - and each frame is quoted by the number it carries,
because a caption may only say what the pixels say.

The design document this implements is the `conversation-start` design (T1-T6,
J1-J6 as the observable states); §5's preserved contracts are exercised by the
suites named there, unchanged.

## Which frame is which claim

| Frame | What it shows | The claim it is evidence for |
| --- | --- | --- |
| `after/press/` | The press frame: the row is on the conversation (same id as the flip's), the composer is empty, the working line reads `starting the session 0s` (the reads taken on both sides of the capture agree on 0s), the band has no greeting, and the sidebar lists the chat as `Draft: Summarise yesterday's QA run.` | T1/J1/J5 + D3/U6: the message is a store-level fact from the press, before `sessions/create` answers, and the chat keeps a sidebar presence through the hop - by name, while the session's own row is not painted yet. |
| `after/flip/` | The same row, same id, same top (`rowTops [132]` at both reads); the line reads `waiting for the agent 3s` at the flip (the frame's own reads: 3s/3s). The +1s companion is NOT shipped: in both re-takes the owner's answer landed inside its one-second window, so its note carries no line (`lineBefore`/`lineAfter` null) and it cannot be captioned for a number it does not carry - the flip instant's own frame is the evidence that holds. | T2/J1/J2/J5: one row, no position jump, one clock across the identity flip - 0s → 3s, never restarted. |
| `after/failure/` | A message the owner refused AFTER the paint: its row carries `Couldn't confirm your message was sent. Sending it again is safe.` with `Send again` · `Edit`; the composer is empty (`composer ""`) and **no alert is up** (`alert ""`) - the sentence exists once, on the row. | T4/J4: one failure, one sentence, one home. |
| `after/reload/` | `Page.reload` after the failure and its resolution: the row is back with `Not delivered` · `Send again` · `Edit`, and **no wait line** (`line: null`) - the settled claim is not "still going out". | T6 + D1/D2: a painted-but-failed (or resolved-undelivered) row survives a reload, and one message cannot be both `Not delivered` and waited on. |
| `after/dead-create/`, `after/dead-create-reload/` | The tap KILLED the create's socket inside the press window (`POST /__tap/kill-creates`): the row keeps its place and the failure's statement (`Couldn't reach Local Operator. Your message may not have been sent.` with both controls), the composer stays empty, and the sidebar still lists the chat; the reload brings the row back. | U2: a create that dies in the hop leaves the message with a row, a statement and a sidebar presence - not only a reload. |
| `after/away-press/`, `after/away/`, `after/return/` | A second message pressed with its POST held by the tap for 60 s; the run elsewhere; the return with the in-flight row and `waiting for the agent 5s` (reads at the return's capture: 5s/5s - the number counts from the away press's 0s, across the trip). The unread-mark toast ("The unread mark was not cleared. Click the chat to try again.") is up in `away/` (and in the neighbouring `away-mid-failure/`) - see "What these frames do not prove". | T5: away/back keeps the row and the true elapsed. |
| `after/away-mid-failure/` | A refusal raised on a LIVE-SESSION send (not a New chat), then a switch-away and back: the row keeps `Not delivered` · `Send again` · `Edit`, the wait line stays absent (`line: null`). | T5 for the general boundary rule: a post-paint failure is the row's wherever it was raised, and leaving the pane does not re-state it as in flight. |
| `after/away-failure-refusal/`, `after/away-failure-return/` | UX round 2's U5, staged end to end (`--scene conversation-start-away-failure`): a first send refused after the paint, the reader leaves to another chat, and comes back to the chat. THIS run's return took the session's own route, because the sidebar had not painted the chat's row inside the driver's wait (the catalogue lag) - the `return via` note names the path each run took, and the earlier take's sidebar-row walk is the same pane resolution; no frame is captioned as a walk it did not make. Before the fix this return read `waiting for the agent 14s` with `controls: []` and `undelivered: null`; the shipped frames read `Not delivered` · `Send again` · `Edit` and `line: null` at both moments (`controls: ["Send again","Edit"]`, `undelivered: "Not deliveredSend againEdit"` at both the refusal and the return, same row id), and the refusal's own glance shows no duplicated `Draft:` row for the chat (`draftRows: []`; U6's fix - the chat's session row itself had not been painted at that glance either, which is the lag the fallback note records). | U5 + U6: the return is not a state falsehood, and the just-refused chat stays reachable from the list. |
| `before/press/` | The pre-change press: `rows 0`, the composer holding the text (`"Summarise yesterday's QA run."`), no wait line. | The state this change removes. |
| `before/flip/` | The row appears only with the create's answer, at `rowTops [678]` (packed over the composer), and the clock **starts** there: `waiting for the agent 0s`. | The pre-change flip: bottom-packed and a restarted clock. |
| `before/failure/`, `before/reload/` | The same failure moment and the same reload: the payload returns to the composer (`"A refusal the owner raises after the paint."`) and, at the failure, the composer's own alert (`Couldn't confirm … Retry Clear`) stands beside the row's `Not delivered · Send again · Edit`; the reload finds no row at all (`controls: []`, `undelivered: null`) and keeps the text in the box. | The two-homes contradiction the boundary rule removes, and #495's keep-it-in-the-composer behaviour for the post-paint arm. |
| `before/dead-create/`, `before/dead-create-reload/` | The same killed create on the pre-change tree: `rows 0`, the composer still holding the text, no controls; the reload finds nothing to put back (`back: false`). | What U2 looked like before: no row, no statement, no recovery but re-pressing. |
| `before/return/` | The return on the pre-change tree: the wait line **restarts** (`waiting for the agent 0s`) rather than continuing across the trip. | The restarted clock the continuous-anchor work removes. |
| `before/away-failure-refusal/`, `before/away-failure-return/` | The same U5 walk on the pre-change tree: the return read is `controls: []`, `undelivered: null` - the refusal's row, sentence and controls are gone, and the composer is empty. | U5's defect, as measured before the fix. |
| `after/first-send-empty|sent|settled/` (and the `first-send-floor-*` trio at 800x600) | The short conversation after a real first send. | The layout half (S1): the row sits just under the top inset, not over the composer; the composer's box is identical before and after the send. The before half's two anchor assertions fail BY DESIGN (the row is bottom-packed there). |

## The readings (J1-J6), from the logs beside the frames

- **J1 one row.** After: `press` and `flip` carry the SAME id, once each
  (`rows 1` at both reads), read on the draft pane's identity and then on the
  session's, on a warm runtime; the flip's raw capture is taken before the
  owner's answer lands, so the line is in frame and no answer row is beside it.
  Before: the press has `rows 0` and the composer holds the text - the row did
  not exist yet.
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
- **J5 one continuous clock.** After: `starting the session 0s` (press) →
  `waiting for the agent 3s` (flip) → `waiting for the agent 4s` (+1s), each
  frame's number read on both sides of its capture; the away trip reads 0s (the
  press) → 5s (the return), one number carried across the leave and back.
  Before: the flip's line starts at `waiting for the agent 0s` and the return
  restarts it - two clocks, not one.
- **J6 one payload.** The tap's wire (`wire.log`) shows exactly ONE
  `POST …/messages` per press, each answered exactly once - the failure's 503
  `runtime_unreachable`, the away press's 60000 ms hold and the dead create's
  socket kill are the tap's own substitutions, and each row carries the request
  id the attempt used. `POST /v1/desktop/sessions` is NOT a per-press count: the
  pane's own mint-adjacent creates ride it too, and the same shape appears in the
  before half's run.

## What produced these frames

**Instrument: `scripts/renderer-driver.mjs`, the repository's own renderer
driver** - the built app, launched headless by its own Electron, photographed
with `webContents.capturePage()` - plus the change's own scenes:
`--scene conversation-start` (press/flip/failure/reload/away/return in one run),
`--scene conversation-start-create-failure` (the killed create, U2),
The U5 walk presses the sidebar's own session row for the return; the driver falls back to the
session's route when the sidebar has not painted that row within its wait (the catalogue's own
lag), and records which path the run took in a `return via` note - this set's run took the
session's own route and says so, so no frame is captioned as a walk it did not make.

`--scene conversation-start-away-failure` (U5's walk) and `--scene first-send`
(the layout half, at 1380x900 and 800x600). No `capture-evidence`, no
`screencapture`, nothing that takes the operator's focus; the window node
asserts `visible=false focused=false` in every run.

**The backend** is the installed `local-operator` runtime as it ships that day -
`lop` v0.63.7, advertising `session_draft_warm: 1` - run as a throwaway
`lop serve --hosting test --model mock` in its own `LOCAL_OPERATOR_CONFIG_DIR`,
its bearer generated inside this rig, every inherited `CMUX_*`/`LOP_*` variable
stripped. Each run's log names the version and the capability on its first two
lines. The renderer is built against `http://127.0.0.1:7394` (the tap).

**The tap: `harness/create-tap.mjs`.** One hop in front of that backend that can
(a) hold `POST /v1/desktop/sessions` for 3000 ms, so the press frame is taken
while the create is genuinely in flight; (b) answer the next message POST with
the owner's captured `runtime_unreachable` body, which is how the post-paint
failure is real; (c) hold message POSTs (60 s for the away trip - long enough to
outlive the scene's own frame captures, whose toast clearance the driver bounds
per capture); (d) KILL the next create's socket, which is how U2's dead create is
reproduced; and it connects to the backend only when it forwards, so a held
request cannot idle-die upstream. Every request it forwarded is in `wire.log`.

**The two halves, one instrument.** The before half is a detached worktree at
unmodified `5869a0670e` (the ninth fold's base, and this branch's fourth fold round), built
against the same tap and the same warm daemon, and it carries only the driver
and the tap from this branch - never the app change. The after-only claims are
notes there, and its checks that fail are the ones the change exists to turn
green (`run.log`: 18 pass / 11 fail on the before half against 29 pass / 0 fail
after; `away-failure.log` carries U5's red on that half).

**Raw where a clock is in frame.** The press, the flip pair and the away trip
capture RAW - one shot, the clock read immediately before and after it - because
`captureSettled`'s stability wait let the owner's answer land inside the window
(the round-1 re-shoot's flip frames showed the post-answer moment) and, on the
away trip, outlasted the app's own 25 s send deadline. Each frame's caption
quotes the number its own reads agree on.

## Reproducing

```sh
# 1. a throwaway daemon of the INSTALLED runtime (warm-capable), on a port of your own
LOCAL_OPERATOR_CONFIG_DIR=<scratch>/root LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  lop serve --host 127.0.0.1 --port 7493 --hosting test --model mock

# 2. the tap: create gets held 3 s, the next message POST is refused with the
#    captured body, message POSTs can be held, and the next create's socket can
#    be killed; TAP_LOG keeps the wire the J6 reading is read from
TAP_PORT=7394 TAP_TARGET=http://127.0.0.1:7493 CREATE_DELAY_MS=3000 \
  TAP_LOG=<scratch>/wire.log node docs/evidence/conversation-start/harness/create-tap.mjs

# 3. the scenes (the app's build must be current: the driver refuses a stale one)
node scripts/renderer-driver.mjs --scene conversation-start \
  --backend http://127.0.0.1:7394 --tap-control http://127.0.0.1:7394 \
  --out <scratch>/frames --clean --seed-onboarding-complete
node scripts/renderer-driver.mjs --scene conversation-start-create-failure … # same flags
node scripts/renderer-driver.mjs --scene conversation-start-away-failure …  # same flags
node scripts/renderer-driver.mjs --scene first-send --backend … --out <scratch>/frames
node scripts/renderer-driver.mjs --scene first-send --window-size 800x600 …
```

The frames committed here are the PNGs those runs wrote, converted per label to
`<label>/localOperatorDark.webp` (`cwebp -q 93`), with the per-label directory
named after the frame's own label (the first-send sizes map to
`first-send-*`/`first-send-floor-*`).

## What these frames do not prove

- **Not the standing surfaces.** This set is `supplementary` in
  `docs/evidence/manifest.json`: it shows the change's own states, not the swept
  Storybook/geometry sets other passes own.
- **Not the whole layout contract.** The empty-state centring (S1) is a
  class on the content column plus the geometry read (`overflow 0`, the row's
  top at 132), not a photograph; the frames show the top-anchored result on a
  short transcript and the floor size shows the docked composer.
- **Not the real owner.** The failure's body is the captured
  `runtime_unreachable` response, and the mock provider's answers are not turns
  an agent ran.
- **A toast is up in two frames** (`after/away/`, `after/away-mid-failure/`):
  "The unread mark was not cleared. Click the chat to try again." It is the
  app's own unread-mark surface reacting to the rig's sidebar clicks. Its own
  note is on `away-mid-failure` (`toastFree: false`, `toastWaitMs` 4847 - the
  toast outlived the capture's bounded wait); `away` is a raw capture, which
  carries no toast fields, and the corner crops of `away-press` and `return`
  are empty. It is left in rather than waited out - no claim above is read from
  the toast's area.
- **Not the model gate.** A press that beats the model's resolution can still
  clear the box with the composer's own refusal (QA round 1's note, reproducible
  on the base tree): the scene presses after the pane's own target chips settle,
  and no frame here stages that race.
- **No retry-arm frame.** The failure step retries once when its first press does
  not reach the wire; in both runs the first press landed, so no retry moment
  existed to photograph, and no frame is shipped standing in for one - the
  before half's stale `failure-before-retry` capture was dropped in round 3
  rather than captioned against a log that never read it. The arm is covered
  by `scripts/composer-send-failure.test.mjs`, and the scene records the arm's
  own readings in its log when it does run.
- **The frames are one moment each.** Every row's `line`, `alert` and `controls`
  are read in the same step and printed in the log beside the frame; where a
  number is quoted above it is the one the frame's own before/after reads agree
  on.
