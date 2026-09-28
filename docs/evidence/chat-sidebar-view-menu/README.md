# The sidebar's view popover — its four groups, and the two clocks the sections read

The frames in this set photograph the sidebar's view panel (`data-sidebar-view-panel`)
in the states the operator drives it through: the panel at rest, a section
switched off, the reorder rail, the page ladder — and, since 2026-09-28, the
**Time basis** control the operator asked for ("default it should bin by last
active and not creation date … maybe we can also add configurability for how
that works within the sidebar configuration") together with the rail's own
repair (design direction D1).

## What produced these frames

Storybook, from this branch:

```
npx storybook dev -p 6047 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6047 --only=chat-sidebar-view-menu--popover-open --allow-backend
node scripts/capture-evidence.mjs http://localhost:6047 --only=chat-sidebar-view-menu--popover-basis- --allow-backend
node scripts/capture-evidence.mjs http://localhost:6047 --only=chat-sidebar-view-menu--reorder-edges --allow-backend
node scripts/capture-evidence.mjs http://localhost:6047 --only=chat-sidebar-view-menu--popover-open-short --allow-backend
node scripts/capture-evidence.mjs http://localhost:6047 --only=chat-sidebar-view-menu--popover-open-narrow --allow-backend
```

THE ROUND-1 RE-SHOOT PASS re-took every state the round-1 fixes touch, from the
folded tip: `popover-open` and both basis stills (the `Created` row's glyph, D3,
and the empty-section rail rule, m1/U1), `reorder-edges` (the same rule),
`popover-open-short` (the panel's 16px bottom inset, D1), `popover-hidden-section`
and `popover-reordered-pair` (panel states too - the glyph and the rule are in
their content), and the new `popover-open-narrow` (Q-2's reachable short window).
`completion-moves-bin` was not re-taken: the D2 fix is inside its settle loop and
changes no pixel.

Twelve themes per state, the set's convention (the sweep's own list). The port
was 6047 because the neighbours were serving other sessions' worktrees at the
time — nothing about the frames depends on it. `--allow-backend` is required
while the operator's own backend answers on 1111; these stories stub their own
transport, so no frame here can show that backend's replies.

The first capture after a story file changes can fail on a cold Storybook while
vite transforms the component graph; a re-run of the same command succeeds. One
capture in this pass also died to a watch reload of `docs/evidence/manifest.json`
mid-play — the next run of the same command took all 24 frames — which is a flake
of the rig, not of the state.

## What each frame is

| story | what it is |
| --- | --- |
| `popover-open` | the panel on a fresh view: four labelled groups, one check per single-choice group, seven section rows with the rail. Re-shot by this pass (the four-group panel) and by round 1 (the `Created` row's action-less `Calendar` glyph, D3). The three-group panel it replaces is this set's previous revision in git. |
| `popover-basis-last-active` | the basis fixture below under the DEFAULT basis: `Stored view: section/active/active-first`, `basis [active=true created=false]`. |
| `popover-basis-created` | the same fixture with `Created` pressed: the check moves, the readout says `section/created/active-first`, and the sections and labels below re-read. |
| `reorder-edges` | the rail after D1 and round 1's m1/U1: Pinned and both entity rows draw NO pair; Running's pair is disabled on BOTH sides (its up-neighbour is Pinned, and an empty section's own press draws nothing either); Today's up is disabled (its shown neighbour, the empty Running, draws nothing) while `today:down` is live; Older's down is disabled. The legal press still moves the section in the panel and the column behind it. |
| `popover-open-short` | D2's own capture: the same panel in an 800x600 window, where the fourth group pushed it past the floor, plus round 1's D1 inset: the cap is `calc(var(--radix-popover-content-available-height) - 16px)`, so the panel's own bottom edge - and its rounded corner - stays 16px above the window's instead of the box ending flush. What the fold clips is the NEXT SECTION'S TOP PADDING, not a sliver of its content: round 2 (D4) measured zero content pixels above the fold in six themes (the cut would have to land 8-12px lower to cross the glyphs), and the content-sliver cue is consciously not taken - the inset's visible claim is the panel's own edge, which is what the frame's numbers describe: `box 240x542 · bottom 584/600 · content 598 (scrolls)`. The first shot of this state clipped outright (the panel ran off the bottom; the Teams row was unreachable), and the earlier wording of this row promised a content sliver the pixels do not show. |
| `popover-open-narrow` | the same state in the shape the APP can reach with a short window (round 1, Q-2): the popover does not exist below ~1024px - the nav rail collapses and the trigger is not drawn - so a docked width with a short height (1100x600) is the honest worst case. Same inset, same numbers (`box 240x542 · bottom 584/600`). |
| `popover-hidden-section`, `popover-reordered-pair`, `page-ladder-*`, `section-cap-*`, `expanded-agent-group`, `band-resting`, `band-*-hover`, `off-route-voice` | the states earlier passes added. The two panel states were re-shot in round 1 (the glyph and the rail rule are in their content); the rest are unchanged by this pass. |

## The Time basis pair, and what the sections say under each

One roster, two clocks. The fixture (in `chat-sidebar-view-menu.stories.tsx`,
`basisRoster`) is the operator's own case plus the two rows every basis must
leave alone:

| row | created | last active | Last active | Created |
| --- | --- | --- | --- | --- |
| `basis-moved` — "Backdated ledger, asked today" | 40 days ago | 1 hour ago | TODAY "1h" | OLDER "5w" |
| `basis-born` — "Started this morning" | 2 hours ago | 30 minutes ago | TODAY "30m" | TODAY "2h" |
| `basis-steady` — "Untouched for over a week" | 30 days ago | 9 days ago | OLDER "1w" | OLDER "4w" |
| `basis-pinned` — pinned | 20 days ago | 5 days ago | PINNED (no time label) | PINNED |
| `basis-running` — busy | 2 days ago | 5 minutes ago | RUNNING (no label) | RUNNING |

So the popover's counts shift with the membership — Today 2 ↔ 1, Older 1 ↔ 2 —
while Pinned and Running are the same two rows in the same two places on both
sides. That is the design's invariance claim in one pair of stills, and the
`basis [active=… created=…]` line in each readout is how a reviewer reads which
half they are looking at without trusting the checkmark's pixel position.

**The order is not the basis's to change**, and the press asserts it: after
`Created` lands, each section's drawn rows must still be in the catalogue's own
relative order (`PopoverBasisCreated`'s play throws otherwise; the first version
of that check compared the whole column and failed on the membership change
itself, which is the feature — the check now reads the sections separately).
Ordering is `Order by`'s axis and grouping is `Group by`'s; the basis is a third
axis and moves only what the numbers MEAN.

**The labels change with the basis, and the accessible sentence names it.**
The visible label stays terse (`1h`, `5w`); the sr-only tail under the row says
`last active 1 hour ago` or `created 5 weeks ago`, so a switched reader is never
guessing what the number measures. That is a DOM/AT read rather than a
photograph; it is pinned in `scripts/chat-list-sections.test.mjs` (both bases)
and visible in the readout's per-row lines where those stories print them.

## The calendar-day rule, and the "2h under THIS WEEK" reading

TODAY is this LOCAL calendar day, not a rolling 24 hours — a row last active at
23:00 yesterday is THIS WEEK at 09:00 today, with a label of `10h`. The
surprising-but-correct case the design names is a row moved 2 hours ago at
01:30 landing under THIS WEEK with a label of `2h`: possible only between
midnight and 02:00, because "today" is the day that has started rather than the
last 86 400 seconds. A capture cannot be scheduled into that window from here,
so the pair above carries the same rule with the labels the capture's own clock
produced (`basis-moved` is TODAY under Last active and OLDER under Created; the
midnight boundary itself is covered by `scripts/chat-list-sections.test.mjs`,
which asserts `midnight → today` and `midnight - 1ms → week` on both bases).

## The rail (D1)

Before this pass the panel drew a move pair on every non-entity row and enabled
it from "is there a shown section above/below" alone, so a press could land
where the column cannot follow: Pinned always draws first, and the entity region
draws in fixed source order. `reorder-edges` shows the repair: no pair on Pinned
or the entity rows, Running's pair disabled on both sides (its shown neighbour
is Pinned, and an empty section's own press is invisible), Older's
down disabled (the entity region), and a legal `today:down` press still reorders
the panel and the list behind it. Round 1 extended the rule to the empty-section
case (m1/U1): an empty chat section draws no label, so a swap with one - or from
one - rewrites the stored order while the column stands still; `canMoveSection`
now takes the caller's drawability predicate (the sidebar's own per-section
counts, the same numbers the headers draw) and requires BOTH ends of the move to
draw. The model's rule is asserted in `scripts/chat-sidebar-view.test.mjs`
(both ends, the empty-source mirror, and the predicate-less geometric form);
these frames are the same rule seen from the pointer's side.

## What these frames do NOT prove

- **Latency.** Nothing here carries a timing; the completion-to-bin reading is in
  `../chat-sidebar-status-feed/README.md` (26.3 s before the fix, 1 ms after).
- **Focus and hover states.** A hidden window has no focus, and hover is pointer
  state; the band's own hover frames live in this set from earlier passes.
- **Where the before half of the popover lives.** It is this set's previous
  revision in git (the three-group panel, captured under
  `remediationRound4EvidenceNote`'s pass); round 1 re-shoots `popover-open`, the
  basis pair, the rail, the short capture, the two other panel states and the
  new narrow state, and does not re-take the base tree, which is a pass of its
  own. A design round that wants the pair side by side can ask for it.
- **What sits below `popover-open-short`'s fold.** The panel scrolls, so what a
  tall window would show under the box's edge is not in the frame; the readout's
  own numbers carry the claim instead (`content 598` against `box 240x542`), and
  the story's play asserts all seven rows are present. The pre-remedy shot of the
  same state - the clipped one - is described in the state's row above rather
  than kept beside it: a frame that photographs a defect the same pass removed
  belongs to the record of the reading, not the set.
- **THAT THE 800x600 SHAPE IS REACHABLE.** It is not: the panel's floor capture
  is the design contract's window minimum (`WINDOW_MIN_WIDTH/HEIGHT`), but at
  800x600 the app's nav rail is collapsed and the View options trigger does not
  exist (round 1's Q-2, reproduced independently). `popover-open-narrow`
  (1100x600) is the frame for the reachable shape; the short one is kept because
  the contract it tests is at that size, and its numbers are the contract's.
