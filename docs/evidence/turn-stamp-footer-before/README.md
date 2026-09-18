# The transcript's footer stamp — the BEFORE half of the pair

Ten frames: four states, each in the two `localOperator*` themes, captured from the tree this
branch is based on (`318cbb75e`) rather than from the branch. Each one is the same story as its
after half under `docs/evidence/chat-tool-rows/`, so a pair differs by the change and not by its
fixture.

This is the half of the pair that photographs the **operator's report** rather than a claim about
it: on 2026-09-17 they sent a frame of a session mid-turn with a stamp under the user's bubble and
a second stamp under the working line at the foot of the transcript — "the time that shows up
below messages also seems to be showing up below the thinking indicator, make sure that it
doesn't, only beside user messages and in tool traces when expanded".

| Frame | What the BEFORE half shows | The after half |
| --- | --- | --- |
| [`turn-boundary-and-working-line`](turn-boundary-and-working-line/) | **The reported state.** The aggregate working line is the last thing in the transcript (`⠹ Measuring the row pitch is`, spinner live) and the transcript's footer stamp sits directly under it, right-aligned: `Oct 9, 2025, 4:53 AM`. | [`../chat-tool-rows/turn-boundary-and-working-line/`](../chat-tool-rows/turn-boundary-and-working-line/) — the same transcript, ending at the working line with nothing beneath it. The stamp's own row is measured there: 472 ink pixels before, none after. |
| [`prose-tool-alignment@1024`](prose-tool-alignment@1024/), [`@1440`](prose-tool-alignment@1440/) | A transcript ending on the agent's ANSWER with the footer stamp under it. This is the case the removed line existed for, and the one whose loss the removal accepts deliberately. | [`../chat-tool-rows/prose-tool-alignment@1024/`](../chat-tool-rows/prose-tool-alignment@1024/), [`@1440`](../chat-tool-rows/prose-tool-alignment@1440/) — the same prose, and no time at the foot. These two are the pair's clean measurement: the whole difference between the halves is the stamp's own box. |
| [`turn-timestamps`](turn-timestamps/) | A transcript ending on a USER turn: the first control. The footer was already gated away here, because the turn's own stamp is one line above it — so this is the pair that must come back with the same placement, and it is where a change that over-removed would show. | [`../chat-tool-rows/turn-timestamps/`](../chat-tool-rows/turn-timestamps/) — one stamp, under the bubble, where it was. Its frames are NOT re-encoded by this branch: the DOM carries no footer here on either tree. |
| [`expanded-detail`](expanded-detail/) | An OPEN tool call as the last row: the second control. The footer was gated away here too, and the call's own stamp sits at the foot of the expanded body, inset 16px to the row's meta column. | [`../chat-tool-rows/expanded-detail/`](../chat-tool-rows/expanded-detail/) — the disclosure's own stamp unchanged, and still the only time on the page. Also not re-encoded. |

## Where these came from, and why they are a capture rather than a copy

`node scripts/capture-evidence.mjs http://127.0.0.1:6117 --only=chat-tool-rows
--themes=localOperatorDark,localOperatorLight --allow-backend`, run **in this worktree on
`318cbb75e` before any edit to it**, with its own Storybook. The story ids, the fixtures and the
viewports are the base tree's, so the frames are a picture of the state the change is compared
against.

A copy of the committed frames would have been cheaper and would have been an assumption: a copy
carries no evidence that it still matches what the base tree renders. Capturing them makes it
evidence, and the comparison came back with numbers rather than a claim — **two of these ten frames
are byte-identical to the committed copy of the same path, and none of the rest is a content
difference**:

| Story | Frame | `magick compare -metric AE` against the committed frame |
| --- | --- | --- |
| `expanded-detail` | both themes | 0 (dark differs by 29px in an 8x8 box, a glyph edge) |
| `prose-tool-alignment@1440` | both themes | 0 |
| `prose-tool-alignment@1024` | light | 0 |
| `prose-tool-alignment@1024` | dark | 3,114, confined to the rendered glyphs of the prose block (865x269 at the paragraph) |
| `turn-boundary-and-working-line` | dark | 330, the working line's own clock cell (202x17) |
| `turn-boundary-and-working-line` | light | 36,166, spanning the transcript content |
| `turn-timestamps` | both themes | 9,125 / 11,473, the day-relative fixtures below |

A non-zero entry here is the capture's own noise floor, not a content change: the same story on the
same tree re-rendered can land its glyphs on different subpixel boundaries (a `scrollTop` that
differs by a fraction, a webfont that has or has not settled), which moves antialiasing across a
whole block without moving a row. This is stated rather than hidden because it bounds what any
before/after pair in this set can claim, and the pair's own claim is measured on the band that held
the stamp (see the after surface's README).

`--themes=localOperatorDark,localOperatorLight` and not the sweep's twelve: a pair is read side by
side in the brand palettes, and the swept homes' other ten themes are refreshed by the same pass
that lands these. The frames under `docs/evidence/chat-tool-rows/` carry all twelve, as that
surface's own README states.

## What this pair can and cannot show

- **The working line is live, so `turn-boundary-and-working-line` is not a still.** Its spinner and
  its phase clock tick, so two captures of the SAME unchanged tree already differ inside that row.
  The pair therefore differs by the stamp AND by whatever the clock read; the stamp's own removal
  is what the crop below measures, and the clock is why this story's frames were left out of the
  previous turn-stamp pair for the same reason.
- **`turn-timestamps` is a function of the day.** Its fixtures are offsets from `Date.now()`
  (`tool-row.stories.tsx` says why: a stamp reading `Sep 12, 2025` photographed the day after it
  was taken is not evidence of a relative-time rule). Both halves of this pair were captured inside
  one window on one day; a later re-capture of the same tree moves that story's text again with no
  code change, which is the property its own README records rather than hides.
- **This set answers nothing about the other ten themes or the other five surfaces** whose stories
  end on a record that used to carry a footer. The refresh that lands beside it is where those are
  covered, and `docs/evidence/manifest.json`'s `partialCapture` names what it wrote.

## Declared, not swept

A sweep captures the CURRENT tree, so it can never regenerate these: they need the base tree's own
component under the same stories. The set is declared in `docs/evidence/manifest.json`'s
`supplementary` list for that reason, which is what stops `clearSweptFrames` deleting it and keeps
the swept frame count honest.
