# Glass scale: light-theme pane lift and panel-edge recolour

Frames and notes, committed under `docs/pr-evidence/glass-light-scale/`. Evidence for the `feat/glass-light-scale`
change to `damianvtran/local-operator-ui` (AFTER = `a5a4f97203`, BEFORE = `origin/main` `2ff3187db6`). The later
remediation commit on the branch touches no painted rule (it removes a vestigial lane variable edit that painted
nothing), so the AFTER frames stand. The frames are lossy WebP (quality 85) made from the source PNGs; the pixel counts
below were measured on the source PNGs.

## Files

| File | What |
| --- | --- |
| `glass-light-before.webp` / `glass-light-after.webp` | `localOperatorLight`, 1440x900, backdrop veil grey 199 |
| `glass-dark-before.webp` / `glass-dark-after.webp` | `localOperatorDark`, same story, viewport and intensity, veil grey 81 |
| `glass-light-seam-before.webp` / `glass-light-seam-after.webp` | zoomed crop (3x, x 205-845, y 60-290) of the sidebar / canvas / pane seams, light |
| `glass-light-224-before.webp` / `glass-light-224-after.webp` | the light pair again over veil grey 224 (the lighter light material); no seam crops for this grey |

## What changed in the product (what to look for)

- **Light:** the right-hand pane is lifted off the canvas. Pane net alpha `--lo-glass-in-pane` 0.44 (the old
  `--lo-glass-in-elevated` netted to 0), so the pane is effectively 0.82 over the desktop where it was 0.68 (equal to
  the canvas). The three `PanelEdge` seams are recoloured toward ink (`--lo-glass-edge-mix` 0.06).
- **Dark:** byte-identical by design (lift 0, edge mix 0). The dark pair is therefore expected to show **no visible
  difference**. Measured: **0 of 1,296,000 pixels differ** between `glass-dark-before.png` and `glass-dark-after.png` (the two WebP files are byte-identical too).
- Light pixel diff: 573,992 of 1,296,000 pixels differ (max channel delta 25 of 255), all inside the pane area and the
  three 1px seam columns (x 259, 756, 1396). Sidebar, canvas column and rail: 0 changed pixels.

## What is real and what is reconstructed

**Real (the app's own code):** the page layer. Story `shell-app-shell--chat-dock-files` (sidebar, chat column, Canvas
files pane, rail) rendered by Storybook with `?args=theme:<theme>;glass:on;glassIntensity:80`. `glass:on` runs the
shipped `applyGlassFacts` (mechanism `vibrancy`, coverage `full`, material `window`), so `html[data-glass]`, the
`--lo-glass-*` alphas and every `html[data-glass] ...` rule in `src/renderer/src/styles/index.css` are the real ones.
Same story, viewport, intensity and coverage for all frames; BEFORE and AFTER were shot by the same rig script, one
reused headless Chrome per build, on the same machine.

**Reconstructed (NOT the OS):** everything behind the window. Storybook has no Electron and no vibrancy, so the rig
injects one `position:fixed; z-index:-1` layer behind the page: a colourful busy pattern (gradient, colour bars,
text-like stripes), blurred 20px, then veiled with `rgba(G,G,G,.62)`, G = 199 / 81 (the measured `under-window`
material greys, `scripts/derive-glass-floors.mjs` `BACKDROP_GRAY`) and 224 for the extra light pair. The veil opacity
(.62) is the rig's choice, to keep the pattern visible; it is not a measured number. This is a stand-in for the
`under-window` material, not a screenshot of macOS. **The OS blur, the real desktop, the real material's tone shifts and
the window chrome are not shown.** Do not read these frames as how the shipped window looks on a given desktop; read
them as how much the app's own paint layers step off one another over a blurred busy backdrop.

**Story stand-in adjustments (rig-injected, mirror what `app.tsx` does):** the story's stand-in `<main>` and chat
column omit `data-glass-region="canvas-backing"` (`app.tsx:929`) and `="canvas"` (`chat-content.tsx:2430`), so the rig
sets those two attributes after load, otherwise the pane's net-alpha rule (`main[data-glass-region="canvas-backing"]
[data-glass-region="pane"]`) does not select. The rig also clears the Storybook-only `bg-canvas` wrapper
(`#storybook-root > div`) and the stand-in chat column's `.bg-canvas` ground, which the app does not have there, so
`<main>`'s backing alpha is the only canvas layer. The same adjustments apply to BEFORE and AFTER.

## Values read from the page (computed styles, per frame)

Pane = the Canvas root (`[data-canvas-shortcuts]`, `data-glass-region="pane"`). Effective alpha = 1 - (1 - main backing)(1 - pane).

| frame | `--lo-glass-a-canvas` | `--lo-glass-in-pane` | pane background alpha | effective pane alpha | PanelEdge colour (all 3 seams) |
| --- | --- | --- | --- | --- | --- |
| light BEFORE | 0.68 | (unset; `in-elevated` = 0) | 0 | 0.68 | `oklab(0.874201 0.00142148 0.0145946 / 0.75)` |
| light AFTER | 0.68 | 0.44 | 0.44 | 0.821 | `color(srgb 0.811373 0.792235 0.753961 / 0.75)` |
| dark BEFORE | 0.66 | (unset; `in-elevated` = 0.68) | 0.68 | 0.891 | `oklab(0.352807 -0.000793532 0.0255985 / 0.75)` |
| dark AFTER | 0.66 | 0.68 | 0.68 | 0.891 | `color(srgb 0.25098 0.231373 0.172549 / 0.75)` |

The dark edge is the same colour in both builds, serialised differently (`oklab()` before, `color(srgb)` after, since
`color-mix` now computes it); the dark frames are pixel-identical.
Also published after: `--lo-glass-pane-lift` 0.14 / 0 and `--lo-glass-edge-mix` 0.06 / 0 (light / dark).

`backdrop-filter`, all four frames: stylesheet declarations that are not `none` = **3** by this naive walk, but two
are Tailwind's inert utility shells (`.backdrop-blur`, `.backdrop-filter`: `var(--tw-backdrop-*)` placeholders that
resolve to nothing); the single real value is `blur(12px)` (the isolating band, `index.css:2813`). The repo's own
test counts the same way and asserts one over the BUILT renderer stylesheet, where Tailwind drops unused utilities;
Storybook's dev stylesheet keeps them. Elements whose computed `backdrop-filter` is not `none`: **2** per frame,
both the sticky `H3` section headers in the files list (`bg-surface`, `blur(12px)`), identical before and after.
So no backdrop-filter was added by the change.

## Limits

- A reconstruction over an invented backdrop. It shows relative layer steps, not the real desktop.
- One story (Canvas files pane open, no scroll, no hover), one viewport (1440x900, DPR 1; seam crop DPR 3), one
  intensity (80), coverage full.
- Colour is whatever Chrome headless composites in sRGB (`--force-color-profile=srgb`).
