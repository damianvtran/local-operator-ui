# Floating surfaces separate by ground and elevation, not a border

The operator's report (2026-11-06): every floating surface — tooltips, menus,
popovers, hovercards, dialogs — drew a 1px outer stroke, against the style guide.
This PR takes the stroke off and separates the panel by ground contrast plus the
one elevation shadow, on every theme including window glass.

Every frame here is one of two kinds, and each sheet says which:

- **Real app** — the built app (`out/`) of each tree, launched headless with
  `--window-mode=headless`, photographing itself through the gated dev driver's
  `capturePage()`; the pointer is moved through Chromium's input pipeline
  (`Input.dispatchMouseEvent`), never a synthesised DOM event. One isolated daemon
  (127.0.0.1:8080, scratch HOME/config, a team and one conversation renamed
  *"Configure alert disposition types per tenant feed (Minerva Development)"*)
  served every run, so only the tree differs between a pair.
- **Storybook** — the tree's own Storybook (`scripts/with-storybook.mjs`), headless
  Chrome through `scripts/chrome-keychain.mjs`, `iframe.html?…&args=theme:<t>[;glass:on]`
  (the args `scripts/capture-evidence.mjs` uses).

| tree | ref | commit | tree object |
| --- | --- | --- | --- |
| BEFORE | base | `cff518c396e` | `74d3cc49362` |
| AFTER | `fix/floating-surface-elevation` | `2fbc0b6e894` | `a98666c466e` |

`cff518c396e..20fdd3f48f2` (the fix's true parent) touches no `src/renderer` file,
so the BEFORE build is renderer-equivalent to the fix's parent.

## Frames

| file | path | what it shows |
| --- | --- | --- |
| `PAIRS--session-row-tooltip.png` | real app | the conversation row's flyout, hovered; rows = dark/glass off, dark/glass on, light, high-contrast light; left before, right after |
| `PAIRS--canvas-rail-tooltip.png` | real app | the canvas rail's "Open run details" tooltip, same four rows |
| `PAIRS--profile-popover.png` | Storybook | `Team Bridge/Rail rows › AvatarHoverOpensCard` (the real `TeamBridgeProfileCard`), same four rows; the Message action moves from outlined to the new `tonal` fill |
| `PAIRS--sidebar-overflow-menu.png` | real app | the sidebar row's overflow menu **opened by a pointer press with no keyboard event in that boot** (the round-1 failure path), same four rows |
| `GLASS-COMPOSITE--black-white.png` | real app, **composite** | the three real-app glass-on panels, before and after, with the capture's own alpha composited over black and over white |
| `PAIR--panel-over-panel--dark.png` | Storybook | `Design system/Primitives › DropdownOpen`: a submenu open over its menu, localOperatorDark |
| `PAIR--dialog-footer.png` | Storybook | `Common/ConfirmationModal › Ordinary`, dark and light: the shared dialog footer, whose `SecondaryButton` is now the `tonal` variant |
| `FORCED-COLORS--menu.png` | real app, after only | the pointer-opened menu, normal and under CDP `Emulation.setEmulatedMedia` `forced-colors: active`, where the PR draws a 1px `CanvasText` border by design |
| `STRIP--after.png` | real app, after only | consecutive frames at rAF 0, 1, 2, 4, 8 and settled: canvas-rail tooltip (hover) and the pointer-opened menu, localOperatorDark |

Glass-on rows in the `PAIRS` sheets are the RGBA capture flattened over black.

## Measurements

Read from the live DOM in the same boot as the frame (`getComputedStyle` on the
panel; `data-theme` / `dataset.glass` on the root), plus a pixel triple from the
frame itself. **Δ** is the largest RGB channel difference between the panel's
top-edge pixel and the pixel 4 CSS px above it (the page outside). Before, the
edge pixel was the border; after, it is the panel ground, so Δ is now ground
against page, and the shadow (offset downward) darkens the page *below* and
beside the panel more than above it.

| surface | path | cell | border-top → after t/r/b/l | shadow before → after | ground α b/a | edge/outside before (Δ) | edge/outside after (Δ) | viewport |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| session-row-tooltip | real app | localOperatorDark--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#3a3629`/`#24211c` (22) | `#2e2a20`/`#24211c` (10) | 1440x900@2 |
| canvas-rail-tooltip | real app | localOperatorDark--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#3a3629`/`#1d1b17` (29) | `#2e2a20`/`#1d1b17` (17) | 1440x900@2 |
| profile-popover | Storybook | localOperatorDark--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#3b3627`/`#25211b` (22) | `#2f2a1f`/`#25211b` (10) | 900x640@2 |
| sidebar-overflow-menu, pointer-opened | real app | localOperatorDark--glass-off | 1px→0px/0px/0px/0px | none → yes (3 layers) | 1/1 | `#3a3629`/`#1d1b17` (29) | `#2e2a20`/`#1c1a16` (18) | 1440x900@2 |
| sidebar-overflow-menu, after Escape (round-1 path) | real app | localOperatorDark--glass-off | 1px→0px/0px/0px/0px | none → yes (3 layers) | 1/1 | `#3a3629`/`#1d1b17` (29) | `#2e2a20`/`#1c1a16` (18) | 1440x900@2 |
| session-row-tooltip | real app | localOperatorDark--glass-on | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 0.75/0.75 | `#716e62`/`#24211d` (77) | `#2e2a21`/`#24211d` (10) | 1440x900@2 |
| canvas-rail-tooltip | real app | localOperatorDark--glass-on | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 0.75/0.75 | `#716e62`/`#1d1b16` (84) | `#2c281e`/`#1d1b17` (15) | 1440x900@2 |
| profile-popover | Storybook | localOperatorDark--glass-on | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 0.75/0.75 | `#726d60`/`#25211b` (77) | `#2d281e`/`#25211b` (8) | 900x640@2 |
| sidebar-overflow-menu, pointer-opened | real app | localOperatorDark--glass-on | 1px→0px/0px/0px/0px | none → yes (3 layers) | 0.75/0.75 | `#716e62`/`#1d1b17` (84) | `#2c271e`/`#1d1b16` (15) | 1440x900@2 |
| sidebar-overflow-menu, after Escape (round-1 path) | real app | localOperatorDark--glass-on | 1px→0px/0px/0px/0px | none → yes (3 layers) | 0.75/0.75 | `#716e62`/`#1d1b17` (84) | `#2c271e`/`#1d1b16` (15) | 1440x900@2 |
| session-row-tooltip | real app | localOperatorLight--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#d9d5cc`/`#f4f2ec` (32) | `#fefdfa`/`#f4f2ec` (14) | 1440x900@2 |
| canvas-rail-tooltip | real app | localOperatorLight--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#d9d5cc`/`#f0ece3` (23) | `#fefdfa`/`#f1ede4` (22) | 1440x900@2 |
| profile-popover | Storybook | localOperatorLight--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#dad5cb`/`#f4f2eb` (32) | `#fefdfa`/`#f4f2eb` (15) | 900x640@2 |
| sidebar-overflow-menu, pointer-opened | real app | localOperatorLight--glass-off | 1px→0px/0px/0px/0px | none → yes (3 layers) | 1/1 | `#d9d5cc`/`#f1ede4` (24) | `#fefdfa`/`#eeeae1` (25) | 1440x900@2 |
| sidebar-overflow-menu, after Escape (round-1 path) | real app | localOperatorLight--glass-off | 1px→0px/0px/0px/0px | none → yes (3 layers) | 1/1 | `#d9d5cc`/`#f1ede4` (24) | `#fefdfa`/`#eeeae1` (25) | 1440x900@2 |
| session-row-tooltip | real app | highContrastLight--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#c4c4c4`/`#f0f0f0` (44) | `#ffffff`/`#f0f0f0` (15) | 1440x900@2 |
| canvas-rail-tooltip | real app | highContrastLight--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#c4c4c4`/`#e5e5e5` (33) | `#ffffff`/`#e6e6e6` (25) | 1440x900@2 |
| profile-popover | Storybook | highContrastLight--glass-off | 1px→0px/0px/0px/0px | yes → yes (3 layers) | 1/1 | `#c4c4c4`/`#f0f0f0` (44) | `#ffffff`/`#f0f0f0` (15) | 900x640@2 |
| sidebar-overflow-menu, pointer-opened | real app | highContrastLight--glass-off | 1px→0px/0px/0px/0px | none → yes (3 layers) | 1/1 | `#c4c4c4`/`#e6e6e6` (34) | `#ffffff`/`#e4e4e4` (27) | 1440x900@2 |
| sidebar-overflow-menu, after Escape (round-1 path) | real app | highContrastLight--glass-off | 1px→0px/0px/0px/0px | none → yes (3 layers) | 1/1 | `#c4c4c4`/`#e6e6e6` (34) | `#ffffff`/`#e4e4e4` (27) | 1440x900@2 |

`dataset.glass` is `sidebar canvas pane` on every glass-on cell and absent on the
others; `data-theme` matches the cell on every frame.

### The overflow menu's shadow (design round 1, D1)

The pointer-opened menu matches `:focus-visible` on both trees (Radix focuses the
content on open, and Chromium carries the modality to it). Before, that match fed
`html :focus-visible { box-shadow: none !important }` and the menu had no shadow:

```
before  menu-pointer focus (pointer-only history) -> {"menuFocusVisible":true,"menuFocused":true,"loFloating":false,"boxShadow":"none"}
after   menu-pointer focus (pointer-only history) -> {"menuFocusVisible":true,"menuFocused":true,"loFloating":true,
        "boxShadow":"… color(srgb 0 0 0 / 0.27) 0px 0px 2px -1px, color(srgb 0 0 0 / 0.27) 0px 2px 6px -3px, rgba(0, 0, 0, 0.6) 0px 12px 32px -12px"}
```

The same menu opened after an Escape (the round-1 rig path) now computes the same
three-layer shadow in all four cells (table rows "after Escape").

### Glass, composited

`capturePage()` cannot render the OS vibrancy behind a window, so the glass rows
are a **composite**, not an OS capture: the capture's own alpha (window grounds
α≈0.62, panels α 0.75 over them) laid over a flat black and a flat white desktop —
the same arithmetic as `scripts/notifications-glass-composite.mjs`. A horizontal
profile through each panel's left edge (max channel, 2 device px per step):

```
menu  before over black  25 25 25 25 113 43 43 46     (113 = the light rim)
menu  after  over black  23 22 22 21  43 43 43 46     (no rim; shadow darkens toward the edge)
menu  before over white 112 112 112 112 113 51 51 48
menu  after  over white 101 99 97 93  51 51 51 48
```

The profile popover is not in the composite: Storybook's page paints an opaque
ground, so even with `Emulation.setDefaultBackgroundColorOverride` alpha 0 the
capture came back RGB (3 channels), and a composite of an opaque frame is the frame.

### Panel over panel and dialog

Submenu over menu, dark, after: both panels `0px` border, three-layer shadow,
ground `rgb(47, 42, 31)`, `data-lo-floating`. Dialog footer: `Cancel` moves from
`1px rgb(131,124,109)` on `rgb(38,34,28)` (dark) / `1px rgb(133,127,112)` on
`rgb(247,245,238)` (light) to borderless `rgb(23,21,18)` / `rgb(236,230,216)`; the
dialog panel itself goes `1px → 0px` with the contact layers added.

### Forced colors

`matchMedia("(forced-colors: active)")` → `true`; the menu computes
`border 1px solid rgb(255, 255, 255)` (CanvasText), `box-shadow: none`.

### Consecutive frames

Every tick reads opacity 1, transform none, 0 running animations and border `0px`.
rAF 0 is Radix's pre-position (off-screen, `top < 0`); `capturePage()` trails its
request by about one frame, so rAF 1 shows no panel either; from rAF 2 the panel is
identical to settled — no flash, no border, no reflow.

## What the frames show (read against each before)

- **No after frame draws a stroke** outside forced colors; every panel computes `0px` on all four sides.
- **Overflow menu:** a visible drop in all four cells now. On light and high-contrast it reads as a lifted card
  (page darkens to `#eeeae1` / `#e4e4e4` under the panel); on dark the drop is subtle (ground 28 → 20 in the
  12 device px below the panel) and the panel separates mostly by ground (`#2e2a20` on `#1c1a16`).
- **Light / HC tooltips and popover:** white panel on an off-white page plus a soft drop. Separation is quieter
  than the old grey ring, but it is there: an object, not a box.
- **Glass:** the light rim the before panels drew on dark glass (`#716e62`, Δ 77–84) is gone. Over black the
  panel sits one ground step above the window with no glow; over white it reads as a dark panel with a soft
  shadow, text fully legible. No light halo on either backdrop.
- **Panel over panel (dark):** both panels share one ground, so where the submenu overlaps its menu (≈4 CSS px)
  the only edge is the contact shadow (≈6 levels). It reads because most of the submenu sits over the page,
  not because the overlap is crisp.
- **Dialog footer:** `Cancel` is a borderless tonal fill one step off the dialog ground — darker on dark, beige on
  light — beside the unchanged accent primary.
- **Forced colors:** the menu gets its 1px `CanvasText` border. In that mode the inset divider disappears and the
  disabled "Move up" is not visibly dimmed. No base-tree forced-colors frame was shot, so whether either predates
  this PR is not shown here.

## Commands

The rigs are untracked scratch (they boot whichever worktree `--repo` names, so the
identical file shoots both trees):

```bash
# daemon: seeded once (v2-seed-daemon.sh), restarted for this round on the same root, fresh bearer
bash restart-daemon.sh <daemon-root>
# real app, per cell (theme ∈ localOperatorDark|localOperatorLight|highContrastLight, glass on|off)
RIG=rig-v2.mjs SURFACE=all                 bash v3-run-cell.sh <tree> <theme> <glass> <theme>--glass-<glass> <out>
RIG=rig-v3.mjs SURFACE=session-row-tooltip bash v3-run-cell.sh …
RIG=rig-v4.mjs SURFACE=menu-pointer        bash v3-run-cell.sh … [--forced-colors]   # both trees
RIG=rig-v4.mjs SURFACE=frame-strip         bash v3-run-cell.sh … --pointer-only     # after, dark/off
# Storybook
node scripts/with-storybook.mjs -- node sb-profile-popover.mjs <tree> <out> <before|after>
node scripts/with-storybook.mjs -- node sb-r2.mjs <tree> <out> <before|after>
```

`rig-v4.mjs` is `rig-v3.mjs` plus an exact-gated `menu-pointer` surface and a
`--pointer-only` flag that dismisses with a pointer press instead of Escape (Escape
flips Chromium's focus-visible modality). Without that flag it does what v3 does.

## Gaps

- **The real-app profile popover is behind a Radient sign-in gate** (Team Bridge:
  "You're signed out. Sign in to use Team Bridge."), so Storybook stands in; it
  mounts the same `PopoverContent` the fix changes.
- **Vibrancy is composited**, not captured: no OS material, no blurred wallpaper.
  The alpha is the app's own; the backdrop is a flat black or white.
- The session-row and canvas-rail BEFORE frames are round 1's, shot against the same
  daemon and rig; the overflow menu's BEFORE was re-shot this round so its pair
  shares the pointer-only path.
- Dialog, submenu and the forced-colors frame cover localOperatorDark (and light for
  the dialog), not all four cells.
