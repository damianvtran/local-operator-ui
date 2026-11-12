# Conversation-loading indicator: before/after evidence

The operator asked for one consistent, clearly visible loading indicator for every
conversation-loading case: cold open, stale-cache revalidate, older-messages lazy load and
remote (mesh) session sync. It should follow the theme (light and dark), support
translucency, and cause no layout shift or flicker. Every frame here is the built app
photographing itself with `webContents.capturePage()`. For each case, BEFORE and AFTER were
taken by the same rig bytes with the same fixture and the same steps.

| | |
|---|---|
| BEFORE | `c1ba44696` (origin/main base), built with `src/` clean at build start and end |
| AFTER | **`c85b0cc95`** (`80a346fd5` implementation, `79f3126b4` i18n audit, `7887d0bf0` review round 1, `c85b0cc95` D-M1 mark). Every AFTER frame, matrix, filmstrip, reading and `mark.png` here was captured at `c85b0cc95`, built with `src/` clean and HEAD verified at build start and end. |
| Round 1 | `7887d0bf0`: the previous head (pulsing 8 px dot). It is used only as the geometry baseline in `geometry-dm1.json`, from the same rig bytes and fixture. |
| Runtime | Electron 45.1.0, app 0.54.2, Linux under Xvfb, `--window-mode=headless` (window never shown: `visible=false focused=false`) |
| Viewport | 1380x872 CSS px at DPR 1. The app's own `capturePage()` reported this viewport for every frame. |
| Palettes | `localOperatorLight`, `localOperatorDark`, set through the dev-driver `setTheme` verb (the settings picker's own action) |
| Times | Pinned to `America/New_York` by the shared driver. The fixture timestamps are fixed in 2025, so the sidebar reads `1y`. |

## Files

| File | Shows |
|---|---|
| `matrix-light.png`, `matrix-dark.png` | Four rows (cold, stale, older, remote) by two columns (BEFORE, AFTER). Each cell is a 1:1 crop (x 262-1212) of the loading frame around the indicator. |
| `matrix-glass-sim.png` | AFTER only, light and dark, with the **glass simulation** (see the limitation below). It is **not proof of real translucency.** |
| `after-<case>-<theme>.png` | Full 1380x872 AFTER frames with glass off, lossless (pixel-identical to the raw capture). |
| `sequence-<case>-<theme>.png` | 12 consecutive AFTER `capturePage()` frames around the release of the held read: 3 before the release, 9 after. Each frame is cropped to the indicator plus the last row and shown at 50%. Each caption gives two readings. `image:` is what the pixels show: the indicator by a label-region match, and rows by ink in the transcript area. `DOM@t` is the rAF sampler at the moment the shot started: the indicator, the row count and the last row's `y`. |
| `mark.png` | The D-M1 mark on a cold open, light and dark: six frames across one rotation of the 16 px `Spinner` (the shared `sm` size: a 1 px `border-control` track with an accent arc, `animate-spin`), each with the measured arc and track contrast, then a **reduced-motion** still (CDP `Emulation.setEmulatedMedia`, `prefers-reduced-motion: reduce`) showing the static ring and arc, with the label-on-pill contrast. Crops are shown at 3x nearest-neighbour. |
| `geometry-dm1.json` | The geometry proof, `c85b0cc95` vs `7887d0bf0`, for every case, theme and glass mode: slot height, indicator height and y, last row y (loading and settled), scroller `scrollHeight` (loading and settled), and the distinct last-row y and `scrollHeight` values over every rAF sample of each phase. |
| `rects-summary.json` | For all 16 runs (4 cases x 2 themes x glass off/sim): the shift and flicker readings BEFORE vs AFTER (table below), per-run contrast measured from pixels, and `markSpin`, the arc and track contrast over a full rotation. |

## The rig

A loopback fixture speaks the production desktop HTTP/SSE contract, and its conversation
reads can be **held** and **released**. The real app is driven through the shared
`scripts/renderer-driver.mjs` API, with a scratch HOME, config and profile, and `CMUX_*`
removed. Each case uses session ids the app has never seen, under the same names. This
matters because the app keeps per-session state across a page reload: a cold case run
after its session had loaded painted 24 rows and showed no placeholder.

- **cold:** hold the snapshot, then open "Release planning thread".
- **stale:** open it, open another conversation, hold, then reopen it. The paint comes from the in-window cache.
- **older:** hold `history?before_id`, then wheel up over the transcript with CDP `Input.dispatchMouseEvent` until the slot is busy.
- **remote:** hold the snapshot, then open a `locality: "remote"` row ("Studio Mac: mesh sync notes"). The fixture advertises neither `journal_order` nor `peer_journal_source`, so this is the remote row on the legacy lane, not a live peer relay.

For the sequences, an in-page `requestAnimationFrame` sampler records the rects of every
frame (median gap 16.7 ms), and `capturePage()` runs in a loop at the same time (median
gap 43-62 ms, at least 26 images per run). The rig scripts live outside the repo, in the
session scratchpad (`loading-capture/`). The `c85b0cc95` matrix ran on the same rig bytes
as BEFORE (md5 `5b9211c3…`).

The rotation and reduced-motion frames come from a copy of the rig with two opt-in flags
that are off by default:

- `--pre-ms 1400` holds the cold case for more than one 1 s rotation while
  `capturePage()` loops (~46-48 ms per image);
- `--reduced-motion` emulates `prefers-reduced-motion: reduce`.

The probe also records the mark's computed `transform`, `animation-name` and border
colours, and the pill's box and colours, on every animation frame.

## Geometry: D-M1 vs round 1 (`geometry-dm1.json`)

D-M1 swapped the dot for a spinner and a pill inside the same slots. These are the
maximum |delta| values across all 16 runs, `c85b0cc95` minus `7887d0bf0`:

| Metric | Max \|delta\| |
|---|---|
| Slot height (foot slot 17.39, older-history slot 28, the indicator's own line for cold/remote) | 0 px |
| Indicator bounding height (17.39) | 0 px |
| Indicator y | 0 px |
| Last row y, loading still | 0 px |
| Last row y, settled still | 0 px |
| Scroller `scrollHeight`, loading still | 0 px |
| Scroller `scrollHeight`, settled still | 0 px |
| Distinct last-row y over every rAF sample, while loading / after | 0 / 0 px |
| Distinct `scrollHeight` over every rAF sample, while loading / after | 0 / 0 px |

Width grows only where the box is content-sized: older-history goes from 172.5 to 196.5 px.
Cold, remote and stale stay full-width at 810 px. The 16 px ring sits inside the 17.39 px
line box, and the pill has horizontal padding only, so it is 17.39 px tall too.

## No layout shift, no flicker

Measured across all 16 runs, for both BEFORE and AFTER:

| Reading (all runs) | BEFORE | AFTER |
|---|---|---|
| Last transcript row, max \|dy\| while mounted | 0 px | 0 px |
| Indicator on/off transitions | exactly 1 (on -> off) | exactly 1 (on -> off) |
| Bounces (off -> on again) | 0 | 0 |
| Indicator y drift while on screen | 0 px | 0 px |
| Cold/remote: frames after release with neither indicator nor rows | 0 | 0 |
| Cold/remote: frames after release with both indicator and rows | 0 | 0 |

The images were read independently by pixels, across all 32 runs (both arms, every theme
and glass mode):

- exactly **1** indicator ON -> off change, **0** bounces;
- **0** blank images (neither indicator nor rows);
- **0** images showing both the indicator and the landed rows.

These are `images_pixels` in `rects-summary.json`.

The indicator leaves in the same frame the rows land (cold, remote) or in the same commit
as the reconciled rows (stale, where the foot slot keeps its 17.4 px height).

**`capturePage()` can lag the DOM.** On this hidden Linux/Xvfb window, a shot taken
within about 150 ms of a commit can return the previous presented frame. For example, in
`sequence-cold-light.png` the shot started at 424 ms (done at 463 ms) still shows the
indicator, while the sampler had rows at 327 ms. That is capture latency, not a frame the user sees twice: the
next image is the landed state, and no image shows an intermediate or blank state. So
the timing claims come from the rAF sampler, and the images back the *shape* of the
transition.

**Older, both arms:** the held page lands about 330 ms in. Scroll anchoring keeps the
reader's rows in place (the last row reads `y=2861.4` throughout), and the 24 new rows
appear above them, so the slot moves to `y≈-2760`. It stays busy off-screen until about
540-565 ms (AFTER) or 510-595 ms (BEFORE), then reads `Load earlier messages`. The reader
never sees it flip.

## Contrast, measured from pixels

Ratios are WCAG 2.x.

### The D-M1 mark across a full rotation (cold open; `mark.png`, `markSpin`)

The arc is the most contrasting saturated (accent) pixel inside the ring. The track is the
most contrasting grey ring pixel. Both are measured against the ground beside the ring. The
arc and track are 1 px borders, so the measured ink depends on how a rotation phase
anti-aliases them. The declared colours are accent `#137742` / `#38c96a` and track
`rgb(133,127,112)` / `rgb(131,124,109)` (light / dark).

| Theme | Frames over 1 rotation | Arc | Accent-coloured px in the arc | Track | Label on pill | Pill vs ground |
|---|---|---|---|---|---|---|
| light | 30 (1398 ms, 67 distinct transforms) | **2.96-4.22:1** | 2-8 | 2.53-3.24:1 | `#4e4940` on `#dbe0d2`, 6.64:1 | 1.15:1 |
| dark | 32 (1386 ms, 69 distinct transforms) | 4.64-6.98:1 | 12-14 | 3.03-3.71:1 | `#c2bcaf` on `#202c1f`, 7.70:1 | 1.18:1 |
| light, reduced motion | static (`transform: none` on every sample) | 4.22:1 | 8 | 3.24:1 | 6.64:1 | 1.15:1 |
| dark, reduced motion | static | 6.98:1 | 14 | 3.92:1 | 7.70:1 | 1.18:1 |

At its weakest rotation phase, the light arc measures **2.96:1**, below the 3:1 non-text
minimum: the 1 px arc anti-aliases into the ground on the diagonals. The ring's outline
(track plus arc) keeps the mark visible, and the label carries the meaning. Under reduced
motion the spin runs one 0.01 ms iteration (the global reduced-motion cap) and parks at its
end keyframe, so the ring is static with the arc at the top.

### Per case (stills plus the pre-release frames of each sequence)

BEFORE: the ground is the modal colour of the indicator row, the mark is the first ink
cluster from the left, and the label is the most extreme ink right of it. AFTER: as above
(arc, track, label on pill). These ranges cover only the ~300 ms before release, a
**partial** rotation; the full rotation is in the table above.

| Case | Theme | BEFORE mark | BEFORE label | AFTER arc / track | AFTER label on pill |
|---|---|---|---|---|---|
| cold / remote | light | 8 px `bg-elevated` dot, **1.10-1.12:1** | `ink-dim` 12 px, 5.36:1 | 2.96-4.09 / 2.52-3.03:1 | `ink-muted` 12 px, 6.64:1 |
| cold / remote | dark | 8 px dot, **1.12-1.15:1** | 6.60:1 | 4.64-6.98 / 3.07-3.91:1 | 7.70:1 |
| stale | light | **none** (text only) | `ink-dim`, 5.36:1 | 3.01-3.63 / 2.52-2.72:1 | 6.64:1 |
| stale | dark | **none** | 6.60:1 | 4.70-6.98 / 3.07-3.87:1 | 7.70:1 |
| older | light | 18 px green spinner ring, 3.00-3.64:1 | 7.66:1 | 3.00-4.22 / 2.53-3.24:1 | 6.64:1 |
| older | dark | ring, 4.64-6.98:1 | 9.09:1 | 4.64-6.02 / 3.03-3.66:1 | 7.70:1 |

With glass-sim, the dark label on pill is 8.13:1 (pill `#1b281c`).

Grounds: light `#f2ede3`, dark `#1d1b17` (`#181714` with glass-sim).

## Window glass: what Linux can and cannot show

- **Linux gates window glass off.** The app's own launch line, from these runs:
  `[window-glass] launch gate platform=linux supported=false default=false enabled=false intensity=80 reason=linux-compositor-dependent mechanism=none`
  (`glassCapabilityFor` in `src/shared/window-glass.ts`).
- **Asking for it does not change that.** Asking the running app through its own settings
  path (`window.api.windowGlass.set({ enabled: true, coverage: "full", intensity: 80, material: "window" })`)
  returns `active: false` with `capability.reason: "linux-compositor-dependent"`, and
  `data-glass` stays `null`. No env, argv or rig switch forces glass on.
- **What `glass-sim` is.** The rig bundles the app's own renderer paint (`applyGlassFacts`
  in `use-window-glass.ts`) and runs it with the macOS defaults. This yields the real
  `data-glass="sidebar canvas pane"` and `--lo-glass-*` alphas, for example
  `--lo-glass-a-canvas: 0.62` on the dark palette.
- **Why it proves little.** The Linux window is opaque and there is no OS blur, so the
  translucent grounds composite over the window's flat backing. Light frames come out
  byte-identical in ground colour; dark shifts from `#1d1b17` to `#181714`. These frames
  show only that the indicator's inks hold over the glass alpha maths. **Proof of real
  translucency still needs a macOS capture.**

## Noise present in both arms

- **Sidebar footer:** "Account unavailable / Reconnect Radient". The fixture has no Radient account.
- **Header pill:** a placeholder bar beside the title in the cold, stale and remote frames. This is the pending working-directory label, unchanged by this PR.
