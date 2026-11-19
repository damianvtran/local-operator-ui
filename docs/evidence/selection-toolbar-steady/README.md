# One toolbar at a time — the selection strip, recorded

Operator report, 2026-10-19: *"since both are up, the toolbar on select flashes
briefly when you make a selection before disappearing and yielding to a toolbar
on the right"*, and *"they seem to be slightly different styles which is
annoying"*.

A flash is a TIMING defect, so the evidence is a **frame sequence with
timestamps**, not a still. `scripts/selection-toolbar-flicker-proof.mjs` drives
three gestures over `chat-canonical-quote--sent-turn-quote` with real CDP input
and reads the DOM once per animation frame from inside the page:

| gesture | what it is | what it must show |
| --- | --- | --- |
| `drag` | a slow drag-select across the answer | the selection strip appears once and stays, and **no row toolbar is painted in any frame** |
| `click` | a plain click with no drag | no selection strip; the row's own cluster is revealed |
| `hover` | a pointer resting on the row | no selection strip; the row's own cluster is revealed |

Each frame's reading is `present`, `visible` (computed `visibility`/`display`/
`opacity`, plus a non-zero box) and `box`. The row cluster is read on the row
the selection or the pointer is on, not "any cluster in the document" — the
first version of the rig read the user row above and reported a cluster that
belonged to a different row.

## The pair, like for like

Both folders are the SAME rig, at 1440x900, one per tree:

```bash
# BEFORE: a throwaway worktree at the branch's merge base
git worktree add --detach .worktrees/toolbar-flicker-base 1f285116b37944add071bd2918dce4e436703e9d
ln -s ../../node_modules .worktrees/toolbar-flicker-base/node_modules
node_modules/.bin/storybook dev -p 6045 --ci --quiet      # in that worktree
node scripts/selection-toolbar-flicker-proof.mjs \
  --origin http://localhost:6045 --out /tmp/flicker/before --label before

# AFTER: this branch
node scripts/selection-toolbar-flicker-proof.mjs \
  --origin http://localhost:6044 --out /tmp/flicker/after --label after
```

## The reading that names the defect

| tree | drag frames | frames with TWO toolbars visible |
| --- | --- | --- |
| before (merge base `1f285116b3`) | 87 | **84** |
| after (this branch) | 95 | **0** |

The base tree paints the selection strip above the highlight AND the closing
answer's in-flow Copy/Speak/Fork row for almost the whole drag: the quote
toolkit's suppression list covered the response and user overlays and not
`data-lo-answer-actions`. The strip's final box on both trees is
`{left: 242, top: 184}` against the selection's first line at `top: 223` — it
stays on the highlight, clear of it, rather than moving to the row's trailing
seat. A plain click and a hover reveal the row's own cluster on both trees.

The `report.md` in each folder is the rig's own assertion text; `readings.json`
is the per-frame trace; `console.json` is the renderer's console and network
log. Both trees report **no new console errors and no failed requests**; the
only lines are the pre-existing `/__desktop` 404s Storybook answers for the
app's desktop probe, recorded under `knownPreexisting` rather than dropped.

## What a reviewer should look at

1. `before/readings.json` → `drag` → count the frames where both
   `toolbars.row.visible` and `toolbars.selection.visible` are true.
2. `after/readings.json` → the same count is zero, and `toolbars.row.visible`
   is false in every frame from the first selection frame onward (the first
   two frames precede the gesture).
3. `before/frames/a1-drag-020.png` and `after/frames/a1-drag-020.png` side by
   side: the base frame carries the strip over the selection and the row's own
   icons at the far right; the after frame carries the strip alone.
4. `after/frames/a1-hover.png`: the right-hand cluster is the same chrome as
   the strip — `bg-elevated`, `border-hairline`, `rounded-md`, `h-8`, `px-1`,
   `gap-1` — so only the position changes between the two states.
