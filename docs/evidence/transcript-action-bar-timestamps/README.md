# Transcript action-bar timestamps

The operator's follow-up to the action-bar restoration (#1260), photographed on
the real built app.

> "The timestamp must appear on ALL final responses and on user messages — not
> only the very last agent response. ... Final responses get the time, including
> in-between ones. If it is a final response, it has a time. ... User messages
> get the time too — on their row beneath the message, same position,
> right-aligned. ... at the right of the action line ... Keep the same treatment
> as the existing one: `10:16 PM` is small, muted, and sits at the row's right
> edge. Absolute time only; no '2m ago' on this surface."

Clarified the same day: "The timestamp is always rendered, always visible ...
The icon slots are always in layout ... On hover, only OPACITY changes. No
reflow, no width change, no shift of the timestamp."

## The rule

- **User message** — the timestamp is the last child of the right-aligned action
  line under the bubble; the Copy/Fork icons sit to its left with their width
  reserved at rest. The stamp is a SIBLING of the toolbar, not inside it, so it
  is painted at rest and cannot fade with the icons. It renders for every user
  message with a timestamp, including an attachment-only send whose action row
  has no words to copy.
- **Final response** — the closing answer keeps the stamp on its foot line; every
  non-closing final response carries its own stamp on its meta row, after the
  action row, inside the same right-aligned span. `TurnTimestamp`'s scope is
  `turn` ("Sent") on a user message and `answer` ("Answered") on a response.
  The two branches are mutually exclusive, so no message is stamped twice.
- **In-between commentary** — a text-bearing assistant message that carries its
  own `tool_calls` is status narration, not a final response: it keeps the
  hover-only overlay and gets no stamp and no reserved row.

The old design round 1's D7 removed user stamps for density; the operator
superseded that on 2026-10-20. This set records the new per-message rule.

## The no-shift mechanism

`ACTION_ROW_REVEAL_CLASSES` changes opacity only; the icon buttons keep their
`size-7` boxes and the row's `h-8`/`gap-1` at rest. The stamp is a sibling after
the toolbar with a static `gap-2`, so its box is fixed and only the icons'
opacity changes. QA measured the stamp and every button at rest and on hover:
all deltas `{0,0,0,0}`.

## Frames

Every frame is a real capture at the app's own pixel size (DPR 2); nothing was
resized. Themes are the palette ids. The pixels are rig output in the ignored
`docs/evidence-frames/transcript-action-bar-timestamps/` tree (the post-#1256
split; see `.gitignore`) and are hosted on the
`evidence/1285-action-bar-timestamps` branch under
`docs/pr-evidence/1285-action-bar-timestamps/`. No frame is committed on the PR
branch.

| Class | State | Viewport | Theme | Shows |
| --- | --- | --- | --- | --- |
| user | rest / hover | 1380×900 | light, dark | stamp visible at rest while the icon row is `opacity 0`; icons fade in on hover; stamp delta `{0,0,0,0}` |
| mid-turn final | rest / hover | 1380×900 | light, dark | stamp at the right of the meta row after the full Copy/Speak/Fork set; no `Worked for` caption; hover delta 0 |
| closing answer | rest / hover | 1380×900 | light, dark | the existing foot stamp, unchanged and stable; no duplicate |
| user, mid-turn final, closing, user-at-800 | rest / hover | 800×900 | light, dark | the app's minimum width: stamp and icons fit with an 8px gap, no clipping or overlap, zero shift |

## Measured numbers

From QA's real-app reports on this head, all `ok: true`:

- **User message, 1380 light:** stamp `right=1203` = bubble `right=1203`; stamp
  visible at rest (`opacity 1`) while the action row is `opacity 0`; hover stamp
  delta `{0,0,0,0}` and Copy/Fork each `{0,0,0,0}`; the stamp is outside the
  toolbar.
- **Mid-turn final response, 1380 light:** the same pattern with the full
  three-button set; each button and the stamp delta `{0,0,0,0}`; one
  `data-stamp="answer"` per message.
- **Closing answer, 1380:** the existing foot stamp is present, visible at rest,
  and stable on hover; one stamp for that message.
- **800 minimum:** stamp `x=624.5..732` (107.5×17.4), icons
  `x=556.5..616.5`, gap `8.0px`, fully inside the transcript and viewport,
  overlap `0` with the bubble and the next row, hover deltas `0`.
- **Counts:** 7 messages in the fixture, every one carrying exactly one stamp;
  users `scope="turn"`, final responses `scope="answer"`.
- **Tests:** `turn-timestamp.test.mjs` 29/29; `transcript-copy-affordances.test.mjs`
  22/22; `turn-segments.test.mjs` 96/96.

## Provenance

Real built app, driven headless over CDP by QA's rig against an isolated daemon
(`127.0.0.1:18731`) and a scratch config; no live session, no hand-composited
frame. Head: `f542db56e0`. The C3 remediation widens the mid-turn row to a
textless final response (reply-only markup) behind a unit test; the captured
surfaces are text-bearing and unchanged by that condition. PR #1236's opt-in
`display.message_timestamps` / relative-style setting is a separate product
decision; this surface states absolute time and adds no setting.
