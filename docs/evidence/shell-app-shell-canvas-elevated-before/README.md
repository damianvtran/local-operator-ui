# The dock before the drawer's-rung pass

The other half of the pair with `docs/evidence/shell-app-shell/chat-dock-files`
and `chat-dock-run-panel`, and with the two sub-view directories
`docs/evidence/canvas-workspace/files-dock-default` and
`docs/evidence/chat-run-panel/both-in-flight`: the same stories rendered against
the tree this pass started from, so a reader can put the two frames side by side
instead of inferring the change from a diff.

**Provenance.** Captured from a worktree at `origin/main` = `9589bd8fec` carrying
a HARNESS PATCH of two lines in `shell.stories.tsx` and no application change:
the conversation stand-in's classes (`w-0 min-w-[480px] flex-1`, the app's own
column in `chat-content.tsx`, in place of `min-w-[480px] grow` whose `auto` basis
was its content's width) and the Files dock's width at the frames' 1280px
viewport (`540`, the number the app's own resolver computes there, in place of
the `560` literal the story shipped). Nothing else was touched, so both halves
draw the app's arrangement - a 480px conversation column beside a 540px dock -
and the pair differs by exactly the change under test: the pane's ground and the
lane's last stop. (The eight palette sets of the two sub-view directories are not
re-photographed here: their stories never read the resolver and their committed
frames are already lit by this tree's code.)

**What the pair shows, measured in the pixels.** In `localOperatorDark`, at the
same coordinates in both halves:

| sample | before | after |
| --- | --- | --- |
| rail (30,300) | `#2b2722` `surface` | `#2b2722` `surface` |
| transcript (600,300) | `#22211d` `canvas` | `#22211d` `canvas` |
| dock chrome band (900,55) | `#22211d` `canvas` | `#322d22` `elevated` |
| lane over the dock (900,15) | `#22211d` `canvas` | `#322d22` `elevated` |
| lane over the transcript (600,15) | `#22211d` `canvas` | `#22211d` `canvas` |
| files-list row plane (900,300) | `#2b2722` `surface` | `#2b2722` `surface` |

So the before half's dock body is the conversation's own tone with a two-stop
lane over it (`surface` to the sidebar's trailing edge, `canvas` from there to
the window's right edge - one ground for everything right of the sidebar, correct
only while the dock and the conversation share a tone). In the after half the
pane stands one rung above the conversation and the lane's last stop lands on its
leading edge - both measured at x=740 in this pair - while the row plane the
canvas-chrome pass split out (pane `canvas`, rows `surface`) and the chrome
either side of it are exactly where they were.

**Palettes.** The shell pair and `chat-run-panel-both-in-flight` carry the seven
this pass's own record names (`localOperatorDark`, `localOperatorLight`, `sage`,
`catppuccinMacchiato`, `oneLight`, `iceberg`, `tokyoNightDay` - the two brand
themes, the moved pair's tightest palette, and the five the earlier canvas-chrome
pass chose); `canvas-workspace-files-dock-default` carries its full sixteen.
Every number in the table above is a TOKEN-PAIR measurement read off the palette
objects, not the frames': webp is lossy at this magnitude, and the same two
grounds decode to roughly a fifth of a ΔE00 higher, so say which pair a number
comes from wherever a frame is presented beside it.

**Two directories could not be re-photographed and stay as the base committed
them**: `console-pane/loading` and `browser-pane/trigger-no-approval`. Both paint
a sparse state - a quiet line, or a lone trigger - whose fresh frame measures
above the capture rig's 98.50% uniformity ceiling (99.08% and 99.06%, measured
with the rig's own `frameHistogram`), so the rig refuses to write them rather
than let a near-blank frame in; their committed frames pass the ceiling only
because the older captures carry encoder noise. They, and the surfaces this pass
knowingly carried, are named in `docs/evidence/manifest.json`'s
`canvasElevatedStaleFramesNote`.
