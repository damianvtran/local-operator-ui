# The pane's exits, before the fix — what Back did at the first level

Six frames, three surfaces, the two brand themes: the SAME three stories the
`../chat-run-panel/` set holds after the first-level-exit fix, photographed
against the pane `origin/main` ships.

```
back-to-roster/      2 frames    the first-level Back, which closed the pane
back-pop/            2 frames    one level up from a grandchild, unchanged
close-from-reader/   2 frames    PanelRightClose, unchanged
```

## Why this set exists

The defect is a difference in WHICH COMPONENT IS MOUNTED, so the fixed frame
alone cannot show it: a reader of `../chat-run-panel/back-to-roster/` sees the
roster with the pane open and has to take on trust that anything else ever
happened. These are the other half of that pair — `origin/main`'s own
`run-panel.tsx`, the same story, the same presses — and the pair is the claim:

| comparison | measurement |
| --- | --- |
| `back-to-roster` before vs after | the pane is GONE before and present with the roster after: 463,363 differing pixels in the dark theme, 457,994 in the light one |
| `back-to-roster` before vs `../chat-run-panel/close-from-reader/` | **byte-identical**, both themes (`9f40e979d6eb…` dark, `ea05aec0f715…` light) — Back at the first level did exactly what the close control does, which is the defect in one hash |
| `back-pop` before vs after | **byte-identical**, both themes (`95d1aff170c2…` dark, `f6905fdeefa6…` light) — one level up while there is a level to pop is the rule round 1 settled, and this change does not touch it |
| `close-from-reader` before vs after | **byte-identical**, both themes — the close control still closes the pane, which is half of what the change had to preserve |

Two surfaces are therefore meant to look IDENTICAL to their
`../chat-run-panel/` twins, and that agreement is evidence rather than a
duplicate: `back-pop` is the rule that must not move, and `close-from-reader` is
the control the pane's exit belongs to.

## How it was taken

1. The stories and the fix were committed first, so the rig and the story file
   are the tree under review (`68946d867`, on `origin/main` `96502d5cb`); only
   the component under repair differs between the two runs.
2. In that checkout, `run-panel.tsx` was replaced with
   `git show origin/main:src/renderer/src/features/chat/components/run-details/run-panel.tsx`
   — a working-tree edit that was never committed, and that was restored before
   the frames were committed. `origin/main` still carries the defect: its `back`
   calls `onClose()` at the first level and its root crumb is `onClick={onClose}`.
3. Storybook from this worktree, on a port no other tree held, then one narrowed
   run per story — the same command the after frames used:

   ```sh
   pnpm storybook --port 6018 --ci
   node scripts/capture-evidence.mjs http://localhost:6018 \
     --only=back-to-roster --themes=localOperatorDark,localOperatorLight --allow-backend
   ```

   `--allow-backend` because this machine has a backend listening on the app's
   configured port and these stories mount the production header, whose health
   poll reaches for it; the frames come from the fixtures and the reader's
   `previewPage` seam, not from that backend, so declaring it is the honest
   option rather than a workaround for one.
4. The frames the rig wrote into `../chat-run-panel/<story>/` were moved here and
   the after frames re-captured into that set from the fixed tree, which is why
   the two runs' frames are from the same base and the same window size
   (1280x900) rather than from whichever head each happened to be taken at.

**Two brand themes, not twelve, and that is this set's own scope.** The claim is
about which view is on screen after a press, which no palette can change; the
twelve-theme sweeps belong to the surfaces a design round judges for contrast and
spacing, and those are in `../chat-run-panel/`. Every before frame here is the
same theme as the after frame it is compared against, so each comparison above is
like for like.

These are **supplementary** frames in `../manifest.json`'s sense: the script
cannot re-derive them from the tree under review, because the tree under review is
the fixed one. A sweep therefore preserves them (`clearSweptFrames`), and the
swept count excludes them.
