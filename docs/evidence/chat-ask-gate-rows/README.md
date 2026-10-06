# The ask gate's divert states on the live trace — settle-only `ask` rows

Seventy-two frames — six states, one pane per state per theme — of the desktop
transcript folding the ask gate's frames through the **production** reducer.
The gate is a core-repo feature in flight (design `docs/design/ask-gate.md`,
`local-operator` commit `9e5f8268`; the core implementation PR is named in this
set's PR thread): when the agent reaches for `ask`, a hidden, forked clearance
check runs first, and when the recommended option is plainly best (or the
answer is the agent's own to resolve) the ask is **diverted** — never queued,
never put to anyone.

## Why the client carries a rule at all

Core hides a diverted ask's rows on every surface it serves. The desktop's LIVE
trace is the exception it cannot reach: the pane folds wire frames client-side
(`transcript-reducer.ts`), so its half of the rule ships in this repository —
a diverted ask must leave NO trace in the one surface the server does not
filter for the client:

- no in-flight `ask` row while the session's queued engine is live (the row is
  created at settle), and
- at settle, a result carrying `details.ask_gate.hidden: true` paints nothing —
  any row an earlier mode-less frame painted is removed.

## What each frame is

- `diverted-live` — the gate mid-flight, queued engine live: the call is
  announced and running (its frames are folded above the paint) and **nothing
  shows**. Before this change the same fold leaves a running `ask` row up for
  the gate's whole duration.
- `diverted-settled` — the divert itself: the settled frame's result carries
  the marker, the row is dropped, and the pane is the same two rows as above.
  Before this change the row settled showing the decision note
  (`[Ask clearance] No question was put to the user…`) — the leak the marker
  closes.
- `raise-settled` / `raise-settled-expanded` — the receipt half: no marker, so
  the row is created AT settle with the queue's receipt (`asks/render.py`'s
  reachable form) and the arguments the suppressed start still learned. The
  expanded frame is the row's body as a reader opens it.
- `unreadable-live` / `unreadable-settled` — the mixed-build fallback the
  design records (§5, "a brief trace, not persistent"): where the mode cannot
  be read (a core that predates the `asks` field, or a frame that cannot say),
  today's mounting stands — the running row is the flash residual — and the
  settle marker still drops it. Both halves are here because both are claims.

## Provenance — and why the fixtures are wire-shaped

**No released runtime can yet divert an ask**, so there is no live run to
photograph; the core PR is in flight. The frames therefore fold exactly the
shapes the core defines — the live `tool_call_compose` / `tool_execution_start`
/ `tool_execution_end` frames, the `details.ask_gate.hidden` marker, and the
queue's receipt text — through the SHIPPED reducer and paint the SHIPPED
`CanonicalTranscript` (`ask-gate-rows.stories.tsx`; the same evidence contract
`chat-interrupted-rows` states for its marker). When the core lands, these
states are re-shootable from a live run; the fold they pin does not change.

The run, on the tree at `dab518303a0` (this branch, clean — `dirtyWorkingTree:
false`):

```
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-ask-gate-rows --allow-backend
```

`--allow-backend` is the flag's own stated case: the operator's backend was
answering on `:1111`, and these stories render from fixture records and never
call out, so no frame here can show a backend's replies.

Two properties of the pixels worth knowing before judging them:

- **The live rows' clocks are render-relative.** A running row's elapsed figure
  counts to the machine clock at render (the property `chat-trace-order-while-live`
  documents), so the story anchors its instants to `Date.now()` — a frozen
  anchor would photograph a call "running" for weeks by the time anyone reads
  it. The date labels move with the capture for the same reason.
- **The `raise-settled-expanded` body is the shipped row rendering**, argument
  column included (`questions.0.…` flattened by the trace's own args view), not
  a hand-set panel.

## What is NOT framed here

- **A base-tree BEFORE set is deliberately absent.** The pixel difference this
  change removes (the running row; the settled note row) is produced by the
  same fixtures through the pre-change reducer, but that pairing photographs a
  combination no release can ship as a unit: old clients talking to the new
  core keep today's behaviour until they update, and the new client's rule is
  pinned by `scripts/transcript-reducer.test.mjs` (the old-runtime controls) and
  restated here. If a future round wants the pair on disk, it is one narrowed
  run of this same story against the base tree, declared `supplementary`.
- **The child trajectory has no frame.** The same durable fold serves subagent
  pages (served verbatim, design §3 row 7); its surface is the child reader,
  whose visible delta here is the absence of the same row, and the rule is
  pinned by the reducer tests rather than by a still.
