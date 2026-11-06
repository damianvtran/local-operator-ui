# Notifications glass — group headers and the read-state switch

Operator report, 2026-11-05: the group headers ("Waiting on you 1", "Today 1")
painted as solid dark bars across a glass panel, and the Unread/All switch was
equally opaque — "holes punched in the backdrop rather than layers on it".

## How these frames were taken

`scripts/notifications-glass-evidence.mjs`, driving the **built app** headless over
CDP — not a Storybook story. The previous set used Storybook and was withdrawn
(design review round 1, D1): that surface paints its own opaque canvas, so a
header at full opacity and a header at the band's floor photographed the same,
and several before/after pairs came out byte-identical. The claim under test is
composition over a translucent column, so the evidence is the real window: the
app's own shell, its own `<main>` backing at the user's alpha, its own rows.

The app is launched by its Electron binary with `--window-mode=headless`,
`--window-size=1024x657` (the operator's own viewport), a per-run
`--user-data-dir`, `--use-mock-keychain`, the notification and telemetry
switches, `HOME` redirected and `CMUX_*`/`XPC_FLAGS` stripped; the frame is the
app's own CDP `Page.captureScreenshot`, never macOS `screencapture`. Every boot is
reaped by exact pid through `scripts/app-tree-teardown.mjs`. Frames are 2× DPR of
a 1024×657 viewport.

Glass goes through the appearance row's own IPC (`window.api.windowGlass.set`),
and the palette is seeded into the store the app reads at boot.

### The lane: an isolated backend with real rows

A group header only exists when notifications do. The run uses its own core config
directory (`LOCAL_OPERATOR_CONFIG_DIR`) with a `lo serve` on it and rows written
through the core's own `NotificationStore.notify(...)` — the API the `notify` tool
writes through, not a fixture — spread over today / yesterday / four days ago so
the reel has three groups and scrolls.

### The commands

```bash
OUT=docs/pr-evidence/notifications-glass

# the head half — the branch as shipped
for c in dark-80 dark-50 light-80 light-50 dark-80-glass-off dark-80-scrolled; do
  node scripts/notifications-glass-evidence.mjs --repo . --out $OUT \
    --label head-$c --case $c --config "$LANE"
done

# the base half — a REAL build of the base commit, not an attribute trick
git worktree add /tmp/notif-glass-base b51c802993b
ln -s ../../node_modules /tmp/notif-glass-base/node_modules && cp .env /tmp/notif-glass-base/
(cd /tmp/notif-glass-base && node_modules/.bin/electron-vite build)
for c in dark-80 dark-50 light-80 light-50; do
  node scripts/notifications-glass-evidence.mjs --repo /tmp/notif-glass-base --out $OUT \
    --label base-$c --case $c --config "$LANE"
done
```

`--before-attributes` additionally captures each cell twice inside one build with
the two glass attributes removed, which is the control that the attributes — and
nothing else — move the numbers.

## The matrix

| frame | case | what it shows |
| --- | --- | --- |
| `head-dark-80.png` / `base-dark-80.png` | dark, 80 % | the reported view: headers and switch at the default intensity |
| `head-dark-50.png` / `base-dark-50.png` | dark, 50 % | the other end of the shipped slider |
| `head-light-80.png` / `base-light-80.png` | light, 80 % | the light scheme, same floors |
| `head-light-50.png` / `base-light-50.png` | light, 50 % | the light scheme at that end |
| `head-dark-80-glass-off.png` | dark, translucency OFF | the opaque fallback: same classes, no glass, nothing half-applied |
| `head-dark-80-scrolled.png` | dark, 80 %, list scrolled | a row passing UNDER the pinned header, with the 1:1 band crop `head-dark-80-scrolled-band.png` |

Each PNG has a sibling `.readback.json`: the header's computed colour and alpha
against `--lo-glass-a-band-floor` and `--lo-glass-a-elevated`, its
`backdrop-filter` and `position`, the page's `<main>` backing alpha, the switch
track's alpha against `--lo-glass-a-field`, the checked and unchecked segments'
alphas, and the label's and count's computed colours.

## Measured

The numbers, not the pixels, are the claim.

| cell | header alpha | floor (elevated) | page backing | track / checked |
| --- | --- | --- | --- | --- |
| base dark 80 | **1.0** | 0.88 (0.74) | 0.62 | none / none — no marked well |
| head dark 80 | **0.88** | 0.88 (0.74) | 0.62 | 0.05 / **0.08** |
| base dark 50 | **1.0** | 0.88 (0.82) | 0.75 | none / none |
| head dark 50 | **0.88** | 0.88 (0.82) | 0.75 | 0.05 / **0.08** |
| base light 80 | **1.0** | 0.78 (0.55) | 0.68 | none / none |
| head light 80 | **0.78** | 0.78 (0.55) | 0.68 | 0.05 / **0.08** |
| base light 50 | **1.0** | 0.78 (0.71) | 0.78 | none / none |
| head light 50 | **0.78** | 0.78 (0.71) | 0.78 | 0.05 / **0.08** |
| head dark 80, glass off | 1.0 | — (no glass vars) | — | 1.0 / 1.0 |
| head dark 80, scrolled | 0.88 | 0.88 (0.74) | 0.62 | 0.05 / 0.08 |

The head's header is `max(elevated, band floor)` with `backdrop-filter: blur(12px)`
and `position: sticky`, `top: 0`, `z-index: 1`, 32 px tall — geometry unchanged
from the base, which measures the same rect. The base paints the same element at
alpha 1.0 with no blur: that is the seam the operator reported.

**What the floor buys.** At 80 % the wallpaper reaches the eye at 4.6 % through
the band (3.0 % at 50 %) against 38 % through the page (25 %); the band's step
against the page runs 1.07:1 (light scheme over a bright wallpaper) to 2.62:1
(dark scheme over one). Read off these frames' own colours and alphas.

## Not in this set

- **A contrast preset.** The shipped app has no writer for the v5 contrast field
  yet (`src/renderer/src/shared/themes/appearance.ts` records the same status), so
  a preset can only be reached by seeding the store. The seed does compose
  (`data-theme` becomes `lo-<hash>`), but it did not survive reliably in this
  headless lane, and a cell that sometimes photographs Standard under a preset's
  name is worse than no cell. The preset's numbers are carried by the derivation
  instead (`src/shared/glass-derivation.mjs`, `deriveBandFloor`), which is the
  same function the renderer's live path calls.
- The real app window with macOS vibrancy behind it (native lane). A headless
  window has no compositor backdrop, so the desktop behind these frames is the
  app's own black: they are evidence about the composition the app paints, never
  about a wallpaper.
- The chat rail's updates drawer switch (`data-glass-well` added there too): the
  pane arm composes it and its track reads the pane's field overlay, but it only
  renders over a live conversation and this isolated lane has none.
