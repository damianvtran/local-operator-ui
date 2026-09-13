# Window mode: running the app without taking the operator's focus

**Claim.** An agent-driven run of this app can render fully and be driven over
CDP without ever taking the operator's keyboard focus, and without a window
appearing on screen at all (`headless`), because the launch behaviour is now a
declared mode instead of an unconditional `show()`.

**Before.** `ready-to-show` always called `show()`. Measured on this machine
with the same harness: the app's own pid became the frontmost application in
**5 of 8** samples of a run that nobody asked to watch, and the operator's
terminal lost focus each time.

## How to re-derive

```bash
pnpm build                 # the harness drives the BUILT app
# mode, label and window size; the app is launched with an isolated store,
# a backend on a port the harness owns, and --remote-debugging-port
bash docs/evidence/window-mode/harness/run.sh <tree> <label> <mode> <WxH>

# the three runs that matter
bash docs/evidence/window-mode/harness/run.sh . headless headless 1380x900
bash docs/evidence/window-mode/harness/run.sh . inactive inactive 1380x900
bash docs/evidence/window-mode/harness/run.sh . normal   normal   1380x900
```

Each run prints the state line the app itself emitted, the number of samples in
which *this* app was the frontmost application (compared by pid, because other
agents run Electron on this machine), and writes two frames per run to its
scratch dir.

## What was measured

Electron 35.5.1, macOS 25.6, WindowServer active, 2x display. `sample` column =
samples in which this app's pid was the frontmost application / total samples.

| Mode | window state (the app's own log) | viewport | rAF | app frontmost | frames |
| --- | --- | --- | --- | --- | --- |
| `headless` | `visible=false focused=false focusable=false size=1380x900 content=1380x872` | 1380x872 | 129/s | 0 / 5 | 2760x1744 px |
| `inactive` | `visible=true focused=false focusable=true size=1380x900 content=1380x872` | 1380x872 | 127/s | 0 / 4 | 2760x1744 px |
| `normal` (control) | window shown and focused — no state line by design | 1380x872 | — | **1 / 3** (an earlier, longer-sampled run of the same build measured 5 / 8) | — |
| `headless`, `--window-size=800x600` | `visible=false … size=800x600 content=800x572` | 800x572 | 124/s | 0 / 5 | 1600x1144 px |
| `headless`, `--window-size=400x300` | clamped, and logged: `window size 400x300 clamped to 800x600` | 800x572 | 124/s | 0 / 3 | 1600x1144 px |

The run's own output for the clamped case, which is what stops an evidence frame
being labelled with a size the window never had:

```
20:56:00.366 › [window-mode] window size 400x300 clamped to 800x600 (floor 800x600, ceiling 16384)
[window-mode] window mode headless: 800x600, window created and never shown, page throttling off
[window-mode] state: visible=false focused=false focusable=false size=800x600 content=800x572
```

## Fidelity: headless frames are the same pixels

`frame-chat.png` from the `headless` run and from the `inactive` run — the
latter captured from a real, shown window — are **identical**: 0 of 14,440,320
channels differ, both 2760x1744.

Two caveats, measured rather than assumed:

- **Frames taken mid-animation differ run to run**, whatever the mode. The
  first frame (`frame-shell.png`) differs from run to run by ~92% of channels
  because the onboarding modal is still animating; two `headless` runs differ
  from each other by the same amount, and a second settled chat frame differs by
  0.0061%. Capture the settled state, as the driver does before the second
  frame.
- **Focus-dependent rendering is what genuinely differs**, because a window that
  is never shown cannot be focused: text carets, `:focus`/`:focus-visible` rings,
  anything gated on `document.hasFocus()`. `hasFocus=false` and
  `activeElement=BODY` in both non-`normal` runs, so evidence about those has to
  come from `inactive` mode or from CDP
  `Emulation.setFocusEmulationEnabled(true)`.

## What the OS will not tell you, and what the app says instead

`System Events` reports **no windows** for a process without Accessibility
permission, and none for a background process even when it has one (tested: a
frontmost Electron window counts 1, the same window in the background counts 0,
as does a window belonging to a non-frontmost Slack). So "the app never showed a
window" is not provable from outside on this machine, and the run does not claim
it from there: the app prints its own `[window-mode] state:` line 1.5 s after
`ready-to-show`, and that line is the evidence.

Frames in `frames/` are PNG on purpose: `pnpm check-evidence` judges the
`.webp` Storybook set, whose frames have a theme in their filename. These frames
are of the running app in whatever theme the scratch profile had.
