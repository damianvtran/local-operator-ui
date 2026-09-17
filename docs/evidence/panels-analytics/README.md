# `/analytics`, swept

The panel in every state it can be in, twelve themes per story, captured by
`node scripts/capture-evidence.mjs <url> --only=panels-analytics` against
Storybook built at this branch's head. The stories render the PRODUCTION
`AnalyticsPanel` over fixtures, so what these frames show is what ships;
`analytics-panel.stories.tsx`'s own header says what to look for on each state.

The by-session table added in this change adds two things the earlier set had no
frame for: a strip of controls above the table (a search field, the one filter,
and — only while something is narrowing — the match line on a row of its own
beneath them), and a pager under the table's legend, which replaces the
`+N more not shown` line that used to end the section.

## The by-session states, and the two scroll positions

| directory | story | what the frame shows |
| --- | --- | --- |
| `session-paginated/` | `panels-analytics--session-paginated` | Page one of a 4,550-session window, the body parked on the section's top: the section heading, the strip, the header row's five chevrons, and the first rows. The pager is below the fold — it is in `session-paginated-end/`. |
| `session-paginated-end/` | the same | The body parked at its end: the rows, the legend, and the pager's `1–20 of 4,550 sessions` with `1 / 228` and all four controls live. |
| `session-page-two/` | `panels-analytics--session-page-two` | `Next` pressed, at the body's end: `21–40 of 4,550 sessions`, `2 / 228`, and no focus ring on the pressed control (the play drops focus once its assertion has run). |
| `session-last-page/` | `panels-analytics--session-last-page` | The END of the set, at the body's end: `4,541–4,550 of 4,550 sessions`, `228 / 228`, ten rows, and `Next`/`Last` stepped down while `First`/`Prev` stay live. The state the inert treatment exists for. |
| `session-sorted-by-cost/` | `panels-analytics--session-sorted-by-cost` | The `Cost` header pressed, at rest with focus dropped, parked on the section: the descending single chevron and the ink step on `Cost` against the neutral double chevrons on the other four. No ring — see the play. |
| `session-sorted-by-cost-end/` | the same | The re-ordered page at the body's end: the cost column descending top to bottom. |
| `session-sorted-by-session/` | `panels-analytics--session-sorted-by-session` | The label column ascending, at rest with focus dropped, parked on the section: the one `localeCompare` order in the table, with its chevron and ink step at the section's top. |
| `session-search-match/` | `panels-analytics--session-search-match` | `status` typed into the field, parked on the section: the match line `819 of 4,550 sessions match "status"` on its own row, and the narrowed page under it. |
| `session-search-empty/` | `panels-analytics--session-search-empty` | `zzz`: the honest empty state, its detail, the absence of a table, a legend and a pager, and the absence of a match line. The strip is kept, so the narrowing can be undone from where it was typed. |
| `session-top-level-only/` | `panels-analytics--session-top-level-only` | The filter ticked, parked on the section: `404 of 4,550 sessions · top-level only`. |
| `session-top-level-only-end/` | the same | Its pager at the body's end: `1–20 of 404 sessions`, `1 / 21`. |
| `session-scale-30-d/` | `panels-analytics--session-scale-30-d` | The thirty-day scale, at the body's end: 7,065 sessions, `1 / 354`. |
| `session-narrow-720/` | `panels-analytics--session-narrow-720` | The section parked at the body's top at 720px: the strip on one row — the field and the filter — and the first rows below it. Nothing wraps and nothing is clipped. The pager is below the fold; the design's D3 probe measured every control's reachability at this width rather than photographing it. |

Two scroll positions, for a reason that is a property of the host rather than of
any story: the panel body is capped at `min(76vh, 760px)`
(`picker-host.tsx`), the section sits below the stat grid and the chart, and the
section itself is taller than that cap — so NO single frame holds the strip, the
twenty rows, the legend and the pager at once. Each state therefore has an
at-rest entry, parked on the SECTION's top through the rig's `scrollTo`, and —
where the claim is the pager — an `-end` entry parked at the body's own end
through `scrollToEnd`, the mechanism `unnamed-sessions-end/` uses. Both are the
rig's, because a scroll offset is browser state no story can set and a story that
faked one would be evidence about the fake. Round 1 caught two directories
captioned with a subject their pixels did not contain, because the at-rest frames
were leaning on a `play` clicking a control and the browser scrolling the focused
element into view: a side effect, not a guarantee (review round 1, M2/D2/D3).

The pair `populated/` and `populated-end/` is the design's own before/after
surface. The dead end the change removes — twelve of seventeen sessions, ending
in `+5 more not shown` — is `dense/` and `dense-end/`, and both halves are in
`panels-analytics-session-table-baseline/`, which is the pre-change tree's own
rendering of the same story, fixture, viewport and scroll position. It is NOT
`populated/`, whose fixture is five sessions and whose before frame reads
`1–5 of 5 sessions`.

**Where focus is, in a frame, is a decision and not an accident.** The two
SORTED frames drop focus after their focus assertion, because their claim is the
resting sorted appearance — the ink step and the single chevron — and a captured
`:focus-visible` ring on the active header read as an accent pill around the
column name rather than as the header row (review round 1, D2). `session-last-page/`
drops it too, so the accent is on the LIVE controls rather than on one of the two
that are supposed to be receding. The frames whose claim IS an interaction —
`session-search-match/` with a query typed, `session-top-level-only/` with the
filter ticked, `session-search-empty/` with the field left as typed — keep the
ring on the control the reader just used, which is the state after that
action rather than a claim about how the section rests.

## What these frames cannot carry

Three claims are asserted where a pixel cannot reach them, and they are named
here rather than left implied by the pictures:

- **`aria-sort`** on the active header cell, and `none` on the sortable columns
  that are not active — asserted in each `session-*` story's `play`. The
  EFFECTIVE order is reported: on first paint the metric's own column reads
  `descending`, because the rows really are in that order;
- **the live region's text** (`Sorted by Cost, highest first.`, `Page 2 of 228.`)
  — `sr-only`, so it is in no frame, and asserted in the same `play`s;
- **focus**, which must not move on a sort or a page turn — asserted in `play`s,
  including at the END of the set, where the pressed control is the one the turn
  makes unavailable and the native attribute would have dropped the caret to
  `<body>`.

The rules behind those assertions — the tie-break, "unknown sorts last in both
directions", the fraction's denominator, the clamp, the wording, the
window-change reset — are the node suite's
(`scripts/analytics-session-table.test.mjs`). Performance is measured rather
than photographed, and the numbers are in the pull request.

## The rig refuses a story whose `play` threw

Every `play` in the by-session stories is an assertion about a state these frames
are not allowed to misrepresent, so the capture now FAILS on one that threw
rather than photographing over it. A failed phase does not show Storybook's error
display (that display is for a story that failed to RENDER), so the rig reads the
console for the three shapes a play failure takes — `AssertionError`,
`TestingLibraryElementError`, and user-event's "Unable to perform pointer
interaction". This is the path round 1 found open: seven of the nine plays were
red at that head while the frames photographed cleanly, because `sb-errordisplay`
was on the rig's list of Storybook furniture to exclude.
