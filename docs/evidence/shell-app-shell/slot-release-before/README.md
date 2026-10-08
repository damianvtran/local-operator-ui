# The right slot before it released where the route cannot draw its pane

These are two of the shell set's states, rendered by the UNFIXED tree:
`origin/main` (`c14e07d95b`, this branch's base) under this branch's story arms
(`ChatDockRunPanelOnDraft`, `ChatDockAsksOnDraft`). They are the "before" half
of the pair issue #868 is about; the parent set's `run-panel-on-draft/` and
`asks-on-draft/` are the "after" half.

**What the pair shows, measured.** Both arms are the same two gestures: a pane
flag that persists across routes - run details handed back by the asks drawer's
close, and the drawer's own session-scoped flag - carried onto a draft, a route
with no run details and no conversation, so neither pane can mount
(`paneMounted: false`, read in both arms on both trees). On the before tree the
slot's readers trust the bare flag, so the lane still paints the pane's
`elevated` ground over the empty column.

| reading (1280x900 capture) | before | after |
| --- | --- | --- |
| lane stop `data-slot-edge`, run arm | **860** | **1280** |
| lane stop `data-slot-edge`, asks arm | **740** | **1280** |
| column right edge / row right edge, both arms | 1280 / 1280 | 1280 / 1280 |
| band strip mean, run arm (dark) | `#322d21` | `#22211d` (the conversation's own `canvas`) |
| band strip mean, run arm (light) | `#fefcfb` | `#f2ede3` (the same step) |
| conversation lane mean, same rows | `#22211d` / `#f2ede3` | unchanged |

The band strip is x 900-1200, y 6-26 of the frame; the conversation row is the
same rows at x 400-600, read as the control. WebP is lossy at this magnitude, so
the tones are named against the tokens the pair is drawn from (`elevated` over
`canvas`): the before frames carry a 420px and a 540px phantom slot's ground -
exactly `resolveRightSlotWidth`'s answers for the run seed and the canvas family
- over a row that mounts nothing. The after frames collapse the stop onto the
column's own edge (`data-slot-edge` 1280), asserted at shutter time in
`scripts/capture-evidence.mjs`'s rows. The band is the operator's report: "the
chrome lane above it has a different shade, as if the slot's leading edge were
still placed for an open pane."

**Reproduce it** with this branch's story file and capture rows against
`origin/main`'s store and `chat-content` modules - the only combination that
renders these arms on the old readers:

    git restore --source=origin/main --worktree -- \
      src/renderer/src/shared/store/ui-preferences-store.ts \
      src/renderer/src/features/chat/components/chat-content.tsx
    # the two rows' edge claim is re-pointed for this tree (the band IS present
    # here), one working-tree-only edit to the rig, restored with the modules
    node scripts/capture-evidence.mjs http://localhost:6517 \
      --only=shell-app-shell --dirs=run-panel-on-draft,asks-on-draft \
      --themes=localOperatorDark,localOperatorLight --allow-backend
    mv docs/evidence/shell-app-shell/{run-panel-on-draft,asks-on-draft} \
       docs/evidence/shell-app-shell/slot-release-before/
    git restore --worktree -- \
      src/renderer/src/shared/store/ui-preferences-store.ts \
      src/renderer/src/features/chat/components/chat-content.tsx

The before run and the after run write into the SAME two directories, so the
move carries off what that pass wrote and the after frames are then re-captured
from the restored tree (the last command above restores the readers; the after
capture is the row command again). Every edited file was verified byte-identical
afterwards, by md5 against the values the after run used.

A sweep cannot re-derive these frames: a sweep captures the CURRENT tree, and
these need `main`'s readers under the same arms. That is why the set is declared
in `docs/evidence/manifest.json` - so a sweep leaves it alone and its own count
stays honest about what it can still take.
