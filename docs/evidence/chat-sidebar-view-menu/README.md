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
```

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
| `popover-open` | the panel on a fresh view: four labelled groups, one check per single-choice group, seven section rows with the rail. Re-shot by this pass; the three-group panel it replaces is this set's previous revision in git. |
| `popover-basis-last-active` | the basis fixture below under the DEFAULT basis: `Stored view: section/active/active-first`, `basis [active=true created=false]`. |
| `popover-basis-created` | the same fixture with `Created` pressed: the check moves, the readout says `section/created/active-first`, and the sections and labels below re-read. |
| `reorder-edges` | the rail after D1: Pinned and both entity rows draw NO pair; Running's up and Older's down are disabled; a legal press (`today:down`) still moves the section. |
| `popover-open-short` | D2's own capture: the same panel in an 800x600 window, where the fourth group pushed it past the floor. The FIRST shot of this state clipped (the panel ran off the bottom; the Teams row was unreachable), so the panel took `max-height: var(--radix-popover-content-available-height)` and its own scroll, and the frame above shows the remedy with its numbers in the readout: `box 240x558 · bottom 600/600 · content 598 (scrolls)` - the box ends inside the window and the content overflows the box BY DESIGN, which is what makes the last row reachable. |
| `popover-hidden-section`, `popover-reordered-pair`, `page-ladder-*`, `section-cap-*`, `expanded-agent-group`, `band-resting`, `band-*-hover`, `off-route-voice` | the states earlier passes added; unchanged by this one. |

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
or the entity rows, Running's up disabled (its shown neighbour is Pinned), Older's
down disabled (the entity region), and a legal `today:down` press still reorders
the panel and the list behind it. The model's rule is `canMoveSection`, asserted
in `scripts/chat-sidebar-view.test.mjs`; this frame is the same rule seen from
the pointer's side.

## What these frames do NOT prove

- **Latency.** Nothing here carries a timing; the completion-to-bin reading is in
  `../chat-sidebar-status-feed/README.md` (26.3 s before the fix, 1 ms after).
- **Focus and hover states.** A hidden window has no focus, and hover is pointer
  state; the band's own hover frames live in this set from earlier passes.
- **Where the before half of the popover lives.** It is this set's previous
  revision in git (the three-group panel, captured under
  `remediationRound4EvidenceNote`'s pass); this pass re-shoots `popover-open`, the
  basis pair, the rail and the short capture, and
  does not re-take the base tree, which is a pass of its own. A design round that
  wants the pair side by side can ask for it.
- **What sits below `popover-open-short`'s fold.** The panel scrolls, so what a
  tall window would show under the box's edge is not in the frame; the readout's
  own numbers carry the claim instead (`content 598` against `box 240x558`), and
  the story's play asserts all seven rows are present. The pre-remedy shot of the
  same state - the clipped one - is described in the state's row above rather
  than kept beside it: a frame that photographs a defect the same pass removed
  belongs to the record of the reading, not the set.
