# The right slot before the panel rail (#872)

These are nine of the shell set's states, rendered by the UNMOVED tree: `origin/main`
(`ce49ccdb698`, this branch's base) under this branch's story arms. They are the
"before" half of the pairs issue #872 is about; the parent set's `browser-open/`,
`console-open/`, `browser-narrow-1192/`, `browser-narrow-1180/`,
`asks-covering-browser/`, `chat-dock-files/`, `chat-dock-run-panel/` and the three
`windows-caption-*-SIMULATED/` directories are the "after" half. Both halves are
`localOperatorDark` and `localOperatorLight`; every direct reading below is the same in
both. On the before tree the four triggers (Run details, Browser, Console, Canvas) are
the chat header's, so the pane arms show them in the header's action cluster, where
Console and Canvas disappear while their own pane is open.

## What the pair shows, measured

Read from the committed frames with `sharp`: the pane's leading edge is the first x at
a mid-frame row whose pixel leaves the conversation's ground and holds the new colour
for ten pixels; the dock width is the frame width less that edge (and less the rail's 44
in the after half, which is the quantity the app's own `data-slot-edge` asserts).

| reading | before | after |
| --- | --- | --- |
| dock width, browser / console / canvas, 1280 | 540 | **496** |
| dock width, browser, 1192 window | 452 | **408** |
| dock width, browser, 1180 window | 440 | **396** |
| run panel dock, 1280 (seed 420, held) | 420, lane stop x=860 | 420, lane stop x=816 |
| pane's leading edge (x), browser/console/canvas at 1280 | 740 | 740 |
| a 44px host on the window's edge | none | `data-panel-rail-host` 1236..1280, asserted at shutter time |
| triggers in the header | 4 | 0 (the `...` menu and the Asks trigger remain) |

**The issue's "~408px dock at 1180" is the 1192 window.** At 1180 the dock is **396px**
(below the canvas family's 400px floor, so canvas and asks are in overlay mode there);
408 is reached at 1192. Both are captured, and both rows assert their number and that
the pane's close control stays inside the pane and clear of the rail, and that the 40px
bar does not overflow, at shutter time (`browser-narrow-1192`, `browser-narrow-1180` in
`scripts/capture-evidence.mjs`).

The 44px every dock loses is the rail, which is the point of the geometry: the pane's
LEADING edge does not move (x=740 in both halves) because the rail is a sibling AFTER
the measured column and the resolver reads that column, so the dock keeps the width the
slot resolves for it minus the rail's share only where the row is already at its chat
floor. The run panel is the one pane whose dock is not squeezed (its seed, 420, fits the
row), so its LEADING edge moves 44 left instead (860 -> 816) and its width does not.

## Three frames that carry a claim no still can

- `windows-caption-no-pane-SIMULATED/` and `windows-caption-pane-open-SIMULATED/` are
  SIMULATIONS, not photographs. This host is macOS and draws no OS caption buttons;
  the frame sets the integrated/trailing chrome attributes and OVERRIDES
  `--chrome-inset-end` (138px) and `--chrome-inset-end-h` (40px) to a default Windows
  window's values (`useWindowsChromeSimulation`, the `index.css` simulation route). They
  show the layout's answer to the buttons, not the buttons. Before: the header's
  trailing spacer / the pane's close button keep the full 138px. After (measured at
  shutter time): the spacer is exactly **94px = 138 - 44** wide and the rail's first
  item starts below the 40px caption area.
  Read off the pane-open pair: the pane's close control sits at the SAME absolute x
  (about 1128 of 1280) before and after, because the pane's trailing edge moved in by the
  rail's 44px and the reservation shrank by the same 44 - which is the intended result
  (the control still clears the 138px caption area) and is why the old reservation would
  have pushed it 44px further in for nothing.
- `windows-caption-fleet-asks-on-settings-SIMULATED/` is after-only by construction: on
  settings no rail is mounted, so the fleet asks drawer keeps the FULL 138px
  reservation, which is what the unmoved tree also does - the before and after frames
  are byte-identical (verified with `cmp`), so no before directory is filed rather than
  a duplicate presented as a comparison. The claim is pinned in
  `scripts/titlebar-options.test.mjs` as well.

## What this set does NOT show (BLOCKED, not covered)

- **Real Windows or Linux caption buttons.** Not photographable here; the three
  simulation frames are the layout under a stated input.
- **The embedded browser view painting above DOM tooltips** (plan risk R1). The browser
  pane's page is a native `WebContentsView`, absent from a Storybook frame and from
  `capturePage()`, so a left-opening tooltip that overlaps it cannot be seen here.
- **Hover, focus and tooltip states.** The headless driver has no pointer verb; the
  rail's roving focus, `aria-pressed` and label strings are covered structurally by
  `scripts/panel-rail.test.mjs`, which is not visual evidence.
- **Historical frames that predate the move** are NOT re-shot and still show the
  header's triggers: `docs/evidence/chat-header-cluster*`,
  `docs/evidence/browser-approval-badges`, and the `chat-run-panel` trigger rows. They
  are accurate pictures of the tree they were taken from.

## Reproduce it

The recipe is a swap of origin/main's modules under this branch's story arms. Commit
FIRST: `git restore --worktree` restores from the INDEX, so on uncommitted edits it
discards them (measured on #880). Record md5 before, restore from `git show HEAD:<file>`
after, and verify.

    # the twelve modules the rail's presence changes, from origin/main
    for f in <list>; do git show origin/main:$f > $f; done
    # the shell stories import the rail through ONE seam so the old tree has no rail to
    # import: overwrite it with a stub that renders nothing
    printf 'export const ShellStoryRail = () => null;\n' \
      > src/renderer/src/shared/components/navigation/shell-story-rail.tsx
    # the rows' shutter-time claims assert the NEW behaviour; disable the `expect:`
    # expressions for this tree only (a working-tree edit to capture-evidence.mjs)
    node scripts/capture-evidence.mjs http://localhost:6717 --only=shell-app-shell \
      --dirs=browser-open,console-open,browser-narrow-1192,browser-narrow-1180,asks-covering-browser,chat-dock-files,chat-dock-run-panel,windows-caption-no-pane-SIMULATED,windows-caption-pane-open-SIMULATED,windows-caption-fleet-asks-on-settings-SIMULATED \
      --themes=localOperatorDark,localOperatorLight --allow-backend
    # move the written directories into panel-rail-before/, restore every file from the
    # commit, and verify by md5

The modules swapped, all restored and verified byte-identical by md5 against the values
recorded before the swap (14 files including the stub and `capture-evidence.mjs`):
`chat-sidebar-layout.ts`, `chat-content.tsx`, `chat-header.tsx`, `chat-layout.tsx`,
`ui-preferences-store.ts`, `index.css`, `run-details-trigger.tsx`, and the five panes'
toolbars (`ask-drawer.tsx`, canvas `index.tsx`, `run-panel.tsx`, `browser-pane.tsx`,
`console-pane.tsx`). More than the three #880 swapped, because the rail touches the
header, the shell's yield, the sidebar's arithmetic, the trigger and the five toolbars,
and a story that imports a selector the old store lacks is the failure this recipe
exists to avoid.

A sweep cannot re-derive these frames: a sweep captures the CURRENT tree, and these
need `main`'s modules under the same arms. That is why the set is declared in
`docs/evidence/manifest.json`.
