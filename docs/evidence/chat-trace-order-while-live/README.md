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
  prints all eight ids and no `… N more` line, and a `… N more` line appears only
  on a moment that injects more than eight — which is `before-live` alone (60
  rows, eight ids and `… 52 more`). `after-live` injects none and prints its
  header alone, with no more-line, so the sentence that named "the two `live`
  frames" was one frame too wide (design round 2, D2-4).
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
- **`after-live/`** — none at all, since the fold onto #312. The seed's
  `tool_call_compose` frame — a call whose plan the harness rejected, so it has no
  start, no end and therefore no clock — used to be the one row still stamped
  with the arrival, sitting under the running `wait`; it is now refused with the
  settled ends, so the panel reads `rows stamped at the reader's arrival: 0` and
  the pane's last record row is the turn's in-flight `wait`. Both halves are ONE
  rule rather than two: a frame that states no time has no position the reader can
  be given, and the settled end is this change's while the finished dictation is
  #312's. The caption still names the compose row's id, because the row ITSELF is
  what moved.

**Each caption is held to TWO lines, and that is a constraint rather than a
style.** The box above the pane is `h-10` — two lines of `text-body-sm` at its 1.5
line-height — and it has no `overflow-hidden`, so a longer caption does not
clip: it PAINTS BELOW ITS OWN BOX and inside the transcript's rectangle.
`after-live`'s ran to three lines from `ccbf45a61` until remediation round 2
shortened it (design round 2, D2-1; the third ink band measured (67,79) against a
box ending at 64 and a pane starting at 72, in both themes), and the two halves
of a pair have to wrap to the same number of lines for the pair to overlay at
all. At a 420px column the same text needs five to seven lines — five at a 468px
viewport and six at a 420px one, where the caption's own column is 372px — and
`after-live` is the worst of them at seven lines (six at the 468px viewport),
its box scrolling at 117/137 against 40 (design round 3, D3-2). That is why this
set still carries no narrow frame: the gap is recorded rather than papered over
with a frame invented for it.

**The pane's own liveness element is in every frame.** The transcript stories
pass the app's `waiting` (`canonical.busy`, i.e.
`canonical.frontend.streaming === true`), which is `true` for every moment here —
all four are mid-turn, which is also why the fold may create an arrival row at
all. So each live frame shows the working line under the rows, as a reader saw
it, rather than a mid-turn pane with that line deleted. The running row's
elapsed figure and the working line's age read the SAME anchor — the call's own
producer stamp (`working-line-model.ts`'s all-or-nothing `startedAt`, PR #310) —
so the two figures agree rather than disagree, and both count to the machine's
clock at render. Design round 1's D3 found them disagreeing (the row's `2h37m`
against the line's `4s`) on the pre-#310 base, where the line restarted at the
reader's arrival; these frames are the folded base's resolved state.

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

Every frame re-captures with its pixel differences confined to the TWO cells that
read the machine's clock at render — the running row's elapsed figure and the
working line's age — and how far they move is a function of the GAP between the
captures rather than a property of the commit, so the number belongs to the gap
and not to the frame. One pixel of one pair is the exception, and it is named
because this sentence is the one a reader checks the frames with: in the light
`after-live` frame of the round-3 re-stamp a single glyph-edge pixel sits outside
the cells, which is encoder rounding at a descender rather than content, and the
six-frame sentence below is exact at 0 px (design round 3, D3-3). Measured at a 5%
fuzz (`magick compare -metric AE`), each re-capture against the committed bytes of
the head it was taken at:

| re-capture | gap | residual, both themes |
| --- | --- | --- |
| design round 2 (`af1b1cd70`) | ~42 min | 122–236 px of 1,308,160 |
| QA round 2 (`af1b1cd70`) | hours | 116–324 px, the dark pair 156/161 |
| remediation round 2, on the folded base | ~90 min | 87–170 px over the six frames this round does not change |
| remediation round 3, re-stamp on the folded tree (`3d7b9e940`) | not recorded | 49–148 px over all eight, the clock alone |

The set said "within 73 pixels" until design round 2's D2-2 measured it; 73 was
never a bound those cells could hold. The third row of the table is the six of
this set's eight frames whose CONTENT that round does not change; `after-live` is
excluded from it, and it is excluded because it moved TWICE for two different
reasons, which is why neither number may be quoted for the other event (design
round 3, D3-1): the caption rewrite (`af1b1cd70` → `8567ffb5d`, D2-1) moved
**12,139 px dark / 12,287 px light**, and the fold onto #312 that re-took the
frame (`8567ffb5d` → `3d7b9e940`) moved **48,502 px dark / 63,734 px light**. The
second is the larger by four times, it is the one the earlier wording's "~12,000"
understated, and the theme has to be named because the two themes' figures differ
by a third. Every differing pixel on the six sits inside the two cells and
nowhere else, which is the property the frame's own
footnote states — the pair count to the same anchor and move together: `4h10m` in
the committed bytes against `4h52m` in a re-capture 42 minutes later, and the two
figures agree inside each frame. Nothing else moves, and the line no longer
re-bases to the reader's arrival, which is why the two figures agree on this
base. The frame's own footnote carries the fact, so a reader of the bytes does
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
