# Speech to text: Primary and Secondary shortcut boxes

Frames and key-event records for Settings -> Keyboard shortcuts -> Speech to
text, taken from the **built Electron app** (`electron-vite build`, headless
window mode, no window shown, no operator focus taken).

## What was real

- The Electron main and renderer, and the preload bridge (`window.api`).
- A real `lop serve` (the settings registry), on a scratch port, with a scratch
  `HOME`, config dir and `--user-data-dir`. Saves went to its real
  `keymap.start_recording` and `keymap.push_to_talk` settings.
- Key presses injected with CDP `Input.dispatchKeyEvent` (real `keydown` /
  `keyup` events with real `code` values, no synthetic DOM events).
- Platform: macOS (`navigator.platform` = `MacIntel`).

## What was not

- No microphone: no recording was started, so "the hold engages" is covered by
  unit tests, not by these frames.
- No Windows or Linux run. The per-platform key mapping is covered by
  `scripts/push-to-talk-shortcut-row.test.mjs`.
- CDP key events do not pass through the main process' `before-input-event`
  hook (the record shows `ipc: []` for Cmd+P), so the main-swallowed-chord
  problem (review F2) could not be reproduced here. It is reproduced and fixed
  at the manager/IPC level in `scripts/hold-main-claimed-chord.test.mjs`.

## Before and after

"Before" is the PR's merge base, `4c9c8f9805` (main when this branch forked),
built and driven by the same script. "After" is the head that contains this
README. `capture.mjs` produced all of it:

    node capture.mjs --repo <checkout with out/ built> --out <dir> --label before|after --port 46150

| Frame | Shows |
| --- | --- |
| `before-default-dark.png`, `before-default-light.png`, `before-narrow-light.png` | One box, "Start recording". The hold key is not editable here. |
| `after-default-dark.png`, `after-default-light.png` | Primary and Secondary, each naming its action. |
| `after-listening-dark.png` | Secondary focused: the hint, including the pointer to Start recording for letters. |
| `after-rebound-overlap-dark.png` | After tapping Left Control (saved as `ctrl-left-hold`): Reset appears and the note names the shortcuts that will start a recording. |
| `after-refused-dark.png` | After a modifier that grew into a chord (Left Command, Shift, S) and then a letter: the focused field keeps `Left-Control`, shows the refusal and the pointer. Nothing was saved. |
| `after-primary-rebound-note-dark.png` | Primary rebound to Command+Option+R in the real app: the Secondary note follows it ("Every shortcut that uses Option, such as Option+R"). This is the `window.api.recordingShortcut` bridge working in the built app. |
| `after-deeplink-focused-light.png` | `#/settings?setting=keymap.push_to_talk` focuses the Secondary field. |
| `after-narrow-light.png`, `before-narrow-light.png` | 760 px wide. |
| `before-record.json`, `after-record.json` | The values read from the page and from the bridge (`bridge: {api: "object", electron: "undefined"}`, the saved token after each step, `primaryRebind.after.canonical`, `deepLinkActive`). |
