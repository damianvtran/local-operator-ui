# A draft's bridge 404 is not a conversation verdict — and the missing notice's way out carries the box

The operator's report (2026-10-23), two surfaces:

1. A **New chat with a team** landed on *"This conversation is no longer on this
   machine"* and the draft text was stranded. The team's draft row keeps a
   stable key (`draft:team:<name>`) and its `draftRequestId` persists across
   launches; a daemon that restarted (or a draft that expired) answers that
   request's receipt by replaying the id it minted the first time — an id its
   registry no longer serves. The pane streams on `sessionId ?? draft.warmId`,
   so the bridge 404s.
2. On a **genuinely missing conversation**, the notice's *Start a new chat*
   press left the composer's unsent text (and any chip) filed under the dead
   conversation's identity, and left the route naming that conversation — so a
   reload returned to the notice over an empty box.

The frames are the same scene (`--scene team-newchat`, four modes) on the same
isolated daemon shape and the same inert build environment. The draft pair ran on
two source trees, both against the same **unfixed** backend
(`damianvtran/local-operator` `origin/main` @ `6f9efefb2c`): the 404 is the
subject, and a backend that re-mints on a stale receipt would never send one to
the renderer, leaving this PR's client arm unexercised.

## Draft pair — settled frames

| frame | source | reading |
| --- | --- | --- |
| `before.png` | `origin/main` (`39164868fc`) | header *New chat with Minerva Development*; body *This conversation is no longer on this machine.* / *It was deleted, or it belongs to a machine this app is not connected to.*; composer holds `C`, `readOnly: true`; the row still holds the seeded request id; no bubble after Enter (45 s bound) |
| `after-first.png` | `fix/team-newchat-missing` | the FIRST frame after the bridge's answer — same working new chat as the settled one (the pair differs in transient paint only: the focus ring, the send control and the starter-prompt chips' mount transition, plus the caret's phase where it falls in the sampling window — 28,756 px, 0.58% of the frame, no layout change) |
| `after-new-chat.png` | same | no notice; the app's new-chat empty state with `C` in an editable composer, caret at 1; the row's request id re-minted, no `sessionId` |
| `after-send.png` | same | the same send reached the conversation: user bubble *C a regression check*, mock provider's answer, no undelivered line, composer empty |

## The 404 → retire → next-mint window (design round 1 D2 / UX round 1 U1)

The scene installs an in-page probe before the first keystroke: a
`MutationObserver` on the document, an animation-frame sampler, and a wrapper on
`Storage.prototype.setItem` that records the canonical store's own persisted
writes (rig instrumentation in the page session only; no repository code is
patched). It records only changes, and reports the first sample that states each
fact. The 404 itself is not observable in the page — it arrives over IPC from
main — so the clock runs from the keystroke and the first observable consequence
is the store's re-minted request id.

| reading | base tree (`--expect broken`) | this branch (`--expect fresh`) |
| --- | --- | --- |
| the notice in the document, ever | **painted at 66 ms** | **never** (`noticeAt: null`) |
| the composer refused (`readOnly`/`disabled`), ever | **refused at 66 ms** | **never** (`refusedAt: null`) |
| the retire (row's request id changes), first sample | never (the id stays) | 53 ms |
| the pane usable (notice absent, box editable), first sample | 0 ms (before the 404 lands) | 0 ms |
| samples that differed, including mutation-time samples | 3 | 3 |

So on this branch the reader never sees a notice, a banner or a refused box in
the window; the pane that was usable before the 404 is the same pane after it.
`after-first.png` (taken on the first observation of the answer) and
`after-new-chat.png` (settled, 600 ms later) are the same screen with no layout
change: the composer's boundary is the same rect (physical 778,1540-2414,1776,
which is the design review's own measurement) and the typed `C`'s ink is
identical. The bytes differ in transient paint only - the focus ring on that
boundary, the send control's ink, and the starter-prompt chips' mount
transition; a connected-components diff of the pair confines every differing
pixel to those three (28,756 px, 0.58% of the frame) - which is why the
assertion is the state (the header, the notice's absence, the box's value and
editability) and the byte comparison is reported beside it.

### A send raced into that window (`--expect immediate`)

`immediate-after-send.png`. The words and Enter go in without waiting for the
mint or the 404. In this run the typed text landed at 54 ms, the box cleared on
the send at 94 ms, and the retire's write at 99 ms — the send preceded the
retire; the daemon's log shows the dead bridge's `404`, the create's `200`, and
the new conversation's stream `200`. Enter → rendered bubble **17 ms**,
delivered (`[data-undelivered]` absent), notice never painted, box never
refused, conversation `1c75bcdfb71e`. The scene reports the ordering it observed
rather than asserting which side of the race must win.

## The missing notice's way out (`--expect carry`)

A real route to a 12-hex id the daemon does not serve, whose composer row (a
persisted row a user can genuinely hold) has the words `carry-me` and a chip.

| frame | reading |
| --- | --- |
| `carry-notice.png` | the notice painted within one poll (0 ms), detail *It was deleted, or it belongs to a machine this app is not connected to.*, action *Start a new chat*; route `/chat/abcdef123456`; the composer holds `carry-me` and the chip, `readOnly: true`; `activeSessionId` is the missing id |
| `carry-new-chat.png` | the notice's own press, **keyboard-activated** (focus on the button, Space through CDP, activated in 13 ms — no pointer fallback needed): route `/chat`, no notice, `activeDraftKey` a fresh `draft:<uuid>`, `activeSessionId: null`; composer `carry-me`, editable, focused, caret 8; the chip is in the box (1) and in the new row's `attachments`; the dead identity's row is gone |
| `carry-reload.png` | `Page.reload`: route `/chat`, no notice, the same draft key, `carry-me` visible, the chip still there — the Q1 fix. With `onStartNewChat?.()` deleted from the same tree, this frame is the dead address with the notice back and an empty box (the round-2 mutation proof) |
| `carry-sent.png` | continued typing in the carried box (`carry-me and then some`), the chip removed through its own *Remove attachment* control, Enter: the message lands once (one occurrence in the transcript), delivered, composer empty, conversation `e16269a32f27`. The `session mcp unavailable` lines above the bubble are this fixture's copied MCP config, not a finding of this change |

## Measured numbers (final head)

1380x900 at DPR 2, `localOperatorDark`, isolated config/home/token, port 8080
(the only non-operator port the renderer's CSP admits). 404 lines are counted
from each leg's own serve log, one precondition `curl` probe per leg included:

| leg | the id the pane streamed | `GET …/<D>/events` | Enter → bubble |
| --- | --- | --- | --- |
| before (base tree) | `4267814924d9` | 2 lines, both 404 (1 probe + 1 app bridge) | no bubble in 45 s |
| fresh | `cbe90f8d7468` | 2 lines, both 404 (same split) + `200` for the created `9976827edcb3` | **52 ms** |
| immediate | `3f9f5235675e` | 2 lines, both 404 + `200` for `1c75bcdfb71e` | **17 ms** |
| carry | — (no draft receipt; the row's replay `75a72c566f75` is probed and 404s) | `abcdef123456` → 404 once (the genuine missing id, taken as the route) | 1585 ms (carry flow) |

## Frames and provenance

All frames were captured at 1380x900 DPR 2 in `localOperatorDark`, headless, one
isolated daemon per leg, and read back by eye. The pair ran on this head
(`f024b78d50`) and on a control worktree at `origin/main` (`39164868fc`) with
the scene module byte-identical (`cmp` clean); the carry leg took the dead
conversation's own route (`/chat/abcdef123456`) before the press.

sha256 (a settled frame can be byte-identical across runs because the draft's
key and the route are not painted; the state they were captured from is in the
tables above):

| frame | sha256 |
| --- | --- |
| `before.png` | `72b5b0144cae2d46984a60f1438b4666f13467ef914b95b59c375c8618ffabd5` |
| `after-first.png` | `efb3890e7e1d112c21b56d0fb82dde36b91edca390abf82b1012fece9367b9e5` |
| `after-new-chat.png` | `a33c0c9512adc10bd4b3a4b9ec112c17b9ab6320c146c17baac2fa8408b73273` |
| `carry-notice.png` | `3cafa2d37133314ae9221da2658ad100a66ddfaee681f98526e4e5d574df6cba` |
| `carry-new-chat.png` | `a3d49e784268ff60cee1b5ba18b429de45b2c51350ad48b40bf8b64145e3815e` |
| `carry-reload.png` | `8d5317bd95cb5f4485e5738576dab5523fff7ca1ae86c3da25e6542ba08d7873` |
| `carry-sent.png` | `da651a3ef49f4bbf1b16b23937c0bc6e89ef6ef320e3697cbf436317491e3e52` |

`before`, `after-new-chat`, `carry-notice`, `carry-new-chat` and `carry-reload`
are byte-identical to the same frames taken on the previous head
(`039ae756cf`): the commit between them changes the press's route handling and
the adoption order, neither of which the settled carry screen paints.

## Reproducing

The precondition is the operator's persisted state, built from the daemon's own
API and then restarted:

```bash
# isolated root: config/agents + config/teams/<team> copied from the live store
# config.yml values: {hosting: test, model_name: mock-model}
POST /v1/desktop/sessions/draft   {request_id: R, cwd: "~", target: {kind: team, name: minervadev}}  -> D
POST /v1/desktop/sessions         {request_id: <uuid>, cwd: "~", target: …, draft_id: D}            -> session D
rm -rf <config>/sessions/D
# restart the daemon; POST …/draft with R now replays D, and GET …/D/events answers 404
```

Per leg (renderer built against `http://127.0.0.1:8080` with
`VITE_LOCAL_OPERATOR_API_URL`, inert `VITE_GOOGLE_*`/`VITE_MICROSOFT_*` values,
`VITE_DISABLE_BACKEND_MANAGER=true`):

```bash
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene team-newchat --seed-onboarding-complete \
  --backend http://127.0.0.1:8080 --backend-records <config>/run/serve \
  --team minervadev --team-label "Minerva Development" \
  --draft-request-id 3f2f0b4a-8c1e-4d2b-9a77-5e61c0a2b1d4 \
  --expect broken|fresh|immediate|carry --window-size 1380x900 --out <dir>
```

## What these frames may claim

They are the app's own `capturePage` of a hidden (`headless`) window, settled
except where a frame is explicitly the first one after an answer. They show what
this client did with the 404s the daemon actually served and with the notice's
own press; they do not prove the daemon restarted for the operator's own reason,
and they are not a screenshot of the operator's live data — the run is an
isolated profile and an isolated daemon. The send's delivery is the
transcript's own `[data-undelivered]` absence plus the daemon's `200` stream for
the created conversation, not a claim about the model's answer content.
