# The dock before the canvas chrome pass

The other half of the pair with `docs/evidence/shell-app-shell/chat-dock-files` and
`chat-dock-run-panel`: the same two stories, rendered against the tree this pass
started from, so a reader can put the two frames side by side instead of inferring
the change from a diff.

**Provenance.** Captured from a worktree at `origin/main` = `d8a85eebd8` carrying a
HARNESS PATCH of three files and no application change: the two story rows added to
`scripts/capture-evidence.mjs`, `shell.stories.tsx` as this branch writes it, and
`src/renderer/src/shared/components/common/pane-slot.tsx` carrying the classes
`chat-content.tsx` drew on that tree (`relative h-full overflow-hidden border-l
border-hairline transition-[width] duration-base ease-out-quart`). Nothing else was
touched, so the frames are the pristine app's own pixels - its `surface` panes, its
`sunken` bars, its leading hairline - rather than a reproduction of them.

**What the pair shows, measured in the pixels.** In `localOperatorDark`:

| | rail | transcript | dock body | dock bar |
| --- | --- | --- | --- | --- |
| before | `#2b2722` (`surface`) | `#22211d` (`canvas`) | `#2b2722` (**the rail's own token**) | `#1e1c1a` (`sunken`) |
| after | `#2b2722` (`surface`) | `#22211d` (`canvas`) | `#22211d` (`canvas`) | `#22211d` (no band) |

So the before dock is the same tone as the sidebar it is compared against, with a
recessed bar over it and a hairline beside it; the after dock is the work plane's
own ground, continuous with the 32px lane above it, with no band and no rule.

## The two sub-view pairs

`canvas-workspace-files-dock-default/` and `chat-run-panel-both-in-flight/` carry
the before halves of the two surfaces the operator's own screenshots show (the
file-search view and the run-details view). Same provenance and same harness patch
as above, so `docs/evidence/canvas-workspace/files-dock-default/*.webp` and
`docs/evidence/chat-run-panel/both-in-flight/*.webp` have a counterpart to be read
against. Those two sets are `SplitFrame` - the dock beside a mock conversation -
which is why the shell pair above is the one that carries the rail and the lane;
these two are here for the sub-views themselves.

**Palettes.** Seven: `localOperatorDark`, `localOperatorLight`, `sage`,
`catppuccinMacchiato`, `oneLight`, `iceberg`, `tokyoNightDay` - the two brand themes
and the five whose `surface` -> `canvas` step is smallest, which is where the seam
is hardest to read. Those step numbers are the TOKEN PAIR's, read off the palette
objects, and not the frames': webp is lossy at this magnitude, so the same two
grounds DECODE to roughly a fifth of a ΔE00 higher (design review round 2, D3). Say
which pair a number comes from wherever a frame is presented beside it.

The remaining five of the sweep's twelve are owed a full pass before merge; so is a
re-capture of the four pane surfaces, whose committed frames were not re-taken when
this change moved their ground. `canvasChromeStaleFramesNote` in
`docs/evidence/manifest.json` carries both debts as merge preconditions rather than
certifying stale frames, and its machine-readable companion `carriedFrames` records
the second one per surface, with the pixel reading that shows a carried frame still
drawing the removed band.
