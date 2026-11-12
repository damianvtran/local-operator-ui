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
| AFTER | **`06db777c7`** (`80a346fd5` implementation, `79f3126b4` i18n audit, `7887d0bf0` review round 1, `c85b0cc95` D-M1 mark, `06db777c7` 2 px arc). Every AFTER frame, matrix, filmstrip, reading and `mark.png` here was captured at `06db777c7`, built with `src/` clean and HEAD verified at build start and end. |
| Round 1 | `7887d0bf0` (pulsing 8 px dot): used only as the geometry baseline in `geometry-dm1.json`, from the same rig bytes and fixture. |
| 1 px arc | `c85b0cc95` (the first spinner, 1 px border): used only in the comparison row of `mark.png`, from the same rig copy. |
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
| `mark.png` | The mark on a cold open. Rows 1-2: light and dark at `06db777c7`, six frames at ~60 deg steps of one rotation of the 16 px `Spinner` (`size-4 border-2`: a 2 px `border-control` track with a 2 px accent arc, `animate-spin`), each with the measured arc and track contrast and the count of accent pixels reaching 3:1, then a **reduced-motion** still (CDP `Emulation.setEmulatedMedia`, `prefers-reduced-motion: reduce`) with the label-on-pill contrast. Row 3: the previous **1 px** arc (`c85b0cc95`) in light at the angle-matched frames. Crops are shown at 3x nearest-neighbour. |
| `geometry-dm1.json` | The geometry proof, `06db777c7` (key `dm1`) vs `7887d0bf0` (key `r1`), for every case, theme and glass mode: slot height, indicator height and y, last row y (loading and settled), scroller `scrollHeight` (loading and settled), and the distinct last-row y and `scrollHeight` values over every rAF sample of each phase. |
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
session scratchpad (`loading-capture/`). The `06db777c7` matrix ran on the same rig bytes
as BEFORE (md5 `5b9211c3…`).

The rotation and reduced-motion frames come from a copy of the rig with two opt-in flags
that are off by default:

- `--pre-ms 1400` holds the cold case for more than one 1 s rotation while
  `capturePage()` loops (~42 ms per image);
- `--reduced-motion` emulates `prefers-reduced-motion: reduce`.

The probe also records the mark's computed `transform`, `animation-name` and border
colours, and the pill's box and colours, on every animation frame.

## Geometry: the spinner vs round 1 (`geometry-dm1.json`)

D-M1 swapped the dot for a spinner and a pill inside the same slots, and `06db777c7` thickened
the ring to 2 px inside the same 16 px border-box. These are the maximum |delta| values across
all 16 runs, `06db777c7` minus `7887d0bf0`:

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

### The mark across a full rotation (cold open; `mark.png`, `markSpin`)

The arc is the most contrasting saturated (accent) pixel inside the ring, at each captured
angle. The track is the most contrasting grey ring pixel. Both are measured against the
ground beside the ring. "px >= 3:1" counts the accent-hued ring pixels that reach 3:1, so it
shows how much of the arc carries the contrast, not just its best pixel. Declared colours:
accent `#137742` / `#38c96a`, track `rgb(133,127,112)` / `rgb(131,124,109)` (light / dark).
Every 30 deg sector of the rotation was captured at least once in each run.

| Theme | Arc | Frames over 1 rotation | Arc, weakest-best angle | Accent px >= 3:1 | Track | Label on pill | Pill vs ground |
|---|---|---|---|---|---|---|---|
| light | **2 px** (`06db777c7`) | 34 (1393 ms, 71 distinct transforms) | **4.67-4.81:1** | **14-17** | 3.37-3.42:1 | `#4e4940` on `#dbe0d2`, 6.64:1 | 1.15:1 |
| dark | **2 px** | 36 (1398 ms, 68 distinct transforms) | 7.73-7.97:1 | 22-26 | 4.04-4.15:1 | `#c2bcaf` on `#202c1f`, 7.70:1 | 1.18:1 |
| light, reduced motion | 2 px, static (`transform: none`) | - | 4.81:1 | 16 | 3.42:1 | 6.64:1 | 1.15:1 |
| dark, reduced motion | 2 px, static | - | 7.97:1 | 25 | 4.15:1 | 7.70:1 | 1.18:1 |
| light | 1 px (`c85b0cc95`, for comparison) | 30 | 2.96-4.22:1 | **0-6** | 2.53-3.24:1 | 6.64:1 | 1.15:1 |
| dark | 1 px (`c85b0cc95`) | 32 | 4.64-6.98:1 | 9-13 | 3.03-3.71:1 | 7.70:1 | 1.18:1 |

The 1 px light arc had captured angles (around 312 deg) where **no** arc pixel reached 3:1: the
line anti-aliased into the ground on the diagonals. The 2 px arc always has full-colour pixels.
At its weakest angle it measures 4.67:1 in light, near the accent's own 4.81:1, with at least 14
pixels at 3:1 or more. The track also passes 3:1 in both themes. Under reduced motion the spin
runs one 0.01 ms iteration (the global reduced-motion cap) and parks at its end keyframe, so the
ring is static with the arc at the top (accent pixels in rows 97-100 of the 97-112 ring, both
themes).

### Per case (stills plus the pre-release frames of each sequence)

BEFORE: the ground is the modal colour of the indicator row, the mark is the first ink
cluster from the left, and the label is the most extreme ink right of it. AFTER: as above
(arc, track, label on pill). These ranges cover only the ~300 ms before release, a
**partial** rotation; the full rotation is in the table above.

| Case | Theme | BEFORE mark | BEFORE label | AFTER arc / track | AFTER label on pill |
|---|---|---|---|---|---|
| cold / remote | light | 8 px `bg-elevated` dot, **1.10-1.12:1** | `ink-dim` 12 px, 5.36:1 | 4.67-4.81 / 3.37-3.42:1 | `ink-muted` 12 px, 6.64:1 |
| cold / remote | dark | 8 px dot, **1.12-1.15:1** | 6.60:1 | 7.73-7.97 / 4.04-4.15:1 | 7.70:1 |
| stale | light | **none** (text only) | `ink-dim`, 5.36:1 | 4.73-4.81 / 3.37-3.42:1 | 6.64:1 |
| stale | dark | **none** | 6.60:1 | 7.73-7.97 / 4.04-4.15:1 | 7.70:1 |
| older | light | 18 px green spinner ring, 3.00-3.64:1 | 7.66:1 | 4.73-4.81 / 3.37-3.42:1 | 6.64:1 |
| older | dark | ring, 4.64-6.98:1 | 9.09:1 | 7.73-7.97 / 4.04-4.15:1 | 7.70:1 |

With glass-sim: the dark label on pill is 8.13:1 (pill `#1b281c`), the dark arc 8.06-8.31:1. The
track reads 4.42-4.49:1 (light) and 5.30-5.44:1 (dark). In light that is over an identical
ground, because the track ink itself is darker under glass (`#817b6e` against `#898373`
at (394,105)): the `border-control` token is stronger in glass mode.

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
