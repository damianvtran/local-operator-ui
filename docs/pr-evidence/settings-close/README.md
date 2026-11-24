# PR evidence: closing the Settings page (close button, Esc, gear toggle)

Before/after of the desktop Settings route. `before-*` is the base tree,
`origin/main` at `58aabaed9a`; every other frame is this branch, rebuilt and
re-photographed for remediation round 1 (`7b4da60ea8` -> the head named on the
PR). Every frame is the **built app**, launched headless and photographed by its
own `webContents.capturePage()` through `scripts/renderer-driver.mjs --scene
settings-close`, against an isolated daemon that run owned.

## What the frames show

| Frame | Claim |
|---|---|
| `before-dark` / `after-dark` | the same Settings route before and after: the branch adds the 32x32 X at the content column's top inline-end corner, 16px in, level with the title |
| `before-light` / `after-light` | the same pair in `localOperatorLight` |
| `before-narrow-900-dark` / `after-narrow-900-dark` | at 900 CSS px the rail is its 48px icon column; the control holds its 16px inset |
| `after-narrow-800-dark` | at 800 CSS px (the window's floor) the scroller's `pe-14` keeps the measure clear of the pinned plate: the search field's right edge is 16 px left of the glyph |
| `before-rtl-ur-dark` / `after-rtl-ur-dark` | with the app in Urdu the document is RTL, the control mirrors to the inline-end = the LEFT edge (16px in), and the glyph clears the search field's leading edge (measured 16 px at 1380, round 2) |
| `after-width-800-{dark,light}` | at 800 CSS px: the scroller's `pe-14` holds; search-field edge to glyph = 16 px |
| `after-width-1100-{dark,light}` | 1100 CSS px: gap 16 px |
| `after-width-1380-{dark,light}` | 1380 CSS px: gap 16 px |
| `after-width-1500-dark` | 1500 CSS px, past the 1496 step: base `p-8` restores a centred measure (margins 58/66, the 8 px being the scroller's scrollbar) and the gap grows to 18 px |
| `esc-hover-tooltip-dark` | the X's tooltip shown by HOVER with focus still on the gear: one Esc closes the page (round 3: Q-8) |
| `state-config-error-dark` | the config-error state (daemon down) with the same surface: column top 0, X plate top 64 - the loaded page's own numbers - and Esc leaves |
| `esc-focus-on-gear-dark` | opened with a real mouse press on the sidebar gear, so focus is ON the gear: the state round 1's four reviewers measured Esc dead in |
| `esc-focus-on-rail-dark` | the same after a press on a section rail row, a sibling of the content column |
| `esc-tooltip-open-dark` | the X focused, its tooltip open (now `side="left"`, clear of the search field), one Esc closing the page |
| `esc-recorder-armed-dark`, `esc-recorder-after-dark` | Esc on an armed shortcut recorder cancels the capture and leaves the page open: the cue clears, the chord and the layout do not move. Measured diff: every differing pixel lies in the recorder's field, `(644,446)-(860,486)` of 1380x900 |
| `esc-page-closed-dark` | after Esc closes the page into `/chat`, where the draft's composer takes focus (the composer case) |
| `esc-focus-return-library-dark` | after the X closes the page into `/library`, which focuses nothing: the keyboard is back on the gear (round 2: U6/M4) |

The scene's output for this head: **93 PASS, 0 FAIL**, `rc=0`, including one
Esc from the gear, one from a rail row, one from the page body, one empty search
field, one closed combobox trigger (the second press after the list closed), one
on the focused X with its tooltip up, and one with a tooltip that was already
open when the page mounted by hash (round 2: U8/Q-7), and one on a tooltip shown
by HOVER while focus sat on the gear (round 3: Q-8). The clearance matrix is
measured at 800/1100/1280/1380/1463/1464/1495/1496/1500/1728 in both palettes:
**16 px** at every width up to 1495 (15.5 at 1495 itself - a half-pixel rounding
of the box, not a layout shortfall), then 16 px at 1496, 18 px at 1500 and 132 px
at 1728 as the centred 896 px measure takes over. From 1496 up the measure is
centred in the column once the scroller's 8 px scrollbar is excluded (margins
56/64, 58/66, 172/180 = start / end-without-scrollbar). The config-error scene
adds **11 PASS** with the daemon down (5 at round 2; the driver's later
geometry readings add checks), X plate top 64 there too. No process from either
run outlived it.

**The column that pads.** `panel-flush` moves a root to y0 and pads nothing, so
the pad has to be visible in the file that owns the root: the content column -
`data-glass-region="canvas-content"`, `panel-top-pad` - is rendered in
`settings-page.tsx` beside the flush root, and only the button plus the Esc scope
ride in `settings-close-surface.tsx`. The tree-wide guard
`scripts/lane-leading.test.mjs` reads that file for the pairing (round 4's merge
gate: the column had moved into the surface module and the guard saw a flush root
with no pad). Rendering is unchanged: X `{"x":1332,"y":64,"w":32,"h":32}` at 1380
and the same plate top in the config-error state, both measured on this head.

**Files run for this round** (one bounded `node` process at a time, 1536 MB):
`scripts/lane-leading.test.mjs` (10/10), `scripts/settings-search-annotations.test.mjs`
(8/8), `scripts/typed-row-call-sites.test.mjs` (4/4),
`scripts/panel-chart-motion.test.mjs` (4/4), `scripts/settings-section-routes.test.mjs`
(5/5), `scripts/settings-close.test.mjs` (17/17), plus the two recorder files
(32/32, 10/10) and `scripts/keyboard-shortcuts-section.test.mjs` (14/14) from
round 3. `node scripts/affected-tests.mjs` selects 807 files for this diff
(800 affected + 7 guards) and includes `scripts/lane-leading.test.mjs`.

## How it was reproduced

```bash
# 1. An isolated daemon (HOME and config under this run's rig root), port 18923.
cd <rig root> && HOME=$PWD/home LOCAL_OPERATOR_CONFIG_DIR=$PWD/config lop serve --port 18923
# 2. The renderer, built against that port (3072 MB heap: this host's rollup
#    pass exhausts 1536). The build refuses to start without the OAuth ids its
#    config plugin requires; they are unused by this scene, so any non-empty
#    value does ("rig-unused"). PostHog key empty, host a valid URL.
NODE_OPTIONS=--max-old-space-size=3072 \
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18923 \
VITE_RADIENT_SERVER_BASE_URL=https://api.radienthq.com \
VITE_DISABLE_BACKEND_MANAGER=true LOCAL_OPERATOR_UI_TELEMETRY=off \
LOCAL_OPERATOR_UI_NO_BYTECODE=true ./node_modules/.bin/electron-vite build
# 3. The scene, with the daemon's record for the token.
LOCAL_OPERATOR_DESKTOP_TOKEN=<daemon access_token> node scripts/renderer-driver.mjs \
  --scene settings-close --backend http://127.0.0.1:18923 \
  --backend-records <rig>/config/run/serve --out <frames dir> --seed-onboarding-complete
```

## Limits, stated rather than implied

- **The "before" behaviour frames do not exist, and cannot.** The base tree has
  no close button and no Esc scope, so the new focus cases (`esc-focus-on-*`)
  have nothing to photograph there. What the previous head did on those states
  is on the record from execution, not from a still: the design round's
  sequencer (`document.activeElement` on the gear, `inCol:false`, then Esc ->
  route unchanged) and the QA round's matrix rows 2.4-2.7 (`FAIL Q-1`), both run
  against `7b4da60ea8`. The `before-*` layout frames above are that tree.
- **The recorder pair differs in exactly one box, and the README says which.**
  Every differing pixel lies in the recorder's own field - the capture cue's
  border clearing when Esc cancels. Nothing else on the page moved, the chord
  reads the same in both, and the page stays open.
- **The width matrix is emulated viewports** (`setDeviceMetricsOverride`), the
  same instrument the design round used; the measured gaps are in this README's
  table and the scene's own `[note] glyph-to-search clearance by width`. The
  padding step is `md:max-[1495px]:pe-14`: a bare arbitrary `max-[…]` sorts
  BEFORE `md:p-8` in Tailwind's emitted CSS and never wins (round 3: m1/D9/Q-9,
  measured: 56 px at every width), and a step at 1464 puts the field's edge on
  the plate (design round 3: gap 0).
- **The RTL frame is a real locale switch, not a mirrored mock.** The daemon
  offers `ur` in the picker, the scene arrows to it and commits with Enter, and
  then switches back to English so a re-run starts where this one did.
- **The 800 px frame is an emulated viewport** (`Emulation.setDeviceMetrics-
  Override`), the same instrument the design round used; it is the window's own
  `minWidth`.
- **What no frame here shows:** the Windows/Linux caption-button geometry (the
  route band already sits above the column there; judged from CSS, unrendered),
  and the loading and no-config states (a config failure is rendered -
  `state-config-error-dark`; a spinner and a settled-empty config are not).
- **The tour's Back/Next fix is not in a frame.** It is `tourGearNeedsClick`
  (`tour-gear-open.ts`), asserted in `scripts/settings-close.test.mjs`; QA round
  1's repro drove the real tour. The next QA round can re-walk it.
