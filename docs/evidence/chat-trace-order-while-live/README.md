# Trace order while live — the extra tool rows an in-flight join paints

Eight frames, one pane per theme per moment per order, showing the defect the
operator reported and what the rule does about it. The session is his own:
`c1c7072b735c`, "Optimize local session load times", read while its turn ran.

## What the report was

Opening that session mid-turn painted a wall of extra `bash` rows after the call
the turn was inside, each showing a snippet of the tool's **output** where the
command that ran belongs — the OPENING turn's eight calls, an hour and several
completed turns earlier. The TUI, reading the same session, ended at that row.

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
the page then began one row after that turn's calls).

## These are ONE TREE's frames, not a base/head pair

Both orders are built by this branch from one fixture,
`scripts/fixtures/trace-order.json`, harvested from the real session by
`scripts/harvest-trace-order-fixture.mjs` (its header carries the commands and
every transform):

- the **pre-fix** order is the pre-fix fold spelled out — every seed frame
  applied, nothing refused, which is literally what the pre-fix `applyLiveSeed`
  did;
- the **post-fix** order is `applyLiveSeed` as the hook calls it.

A pair captured from two trees photographs the fix but cannot be re-captured once
the base moves; this one can, and the only difference between the halves is HOW
the seed is folded. The story is
`src/renderer/src/features/chat/canonical/trace-order-while-live.stories.tsx`.

## The frames

- **`before-report/`** — the operator's own nine rows: the pane ends at the call
  the turn was inside (`bash`, `Finding engage timeouts`, 12:46:39) and the
  opening turn's eight `bash` calls are painted under it at the reader's arrival
  (12:47 PM), each showing output where its command belongs. The panel under the
  pane lists all eight ids the fold stamped with that arrival, so the injected set
  is named rather than described.
- **`after-report/`** — the same session, the same page, the same frames through
  the shipped fold: the pane still ends at that call and the arrival list is
  empty. The eight rows return as durable rows through the tail read the client
  already fires for the calls the page cannot label (`reconcileLimit`).
- **`before-live/`** — the same rule an hour on, unmodified harvest: 59 unnamed
  ends plus one compose frame, 60 rows stamped with the arrival, in one pane.
- **`after-live/`** — none of them. One row is still stamped with the arrival:
  the seed's `tool_call_compose` frame, which never ran (a call whose plan the
  harness rejected has no start and therefore no clock). That is #312's half of
  the same `else if` chain rather than this change's, and the caption names its
  id instead of counting it away.

A reader should note what is **not** claimed: nothing here says the runtime still
served that seed at the moment the operator clicked (his session is live and was
read, never attached to), the fixture's own transforms truncate text (60
characters per line, three lines, and an over-long argument VALUE is dropped
while its object is kept), and a runtime older than the producer change refuses
these rows rather than placing them — a row missing until `load older`, never a
row in the wrong place.

## Why the pane's height is pinned

The story pins the transcript pane to 685px — the transcript's measured
`clientHeight` in a 1380x900 window, the height a reader actually reads at. A
transcript story with no fixed height lets the capture grow its viewport to the
document, so a still would show a state no reader can be in. Each frame also
carries a fixed-height box naming the rows stamped with the arrival, so the pair
overlays when a reviewer flips between them.

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
taken from.
