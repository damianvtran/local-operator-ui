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
dump of the `[data-record-id]` elements in DOM order, and each probe
(`*.json`) is the pane's own text as the rig read it.

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
   trigger in `flush`): the first frame that says `cold: false`
   (`frontend.replace` per the bridge's attach-settled publish, or a fresh
   snapshot) fires the walk again, so the pane fills with no user action.

## The halves

| half | tree | what it shows |
| --- | --- | --- |
| `frames/before-base/` | base build, `origin/main` at `46fd032ed59` (the lane manager's session, 2197cee0a558) | the defect on the operator's own stored remote session `5340680381e7` (route `/chat/5340680381e7`, chip "On cloud-node-1"): `base-op-session-empty.png` is the open — the empty-chat greeting over a conversation that has rows on the peer, ~6 s in; `base-idle-60s-empty.png` is the same pane 60 s later (rows still 0; `rows-95042.jsonl`); `base-hold-05s.png` / `base-hold-55s-greeting.png` are an earlier window of the same route (`rows-17713.jsonl`; that window's identity chips had not landed yet) showing the transition itself: the placeholder holds at 5 s, and by 55 s the cold empty read has PROVEN hydration on the base tree — placeholder gone, greeting shown, zero rows (both `{"log":""}`). |
| `frames/after-branch/` | this branch's build | the copy change, rendered: `storybook-unproven-end.png` is the slot's `unproven` arm over real rows — "Earlier history not loaded" with "Try again", NOT "Start of conversation" — and `storybook-every-state.png` is the six-arm board between its rules (the fixed-height claim, with the new arm's own row). `local-true-end.png` is the local regression cell: a NEW local conversation (session `53bb1c0efa30`, probe `local-probe.json`: `startCopy:"yes"`, rows 2), its true end still saying "Start of conversation". |
| `frames/relay-down/` | this branch's build vs the `remote-turn-order` build | THE LIVE REMOTE CELLS COULD NOT BE TAKEN TODAY, and this is the evidence of why rather than an assertion of it. With `cloud-node-1` unreachable (`lop network peers`: "no address of it answered"), the daemon answers the session's stream with 404 once its owner cannot be resolved, so BOTH trees — this branch's (`branch-*.png/.json`) and the sibling's (`sibling-*.png/.json`) — show the placeholder at 4 s and the terminal "This conversation is no longer on this machine … belongs to a machine this app is not connected to" by 60 s. Identical probes on both trees (`placeholder:"yes"` at 4 s, then `placeholder:"no"` with no greeting and no slot) are what mark the cells `pending — relay flaky` instead of shipping a frame that would not discriminate. |

## The frames, before and after

- `before-base/base-op-session-empty.png` vs the relay-down pair: the SAME
  session and route. On the base tree of the manager's window, the cold empty
  read proved hydration and the pane greeted over nothing within seconds; the
  fixed tree's own live half of this pair is pending the relay (see above).
- `after-branch/storybook-unproven-end.png`: the honest copy. The rendered
  words are the deliverable's "not loaded" cell, and they are ALSO pinned
  mechanically (below).
- `after-branch/local-true-end.png`: the local regression check — a genuinely
  hydrated local end still states itself.
- **Pending — relay flaky:** BOTH live remote cells, the read-only cold-open
  hold on `5340680381e7` (`harness/plan-cold-open.json`) and the warm/loaded
  cell on a scratch session of this lane's own
  (`harness/plan-remote-warm.json`). The instrumented rig and plans are
  committed; the warm cell is ONE command once the relay returns:

  ```bash
  EVIDENCE_SESSION_ID=<scratch session on cloud-node-1> \
  LOCAL_OPERATOR_UI_WORKTREE=<worktree> LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
    node harness/rig.mjs --plan harness/plan-remote-warm.json --out <out>
  ```

  and the cold-open cell is the same one-liner with
  `--plan harness/plan-cold-open.json` (read-only: no send, no warm — do not
  add either to that plan).

## The mechanical pins

The rule and the trigger are asserted where the code lives, in the repo's
script-suite style, and the four discriminating cases FAIL on the base tree
(measured: 43 of 47 pass on base; the four below fail) and pass after:

- `scripts/transcript-paging-hook.test.mjs` — "an unproven end is not the end:
  `hasMore: false` without hydration proof" (slot state → `unproven`) and its
  compat pin "a proven end still states itself once a page has been read".
- `scripts/older-history-slot.test.mjs` — "an unproven end states not-loaded
  and offers the read again — never the end copy" (the rendered words over the
  real `CanonicalTranscript`) and "the unproven row drops its retry while the
  transport is down".
- `scripts/session-load-recovery.test.mjs` — "a cold empty read proves nothing,
  and the warm re-arms the read": drives the real hook with a cold empty
  snapshot (incl. the `frontend.replace` warm flip) and counts the
  `sessions.history` reads.

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

# The slot's rendered states, from a running `pnpm storybook`:
LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node harness/shoot-storybook.mjs --origin http://localhost:6006 --out <out>

# The warm/loaded remote cell (pending the relay) — see above.
```

The rig reads the daemon's desktop token from its own file
(`~/Library/Application Support/Local Operator/desktop-token`) and never prints
it. Both rigs tear down by exact pid: the app and Chrome are killed by the pid
the run started, and Chrome's scratch profile is removed.

## What to look for in the row logs and probes

A row log line is `{ t, note, rows: [{id, kind, ...}], stop, working }` — the
`[data-record-id]` elements in DOM order at instant `t`. A probe line is the
pane's own text as flags: `placeholder` ("Loading conversation…"),
`greeting` ("What can I help you with today?"), `startCopy` ("Start of
conversation") and `notLoaded` ("Earlier history not loaded"). The defect's
shape in `rows-95042.jsonl` is `rows: []` at every sample across 60 s while
the pane's frame said "What can I help you with today?"; the fixed local
cell's probe separates the states the words claim: `startCopy:"yes"` only
where a page has actually been read.
