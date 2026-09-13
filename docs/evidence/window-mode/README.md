# Window mode: running the app without taking the operator's focus

**Claim.** An agent-driven run of this app renders fully and can be driven over
CDP without taking the operator's keyboard focus, and without a window appearing
on screen at all (`headless`), because the launch behaviour is a declared mode
instead of an unconditional `show()`.

**Before.** `ready-to-show` always called `show()`. Measured with the same
harness on this machine: the app's own pid became the frontmost application in
5 of 8, 2 of 4 and 1 of 3 samples of runs nobody asked to watch, and the
operator's terminal lost focus each time.

## How to re-derive

```bash
pnpm build                 # the harness drives the BUILT app
# tree, label, mode, window size. Isolated store, a backend on a port this
# harness owns, and --remote-debugging-port.
bash docs/evidence/window-mode/harness/run.sh <tree> <label> <mode> <WxH>

bash docs/evidence/window-mode/harness/run.sh . headless headless 1380x900
bash docs/evidence/window-mode/harness/run.sh . inactive inactive 1380x900
bash docs/evidence/window-mode/harness/run.sh . normal   normal   1380x900
```

Each run prints the app's own state line, the number of samples in which *this*
app was the frontmost application (by pid, because other agents run Electron on
this machine), the clamp warning when a size was clamped, and it **fails** if the
mode or size it reports is not the one the plan says a request of that shape
should produce — a run that was launched in the wrong mode cannot quietly
produce frames labelled with the right one.

While the app is up, the harness also drives the **second-launch** path: a
second instance on the same profile, which reaches this process as
`second-instance`. That is the other call site that can raise a window.

## What was measured

Electron 35.5.1, macOS 25.6, WindowServer active, 2x display.
`sample` = samples in which this app's pid was the frontmost application /
total samples, over the whole run including the second launch.

| Mode | window state (the app's own log) | viewport | rAF | app frontmost | frame |
| --- | --- | --- | --- | --- | --- |
| `headless` | `visible=false focused=false focusable=false size=1380x900 content=1380x872` | 1380x872 | 124/s | **0 / 8** | 2760x1744 px |
| `inactive` | `visible=true focused=false focusable=true size=1380x900 content=1380x872` | 1380x872 | 127/s | **0 / 4** | 2760x1744 px |
| `normal` (control) | window shown and focused — no state line by design | 1380x872 | — | **4 / 7**, 3 / 3, 5 / 8 across runs | — |
| `headless`, `--window-size=800x600` | `visible=false … size=800x600 content=800x572` | 800x572 | 124/s | 0 / 3 | 1600x1144 px |
| `headless`, `--window-size=400x300` | clamped to 800x600 and logged (below) | 800x572 | 124/s | 0 / 3 | 1600x1144 px |

The clamped run's own output, which is what stops an evidence frame being
labelled with a size the window never had:

```
20:56:00.366 › [window-mode] window size 400x300 clamped to 800x600 (floor 800x600, ceiling 16384)
[window-mode] window mode headless: 800x600, window created and never shown, page throttling off
[window-mode] state: visible=false focused=false focusable=false size=800x600 content=800x572
```

`visible=false` is the fact to read, not `focused=false`: `focusable: false`
forces `isFocused()` false, so a headless run would print `focused=false` even
while holding the operator's focus. `focused=false` in the `inactive` row is
meaningful by contrast, because that window is focusable and shown.

## Fidelity: headless frames are the same pixels

`frame-chat.png` from a `headless` run and from the `inactive` run — the latter
captured from a real, shown window — are **byte-identical when the two runs are
seeded in the same minute**: 0 differing pixels at 1380x900 (2760x1744).

Runs a minute apart differ, in exactly one place: the seeded transcript's
message time.

- 800x600, committed frame against a later run: 390 to 649 differing pixels (two
  independent runs measured 390 and 649), all inside one `60x19` box at the
  timestamp.
- 1380x900, `headless` against `inactive` across minutes: 532 differing pixels
  (1,596 channels), the same box, `62x19`.
- 1380x900, two `headless` runs across minutes: 509 differing pixels (1,526
  channels), the same box.

**Apart from that box the frames reproduce pixel-for-pixel.** The box is not a
mode difference and cannot be: `seed.mjs` stamps the transcript with
`Date.now()`, and the app renders that opener through `TIME_FORMAT` in
`src/renderer/src/features/chat/utils/message-grouping.ts` — `hour: "numeric"`
with `minute: "2-digit"` — so two runs a minute apart differ by that box and
nothing else. The control is the wall clock, not the mode.

Two caveats, measured rather than assumed:

- **Frames taken mid-animation differ run to run**, whatever the mode. The first
  frame (`frame-shell.png`) differs from run to run by ~92% of channels because
  the onboarding modal is still animating; two `headless` runs differ from each
  other by the same amount. Capture the settled state, as the driver does before
  the second frame.
- **`focusable: false` is not what makes this safe.** On macOS
  `NativeWindowMac::Show()` calls `activateIgnoringOtherApps:YES` for every
  non-panel window whatever `focusable` says. Measured directly: a
  `{ show: false, focusable: false }` window that is then shown makes the app
  frontmost (`Arc → Electron`) while `isFocused()` keeps reading false. What
  makes a headless run safe is that nothing raises the window: `window-raise.ts`
  is the only module under `src/main/` that calls `show`, `showInactive` or
  `focus` on a window, and `scripts/window-mode.test.mjs` asserts that over the
  whole directory (mutation-checked: adding one stray `mainWindow?.focus()` to
  `index.ts` fails that test).

## What differs in `headless`, and why that matters

- **Rendering for focus:** carets, `:focus`/`:focus-visible` rings, and anything
  gated on `document.hasFocus()`. `hasFocus=false` in both non-`normal` runs. Use
  `inactive`, or CDP `Emulation.setFocusEmulationEnabled(true)`.
- **Behaviour gated on focus**, which is silent and easy to miss: the watch lease
  reports `visible && focused`, and the `sessions.seen` ack is gated on
  `document.hasFocus()`. A headless run therefore reads as "nobody is watching".
- **Native banners are suppressed entirely** in `headless` (the notifier's
  delivery gate returns before any claim), because the run has nobody at the
  screen and a banner's click handler is a path that raises a window.
- **Native dialogs have no parent window**, because `dialog.showOpenDialog` is
  called with the window. A change that opens a file picker needs `inactive`.

## What the OS will not tell you, and what the app says instead

`System Events` reports **no windows** for a process without Accessibility
permission, and none for a background process even when it has one (tested: a
frontmost Electron window counts 1, the same window in the background counts 0,
as does a window belonging to a non-frontmost Slack). So "the app never showed a
window" is not provable from outside, and this run does not claim it from there:
the app prints its own `[window-mode] state:` line 1.5 s after `ready-to-show`,
and that line — plus the frontmost-by-pid sampling, which does not depend on
Accessibility — is the evidence.

Frames in `frames/` are PNG on purpose: `pnpm check-evidence` judges the `.webp`
Storybook set, whose frames have a theme in their filename. These frames are of
the running app in whatever theme the scratch profile had.
