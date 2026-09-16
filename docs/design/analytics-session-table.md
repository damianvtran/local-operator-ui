# The by-session table: paging, sorting, filtering, search

Status: **design contract, implementation not included.** Every `MUST` below is a
decision, not a menu. Anything marked `MAY` is genuinely optional and named as
such.

Written at UI head `647396910` (`feat/analytics-session-table-paging`, off
`origin/main`) and backend head `e368e69a5` (`origin/main`, released as
`local-operator` 0.56.1 — the runtime this machine actually runs). Line
citations are against those two trees; backend citations are to the `origin/main`
blob rather than the stale checkout, because the checkout on this machine is on
another branch and its `desktop_catalogues.py` predates the change that put
`session_names` on the wire.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (environment,
evidence, release mechanics), `docs/design/panel-views.md` (the panel
architecture this table lives inside), `docs/agent-driver.md` (how a frame is
taken).

---

## 0. The problem as I found it

`/analytics` renders `By session` as a table of the top 12 sessions by the
selected metric, ending in a line that says `+4,538 more not shown`
(`analytics-panel.tsx:226`, `MoreRowsLine`). The operator's request is that
every session be reachable, and that the table be sortable, filterable and
searchable:

> Can you update the by session view in /analytics to be able to show all
> sessions through table pagination (make sure it's efficient and performant)
> and also add sort by column, filter, search, etc.

That request arrived with a mock-up of the surface: the five columns
(Session / Calls / Tokens / Cost / Cache hit rate), the footer line
(`+4527 more not shown`), the cache legend beneath it, and a bottom bar reading
`Esc closes`. **The mock IS this surface, and the footer line is the thing being
replaced.** The `+N more not shown` string exists in exactly one place in the
repository (`primitives/data-table.tsx:112`); the section title and meta match
`analytics-panel.tsx:401-406`.

Two things follow. First, this is not a new screen: it is a change to one
table's ordering, narrowing and reach inside a panel that already exists and is
already evidenced. Second, the `+N` line was never a pagination affordance — it
was a *disclosure that the table is a summary*. Removing it is only correct if
the rows behind it become reachable, which is why paging is the load-bearing
part of this design and sort/filter/search are ways of not having to page
through 4,550 rows.

---

## 1. Ground truth that shapes the design

Each of these was read or measured, not recalled.

1. **The table is a real `<table>` over `ui/table`, and its primitive makes an
   explicit decision not to sort, page, filter or virtualise.**
   `primitives/data-table.tsx:12-29` states the reasoning: each of those "would
   be a second place the row order is decided, and the panels already decide it
   … as pure functions their models own". `DataTable` renders the rows it is
   given (`:51-92`); `MUST NOT own its own scrolling box` (`:27-28`), and
   neither does `ui/table` (`shared/components/ui/table.tsx:9-34`). The panel
   host's body is the only scroller on this screen.
2. **The ordering today is the model's.** `sessionRows()`
   (`analytics-model.ts:354-392`) sorts **all** sessions by the selected metric,
   slices the top `cap = 12` (`:373`), and returns `{ rows, hidden }` (`:391`).
   The tie-break is `id.localeCompare` ascending (`:372`), so equal-valued rows
   have a stable order.
3. **The panel re-runs that rank on every render.** `SessionTable`
   (`analytics-panel.tsx:157-229`) calls `sessionRows(...)` in its component body
   (`:161-166`) with no memo, and `AnalyticsPanel` re-renders on any of its props
   changing — including `refreshing`. So today every metric toggle, and every
   re-render of the panel, re-sorts the entire per-session set to draw twelve
   rows.
4. **Sorting by a column does not exist, and neither does the vocabulary for
   it.** There is no `aria-sort` anywhere in `src/renderer` (grep: zero hits),
   and `Column<T>` (`data-table.tsx:31-41`) carries `key`, `header`, `cell`,
   `numeric`, `priority`, `className` — no sort concept at all.
5. **`PanelSection` has an `action` slot with a documented owner.**
   `panel-frame.tsx:31`: "A control that affects THIS section only. Panel-wide
   controls go in the host toolbar." `PanelHeader` renders title-left,
   meta+action-right on one baseline row (`:43-59`).
6. **The panel is a registry-mounted dialog with no route.** `AnalyticsView`
   (`analytics-panel.tsx:415-449`) is mounted from `destination-pickers.tsx`;
   the host is `PickerHost` (`shell="panel"`), whose footer says `Esc closes`
   (`picker-host.tsx:339`) and whose body scroll region is the panel's own focus
   target (`:815-822`). There is no URL this state could live in.
7. **All the data is already client-side, and the wire carries names and
   edges.** The renderer's read is `analytics.get` → `GET /v1/desktop/analytics`
   (`panel-queries.ts:82-114`, `desktop-contract.ts:1935-1943`). The route
   (`local_operator/server/routes/desktop_catalogues.py:189-236`) returns
   `aggregate` (with `by_session`), `daily`, `daily_scope`, `session_names`
   **filtered to named sessions** (`:229-233`) and `session_parents` (`:234`).
   Both side maps exist because `dataclasses.asdict` drops the store's `setattr`
   attributes (`store.py:1389`, `:1412`), and `by_session` has **no session
   cap**.
8. **The per-session row has no timestamp and no provider breakdown.**
   `DesktopUsageAggregate` (`desktop-contract.ts:2229-2243`) is counts only —
   `calls`, tokens, `cost_micro`, `cost_known_calls`, `components`,
   `by_provider`, `by_session` — and the store builds each `by_session` entry
   from a one-level row (`store.py:1345-1395`), so its `by_provider` is `{}`.
   **There is no per-row time and no per-row provider on the wire.** Any filter
   that needs them is impossible without a backend change.
9. **The depth walk is clamped and cycle-guarded.** `sessionDepth()`
   (`analytics-model.ts:394-411`) walks `session_parents` upward, stops at 2, and
   keeps a `seen` set. With no parents map it returns 0 for every row, so an
   older backend renders flat ids and says nothing (`:345-353`), pinned by the
   `UnnamedSessions` story (`analytics-panel.stories.tsx:469-482`).
10. **`ProportionBar` is the leading cell and takes a `srLabel`**
    (`analytics-panel.tsx:216-223`, `primitives/proportion-bar.tsx:31-41`); the
    fraction is each row's share of the window's metric total, computed in
    `sessionRows` (`analytics-model.ts:362-365`, `:387`). The legend
    (`CacheHitLegend`, `analytics-panel.tsx:82-86`) sits immediately under the
    table, and the table's accessible name carries `CACHE_HIT_MEANING` too.
11. **The table header has its own ground.** `TableHead` paints `bg-sunken`
    (`ui/table.tsx:99`). `scripts/contrast-contract.mjs` asserts ink roles over
    the four grounds (`GROUNDS`, `:112`) and component triples from a
    hand-written `CONTROLS` list (`:127+`); "adding a component with its own fill
    and border means adding a row to `CONTROLS`" (`AGENTS.md:63-65`).
12. **Interaction states are photographable.** The evidence rig drives Storybook
    over CDP, supports `play` functions and a real pointer
    (`scripts/capture-evidence.mjs` — the `panels-analytics--populated-hover`
    entries at `:1479-1499` carry `{ hover: … }`), and the analytics stories are
    already in `STORIES` (`:1467-1532`). A state reached by pressing a shipped
    control is evidence; a state a story fakes is evidence about the fake
    (`analytics-panel.stories.tsx:274-281`).
13. **The desktop suite's file list is hand-written.** `test:desktop` in
    `package.json` names every test file, so a new test that is not added to that
    list does not run — the same trap `AGENTS.md:85-94` documents for `pnpm
    lint`'s path list.
14. **A commit that moves `src/` or `scripts/` costs every open branch two
    commits** (`AGENTS.md:118-129`): `docs/evidence/manifest.json` pins
    `srcTree`/`scriptsTree` to the staged tree hashes, and `pnpm check-evidence`
    fails a mismatch with "re-capture and re-stamp". This change touches both
    trees.
15. **A peer session is landing a change to `AnalyticsView` only**: the panel
    drops the `This session / All sessions` toggle when no conversation is open.
    This design reads the *value* `thisSessionOnly` and never the control's
    presence; the section must behave identically either way.

---

## 2. What is measured, and what it decides

The operator asked for efficiency and performance, so the whole decision in §3
turns on numbers rather than taste. All figures below were produced on this
machine (14 cores, macOS 25.6) against the operator's own ledger
(`~/.local-operator/analytics.db`, 334 MB, 1,133,937 calls, **7,065 sessions** —
all of them inside the last 30 days), read through a copy — the live database was
never written to.

### 2.1 The payload the panel already holds

Exported with the store's own `aggregate()` over a real window and serialised as
the route serialises it:

| Window | sessions in `by_session` | `aggregate` JSON | of which `by_session` | `session_names` | `session_parents` | whole `data` object |
|---|---|---|---|---|---|---|
| 30 days | 7,065 | 3,333,357 B | 3,327,714 B | 478,997 B | 178,471 B | **3,997,534 B** |
| 7 days | 4,550 | 2,152,141 B | 2,147,506 B | 316,280 B | 124,381 B | **2,594,754 B** |
| Today | 310 | 148,231 B | 146,667 B | 20,907 B | 8,101 B | 173 B + daily |

`JSON.parse` of the 30-day payload: **11.2 ms** (node 26.5.0). This is the
existing cost of opening the panel at 30 days and it is unchanged by this
design.

### 2.2 The model's work (node 26.5.0, medians of 5-7 runs)

| Operation | 30 days (7,065 rows) | 7 days (4,550 rows) |
|---|---|---|
| rank by a numeric metric (`Object.entries` → map → sort) | 2.8 ms | 1.5 ms |
| depth walk over **every** row | 0.7 ms | — |
| full row build (label, depth, cost string, fraction) over every row | 0.8 ms | — |
| search keystroke (filter by label+id, then rank) | 2.0 ms | — |
| sort by the label (`localeCompare`) | 12.5 ms | — |
| sort by a numeric column | 2.1 ms | — |

Two facts decide things later: the data work is **milliseconds**, and the only
expensive comparator in the tree is `localeCompare` on the label (12.5 ms), which
is the one column where a case-insensitive, collation-correct order is the
requirement.

### 2.3 The render's work (the number that matters)

Measured in the **pinned runtime** (`electron` 44.3.0 from this worktree's
`node_modules`), rendering the **shipped** `DataTable` + `ProportionBar` with the
by-session column set, in a window that is never shown, at 1140 px wide, React
production build, medians of three runs after warm-up. Row pitch 32.2 px.

| rows rendered | cells | commit | layout | settled (paint) | table height |
|---|---|---|---|---|---|
| 12 (today's cap) | 72 | 1.0 ms | 1.7 ms | 15.7 ms | 419 px |
| **20** | **120** | **0.9 ms** | **1.8 ms** | **16.3 ms** | **679 px** |
| 25 | 150 | 0.8 ms | 2.0 ms | 16.3 ms | 842 px |
| 50 | 300 | 1.4 ms | 3.3 ms | 16.2 ms | 1,654 px |
| 100 | 600 | 2.6 ms | 6.6 ms | 16.2 ms | 3,279 px |
| 300 | 1,800 | 7.2 ms | 18.0 ms | 23.6 ms | 9,779 px |
| 1,000 | 6,000 | 21.8 ms | 58.6 ms | 70.2 ms | 32,529 px |
| **4,550** (a real 7-day window) | **27,300** | **99.6 ms** | **291.6 ms** | **335.5 ms** | **147,904 px** |

Reading of the last row: presenting every session costs **335 ms and 27,300
cells**, and *every* state change that re-renders the set pays it again.
"settled" is time to the second `requestAnimationFrame` after a forced layout,
so for ≤ 100 rows the answer is "inside one frame" and the interesting quantity
is the layout column.

Method, and what it is not: the probe bundled `data-table.tsx` and
`proportion-bar.tsx` out of this worktree with the tree's own `esbuild`, rendered
them with `react-dom/client` and `flushSync`, and forced layout by reading the
table's rect. The Tailwind stylesheet is not compiled in it; the computed
geometry those utilities produce (13 px/1.5 body, `px-2 py-1.5` cells, `w-24`
bars, `h-1.5` track, `bg-sunken` header) is replicated as literal CSS. So the
figures are the engine's cost of the row DOM and its layout/paint, not React's
class-name bookkeeping, and the paint figures come from a hidden window
(software rasterization) — they are a ceiling, not a typical frame. The probe
script lives outside the repository and is not proposed for commit; §11 says how
QA reproduces the same measurement in the built app.

### 2.4 What the filters would actually do (7-day window, 4,550 rows)

| filter, as an operator would state it | rows it removes from 4,550 | metric share it removes |
|---|---|---|
| `Top-level only` (hide sessions with a parent edge) | 4,146 | **82.8 %** of tokens |
| `Named only` (hide unnamed sessions) | 11 | ~0 % |
| `Priced only` (hide sessions with no priced call) | 23 | 0.05 % |
| cache rate measurable (hide `—` rows) | 8 | ~0 % |
| at least 10 calls | 155 | 0.03 % |
| at least 1M tokens | 294 | 0.10 % |

Root sessions are 404 of 4,550 rows and **17.2 % of the window's tokens**; depth 1
is 4,100 rows / 82.6 %; depth 2 is 46 rows / 0.2 %.

---

## 3. The options, and the one recommended

### 3.1 Client-side paging over the payload in memory — **recommended**

The model's whole contribution is 2.8 ms at 7,065 rows and the DOM is what needs
bounding. Paging over the array the panel already owns costs no new endpoint, no
capability negotiation, no version floor, and keeps one authority for row order
(the panel's own model), which is exactly what `data-table.tsx:15-21` asks for.

Page size **20 rows** (`SESSION_PAGE_SIZE`). At the measured 32.2 px pitch that is
679 px of table — the viewport the section gets when it is scrolled into view in
the shipped 1380×900 window — while 12 (today's cap) reads as the summary the
operator is complaining about and 50 is 1,654 px, i.e. scrolling *inside* a page.
The render cost is flat across 12-50 rows (≤ 1.4 ms commit, ≤ 3.3 ms layout), so
this is a reading decision, not a cost one; the constant is one place if design
review wants it moved. At 4,550 rows that is 228 pages, at 7,065 it is 354.

### 3.2 Server-paged endpoint — rejected for now, with the number that would change my mind

`by_session` is 3.3 MB of a 4.0 MB 30-day response and only this table reads it,
so a paged endpoint would shrink the payload by roughly 83 %. Against that:

- it needs a release of the **other** repository, a new capability key, and a
  version floor — the desktop app talks to whatever backend it finds, and
  `/analytics` must keep working against one that lacks the route;
- it makes ordering, filtering and search semantics exist twice (server SQL and
  client model), which is the "second place the row order is decided" the
  primitive's own docstring refuses;
- it turns each keystroke into a round trip and puts a spinner inside a table
  whose present cost is 2.0 ms;
- the panel cannot drop the aggregate anyway: the stat cards and the chart read
  it, so the endpoint saves the `by_session` key, not the request.

The measured 3.3 MB is a real cost, and the honest follow-up is not "page it on
the server" but "stop shipping `by_session` when nothing needs it" — noted in
§12 as a follow-up, deliberately **not** in this change. The threshold that would
change this decision is the one the numbers do not yet reach: today's 2.8 ms of
ranking and 11 ms of parsing are 1 % of the 335 ms the table itself costs.

### 3.3 Render every row and let the host body scroll — rejected (measured)

This is the "no change to the primitive at all" option, and it is the option that
makes every interaction pay the 4,550-row figure: **335 ms and 27,300 cells**,
against 16 ms for a page. It also heightens the table to 147,904 px inside the
host's scroll box, and it makes the `+N more` line unnecessary rather than
replaced — nothing can be "not shown" if everything is. Rejected on §2.3.

### 3.4 Virtualisation — rejected

It is the other way to bound the DOM, and it is the wrong one here. `DataTable`
must not own a scroll box (`data-table.tsx:27-28`) and neither must `Table`
(`ui/table.tsx:9-22`), so a virtualiser would have to measure and drive the
*host's* scroll region from inside a section — coupling the table to the picker
host's geometry. It also changes what the scroll gesture means for the whole
panel, and the operator asked for pagination by name.

### 3.5 CSS-only paging (render all, hide with `content-visibility`/`display`) — rejected

The DOM is still built (99.6 ms commit measured) and hidden rows are still in the
accessibility tree: a screen reader would page through 4,550 rows. Worse on both
counts than paging.

### 3.6 A headless table library (`@tanstack/react-table`) — rejected

A dependency to sort five columns and slice an array, and it moves ordering into
a component tree rather than into the pure model that has a `node --test` suite.

### 3.7 Where the primitive boundary goes — **extend `DataTable`, add a sibling `TablePager`**

The docstring's rule is about *deciding* order, not about *displaying* an order
that was decided. So:

- `Column<T>` gains `sortable?: boolean` and `DataTable` gains an optional
  `sort?: { key: string | null; direction: "asc" | "desc"; onSort: (key: string) => void }`.
  The primitive renders a header **button** and `aria-sort` from a value it is
  told, and reports the intent back. It learns no comparator, no tie-break, no
  default direction — the model keeps all three.
- The pager is a **sibling** primitive, `primitives/table-pager.tsx`, not part of
  `DataTable`: the pager is not a table, it is a control row under one, and
  bundling it would make `DataTable`'s contract "a table and its footer".
- The docstring at `data-table.tsx:12-29` **MUST** be rewritten in the same
  commit: it currently claims the design cap is "12 rows plus a `+N more` line",
  which will be false. Leaving a false invariant in the file whose reasoning this
  change extends is the defect this document exists to avoid.

Rejected alternatives at this boundary: a second table component that re-renders
the header (a second spelling of the same row — the lesson `panel-frame.tsx:36-42`
writes down for `PanelHeader`); state inside `DataTable` (that *is* the docstring's
forbidden second place, and it would make the arithmetic untestable outside a
browser).

---

## 4. The state model

### 4.1 The state

```ts
type SessionSortKey = "session" | "calls" | "tokens" | "cost" | "cache";
type SortDirection = "asc" | "desc";

type SessionTableState = {
  /** The search field's value, verbatim (the model trims and case-folds). */
  query: string;
  /** `null` = follow the panel's metric: tokens for "tokens", cost for "spend". */
  sort: { key: SessionSortKey; direction: SortDirection } | null;
  /** The one filter (§6.2). */
  filters: { topLevelOnly: boolean };
  /** 0-based, always within `[0, pageCount - 1]` after the clamp (§4.3). */
  page: number;
};

const SESSION_PAGE_SIZE = 20;
```

Defaults: `query: ""`, `sort: null`, `filters: { topLevelOnly: false }`,
`page: 0`.

`sort: null` is not cleverness for its own sake — it is the state that makes
"the table is ranked by the metric the panel selected" expressible, which is the
panel's existing contract (`analytics-panel.tsx:38-51`: one metric control feeds
the chart and both tables). A metric change with `sort: null` re-ranks; a metric
change with an explicit column does not move the user's chosen order.

### 4.2 Where the state lives, and why

**In `AnalyticsPanel`, as a `useReducer` (`useSessionTableState`), passed down to
the section as `state` + `dispatch`.** The rule that chooses the owner is what
the state is *for*:

- **State that is part of the query key belongs to the adapter.** `windowDays`,
  `metric` and `thisSessionOnly` live in `AnalyticsView` (`analytics-panel.tsx:416-418`)
  because they are the query key (`panel-queries.ts:96-103`). Table state changes
  nothing that is fetched.
- **State that only re-orders what is already in memory belongs to the panel**,
  beside the answer it narrows — and it needs `windowDays`, `metric` and
  `thisSessionOnly` in scope, which are `AnalyticsPanel`'s own props
  (`:231-244`). Putting it in `SessionTable` would force the reset rule (§4.3) to
  watch props threaded through two components; putting it in the adapter would
  put presentational state where the query is decided.
- **The URL/query layer is wrong, and is not merely unavailable.** The panel is a
  registry-mounted dialog (`PickerHost`, no router — `docs/design/panel-views.md`
  § 1.3, "no router routes"), opened by a slash command; there is no address this
  state could live at, and inventing one would create a second navigation
  authority for a surface whose whole mental model is "open a panel, Esc closes".
- **The state is per open.** `AnalyticsView` unmounts when the panel closes, so
  the search, the sort and the page reset on reopen — consistent with the rest of
  the panel, which is a snapshot (`panel-queries.ts:26-30`). Persisting the query
  across opens is `MAY`, and is deliberately not proposed: nothing else on this
  panel persists.

### 4.3 What happens to it when the answer changes

| trigger | page | sort | filters | query |
|---|---|---|---|---|
| `metric` changes | reset to 0 | kept; `null` follows the new metric | kept | kept |
| `windowDays` changes | reset to 0 | kept | kept | kept |
| `thisSessionOnly` changes | reset to 0 | kept | kept | kept |
| the data refetches, `refreshing` flips, `keepPreviousData` hands back a new object | **unchanged** | unchanged | unchanged | unchanged |
| sort column / direction, query keystroke, filter toggle | reset to 0 | — | — | — |
| the panel closes and reopens | all reset (unmount) | | | |

Two implementation constraints follow, and both are falsifiable:

1. **The resets are folded into the reducer, not into an effect.** A
   `useEffect` that watches the window and calls `setPage(0)` runs *after* the
   commit, so the new ranking would paint at the old page for one frame — a flash
   of "page 3 of a set that no longer has a page 3", plus a wasted rank.
2. **The clamp is a derivation, not a reset.** Whatever the state says, the
   rendered page is `min(page, pageCount - 1)`; when the clamp bites, the
   announcement says so (§7). `refreshing` and the data's identity are
   deliberately not triggers: a refetch over the same window must not throw the
   reader off the page they are on.

---

## 5. The order of operations, and what the bar shows

**Filter → search → sort → slice → enrich.** One pass each, in that order:

1. **Index** (once per `by_session`/names/parents change): every session becomes
   `{ id, label, unnamed, hasParent, calls, tokens, costMicro, costKnown, cacheRatio, value }`,
   where `value` is the selected metric's number. The window's metric **total**
   is computed here, over all rows.
2. **Filter** (the §6.2 predicate) — a boolean per row, no formatting.
3. **Search** — case-folded substring over `label` and `id`.
4. **Sort** — the selected key and direction, with the tie-break of §6.1.
5. **Slice** — the page.
6. **Enrich** — depth, the formatted cost string, the fraction, the label — for
   **at most 20 rows**.

Step 6 last is why the depth walk is not a new hot spot: the walk measured 0.7 ms
across all 7,065 rows anyway (§2.2), but keeping it after the slice makes the
per-interaction cost *constant in the size of the ledger* rather than merely
small. Sorting is deliberately after filtering and searching so the comparator
runs over the narrowed set, and so a page boundary can never be placed inside a
`localeCompare`-tied group of removed rows.

### 5.1 What the `fraction` bar shows once the set is narrowed

**Each row's share of the FULL window total — the same denominator the panel's
window describes — unchanged by search or filter.** This is the invariant that
cannot mislead, and it fails the alternative on its own terms:

- The bar's `srLabel` reads "…of tokens in this window" (`analytics-panel.tsx:220`),
  and the section's meta and the stat cards above it describe that window. A bar
  divided by the *filtered* set would contradict the sentence read out with it.
- A filtered denominator is not comparable across a keystroke: the same two rows
  would change lengths as characters are typed, which reads as the data changing.
- The one-row state would draw at 100 %, which claims that row *is* the window.
- The design contract's own rule is that "a bar's length and the table's order
  agree" (`analytics-model.ts:301-304`) — and the order is by the metric's value,
  not by a share of an ad-hoc subset.

So a narrowed view's bars are *smaller than they look*: 38 matching rows whose
bars are all short is the truth, and the pager's own "1–20 of 38" line is where
the narrowing is stated. Empty and one-row states: no bars at all in the empty
state (no table is rendered, §6.4); in the one-row state the bar shows that
row's true share, not a full bar.

---

## 6. The controls

### 6.1 Sort

Every one of the five columns is sortable: Session, Calls, Tokens, Cost, Cache
hit rate. The affordance is a `<button>` **inside** the `<th>` (a `<th>` with an
`onClick` is not keyboard reachable), `scope="col"` kept, and `aria-sort` on the
header cell itself — the attribute a screen reader reads for this purpose, and
the one thing missing from the tree today (§1.4).

- **Default direction is the model's policy** (`firstDirection(key)`), not the
  primitive's: numeric columns sort **descending** on first activation (the
  question behind Calls/Tokens/Cost/Cache is "which is biggest"), the Session
  column sorts **ascending**. Activating the active column flips direction.
- **Ties are broken by `id` ascending, always** — including under a descending
  primary sort. This keeps page boundaries stable: 4,550 rows contain many ties
  (the measured ledger has 8 rows at exactly zero tokens and a long tail of
  equal-cost rows), and an unstable order would move rows across pages between
  two identical clicks.
- **Cost sorts on `cost_micro`, never on the formatted string.** The cell is a
  string produced by `formatMicroUsd` (`analytics-model.ts:339`), and sorting
  `"$1,000.00"` before `"$9.00"` is the classic way this breaks; the index keeps
  the number.
- **Unknown values sort last in both directions** — unpriced cost
  (`cost_known_calls === 0`) and unmeasurable cache rate (`null`). A row whose
  cost is unknown is not a row that cost nothing, and a `—` cluster at the top of
  a descending sort would read as a claim. One rule, two columns, stated once in
  the model. This mirrors the terminal's own treatment of unpriced
  (`analytics_panel.py` sorts an unpriced group by tokens rather than letting it
  win on cost, `_group_section`).

### 6.2 Filter: **one** control, and the numbers that rejected the rest

The set is one named filter, **`Top-level only`** — hide the sessions that have a
parent edge, leaving the roots. The operator question it answers is on screen
already: the section's own meta says "Own figures per session · totals include
subagents" (`analytics-panel.tsx:403`), and 4,146 of the 4,550 rows in a 7-day
window are subagent sessions — **82.8 % of the window's tokens**. Pressing it
turns "where did my spend go" into "how much of this was *me*": 404 rows, 17.2 %
of tokens.

**The admission rule, so this set is defensible rather than arbitrary:** a filter
earns a control only if it removes at least 10 % of the rows *or* 10 % of the
window's metric. Measured against the operator's ledger (§2.4), the only
dimension on the wire that clears that bar is the tree axis. Rejected, with the
measurement or the wire fact:

| rejected | why |
|---|---|
| `Named only` | removes **11** of 4,550 rows: the ledger names 6,917 of its 7,065 sessions, so the filter is a control that does nothing. |
| `Unpriced only` / `Priced only` | **23** rows, 0.05 % of tokens. The Cost column's `—` already marks them, and the legend already explains the measure. |
| `Cache measured only` | **8** rows. Same argument, and `—` is already distinguishable from `0 %` in the column. |
| `At least N calls` / `At least N tokens` | a numeric input is a filter DSL wearing a small hat; the sort plus paging already answers "which are big", and the measured tail is noise: dropping rows under 10 calls removes 155 rows carrying 0.03 % of tokens. |
| `Provider` | not on the wire per session: each `by_session` entry is a one-level aggregate whose `by_provider` is `{}` (`store.py:1345-1395`). The By provider table is the surface for that dimension. |
| `Model` | not on the wire per session at all. |
| `Active today` / `Recent` | not on the wire: `DesktopUsageAggregate` carries no timestamp (`desktop-contract.ts:2229-2243`), and `by_session` is a sum over the window's calls. |
| `Depth 2 only` | 46 rows / 0.2 %. Depth is a presentation clamp (`analytics-model.ts:335`), and filtering on it would claim a structure the payload does not state. |

The control itself is the existing `PickerCheck` (`picker-host.tsx:1234+`), the
same component the panel's toolbar already uses for `This session only`, so it
arrives with its own ground, disabled treatment and hit target already settled.
It sits in the strip (§6.3) with the label `Top-level only`, `tone="muted"`.

### 6.3 Search, and where the controls live

**The strip: search field, filter, and (only while narrowed) the match line, in
one `flex flex-wrap items-center gap-3` row inside the section body, above the
table.** Placement was a real choice, and the other two candidates lose:

- **The host toolbar** is documented as the owner of panel-wide controls
  (`panel-frame.tsx:31`), and this control narrows one section — the By provider
  table must not move when the search changes. It also already carries Window,
  Metric, Scope and the `Refreshing` note (`analytics-panel.tsx:258-290`), and its
  `ml-auto` note assumes it is the last thing in the row.
- **The `PanelSection` `action` slot** has the right *scope* but the wrong
  *geometry*: `PanelHeader` is one `items-baseline` row with the title left and
  `meta` + `action` right (`panel-frame.tsx:52-58`), the section's meta is
  already a full clause, and a text input on a heading's baseline is a form
  control in a heading row — nothing else in this app does that. At the 720 px
  `Narrow` capture the header has no room to wrap without moving the title.
- **A strip inside the body** wraps under pressure without disturbing the
  heading, and the pattern is already in the tree: the chat sidebar renders its
  search field in a row of its own immediately above the list it filters, with
  the count line under it (`chat-sidebar.tsx:842-870`, `:718-756`).

Search semantics: **case-folded substring over the session label and the session
id**, over the whole set (not the page). The model trims the query; a query that
is empty or whitespace-only narrows nothing and says nothing. Two honest limits,
stated rather than implied: matching is a substring (`"views"` finds
`Panel views`, `"panel vie"` does too, `"views panel"` does not), and there is no
accent or collation folding — `toLocaleLowerCase()` only. The id is matched
because it is the only handle a session has when the ledger has no name for it,
and the `UnnamedSessions` story's rows must remain findable by id.

Rejected affordances: `role="combobox"` (the pickers' listbox idiom,
`picker-host.tsx:884-903`) is wrong here — there is no popup list, and it would
promise `aria-activedescendant` semantics; a `<form role="search">` implies a
submit that does not exist; a "search in labels only" toggle is a second control
whose effect an operator cannot predict.

The match line is rendered **only when a query or filter is active**, in
`text-meta text-ink-dim`, e.g. `38 of 4,550 sessions match "status"` or
`404 of 4,550 sessions · top-level only`. It is a *visible* line and not only a
live region, for the reason `CacheHitLegend` gives for itself
(`analytics-panel.tsx:72-81`): the fact has to survive a frame, a screenshot, a
screen reader and a keyboard.

### 6.4 The pager, and what replaces `MoreRowsLine`

Under the table and its legend (where the mock's `+N more not shown` line sat),
one row: left, `1–20 of 4,550 sessions` in `text-ink-dim text-meta`; right,
`First`, `Prev`, `1 / 228`, `Next`, `Last`. All four buttons are **always
rendered** and disabled at the ends rather than conditionally mounted — see §7,
where the reason is a focus rule rather than tidiness.

`MoreRowsLine` is **removed**, in the same commit, with the primitive's docstring
rewritten (§3.7). It has exactly one definition and one caller in the whole tree
(grep over `src/`, `scripts/` and `docs/`: `data-table.tsx:111-113` and
`analytics-panel.tsx:34,226`), and this table is that caller. A `+N more not
shown` line beside a pager would be two statements about the same withholding,
and its own docstring's argument — "the difference between a table that is a
summary and a table that is mistaken for the whole answer" — is answered better
by "1–20 of 4,550" plus the ability to reach the rest. The provider table
(`analytics-panel.tsx:88-155`) never used it: its rows are bounded by the
providers that answered.

Empty states, and they differ on purpose:

| situation | what renders |
|---|---|
| the query matches nothing | no table, no pager, no legend (nothing to explain), strip kept so the query can be cleared; `PanelNotice kind="empty"`, `No sessions match "status".`, detail `4,550 sessions in this window. Clear the search to see them.` |
| the filter excludes everything | `No top-level sessions in this window.`, detail naming the count that was excluded. Unreachable on this ledger today (404 roots in 7 days); reachable on a machine whose whole window is subagent work, which is why the copy and its story exist |
| the window has no sessions at all | today's behaviour, unchanged: `PanelEmpty`, `No per-session rows in this window.` (`analytics-panel.tsx:224`) |
| a query or filter leaves exactly one row | the table, the legend and the pager, whose counts the model singularises (`1–1 of 1 session`, §11.1) |

The `CacheHitLegend` stays attached to the table exactly as today
(`analytics-panel.tsx:225`), including in the narrowed-but-non-empty states.

---

## 7. Accessibility and the keyboard contract

| action | pointer | keyboard |
|---|---|---|
| sort a column | click the header button | Tab to the header button, then `Enter` or `Space` |
| flip a sort's direction | click the same header again | `Enter`/`Space` again |
| set the filter | click the checkbox | Tab, `Space` |
| search | click the field, type | the field is the section's first control; type |
| clear the search | click the `×` | Tab to the `×`, `Enter` |
| page | click First/Prev/Next/Last | Tab to the button, `Enter`/`Space` |
| close the panel | — | `Esc`, from anywhere in the panel (§7.1) |
| scroll the panel | wheel | `PageUp`/`PageDown`/arrows on the host body — **the section binds no keys at all** |

**7.1 `Esc` belongs to the host, not the field.** The footer says `Esc closes`
(`picker-host.tsx:339`) and the panel's body region is the focus target on open
(`:815-822`); `Esc` closing the panel is the host's documented contract. The
search field therefore must **not** `preventDefault` or `stopPropagation` on
`Escape`, and the section must add no `keydown` handler that could. This is the
one place where the chat sidebar's precedent (`chat-sidebar.tsx:790-794`: `Esc`
clears the query and blurs) does **not** transfer, and the sidebar's own code says
why: it keeps a visible clear control *because* `Esc` is an unreliable clear
(`:850-857`). A key whose meaning depends on invisible state — "does the field
have text?" — is the two-meanings-for-one-key defect this app has already filed
as a finding. So: one clear action, on the visible `×`, and `Esc` always closes.

**7.2 The clear control's focus rule is already written down.** The `×` unmounts
in the same commit that empties the query, and Chrome drops focus to `<body>` when
the focused element leaves the DOM. `clearSearch(input, apply)`
(`features/chat/clear-search.ts`) exists precisely for this, is exported, and has
its own test; the section **MUST** reuse it rather than re-implement the two
steps.

**7.3 Where focus goes.** Nowhere, on any action.

- After a sort: focus stays on the header button that was pressed. Moving focus
  into the table would make a second activation require re-navigating.
- After a page turn: focus stays on the pressed pager button. **This is why all
  four are always rendered**: `Next` on the last page would otherwise unmount
  under the caret and drop focus to `<body>` (the same DOM rule as §7.2). Disabled
  at the ends is *colour*, never opacity (`branding.md` § 6), and `Button`'s own
  variants already implement that.
- While typing: focus stays in the field, always. The count is announced, never
  focused.
- On opening the panel: unchanged — the host focuses the body region.

**7.4 What a screen reader hears.** One polite live region per section, an
`<output aria-live="polite" className="sr-only">` (the element the tree already
uses for this — `older-history-slot.tsx:149`, `directory-indicator.tsx:1003` —
rather than a `div` with `role="status"`), whose text is a *short* announcement
of the change, not the whole status line: `Sorted by Cost, highest first.`
`38 sessions match "status".` `Page 2 of 228.` `Top-level only: 404 sessions.`
The visible match line (§6.3) and the pager's counts are not live: they are the
same facts in a readable form, and a live region that repeats them on every
keystroke is noise. One live region only — two would double-speak.

**7.5 Non-colour signalling.** The active sort column is indicated by glyph
*shape* (a single-direction chevron for the active direction, a neutral
double-chevron for the inactives), by `aria-sort` on the `<th>`, and by the ink
step; never by colour alone. Nothing lifts, scales or translates on hover —
hover is an ink step (`branding.md` § 5). No focus is stolen, no motion is added;
reduced motion changes nothing here because nothing animates; a page turn is a
re-render, not a transition.

**7.6 Row semantics.** `<th scope="col">`, a real `<table>`, `aria-label`
carrying the table's name and the cache measure as today. Indentation stays a
`paddingLeft` (not leading whitespace) so the label reads cleanly, and the table
adds **no** new claim about depth to a screen reader.

---

## 8. Brand, density and the contrast contract

- Roles only, never colours or hex: `bg-surface`, `bg-sunken`, `text-ink`,
  `text-ink-muted`, `text-ink-dim`, `border-control`, `border-hairline`,
  `text-meta`, `text-mono-sm`, `text-body-sm`. Every `className` through `cn`
  (`AGENTS.md:67-73` — the silent tailwind-merge drop it prevents).
- The strip is one row of controls inside the section body: no new ground, no
  card, no border around the group. Regions separate by rhythm; the stack owns
  the 32 px gap and `PanelSection` owns no outer margin (`panel-frame.tsx:15-18`).
- `text-meta` for the match line and the pager counts, `text-body-sm` for the
  cells, `text-mono-sm tabular-nums` for the numeric columns (unchanged), icons
  on the 12/14/16 ramp at lucide's default stroke, `size-3.5` inside a `sm`
  control.
- **The sortable header button is not a `Button variant="ghost"`.** `ghost`
  brings `hover:bg-accent-wash` (`ui/button.tsx:167-172`), and the header's
  ground is `bg-sunken` (`ui/table.tsx:99`) — a fill the contrast contract does
  not measure there (its `CONTROLS` list has no `accentWash`-on-`sunken` row,
  and `AGENTS.md:63-65` is explicit that green output about an unlisted component
  is not evidence about it). The header control is a plain `<button type="button">`
  whose hover is an **ink step** (`text-ink-dim` → `text-ink`), both of which are
  already asserted on `sunken`, so no new contract row is needed. If
  implementation prefers a fill, it MUST add the `CONTROLS` row in the same
  commit — that is the rule, and it is one line either way.
- The pager's buttons use the existing `Button` `secondary`/`sm`; the search
  field is the existing `Input` with the tree's reserved-column idiom (leading
  glyph, `pl-8`; trailing `×`, `pr-8`) from `chat-sidebar.tsx:842-870` and
  `picker-host.tsx:875-903`.
- No inner scroll container anywhere in the section, per `data-table.tsx:27-28`
  and `ui/table.tsx:9-22`. The header is **not** sticky: the panel body is the
  only scroller, and a sticky header inside it would need the section to know the
  host's geometry.

---

## 9. The performance budget, and how it is measured

**Budget, on the operator's ledger at 30 days (7,065 rows) and 7 days (4,550
rows), measured on this machine:**

| interaction | budget | measured basis |
|---|---|---|
| first render of the section (after the payload is in memory) | **≤ 25 ms** | index 2.8 ms + narrow 1 ms + sort 2.8 ms + enrich 20 rows 0.1 ms + commit 0.9 ms + layout 1.8 ms (§2.2, §2.3) |
| a sort click | **≤ 15 ms** | re-rank with the new key ≤ 12.5 ms worst case (the label, `localeCompare`) + render ≤ 3 ms |
| a keystroke in the search field | **≤ 10 ms** | filter+search+rank 2.0 ms + render ≤ 3 ms; no network, no debounce needed |
| a page turn | **≤ 5 ms** | no re-sort: slice + enrich 20 rows + render ≤ 3 ms |
| rows in the DOM | **≤ 20** | `SESSION_PAGE_SIZE`; measured 120 cells, 679 px |
| rank passes per interaction | **exactly one** | the memo keys in §9.1; a second rank in one interaction is a defect |

Against the measured alternative — 335 ms and 27,300 cells for the full set
(§2.3) — every budget above is one frame or less.

**9.1 Where memoisation lives.** Four `useMemo`s in the section, each keyed on
what it actually depends on, so that a page turn does not re-sort and a refetch
does not re-narrow:

| memo | key |
|---|---|
| `index` (labels, values, the window total) | `[by_session, session_names, session_parents]` |
| `narrowed` | `[index, query, filters]` |
| `ordered` | `[narrowed, effectiveSortKey, direction]` |
| `pageRows` (slice + enrich) | `[ordered, page]` |

`metric` enters through `effectiveSortKey` and the index's `value`, so a metric
change re-ranks once. `refreshing` and the query object's identity enter nothing.

**9.2 How it is measured, for QA and for review.**

1. **Model**: `node` timings over the real payload, exported from the operator's
   ledger with the store's own `aggregate()` (§2.2). The command and the payload
   sizes are in `docs/evidence/panels-analytics/README.md`, so a reviewer re-runs
   rather than trusting the table.
2. **Render, in the shipped runtime**: the probe described in §2.3 — the shipped
   `DataTable` in the pinned Electron, at several row counts. It is a scratch rig
   outside the repository; the numbers are reproducible from the described
   harness, and the committed evidence is (3).
3. **In the app, headless**: QA boots the built app (`pnpm app:headless`, a
   scratch `--user-data-dir`, `--window-mode=headless`) against a copy of the
   operator's ledger and reads, per interaction: the number of `tbody tr`,
   `performance.now()` around the click/keystroke, and the panel's own render
   count for the row set. The claim to falsify is the table above: **≤ 20 rows in
   the DOM and one rank per interaction**, at 4,550 and 7,065 rows.
4. **A test that cannot pass by accident**: a `node --test` case asserting the
   derived page never exceeds `SESSION_PAGE_SIZE`, never repeats an id, and is
   the same array instance across two renders that change nothing but `page`.

---

## 10. What changes, file by file

**New files**

| file | contents |
|---|---|
| `src/renderer/src/features/chat/pickers/panels/analytics-session-state.ts` | the pure layer: `SESSION_PAGE_SIZE`, `SessionTableState`, `sessionTableReducer`, `sessionIndex()`, `narrowSessionIndex()`, `sortSessionIndex()`, `sessionPage()`, `enrichSessionRows()`, `effectiveSortKey()`, `firstDirection()`, `sessionMatchLine()`, `sessionAnnouncement()`, `sessionEmptyText()` |
| `src/renderer/src/features/chat/pickers/panels/primitives/table-pager.tsx` | `TablePager` (`page`, `pageCount`, `from`, `to`, `total`, `label`, `onPage`), four always-rendered buttons and the `n / m` indicator |
| `scripts/analytics-session-table.test.mjs` | the model suite (§11.1) |

**Changed files**

| file:line | change |
|---|---|
| `analytics-panel.tsx:157-229` | `SessionTable` becomes the controller: `useSessionTableState` is passed in (`:161-166`), the strip is rendered above the table, `DataTable` gains `sort` (`:211-224`), `CacheHitLegend` stays (`:225`), `MoreRowsLine` goes (`:226`) and `TablePager` replaces it |
| `analytics-panel.tsx:167-208` | the five columns gain `sortable: true`; the Session cell is unchanged |
| `analytics-panel.tsx:401-406` | the `By session` section passes `state`/`dispatch` down; the title and meta are **unchanged** (the meta's "totals include subagents" is now also the filter's explanation) |
| `analytics-panel.tsx:231-412` | `AnalyticsPanel` owns the reducer and threads it; no prop is added to `AnalyticsPanelProps` (`:53-70`) |
| `analytics-model.ts:354-392` | `sessionRows()` and its `cap = 12` / `hidden` contract are replaced by the new pure API in `analytics-session-state.ts`; the metric total, the `fraction` denominator and the `id` tie-break move with it |
| `analytics-model.ts:330-343`, `:394-411` | `SessionRow` and `sessionDepth()` unchanged (depth clamp and cycle guard are load-bearing, §1.9) |
| `primitives/data-table.tsx:12-29` | docstring rewritten: the primitive still does not sort/page/filter; it renders the page it is given, displays the sort it is told, and reports sort intent |
| `primitives/data-table.tsx:31-41`, `:43-50`, `:51-92` | `Column.sortable?`; `DataTableProps.sort?`; the header cell renders a button + `aria-sort`; rows unchanged |
| `primitives/data-table.tsx:103-113` | `MoreRowsLine` deleted, with the grep evidence in the commit message |
| `analytics-panel.stories.tsx` | a `scaleFixture(n)` generator; new stories (§11.2); `UnnamedSessions` (`:469-482`) must stay green |
| `scripts/capture-evidence.mjs:1467-1532` | `STORIES` entries for the new story ids |
| `package.json` | `scripts/analytics-session-table.test.mjs` added to the hand-written `test:desktop` list (§1.13) |
| `docs/evidence/manifest.json` | re-stamped `srcTree`/`scriptsTree` (§1.14) |

Unchanged, deliberately: the query and its key (`panel-queries.ts:82-114`), the
op and route mapping (`desktop-contract.ts:818-827`, `:1935-1943`), the backend
(no release of `local-operator` is required), `AnalyticsView`
(`analytics-panel.tsx:415-449`), the host and its footer, the By provider table,
the chart, the stat cards.

---

## 11. Tests and evidence

### 11.1 Model tests (`scripts/analytics-session-table.test.mjs`, esbuild-bundled like `clear-search.test.mjs`)

Each of these is falsifiable and each pins a decision this document makes:

1. **Numeric sorts use numbers, not the formatted string** — a fixture whose
   cell strings sort the other way round from their `cost_micro` (e.g.
   `$10.00` vs `$2.00`).
2. **Unknown sorts last in both directions** — unpriced cost and `null` cache.
3. **Tie-break stability** — equal values keep `id`-ascending order under a
   descending primary sort, across both directions.
4. **Filter predicate** — hides rows with a parent edge; with no parents map
   every row is top-level (the `UnnamedSessions` contract, §1.9).
5. **Search** — case-insensitivity over label and id; whitespace-only query
   narrows nothing; the accepted limits (substring, no accent folding) are
   asserted so a future change is visible.
6. **Paging arithmetic** — `pageCount = ceil(matched / 20)`; `from`/`to`; the
   clamp when the set shrinks under the current page; no page beyond the end.
7. **The reducer's reset table** (§4.3) — every resetting action resets, and the
   refetch/`refreshing` path does not.
8. **The denominator cannot move** — a row's `fraction` is byte-identical across
   an empty query, a matching query, a filter, and a page turn.
9. **Wording** — the match line, the announcement, the empty text, including
   `1 session` / `1 of 1 session` singulars.
10. **The page invariant** — never more than `SESSION_PAGE_SIZE` rows, never a
    duplicate id, and unaffected by rows the filter removed.

### 11.2 Stories and frames

New stories, each reachable by pressing the shipped control (a `play` function
drives them, so what is photographed is the shipped affordance — the rig's own
convention, `analytics-panel.stories.tsx:274-281`):

| story | what it shows | `play` |
|---|---|---|
| `SessionPaginated` | strip + 20 rows + legend + pager on the 4,550-row fixture | — |
| `SessionPageTwo` | `1–20` → `21–40`, `2 / 228` | press `Next` |
| `SessionSortedByCost` | `aria-sort="descending"` on Cost, the chevron, the announcement | press the Cost header |
| `SessionSortedBySession` | the label column ascending, `localeCompare` order | press the Session header |
| `SessionSearchMatch` | the match line with a narrowed count | type `status` |
| `SessionSearchEmpty` | the honest empty state and its detail | type `zzz` |
| `SessionTopLevelOnly` | 404 of 4,550 | toggle the filter |
| `SessionScale30d` | the real scale: 7,065 rows, page 1 | — |
| `SessionNarrow720` | the strip wrapping at the narrow width | — |

Plus the existing `UnnamedSessions`, which must be unchanged (ids, no
indentation, searchable by id).

Evidence, and what it can and cannot carry:

- **Before/after frames** for `panels-analytics--populated` at 1140×980: before
  is 12 rows ending in `+N more not shown`, after is the strip, 20 rows and the
  pager. Captured by `pnpm capture:evidence`, admitted by `pnpm check-evidence`
  (one sweep per machine — a busy lease defers with exit 75, so the review and QA
  rounds must serialise their sweeps rather than retry in a loop).
- **The `sr-only` claims do not photograph.** `aria-sort`, the live region's text
  and the focus rules are asserted in each story's `play` (attribute and count
  assertions) and in the node suite, and the story's `README.md` says so in words
  — a frame is captioned with what it shows, never with what it merely implies.
- **The 20-row bound** is asserted in the same `play`
  (`querySelectorAll("tbody tr").length <= 20`), so the frame and the assertion
  cannot disagree.
- **Performance** is evidenced by the §9.2 procedure and its printed numbers, not
  by a frame.

---

## 12. Rollout risks

1. **Two sessions are editing `analytics-panel.tsx`.** This design adds state and
   a strip to a file another session is changing in `AnalyticsView`. Land the
   smaller change first and rebase; nothing here depends on the scope toggle's
   presence (§1.15), so the rebase is mechanical — but it is a real conflict
   surface, and it must not be resolved by dropping either side's intent.
2. **The evidence stamp.** This change moves `src/` and `scripts/`, so every open
   branch pays the two-commit re-stamp of `docs/evidence/manifest.json`
   (`AGENTS.md:118-129`). Budget for it rather than discovering it at the gate.
3. **The swallowed memo.** The failure mode is silent: if a memo key is wrong, the
   table is *correct* and just slower, and nothing in CI notices. The guard is the
   one-rank-per-interaction assertion (§9.2.3-4) and the in-app measurement, not a
   green unit suite.
4. **Focus loss under the caret.** Conditional pager controls or a conditionally
   rendered clear button drop focus to `<body>` (§7.2-7.3). Both are pinned by
   reuse of `clearSearch` and by always rendering the four buttons.
5. **`Esc` regressions.** A `keydown` handler on the section to "make Esc clear
   the search" is the tempting change and it breaks the host's contract. QA's
   matrix must press `Esc` with the field focused and assert the panel closed.
6. **Page size and density.** 20 rows is a reading decision (§3.1) with numbers
   behind it; design review may want a different constant, which is one edit.
   What it must not become is a rows-per-page control whose only effect is to
   change the render cost the page size exists to bound.
7. **Two statements of the same fact.** The match line, the pager's counts and
   the live announcement are three consumers of one model function set; if an
   implementation computes counts inline in the JSX, they will drift. The
   wording functions are the single place, and the node suite pins them.
8. **The payload stays big.** Paging does not shrink the 4.0 MB 30-day response;
   it stops the *DOM* from being 27,300 cells. The follow-up worth having is
   dropping `by_session` from the aggregate for a new paged read on the backend —
   out of scope here, and deliberately not smuggled into this change.

---

## 13. What this document does not decide

- The exact Tailwind class list; §8 states the roles and the constraints, and the
  implementation picks the utilities.
- Whether the pager ever gains a rows-per-page control, or a "jump to page"
  input. Both would need the same budget argument as §9 and are not needed to
  make every session reachable, which is the requirement.
- The backend's own shape (§3.2: the follow-up, not this change).
- The By provider table, whose rows are bounded by the providers that answered
  and which this change deliberately leaves alone.
- Whether the search should ever leave the id out of its match set. It must not:
  an unnamed session's id is the only handle it has.
