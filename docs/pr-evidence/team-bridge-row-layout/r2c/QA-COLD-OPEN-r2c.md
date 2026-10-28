# Cold picker opens — r2c, 5 fresh page loads at head 9418de0044 (browser tool)

Same instrumented board and method as `QA-COLD-OPEN.md` (fresh JS context per run, so
the glyph-probe cache is empty each time; the board clicks the react trigger as soon as it
exists, `toolbarToClick` = 0 ms in all runs).

| run | clickToNode (ms) | clickToPainted, two rAF (ms) |
|---|---|---|
| 1 | 980 | 2988 |
| 2 | 36 | 1991 |
| 3 | 982 | 2991 |
| 4 | 22 | 2003 |
| 5 | 27 | 1992 |

p50 / max: **commit 36 / 982 ms**; **two-rAF 2003 / 2991 ms**. One extra warm-up load
outside the five measured 78 / 1989.

Combined with the earlier five (`QA-COLD-OPEN.md`: commit 24, 36, 42, 981, 985) the
ten-run commit p50 is 36–42 ms. The max is 980–985 ms in 4 of 10 runs: that is a
bimodal ~1 s stall, not noise.

**The <= 200 ms click->painted gate is NOT closed.** The agent tab is a background
view: rAF callbacks arrive ~1 s apart (two rAF = ~2 s on every run), so no paint time
can be read from this host. The ~980 ms commit outliers match that same ~1 s timer
cadence and may be throttling too, but that is not proven. Re-measure in a
foreground/unthrottled tab (a human-run DevTools Performance trace or the app itself).

Not valid / not claimed: the warm second open (the board's Escape did not close the
popover, `closed:false`, again), so no cold-vs-warm contrast. The grid-growth trace is
empty because the board queried `[role=grid]`, but the picker grid is a
`<table aria-rowcount>`. Measured separately with `browser styles`: the bare picker's
table was 305x4716 px at the first read (~0.1 s after load) and 305x17748 px by
0.44 s, then stable. So growth finishes within ~0.5 s, but no frame catches it midway.
