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

## Round 1 remediation — keyboard ownership (2026-10-31)

The focused field used to send its existing draft on Enter during a
microphone-button recording, before the dictation listener could confirm the
take (R1). While recording or preparing, the field now leaves keyboard actions
to dictation rather than mention selection or ordinary submission. Outside a
take the mention-first handler is unchanged. The dictation listener ignores IME
confirmation (`isComposing` / key code 229).

Executed regression evidence: current-head RED reproduced a send of
`["typed draft"]` on recording Enter. After remediation, the dictation cases
pass 9/9, including empty/nonempty drafts, zero sends on confirmation, retained
typed text, finished recording, IME Enter, idle Enter/Shift+Enter, and PTT
release. Mention regressions pass 13/13 and composer-ring checks 7/7. Commands
use `NODE_OPTIONS=--max-old-space-size=2048`, serial execution, and
`run_bounded.py --timeout 240 --memory-mb 4096`.

These are scripted microphone/relay tests, **not native microphone evidence**.
The frames above were captured before this keyboard-only remediation; no new
Storybook, native build or capture was run under the disk constraint. Independent
design round 1 inspected the restored full-width/two-row shape, growth,
recording controls, ring and five contrast pairs. Its scope was bounded by
ENOSPC: disabled, send-in-flight, loading/error, narrow, notice-producing
mentions, remaining themes/accent/display axes and consecutive animation frames
are **not visually signed off**. The old frames are not fresh proof of those
states. D1's circular Send is deliberately retained: it was already present in
the intervening bar and observed in that bounded review; it does not change the
requested field width, rounding, line arrangement, growth or dictation. Restoring
a different button silhouette without fresh rendered evidence is outside this
keyboard-only round. No claim of complete historical pixel fidelity is made.

## QA round 3 — width-only reflow (2026-10-31)

Q3 reproduced on the actual shipping composer: a wide two-line draft retained
its explicit 56px field height after narrowing without input, even though
`scrollHeight` had become 156px, with overflow hidden. The layout effect only
reacted to text. The fix observes the actual textarea width and remeasures the
same content with the existing cap/scroll-position logic. Height-only observer
deliveries do not remeasure; effect cleanup disconnects and fences queued stale
callbacks (including draft-effect replacement and unmount).

### Real rendered before/after, not JSDOM geometry

These three new frames were captured and actually inspected through the harness
browser, 1280×720 DPR2, using QA's synthetic component host copied into the coder
session's `q3-fixture/` scratch directory. It imports the shipping component and
unmodified shipping CSS, explicitly scans the renderer tree for Tailwind rules,
and uses existing dependencies only. A single Vite instance ran under isolated
HOME/config and a constructed environment, 1536MiB Node heap / 2048MiB owned-PG
bound / 600s timeout. No Storybook, app/native build or dependency installation.

| Frame | Source and action | Actual field / scrollHeight / overflow |
| --- | --- | --- |
| `q3-before-narrow.png` | `5fbc63fbc60` composer control; width1248→328, draft unchanged | 56 / 156 / hidden (clipped) |
| `q3-after-narrow.png` | working-tree Q3 fix; same width transition and unchanged draft | 136 / 196 / auto (cap with scroll) |
| `q3-after-wide.png` | fixed source; widen back328→1248 without input | 56 / 56 / hidden (shrinks) |

The draft is `Natural wrapping draft. ` repeated14. Its value was read back
unchanged after each width transition. Narrow bar172/control row36/bottom gap16;
wide bar92/control row36/bottom gap16. The after-narrow scrollHeight includes the
narrower usable area once a scrollbar is enabled; it need not equal the clipped
control's value. The host's top identity label is static and says
`5fbc63fbc60 + uncommitted Q3 width observer` in all three frames: the BEFORE
control temporarily loaded the exact HEAD composer via `git show HEAD:<path>`;
the backed-up fixed source was restored immediately afterward and the narrow /
wide transitions repeated successfully. That label is not a build receipt.
Existing independent QA round-3 frames remain untouched in QA session
`af7ff90a3035`'s scratch `composer-fixture/` directory. No claim that this callback
fixture proves optimistic-send integration or hub delivery.

### Focused RED/GREEN and cleanup

The new synthetic ResizeObserver mechanism test fails RED on the old source
(no width observer), then passes GREEN. It asserts width-only growth/capping,
shrink-on-widen, unchanged text, no remeasure on height-only callbacks,
observer disconnect and no stale callback work after unmount. JSDOM's synthetic
scrollHeight is **not** rendered proof; the actual browser frames above are.
Final targeted dictation cases: **10/10**, 1536MiB heap, 2048MiB PG, serial,
`run_bounded.py --timeout 120 --memory-mb 2048 -- node --test --test-force-exit
scripts/team-bridge-composer-dictation.cases.mjs`. The browser tab was closed,
fixture process group77816 terminated, group and port61511 verified absent.
Remaining native/media/hub and full visual-matrix limitations above still apply.
