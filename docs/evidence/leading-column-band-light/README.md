# The leading column's band, in localOperatorLight

The design round's own frames for `fix/leading-column-lane-band` (PR #588),
captured after `evidence/leading-column-band` covered the dark theme. Same rig
in every respect that matters: the built app's own `webContents.capturePage()`,
`headless` window mode, macOS integrated window, `devicePixelRatio` 2, against
an isolated `local-operator serve` on `127.0.0.1:18471` (scratch HOME and
config root, 0600 bearer, reaped by exact pid), so no frame touches the
operator's own backend on 1111. The renderer was built with
`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18471` for the same reason.

## What is here

| directory | tree | theme | size |
| --- | --- | --- | --- |
| `after-light-1380x900/` | `05f8508761` (head) | localOperatorLight | 1380x900 |
| `after-light-1024x768/` | head | localOperatorLight | 1024x768 |
| `after-light-800x600/` | head | localOperatorLight | 800x600 |
| `before-light-1380x900/` | `9589bd8fec` (base) | localOperatorLight | 1380x900 |
| `before-light-800x600/` | base | localOperatorLight | 800x600 |
| `after-dark-1024x768/` | head | localOperatorDark | 1024x768 |

The 1024x768 runs are the geometry neither earlier size covered: the sidebar is
docked (260px, `SIDEBAR_DOCK_MIN_PX` 1024) while the settings rail is still the
48px icon rail (its `min-[1040px]` step has not fired) — band 308, against 104
at 800 and 480 at 1380.

The before frames are the base tree rebuilt in the same worktree
(`git checkout 9589bd8fec -- src/`, rebuild, capture, `git checkout HEAD --
src/`); the app the driver photographed is the unmodified tree at each commit.

## The command

```sh
node_modules/.bin/electron-vite build        # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18471
node scripts/renderer-driver-design588.mjs --scene route-tops \
  --backend http://127.0.0.1:18471 --backend-records <config>/run/serve \
  --seed-onboarding-complete --window-size 1380x900 \
  --theme localOperatorLight --run-label "-light" --out <frames> --clean
```

`scripts/renderer-driver-design588.mjs` is a disposable copy of the branch's
driver with one addition: the same `--theme` block every theme-parameterised
scene carries, applied at the top of `sceneRouteTops` (the scene itself is
theme-agnostic). The diff is `logs/driver-patch.diff`; the copy was not
committed anywhere and the app tree under capture is unmodified. Frames whose
name ends `-light` / `-dark` are checked by the rig itself against the palette
they claim — every frame in this branch passed that check.

## The numbers, read off these frames

Device pixels; CSS px = device / 2. Lane row y 20 (inside the 32px lane),
y 66 (the first row below it).

| view | tag | lane stop | row below | verdict |
| --- | --- | --- | --- | --- |
| `/settings` 1380 | before | `surface` 0..259, then `canvas` | rail edge (hairline) at 479..480 | FAIL, band stops at the app sidebar |
| `/settings` 1380 | after | `surface` 0..479, `canvas` from 480 | rail edge 479..480, `canvas` from 480 | aligned |
| `/settings` 800 | before | `surface` 0..55, then `canvas` | rail edge at 103..104 | FAIL |
| `/settings` 800 | after | `surface` 0..103, `canvas` from 104 | rail edge 103..104 | aligned |
| `/settings` 1024 | after | `surface` 0..307, `canvas` from 308 | rail edge 307..308 | aligned |
| `/agents` 1380 | after | `surface` 0..515, `canvas` from 516 | pane edge 515..516 | aligned |
| `/agents` 800 | after | `surface` 0..311, `canvas` from 312 | pane edge 311..312 | aligned |
| `/agents/local-operator` 1380 | after | `surface` 0..539, `canvas` from 540 | pane edge 539..540 | aligned |
| `/chat`, `/agent-hub`, `/schedules` | after | stop = the app sidebar's own edge (260 / 56) | unchanged | no overshoot |

Light-theme grounds: lane band `surface` rgb(246,245,238) / rgb(247,245,239),
`canvas` rgb(241,237,228); the rail's hairline below the lane rgb(217,213,204).
Dark: `surface` rgb(42,39,33), `canvas` rgb(33,32,28), hairline rgb(63,59,46).
The lane's stop and the column's right edge are the same device column in
every measured case; no anti-aliased seam appears at the junction.

## Run verdicts (full logs in `logs/`)

- `after` runs: ALL CHECKS PASSED — 53 PASS (1380 light, 1024 light, 1024 dark), 43 PASS (800 light); zero FAIL, including the rig's palette
  claims for all seven frames per run.
- `before` runs: 8 FAIL / 45 PASS (1380) and 8 FAIL / 35 PASS (800) — the
  hand-over and the band's reach on the four leading-column route visits
  (`/settings`, `/settings?section=integrations`, `/agents`,
  `/agents/local-operator`), the same shape as the dark before set.
