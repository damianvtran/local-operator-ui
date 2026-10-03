# The transcript display row, in Settings > Appearance

**Claim.** The control this change adds to Settings has frames: the row exists
where the design round could not photograph it, in both of the states it can be
in, in both shipped palettes, and the state it shows is the state its own control
wrote to the persisted store.

**Why a live-app set rather than a Storybook cell** (design review round 1, D2).
The row's only Storybook cell is `shell-app-shell--settings-appearance`, and that
story is unphotographable by construction: it holds
`documentElement.dataset.capturePending` until the Appearance section's switch
paints, which happens only once the settings page's config query RESOLVES. Offline
it never does, so the capturer waits out its bound and fails the run at that row —
and the way past it (`--allow-backend` against the daemon on 1111) would put the
operator's own installation into a committed frame. This set is the other way:
the BUILT app from this branch, booted headless against an ISOLATED daemon this
lane started on its own scratch port, photographed by the app itself with
`webContents.capturePage()`.

## What produced these frames

One run, one command, after the app was built from this branch's head:

```sh
# the app, built for the port this run owns (never 1111)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18317 pnpm build     # + four synthetic VITE_* OAuth values, see below

# the isolated synthetic daemon: its own scratch root, never the operator's
mkdir -p "$SCRATCH/config"
cat >"$SCRATCH/config/config.yml" <<'YAML'
values:
  hosting: test
  model_name: mock-model
YAML
LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" LOCAL_OPERATOR_HOME="$SCRATCH/home" \
HOME="$SCRATCH/home" LOCAL_OPERATOR_LOG_DIR="$SCRATCH/logs" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  local-operator serve --host 127.0.0.1 --port 18317

# the run (`--scene settings-transcript-display`, added by this change)
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" node scripts/renderer-driver.mjs \
  --scene settings-transcript-display --backend http://127.0.0.1:18317 \
  --seed-onboarding-complete --window-size 1280x900 --out <dir> --clean
```

The build needs the four `VITE_*` OAuth values
(`scripts/vite-plugins/replace-backend-config.ts` refuses to compile without
them); this run supplied synthetic ones of the shape the repository's own tests
use. A driver run never signs in, so nothing in these frames is a function of
them — but the fact is written down here because a build that could not start is
otherwise indistinguishable from a rig that did not try.

**Isolation, as the run itself states it** (not as a promise): the app's scratch
HOME, config dir, log dir and `--user-data-dir` are the run's own; the window mode
is `headless` and the window is never shown; the run printed
`the app holds a connection to this run's backend (http://127.0.0.1:18317)` and
`the app holds NO connection to the operator's own backend (http://localhost:1111)`;
and the daemon was reaped by exact pid when the run ended. The scratch tree was
removed (`--clean`).

## The frames

| Frame | What it shows |
| --- | --- |
| [settings-transcript-display-turn-dark.png](settings-transcript-display-turn-dark.png) | The shipped state: the `Transcript display` row with `By turn` on the raised segment, directly under the `Show agent reasoning` switch, in the dark palette |
| [settings-transcript-display-response-dark.png](settings-transcript-display-response-dark.png) | The same row after a press on its own `By response` trigger — the gesture a reader makes, not a store write |
| [settings-transcript-display-turn-light.png](settings-transcript-display-turn-light.png) | The shipped state in the light palette; the contrast reading is this pair's |
| [settings-transcript-display-response-light.png](settings-transcript-display-response-light.png) | The pressed state in the light palette |

Every frame carries the neighbouring row on purpose: the design round's question
about this control is its PLACEMENT, and placement is a sentence about the
neighbours. Both the row and the reasoning switch are asserted inside the viewport
at shutter time, so a frame that had scrolled past its own subject would have
failed the run rather than been filed under the row's name.

## The numbers behind the pictures

Read from the page in the run (`measure`, and the persisted store), not from the
frames:

| Reading | Value |
| --- | --- |
| The row's control (`[role="tablist"]`, labelled by the row's own text) | 181 × 32 px at x1059, y434, inside 1280 × 900 |
| The `Show agent reasoning` switch above it | 36 × 20 px at x1204, y340 |
| Written by the press, dark palette | `by-turn`, then `by-response` — read back out of the persisted `localStorage` blob the next launch reads |
| Written by the press, light palette | the same, after pressing the row's own trigger again in that pass |
| Selected tab after each press | `data-state="active"` on the trigger whose label names that mode |

The read-back is the point of the pair rather than a convenience: a control wired
to the wrong setter, or a store written while the control stays put, fails one of
those two readings by name.

**Two passes, compared as pixels** (the scene was run twice, once on the working
tree that was about to be committed and once on the committed head, with the
frames kept from the second). Decoded and diffed channel by channel at
2560 × 1800:

| Frame | Differing channels | Max delta | Where |
| --- | --- | --- | --- |
| `…-turn-dark.png` | 0 of 13,824,000 | — | byte-identical |
| `…-response-dark.png` | 12 | 10/255 | x1033-1404, y458-622 |
| `…-turn-light.png` | 13 | 11/255 | x1033-1404, y458-622 |
| `…-response-light.png` | 14 | 1/255 | x1033-2467, y424-622 |

So the pair is reproducible to a handful of antialiased glyph-edge channels inside
the row itself, and nothing else on the page moves between runs. The decoder is
the repository's own (`scripts/band-occlusion-evidence.mjs`'s `pngRows`).

## Recorded, NOT addressed (for the design round, not fixed here)

The control is **32 px tall** (the segmented track's own `h-8`) inside the **24 px**
fixed-height box `TranscriptDisplayModeSetting` declares for it — the box
`ToggleSetting` uses, whose reason is stated in both components: "swapping control
shapes between modes must not move the row's own baseline". The switch in the row
above measures **20 px**, so the two rows' control boxes are not the same height in
spite of the shared declaration, and this set is the first evidence of it. It is
recorded rather than fixed because it is a layout judgement the design round owns,
and it is named here rather than left for a reader to notice.

## What these frames do not prove

- **Nothing about the transcript itself.** This set is the Settings row only. The
  mode's own effect on a settled turn is the transcript cells' pair.
- **Nothing in a `normal` window.** The launch is `headless`, which is what keeps
  the operator's focus; a headless window is never shown and cannot be focused, so
  no frame here shows a hover or a focus ring on the control.
- **Not the packaged app.** A built checkout booted by its own Electron, not an
  installed or signed bundle.
- **Not a full-page frame.** The page is roughly 3,600 px tall; this is the row in
  its section, scrolled to the middle, which is the context the row is judged in.
