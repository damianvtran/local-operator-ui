# Speech to text: Primary and Secondary shortcut boxes

Frames and records for Settings -> Keyboard shortcuts -> Speech to text, from
the **built Electron app** (`electron-vite build`, headless window mode, no
window shown, no operator focus taken).

**Runtime:** Electron 45.1.0 (the shared `node_modules` these worktrees link
to), not the 44.3.0 `package.json` pins. macOS, `navigator.platform` =
`MacIntel`.

## What was real

- The Electron main and renderer, and the preload bridge (`window.api`).
- A real `lop serve` (v0.93.0) on a scratch port, with a scratch `HOME`, config
  dir and `--user-data-dir`. Saves went to its real `keymap.start_recording`
  and `keymap.push_to_talk` settings.
- Key presses injected with CDP `Input.dispatchKeyEvent` (real keydown/keyup
  with real `code` values).
- For `chord-takeover.mjs`: the composer's real `MediaRecorder` on a synthetic
  stream with a delayed `getUserMedia`, and main's real `start-speech-to-text`
  channel, sent from the main process over the Node inspector.

## What was not

- No physical microphone, and no transcription (nothing calls Radient).
- No Windows or Linux run; per-platform key mapping is covered by
  `scripts/push-to-talk-shortcut-row.test.mjs`.
- CDP key events do **not** pass main's `before-input-event` hook
  (`ipc: []` for Cmd+P in `after-record.json`). The keystroke that makes main
  send `start-speech-to-text` is therefore not exercised; the channel is sent
  directly, which is the same call the hook makes.
- The narrow frames are a CDP-emulated 800 px viewport (the window's minimum
  width), not a resized window.
- For `chord-takeover.mjs` only, the untracked `out/renderer/index.html` of both
  compared builds had `http://127.0.0.1:46170` and `:46180` added to the CSP
  `connect-src` by hand, because the composer's key probe is blocked on a scratch
  port otherwise and dictation reads as unavailable. The rest of both builds is
  as built. A dummy `RADIENT_API_KEY` is stored through the app's own
  `credentials.update` op to enable the mic control.

## Before and after

"Before" is the PR's merge base, `4c9c8f9805`, built and driven by the same
`capture.mjs`. "After" is the head that contains this README.

    node capture.mjs --repo <checkout with out/ built> --out <dir> --label before|after --port 46150

| Frame | Shows |
| --- | --- |
| `before-default-dark.png`, `before-default-light.png`, `before-narrow-light.png` | One box, "Start recording". The hold key is not editable here. |
| `after-default-dark.png`, `after-default-light.png`, `after-narrow-light.png` | Primary and Secondary, each naming its action, at defaults (taken before any key press, so no overlap note: the defaults do not overlap). |
| `after-listening-dark.png` | Secondary focused with a modifier down: the hint, including the pointer to Start recording for letters. |
| `after-rebound-overlap-dark.png` | After tapping Left Control (saved as `ctrl-left-hold`): Reset appears and the note names the whole chord ("Control+Shift+S") and an alternative. |
| `after-refused-dark.png` | After a modifier that grew into a chord (Left Command, Shift, S) and then a letter: the focused field keeps `Left-Control`, shows the refusal once (the pointer is in the hint above it). Nothing was saved. |
| `after-primary-rebound-note-dark.png` | Primary rebound to Command+Option+R in the real app: the Secondary note follows it ("Every shortcut that uses Option, such as Command+Option+R"). This is `window.api.recordingShortcut` working in the built app. |
| `after-deeplink-focused-light.png` | `#/settings?setting=keymap.push_to_talk`, from defaults, focuses the Secondary field. |
| `before-record.json`, `after-record.json` | Values read from the page and the bridge (`bridge: {api: "object", electron: "undefined"}`, the saved token, `primaryRebind.after.canonical`, `deepLinkActive`). |

## The Start recording chord while a hold is already recording (QA round 2, Q1)

`chord-takeover.mjs`, one run per tree, hold = Command or Control (right side),
microphone delay 150 ms and 500 ms. Each cell is "a recording is live after
main sends the chord N ms after the hold's keydown"
(`chord-takeover-before.json`, `chord-takeover-after.json`).

| Hold, mic delay | Chord alone | Before: 40 / 100 / 300 / 700 / 1500 ms | After: 40 / 100 / 300 / 700 / 1500 ms | Chord after the hold was released |
| --- | --- | --- | --- | --- |
| Command, 150 ms | yes | yes / yes / **no** / **no** / **no** | yes / yes / yes / yes / yes | yes (both trees) |
| Command, 500 ms | yes | yes / yes / yes / **no** / **no** | yes / yes / yes / yes / yes | yes (both trees) |
| Control, 150 ms | yes | yes / yes / **no** / **no** / **no** | yes / yes / yes / yes / yes | yes (both trees) |
| Control, 500 ms | yes | yes / yes / yes / **no** / **no** | yes / yes / yes / yes / yes | yes (both trees) |

"Before" is head `3c4f49349e`. In every failing cell the log reads
`gum, rec-start, gum, rec-stop`: the hold's take started, the chord ended it,
and nothing started a new one.
