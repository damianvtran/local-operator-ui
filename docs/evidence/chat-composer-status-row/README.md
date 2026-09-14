# The composer's status row: the goal and the plan, above the box

The row itself, in the states `docs/composer-status-tabs.md` § 3.1 lists, at the
two column widths its own container queries resolve against.

These frames come from `scripts/capture-evidence.mjs` driving Storybook
(`pnpm storybook --port 6017 --no-open`), which is the committed and re-derivable
route — unlike the composer-readings set beside this one, whose live-app driver is
deliberately not in the tree. The exact command that wrote them:

```
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-composer-status-row \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--themes` is the two brand palettes, which is `branding.md` § 9.9's minimum, and
the light pass is where contrast defects hide. The tree is the commit that added
this surface; `manifest.json`'s `srcTree`/`scriptsTree` and `partialCapture` carry
it, as they do for every frame here.

## What is in each frame, and what it proves

The stories render the PRODUCTION `ComposerStatusRow`, over real `RunDetails` from
`deriveRunDetails` over wire-shaped `todos` — so the counts are the model's own,
not a tally written for a picture. Each frame carries more than one band because
every claim here is a comparison: a state, or the same state at another width,
with its control next to it. The composer box under each band is a stand-in whose
only jobs are the ground the row renders on (`rounded-frame border-control
bg-surface p-4`) and a neighbour whose height makes the row's vertical cost
legible; it contains no controls, and nothing in these frames is a claim about it.

| Frame (`<theme>.webp`) | Bands, and what they show |
| --- | --- |
| `states/` | The matrix in the record's order. **Band 1 is the state that most needs pinning: the row renders NOTHING**, so that band IS the pre-change composer — the box with no row above it, which is what every session with no goal and no plan looked like before this change. Then: goal alone, plan alone at the row's start, both, and a finished plan still saying `0 to-dos open`. |
| `long-goal/` | A goal that fits (the chip is content-sized) above a 300-character goal (the snippet truncates). The truncation claim needs the first band to be legible at all: an ellipsis only says anything beside a value that does not need one. |
| `expanded/` | The collapsed row above its own expanded form at a 900px column, the second opened by CLICKING the real trigger. The vertical cost is the difference between the two bands; the body's cap is the `max-h-32` ceiling. |
| `column-floor/` | The same pair at a 220px column, which is the canvas pane's open width. Collapsed, the row stacks and the goal's label goes `sr-only`; expanded, the body takes the row's own width less the primitive's 20px indent. |

## The numbers the bands were measured at

Read from the live DOM of these stories (the rig's own viewport), not from the
record's arithmetic — and stated because four of them are what the record's
§ 2.3 and § 11.1 predicted and two are not:

| | Record | Measured (900) | Measured (220) |
| --- | --- | --- | --- |
| Collapsed row height | 32px | **32px** | 58px (the stacked arrangement; the record's 54px assumes the small-view `pb-1`) |
| Goal chip box | 24px | **24px** | **24px** |
| Plan chip box | 24px | **24px** | **24px** |
| Row `overflowX` | 0 | **0** | **0** |
| Expanded body measure | ~184px | — | **168px** (client), 128px tall against 260px of content — the cap and the scroll |
| Expanded body floor | ≥160px | — | **168px clears it** |

The 220px body is 168px rather than the record's ~184px because that arithmetic
took the small-view inset (8px a side) where the row renders the `p-4`/`p-2` step
the alert uses: 220 − 32 − 20. It clears the 160px floor the record sets, so its
§ 11 risk 1 does not land and § 10's option D is not needed.

## What this set does NOT prove

- **Not the live composer.** The row's real neighbours in the app are the send
  alert and the composer box, whose widths come from the chat column and the
  canvas pane; here they are a stand-in at a chosen width. The set the live app
  owns for this region is `docs/evidence/composer-readings/`, and the geometry
  claims that depend on the real column belong there.
- **No interaction beyond the two clicks.** The expanded bands were opened by a
  click on the real trigger, which is what makes the body's existence a rendered
  fact rather than a forced prop. The plan chip's REVEAL — pane open, reader left,
  To-dos section scrolled into view, focus unmoved — is a flow across three
  components, and a still of a story cannot show a scroll position in a pane that
  is not mounted. It is covered by `scripts/composer-tabs.test.mjs` for the
  request's mechanics and by QA's independent pass for the flow.
- **No hover and no focus ring.** Neither chip's hover wash nor its
  `:focus-visible` outline appears in these frames. The wash is the readings' own
  (`session-status-strip`), already photographed in
  `docs/evidence/chat-session-status-strip/`, and this row imports that exact
  class rather than restating it.
- **Nothing about a draft or a legacy pane beyond band 1 of `states`.** Both
  render nothing, which band 1 shows; a draft's *readings* are a different
  surface's claim.
