# Cold picker opens — 5 runs at head 9418de0044 (browser tool)

Method: story-scoped static build of head `9418de0044`; five **fresh page loads** of one
instrumented board (`R2/Head -> ColdPickerRun`), each a new JS context, so the module-level
glyph-probe cache is empty in every run (genuinely cold, no warm corpus). The board
dispatches pointerdown/pointerup/click on the row's react trigger the moment it exists
(measured `toolbarToClick` = 0 ms in all five), then times to the popover node
(`clickToNode`, a React commit) and two `requestAnimationFrame`s later (`clickToPainted`).
Scratch only: the reactions hold was opened **for this scratch build** via a runtime flag;
source keeps `TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD = false`.

| run | clickToNode (ms) | clickToPainted (ms) |
|---|---|---|
| 1 | 985 | 3001 |
| 2 | 24 | 2009 |
| 3 | 36 | 1993 |
| 4 | 42 | 2002 |
| 5 | 981 | 2989 |

p50 / max: **commit 42 / 985 ms**; **two-rAF 2009 / 3001 ms**.

**The two-rAF figure is not usable as a latency claim.** It is dominated by frame
throttling in an occluded/background tab: `clickToNode` lands at 24–42 ms and the next two
`rAF` callbacks then take ~2 s, i.e. ~1 s per frame. Declared gate is click -> painted
<= 200 ms, so the gate is **NOT closed** here: the commit hop p50 is 42 ms and its max 985 ms,
and no frame-free way exists in this harness to certify a *paint*.

Not measured / not claimed: warm second open (the Escape close did not take —
`closed:false` — so the warm pass is invalid and no cold-vs-warm contrast is asserted);
a mid-probe still; per-probe canvas cost. The transient (grid, height and `aria-rowcount`
growing after first paint) is unphotographed.

Consequence: the reaction picker is held in this build, so no user sees any of this yet; the
PR's own "cold-open <= 200 ms" merge condition stays **open**, to be re-measured on a quiet
host with an unthrottled (foreground) tab.
