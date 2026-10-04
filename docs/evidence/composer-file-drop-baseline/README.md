# The composer's drop target, BEFORE (the base tree at 77444ffb36f)

Six frames from `scripts/renderer-driver.mjs`'s `composer-drop` scene driven with
`--drop-expect discarded`: the SAME rig bytes as the head half beside them
(`composer-file-drop/`), against a worktree at this branch's cut point
(`origin/main` = `77444ffb36f`), with the app BUILT from that tree.

The claim this half records is the defect: a real file drag over the composer
band attaches NOTHING — while a paste in the same pane, in the same run, still
attaches a file. The scene asserts that shape rather than a generic "nothing
happened", so the pair cannot be read as two different scenes:

```
[PASS] case 1 (one image): the drop attaches NOTHING on this tree (the defect this pair records)
[PASS] case 2 (two files): the drop attaches NOTHING on this tree (the defect this pair records)
[PASS] case 3 (a .txt): the drop attaches NOTHING on this tree (the defect this pair records)
[PASS] BASE TREE: during a turn the paste still attaches a file and the drop attaches nothing (the defect)
[PASS] BASE TREE: a file dropped off the composer leaves the window exactly where the control left it
```

The last line is the second half of the before evidence, and it is a correction
to the issue's own triage: a file dropped on a NON-target part of the window does
not navigate the window away on Electron 44.3.0. The scene reads that twice (with
the rig's drag interception armed, and again with it disarmed, since armed
interception suppresses default actions itself) and controlled against the
router's own settling — the URL and the mounted composer are the same before the
control wait, after it, and after both drops. The full log is
`baseline-run.log` beside these frames; the head half's README carries the run
command and the readings.
