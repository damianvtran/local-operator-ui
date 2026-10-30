# Speech to text: Primary and Secondary shortcut boxes

Rendered stills of Settings -> Keyboard shortcuts -> Speech to text, taken from
the `Settings/Keyboard shortcuts` Storybook stories in a headless-free private
browser tab (no app window, no operator focus). The harness resolves the
platform as `linux`, so the hold key reads "Right-Command" (the registry's
default token `alt-right-hold` names the Meta key off macOS).

| Frame | Tree | Story | Shows |
| --- | --- | --- | --- |
| `before-default.png` | `origin/main` 8d81d18b6a | `recording-default` | One row, Start recording. |
| `after-default.png` | this branch | `recording-default` | Primary (Start recording, press) and Secondary (Push to talk, hold), both on defaults, no Reset. |
| `after-rebound.png` | this branch | `push-to-talk-rebound` | After a real `ControlLeft` keydown at the field: the story's transport accepted the save, the field reads Left-Control, Reset appeared, and the overlap note shows (Ctrl begins the Ctrl+J and Ctrl+Shift+C chords). |
| `after-refused.png` | this branch | `push-to-talk-refused` | After a real `J` keydown: the saved key is kept and the refusal names the keys that can be held. |

Not claimed: a physical keyboard, the Electron window, or a real backend; the
persistence and live-apply claims rest on `scripts/push-to-talk-shortcut-row.test.mjs`.
