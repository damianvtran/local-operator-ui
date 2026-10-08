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

## Round 1 additions (design round 1, D1 / D5 / D6; PR #885)

### The rail tooltip over the NATIVE browser view (D1): a real-app capture

`panel-rail-tooltip-real-app/` is the one set in this PR photographed from the REAL
window, because the question is a compositor fact: a native `WebContentsView` paints
above all DOM (`browser-view-policy.ts`), so a rail tooltip that opens LEFT, into the
Browser pane, may or may not be visible, and neither Storybook nor `capturePage()` can
say. `harness/capture.mjs` is a single self-contained command (built app,
`--window-mode=inactive`, the repo's own stub daemon on port 8080, scratch profile,
mock keychain, every `CMUX_*`/`LOP_*` variable removed, `screencapture -x -l <windowid>`,
the Electron process group reaped by exact pid before it returns).

- `real-app-before-canvas.png`: the suppression REMOVED (the item's one
  `useSuppressBrowserView` call replaced by a no-op for this capture only, restored and
  verified byte-identical by md5). Hovering the Canvas item with the Browser pane open:
  the tooltip's box is in the DOM and the native view's orange page paints over it, so
  the tooltip is NOT on screen. This is the occlusion design predicted, now measured.
- `real-app-after-canvas.png`: the shipped code. The same hover: `Open canvas (cmd+shift+C)`
  is on screen, and the page beneath it is paused for the tooltip's lifetime (the view is
  hidden, which is the policy's own paused state). The page repaints when the pointer
  leaves.
- `real-app-after-console-in-chrome-band.png`: with NO run-details item (the stub serves
  no run frames) the Console item is the SECOND in the rail and its tooltip sits at
  y=78..106 (measured). With the run item present (the `--simulate-run-slot` run) it sits
  at y=114..142 (measured). Both are inside the pane's DOM bar and tab strip, above the
  native view, whose top edge is at about y=149 (read off the frames, not metered: the
  harness's `viewRect` probe found no element by that tag and returned null). The Console
  tooltip was therefore not occluded, and the frame is kept so nobody reads the canvas pair
  as covering it. The Browser item's tooltip is higher still, in the bar (seen in
  `before-browser`, not committed).

**What the pair is, and is not.** The stub conversation has no Run details item, so the
rail's items sit one item (36px) higher than in a real conversation. The canvas pair was
therefore taken with `--simulate-run-slot`, which pads the rail's top by those 36px so the
tooltip lands at y=150..178, where the real Canvas item's tooltip lands (inside the view's
rect). That padding is a SIMULATION of position and is named as one; the rendering fact
(a tooltip at that position is hidden by the native view without the suppression, and
shown with it) is not simulated. Measured: with the suppression registered
`data-suppressed-by` reads `panel-rail-tooltip::...`; without it, empty.
Coverage this does NOT have: Windows and Linux compositors, a non-default display scale
other than this host's 2x, and the page-flash cost the policy header calls probe P11
(a still frame cannot show a flash; the policy header still lists it as unmeasured).

### The 800px pane bar (D5)

At the 800px window floor the Browser dock is 220px, and the pane's bar (title, scope
switch, close) needed 278px: "Close browser" painted 15px over "This conversation" and
"All tabs" fell out of the pane. The bar now sheds the title below 300px of pane
(`@max-[300px]/bpane`) and lets the switch shrink and truncate before the close control
moves. Measured at the same stories: 800 -> pane 220, bar scrollWidth 220 = clientWidth
220, close at x=720..748 and the switch ending at 708 (was 810); 900 -> pane 320, no
change. Frames: `browser-narrow-800/` and `browser-narrow-900/`, with shutter-time rows
that assert no overlap, no overflow and the close control inside the pane.

### Frames that predate the move, re-shot or named (D6, R2)

Re-shot against this tree: `chat-dock-files/` and `chat-dock-run-panel/` (all seven
themes each, so the five non-brand ones no longer show the removed header cluster); the
three `windows-caption-*-SIMULATED/` sets (now with a labelled 138x40 block where the OS
caption buttons would be, so the 94px reservation and the rail's top strut read against
something); every `browser-pane/` story that renders the rail (`trigger-*`,
`composed-*`); and every `chat-run-panel/` story that renders it. A scan of the 161
stories under the five header-bearing titles (`chat-run-panel`, `browser-pane`,
`chat-header-cluster`, `chat-header-identity`, `chat-device`, `session-archive`) found 97
that now draw the rail. 94 were re-captured (2 frames each for the two-palette sets, 12
each for the multi-theme ones); 2 (`interactive-pane`, `interactive-late-page`) have no
committed frames, so nothing of theirs is stale; 1 could not be captured (below).

**Still stale, named:**

- `chat-run-panel/mcp-key-popout/`. Its story presses `[data-mcp-remedy="key"]`, a control
  that does not exist: `deriveMcpServers(fixtures.mcpKeyAuth())` yields a `words` remedy
  ("Manage this server's credentials in Settings") for every row, because the fixture
  publishes no key names (read by running the model on this tree). The frame committed
  on `main` before this branch (opened and viewed) shows the same: no dialog, the three
  `words` rows, so the story has not been able to open its popout since the model and the
  fixture drifted apart, independent of #872. The capture times out preparing it, so its
  frames still show the header cluster this PR removes and must not be read as the shipped
  UI. The three files that decide it (`run-detail-model.ts`, `run-detail-mcp.tsx`,
  `run-details.fixtures.ts`) are not in this PR; fixing the fixture is outside this slice.
- `chat-header-cluster*`, `browser-approval-badges` and the `chat-run-panel/` trigger rows
  captured before the move (the PR #880 list): superseded by the rail frames above.

## Round 1, part 2 (design D2 / D3 / D4; code commit `9f41c633641`)

Every frame that draws the rail moved when D3 landed (the first item is 4px higher), so
the sets that draw it were re-captured after it: `navigation-panel-rail/` (all 16 states,
both palettes), every `shell-app-shell/` directory that draws the rail, `browser-pane/`
and `chat-run-panel/` (all 94 directories that draw it, except the one that cannot
prepare, `mcp-key-popout`, still named above). Readings are taken from the rendered
stories with `getBoundingClientRect` / computed styles, in CSS px:

- **D3, first item vs the band it shares.** At 1280 and at 1192: first item box
  [x, 36, 32, 32], its glyph centre y=52; the `...` glyph centre y=52; the pane close
  centre y=52. Before (design's round-1 reading, not re-measured here): item top 40, glyph centre y=56. Windows simulation: first item top
  44 under a 44px drag strip (the `--chrome-inset-end-h` + 4px padding), header spacer 94,
  unchanged.
- **D2, lit bar vs focus ring.** Focused lit item: bar x=88-90 (on the rail's hairline
  column), ring x=91.5-93.5 (`outline: 2px solid`, offset 1px), item x=94.5. Before (design's reading, and the
  CSS: bar `before:-left-1`, default 2px-offset ring): bar and ring both at x=90.5-92.5 in the same ink. Frame: `navigation-panel-rail/browser-open-focused/`
  shows the ring and the bar together (focus emulation on, as the run panel's remedy-focus
  frame does).
- **D4, count badge.** 14px mark at -2px/-2px, ring 2px. Overlap with the 16px glyph box:
  1-9 -> 5.2 x 4 px = 8.1%; "9+" -> 12.3 x 4 px = 19.2%. The "before" figures (~17% and ~40%
  for the 16px mark) are DESIGN's round-1 readings; I did not re-measure the old mark. The ring ends at x=130.5 of the 132px host (1.5px inside; was flush at 132.5).
  Frame with the item LIT: `navigation-panel-rail/browser-open-at-cap/`.
- **Frames design listed as missing:** `browser-open-focused` (focused lit item),
  `browser-open-at-cap` (9+ on a lit item), `console-open-blip` (blip with the console open),
  and a non-brand-palette proof: `browser-open-focused`, `browser-open-at-cap`,
  `console-open-blip`, `console-open`, `browser-open` and `canvas-open` in `sage` and
  `iceberg` (the rail's ground, lit pair, bar, ring and badge all resolve on those palettes).

## Round 2 (design D11-D14, review R6-R12; code commit named in the PR thread)

### The suppression is measured (D11 / R7 / Q5 / Q6 / D14): two more real-window frames

`useSuppressBrowserViewWhileReaching` registers the page-hiding suppression only when
the open tooltip's painted box overlaps the rect the browser surface reports to main
(`registerBrowserViewRect`, the same `measure(contentRef)` box), and ends it on
document `pointerleave`, `mouseleave` and window `blur` as well as on close. Both frames
are from `harness/capture.mjs` at 1280x900, `--window-mode=inactive`, one self-contained
command each, the Electron process group reaped by exact pid before it returned (no
process survived; checked with `pgrep` after each). Both use `--simulate-run-slot`, so
the rail's items sit where they do in a real conversation (a Run details item above
Browser), and that padding is a position SIMULATION, as in round 1.

- `real-app-r2-console-page-visible.png` - hovering Console. The tooltip "Open console"
  (x 1140.5, y 110.5, 95.9 x 27.4, so it ends at y=138) ends above the view's top (the
  page's orange starts at about y=149, read off the frame at 2x; the DOM toolbar row is above it). `data-suppressed-by` read
  EMPTY and the frame shows the page painted with the tooltip drawn over the URL bar:
  the page is NOT blanked. Before this change it was (round 1's
  `real-app-after-console-in-chrome-band.png`, kept, shows "Paused ...").
- `real-app-r2-canvas-page-suppressed.png` - hovering Canvas. The tooltip "Open canvas
  (cmd+shift+C)" (x 1101.5, y 146.5, 135.0 x 27.4) reaches the view, so it registers:
  `data-suppressed-by` read `panel-rail-tooltip::...`, the page is replaced by the paused
  note and the tooltip is drawn. This is the branch the suppression exists for.

Not measured, and said so: the flash duration (probe P11). A still cannot show it and this
rig takes one screenshot per run; sampling it would need a timed multi-shot capture the
harness does not have, so `browser-view-policy.ts` still lists it as unmeasured. What the
change DOES do is remove the flash for three of the four items and for every item on a
draft (no browser view there).

### The pane at narrow widths (D12 / D13), read from the rendered stories

| window | dock | title | switch labels | pane scrollWidth / clientWidth | empty-state buttons |
|---|---|---|---|---|---|
| 1280 | 496 | shown | whole | 496 / 496 | side by side |
| 1192 | 408 | shown | whole | 408 / 408 | side by side |
| 900 | 320 | shed | whole (was 132.2 of 133.4px, truncated) | 320 / 320 | side by side |
| 800 | 220 | shed | truncated (87 of 109, 37 of 46) | 220 / 220 (was 251 / 220) | stacked, no clipping |

The 800 labels still truncate: with the title gone the switch (~216px) plus the 28px close
and the bar's padding exceeds 220px, and the labels' full text stays in the DOM. That is
the deferred one-width-range work, now with the only visible residue being an ellipsis
rather than a clipped control. Frames re-shot: `shell-app-shell/browser-narrow-900/` and
`browser-narrow-800/`. The 1192 and 1180 frames were re-captured and the committed
files are BYTE-IDENTICAL to before (git reports no change), as the bar is unchanged above 330px.
`browser-pane/` was re-captured as well; the four files that came out different were
compared against HEAD pixel by pixel (more than 24/255 per channel): two have no
differing pixel, and `pane-loading/` differs in 155-165 pixels inside a 32x27 box that is
the loading spinner's rotation angle, so nothing was committed there.

### Lossless stills for the rail set (D16): deferred

`capture-evidence.mjs` writes every frame through `Page.captureScreenshot` at
`format: "webp", quality: 88`, and the evidence gates (`check-evidence.mjs`, the manifest
counts, the `.webp` sweep) are written around that container. A lossless mode for one set
would need a second container the gates do not know, which is a bigger change than this
PR's slice. The geometry readings above come from computed styles and rects, not from
pixels, so they do not depend on it; a single-pixel colour read from these stills loses
chroma (the lit bar reads `1f5225`/`72a47a` here where the lossless render reads
`38c96a`) and should not be quoted.
