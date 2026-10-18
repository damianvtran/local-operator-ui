# Surface pass — round 1 remediation evidence

Frames and the rig behind `feat/surface-pass` (PR #1170), captured after the
round-1 remediation commit. This branch carries **no product code**: it is the
evidence set the PR body links, pinned so the frames cannot drift with a local
scratchpad.

| Pin | SHA |
|---|---|
| base (before frames, and the PR's merge base) | `76dda0304` |
| remediation head (after frames) | `863c7e566` |

## Run

- macOS 27.0.1 / Electron 44.3.0, headless through the app's own dev driver
  (`scripts/renderer-driver.mjs`), `capturePage()`.
- 1380x900 logical (2760x1800 physical), default intensity 80, coverage `full`,
  material `window`.
- An isolated daemon on port 8080, seeded with Projects rows by the run's own
  script; the app's serve record is linked into its scratch config (the rig does
  this from `RIG_SERVE_RECORDS`).
- The checkerboard is painted on `<html>` so translucent grounds show it; flat
  twins paint the measured backdrop grey (`#515151` dark).
- The same rig captured both sets; the only difference is the checkout it was
  run against (`76dda0304` and `863c7e566`).

```sh
# from a product checkout with its own node_modules and a built `out/`:
RIG_SERVE_RECORDS=<daemon config>/run/serve \
  node <this branch>/rig/surface-rig.mjs --out <frames dir>
```

The rig imports `scripts/renderer-driver.mjs` from `process.cwd()` because the
driver bundles against that checkout's `electron`; `RIG_REPO` overrides the
document paths, `RIG_MEDIA` the media fixtures.

## After frames (remediation head)

| Frame | Shows |
|---|---|
| `01-canvas-open-empty.png` | rail pane on glass, empty canvas |
| `02-files-empty-dark.png` | Files view: index capability present, **0 files** — the empty state, not a populated grid (limitation below) |
| `04-document-markdown.png` | document view, 18 tabs, populated body |
| `04b-document-flat-dark.png` | same, flat backdrop (measurement twin) |
| `20-image-viewer.png` | image viewer: band bar, clear body |
| `21-video-viewer.png` | video viewer: band bar, clear body |
| `22-audio-viewer.png` | audio viewer: band bar, clear body, player over the checker |
| `23-pdf-viewer.png` | PDF viewer: band bar, clear body |
| `05-run-details.png` | Run details, empty state |
| `07-browser.png` | Browser pane + chrome band |
| `08-console.png` | Console, empty state |
| `09-code-review.png` | Code review, empty state |
| `11-projects-board-dark-glass80.png` | board, dark, glass 80 (lane wash at `sunken x pageAlpha`) |
| `11b-projects-board-flat-dark.png` | board flat-backdrop twin |
| `12-projects-board-dark-glass-off.png` | **Board tab**, dark, glass off — byte-identical to `before-frames/12` |
| `12b-projects-board-light-glass-off.png` | **Board tab**, light, glass off |
| `13-projects-board-light-glass80.png` | board, light, glass 80 |
| `16-projects-list-scrolled.png` | list view, scrolled (Q8's pre-existing overlap; deferred) |

The viewer bar's live computed background in this run:
`color(srgb … / 0.05)` for all four viewers — the band overlay, no opaque
`bg-surface` (`logs/rig-after.log`, `* viewer chrome` lines). On the base the
same probe returns `null` (no band marker) and the bar is the opaque surface fill
(`before-frames/20-image-viewer.png`, `22-audio-viewer.png`).

## Before frames (base `76dda0304`)

Same names, same rig, same seeds. The load-bearing pair is `11` vs `11`
(cards floating on the page vs the derived lane behind them); `12` is the
glass-off parity control and `20`/`22` are the viewer-chrome before halves.

## States not captured — stated, not implied

- **Asks populated/empty.** The rail press is a no-op without a live `askScope`
  and this daemon serves no queued asks; no ask frame exists in either set. The
  ask card's hover fix is verified by recomposition and the CSS invariant test,
  not by a rendered ask frame.
- **Populated Files grid + sticky Images/Documents headers.** The grid reads the
  backend's `session_files` index; no session on this daemon produced files, so
  the grid reports 0 files. `02` is that empty state, labelled as such.
- **Sounds on the message block.** Unchanged by the PR; the independent QA
  captures (`10-sounds-idle-dark.png` / `10b-sounds-playing-dark.png`) are the
  rendered evidence, referenced in the QA comment.

## Gates

- `logs/contrast-contract.txt` — 185,031 assertions over 59 themes, contract
  holds; the lane matrix covers all 101 slider positions (tightest ΔE00 1.53 at
  intensity 2; card off lane 4.37 minimum; tightest ink 5.18:1).
- `logs/derive-check.txt` — `derive-glass-floors.mjs --check` exit 0 against the
  committed `{role, scale}`.
- `logs/rig-after.log`, `logs/rig-before.log` — the full driver logs, including
  the per-viewer chrome composite and the board lane computed backgrounds.

## Media fixtures

`rig/media/surface-clip.mp4` (2 s `testsrc`, ffmpeg), `surface-tone.wav` (2 s
440 Hz, Python `wave`), `surface-doc.pdf` (hand-written one-page PDF). The image
viewer frame opens the product repo's own `build/icon.png`.
