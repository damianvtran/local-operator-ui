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

The page is served by `scripts/scroll-shift-evidence.vite.mjs` (vite +
`scripts/scroll-shift-evidence.html` + `scripts/scroll-shift-bridge.ts`); run
`node_modules/.bin/vite --config scripts/scroll-shift-evidence.vite.mjs --port
<port>` and pass `--origin=http://localhost:<port>`. The driver writes
`before/crossing/pop/settled` frames, the per-frame trace, and the digest the
table above quotes. `scripts/transcript-foot-slot.test.mjs` is the same claim
as a jsdom assertion: red on the base tree, green on this one.
