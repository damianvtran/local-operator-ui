# The composer's active-time reading while a turn runs — the before half

The operator's report is that the session duration disappears from the composer
exactly while the agent is working. This set is the **before** half of the pair
that shows it: the shipped `MessageInput`, in the composer's two states, at nine
column widths and in both themes, with the readings cluster in the operator's own
fixture (`reported`) and in the widest fixture (`fullest`).

The defect, for a reader who has not opened the file: the duration reading's own
class name is `hidden` whenever `controlsThirdBox` is true, and
`controlsThirdBox` is `Boolean(canonicalStop?.active) || interruptSlotDrawn`
(`message-input.tsx`). A running turn therefore hides the reading at EVERY
width — not only in the narrow band the class's other half
(`@max-[860px]/chatcol:hidden`) covers. The strip is the only renderer of
`active_duration_s`, so the number is shown nowhere in the app while it ticks.

## Where the frames came from

One temporary worktree, detached at this branch's base, **`2f5d8e3239`**
(`.worktrees/cdr-base`), sharing the primary checkout's `node_modules` through
the same relative symlink. The rig was copied into it from the branch, so both
halves of the eventual pair are taken by the same rig bytes rather than by two
trees that each own a story. The copy differs from the base revision's committed
rig by the `reported` fixture and the comments that introduce it — no expression
in the probe, the driver's case loop or the harness's existing fixtures changed.

The default-measure set is one run:

```sh
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --only=reported,fullest \
  --widths=480,700,798,853,854,860,908,1024,1200 \
  --out=<this-worktree>/docs/evidence-frames/composer-duration-running/before \
  --label=before
```

The rig writes one row-sized crop per case per theme plus `numbers.json` from
the same DOM; the committed frames are those PNGs converted losslessly enough
for review with `cwebp -q 88 -m 6`, renamed to `<case>/<theme>.webp` so each
frame names its own theme (the walker in `scripts/check-evidence.mjs` derives
the expected ground from that name). The frames themselves are rig output in the
ignored `docs/evidence-frames/` tree and are not committed; `before/frames.txt`
lists the 72 paths they occupy.

72 frames = 2 states (`idle`, `running`) × 2 fixtures (`reported`, `fullest`) ×
9 widths × 2 themes, plus a second run at the operator's widened measure (`918`,
below) adding 64 frames = 2 states × 2 fixtures × 8 widths × 2 themes. 136
frames in all. `localOperatorDark` and `localOperatorLight` are numerically
identical in every cell, so the tables below list one row per case.

## The operator's row

`reported` is the operator's own state: display name `DeepSeek Flash`, effort
`Max`, a measured `13.1%/1M` context reading, `$0.346` of cumulative spend and
20m25s banked. The row it renders is exactly the reported one:

```
DeepSeek Flash · Max · 13.1%/1M · $0.346
```

with `20m25s` beside it in the idle state above container 860, and absent in the
running state at every width. `fullest` is the harness's existing widest state
(`claude-sonnet-4-5` at its floor, `66.0%/400k estimate`, `$190.85`, `20h`), kept
so the before half covers the state the threshold arithmetic has to satisfy.

## Measured

Cluster = the readings strip's own box. Controls = the mic/Stop/Send group.
Gap = controls' left edge minus the strip's right edge; the row rests on a 2px
cushion whenever it is tight, because the cluster carries `-mx-1.5`, so a gap of
2.0 is "touching", never "overlapping". "Duration laid out" is a non-zero box on
the duration reading; a shed reading measures 0×0 because the shed is
`display: none`.

| case | col | cluster | controls | gap | duration laid out |
| --- | --- | --- | --- | --- | --- |
| idle-fullest | 480 | 120.1 | 60.0 | 53.7 | no |
| idle-fullest | 700 | 244.0 | 68.0 | 2.0 | no |
| idle-fullest | 798 | 342.0 | 68.0 | 2.0 | no |
| idle-fullest | 853 | 397.0 | 68.0 | 2.0 | no |
| idle-fullest | 854 | 398.0 | 68.0 | 2.0 | no |
| idle-fullest | 860 | 401.6 | 68.0 | 2.4 | no |
| idle-fullest | 908 | 402.0 | 68.0 | 2.0 | yes |
| idle-fullest | 1024 | 401.0 | 68.0 | 2.0 | yes |
| idle-fullest | 1200 | 401.0 | 68.0 | 2.0 | yes |
| idle-reported | 480 | 102.9 | 60.0 | 70.9 | no |
| idle-reported | 700 | 196.7 | 68.0 | 49.3 | no |
| idle-reported | 798 | 293.7 | 68.0 | 50.3 | no |
| idle-reported | 853 | 293.7 | 68.0 | 105.3 | no |
| idle-reported | 854 | 293.7 | 68.0 | 106.3 | no |
| idle-reported | 860 | 293.7 | 68.0 | 110.3 | no |
| idle-reported | 908 | 353.1 | 68.0 | 50.9 | yes |
| idle-reported | 1024 | 353.1 | 68.0 | 50.0 | yes |
| idle-reported | 1200 | 353.1 | 68.0 | 50.0 | yes |
| running-fullest | 480 | 120.1 | 92.0 | 21.7 | no |
| running-fullest | 700 | 120.1 | 104.0 | 89.9 | no |
| running-fullest | 798 | 306.0 | 104.0 | 2.0 | no |
| running-fullest | 853 | 361.0 | 104.0 | 2.0 | no |
| running-fullest | 854 | 362.0 | 104.0 | 2.0 | no |
| running-fullest | 860 | 366.0 | 104.0 | 2.0 | no |
| running-fullest | 908 | 366.0 | 104.0 | 2.0 | no |
| running-fullest | 1024 | 365.0 | 104.0 | 2.0 | no |
| running-fullest | 1200 | 365.0 | 104.0 | 2.0 | no |
| running-reported | 480 | 102.9 | 92.0 | 38.9 | no |
| running-reported | 700 | 102.9 | 104.0 | 107.1 | no |
| running-reported | 798 | 256.0 | 104.0 | 52.0 | no |
| running-reported | 853 | 293.7 | 104.0 | 69.3 | no |
| running-reported | 854 | 293.7 | 104.0 | 70.3 | no |
| running-reported | 860 | 293.7 | 104.0 | 74.3 | no |
| running-reported | 908 | 293.7 | 104.0 | 74.3 | no |
| running-reported | 1024 | 293.7 | 104.0 | 73.3 | no |
| running-reported | 1200 | 293.7 | 104.0 | 73.3 | no |

### The duration's own width

The rig cannot photograph "duration absent while the other four readings are
present" in the idle state, because the defect itself is the absence — so the
duration's box is measured in the `idle` cells where it IS laid out, and the
`running` gap is measured with it absent. Both are from the same DOM the frames
show.

| text | width | where measured |
| --- | --- | --- |
| `20m25s` | 55.4px | idle-reported at 908/1024/1200 |
| `20h` | 33.7px | idle-fullest at 908/1024/1200 |

The readings' own horizontal gap is **4.0px**, derived from adjacent boxes
(`cost.right` 823.7 → `duration.left` 827.7 in idle-reported at 1024).

That makes the fit arithmetic in the operator's own row:

- `running-reported` at 1024/1200: cluster 293.7, gap 73.3. Adding `20m25s`
  costs 55.4 + 4.0 = 59.4, so the five reading set measures 353.1 — exactly the
  idle cell for the same fixture — and clears the controls by 13.9px.
- `running-reported` at 700: only the model is visible (102.9), because the
  shipped ladder sheds effort, context and cost with the third box. The gap of
  107.1 is measured against today's three-reading cluster, not a post-fix one.
- `running-fullest` at 1024: cluster 365.0, gap 2.0 (the row's cushion). `20h`
  costs 37.7, and the model chip has only 27.5px of shrink left before its 56px
  floor, so the duration cannot be added to this row without giving up another
  reading.

## The operator's widened measure

The composer box is capped at `--lo-chat-measure` — 810px shipped — so the row's
width is `min(column − 48, measure)`, not a function of the column once the cap
binds. The operator's own composer box measures **918px**, which makes their row
~886px where the shipped default draws 778px at the same 1024px column. That is
why a static threshold is wrong for this row: a dragged or widened measure moves
every fit point.

The second run sets the same custom property the app's own story sets
(`chat-measure.stories.tsx`), on the harness column:

```sh
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --only=reported,fullest --measure=918 \
  --widths=700,798,853,854,860,908,1024,1200 \
  --out=<this-worktree>/docs/evidence-frames/composer-duration-running/before \
  --label=before
```

(The 480px rung is omitted: the 918px cap cannot bind below a 966px column, so
that cell would duplicate the default one.) A measure-918 case carries `-m918`
in its id, so the two runs cannot overwrite or be mistaken for one another.

`spare` below is the fit room for the duration in the RUNNING row, read the way
a measured rule reads it: `G − (D + 4)`, where `G` is the gap from the last
visible non-duration reading to the controls, `D` is the duration's own measured
width, and `4` is the readings' gap. Positive means the duration would fit.

| case | col | cluster | controls | G | spare | duration laid out |
| --- | --- | --- | --- | --- | --- | --- |
| running-reported | 700 | 102.9 | 104.0 | 107.1 | 47.7 | no |
| running-reported | 798 | 256.0 | 104.0 | 52.0 | -7.4 | no |
| running-reported | 853 | 293.7 | 104.0 | 69.3 | 9.9 | no |
| running-reported | 854 | 293.7 | 104.0 | 70.3 | 10.9 | no |
| running-reported | 860 | 293.7 | 104.0 | 76.3 | 16.9 | no |
| running-reported | 908 | 293.7 | 104.0 | 124.3 | 64.9 | no |
| running-reported | 1024 | 293.7 | 104.0 | 181.3 | 121.9 | no |
| running-reported | 1200 | 293.7 | 104.0 | 181.3 | 121.9 | no |
| running-fullest | 700 | 120.1 | 104.0 | 89.9 | 52.2 | no |
| running-fullest | 798 | 306.0 | 104.0 | 2.0 | -35.7 | no |
| running-fullest | 853 | 361.0 | 104.0 | 2.0 | -35.7 | no |
| running-fullest | 854 | 362.0 | 104.0 | 2.0 | -35.7 | no |
| running-fullest | 860 | 368.0 | 104.0 | 2.0 | -35.7 | no |
| running-fullest | 908 | 401.6 | 104.0 | 16.4 | -21.3 | no |
| running-fullest | 1024 | 401.6 | 104.0 | 73.4 | 35.7 | no |
| running-fullest | 1200 | 401.6 | 104.0 | 73.4 | 35.7 | no |

The operator's fixture at the operator's measure is the acceptance case:
`reported` running at measure 918 / column 1024 has G 181.3 against a 59.4 cost —
121.9px of headroom — where the shipped default at the same column has 13.9px.
The default-810 cells are the conservative case and are the ones a rule must not
break; 918 is the row the operator is actually looking at.

Note what the measure does to `fullest` at a 1024 column: at the shipped 810 it
has 2.0px of gap and is 35.7px short, while at 918 it has 35.7px of headroom.
Same fixture, same column, opposite verdict — the measured rule has to answer per
row, which is the whole argument against a static threshold.

### What the run proves, and against what

The number the operator reports is the one in the `running` rows: `duration laid
out = no` at every width, while the same fixture lays it out at 908 and above
when idle. The `idle` cells are the control that says the row itself can hold the
reading and that the absence is the state, not the width.

The capture was taken on the clean base tree before any edit of the fix, and the
rig copy that measured it is the one the after half will use; the base revision
is named above so the pair is two named revisions rather than two working-tree
states.

## What this rig does not see

- **A transition.** It mounts one state; it cannot hold the press that makes a
  turn run, so the frame pair is two stills of the same row, not a recording.
- **The post-stop grace window** (`data-interrupt-slot`) and the recording
  composition: both draw the same third 32px box the `running` state draws, and
  the grace window opens on a transition rather than on a mount (the harness
  header states this in full).
- **The app shell, the transcript and the real desktop bridge.** It mounts the
  shipped `MessageInput` with the app's own stylesheet, palette and font faces
  inside a `justify-end` column; it is a measurement surface, not the app. The
  live-app counterpart for this row is `docs/evidence/composer-readings/`.
- **A focused window.** Headless Chrome is never focused, so focus rings are
  not in these frames.
- **Best-fit prediction.** The `running-reported` cell at 700 carries the
  shipped ladder's cluster (model only). Nothing here predicts what a
  measured-fit rule would show there; it is a before reading, not a design.

## Gate

`node scripts/check-evidence-structure.mjs` (the CI half: no committed frames,
the manifest and its declarations, the proof artefacts) and
`node --test --test-concurrency=1 scripts/evidence-manifest.test.mjs` are the
gates run for this set. The pixel sweep (`pnpm check-evidence`) was **not** run:
it is the release path's machine-wide-lease sweep, and it needs a frames tree
seeded from a captured checkout, which this worktree does not have.
