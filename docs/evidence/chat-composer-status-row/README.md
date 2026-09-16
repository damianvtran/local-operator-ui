# The composer's status row: the goal and the plan, above the box

The row itself, in the states `docs/composer-status-tabs.md` § 3.1 lists, at the
two column widths its own container queries resolve against.

These frames come from `scripts/capture-evidence.mjs` driving Storybook, which is
the committed and re-derivable route — unlike the composer-readings set beside this
one, whose live-app driver is deliberately not in the tree. The exact command that
wrote them:

```
pnpm storybook --port 6017 --no-open        # 6018 if a sibling worktree holds 6017
node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=chat-composer-status-row \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

This pass ran against 6018: a sibling worktree's Storybook was already listening on
6017, and the frames are whatever the URL you pass is serving.

`--themes` is the two brand palettes, which is `branding.md` § 9.9's minimum, and
the light pass is where contrast defects hide. The tree that added this surface
is what `manifest.json`'s `srcTree`/`scriptsTree` and `partialCapture` carried
then, as they do for every frame here.

**The `states` pair was re-taken for the settled-plan copy** (`fix(composer):
state a settled plan instead of a zero count`): the chip's finished case printed
`0 to-dos open`, which stated the remainder rather than the plan's ending, and it
now says what settled. The two bands that carry that pair are `All to-dos
resolved` (every item done) and `All to-dos closed` (one dropped, and
deliberately not `resolved`) — the sixth band's label says the second half out
loud so the difference is not left to the reader's eye. The run above is that
pass, and `partialCapture` records it at the head that made the change. The other
three directories were re-written by the same run and came back byte-identical,
which is what says the copy change moved no height, no in-flight count and
nothing at the column floor.

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
| `states/` | The matrix in the record's order. **Band 1 is the state that most needs pinning: the row renders NOTHING**, so that band IS the pre-change composer — the box with no row above it, which is what every session with no goal and no plan looked like before this change. Then: goal alone, plan alone at the row's start, both, a plan whose every item is done (`All to-dos resolved`), and a finished plan with an abandoned item (`All to-dos closed`, and deliberately not `resolved`). |
| `long-goal/` | A goal that fits (the chip is content-sized) above a 300-character goal (the snippet truncates). The truncation claim needs the first band to be legible at all: an ellipsis only says anything beside a value that does not need one. |
| `expanded/` | The collapsed row above its own expanded form at a 900px column, the second opened by CLICKING the real trigger. The vertical cost is the difference between the two bands; the body's cap is the whole-line ceiling `CAPPED_BLOCK` sets (120px, six lines at `leading-5`), which the frames show ending on a complete line rather than through a seventh line's glyphs. |
| `column-floor/` | The same pair at a **172px** column — the width the app's chat column actually reaches with the canvas open (QA round 1, measured on the built app; this set was captured at 220px before that correction, which meant it pinned a large-view inset at a width where the product renders the small-view step). The story derives `isSmallView` from its own band width, so the row takes `px-2 pb-1` and the stand-in box `p-2` exactly as the app does. Collapsed, the row stacks with its label visible; expanded, the body takes the row's own width less the primitive's 20px indent. |

## The numbers the bands were measured at

Read from the live DOM of these stories (the rig's own viewport), not from the
record's arithmetic — and stated because four of them are what the record's
§ 2.3 and § 11.1 predicted and two are not:

| | Record | Measured (900, one line) | Measured (172, small view) |
| --- | --- | --- | --- |
| Collapsed row height | 32px | **32px** | **54px** (the stacked arrangement, `pb-1`) |
| Goal chip box | 24px | **24px** | **24px** (156px wide) |
| Plan chip box | 24px | **24px** (112.3px wide, its `Info` mark 14px) | **24px** (112.3px wide) |
| First chip's left edge, both states | one edge | **x=34 in both** (`-ml-1.5`) | — (stacked; the goal chip leads) |
| Row `overflowX` | 0 | **0** | **0** |
| Expanded body measure | (see below) | — | **136px** client, **120px** tall (six whole lines) against **300px** of content — the cap and its own scroller |

**The settled chips are wider than the count chip, and the frames say by how
much.** Read off the re-captured `states` pair the same way the table above was
read: the count chip's ink spans x=40–139, `All to-dos closed` x=40–155 and
`All to-dos resolved` x=40–165, all three starting at the same leading edge and
occupying the same 14px mark-and-label line — so the settled copy adds up to
26px to a chip that is already `shrink-0`, and changes no band's height. The
widest settled chip is therefore ~137px of box against the floor's 156px content
box; that case is arithmetic here rather than a frame, because `column-floor`
photographs the count form and this pass did not add a settled band to it.

Measured with a real browser on these stories, out of the live DOM — not
re-derived from the record's arithmetic, which is what made the first version of
this table wrong in two rows.
The two corrections worth naming: the floor is 172px
and takes the small-view step (so 54px, not 58px, and the body is 136px, not the
168px a large-view inset produced), and the goal's label is VISIBLE at the floor
rather than `sr-only` (design review round 1, D3 and D4).

**The body's 136px is narrower than the ≥160px the record used to call its
acceptance floor, and that floor was the wrong number**: it was arithmetic at a
220px column, `204 − 20`, and the app does not render that column. At the real one
even § 10's option D — the body spanning the whole row — tops out near the row's
own 156px content box. The record's § 11.1 now says this in its own words; the
number here is what the frame contains, and whether a ~136px measure is acceptable
at the floor is the design round's call rather than this set's claim.

## What this set does NOT prove

- **The widest chip this row can render against the floor's content box.**
  `column-floor` photographs the count form, so the settled chips at the 172px
  floor are arithmetic on two frames that share one scale (~138px for
  `All to-dos resolved` and ~128px for `All to-dos closed` against a measured
  156px content box), not a picture. The chip is `shrink-0` and carries no
  `truncate`, so a chip that ever exceeded its box would spill rather than wrap:
  the overflow guarantee for the widest case is a measurement here, and a frame
  of the settled band at the floor is what would make it a photograph (design
  review round 1, D3).

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
- **Nothing here is a live-app geometry claim.** The column width, the box and the
  band heights in these frames are the story's, chosen to match the app's measured
  numbers; the app's own numbers come from QA's driven pass. Where the two now
  agree is stated above and in the record's § 2.4, rather than left to look equal.
- **No hover and no focus ring.** Neither chip's hover wash nor its
  `:focus-visible` outline appears in these frames. The wash is the readings' own
  (`session-status-strip`), already photographed in
  `docs/evidence/chat-session-status-strip/`, and this row imports that exact
  class rather than restating it.
- **Nothing about a draft or a legacy pane beyond band 1 of `states`.** Both
  render nothing, which band 1 shows; a draft's *readings* are a different
  surface's claim.
