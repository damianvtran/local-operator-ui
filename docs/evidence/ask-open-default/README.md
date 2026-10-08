# The asks drawer opens by itself over pending asks

The operator's request (2026-10-07, relayed through Aida in the brief that assigned this
work; the wording here is the brief's, not a verbatim quote): when a conversation with
PENDING, unaddressed asks is opened, that surface's primary asks interaction must be OPEN
by default, for discoverability - the collapsed component above the composer is easy to
miss, so a first-time user lands on a conversation that looks as though it has nothing to
answer. This is the web UI's half. The TUI's ask panel, the mobile relay's asks sheet and
the native app's asks sheet implement the same six rules in their own idiom.

## The contract, and where each rule is read

`src/renderer/src/features/chat/ask-open-policy.ts` states it (module note), and its
decision is a pure function over facts, so every rule below is also a node test.

| # | rule | the frame that shows it |
| --- | --- | --- |
| 1 | nothing pending on open -> closed | `state-1-no-asks`, `state-11-no-engine` |
| 2 | pending on open -> open, once per view of a conversation | `state-2-pending-on-open` (+ Light), `state-9a-1024`, `state-9b-800`, `state-8b-new-view-opens` |
| 3 | all addressed on open -> closed, and a settled queue never re-opens | `state-3-all-addressed` |
| 4 | a deliberate close while asks remain is respected for that conversation, in memory only; a NEW ask does not force it open | `state-4a-dismissed` ... `state-4d-reload-opens-again`, `state-15*`, `state-16*` |
| 5 | no focus theft, no trap, never act on a frame that has not answered | `state-6-composer-has-draft`, `state-13*`, `state-11-no-engine` |
| 6 | an auto-open is not a door press (#864's door-focus signal keeps meaning "the user pressed it") | `run-after.json` `s2.tap`, `s10` |

## What the frames carry

Two arms of ONE driver, and the split is stated rather than implied. `before/` is the BASE
this branch stacks on - `feat/ask-other-option` at `8f189b3f40e` (PR #892) - served by its
own Vite from its own worktree, so the only difference between a before frame and an after
frame is the open policy: three renderer source paths (`ask-open-policy.ts`,
`use-ask-open-policy.ts` and 18 lines in `chat-content.tsx`). `after/` is this branch's head. Each arm ran against
its OWN freshly started backend (a routes daemon plus one owner process per conversation,
real `Session`s and a real `AskQueue`), one headless Chrome per run, one browser context per
case, 1380x900 unless a case names another size. 38 frames: 11 before, 27 after; 36 Dark
and 2 Light (`state-2-pending-on-open`, one per arm).

The four-state matrix, as the page reads it at the shutter (`run-before.json`,
`run-after.json`; `drawer` is the number of drawers mounted, `rows` the ask cards in it):

| state | before (no policy) | after |
| --- | --- | --- |
| 1. no asks (a live queue with nothing in it) | `drawer 0`, no chip | `drawer 0`, no chip: there is nothing to announce, and an ask that arrives later does not open it either (`s8`) |
| 2. pending on open | `drawer 0`; the chip above the composer reads `1 question waiting`, `aria-expanded=false`; the composer is 778px wide and 0 of 348 sampled frames drew a drawer | `drawer 1`, `rows 1`, the chip is `aria-expanded=true`; the sampler first sees the drawer 703 ms into the page (zero is the new document: the conversation is opened by a navigation, not a press), 275 of its 300 frames carry it, and none paints it without its rows (`framesWithDrawerAndNoRows 0`) |
| 3. all addressed on open | `drawer 0`, chip `All asks settled` | `drawer 0`, the same chip |
| 4. dismissed while pending | (not reachable: nothing opens) | opened `drawer 1`; after the X `drawer 0`; still `0` after a queue refresh, after a composer re-render, after a NEW ask arrived (the chip then reads `2 questions waiting`), after switching away and back (261 sampled frames, 0 with a drawer); a RELOAD - a fresh page lifetime - opens it again with both asks |

Rule 4's "may open again on a fresh start" is the reload row: the record is module memory,
and `performance.timeOrigin` before and after proves the document really restarted.

Where the arms differ in layout, and why it is not a regression: the drawer takes the right
slot, so the chat column narrows with it. At 1380px the composer goes from 778px to 452px; at
1024x768 the slot is 444px and the composer 416px (it was 640px); at the app's 800x600 floor
the slot is 220px, the composer 416px (it was 620px) and the page does not overflow
horizontally. The `before/state-9c-*` frames are the control: the same drawer opened by the
user's own press on the old tree reads 444px and 220px, the same slots. The policy opens the
drawer; it does not change what an open drawer costs.

### Neighbours that must read the same, and do

| step | before | after |
| --- | --- | --- |
| `s5` send a plain message with the drawer up | the message reaches the transcript, the ask stays `open` (`askEventKinds ["queued"]`, 10 transcript lines) | identical |
| `s10` close with the X: where the keyboard lands | on the chip (the door, restored by #864) | on `BODY`: an auto-opened drawer had no door to return to, and the policy never moves focus, so there is nothing to restore |
| `s12` Escape in the composer with the drawer up | closes it | closes it, and a refresh keeps it closed: Escape is a dismissal too, because the watch is on the flag and not on a button |
| `s14` the canvas holds the right slot | the canvas stays | the policy BORROWS the slot (`canvas 0`, `drawer 1`) and the close gives it back (`canvas 1`): the same swap a press on the chip makes |
| `s11` a runtime with no queued-ask engine | no chip, no drawer | no chip, no drawer: an unpublished queue is not "no asks" and is not "pending asks" |

### The dismissal record names the asks it waved off

Rule 4 first shipped as a bare flag per conversation. Two live cases showed that is wrong,
and the record is now the SET OF ASK IDS the close waved off, under three clauses every
surface shares: it holds while any of them is outstanding and is forgotten once none is;
a list that cannot be named in full holds; a second close unions.

| step | what is driven | read at the shutter |
| --- | --- | --- |
| `s15` | a close over TWO asks; one is answered while the user is away; then the rest are answered AND a new batch is queued while away | `drawer 1` (2 rows) -> closed -> still `drawer 0` after the partial resolve (0 of 262 sampled frames drew one) -> `drawer 1` (1 row) on the new batch. The two ids named at open and the one after the refill are disjoint, so no "seen empty" frame was needed to forget the record |
| `s16` | eight ~900-character asks, so the core's text budget ships a SEVEN-row prefix beside a tally of eight | `drawer 1` (7 rows, chip `8 outstanding`) -> closed over the seven it could name -> those seven answered while away: still closed with `1 outstanding` (the eighth, which the close never named; 0 of 262 sampled frames drew a drawer) -> the eighth answered with the view open: `0 outstanding`, a COMPLETE frame with nothing outstanding, the one observation that settles a list that was never named in full, so the record is forgotten -> a new batch and a new view: `drawer 1` (1 row) |

`s16` is the case that failed live before it was fixed, which is why it is here: the first cut
required the wire's `asks_truncated` flag to be false before it would call a list complete, on
the premise that the flag says "this list is a prefix right now". It does not. Derived, not
recalled - `harness/derive-wire-frames.py` runs the installed runtime's own `ask_wire` and
`bound_ask_rows` and `wire-frames.txt` is its output:

```
8 long asks, all open                          rows carried=7   outstanding among them=7   asks_open=8   asks_truncated=True
7 answered, 1 open                             rows carried=7   outstanding among them=1   asks_open=1   asks_truncated=True
ALL answered: nothing outstanding              rows carried=7   outstanding among them=0   asks_open=0   asks_truncated=True
all answered + one new short ask               rows carried=7   outstanding among them=1   asks_open=1   asks_truncated=True
```

The flag is STICKY (set when the text budget drops any row, answered ones included, and kept
while they ride the projection, up to seven days), so a predicate that required it clear could
never be true again and a record made over a prefix could never be forgotten. The policy now
reads the TALLY, which says everything the flag was being read for and says it per frame. The
only remaining code reader of the flag is `ask-queue.ts`'s `askSplitIsKnowable` (the chip's
`waiting`/`moved on` split, unchanged by this branch); the policy and its hook read none.

What the wire cannot say, also derived: `ask_wire` counts `asks_open` over rows the queue has
already clipped to its 20-row projection, so 25 outstanding asks publish 20 rows beside
`asks_open: 20` and no flag. The surplus is on neither field and no client can name it. The cost
points the harmless way (the hidden ask surfaces later as an id nobody waved off, which reads
as a refill and opens the drawer once) and is stated in the module note.

### The other cases

| step | what it shows |
| --- | --- |
| `s6` | a composer that holds a restored draft keeps the drawer shut: auto-open never lands on a user who is typing, and clearing the draft later does not open it |
| `s7` | the drawer the policy opened for conversation A is not carried onto a conversation the user dismissed (`D`): 19 of 261 sampled frames ever drew one, all before the switch |
| `s8` | an ask that ARRIVES while a conversation is open does not open it (`drawer 0`, the chip reads `1 question waiting`); a NEW view of it, now pending on open, does |
| `s13` | the `Other` row from #892: auto-open takes no focus into it (`fieldFocused false`), the user's press does, a close over typed text is a dismissal that a refresh keeps shut, and the user's own press on the chip reopens it with the typed text still in the field |
| `s2.tap` | the focus tap read the element focused when the drawer first appeared: the composer's textarea, with 0 focus events inside the drawer. Opening never took the keyboard |

### Every committed frame, by directory

Each directory holds one Dark frame (`localOperatorDark.webp`); `state-2-pending-on-open` also holds a Light one.
`B` / `A` say which arm has it: `B` is `before/`, `A` is `after/`. The case ids are `harness/drive-open.mjs`'s.

| directory | arms | case | what it shows |
| --- | --- | --- | --- |
| `state-1-no-asks` | B+A | `s1` | a live queue with nothing in it: no chip, no drawer |
| `state-2-pending-on-open` | B+A | `s2 / s2l` | pending on open; Dark and Light, both arms |
| `state-3-all-addressed` | B+A | `s3` | every ask already answered: the settled chip, no drawer |
| `state-4a-dismissed` | A | `s4` | closed with the X while the ask is pending |
| `state-4b-new-ask-arrived` | A | `s4` | a second ask arrives: the chip says 2, the drawer stays shut |
| `state-4c-switched-back` | A | `s4` | away to another conversation and back: still shut |
| `state-4d-reload-opens-again` | A | `s4` | a reload (a fresh page lifetime): open again, both asks |
| `state-5-send-normal-message` | B+A | `s5` | a plain message sent with the drawer up (before: opened by the chip) |
| `state-6-composer-has-draft` | A | `s6` | a restored draft in the composer: no auto-open |
| `state-7-carried-closed` | A | `s7` | the policy's drawer is not carried onto a dismissed conversation |
| `state-8a-arrival-stays-closed` | A | `s8` | an ask arrives while the conversation is open: chip only |
| `state-8b-new-view-opens` | A | `s8` | a new view of that conversation, now pending on open: opens |
| `state-9a-1024` | B+A | `s9a` | pending on open at 1024x768 |
| `state-9b-800` | B+A | `s9b` | pending on open at the 800x600 floor |
| `state-9c-w1024-user-press` | B | `s9c` | CONTROL, before arm only: the user's own press at 1024x768 |
| `state-9c-w800-user-press` | B | `s9c` | CONTROL, before arm only: the user's own press at 800x600 |
| `state-11-no-engine` | B+A | `s11` | a runtime with no queued-ask engine: not 'no asks', not 'pending' |
| `state-13a-other-row-present` | A | `s13` | the Other row from #892 in the auto-opened drawer, no focus in it |
| `state-13b-other-typed` | A | `s13` | text typed into Other by the user |
| `state-13c-reopened-by-the-user` | A | `s13` | closed over the typed text, then reopened by the chip: text kept |
| `state-14-canvas-holds-the-slot` | B+A | `s14` | the canvas holds the slot; the policy borrows it (before: canvas stays) |
| `state-14b-canvas-handed-back` | A | `s14` | the close gives the slot back to the canvas |
| `state-15a-dismissed-over-two` | A | `s15` | closed over TWO asks |
| `state-15b-partial-resolve-holds` | A | `s15` | one answered while away: still shut |
| `state-15c-refill-opens` | A | `s15` | the rest answered and a new batch queued while away: opens |
| `state-16a-truncated-prefix-opens` | A | `s16` | eight ~900-char asks: a seven-row prefix opens the drawer |
| `state-16b-unknown-list-holds` | A | `s16` | the seven it named answered: the unnamed eighth keeps it shut |
| `state-16c-complete-empty-frame-then-new-batch-opens` | A | `s16` | a complete empty frame forgets the record; a new batch opens |

## Tests: one per state, and which old behaviour each fails

`scripts/ask-open-policy.test.mjs` (41 cases, the decision over wire-shaped frames built by
the shipped `askQueueView`) and `scripts/ask-open-render.test.mjs` (29 cases: the real hook,
the real zustand stores and the real `AskDrawer` in jsdom, under React's StrictMode double
effect). The render suite's `Pane` stands for `ChatContent`'s relevant slice and not for the
component itself, which needs the canonical stream and cannot be mounted in a node test; the
call site is pinned by source at the bottom of that file, and the real mount is what the
committed frames show. Both suites are registered in `test:desktop`;
`scripts/test-inventory.test.mjs` refuses an unregistered suite.

`harness/mutate.py` is the fail-on-old reading, per rule. M0 is the old tree in one line (the
hook returns before doing anything); M1-M19 are one exact-text replacement each in shipped
source, asserted to match exactly once, restored byte-for-byte, and run against both suites.
`harness/mutation-results.json` is its output at this branch's head: the control passes 70 of
70, and every one of the 20 mutants fails at least one test, with no survivor. The old tree
(M0) fails 20 of the 70, among them:

```
state 2 - pending on open: the drawer opens by itself, once
state 4 - dismissed while pending: stays closed through a re-render, a refresh, an arrival, and a switch away and back
an unresolved frame opens nothing; the frame landing later opens once
opening never takes the keyboard: the composer keeps focus and the drawer takes none
```

and the states the old tree already satisfies are pinned from the other side: M1 (open over a
queue with nothing pending) fails `state 1` and `state 3`, M2 (a dismissal never recorded)
fails both `state 4` cases. A mutant that survived the first run each time showed a test that
could not fail for the thing it was named after; those two are why `1cb3ef3` exists.

## Re-deriving the frames

Everything is under `harness/` and resolves the repository from its own location. The rig is
`ask-drawer-stuck`'s, with seven owner processes (one per queue shape the policy has to tell
apart) and a command channel the driver uses to enqueue and answer asks after a page exists.
ONE ARM PER RIG: the before arm's `s5` writes a chat message into conversation A, so an after
arm driven second over the same rig photographs a transcript the other arm already wrote - the
driver refuses both flags in one invocation, with the measured readings in its header.

```
# One shell, in order. RIG_SCRATCH is EXPORTED, not an inline prefix: an inline
# `VAR=$(mktemp -d) cmd` lives for that one command, and the driver line would then
# read an empty --scratch.
OUT=<an empty dir OUTSIDE the repository>

# AFTER arm, this checkout
export RIG_SCRATCH="$(mktemp -d)"
ASKS_RIG_PORT=5481 bash docs/evidence/ask-open-default/harness/rig-up.sh
node docs/evidence/ask-open-default/harness/drive-open.mjs --after http://localhost:5481 \
  --scratch "$RIG_SCRATCH" --out "$OUT"
bash docs/evidence/ask-open-default/harness/rig-down.sh

# BEFORE arm: a worktree of the base (feat/ask-other-option @ 8f189b3f40e) with its own
# node_modules (an APFS clone, `cp -Rc`; never a reinstall), and a FRESH rig
export RIG_SCRATCH="$(mktemp -d)"
RIG_BEFORE_REPO=<that worktree> ASKS_RIG_BEFORE_PORT=5482 \
  bash docs/evidence/ask-open-default/harness/rig-up.sh
node docs/evidence/ask-open-default/harness/drive-open.mjs --before http://localhost:5482 \
  --scratch "$RIG_SCRATCH" --out "$OUT"
bash docs/evidence/ask-open-default/harness/rig-down.sh

python3 docs/evidence/ask-open-default/harness/mutate.py        # the mutation table; needs a COMMITTED tree
```

`rig-up.sh` copies `harness/` into the before worktree (untracked there), because the Vite
config derives the repository root from its own location. The driver launches ONE private
headless Chrome through `scripts/chrome-keychain.mjs` (`--use-mock-keychain`), closes it through
`Browser.close`, kills it by its own handle only if that fails, and removes its profile; the rig's
Python children run under a scratch `HOME` with a fenced `security` that logs its argv, and
`rig-down.sh` prints the log: `security calls recorded: 0` on both arms of the committed run.
The rig is stopped by exact pid from its own pid files, never by name. The owners ran on the
installed runtime generation `20261008T051705Z-0.68.7`, whose `ask_wire` is the one
`wire-frames.txt` was derived from. Both arms' runs share that one generation.

## What this does not cover

- **No Electron window.** The renderer, the components, the answer path and the
  `/__desktop` bridge are the shipping ones; the Electron IPC/preload channel and a packaged
  native window are not exercised.
- **The model is a recording stub.** It answers one line and never calls a tool, so whatever
  happens to an ask in this rig is the user's doing or the driver's.
- **The 45 s window and the 5 s arrival skew are the shared contract's numbers**, not measured
  here. They were read off the TUI lane's `local_operator/tui/ask_open_policy.py`
  (`OPEN_WINDOW_S = 45.0`, `ARRIVAL_SKEW_MS = 5000`) on the core branch
  `feat/asks-open-default-tui-relay` at `e21b3e0c6f`, which was not on core `main` when this was
  written; both are pinned by a test here because a client that quietly changed one would open a
  conversation on one surface and leave it shut on another.
  `scripts/ask-open-policy.test.mjs` drives the boundaries; no frame waits 45 s.
- **Past 20 outstanding asks the record cannot be exact** (see above). The failure mode is one
  extra auto-open, never a refused panel being forced open over a held record.
- **Frames are Dark except one pair.** Light is `state-2-pending-on-open` in both arms, which
  shows the auto-opened drawer once in Light. No other state is re-shot in Light: the policy
  changes WHEN the drawer opens and not how it paints, and the drawer's Light rendering is
  covered by `ask-other`'s set (106 frames, both palettes) and `ask-drawer-stuck`'s story sets.
- **Mid-animation samples move between runs and are not quoted.** `before/state-9c-*`'s 150 ms
  sample is taken while the slot is still sliding: 440 px wide in the committed run, 435 px in an
  earlier take of the same rig (scratch record, not committed), against 444 px settled at 600 ms
  in both. Every number in this README is a settled reading, or a count over the sampler's
  frames.
- **One rig run, not a statistical claim.** `s2`'s 703 ms is one measurement of a cold page
  load (most of it the app booting and the frame arriving, not the policy); an earlier take of
  the same rig read 676 ms. It is a number for "the drawer is not late", not a latency budget.
