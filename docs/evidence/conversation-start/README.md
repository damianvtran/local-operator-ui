# Conversation start: the press, the flip, the failure, the return

Two halves, one rig. `after/` is this branch (`feat/conversation-start`, folded
onto `origin/main` = `9d3e68ddf6`); `before/` is unmodified `origin/main` at that
same `9d3e68ddf6`, in its own worktree, with an identical build configuration.
Same tap, same backend, same message, same window (1380x900): the difference
between the frames is the change.

Every frame is `…/<state>/localOperatorDark.webp`, a lossless conversion of the
PNG the app photographed of itself (`webContents.capturePage()`), at the
original device pixels - 2760x1800 for the 1380x900 window, 1600x1144 for the
`800x600` floor run (the CSS viewport the runs report is 1380x872 / 800x572; the
run logs carry it). The set is declared supplementary in
`docs/evidence/manifest.json`, which is why no story sweep owns it: the driver
produced it, and the logs beside the frames are the readings the claims are read
from.

## Which frame is which claim

| Frame | What it shows | The claim it is evidence for |
| --- | --- | --- |
| `after/press/` | The press frame: the row is on the conversation, the composer is empty, the working line reads `starting the session 2s`, the band has no greeting, the header reads "Starting the session". | T1/J1/J5: the message is a store-level fact from the press, before `sessions/create` answers. |
| `after/flip/` + `after/flip-plus-1s/` | The same row, same id, same place; the line reads `waiting for the agent 2s` (no restart: the press's clock was already at 2s). | T2/J1/J2/J5: one row, no position jump, one clock across the identity flip. |
| `after/failure/` | A message the owner refused AFTER the paint: its row carries `Couldn't confirm your message was sent. Sending it again is safe.` with `Send again` · `Edit`; the composer is empty and no alert is up. | T4/J4: one failure, one sentence, one home. |
| `after/failure-before-retry/` | The same run's retry arm: this run's first refusal press had not painted within 8s, so the scene kept this frame, cleared the box and pressed once more. It is shipped because the run took that path - the failure frame above is the retry's. | The scene's honesty about its own run, not a product claim. |
| `after/reload/` | `Page.reload` after the failure: the failed row is back, controls and all. | T6: a painted-but-failed row survives a reload (the payload does not come home, so the row must). |
| `after/away-press/`, `after/away/`, `after/return/` | A second message pressed with its POST held by the tap; the run elsewhere; the return with the in-flight row and `waiting for the agent 27s`. | T5: away/back keeps the row and the true elapsed. |
| `before/press/` | The pre-change press: `rows 0`, the composer holding the text (`"Summarise yesterday's QA run."`), no wait line. | The state this change removes. |
| `before/flip/` | The row appears only with the create's answer, at `rowTops [678]` (packed over the composer), clock `0s`. | The pre-change flip: bottom-packed and a restarted clock. |
| `before/failure/` | The same failure moment: the payload is back in the composer AND the composer's own alert (`Couldn't confirm … Retry Clear`) is up beside the row's controls. | The two-homes contradiction the boundary rule removes. |
| `before/return/` | The return on the pre-change tree: the composer accumulates BOTH texts; no wait line. | The accumulate-on-return behaviour this change removes. |
| `after/first-send-empty|sent|settled/` (and the `first-send-floor-*` trio at 800x600) | The short conversation after a real first send. | The layout half (S1): the row sits just under the top inset, not over the composer; the composer's box is identical before and after the send. |

## The readings (J1-J6), from the logs beside the frames

- **J1 one row.** After: `press` ids `["301544bc-…"]` (1 row); `flip` ids contain
  that id once, with the owner's answer's row beside it. Before: the press has
  `rows 0` and the composer holds the text - the row did not exist yet.
- **J2 no position jump.** The row's top is **132** in both `after/press` and
  `after/flip` (`rowTops [132]` in both notes), a 0 px delta against the scene's
  1 px tolerance. Before: the press has no row; the flip's is at 678.
- **J3 no scroll jump.** `scrollTop 0`, `overflow 0` at press and flip, in both
  halves - the scroller never moves.
- **J4 no contradictory claims.** After: at the press and again at the failure,
  `composer ""` and `alert ""` (the failure's sentence and its two controls are
  on the row). Before: the same moment reads the payload back in the composer
  (`"A refusal the owner raises after the paint."`) with
  `Couldn't confirm your message was sent. Sending it again is safe.RetryClear`
  as the composer's alert.
- **J5 one continuous clock.** After: `starting the session 2s` (press) →
  `waiting for the agent 2s` (flip) → `waiting for the agent 27s` (return).
  Before: the flip's line reads `waiting for the agent 0s` - the clock starts at
  the flip - and the return has no line at all.
- **J6 one payload.** The tap's wire (`wire.log`, 396 lines across both halves'
  runs) shows exactly ONE `POST …/messages` per press; the failure's
  `503 runtime_unreachable` and the away press's 12000 ms hold are the tap's own
  substitutions, and the row carries the request id the attempt used. `POST
  /v1/desktop/sessions` is NOT per-press: it also carries the pane's own warm,
  so its line count is not a payload count - the same doubling appears in the
  before half's wire.

## What produced these frames

**Instrument: `scripts/renderer-driver.mjs`, the repository's own renderer
driver** - the built app, launched headless by its own Electron, photographed
with `webContents.capturePage()`. `--scene conversation-start` is new with this
change (press/flip/failure/reload/away/return in one run); `--scene first-send`
is extended with the anchor reading. No `capture-evidence`, no `screencapture`,
nothing that takes the operator's focus.

**The backend** is a throwaway `local-operator serve` (`hosting: test`,
`model_name: mock`) in its own `LOCAL_OPERATOR_CONFIG_DIR`, its bearer generated
inside this rig, every inherited `CMUX_*`/`LOP_*` variable stripped. The renderer
is built against `http://127.0.0.1:7391`.

**The tap: `harness/create-tap.mjs`.** One hop in front of that backend that (a)
holds `POST /v1/desktop/sessions` for 2500 ms, so the press frame is taken while
the create is genuinely in flight and the flip is the same press's later moment -
not two staged stills; (b) can answer the next message POST with the owner's
captured `runtime_unreachable` body, which is how the post-paint failure is real;
(c) can hold message POSTs, which is how the away/return trip has something in
flight to see. Every request it forwarded is in `wire.log`.

**The two halves, one scene.** `--expect before` runs the same steps against the
pre-change tree and RECORDS the same moments; the after-only claims are notes
there. The before tree carried only the driver and the tap, built against the
same tap.

## Reproducing

```sh
# 1. a throwaway backend, on a port of your own
LOCAL_OPERATOR_CONFIG_DIR=<scratch>/root LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  lop serve --host 127.0.0.1 --port 7392 --hosting test --model mock &
# with <scratch>/root/config.yml carrying `values: {hosting: test, model_name: mock}`
# (a fresh config is migrated to that shape; a flat file written before the first
# boot is consumed and replaced with defaults)
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
  --scene first-send --backend http://127.0.0.1:7391 --out <frames> --clean --seed-onboarding-complete
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
  re-photographed here, and `mb-auto`'s zero-free-space case is argued from the
  mechanism (a column that overflows has no positive free space for the margin
  to absorb) plus the measured 16 px gap under the slot in BOTH halves - not
  from a photograph.
- **Not the real owner.** The failure's body is the captured
  `runtime_unreachable` shape, substituted at the HTTP boundary; the real
  daemon's own ladder and timings are not in these frames.
- **Not the packaged app or another theme.** Every frame is the built renderer
  under `localOperatorDark`, driven headless; the packaged bundle, another
  palette, and read receipts/leases are outside what this instrument can see.
- **Not the credential seam's substitution timing.** R4's splice is pinned by
  `scripts/canonical-chat.test.mjs`; no masked capture is in these frames.
