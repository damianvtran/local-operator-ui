# The transcript's foot row: why the column moved, and why it now cannot

The operator report this directory photographs (2026-09-27):

> "There seems to be a shift issue while anchored to the bottom now in some
> situations, ever since we moved conversations to start with the first message
> at the top of the screen instead of the bottom, sometimes the whole
> conversation including the leading edge shifts up even though we're now in
> the scroll phase where that shouldn't be happening."

## What the frames and traces show

Two fixtures, one rig (`scripts/scroll-shift-evidence.mjs`), photographed on
the same viewport (1380x872), the same tick (50ms), and the same streaming
schedule (30 x 8-word chunks; the young fixture 60 x 8):

- **`tall/`** — the report's exact case: a settled transcript already taller
  than the viewport (12 rows) with a turn started in it. The transcript is in
  the anchored phase for the whole run; `turn-start` is the frame at the turn's
  first scrollable sample, and `pop` is the frame 300ms after the column's
  first settled move.
- **`handover/`** — the young case: 3 rows, shorter than the viewport,
  top-populating, streaming until the content crosses the viewport edge and the
  view flips into the anchored phase. `handover-settled.webp` is the same
  conversation after the turn, in both arms, and the pair is where this fixture's
  shift is visible: the before arm's column DROPPED 29.4px at the turn's end
  (`lead 407.6 -> 437`, frame 185 of the trace), the after arm's leading edge
  never moved. The flip's own frame is byte-identical in the two arms
  (`4b40f8f3...` in both), which is why the committed pair is the settled state:
  the flip is not where this fixture moves.

The `before` arm is this tree with `canonical-transcript.tsx` reverted to the
base (`678f6c5c6`); the `after` arm is the same rig on this change's head.

### The numbers, which are the part a still cannot carry

Per-animation-frame sampling of `scrollTop`, `scrollHeight`, `clientHeight` and
the leading edge's viewport y, over the whole run (`*.trace.json`; the leading
edge is the transcript's last row's bottom edge relative to the scroller):

| run | before | after |
| --- | --- | --- |
| tall, the turn's start | `max|Δlead| = 29.4px` at one frame — `wl appeared`, all 12 rows moved `-29.4..-29.4`, `scrollTop` unchanged | `max|Δlead| = 0` over the whole run — `wl appeared` with no geometry delta |
| tall, streaming appends | rows arrive `-13.0` then `-22.4` per line — growth below the leading edge, no move of settled rows | identical: `-13.0`, `-22.4` per line |
| young, the handover | phase 2: `max|Δlead| = 29.4px` at the turn's end (`wl left`) | phase 2: `max|Δlead| = 11.1px`, bounded by the line's own growth; no step |

The defect is a discrete 29.4px discontinuity in the `lead` trace at exactly
one event — the working line's first mount — and an identical one at its
unmount. 29.4px is that row's own footprint: `GAP.item` 12px + one line. The
handover edits (2026-09-27) fold the slot losslessly into the row's own stack
(the flex column's height plus its leading margin are the same before, during
and after a turn), which is why the after trace shows no discontinuity at
either edge and the young fixture's flip is bounded by its own line growth.
The turn's edges in the young fixture, frame numbers included, are the case a
reader can check against the traces directly: 185 (`wl left`, +29.4 down)
before, 186 (the foot line's text, leading edge fixed) after.

## The fold rounds: the same property, a second trigger

The operator's second report (2026-09-27, evening), verbatim:

> "if you expand an action group, then updates to the conversation like new tool
> calls end up collapsing it as new tool calls load in which for some reason ends
> up in the conversation 'lifting' up past the composer and looking like it's
> shifting up."
>
> "Expanded states of action groups should survive being off screen and updates
> to the conversation. ... they shouldn't be closed/contracted simply by state
> updates if they've been explicitly opened."
>
> "Fixing 1 may solve the problem, but even in that case where they collapse, it
> shouldn't result in the conversation shifting up off screen."

The report carries TWO defects and keeps them separable, so they were measured
and fixed separately - neither stands in for the other.

### 1. The fold's open state

Two mechanisms closed a fold the reader had opened, both measured:

- **The section-end condense.** `trace-fold.tsx` closed the fold once, when its
  section stopped being live - written for the auto-open that no longer exists
  (groups arrive condensed now), which left the READER's own fold as its only
  client. `before/fold-tail.trace.json`: `expanded true -> false` at the turn's
  end, every time.
- **The render window's edge walking the run.** A fold's React key is the first
  row of its run, and only the newest 60 rows mount; every incoming row drops
  the window's oldest, so when that edge crosses a run (`[t1..t4] -> [t2..t4]`)
  React mounted a fresh fold and `useState` was gone. `before/fold-boundary.trace.json`,
  frame 67: `expanded true -> false`, off screen (the fold's box sat 5,000px above
  the viewport).

The fixes: the condense is retired (the reader's press is the only close, in
both directions), and the state is held by the CONVERSATION, not the component
- `fold-open.ts`'s registry answers for a fold's current id set, migrates with
it as ids churn, and resets only on a conversation switch. `after/fold-tail`
and `after/fold-boundary` show the same two transitions with `true -> true`.

**What the FOLDED head changed about how the arms run and what they show
(re-captured 2026-09-29; QA round 2, Q-R2-1).** On main's transcript a finished
turn's rows sit under its summary bar (`turn-summary.tsx`), so the fixture's run
fold now arrives INSIDE that bar, collapsed with it - the boot gate could not
see it and no fold arm could run at all. The rig now presses the bar's own
disclosure once at boot (a reader's gesture, the same disclosure every tool row
taught) so the fold is on screen, the state the arms photograph; and when the
live turn's settle lets the turn re-condense - Q-R2-2's reader-visible
contraction, now recorded in the traces - the driver presses the bar again to
reach the fold, whose state survived. With those two presses the arms run as
before and the transitions read: `after/fold-tail` holds the reader's fold
`expanded true` through every live call (ids `4 -> 10`, rows `4 -> 10` at each
arrival) and finds it restored `expanded true, rows 10` after the settle took
it off screen - the registry's survival, now also across an unmount.
`after/fold-boundary`'s in-place re-key has no counterpart on this head: the
window's edge lands on run boundaries and the run is atomic (its bar groups
it), so the edge takes the run whole - the trace records the walk it does
instead (the front, bar and fold together, leaves the mounted span as the live
rows arrive; nothing re-keys, no `true -> false` anywhere). The traces spell
the bar's own row `<id>#bar`: the bar carries its anchor's `data-record-id`
while the anchor's row still renders, and the suffix keeps the trace's id map
one-to-one (the element pair otherwise reads as a 26px move on every frame).

### 2. The anchored view, when the height change is a collapse

The property is the foot row's (`tall/`, `handover/`), restated: *while the
reader is away from the tail, a layout change anywhere must not move what they
see; the correction lands in the same frame as the change.* What the base tree
did when a fold's body unmounted:

| run | before | after |
| --- | --- | --- |
| `fold-tail/` - expand, calls load, turn's end | the condense closes the fold AND every settled row moves `228.0px` down on that frame (`rows 6 moved 228.0..228.0`, `st 0`) | the fold survives every update (`expanded true`, ids `4 -> 10`); at the turn's end the TURN re-condenses (Q-R2-2): older rows yield `328.6px` in that frame with the leading edge inside `4.0px`, `st 0` - and re-opening the bar restores the fold `expanded true, rows 10` |
| `fold-away/` - the reader scrolled off the tail | the collapse moves every settled row `217.0px` in one frame (`max|delta row| = 217.0`), with Chrome adjusting `scrollTop` by 11px (its clamp), not the 228 the hold needs | the reader's own collapse lands `max|delta row| = 0.00px` - the correction writes `scrollTop -428 -> -200` in the same frame; six notches then move the view exactly `60px` each and it stays where the gesture left it |
| `fold-boundary/` - off screen, edge walks the run | `expanded true -> false` (frame 67) | no re-key to record: the edge takes the run's own bar (fold inside) out whole (`rows 63 -> 54` in the frame), the live calls load into a second fold that is never opened, and no `true -> false` occurs |
| `fold-tail-manual/` - the reader collapses the newest group AT the tail | n/a | re-flushes the pinned column by the body's own `228px` (`rows 7 moved 228.0..228.0`, `st 0`); the residual below |

**What re-anchors today, and what the update was missing.** The only
correction path before this change was the reveal's hold (`holdAnchor`): it
samples the reader's place BEFORE a page/widen this module dispatches, dies on
the reader's own input (`input()` clears it), and expires after
`ANCHOR_HOLD_MS`. A fold's collapse is neither a reveal nor a reader move, so no
sample existed and `correctAnchor` computed nothing. The browser's own
anchoring holds appends below the reader (measured: X grew 22px per live call
with zero row motion) but NOT a collapse below the reader - it adjusted
`scrollTop` by 11px where the hold needed 228, and the viewport jumped. And a
reader's scroll re-anchors nothing app-side: three 60px notches after the jump
moved the view exactly 60px each (no snap, no reset), so the 'scroll resets the
view' the report remembers is the gesture itself - which is exactly why the
state update was the thing that had to start doing what the gesture was
credited with. The standing hold does: the sample re-reads the reader's place
once their gesture settles (`SETTLE_MS`), carries no time bound while they are
away from the tail, and the correction runs on EVERY commit (the collapse is a
commit that changes no row count, which is what the old `rowCount`-keyed effect
missed) plus the ResizeObserver, so the write lands in the change's own frame.

**The residual, stated rather than hidden.** The correction can only re-flush
toward the pinned tail, so a collapse of a group at the bottom moves settled
content by `max(0, body - distance)` - the collapsed body's height less the
reader's distance from the tail, floored at zero: `228.0` at the tail with a
228px body (`fold-tail-manual`, re-captured: `rows 7 moved 228.0..228.0`),
`53.0` at 240px from the tail with a 294px body, `0.00` once the distance
exceeds the body (the re-captured `fold-away` collapse, at 428px from the
tail). Inside
`TAIL_EPS_PX` the correction stands down by design: at the tail the newest
content is pinned, and holding the reader there through a collapse would open
the void between the content and the composer - the 'lifted' look this same
report is about. What remains is the pinned edge holding and the older content
yielding; beyond the body's own height, the full invariant applies.

## The bisect

Both v0.31.3 and v0.31.4 reproduce it, identically: a run of the same rig
against detached worktrees at each tag measures `max|Δlead| = 29.4px` at the
working line's appearance, on both. It is a long-standing interaction between
the turn-boundary row and the scroll anchor that moving conversation start to
the top exposed — not a regression introduced by that change.

## Reproducing

```
node scripts/scroll-shift-evidence.mjs --scenario=NAME --rows=12 --words=50 \
  --chunks=30 --chunk-words=8 --tick=50 --out=/tmp/shift-tall
node scripts/scroll-shift-evidence.mjs --scenario=NAME --rows=3 --words=12 \
  --chunks=60 --chunk-words=8 --tick=50 --out=/tmp/shift-young
```

The fold rounds' arms (one command each; `before` runs against the tree the
branch sat on before the fold commits, with this rig):

```
node scripts/scroll-shift-evidence.mjs --scenario=NAME --pre=6 --words=60 \
  --tools=4 --calls=6 --call-ms=180 --expand=0 --out=/tmp/shift-fold-tail
node scripts/scroll-shift-evidence.mjs --scenario=NAME --pre=6 --words=60 \
  --tools=4 --calls=6 --call-ms=180 --scroll-away=200 --expand=0 \
  --collapse-after=1 --scroll-probe=6 --out=/tmp/shift-fold-away
node scripts/scroll-shift-evidence.mjs --scenario=NAME --pre=2 --words=30 \
  --tools=4 --post=56 --calls=6 --call-ms=150 --expand=0 \
  --out=/tmp/shift-fold-boundary
```

`--tools` plants a consecutive run of calls in the fixture (a foldable group),
`--expand=N` presses the Nth fold AFTER the sampler starts, `--calls=N` plays
the live tool turn through the bridge's `playToolTurn` door, `--collapse-after`
presses the same fold shut once the turn ends, and `--scroll-probe` performs the
reader's notches the repair-path reading above quotes. Every fold transition is
detected and photographed from `window.__shift.foldStates()`, and the per-frame
`folds` column of the trace is the record of them.

On the folded head these command lines are still the whole interface: the
page's boot presses the turn's summary bar once so the fixture's run fold is on
screen (see "What the FOLDED head changed" above), and the driver presses the
bar again after a settle re-condenses the turn - before the collapse probe or
the settled frame would otherwise act on a bar instead of the fold.

The page is served by `scripts/scroll-shift-evidence.vite.mjs` (vite +
`scripts/scroll-shift-evidence.html` + `scripts/scroll-shift-bridge.ts`); run
`node_modules/.bin/vite --config scripts/scroll-shift-evidence.vite.mjs --port
<port>` and pass `--origin=http://localhost:<port>`. The driver writes
`before/crossing/pop/settled` frames, the per-frame trace, and the digest the
table above quotes. `scripts/transcript-foot-slot.test.mjs` is the same claim
as a jsdom assertion: red on the base tree, green on this one.
