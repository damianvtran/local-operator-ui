# The composer's drop target, BEFORE (the base tree at 4b5c81df9e)

Eight frames from `scripts/renderer-driver.mjs`'s `composer-drop` scene driven with
`--drop-expect discarded`: the SAME rig bytes as the head half beside them
(`composer-file-drop/`), against a DETACHED WORKTREE at this branch's fold point
(`origin/main` = `4b5c81df9e`) with this branch's `renderer-driver.mjs` copied in
and the app BUILT from that tree (`diff -q` between the two driver files is empty
in the run that produced this pair, so only `src/` differs).

The claim this half records is the defect: a real file drag over the composer
band attaches NOTHING — while a paste in the same pane, in the same run, still
attaches a file. The scene asserts that shape rather than a generic "nothing
happened", so the pair cannot be read as two different scenes:

```
[PASS] case 1 (one image): the drop attaches NOTHING on this tree (the defect this pair records)
[PASS] case 2 (two files): the drop attaches NOTHING on this tree (the defect this pair records)
[PASS] case 3 (a .txt): the drop attaches NOTHING on this tree (the defect this pair records)
[PASS] BASE TREE: case 7 is a focused composer under a drag; this tree paints no drop state
[PASS] BASE TREE: case 8 has no non-media tile to read (nothing attaches on this tree) - recorded for the pair's shape
[PASS] BASE TREE: during a turn the paste still attaches a file and the drop attaches nothing (the defect)
[PASS] BASE TREE: a file dropped off the composer leaves the window exactly where the control left it
```

The run is 20 PASS / 0 FAIL; the full log is `baseline-run.log` beside these
frames, and the head half's README carries the run command and the readings.

## The two cells the design round asked for, on this tree

`armed-focused` and `armed-non-image-tile` run here too, and they are the reason
the pair is readable rather than merely symmetric:

- **`armed-focused`** — the composer really is focused (the run asserts
  `document.activeElement` is the textarea) with a file over it, and this tree
  paints NO drop state: the box keeps the same solid focus ring it has when
  nothing is being dragged. That is D1's defect photographed rather than argued —
  on this tree, focused and armed look identical.
- **`armed-non-image-tile`** — the cell exists and shows a composer with nothing
  attached, because nothing attaches here; the scene asserts the absence
  (`tile === null` in both readings) instead of photographing an empty band and
  calling it the same state.

## What this half does not show, stated rather than left to inference

- The head half once explained its empty tiles as a property of the rig's
  `file://` renderer. That was wrong (the rig's own Content Security Policy was
  blocking the tile's image request) and the head set's README records the
  correction (agent review round 1, CR1-1 = QA round 1, Q-1). It is noted here
  because a reader who saw the earlier pair would otherwise take the explanation
  as still standing.
- A human's own drag, the packaged artifact, and the refusing arm of the drop
  gate are outside this half for the same reasons the head half's README gives.
