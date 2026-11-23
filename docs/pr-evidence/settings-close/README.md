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
| `after-narrow-800-dark` | at 800 CSS px (the window's floor) the scroller's `pe-14` keeps the measure clear of the pinned plate: the search field's right edge is 23 px left of the glyph |
| `before-rtl-ur-dark` / `after-rtl-ur-dark` | with the app in Urdu the document is RTL and the control mirrors to the inline-end = the LEFT edge, still 16px in |
| `esc-focus-on-gear-dark` | opened with a real mouse press on the sidebar gear, so focus is ON the gear: the state round 1's four reviewers measured Esc dead in |
| `esc-focus-on-rail-dark` | the same after a press on a section rail row, a sibling of the content column |
| `esc-tooltip-open-dark` | the X focused, its tooltip open (now `side="left"`, clear of the search field), one Esc closing the page |
| `esc-recorder-armed-dark`, `esc-recorder-after-dark` | Esc on an armed shortcut recorder cancels the capture and leaves the page open: the cue clears, the chord and the layout do not move. Measured diff: every differing pixel lies in the recorder's field, `(644,446)-(860,486)` of 1380x900 |
| `esc-page-closed-dark` | after the page closes: the destination that focuses nothing (`/library`) has handed the keyboard back to the gear |

The scene's output for this head: **54 PASS, 0 FAIL**, `rc=0`, including one
Esc from the gear, one from a rail row, one from the page body, one empty search
field, one closed combobox trigger (the second press after the list closed), and
one on the focused X with its tooltip up. No process from the run outlived it.

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
- **The RTL frame is a real locale switch, not a mirrored mock.** The daemon
  offers `ur` in the picker, the scene arrows to it and commits with Enter, and
  then switches back to English so a re-run starts where this one did.
- **The 800 px frame is an emulated viewport** (`Emulation.setDeviceMetrics-
  Override`), the same instrument the design round used; it is the window's own
  `minWidth`.
- **What no frame here shows:** the Windows/Linux caption-button geometry (the
  route band already sits above the column there; judged from CSS, unrendered),
  and the page-level loading/error/no-config states. Those three states now
  carry the same surface and Esc scope (source, `settings-page.tsx`'s
  `stateSurface`), but they were not rendered - producing a config failure needs
  a daemon that refuses.
- **The tour's Back/Next fix is not in a frame.** It is `tourGearNeedsClick`
  (`tour-gear-open.ts`), asserted in `scripts/settings-close.test.mjs`; QA round
  1's repro drove the real tour. The next QA round can re-walk it.
