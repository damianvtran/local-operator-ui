# A long ask that scrolls, before and after

Rendered stills for the asks-drawer scroll fix in this PR. A four-decision ask
with a long question body and twelve options per question is taller than the
drawer: before the fix a wheel over the question text, an option row or the
option list moved the drawer's list **0 px** (the card's own scrollers carried
`overscroll-behavior: contain`, which stops the chain even with nothing left to
scroll), `Send answer` sat ~2 200 px below the fold with nothing pinned, and the
list was not a Tab stop. After the fix the wheel and the page keys reach the
list, and the card's action row is pinned inside the drawer's port.

## What produced these frames

Not Storybook: the ASSEMBLED app, driven over CDP by
`scripts/asks-app-regression.mjs`'s `asks-scroll` case (the same case CI runs),
with `scripts/asks-app-fixture.mjs` serving its `long` fixture - four fake
decisions ("which colour scheme should the sample app use", and so on), twelve
descriptions, no real conversation, account or host in any frame.

```
# candidate half
ASKS_APP_ROOT=<worktree> ASKS_OUTPUT=<dir> ASKS_RECORDS=<fixture records> \
  node scripts/asks-app-regression.mjs --case asks-scroll --leg candidate
# before half: the same case against the base build, `--leg control`
```

Both halves are the same case at the same three viewports - `440x1024`,
`440x700`, `440x1400`, the drawer as a right-anchored sheet - captured at device
pixel ratio 2 by `Page.captureScreenshot` with no window focus, theme
`localOperatorDark`, locale `en`. The `before-` half is the PR's base
(`0de7a69e23`); the same frames captured against `23576e5e5e` - the commit the
defect was reproduced on - are **byte-identical**, because `0de7a69e23` touches
no path any frame in this set renders.

| Frame | What it shows |
| --- | --- |
| `before-long-ask-440x1024.png` | The top of the card: question body, option list, and the second question's body running off the bottom edge. No action row anywhere in the port. |
| `after-long-ask-440x1024.png` | The same scroll position. `Send answer` / `Decline` are pinned flush to the bottom edge on their own ground; the question and the options scroll beneath them. |
| `before-long-ask-440x700.png` | The short window: the card is taller still, and the actions are further out of reach. |
| `after-long-ask-440x700.png` | The same short window with the pinned row at the bottom edge. |
| `before-long-ask-440x1400.png` | The tall window, where the card still outruns the port. |
| `after-long-ask-440x1400.png` | The tall window with the pinned row. |

## What is asserted, not just photographed

`measurements.json` from each half carries the wheels' before/after `scrollTop`,
the key readings, the pinned row's port check at both ends of the scroll, and the
Tab walk (Chromium's own wheel and key events, never `scrollIntoView`). The PR
body quotes those numbers; the frames are the visual half of the same run.

The operator's own screenshot of the defect is deliberately **not** in this
directory: it shows their conversation text and desktop. Its digest is recorded
in the PR body, and the `before-` frames here are re-rendered with the fake ask
on the same build.
