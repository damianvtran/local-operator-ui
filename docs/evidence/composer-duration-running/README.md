# The composer's active-time reading while a turn runs — the before/after pair

The operator's report is that the session duration disappears from the composer
exactly while the agent is working. This set is the pair that shows it and the
fix: the **before** half (base `2f5d8e3239`) is the shipped `MessageInput`, where
a running turn hides the reading at EVERY width; the **after** half (the fix
commit) keeps one duration element mounted and decides its visibility from the
row's own measured free gap. Both halves mount the same fixtures — the
operator's own row (`reported`) and the widest fixture (`fullest`) — at both the
shipped 810px composer measure and the operator's dragged 918px one, in both
themes, idle and running.

The defect, for a reader who has not opened the file: the duration reading's own
class name was `hidden` whenever `controlsThirdBox` is true, and
`controlsThirdBox` is `Boolean(canonicalStop?.active) || interruptSlotDrawn`
(`message-input.tsx`). A running turn therefore hid the reading at EVERY
width — not only in the narrow band the class's other half
(`@max-[860px]/chatcol:hidden`) covered. The strip is the only renderer of
`active_duration_s`, so the number was shown nowhere in the app while it ticks.

## Where the frames came from

One temporary worktree, detached at this branch's base, **`2f5d8e3239`**
(`.worktrees/cdr-base`), sharing the primary checkout's `node_modules` through
the same relative symlink. The rig was copied into it from the branch, so both
halves are taken by the same rig bytes rather than by two trees that each own a
story. The copy differs from the base revision's committed rig by the `reported`
fixture, the `--measure` option and the probe's additive fields (the duration is
found by its marker and judged by computed visibility, because the fix wraps it
where the base tree had the reading in flow) — no layout-measuring expression
changed, verified by re-running two base cells with the final rig and diffing
every pre-existing field against the committed numbers: 0 diffs.

The before set is two runs on the base worktree; the after set is the same two
runs on this worktree, plus two extra columns (820, 840) that bracket the rung
edge at container 780 (column 828) where the unchanged effort ladder returns:

```sh
# before — cwd .worktrees/cdr-base, out …/composer-duration-running/before
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --only=reported,fullest \
  --widths=480,700,798,853,854,860,908,1024,1200 --label=before
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --only=reported,fullest --measure=918 \
  --widths=700,798,853,854,860,908,1024,1200 --label=before

# after — cwd this worktree, same out but …/after
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --only=reported,fullest \
  --widths=480,700,798,820,840,853,854,860,908,1024,1200 --label=after
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --only=reported,fullest --measure=918 \
  --widths=700,798,820,840,853,854,860,908,1024,1200 --label=after
```

Counts: before 136 (72 at the shipped 810 measure + 64 at 918); after 170
(88 + 80 + 2 for the RTL cell, below); 306 in all. `before/frames.txt` and
`after/frames.txt` name every path, and the nine shared widths are
cell-for-cell comparable.

The rig writes one row-sized crop per case per theme plus `numbers.json` from
the same DOM; the frames are those PNGs converted with `cwebp -q 88 -m 6`,
renamed to `<case>/<theme>.webp` so each frame names its own theme (the walker
in `scripts/check-evidence.mjs` derives the expected ground from that name).
They are rig output in the ignored `docs/evidence-frames/` tree and are not
committed. `localOperatorDark` and `localOperatorLight` are numerically
identical in every cell, so the tables list one row per case.

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

## The after half

The fix replaces both class-based sheds with one measured predicate. The reading
is always mounted when there is a duration to show, laid out OUT OF FLOW
(`position: absolute; top: 0; inset-inline-start: calc(100% + 4px)`, the strip
being `relative` - `inset-inline-start` is `left` in LTR and `right` in RTL) and
toggled with `invisible` - visibility, never display. The strip measures, in
full precision, the row's inline gap `G = inlineGap(direction, lastEdge,
controlsLeft, controlsRight)` - `controls.left - last.right` in LTR,
`last.left - controls.right` in RTL - and `D = the reading's own box`, and shows
it when `G >= D + 4`; the 4px is the readings' own gap. Nothing else moved: the other three readings'
ladders, the model's width rules, the spacing and the control box count are the
shipped ones. The controls group carries `data-lo-composer-controls` and the
reading carries `data-lo-duration`, so the measurement finds the row's real
anchors rather than a translated label or a position.

The commands are the two `after` runs above.

### Acceptance

| acceptance | measured | verdict |
| --- | --- | --- |
| `reported` running, shipped 810, column 700 | G 107.1, D+4 59.4, spare 47.7 | shown |
| `reported` running, shipped 810, column 1024 | G 73.3, D+4 59.4, spare 13.9 | shown |
| `reported` running, operator measure 918, column 1024 | G 181.3, D+4 59.4, spare 121.9 | shown |
| `fullest` running, shipped 810, column 1024 | G 2.0, D+4 37.7, spare -35.7 | hidden |
| `fullest` running, operator measure 918, column 1024 | G 73.4, D+4 37.7, spare 35.7 | shown |
| `fullest` running, shipped 810, column 700 | G 89.9, D+4 37.7, spare 52.2 | shown |

All six hold. The last row is the ladder's own doing, not the fix's: at column
700 the three value readings are shed, so the row has room for the duration.

### The running matrix, both measures

`D` is the duration's own measured width, `D+4` its fit boundary, `spare` is
`G - (D + 4)`.

| case | col | G | D | D+4 | spare | duration |
| --- | --- | --- | --- | --- | --- | --- |
| reported running (m810) | 480 | 38.9 | 55.4 | 59.4 | -20.5 | hidden |
| reported running (m810) | 700 | 107.1 | 55.4 | 59.4 | 47.7 | shown |
| reported running (m810) | 798 | 52.0 | 55.4 | 59.4 | -7.4 | hidden |
| reported running (m810) | 820 | 74.0 | 55.4 | 59.4 | 14.6 | shown |
| reported running (m810) | 840 | 56.3 | 55.4 | 59.4 | -3.1 | hidden |
| reported running (m810) | 853 | 69.3 | 55.4 | 59.4 | 9.9 | shown |
| reported running (m810) | 854 | 70.3 | 55.4 | 59.4 | 10.9 | shown |
| reported running (m810) | 860 | 74.3 | 55.4 | 59.4 | 14.9 | shown |
| reported running (m810) | 908 | 74.3 | 55.4 | 59.4 | 14.9 | shown |
| reported running (m810) | 1024 | 73.3 | 55.4 | 59.4 | 13.9 | shown |
| reported running (m810) | 1200 | 73.3 | 55.4 | 59.4 | 13.9 | shown |
| fullest running (m810) | 480 | 21.7 | 33.7 | 37.7 | -16.0 | hidden |
| fullest running (m810) | 700 | 89.9 | 33.7 | 37.7 | 52.2 | shown |
| fullest running (m810) | 798-1200 | 2.0 | 33.7 | 37.7 | -35.7 | hidden |
| reported running (m918) | 700 | 107.1 | 55.4 | 59.4 | 47.7 | shown |
| reported running (m918) | 798 | 52.0 | 55.4 | 59.4 | -7.4 | hidden |
| reported running (m918) | 820 | 74.0 | 55.4 | 59.4 | 14.6 | shown |
| reported running (m918) | 840 | 56.3 | 55.4 | 59.4 | -3.1 | hidden |
| reported running (m918) | 853 | 69.3 | 55.4 | 59.4 | 9.9 | shown |
| reported running (m918) | 854 | 70.3 | 55.4 | 59.4 | 10.9 | shown |
| reported running (m918) | 860 | 76.3 | 55.4 | 59.4 | 16.9 | shown |
| reported running (m918) | 908 | 124.3 | 55.4 | 59.4 | 64.9 | shown |
| reported running (m918) | 1024 | 181.3 | 55.4 | 59.4 | 121.9 | shown |
| reported running (m918) | 1200 | 181.3 | 55.4 | 59.4 | 121.9 | shown |
| fullest running (m918) | 700 | 89.9 | 33.7 | 37.7 | 52.2 | shown |
| fullest running (m918) | 798-860 | 2.0 | 33.7 | 37.7 | -35.7 | hidden |
| fullest running (m918) | 908 | 16.4 | 33.7 | 37.7 | -21.3 | hidden |
| fullest running (m918) | 1024 | 73.4 | 33.7 | 37.7 | 35.7 | shown |
| fullest running (m918) | 1200 | 73.4 | 33.7 | 37.7 | 35.7 | shown |

### Idle

The same rule, same fixtures:

- `idle-reported`, shipped 810: hidden at 700-798 (G 49.3 / 50.3), shown from 820
  up (G 72.3 at 820, 109.3 at 1024). At 918 it is shown from 820 up as well, and
  at 908 G is 160.3.
- `idle-fullest`, shipped 810: shown only at 480 (G 53.7 against 37.7); hidden
  from 700 up. At 918 it shows from 908 up (G 52.4 at 908, 109.4 at 1024).
- Note the asymmetry with the BEFORE half's idle cells: see consequence 2 below.

### Two consequences, measured rather than assumed

1. **Anti-reflow, proved by the cells that do not move.** All 68 running cells
   that exist in both halves are identical in strip width, every reading box,
   the controls group, the gap, the row box and the line count. The only thing
   that changed in them is the duration's own box (from 0x0 to a laid-out box,
   or from absent to present). Drawing the reading cannot reflow the row, so the
   measurement cannot feed itself.
2. **Where the reading used to be IN FLOW, the model chip takes the space - in
   half the idle cells, not all of them.** The 24 idle cells that differ from
   the before half split into two shapes, and the split matters:
   - **12 are `fullest`** (908/1024/1200 x 2 measures x 2 themes): the shipped
     tree drew the duration in flow and squeezed the model chip; with the
     reading out of flow the chip expands to its natural width and the measured
     gap then hides the reading where the chip used it. Measured at 1024/810:
     model 81.8 -> 119.5px, G 2.0, duration hidden (shown before); at the
     operator's 918 the same cell has G 109.4 and shows it.
   - **12 are `reported`** (same widths/themes/measures): the chip is 102.9px in
     BOTH halves, so nothing expands; the freed 55.4px + 4px goes to the GAP
     (G 50.0 -> 109.3 at 1024/810), and the reading still shows at 820 and above.
   The model is never shrunk to buy the reading back - the design note's own
   caveat for the `fullest` cells, measured rather than assumed.

### The shed is a gap, not a column - and the ladder makes it step

The reading sheds at `G < D + 4`: **59.4px for the six-glyph `20m25s`, 37.7px
for `20h`**, not at a column. Measured at the shipped 810 measure,
`running-reported` is shown at 700 (47.7 spare), hidden at 798 (-7.4), shown at
820 (+14.6), hidden at 840 (-3.1), then shown from 853 up (+9.9). The 840 cell
is the unchanged effort rung returning as the container crosses 780 (column
828): the row genuinely has less free gap once effort is back, and the same rule
that shows the reading at 820 hides it at 840. It is a real consequence of
measuring the row, not a threshold error, and nothing is shed or shortened to
"correct" it.

### The anchor invariant held at every cell, in both directions

`strip` inline-end edge equals the last visible non-duration reading's
inline-end edge in all 170 after cells - both themes, both measures, every
width, both directions (`anchorDelta` 0 in `after/numbers.json`, computed as
`strip.right - last.right` in LTR and `strip.left - last.left` in RTL). The
anchor (`insetInlineStart: calc(100% + READING_GAP)`) and the measured
inequality therefore refer to the same position; no inline-left fallback was
needed.

### RTL (`ur`) - the case a physical rule hides

The first implementation of this fix used physical edges (`controls.left -
max(right)`, `left: calc(100% + 4px)`). Under `dir="rtl"` - `ur` is a shipped
locale - the row is mirrored, so the last reading is the LEFTMOST one and the
free gap ends at the controls' RIGHT edge. A physical rule hid the reading at
EVERY width in that locale while every LTR frame passed. The fit is now
direction-aware (`session-duration-fit.ts`, unit-tested for both directions at
the fit boundary) and the anchor is the logical `insetInlineStart`, which flips
with the row.

The captured cell is the operator's state in RTL: `running-reported`, measure
918, column 1024, both themes:

| case | G | D | D+4 | spare | duration | anchorDelta |
| --- | --- | --- | --- | --- | --- | --- |
| `reported` running, measure 918, column 1024, `dir=rtl` | 181.3 | 55.4 | 59.4 | 121.9 | shown | 0 |

The cell ALSO exposed a pre-existing row defect, which the review's requested
cell could not have shown otherwise: the controls group carried a PHYSICAL
`ml-auto`, so in RTL the row's free space landed on the far side of the group
and the readings sat 2.0px from it - the first RTL capture measured G 2.0 and
correctly hid the reading. The row's one live auto margin is now the logical
`ms-auto`: identical in LTR and mirrored in RTL. The LTR control cell
(`running-reported`, measure 918, column 1024) was re-run after the change and
is unchanged (cluster 293.7, G 181.3, duration shown), so the margin move is a
no-op in LTR. Command:

```sh
node scripts/composer-readings-geometry.mjs --port=5435 --themes=both \
  --dir=rtl --only=running-reported --measure=918 --widths=1024 \
  --out=... --label=after
```

### What the after half cannot show

- **A transition.** The harness mounts one state: the press that starts a turn,
  the 500ms grace window and a live recording are not photographed. All three go
  through the same measured predicate - the reserved slot is inside the marked
  controls group, so its width is part of G while it is held - but this set does
  not claim frames for them. `scripts/interrupt-esc-proof.mjs` is where that
  window's own transition is exercised against the live app.
- **The 1Hz tick.** `active_duration_s` is banked with `activity_started_at:
  null`, so the value is stable in every frame; a value that changes width only
  enlarges D, and D is measured, not assumed.
- **A focus ring.** Headless Chrome is never focused.

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

- `node scripts/check-evidence-structure.mjs` -> *"Evidence structure holds: 1492
  tracked files under docs/evidence/, 237 declared set(s), 0 committed frames, 4
  named proof artefact(s)."* Run with the frames tree absent (the CI shape). With
  this worktree's partial frames tree present the same gate refuses - correctly -
  because the manifest's whole-tree counts describe a seeded checkout, not the one
  set this session captured.
- `node --test --test-concurrency=1 scripts/evidence-manifest.test.mjs` -> 54
  tests, 52 pass, 0 fail, 2 skipped (both frame-tree skips, by design).
- `pnpm evidence:fold` is a merge-conflict resolver and does not apply outside a
  merge; the set was declared by hand and the manifest test above reads it.
- The pixel sweep (`pnpm check-evidence`) was **not** run: it is the release
  path's machine-wide-lease sweep, and it needs a frames tree seeded from a
  captured checkout, which this worktree does not have.
