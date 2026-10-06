# remote-load-hydration — the stored remote session that opened empty, before and after

**What these are.** Hand-driven frames, row logs and probes for the defect in
which a stored REMOTE (mesh) session opens EMPTY — the daemon answers its cold
open with an empty page (a facade with no owner), the pane's end/greeting
claims read that page as "nothing here", and nothing re-runs the read once the
session warms, so the conversation sits empty until a user action. The lane's
report is the operator's stored session `5340680381e7` opening to a greeting
with zero rows, 60 s idle, empty log; the fix is the transcript's cold-read
proof rule plus the warm re-hydration trigger in
`src/renderer/src/shared/hooks/use-canonical-session.ts`, and the slot's
`unproven` arm in `src/renderer/src/features/chat/canonical/`.

**The frames are PNG screenshots from the built app and its Storybook**, driven
over CDP by the committed harness in `harness/` (`rig.mjs`, brought over from
the `remote-turn-order` set with one addition — a `warm` op that POSTs the
daemon's own `/v1/desktop/sessions/<id>/warm` — and `shoot-storybook.mjs`),
in the documented `headless` window mode with a scratch profile, against the
machine's own daemon at `127.0.0.1:1111` (which carries the mesh). Their stems
name no theme, so `check-evidence.mjs`'s walker judges none of them and the set
is declared: the frames are accounted as unjudged frames inside a declared set
(the `ask-badge-quiet` and `remote-turn-order` precedent) rather than read as
undeclared sweep output. Each half's row log (`rows-*.jsonl`) is the rig's own
dump of the `[data-record-id]` elements in DOM order, each probe (`*.json`) is
the pane's own text as the rig read it, and each `sse-*.jsonl` is the raw
`/events` stream for the same run (the flip's wire shape).

**BUILD PROVENANCE (round 1, Q2).** Every live frame in this set was re-taken
for the round-1 remediation on a FRESHLY BUILT tree: `after-branch/` on the
remediation head's `out/` (the documented build recipe, `VITE_*`=inert), and
the `frames/before-base/local-warm-cold-open.png` control on a base build
(`46fd032ed59`). The Storybook frames are source-compiled (`storybook dev`),
so they were taken from the working tree directly. The `frames/relay-down/`
pair is now this branch's build against the BASE build (the earlier
`remote-turn-order` sibling frames were replaced: that worktree's Electron
could not launch on the day this round was re-captured, and a pure-base
control is the stronger comparator anyway).

## The rule, in one line

> Never claim exhaustion (or an empty conversation) over a page whose hydration
> is unproven, and re-hydrate when a warm lands.

A COLD facade's empty page is the daemon's own word for "nothing to paint yet"
— an empty page beside `cold: true` is the renderer's signal to reconcile
through `/history`, which is exactly the read that got here — and it is
byte-identical to a genuinely empty conversation's page, on this device and on
a peer's alike. So:

1. **The walk no longer proves hydration from an empty page it read while
   cold** (`use-canonical-session.ts`, the `coldAtDispatch` term), and the
   older-history slot's end claim now rides the transcript's own proof
   (`hydrationProven`): unproven renders "Earlier history not loaded" with a
   retry, never "Start of conversation".
2. **The cold to warm flip re-arms the history read** (the `warmedUnproven`
   trigger in `flush`): the first frame that says `cold: false` fires the walk
   again, so the pane fills with no user action. The daemon publishes that flip
   in THREE shapes and all three are matched — a fresh `snapshot`, the
   attach-settled `frontend.replace`, and the retained-dial late sync, which
   publishes it as a **`frontend.update` carrying `cold: false` on the frame's
   own envelope** (round 1's Q1/F1 measured this live; the update fold now
   carries that envelope onto the view, and `sse-flip.jsonl` beside the
   after-branch local-warm frames is the raw capture of exactly that shape:
   `snapshot{cold:true}` → `frontend.update seq=2 {cold:false}`, no replace
   anywhere in the batch).
3. **The retry on the unproven arm is acknowledged** (round 1's U1/F4): while
   the read a press fires is out, the slot paints the sibling "Loading earlier
   messages" row (`historyReadPending`), and the session hook refuses to stack
   a second walk for a read already in flight — so a held press cannot queue N
   reads, and a settled-still-unproven read restates the fact instead of
   repainting an identical row.

## The halves

| half | tree | what it shows |
| --- | --- | --- |
| `frames/before-base/` | base build, `origin/main` at `46fd032ed59` | the defect on the operator's own stored remote session `5340680381e7` (route `/chat/5340680381e7`, chip "On cloud-node-1"): `base-op-session-empty.png` is the open — the empty-chat greeting over a conversation that has rows on the peer, ~6 s in; `base-idle-60s-empty.png` is the same pane 60 s later (rows still 0; `rows-95042.jsonl`); `base-hold-05s.png` / `base-hold-55s-greeting.png` are an earlier window of the same route (`rows-17713.jsonl`) showing the transition itself: the placeholder holds at 5 s, and by 55 s the cold empty read has PROVEN hydration on the base tree — placeholder gone, greeting shown, zero rows. **And the warm control, re-taken this round on a fresh base build**: `local-warm-cold-open.png` (+ `local-warm-cold-probe.json`, `local-warm-sse.jsonl`) is a FRESH empty local session (`08349efde8f3`, `cold:true, no-runtime`) opening straight to the empty-chat greeting — the false-empty claim at the cold open, on the base build, with the flips that follow changing nothing visible. |
| `frames/after-branch/` | this branch's remediation build | the copy change, rendered: `storybook-unproven-end.png` is the slot's `unproven` arm over real rows — "Earlier history not loaded" with "Try again", NOT "Start of conversation"; **`storybook-unproven-end-light.png`** is the same cell in `localOperatorLight` (round 1's U4); `storybook-every-state.png` is the six-arm board between its rules; **`storybook-app-minimum-width.png`** is the 252px board (round 1's D2 — the narrow measure the diff extends, where the short spellings render, incl. the D3 fix below). `local-true-end.png` is the local regression cell (re-taken on this round's fresh build): a new local conversation's true end still says "Start of conversation". |
| `frames/after-branch/local-warm/` | this branch's remediation build | THE ROUND-1 Q1 DISCRIMINATOR, live: `cold-open.png` is a fresh empty local session (`9571ebcba57a`, `cold:true, no-runtime`) holding "Loading conversation…"; `warm-loaded.png` is the SAME pane after ONLY the daemon's warm op — no user action, no click — now painting the empty-chat greeting because the update-shaped flip re-armed the read and a warm empty page is the conversation's own statement (`cold-probe.json` → `warm-probe.json`: `placeholder:"yes"`/`greeting:"no"` → `placeholder:"no"`/`greeting:"yes"`; `rows-52165.jsonl` has the samples; `sse-flip.jsonl` is the wire). The pre-fix shape of this same cell held the placeholder for 30 s with the daemon warm (round 1's Q1 FAIL on `3f4c435450f`), and the base build above greets over nothing at the cold open. |
| `frames/relay-down/` | this branch's remediation build vs the base build | THE LIVE REMOTE CELLS COULD NOT BE TAKEN TODAY, and this is the evidence of why rather than an assertion of it. With `cloud-node-1` unreachable (`lop network peers` re-checked before every run this round: "no address of it answered"), the daemon answers the session's stream with 404 once its owner cannot be resolved, so BOTH trees — this branch's (`branch-*.png/.json`) and the base's (`base-*.png/.json`) — show the placeholder at 4 s and the terminal "This conversation is no longer on this machine … belongs to a machine this app is not connected to" by 60 s. Identical probes on both trees (`placeholder:"yes"` at 4 s, then `placeholder:"no"` with no greeting and no slot) are what mark the cells `pending — relay flaky` instead of shipping a frame that would not discriminate. |

## The mechanical pins

The rule and the trigger are asserted where the code lives, in the repo's
script-suite style. Measured this round (the command is the pin):

```bash
# base-src + head-tests scratch tree (pinned Node v22.13.1, env -u XPC_FLAGS):
node scripts/run-desktop-tests.mjs scripts/session-load-recovery.test.mjs \
  scripts/older-history-slot.test.mjs scripts/transcript-paging-hook.test.mjs
```

- **base `46fd032ed59` (base `src/`, this round's test files): 51 tests, 43
  pass, 8 fail** — exactly the eight discriminating cases, by name (four from
  round 0: the slot state rule, the rendered not-loaded arm, the retry-drop,
  the cold/warm re-arm; four added this round: the update-shaped flip, the
  in-flight-warm race, the retry's pending paint + no-stack, and the paging
  hook's pending arm).
- **head (this round): 51 tests, 51 pass, 0 fail.**

The cases:

- `scripts/transcript-paging-hook.test.mjs` — "an unproven end is not the end:
  `hasMore: false` without hydration proof" (slot state → `unproven`); "the
  unproven end paints the read while it is out, then states itself again"
  (round 1's U1, the slot-state half); and the compat pin "a proven end still
  states itself once a page has been read".
- `scripts/older-history-slot.test.mjs` — "an unproven end states not-loaded
  and offers the read again — never the end copy" (rendered words over the
  real `CanonicalTranscript`; both spellings, the short one now "Earlier not
  loaded" per round 1's D3) and "the unproven row drops its retry while the
  transport is down".
- `scripts/session-load-recovery.test.mjs` — "a cold empty read proves nothing,
  and the warm re-arms the read" (the `frontend.replace` flip); **"a warm that
  lands as a frontend.update re-arms the read and folds its envelope"** (round
  1's F1/Q1: the live daemon's actual flip shape, and the fold's cold write);
  **"a warm landing while the cold read is in flight cannot prove the stale
  page"** (round 1's F2: the race `coldAtDispatch` exists for, with both reads
  held open); **"the retry's read is painted while it is out, and a second
  press does not stack"** (round 1's U1, the hook half).

Note on the runner: the repo pins Node in `.nvmrc` (v22.13.1). Under the
machine's default Node 26, `zustand/middleware`'s import-time `localStorage`
access fails in this suite on the BASE tree too (13 red, reproduced on the
`remote-turn-order` worktree); run it with the pinned Node.

## The commands

```bash
# The read-only cold-open cell on the operator's session (never add send/warm):
LOCAL_OPERATOR_UI_WORKTREE=<worktree> LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node harness/rig.mjs --plan harness/plan-cold-open.json --out <out>

# The local regression cell (creates a scratch local conversation):
LOCAL_OPERATOR_UI_WORKTREE=<worktree> LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node harness/rig.mjs --plan harness/plan-local.json --out <out>

# The warm cell, local or (when the relay returns) remote — one command:
# create a fresh session first (the daemon's own POST /v1/desktop/sessions,
# request_id a UUID, cwd existing), then:
EVIDENCE_SESSION_ID=<fresh session id> \
LOCAL_OPERATOR_UI_WORKTREE=<worktree> LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node harness/rig.mjs --plan harness/plan-remote-warm.json --out <out>

# The slot's rendered states, from a running `pnpm storybook`:
LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node harness/shoot-storybook.mjs --origin http://localhost:6006 --out <out>
```

The rig reads the daemon's desktop token from its own file
(`~/Library/Application Support/Local Operator/desktop-token`) and never prints
it. Both rigs tear down by exact pid: the app and Chrome are killed by the pid
the run started, and Chrome's scratch profile is removed.

## Not addressed, considered (round 1)

- **NOT ADDRESSED (round 1's U2, pre-existing, adjacent): an unreachable peer
  is reported as a deleted conversation.** `frames/relay-down/branch-60s.png`
  is the pane's own statement ("This conversation is no longer on this
  machine…") under a flaky relay, and its only action abandons the thread.
  Identical on the base tree. A proper fix needs the daemon to distinguish
  "owner unreachable" from "this host does not have it" (or the pane to offer
  a reconnect path), which is a core-side signal plus a copy/state decision —
  not a one-liner, and not this PR's slice. Recorded as the follow-up
  candidate.
- **CONSIDERED, no change (round 1's U3):** the unproven row's top-slot
  placement is the established idiom (same position as `Load earlier
  messages` / `Start of conversation`); the design lane did not ask for it to
  move.
- **APPLIED (round 1's D3):** the unproven arm's short spelling is now
  "Earlier not loaded" — it keeps its subject, so it no longer reads as the
  transport-down arm's "Not loaded" four characters away at narrow widths.
- **CLOSED LOCALLY, REMOTE PENDING (round 1's D1):** the cold → warm transition
  is now shown by the local warm pair (after) against the base control
  (before). The remote mesh cell itself remains pending the relay.

## What to look for in the row logs and probes

A row log line is `{ t, note, rows: [{id, kind, ...}], stop, working }` — the
`[data-record-id]` elements in DOM order at instant `t`. A probe line is the
pane's own text as flags: `placeholder` ("Loading conversation…"),
`greeting` ("What can I help you with today?"), `startCopy` ("Start of
conversation") and `notLoaded` ("Earlier history not loaded" or "Earlier not
loaded"). The defect's shape in `rows-95042.jsonl` is `rows: []` at every
sample across 60 s while the pane's frame said "What can I help you with
today?"; the local warm cell separates the states the words claim —
`placeholder:"yes"` while cold, `greeting:"yes"` only after the flip proved
the conversation empty, with `sse-flip.jsonl` naming the frame that did it.
