# The chat sidebar's controls and states — the popover, the ladder, the caps, the group bound and the section gap

The frames in this set photograph the sidebar's view panel
(`data-sidebar-view-panel`) in the states the operator drives it through — the
panel at rest, a section switched off, the reorder rail, the page ladder — and,
since 2026-09-28, the **Time basis** control the operator asked for ("default it
should bin by last active and not creation date … maybe we can also add
configurability for how that works within the sidebar configuration") together
with the rail's own repair (design direction D1). This set is
`chat-sidebar-view-menu.stories.tsx`, which began as the surfaces design round 3
(D28) found with no rendered frame: the view popover, the page ladder, the
section caps' `Show N more` feet, an expanded entity group, the band's hover
tooltips, and the sidebar's own voice on a route with no status strip. Three
groups were added on 2026-09-27 for the operator's two reports below: the bound
on an expanded group, and the collapsed section's gap.

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

THE GROUP BOUND AND THE SECTION GAP (the operator's two reports below) were shot
by this branch's own passes through the same capturer:

```
pnpm exec storybook dev -p <free port> --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=chat-sidebar-view-menu --dirs=<dir> \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` for the same reason as above — a neighbour session's
`local-operator serve` answered on 1111 for the whole pass — and no surface here
talks to it either: `window.api.desktop.request` is stubbed by the story
(`capabilities`, `sessions.list`, `profiles.list`, `teams.list`, `sessions.search`)
and anything else is refused by name. **Twenty-six frames** — thirteen states in both
palettes: seven in `group-bound/`, three in `section-gap/` and the same three in
`section-gap-before/`. The manifest keeps the capture's own readings in
`captureOrigin`; its counts are re-derived at each folded tip rather than frozen at
the capture.

THE 2026-10-08 ORDER RE-SHOOT re-took every frame in this set, because every
story here draws session rows and the drawn order changed (`pageOrder` now sorts
by the chosen clock). One command per CHUNK of the list:

```
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=chat-sidebar-view-menu --dirs=<~a-dozen-leaves> \
  --themes=localOperatorDark,localOperatorLight --allow-backend --theme-settle-ms=180000
```

CHUNKED RATHER THAN ONE RUN, and that is a measurement rather than taste: this
set is ~42 states, and a single run of that length crosses Chrome's five-minute
hidden-tab timer throttle, after which the readout column samples once a minute
and a frame can carry `Drawn: 0` beside eleven drawn rows. Measured on this pass:
the one-run attempt's `group-bound/running-exempt` frame came back stale, and
the same command chunked came back live (`Drawn: 10`, `Group rows drawn: 11`).
The frames are stamped `e248483bf` (this branch); the before halves are named in
their rows below. The two `audit-order-*` plays gained the repository's
`capturePending` latch in the same pass - their state arrives through four real
presses, and the first re-shoot attempt had the rig refuse the run because the
busy row was still on screen when its `expectGone` was read.

## What each frame is

| story | what it is |
| --- | --- |
| `popover-open` | the panel on a fresh view: four labelled groups, one check per single-choice group, seven section rows with the rail. Re-shot by this pass (the four-group panel) and by round 1 (the `Created` row's action-less `Calendar` glyph, D3). The three-group panel it replaces is this set's previous revision in git. |
| `time-order-mixed` | the ORDER pair's AFTER half (2026-10-08): a fourteen-row mixed catalogue - a Running section whose last-user/created/activity clocks disagree (`mix-run-stopped` waits on the reader, `mix-run-message` was messaged ten minutes ago, `mix-run-heartbeat` only has heartbeats) and a This-week section of idle, stopped, scheduled and remote rows - drawn at the 50-row rung so every row shows. The labels read `2h 12h 1d 4d 5d 6d` down This week and the zero-stamp remote row prints no label at all. |
| `time-order-mixed-before` | the same story and the same fixtures under unmodified `origin/main` (`15a7a4ed522`), captured in a detached worktree with this branch's story file staged in and its `src/` left alone: This week reads `1d 6d 4d 5d` (the array's arrival order) under its own activity labels, the approval row is buried third in Running, and the zero-stamp remote prints `56y`. The pair is the operator's report in one look. |
| `popover-basis-last-active` | the basis fixture below under the DEFAULT basis: `Stored view: section/active/active-first`, `basis [active=true created=false]`. |
| `popover-basis-created` | the same fixture with `Created` pressed: the check moves, the readout says `section/created/active-first`, and the sections, their ORDER and the labels below all re-read. Since 2026-10-08 the basis orders each section by its own clock (`chat-sidebar-view.ts`'s `pageOrder`); the story's play asserts that order, and it replaced the assertion of the opposite "never a re-sort" claim the same day. |
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

**The order follows the basis since 2026-10-08, and this paragraph said the opposite for ten days.** The old text here — "the order is not the basis's to change" — was the operator's own 2026-09-28 "orthogonal" reading; his 2026-10-08 report ("despite having order by active first, the sorting doesn't seem to properly sort within each section ... or maybe the timestamp it shows is not last active") reversed it: the drawn order inside every section and group is now newest-first by the basis's clock (`rowTimeMs`: `updated_at` under Last active, `created_at` under Created), with rows that have no usable stamp last. So under `Created` the OLDER section reads `basis-steady` (born 30 days ago) above `basis-moved` (born 40 days ago), and under Last active the same two rows sit in TODAY by their activity; `PopoverBasisCreated`'s play throws unless each drawn section follows the created clock, and the Last-active frame now draws `basis-born` (30m) above `basis-moved` (1h). Ordering is still `Order by`'s axis in the sense that `Active first` vs `Most recent` decides the LIFT and whether the running band leads; what changed is that the clock below (or through) that decision is the basis's, not the catalogue's arrival order.

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

## The two reports, and what each group of frames is

### `group-bound/` — an expanded team, bounded to the ladder

Operator, 2026-09-27: *"there's far too many team/agent messages shown on screen
at once when expanded, can you have max 10 at first sorted by most recent/active
then click to load more."* His screenshot has `minervadev` expanded with 41
sessions running past the pane. Every frame here is that team: 41 conversations
bound to it, one bound elsewhere, the rest of the sidebar as it ships.

| frame | what it shows |
| --- | --- |
| `group-bound/ten/` | The report answered: **ten rows** drawn under `minervadev`, the badge still `41`, and the foot reading **`Show 15 more chats · 10 of 41`**. Before this change the same state drew all forty-one. |
| `group-bound/after-one/` | After **one real press** on that foot: twenty-five rows, the foot reading `Show 16 more chats · 25 of 41`. The press is a click on the control the first frame draws, not a seeded state. |
| `group-bound/after-two/` | After **two presses**: the third rung is fifty against forty-one held, so the group is fully drawn and **the foot is gone** — the other half of the count agreeing with the disclosure, since a reader seeing no control is seeing all of it. |
| `group-bound/current-lifted/` | The reader is IN `team-0034` — the group's 35th row, which the bound withholds. It is **lifted to the head of the group** under the panel's own `CURRENT CHAT` label rather than admitted in place (admitting it would draw the thirty-four rows between: the complaint this change answers). Eleven rows are drawn and the foot says `11 of 41`, because eleven is what is on screen. The row itself wears the current fill and weight, not just the label — the render seeds the store's `activeDraftKey: null` / `activeSessionId: team-0034`, the state the app reaches by opening the chat (design round 1, D1's re-shoot). |
| `group-bound/current-settled/` | The other end of that movement, driven by two real presses (10 → 25 → 50 against forty-one held): the ladder has drawn past `team-0034`, so the lift and its label are **gone** and the row sits where the catalogue sorts it. The pair is design round 1's D6 as two stills. |
| `group-bound/running-exempt/` | Design D4's case, framed: `team-0034` is **busy**, and a live row costs no quota, so eleven rows are drawn — the busy row LEADS the group (the arrangement's lift, 2026-10-08: under `Active first` a running row goes above the prefix) and the ten-row prefix follows — and the foot counts it: `Show 15 more chats · 11 of 41`. The exemption is the half that still matters when the arrangement has NOT lifted the row (a running row whose key is older than the prefix's tenth row), which is why both rules are kept. |
| `group-bound/foot-hover/` | The foot under a real pointer (`:hover` asserted before the shutter): the idle `ink-dim` steps to `ink`, **12.8:1** dark / **15.23:1** light. The foot's focus still is not here — it is a roving stop (`tabindex=-1`, reached by the region's ArrowDown walk) and this rig's focus primitive is a Tab walk that cannot aim at it; recorded in the design-round remediation rather than faked. |

**Withdrawn: `group-bound/search-finds-unloaded` has NO frame, deliberately.** The
claim it existed for — a query reaches a row the bound has not loaded, which is
the operator's "search should still be able to search and find" — is asserted in
`scripts/chat-sidebar-view.test.mjs` ("a query is never bounded: the bound cannot
hide a hit"), over a 41-row group. Its frame could not be made reproducible: six
captures of that story on one clean tree produced **two distinct end states**,
the pixel diff spanning the whole panel rather than one label, and neither a
settle-wait on the layout nor an assertion on the story's own facts removed it.
A frame that photographs one of two states under a caption claiming one is worse
than no frame. The story stays in Storybook, documented, for a human to look at;
it is not in `STORIES`.

### `section-gap-before/` and `section-gap/` — the collapsed section's gap

Operator, 2026-09-27: *"shrink the gap between agents and teams headers when
agents is collapsed, there's an extra gap wasting space there."*

| pair | what it shows |
| --- | --- |
| `section-gap-before/agents-collapsed-teams-expanded/` vs `section-gap/…` | His exact case: `Agents` collapsed above `Teams` expanded. **16.0px → 8.0px.** |
| `section-gap-before/both-collapsed/` vs `section-gap/…` | Both collapsed — the "collapsed with zero items vs collapsed with items" case. **16.0px → 8.0px**, and identical to the pair above, because the condition is "the section above draws no rows" and not a row count. |
| `section-gap-before/both-expanded/` vs `section-gap/…` | Both expanded, the case a shortened constant would tighten unasked. **16.0px → 16.0px**, unchanged. |

The `-before` arm is this branch with the spacing line reverted, not a frame
taken at `origin/main` — the stories are new, so there is no `origin/main` frame
of them to pair against. The gap change is layout-only and does not touch the
bound, so the two groups are independent.

## The measurements, as the frames' own readout prints them

Panel 360px + 380px readout = 741px wide.

| term | value |
| --- | --- |
| entity row (`minervadev`, `content`) | **32px** |
| chat row inside a group | **36px** |
| `Agents` section heading | 28px |
| gap between the two section headings, `Agents` collapsed | **16.0px before → 8.0px after** |
| gap between the two section headings, `Agents` expanded | **16.0px before → 16.0px after** (shared, hence the conditional value) |
| heading-to-first-entry distance, inside a section | 0.0px |
| `minervadev` section height with 41 rows drawn | **1436px** of a 900px frame, so the group is 20 screens' worth of a 848px region — which is the complaint |
| entity section height in the gap pair | 28px collapsed, 124px when `Teams` is expanded (heading 28 + three 32px rows) |
| scroller content/box, `Agents` collapsed + `Teams` expanded | **588/568 before → 580/568 after** |
| scroller content/box with 41 rows drawn | **2028/848** |
| scroll layers (of which overflowing) | **6 (1)** — one real layer, the entity region; the other five are Storybook's own 0/0 decorators. The count is 6 (0) in `search-finds-unloaded`, where the query narrows the list until it fits. |

**The bound does not introduce a second scroller.** The overflow count is 1 in
every frame, and the one scroller is the entity region #534 established; the
group's own rows are a flow of it. The gap fix moves the content height by
exactly the 8px it removes (588 → 580) and the region still overflows (12px), so
nothing traded a header gap for a phantom scroll region.

## What these frames do NOT prove

- **Latency.** Nothing here carries a timing; the completion-to-bin reading is in
  `../chat-sidebar-status-feed/README.md` (26.3 s before the fix, 1 ms after).
- **Focus and hover states.** A hidden window has no focus, and hover is pointer
  state; the band's own hover frames live in this set from earlier passes, and
  the group foot's hover is `group-bound/foot-hover` (design round 1, D3's hover
  half). The foot's focus still is deliberately not faked: it is a roving stop
  reached by the region's arrow walk, and this rig's focus primitive is a Tab
  walk that cannot aim at it — the record lives in the design-round remediation.
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
  - **THE COMPLETENESS LIMIT OF THE ARRANGEMENT.** The client holds the first
    50/100 rows by CREATION (`sessions.list`'s cursor pages, then `Show more`), so
    the order `time-order-mixed` photographs is exact over HELD rows only: a
    conversation created long ago and active this morning is only in the frame if
    a page already fetched it. The operator's live store measured this (of 133
    truly-active sessions, 14% sit in the first 50 creation-ordered rows and 50%
    in the first 100). Paging by activity is a CORE change, a separate lane; until
    it lands, the sidebar sorts exactly what it has and the ladder is how a reader
    reaches the rest.
- **THAT THE 800x600 SHAPE IS REACHABLE.** It is not: the panel's floor capture
  is the design contract's window minimum (`WINDOW_MIN_WIDTH/HEIGHT`), but at
  800x600 the app's nav rail is collapsed and the View options trigger does not
  exist (round 1's Q-2, reproduced independently). `popover-open-narrow`
  (1100x600) is the frame for the reachable shape; the short one is kept because
  the contract it tests is at that size, and its numbers are the contract's.
- **The search claim has no frame at all**, for the reproducibility reason stated
  in the `group-bound/` section; it is a test claim only.
- **They are not the paged path.** Every story here runs against a stub with no
  `session_catalogue_page` in its capabilities — which is what the shipped daemon
  advertises (`local_operator/server/routes/capabilities.py` has
  `session_catalogue: 3` and no paging key). So these frames are the WITHDRAWN
  path: the group's rows are a filter of the one page the client holds, which is
  what the operator's own app does. The paged path's own behaviour is unchanged
  and its scenes are in `scripts/renderer-driver.mjs`.
- **The bound's and the gap's frames are not a gesture** except where the play
  drives one. `after-one` and `after-two` press the real control; the rest are
  resolved states seeded through the panel's own disclosure record.

## Note on `node scripts/check-evidence.mjs`

On this branch it reports **7 pre-existing failures**, none of them in this
branch's own sets — `supplementary[8]` (`browser-approval-badges`, "claims 49
frames; 0 are on disk") and `supplementary[25]` (`chat-header-identity/before-main`,
no `source`/`why`/`capturedAt`). Both manifest entries are **byte-identical to
the base this branch folds onto**, and neither set is touched by this change, so
they are not this branch's to answer for. Stated rather than left to a reader who
would otherwise assume the new frames broke them.
