# Phantom compose rows: calls the harness never ran

The report was "switching into a conversation that is waiting on several
subagents/jobs shows, at the bottom of the transcript, several highlighted rows
reading `hub composing 2.0 KB`, `wait composing 82 B`, `wait composing 77 B`,
`wait composing 87 B`, all stuck for the whole multi-hour `wait`, on top of the
one `wait` call that is genuinely in flight." The session was `8f8660fb8e64`
("Risk Assessment Email Not Specific") and the four rows were calls the harness
NEVER RAN: all four `tool_call_compose` frames carry `not_run_reason`
(`Invalid arguments: arguments are not valid JSON: …`) and `dictation_complete`,
and deliberately no `tool_execution_start`/`_end`, because the API server pairs
tool records by id and a synthetic start would claim the tool ran.

## What the fix does, in one paragraph

The compose contract has THREE endings and the client implemented none of them:
a verdict (`not_run_reason` — the call will never run), a finished dictation
(`dictation_complete` — the call waits to run), and identity promotion
(`supersedes_tool_call_id` — this frame and the placeholder frames are one call).
A row settled by a verdict or by a turn that ended while the call was still being
dictated or queued says `never sent · N composed`, in place, with no clock and no
duration; a call waiting to run says `queued · N B`, and the band that names it
carries NO number; and a frame whose dictation is over is never placed at the
reader's own arrival when it would create a row.

## The frames: a real base/head pair

**`before/`** — ten frames from the BASE tree (`318cbb75e`), the same states
folded by the code that was shipping:

- **`before/arrival/`** — the report as pixels: four `composing` rows carrying
  the frames' byte counts, at the reader's own arrival, under a conversation
  whose real rows are hours old. The genuinely running `wait` row sits ABOVE
  them, because the base fold sorts through `withTimeOrder` as soon as one frame
  states a clock.
- **`before/settled/`** — the verdict folding onto the row its own announcement
  left; the row goes on saying `composing`, with nothing that could ever settle
  it.
- **`before/queued/`** — the dictation ending on the same row, same result.
- **`before/queued-seeded/`** — the sibling ending arriving with NO row on
  screen: a banded `composing` row created at the reader's arrival.
- **`before/turn-death/`** — a TURN ending on a call that was still being
  dictated. The base tree marks the row settled, and with no output, no duration
  and no stop its ladder reads that as a SUCCESS: the frame is a green tick on a
  call no tool ever received. This pair was added by the round-1 remediation,
  because the fix for it is a rendering claim and a rendering claim needs pixels.

**`after-*`** — twenty frames from this branch, the same states folded by the
shipped reducer, plus the states the fix introduces:

- **`after-arrival/`** — the four verdicts refused, so the pane ends on the one
  `wait` call that really is running, at the instant the producer stamped for it.
- **`after-settled/` / `after-settled-open/`** — the verdict settling the row its
  own announcement left: `never sent · 2.0 KB composed`, clockless, durationless,
  and the opened frame shows the harness's own words under a `Not run` label.
- **`after-settled-empty/`** — a never-run call that composed NOTHING, where the
  summary names the absence (`never sent · nothing composed`) rather than
  measuring it as `0 B`. Built on the live path, which is how such a row exists:
  seeded, a clockless verdict is refused (see the placement rule).
- **`after-settled-narrow/`** — the same row at a 420px column. The summary is
  eleven characters longer than the `composing` one it replaced, so what it does
  under width pressure is part of the change: it ellipsises, keeping
  `never sent` and shedding the byte count's tail.
- **`after-queued/`** — the dictation ending as the shipped fold states it:
  `wait queued · 109 B` on the row and `waiting to run a call` on the band, with
  NO clock. The number used to tick from the phase edge, which after a seed is the
  viewer's own mount; the TUI withholds it for this rung (`clock=False`) and so
  does this row now.
- **`after-queued-seeded/`** — the sibling ending seeded, with no row on screen:
  refused, so nothing claims the reader's arrival as the call's time.
- **`after-durable-twin/` / `after-durable-twin-open/`** — the call's own durable
  row IS loaded: a settled row has outgrown the announcement, so the verdict
  leaves it as the transcript recorded it, wearing the failure treatment a real
  failed call has. That is the point of the opened frame: `Not run` is the LIVE
  path's label, and the durable row is a call the harness did send and that came
  back an error.
- **`after-turn-death/`** — the third ending: `never sent · 1.9 KB composed` with
  the interrupt's own glyph, no clock and no duration. The tick this replaces is
  in the `before` half, one line up.

## The `before` half's recipe

The before frames cannot come from this tree — a sweep captures the current tree,
so a `before` taken here photographs the fix (the first pass of this set did
exactly that; agent review round 1 caught it by bundling the base tree and
running the real pre-fix reducer over the committed fixture).

```
# in a detached worktree at the base commit, with the fixture and the before
# story file copied in, that worktree's node_modules cloned (cp -Rc), and the
# four ids added to its SCRATCH copy of the STORIES table:
git worktree add --detach ~/local-operator-ui-worktrees/phantom-before-base 318cbb75e
cd ~/local-operator-ui-worktrees/phantom-before-base
cp -Rc <this worktree>/node_modules node_modules
cp <this worktree>/scripts/fixtures/phantom-compose-rows.json scripts/fixtures/
cp <this worktree>/src/renderer/src/features/chat/canonical/phantom-compose-rows-before.stories.tsx \
   src/renderer/src/features/chat/canonical/
pnpm exec storybook dev -p 6042 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6042 \
  --only=chat-phantom-compose-rows-before \
  --themes=localOperatorDark,localOperatorLight --allow-backend
# then the four leaf directories move under chat-phantom-compose-rows/before/,
# which manifest.json declares as a supplementary set whose `source` is this
# recipe and whose citation is 318cbb75e.
```

`phantom-compose-rows-before.stories.tsx` is committed on this branch so the run
is reproducible, and it is deliberately NOT in the capture `STORIES` table:
running it here would render this tree's reducer under a `before` name.

## The placement rule, and why

**A seeded compose frame whose dictation is OVER — a verdict, or
`dictation_complete` — is never placed at the reader's arrival, whether or not a
turn is in flight.** The in-flight exemption exists because a live clockless
announcement describes a call being dictated RIGHT NOW: the viewer's arrival is a
wrong number but a true ordering, and the alternative is a mid-turn join that
shows nothing. Both settled-dictation endings say the opposite — the model has
stopped writing this call, so what happens next (a wait behind a sibling's
execution group, a start elsewhere in the batch, or nothing at all) is not at the
reader's arrival. Dating them there is precisely what produced the report: four
rows riding the persisted in-flight seed into every conversation switch.

The call's durable row is the authority and the client paints it IN PLACE when
the durable read reaches it, with the record's own time — the one thing these
frames cannot state. That promise needs the read to be SIZED for these calls
(`seedCallsMissingLabels` now names them, and they have no end event to be named
by), and it is a bounded tail read, so a call older than its bound comes back
through the reader's own `load older`.

A frame whose record is ALREADY painted is folded whatever the clock and whatever
it says: that settles a row the reader can see without moving any row.

## The fixture is the real session

`scripts/fixtures/phantom-compose-rows.json`: the four never-run frames and the
in-flight `tool_execution_start` are **verbatim** from the read-only snapshot of
`8f8660fb8e64` (`GET /v1/desktop/sessions/8f8660fb8e64`, captured at
1789652393). Its own `note` says which parts are constructions — the durable page
is a minimal reconstruction of the snapshot's history-window tail (the pack
carries the window's boundary timestamps, not its 100 rows), `pageWithTwin`
re-dates one real `Invalid arguments` tool row from the same session into that
window so the settle-in-place case is on screen, and the queued frame is shaped
from the `ToolCallComposeEvent` contract because that session emitted none. The
same frames are pinned by `scripts/tool-compose-lifecycle.test.mjs`.

## Why the pane's height is pinned

The story pins the transcript pane to 685px — the transcript's measured
`clientHeight` in a 1380x900 window, the height a reader actually reads at — so
the frames are what a reader is looking at. The transcript's scroller is
`flex-col-reverse`, so a fixed-height box with no scroller of its own is what
lands the reader at the BOTTOM, on the newest rows; without the pin the capture
grows its viewport to the document and paints a state no reader can be in. The
captions sit in a fixed two-line box so the two frames of a pair overlay when a
reviewer flips between them. The narrow frame is captured at 420x800 because the
column, not the pane, is what it is about.

## What produced the `after-*` frames

```
pnpm exec storybook dev -p 6041 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6041 \
  --only=chat-phantom-compose-rows \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

Both runs are the repo's own capturer: it drives a private headless Chrome over
CDP, never macOS `screencapture`, and never takes the operator's focus.

## What the numbers in these frames are, and are not

- **The in-flight clock in a `before`/`after` pair is the CAPTURE's wall clock,
  not a state.** `before/arrival` and `after-arrival` show the same running
  `wait` call at different ages, because the stories render elapsed time from the
  record's stated start (the fixture's own `historyWindow.lastTs`) against
  `Date.now()`: the two halves were taken twenty-odd minutes apart. Every other
  number in the pair is the fix's; that one is the shutter's (agent review
  round 2, N2). The `before`/`after` `turn-death` pair differs outside its
  caption for the same class of reason: the re-take moved glyph antialiasing and
  nothing else — visually identical, and only the caption's number is a change of
  meaning. (An earlier spelling of this bullet quoted a pixel count for that
  difference; it is dropped rather than restated, because it was not reproducible
  from the frames this set ships.)
- **The working line above a RUNNING call dates the batch's oldest SURVIVING
  start, not the reader's arrival, and it follows that start when it MOVES.**
  The rung's clock is anchored at the oldest of the live records' own starts —
  the TUI's `clock_from` rule — and `after-durable-twin-open` is the frame that
  shows it: the row reads `wait 3000000 · 8h36m` and the line under it reads
  `… 8h36m` where it used to read `0s` (UX round 2, U5). Both numbers are the
  frame's own, at this capture: the age is `now` minus the fixture's stated start,
  so it moves with the shutter and it is the SAME number on the two surfaces that
  matters, not the value. SCOPE OF THE CLAIM: the anchor moves as the batch
  changes, and the three cases where it does — the oldest call settling under a
  newer survivor, an earlier-starting call arriving late, and the anchor being
  WITHDRAWN when an undateable card joins — are pinned by
  `scripts/working-line-clock.test.mjs` (the four tests this branch adds to
  main's own clock suite), not by a frame. No frame in this set mounts through
  any of them, so the frames show the anchored state and the tests carry the
  moving one; say so rather than reading "one age" as covering a batch whose
  membership changes mid-view.
- **The `thinking` line is now anchored to the producer's own fold, which is
  parity with the TUI rather than a divergence from it.** Main's #310 added
  `foldedSeed(phase)` (`working-line-model.ts`): when the fold the wire carries
  names the same phase this ladder derived, the row is seeded with the producer's
  own `activity_phase_started_at`, which is the rule the TUI applies
  (`_folded_phase_epoch`, falling back to its own phase zero only for the
  compaction/retry labels it does not model). An earlier spelling of this bullet
  said this app had no folded phase instant to read; that was true of the base
  this set was cut from and is false on this one. WHAT REMAINS A DIVERGENCE, and
  is recorded rather than fixed here: where the anchor is ABSENT, main's row
  falls back to its own local zero (the mount's age — pinned deliberately in
  main's clock suite), and where it is WITHDRAWN mid-phase main's consumer kept
  the STALE anchor, both of which the TUI answers by withholding the number
  (`_current_activity`'s `dateable`). The anchor-loss half is this branch's to
  fix and it withholds there; the never-stated half stays main's local zero, so
  the divergence that remains is exactly that one state.
- **The durable-twin frames cannot show the one channel they are compared on.**
  The twin's `hub` row ends where the comparator's failed row carries a duration
  (`0.2s`), because the fixture's `role: tool` reconstruction carries no timing
  fields: the absence is the fixture's, not a difference in treatment (design
  round 2, D7). Word, ground, name ink and glyph are the comparison, and they
  match.

## What this set does not claim

- `pnpm check-evidence` was run and **DEFERRED** (exit 75 — the machine-wide
  sweep lease is held by another lane's sweep; at the last check it was the
  `chat-link-affordances` lane's `scripts/check-evidence.mjs` process with a live
  `magick` child, and earlier in the same session it was the `mark-all-read`
  lane's, so the LANE ROTATES and the stable fact is the lease rather than a
  pid). The lock is never deleted or reclaimed by pid or age. The frame counts,
  the stamps and the `partialCapture` tally are therefore verified by the fast
  half instead (`node --test scripts/evidence-manifest.test.mjs`,
  34/34), which asks the gate's own questions about this manifest, and by
  re-reading the swept count off the tree with the gate's own exclusion.
- The `before` frames are of the BASE tree and stay `composing`-shaped by
  definition: they are evidence of what was, not of what now ships.
- `after-settled-narrow/` clips the summary to `never sent · 2…`, which is the
  app's own idiom (the comparator's `chat-tool-rows/narrow` cuts long paths the
  same way) and, at that width, the word the copy exists for survives. It reads
  worse than the comparator's examples for one reason worth recording rather than
  fixing here: a cut path is still a path, while a cut byte count is a number
  with no unit (design round 2, D8). Changing the shed order is a
  summary-composition change and belongs with the row's width policy, not with
  this fix.
- The row's WORD for a turn-death settlement is `interrupted` on both arms. The
  TUI distinguishes a turn's own end (`cut off`, passed by `_finalize_turn`) from
  a teardown (`interrupted`), and this surface has only the `agent_end` path, so
  it keeps the historical word. Adding a third outcome for it is a small change
  and deliberately not in this round: it needs a decision about which UI path is
  a cut-off, and the frame pair above is about the tick, not the noun.
