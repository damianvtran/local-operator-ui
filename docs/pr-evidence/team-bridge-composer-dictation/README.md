# Team Bridge's composer, with dictation - the frames

Twelve frames at **1280x720, DPR 2**, in both brand palettes, plus one frame of
the bar **before** this change.

They are captured from the Storybook this branch builds (`Team Bridge/Composer`,
story ids below), through the Local Operator desktop app's browser host - the
same profile and engine a reviewer uses. The state is produced by the SHIPPING
composer: a story decorator installs a scripted take
(`team-bridge-dictation.fixtures.ts` - a fake microphone, recorder and
transcription relay), and the story's play function presses the real
microphone button. Nothing in the story replaces the component, its strip, its
rows or its measurements.

| file | story | state |
| --- | --- | --- |
| `before-idle-light.png` | `team-bridge-page--populated-direct-message` (main, #1508) | **before**: the 46px one-row bar this branch replaces |
| `light-idle.png`, `dark-idle.png` | `team-bridge-composer--idle` | the restored bar at rest: field, then the control row, nothing else |
| `light-recording.png`, `dark-recording.png` | `--recording` | a take is live: dot, "Recording", elapsed, Confirm, Cancel - in the control row |
| `light-transcribing.png`, `dark-transcribing.png` | `--transcribing` | the take is with the transcription service, in the same row |
| `light-transcribe-failed.png`, `dark-transcribe-failed.png` | `--transcribe-failed` | a transient fault: the take is offered back above the box, with Retry |
| `light-transcribed.png`, `dark-transcribed.png` | `--transcribed` | the transcript has filled the field |
| `light-two-lines.png`, `light-at-cap.png` | `--two-lines`, `--at-cap` | the field growing, and pinned at its cap |

## The numbers behind them

Read from `getBoundingClientRect` on the live DOM (the story renders these into
`[data-composer-measure]`, which is what the capture reads):

| state | bar | field | control row | bar bottom vs pane | field `scrollHeight` | field `overflow-y` |
| --- | --- | --- | --- | --- | --- | --- |
| before (main, #1508) | 810x**46** | one row with the controls | - | 16px | - | hidden |
| idle | 1248x**72** | 36 | 36 | 16px | 36 | hidden |
| two lines | 1248x**92** | 56 | 36 | 16px | 56 | hidden |
| at the cap | 1248x**172** | **136** | 36 | 16px | 176 | **auto** |
| recording | 1248x**72** | 36 | 36 | 16px | 36 | hidden |
| transcribing | 1248x**72** | 36 | 36 | 16px | 36 | hidden |
| transcribe failed | 1248x**72** | 36 | 36 | 16px | 36 | hidden |
| transcribed | 1248x**72** | 36 | 36 | 16px | 36 | hidden |

What those say, in the order the review asked for:

1. **Rest height is the compact form.** Field (36) + control row (36) = 72, and
   the bar's bottom edge is 16px above the pane's in every state - the host
   band's own `pb-4`, with nothing rendered between the bar and the pane.
2. **Dictation adds nothing at rest.** Recording, transcribing and the failure
   row all measure the same 72px bar as idle: the strip occupies the control
   row the bar already has. There is no reserved strip under the composer, and
   the failure sentence only exists while a failed take is in hand.
3. **The field grows with its content and shrinks back.** 36 -> 56 at two
   lines, 136 at the cap (six 20px lines plus the field's 16px of padding), with
   `overflow-y: auto` appearing exactly when `scrollHeight` (176) passes the
   cap. Deleting back to one line returns it to 36 - the idle frame is that
   state, taken after seeding and clearing the draft.
4. **The bar is wider than it was.** 1248 against the old 810: the restored bar
   runs the pane's full width rather than the shared composer's centred
   measure, which is the operator's "full width" criterion.

## What these frames cannot say

The browser host has no JavaScript-evaluate action, so the numbers above come
from the DOM the story itself prints, not from a probing script - and `clientHeight`
is reported as the field's own rect rather than read as a property. Nothing here
measures a real microphone: the take is scripted, and what that leaves unproven
is the browser's capture path itself (permission prompts, device selection),
which no frame can show either way.

The `before` frame is the one committed with #1508, of the same story at the same
viewport, because main's storyboard no longer renders a bar this branch has
replaced. It is the surface this PR changes, one commit earlier.
