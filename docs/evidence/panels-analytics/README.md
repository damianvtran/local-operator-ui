# `/analytics`, swept

The panel in every state it can be in, twelve themes per story, captured by
`scripts/capture-evidence.mjs` (`--only=panels-analytics`) against Storybook.
The stories render the PRODUCTION `AnalyticsPanel` over fixtures, so what these
frames show is what ships; `analytics-panel.stories.tsx`'s own header says what
to look for on each state.

The by-session table added in this change adds two things the earlier set had no
frame for: a strip of controls above the table (a search field, the one filter,
and — only while something is narrowing — the match line), and a pager under the
table's legend, which replaces the `+N more not shown` line that used to end the
section.

## The by-session states, and the two viewports

| directory | story | what the frame shows |
| --- | --- | --- |
| `session-paginated/` | `panels-analytics--session-paginated` | Page one of a 4,550-session window at rest: the strip, the header's chevrons, the first rows. |
| `session-paginated-end/` | the same | The body parked at its end: the rows, the legend, and the pager's `1–20 of 4,550 sessions` with `1 / 228`. |
| `session-page-two/` | `panels-analytics--session-page-two` | `Next` pressed: `21–40 of 4,550 sessions`, `2 / 228`. |
| `session-sorted-by-cost/`, `-end/` | `panels-analytics--session-sorted-by-cost` | The `Cost` header pressed: the descending chevron and the ink step at rest, and the re-ordered page at the body's end. |
| `session-sorted-by-session/` | `panels-analytics--session-sorted-by-session` | The label column ascending — the one `localeCompare` order in the table. |
| `session-search-match/` | `panels-analytics--session-search-match` | `status` typed into the field: the match line with the narrowed count. |
| `session-search-empty/` | `panels-analytics--session-search-empty` | `zzz`: the honest empty state, its detail, and the absence of a table, a legend and a pager. |
| `session-top-level-only/`, `-end/` | `panels-analytics--session-top-level-only` | The filter ticked: `404 of 4,550 sessions · top-level only` and its 21-page pager. |
| `session-scale-30-d/` | `panels-analytics--session-scale-30-d` | The thirty-day scale: 7,065 sessions, `1 / 354`. |
| `session-narrow-720/` | `panels-analytics--session-narrow-720` | The strip wrapping at 720px, where every control is still reachable. |

Two viewports, for a reason that is a property of the host rather than of any
story: the panel body is capped at `min(76vh, 760px)` (`picker-host.tsx`) and the
section sits below the stat grid and the chart, so NO single frame holds both the
strip and the pager. Each state therefore has an at-rest entry and, where the
claim is the pager, an `-end` entry parked at the body's own end through the
rig's `scrollToEnd` — the same mechanism `unnamed-sessions-end/` uses, because a
scroll offset is browser state no story can set and a story that faked one would
be evidence about the fake.

The pair `populated/` and `populated-end/` is the design's own before/after
surface; `dense/` and `dense-end/` carry the dead end the change removes (twelve
of seventeen sessions, ending in `+5 more not shown`). Both halves are in
`panels-analytics-session-table-baseline/`, which is the pre-change tree's own
rendering of the same story, fixture, viewport and scroll position.

## What these frames cannot carry

Three claims are asserted where a pixel cannot reach them, and they are named
here rather than left implied by the pictures:

- **`aria-sort`** on the active header cell, and `none` on the sortable columns
  that are not active — asserted in each `session-*` story's `play`;
- **the live region's text** (`Sorted by Cost, highest first.`, `Page 2 of 228.`)
  — `sr-only`, so it is in no frame, and asserted in the same `play`s;
- **focus**, which must not move on a sort or a page turn — asserted in
  `play`s, and the reason all four pager buttons are always rendered.

The rules behind those assertions — the tie-break, "unknown sorts last in both
directions", the fraction's denominator, the clamp, the wording — are the node
suite's (`scripts/analytics-session-table.test.mjs`). Performance is measured
rather than photographed, and the numbers are in the pull request.
