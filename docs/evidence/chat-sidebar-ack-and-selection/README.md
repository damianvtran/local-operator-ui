# A conversation you are looking at: its completion's receipt, and the sidebar's selection

Two defects were reported together against the chat sidebar. One is fixed here and
reproduces in the committed rig; the other does not reproduce, and this set is the
matrix that says so rather than an assurance.

**1. The receipt.** The report: a session whose conversation is the one open and
being viewed keeps its completion notifications, and they cannot be cleared until
you switch to another view and back. Expected: on window focus/refocus the open
conversation's notifications are acknowledged, and deliveries arriving while it is
the open, focused view do not accumulate.

**2. The selection.** The report: clicking a session's entry selects it correctly,
but clicking another conversation leaves the first entry highlighted. Expected:
mutually exclusive selection.

## What the frames are

Every frame is the **built app in `headless` window mode** (`state: visible=false`,
1380x900), paired to an isolated `local-operator serve` on ports each run checked
nobody else owned, with `HOME`, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR`
and `--user-data-dir` all under this run's scratch root. The frames come from the
app's own dev driver (`window.__loDevDriver.call("capture", …)`), no `screencapture`
and no browser engine. The backend runs the TEST hosting (`hosting: test`,
`model_name: mock`), so the completions in these scenes are REAL turns with no
network and no spend, and the runtime's own notifier suppresses itself for a mock
process. The assistant feature is switched off in the seeded config
(through the assistant feature's own enable key in the seeded `config.yml`) — the
scenes are about plain conversations, and no assistant name belongs in evidence.

`before/` is `origin/main` at **`ff34fb8ecc`** built in its own worktree; `after/` is
this branch's tree. Both are version `0.31.16`, both on the pinned Electron 44.3.0.
Frames are PNG, not WebP, on purpose: `check-evidence.mjs`'s frame walker counts
`.webp` only, so a rig-driven set cannot be mistaken for frames a sweep produced
(the same convention `docs/evidence/read-ack-notice/` states).

| frame | state | what it shows |
| --- | --- | --- |
| `selection-other`, `selection-third`, `selection-viewed-back` | the selection matrix | a row was clicked; exactly one row carries the current ground and `aria-current="page"`, and it is the clicked one |
| `focused-unread` | a delivery while the conversation is the open view | the row's unseen mark (the green completion glyph, `Unseen completion, unread`) |
| `focused-after` | the same scene after the receipt's own budget ran | the mark still standing; on `before/` the app has given up by now (below) |
| `remedy-flyout` | the pointer on the unread row | the row's flyout. Both trees read `Quarterly ledger reconciliation Unseen completion, unread · scroll to the result to mark this chat read` — see "what this rig cannot see" |
| `away-unread`, `away-recheck` | a delivery while the app is not the foreground application, then the window's return | the mark, then the mark after the return |
| `switch-away-unread`, `switch-back` | the operator's own workaround | the mark, then the state after switching to another conversation and back |
| `viewed-row-flyout` | the viewed row's own channels (Q3) | the flyout of the unread row the pane is on, and its `aria-describedby` in the readings |
| `her-badge-clear-refused` | the bulk control on the unread badge | the badge still `1` and the foreground refusal's toast |

`before-readings.json` / `after-readings.json` are the rig's full readings for the
two passes (every timeline sample, every row's `aria-current`, background and
description, the backend's own `attention` state per sample).

## How to reproduce

```
# one pass per tree; ports are per-run, the scratch root is per-run
BACKEND_PORT=14661 CDP_PORT=9531 \
  bash docs/evidence/chat-sidebar-ack-and-selection/harness/run.sh \
  ~/local-operator-ui-worktrees/sidebar-ack-sel-before-0929-4ac1 before
BACKEND_PORT=14663 CDP_PORT=9533 \
  bash docs/evidence/chat-sidebar-ack-and-selection/harness/run.sh \
  ~/local-operator-ui-worktrees/sidebar-ack-sel-0929-4ac1 after
```

`run.sh` refuses a port that is already listening, asserts the app resolved
`headless`, asserts the CDP port belongs to the pid it launched, and reaps the app
and the backend by exact pid on exit (and fails if anything carrying the scratch
path survives). `seed.mjs` writes the backend config and four conversations;
`drive.mjs` is the scene player and the verdict.

## Defect 1: what the rig measured

The scenes send REAL turns (`POST /v1/desktop/sessions/<id>/messages`) into the open
conversation and watch the backend's own `attention` state while the app renders.
Both trees behave identically up to the point of the refusal: the completion arrives,
the backend's record goes `unseen`, the sidebar row draws `Unseen completion, unread`
(`before-readings.json` / `after-readings.json`, `receipt.*.appear`).

**Focus, and which layer gates what.** The renderer gate
(`document.hasFocus()` / `visibilityState`) was driven with CDP
`Emulation.setFocusEmulationEnabled`. In this headless launch the page reports
`hasFocus: true` in every scene *whether or not* emulation is on (the reading is in
every scene's `raw.hasFocus`, and `receipt.*.blur` / `.refocused` record the same
`true`), so what the scenes actually hold is the MISMATCH state: the page believes it
is focused while the window is not visible or focused at the OS level — which is
exactly the state "main" refuses a receipt from. Main's gate
(`BrowserWindow.isVisible() && !isMinimized() && isFocused()`,
`guardForegroundReceipts`) is the layer no agent rig may satisfy: a headless window
can never be visible or focused, and focusing one for real would steal the operator's
focus, which no rig here is allowed to do.

**What differs, and it is the defect's own shape.** On the before tree, the receipt
attempts — which the renderer's gates allow — are refused by main with
`foreground_required`, and the refusal is treated as a FAILURE by the shared ladder.
Two statements follow, and both are machine-read from the pass, not inferred:

- the app's own log, once per budget:
  `[attention] c1c1c1c1c1c1 receipt unresolved after 3 attempts; backing off UserFacingError: View these completions in the foreground before marking them read.`
- the row's description (the channel its `aria-describedby` announces), which now
  says the app has given up: `Not marked read. Click the chat to try again.`

Counted per pass: **before — 1 give-up log line, 1 give-up row clause; after — 0 and
0** (`before-readings.json` / `after-readings.json`, `giveUp`). The refusal itself
still happens on both trees — main refuses every receipt in this rig, which is why
the mark stays unread in both passes (below) — so "no give-up" is not "no refusal":
what the fix removes is the receipt's conclusion that a refusal like this has
exhausted anything, and the after pass keeps probing instead of stopping.

**What this rig cannot see, and where it is covered instead.** The final CLEAR is
not observable here — with main refusing every receipt, the mark can only be cleared
by an answer the rig cannot obtain — so no frame in this set claims a clearing. The
clear under a genuinely foreground window, the deferral split itself, and the
focus/visibility re-arm are covered in-process by this branch's new cases in
`scripts/completion-view-ack.test.mjs`:

- *a foreground refusal defers the receipt instead of spending the ladder* — a
  minute of ticks under `foreground_required`: attempts keep going (≥25, against
  the ladder's ~8), no warning, no give-up clause, the row untouched. On the unfixed
  hook this case fails (warning fired, cadence decayed, the row's clause set).
- *the window coming back releases a deferred attempt, and the arm dies with the
  loop* — `focus` releases the wait immediately and the listener is gone with the
  loop.
- *visibility returning releases it too, and a hidden page releases nothing*.
- *deferrals do not spend the budget a later attempt settles with* — two refusals,
  then a settled answer: the row clears, no warning, no clause, the interval gone.

`scripts/attention-seen.test.mjs` walks the gate's own condition and the refusal's
classification (`isForegroundRequired`), which is the half this hook now consumes
instead of routing into the ladder.

## Defect 2: the matrix, and what it found

**Nothing reproduced.** The matrix, run on the before tree and again after the fix,
each step a pointer press on the row's painted centre with the readings taken 700 ms
later (rows: id, `aria-current`, computed ground, description). Five presses per
pass — a second conversation, a third, the first again, the second again, the first
once more — and after every one:

| step | before | after |
| --- | --- | --- |
| press 1 (second conversation) | current = that row, exactly one | same |
| press 2 (third) | current = that row, exactly one | same |
| press 3 (first again) | current = that row, exactly one | same |
| presses 4-5 (second, then first) | current follows every press | same |

The frames `selection-other` / `selection-third` / `selection-viewed-back` carry the
pixels; `selection.steps` in the readings carries every row's state after every
press. Also probed clean in throwaway passes during this round (their readings are
not committed): the same sequence in `All chats` mode, after entering through the
catalogue route, with presses 60 ms apart, and with a targeted draft staged on an
entity row right before the conversation was clicked.

**Best hypothesis from the code, for whoever chases it next.** Both the sidebar row's
current state and the assistant rail row's are derived from ONE store field
(`activeSessionId`): the sidebar paints `selectedConversation === row.session_id &&
!activeDraftKey`, and the rail row's highlight is `currentView === "chat" &&
activeSessionId === <that session>`. A highlight stuck on one entry therefore has
exactly one shape — `activeSessionId` not moving on the press — and the press path
is one function for every row (`openConversation` → `openSession`, which commits
synchronously). The one press in this app that does NOT take that path is the
assistant rail row's: it resolves an id before opening. Its row could not be
exercised in this rig (the isolated backend the rig stands up does not serve that
feature's document, and, per the report's handling rules, no committed evidence may
name the operator's assistant). That row, and a real second-window or focused-window
state, are the two places left to look; nothing in the sidebar's own predicates can
produce the reported state, which is why this branch changes no selection code.

## Her row: the operator's defect-2 sequence, driven against the assistant's rail row

The operator's exact words for the second defect — "if you click the aida sidebar
it correctly selects the aida session but then if you click to another
conversation it keeps aida highlighted instead of properly unhighlighting" — were
driven against her rail row by `harness/drive-aida.mjs` (through
`harness/run-aida.sh`, which opens the one gate that keeps her row off the first
pass's frames: `ACK_AIDA_ENABLED=1` writes `aida.enabled: true` in the seed and
`ACK_NO_AIDA=0` opens the launch env switch, both halves of
`aida/bootstrap.py::config_enabled`).

**The sequence passed on BOTH trees.** Press her rail row, then press two
different conversations in the chat list:

| press | before tree | after tree |
| --- | --- | --- |
| her rail row | `aria-current="page"` on her row, her session `<id>` current in the list, hash `#/chat/<id>` (selected after 1329 ms) | same (1230 ms) |
| conversation 2 | her row `aria-current` GONE, list current = the pressed row alone, hash matches | same |
| conversation 3 | same, exclusive | same |

The pane was read through the transcript's own `role="log"` node, so "the switch
happened" is not inferred from the highlight: after each press it carries the
pressed conversation's transcript (the rig turn landed in hers), and her row's
mark is gone in the same frame (`her-selected` / `after-other` / `after-third`).

**Reading (b) — "the switch fails and rolls back" — is refuted structurally on
this build, and the shipped history says it cannot be the operator's build.**
`openSession` has had no guard read and no rollback since `2e97f9ddfe`
(2026-09-23, "open a conversation without a guard read", shipped in v0.30.18+):
it is a plain latest-wins `set` that reports `true`, so a switch can never be
disproved into a restore and nothing can re-light her row. The gone-conversation
scene (delete the seeded conversation's store, press its row while hers is
current) is recorded as it ran: the switch stood, her row stayed unlit, and the
pane painted the store's cached page within the window measured — the missing
notice did not get a chance to appear in this run and is NOT claimed.

**The one press this app holds back by design was measured too** (`repeat-same-point`
/ `repeat-after-move`): a second press at the same point (pointer unmoved, ≤6 px)
whose target is a different session is DROPPED by the list's repeat-press guard
(`chat-sidebar.tsx::dropRepeatPress`) — the view does not move, so the previous
selection stands. That is the only mechanism found on this build that can leave
an old highlight standing after a press, and it is deliberate (the row that slid
into place is not the row the press meant); the guard expires on a real move,
after which the next press lands (`repeat-after-move`: the moved press selects
the third conversation). If the operator's failing press was such a dropped
press, this is what they saw; the reorder that would have moved a different row
under their pointer between their two presses was not reproducible from the rig.

The two repeat-press frames carry the parked pointer's own choreography, and it is
the row's documented behaviour rather than a defect: the pointer never moves
between the presses, so the trailing acts stay revealed, the row title is mid-pan
(its first letters under the pan's edge fade - the pointer-only pan holds until
the pointer leaves, and leaving clears it in the same frame), and the `rowHover`
and `rowSelected` grounds sit side by side. `repeat-after-move` shows the same row
after a real move: the pan is gone and the pressed row is current.

**Her badge, and the working mark** (`badge-before` → `her-badge` → `her-badge-clear-refused`):
a real completion in her session, while her conversation is the open view,
raises the badge `1` 250 ms after the backend reports it (rail accessible name
"Aida 1"; her list row "Unseen completion, unread"), and the same attention state
drives it — `use-aida-missed-messages.ts` counts `unreadAckableRows`, the same
predicate the bulk receipt reads. The badge's live CLEAR cannot be shown in this
rig for the same reason defect 1's clear cannot: every `sessions.seen` main
accepts is refused for a window that is not in the foreground, and the bulk
control is no exception — pressing "Mark all 1 read" produced the toast "View
these completions in the foreground before marking them read. The unread marks
were not cleared." (recorded verbatim in `after-readings.json`), and the badge
stayed `1` (hence the frame's name, `her-badge-clear-refused`).

**Q1's freshness question, and the second mechanism it found.** The receipt's
anchor gate asks the DOM for `[data-completion-anchor=…][data-completion-complete=
"true"]`, and this pass measured when that attribute appears after a FRESH
completion — the rig's own probe, per 200 ms, read from the pane:

| | before `ff34fb8ecc` | after this branch |
| --- | --- | --- |
| fresh completion, attribute on its anchor | **absent for the whole 30 s** (`completeCount: 0`) | **present at the first sample** (`completeCount: 1`) |
| after switching away and back | present (`1`) | present (`1`) |

The before half is the operator's "cannot be cleared until you switch away and
back": a completion that arrives while its conversation is open is settled by the
live `message_end`, and that arm wrote the row without the `complete` mark the
durable read writes — so the receipt never found the anchor to acknowledge until
some re-read replaced the record. It is not mock-specific: the live arm is the
shipped producer's own path, and the fix gives it the same mark for the same
fact (`transcript-reducer.ts`'s `message_end`, mirrored from the `history` arm;
`a live settle carries the same completion mark the durable read writes` in
`scripts/transcript-reducer.test.mjs` fails without it). With the fix the after
half shows the attribute at the first sample, with no re-read. The re-read leg
also closes the loop on defect 1 for HER session: after it, the before tree logs
the give-up line and paints the give-up clause (`giveUp: 1/1`), while the after
tree defers silently (`0/0`).

**Q3's two channels, both states recorded.** On the before tree, ~30 s after the
completion (no re-entry), the viewed unread row carries
`aria-describedby="chat-row-read-ack-<id>"` and its flyout reads "Unseen
completion, unread · scroll to the result to mark this chat read"
(`viewed-row-flyout`). On the after tree at the pre-Q1-fix head the same. On the
Q1-fixed head the same row reads `aria-describedby: null` and its flyout carries
no clause — a deferral is silent, which is the designed state
(`read-ack-notice.ts`: the notice exists for the states the reader must act on,
and the loop's notice is cleared with the loop). Both readings are in
`before-readings.json` / `after-readings.json` (`viewedRow`, `viewedRowEarly`).

**D1, declined with its measurement.** A committed frame of her row's busy mark
was attempted across three consecutive runs: after the send, her rail row's own
accessible name ("Aida, working") and its spinner were polled every 100 ms for
20 s, and the mock turn's busy window never coincided with a capture (two earlier
runs of the same scene DID paint it — list-row label "Working Aida", DOM sample
`workingSeenAfterMs: 0` — and QA's independent pass photographed the same label).
The state is covered by QA's evidence; no frame is claimed here.

**What this pass says about defect 1, and what it cannot say about defect 2.**
The freshness leg closes the loop on defect 1 for HER session: after the re-read
the before tree's receipt chases and gives up (`giveUp: logLines 1, rowClauses
1`), while the after tree's defers silently (`0/0`) — the same discriminator as
the first pass, now on her own conversation. The operator's defect-2 report is
neither reproduced nor closed: the exact sequence is clean on both trees in this
rig, and the shortest path to closing it is the operator's own build and a
recording of the failing gesture.

## The harness

- `harness/run.sh` — isolation and guards: ports checked free, scratch `HOME` /
  config / logs / profile, the app launched from the scratch root (so no repo
  `.env` can point it at the operator's backend), the dev driver armed through the
  launch environment only, teardown by exact pid with a survivor check. It refuses
  to drive a CDP port it does not own and verifies the app reported `headless` with
  `visible=false` before any scene runs.
- `harness/seed.mjs` — the four-conversation store, the mock-hosting config, the
  frames directory.
- `harness/drive.mjs` — the scenes, the CDP focus lever, the backend reads
  (`attention` ground truth), the give-up discriminator, and the verdict the exit
  code carries (2 when the defect's signature is present).
- `harness/drive-aida.mjs` + `harness/run-aida.sh` — the her-row pass above;
  `run-aida.sh` is `run.sh` with both halves of the assistant gate opened
  (`ACK_AIDA_ENABLED=1`, `ACK_NO_AIDA=0`).
