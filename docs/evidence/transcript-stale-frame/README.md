# A stale frame may no longer repaint an older transcript

Evidence for PR #1428 (operator report, 2026-10-26: "the history seems to flicker
between an older state from an agent response some number of turns ago and the
most recent state", on a cold open and again mid-session after sending).

## What is measured, and what is not

This set is a **transcript-commit time series**, which is the standard the report
asked for ("record frames/DOM snapshots at fine intervals, or instrument the store
to log every transcript-state commit with its source and its sequence"). It is not
a screenshot set, and it does not claim to be one: what changed is a state the
reader SEES for one or two commits and then loses, and a still cannot show it.

The series is taken from the **real** renderer path — `[data-record-id]` nodes read
out of the committed DOM after each commit — through the shipped
`useCanonicalSessionStream`, the shipped reducer and the shipped store. The owner at
the far end of the transport is scripted (`scripts/reconnect-page-gap.test.mjs`),
and React, the socket and the clock are the rigs' stand-ins. Nothing between the
frame and the DOM is substituted.

`base-commit-log.txt` and `head-commit-log.txt` are the verbatim `node --test`
outputs at base `5f8c7333` and at the PR head. The four cases are RED on base and
green on head; the assertions' actual/expected values are in the base log.

## The sequence the operator described

The rig delivers, in order: an authoritative snapshot of a 24-row conversation, a
live row (`live-new`), then a **replay `history_delta(reset: true)` whose receipt is
BEHIND the frames already applied** — the shape a reconnect emits when the bridge
re-sends the whole viewport on a stream whose replay did not consume the newer
frames first.

Base `5f8c7333` (the flicker):

```
snapshot-old  old-0 … old-23
live-new      old-0 … old-23, live-new
late-reset    old-0 … old-23                  <- the live row is GONE, the older state returns
```

Head (the fix):

```
snapshot-old  old-0 … old-23
live-new      old-0 … old-23, live-new
late-reset    old-0 … old-23, live-new        <- the stale commit is refused
```

The same reset delivered inside ONE flush (no render between the live row and the
reset) is refused too, so the guard is not a comparison of the last rendered state.

## The other three shapes, each its own defect in the same class

- **A superseded subscription's queued frames** (`a superseded subscription's queued
  frames commit nothing`). A resync opens a new connection inside one session visit;
  the old callback, already handed to the transport, still passed the visit's
  generation check. Base: the dead connection's page rewrote a newer answer
  (`actual: 'x'`). Head: refused. This is also the readings path — the same frame
  carried a different `frontend`, so the context readout moved with it.
- **A page read before a live write** (`a page read before a live write cannot
  rewrite the row, and a later read can`). An owner's prepared window carries its
  `_live_history` row for a message still being written, so a read dispatched before
  the answer settled can state a shorter projection of it. Base: the page replaced
  the finished text. Head: the row carries the live frame that wrote it, the read
  carries the receipt it was dispatched at, and an older read cannot rewrite a newer
  row. A read dispatched AFTER the write still wins — including a correction that
  SHORTENS the answer, which is the case a content test cannot tell apart from a
  stale projection, and round 1 of the review caught exactly that.
- **The same defect at the viewport level** is the first case above.

## Reproduce

```bash
# head
node --test --test-name-pattern='late reset replay|stale reset in the same flush|superseded subscription|page read before a live write' \
  scripts/reconnect-page-gap.test.mjs scripts/transcript-reducer.test.mjs

# base: the PR's tests with base production files
git checkout origin/main -- src/renderer/src/features/chat/canonical/transcript-reducer.ts \
  src/renderer/src/shared/hooks/use-canonical-session.ts src/shared/desktop-session-contract.ts
node --test ...   # same command; 4 failures, actual values in base-commit-log.txt
git checkout HEAD -- src/…
```

## Why there is no browser cell here

A browser cell was attempted by the independent QA lane and is **not** reported as
run: its scripted owner never advanced the shipped hook's receipt, so its
`OBSERVED stale paint` line stayed false and its runs are not evidence of anything.
It is disclosed rather than dropped, and the commit series above is the evidence
this change is judged on. The visible surface itself is unchanged — no new state,
caption, spinner or layout — which the design round confirmed against rendered
Storybook frames (see the PR's design rounds).
