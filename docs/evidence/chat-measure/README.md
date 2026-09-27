# The chat column's shared measure, narrowed from 900px to 820px

Frames and readings for the one number `CHAT_MEASURE` resolves against -
`--lo-chat-measure` in `src/renderer/src/styles/index.css` - at the shipped
value and at the value the column carried before this change.

## How to reproduce

```sh
# Storybook on any free port
./node_modules/.bin/storybook dev -p 6183 --ci
# Frames into docs/evidence/chat-measure/ and the readings to stdout
node scripts/chat-measure-evidence.mjs http://localhost:6183 --json
```

The rig is `scripts/chat-measure-evidence.mjs`: raw CDP against a private
headless Chrome (fresh `user-data-dir`, `--use-mock-keychain`, killed on exit),
every frame passed through `check-evidence.mjs`'s own `assertFramePaints` guard
before it is written. It is a purpose-built rig rather than
`capture-evidence.mjs --only=...` for one reason: **half of this set cannot be
swept at all.** A frame of the 900px measure is not a frame of the tree at any
later head - the stylesheet no longer contains that value - so the pair can only
come from a rig that renders both, and it is declared as a `supplementary` set in
`docs/evidence/manifest.json` beside the other sets a sweep cannot produce. The
stories themselves are ordinary ones (`Chat/Measure`, `chat-measure.stories.tsx`)
and are open to any reviewer in Storybook.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| `transcript-at-820/` | The shipped measure: a 1,059-character answer and a run of three tool rows in a 1024px pane, so the cap is at its full value. 9 lines, widest line 815.7px. |
| `transcript-at-900/` | The **previous** value on the identical tree, records, viewport and fonts - the only difference is the override on the wrapper. 8 lines, widest line 891.0px. |
| `narrow-pane-at-820/`, `narrow-pane-at-900/` | **The control pair.** A 700px pane, which is below the 868px an 820px cap needs to bind, so both measures must render the same 668px content box. The rig FAILS the run if they differ, and the two frames are byte-identical in their layout: this is the answer to "does the narrower number fight the responsive step" for the low end. |
| `composer-row-at-820/`, `composer-row-at-900/` | The regression surface the measure is *shared* with: the composer's readings row, in `chat-composer-status-row--states`, under both measures. |

## The readings

Every number below is printed by the rig in the same run that writes the frames,
from the live DOM (`getBoundingClientRect`), at the 1024px pane in
`localOperatorDark` unless stated.

| | content measure | insets (L/R) | lines | chars/line | widest line |
| --- | --- | --- | --- | --- | --- |
| shipped (820px cap) | 820.0px | 102.0 / 102.0 | 9 | **117.7** | 815.7px |
| previous (900px cap) | 900.0px | 62.0 / 62.0 | 8 | **132.4** | 891.0px |
| 700px pane, 820px cap | 668.0px | 16.0 / 16.0 | 11 | 96.3 | 666.2px |
| 700px pane, 900px cap | 668.0px | 16.0 / 16.0 | 11 | 96.3 | 666.2px |

**Characters per line is a lower bound, not an average of full lines**: it is the
sample's character count (1,059) divided by the number of rendered line boxes,
which includes the short final line. The `ch`-unit figures `markdown.css` carries
(98.1 `ch` at 900px) are a *different quantity* - `ch` is the width of the glyph
`0`, about half again as wide as an average character of prose - and that file
says so; its character figure, counted from the rendered breaks, is 131 on an
832.6px line. 132.4 at 900px on this sample is the same quantity and agrees.

So: **80px of column buys 14.7 characters a line, 11%.**

The composer readings row is 53.5px and single-line under both measures at that
story's 900px column - the row does not re-wrap. The column there is 900px, so
the cap does not bind and the narrowing under test is 32px rather than 80; the
full 80px is exercised at panes of 948px and above, which is where the
transcript frames are taken.

## What this set does NOT prove, stated rather than implied

- **`transcript-at-900` is not a frame of `origin/main`.** It is the current tree
  with `--lo-chat-measure` overridden to the previous value on the frame's own
  wrapper. That is what makes it a controlled comparison - no other variable
  differs - but it is a comparison, not a "before" photograph. Nothing else on
  `origin/main` could change the column at this viewport: the cap binds at both
  values, and the 750px gate is below both.
- **Only two of the twelve sweep palettes.** The change is geometry, not colour,
  so the pair is taken in the light and dark default themes; the remaining ten
  sweep themes carry the same box.
- **The narrowing's effect on OTHER committed frames is not re-photographed.**
  Every swept frame of a surface that renders the transcript or the composer at a
  pane wider than 868px now shows an 80px narrower column than the frame on disk,
  and those frames were not re-taken with this change. They are not stale about
  their own claim (the frame text, the tokens, the reasons), but they are no
  longer pictures of the current geometry. The count is in the PR body.
- The composer check is a first-order one: a row that re-wrapped would change the
  band height, and the height is unchanged. It is not a pixel diff of the row.
