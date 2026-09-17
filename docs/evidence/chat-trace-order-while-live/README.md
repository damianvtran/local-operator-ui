# Trace order while live — the extra tool rows an in-flight join paints

Eight frames, one pane per theme per moment per order, showing the defect the
operator reported and what the rule does about it. The session is his own:
`c1c7072b735c`, "Optimize local session load times", read while its turn ran.

## What the report was

Opening that session mid-turn painted a wall of extra `bash` rows **after** the
call the turn was inside, each showing a snippet of the tool's **output** where
the command that ran belongs — the OPENING turn's eight calls, an hour and
several completed turns earlier. The TUI, reading the same session, ends at that
row.

The rows came from the snapshot's `live_events` seed, folded after the durable
page by `applyLiveSeed`. A `tool_execution_end` frame carries no `args` and no
clock, so a row painted from one has no command to show (`knownArgs` can only
recover one from a painted row or from `argsByCall`) and no time to sit at but
the reader's arrival — and the placement rule refused exactly that only when NO
turn was in flight, which is a claim about work applied as though it were about
time. The seed reaches an hour back because the runtime empties `live_events` on
`agent_start`/`agent_end` — the RUN's boundaries, not a turn's — and caps it at
the newest 100 settled calls.

The count is the page/seed gap, never a constant: the page is the newest 100
**entries** while the seed keeps the newest 100 **ends of the run**, so what gets
injected is the ends whose call the page cannot name. At harvest time that was 59
of 100; at the instant the operator looked it was exactly the opening turn's
eight, which the fixture derives rather than assumes (journal records 122..126 —
the page then began one row after that turn's calls). The argument that those
eight are the injected set is the measured `reported.page_names_ghosts: []` — the
page at that moment names none of them — and NOT the uniqueness of their preview
strings: three of the eight occur more than once in the journal
(`__pycache__` seven times), so a search for a preview would over-count.

## These are ONE TREE's frames, not a base/head pair

Both orders are built by this branch from one fixture,
`scripts/fixtures/trace-order.json`, harvested from the real session by
`scripts/harvest-trace-order-fixture.mjs` (its header carries the commands and
every transform):

- the **pre-fix** order is the pre-fix fold spelled out — every seed frame
  applied, nothing refused, including the closing `withTimeOrder` the pre-fix
  body ran whenever any frame stated a clock. That closing sort is load-bearing
  here and not a detail: this seed's last frame is the in-flight
  `tool_execution_start`, which is OLDER than the eight arrival-stamped rows, so
  the sort is what puts the injected rows **below** the running call — the order
  the operator photographed;
- the **post-fix** order is `applyLiveSeed` as the hook calls it.

A pair captured from two trees photographs the fix but cannot be re-captured once
the base moves on; this one can, and the only difference between the halves is
HOW the seed is folded. The story is
`src/renderer/src/features/chat/canonical/trace-order-while-live.stories.tsx`.

## The frames

- **`before-report/`** — the operator's own pane: the running `bash`
  `Finding engage timeouts` sits ABOVE the opening turn's eight `bash` calls,
  which are painted at the reader's arrival (12:47 PM) each showing output where
  its command belongs. The pane's own last rows are the eight — the last of them
  the red `Tool call skipped: interrupted by steering.` — and the running call
  sits immediately above them. The panel under the pane counts every row the fold
  stamped with that arrival (8) and then names them: the `before-report` frame
  prints all eight ids, and prints a `… N more` line when a moment injects more
  than eight, which is what the two `live` frames do.
- **`after-report/`** — the same session, the same page, the same frames through
  the shipped fold: the pane still ends at that call, the injected rows are
  refused, and the arrival list is empty. The eight return as durable rows
  through the tail read the client already fires for the calls the page cannot
  label (`reconcileLimit`) — see "What is derived, not committed" below, because
  that half has a measurement and no still.
- **`before-live/`** — the same rule an hour on, unmodified harvest: 59 unnamed
  ends plus one compose frame, 60 rows stamped with the arrival, and the same
  shape — the running `wait` above them and the fabricated wall as the pane's own
  last rows.
- **`after-live/`** — none of the settled ones. One row is still stamped with the
  arrival: the seed's `tool_call_compose` frame, which never ran (a call whose plan
  the harness rejected has no start and therefore no clock). It is the pane's last
  RECORD row, with the in-flight `wait` immediately above it. That is #312's half
  of the same `else if` chain rather than this change's, and the caption names its
  id instead of counting it away.

**The pane's own liveness element is in every frame.** The transcript stories
pass the app's `waiting` (`canonical.busy`, i.e.
`canonical.frontend.streaming === true`), which is `true` for every moment here —
all four are mid-turn, which is also why the fold may create an arrival row at
all. So each live frame shows the working line under the rows, as a reader saw
it, rather than a mid-turn pane with that line deleted. Two figures beside the
same call disagree by design and not by accident: the running row states the
CALL's execution time while the working line states the AGE OF THE PHASE
(`working-line.tsx`'s own distinction), and both read the machine's clock.

**A reader should note what is *not* claimed:** nothing here says the runtime
still served that seed at the moment the operator clicked (his session is live
and was read, never attached to), the fixture's own transforms truncate text (60
characters per line, three lines, and an over-long argument VALUE is dropped
while its object is kept), and a runtime older than the producer change refuses
these rows rather than placing them — a row missing until `load older`, never a
row in the wrong place.

## What is derived, not committed

- **The refused rows returning through the tail read.** Design round 1 derived it
  against a read-only copy of the session —
  `read_transcript_page(session_dir, before_id=<reported.page[0].id>, limit=300)`
  — which returns 22 entries naming 8/8 of the refused ids at their own instants,
  with `rows stamped at the reader's arrival: 0` and a pane tail pixel-identical
  to `after-report/`. The claim holds on that measurement; there is no still,
  because the committed fixture cannot carry one (`page`, `older` and
  `reported.page` each name 0 of the eight).
- **The "new runtime + old client" cell of the compatibility matrix.** No seed end
  in `trace-order.json` carries `started_at_epoch`, so no frame in this set can
  show a row placed at its own instant by that producer change. The other three
  cells are driven in the PR body's matrix rather than here.

## What is not byte-reproducible, and why

Every frame re-captures within 73 pixels at a 5% fuzz (`magick compare`). The
residual is the one live cell: a running row's elapsed figure counts to the
MACHINE's clock at render, so the pair's two frames state slightly different
figures (e.g. `1h46m` against `1h47m`) and a re-capture of the same commit moves
it. Where the working line is shown, its phase age moves for the same reason, and
it settles at whatever the capture's own shutter delay produced. Nothing else
moves. The frame's own footnote carries both facts, so a reader of the bytes does
not have to find this file.

## Why the pane's height is pinned

The story pins the transcript pane to 685px — the transcript's measured
`clientHeight` in a 1380x900 window, the height a reader actually reads at. A
transcript story with no fixed height lets the capture grow its viewport to the
document, so a still would show a state no reader can be in. Each frame also
carries a fixed-height box naming the rows stamped with the arrival, so the pair
overlays when a reviewer flips between them, and a footnote naming the viewport
the frame was taken in, which is the fact the bytes cannot otherwise carry: 1280
px wide, requested at 1280x800 and floored by the harness to the document's own
height.

## What produced them

Storybook built from this tree, through the repo's own capturer:

```
pnpm exec storybook dev -p 6121 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6121 \
  --only=chat-trace-order-while-live --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

Captured on a **clean tree**, which is what `manifest.json`'s
`dirtyWorkingTree: false` records: the story, its `STORIES` entries, the fixture,
the harvest script and the reducer are all committed at the head the frames were
taken from. `frames` in that manifest is RE-DERIVED from the tree rather than
carried forward by the narrowed pass (see `partialCapture.framesCountNote`), and
`pnpm check-evidence` holds one machine-wide lease — if it defers with exit 75,
another sweep is running and the check has to be retried rather than forced.
