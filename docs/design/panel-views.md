# First-class panel views — architecture contract

Status: **design contract, implementation not included.** Two implementers work
against this document in parallel (one in `local-operator-ui`, one in
`local-operator`). Every `MUST` below is a decision, not a menu. Anything marked
`MAY` is genuinely optional and named as such.

Written at UI head `7f0511dd4` (`feat/panel-views`, off `origin/main`) and
backend head `4fd1c5b1a` (`feat/desktop-diagnostic-ops`). Line citations are
against those two trees; where a concurrent PR is known to be touching a file,
the file is named in §15 with the exact edits allowed.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (environment,
evidence, release mechanics), `docs/desktop-controls.md` (the op transport and
its capability-negotiation rule).

---

## 0. The problem as I found it

`/info`, `/analytics`, `/session`, `/context` and `/failovers` are five
read-only diagnostic surfaces that the terminal renders properly and the
desktop renders badly or not at all:

- `AnalyticsView` (`destination-pickers.tsx:2155-2247`) draws five
  `PickerKeyValue` rows and then `JSON.stringify(agg.by_provider, null, 2)` in
  a `<pre>`.
- `FailoversView` (`:2097-2153`) draws the configured default chains as
  `to.join(" -> ")` strings in key/value rows.
- `ContextView` (`:1488-1548`) draws the owner's pre-formatted estimate rows as
  key/value rows, which is at least true, but with no visual.
- `/session` does not open anything: its destination `session.diagnostics`
  (`slash_commands.py:351-355`) has **no entry in `DESTINATIONS`**
  (`picker-registry.tsx:59-107`), so `slash-dispatch.ts:311-323` answers
  "`/session` is not available in the desktop app yet. Run it in the terminal
  with local-operator."
- `/info` has no `desktop_destination` at all (`slash_commands.py:368-386`), so
  it is not even offered in the desktop command list.

Both of the last two are honest notes about a real gap, which is why this is a
build-out rather than a bug list. The design goal from the operator is exact:
**charts, tables and graphs over dense words, optimally spaced, built from
shadcn/recharts**, with the composer's slash popup opening a panel on a click
instead of only autofilling.

## 1. Ground truth that shapes the design

Each of these was read, not recalled. They are the constraints the rest of the
document is derived from.

1. **The shell already exists.** `PickerHost` takes a `body` slot rendered in a
   measured scroll container with a fold rule and a bottom fade
   (`picker-host.tsx:891-942`), a `toolbar` slot above it (`:814`), a footer
   (`:982-1041`), and a `wide` flag that sets `max-w-3xl` (`:146`, `:755`). The
   panels need a taller, wider variant of this — §3 — and nothing else.
2. **`/usage` is the precedent, and its split is the one to copy:**
   `usage-view.tsx` renders the shipped `UsageDialog` with its query lifted
   (`:522-532`) and `usage-view-model.ts` holds the ported pure decisions, so
   stories render the production component over fixtures
   (`usage-view.stories.tsx:1-30`). Panels follow that shape exactly.
3. **The picker host is where panels live**, per the taken decision: a slash
   command's mental model is "open a panel, Esc closes it". No router routes.
4. **Everything the panel headers need is already in the renderer.**
   `canonical.frontend` carries `conversation_title`, `selected_model`,
   `effective_model`, `streaming`, `generation`, `goal`, `active_agent`,
   `active_team`, `context_tokens`, `context_is_estimate`, `context_window`,
   `context_breakdown`, `cost_knowledge`, `jobs`, `mcp_servers`, `todos`
   (`desktop-session-contract.ts:186-238`). No read is needed for a panel's
   identity or for any *live* fact. This is what keeps the two new backend reads
   to two (§5).
5. **`/analytics` has two windows today and they disagree.** The toolbar passes
   `days` (`destination-pickers.tsx:2159`), which the op maps to
   `daily_series(days)` (`desktop_catalogues.py:170`), while the aggregate is
   computed with no bounds and is therefore **all time** (`:167`). Worse,
   `_series` returns "the newest N DISTINCT buckets **that exist**", not a
   wall-clock window (`store.py:1810-1859`), so one idle day consumes a bucket
   slot and the chart can span more calendar days than it claims. §6.1 fixes
   both.
6. **Two wire hazards in the analytics payload**, both of which the backend
   implementer must handle explicitly:
   - `dataclasses.asdict` **drops the two side attributes** that carry session
     names and parent edges (`store.py:1386-1412`; the comment at `:1394-1405`
     says this is deliberate and that a client wanting the tree should be given
     the edges as a new explicit field).
   - `by_model` is keyed by a **tuple** (`store.py:1471-1479`) and
     `by_purpose_outcome` by a tuple too (`:1494-1499`). A JSON object cannot
     have tuple keys, so both MUST be serialised as arrays of objects (§5.3,
     §5.2).
7. **The context breakdown is on-demand and carries numbers only on the owner.**
   `context_breakdown` is deliberately never computed on an unrelated state
   publish (`frontend_state.py:3684-3686`), so the desktop's copy is normally
   `null`; the reliable path is the routed `/context` command, whose block rows
   are **pre-formatted strings** (`serving.py:3195-3200`,
   `tui/app.py:35660-35673`) built from a numeric dict that exists at that
   moment (`session.py:3751-3800`). §5.5 asks for those numbers on the block.
8. **`recharts` is used in exactly one file** (`settings-page.tsx:228-276`),
   where the chart is themed by descendant selectors rather than colour props
   because recharts' colour props land as SVG presentation attributes that
   cannot take a `var()`. There is no shared chart wrapper and no table
   primitive in `shared/components/ui/`. Both are new; §2 says where.
9. **`Progress` cannot be the share bar.** It animates its own datum
   (`progress.tsx`: `transition-transform` on the indicator) and has no
   unmeasurable state; and its track is `bg-sunken` alone, which the contrast
   contract measures at 1.11:1 against `surface` in the dark brand palette
   (the measurement is written into `contrast-contract.mjs:573-575`). The
   `/usage` meter solved both (`usage-view.tsx:233-249`: `border-control` track,
   dotted `ink-dim` rule for unknown, no motion, a 1% sliver for a non-zero
   fraction). §4 copies that, once, into a named primitive.
10. **`Card` already exists with the right variants** (`card.tsx`: `surface` /
    `plain` / `outline`, padding `sm`/`md`/`lg`), as do `Badge`, `Separator`,
    `Skeleton`, `Disclosure`. Nothing in §4 may re-implement them.
11. **The dialog's ground is `elevated`** (`dialog.tsx:69`), so a card inside a
    panel takes `surface` — one step down, which is what makes the usage blocks
    read as cards.
12. **`/info`'s own registry comment is the risk this design inherits.**
    `slash_commands.py:363-367` says a desktop surface pointed at `/info` "would
    describe the machine the host runs on rather than the one the user is asking
    about". The desktop normally talks to a loopback backend on the same
    machine, but the transport is a URL (`docs/desktop-controls.md` "Browser
    development" names `LOCAL_OPERATOR_DESKTOP_BACKEND_URL`, which is how a
    development or remote backend is reached) and the mobile relay exists, so
    the two can be different machines.
    §6.3 and §14 handle that with a label rather than a leap.

---

## 2. Module layout

All new UI files live under
`src/renderer/src/features/chat/pickers/panels/`. The registry keeps importing
every adapter from one module (`destination-pickers.tsx`), which re-exports the
five views, so the registry's own edit stays at four lines (§15).

```
pickers/panels/
  formatters.ts                 one spelling per quantity, ported from the Python
  panel-queries.ts              react-query options for the four panel reads
  panel-frame.tsx               PanelStack, PanelSection, PanelHeader
  panel-states.tsx              PanelNotice, PanelEmpty, PanelSkeleton
  primitives/
    stat-card.tsx               StatGrid + StatCard
    proportion-bar.tsx          the share meter (one per row, or wide for a gauge)
    data-table.tsx              Column<T> / DataTable<T> over the ui/table primitive
    chart-frame.tsx             the ONE place recharts classNames live
  analytics-panel.tsx           AnalyticsPanel (presentational) + AnalyticsView (adapter)
  analytics-model.ts            pure decisions: windowing, series mapping, sorting
  session-panel.tsx             SessionPanel + SessionView
  session-report-model.ts       pure decisions: rates, labels, tree/row projection
  info-panel.tsx                InfoPanel + InfoView
  info-model.ts                 pure decisions: row inclusion, warning predicates
  context-panel.tsx             ContextPanel + ContextView
  context-model.ts              pure decisions: block rows -> rows/bars
  failovers-panel.tsx           FailoversPanel + FailoversView
  failovers-model.ts            pure decisions: serving verdict, chain projection
  *.stories.tsx                 one per panel (titles `panels-*`, §12)

shared/components/ui/
  table.tsx                     NEW: the shadcn table primitive
```

**Why the split is here.** Three seams, each with a reason already visible in
this codebase. First, `*-model.ts` beside each `*-panel.tsx` is the
`usage-view-model.ts` discipline (`:1-24` there): the decisions a frame can only
*show* are asserted as functions the component actually runs, so a later edit
cannot keep the frame and lose the rule. Second, `primitives/` is separate from
the panels because a primitive that only one panel uses still has to be named
once — every chart in the app must resolve its colours in one place, or the
twelve-theme promise is checked in twelve places. Third, `formatters.ts` exists
because the same quantities are rendered by three panels plus, later, the
settings page, and the Python already had to fix two spellings of "tokens"
for the same reason (`analytics_panel.py:103-124` vs
`frontend_state.py:4329-4359`).

**Deliberately not built:** no `sparkline.tsx`. The daily trend is drawn once,
as the `/analytics` bar chart; a sparkline repeating that series inside a stat
card is the same datum twice on one screen. If a second series ever needs a
compact form, it gets one then.

---

## 3. Shell: the panel variant of `PickerHost`

`PickerHost` gains one prop. `wide` stays (it has existing callers and a
different job).

```ts
export type PickerHostProps = {
  // ...existing props unchanged...
  /**
   * The dialog's size class. `dialog` is today's geometry, byte for byte:
   * `max-w-xl` body, `max-h-[min(60vh,520px)]` scroll box.
   *
   * `panel` is the data-view geometry: `max-w-5xl` and a taller scroll box, so a
   * chart plus its table fit above the fold at 1024px and the panel is not a
   * peephole onto its own content. It supersedes `wide`; pass one or the other,
   * never both, and panels pass only this.
   */
  shell?: "dialog" | "panel";
};
```

Geometry when `shell="panel"` (all values are `MUST`):

| Region | Class | Why |
|---|---|---|
| Dialog frame | `max-w-5xl`, `overflow-hidden rounded-lg`, `gap-0 p-0` | 1024px is the app's widest reading column class; `rounded-lg` (14px) is §5's frame radius and the existing value at `picker-host.tsx:757`. |
| Title row | `px-5 pt-5 pr-12` — unchanged | `pr-12` keeps clear of the corner close button. |
| Toolbar row | `px-5 pt-3` — unchanged | The presentation controls live here (§6). |
| Body scroll box | `px-5 pt-3 pb-4`, `max-h-[min(76vh,760px)] overflow-y-auto`, `[scrollbar-gutter:stable]` **always on** | Taller because a panel is scrolled through, not glanced at; `scrollbar-gutter` is unconditional here for the reason already written at `:912-917` — a right-aligned number must not shift sideways when a table overflows. |
| Fold rule + fade | unchanged mechanics | The rule is the answer to "is there more below" and sits on the 3:1 floor (`:904-911`); the 20px mask retracts at the bottom (`:930-937`). Both keep working over the taller box; `bodyOverflows`/`bodyHasMoreBelow` are measured from the box, so nothing in that code changes. |
| Footer | `px-5 py-4` — unchanged | Close button only for a panel; no submit. |

Two behavioural requirements in the same component:

1. **Initial focus.** Today `onOpenAutoFocus` prevents Radix's default and
   focuses the search input (`:759-762`); with no list there is nothing to focus.
   When `shell="panel"`, focus MUST go to the body scroll region (which is
   `tabIndex={0}`, §9); when no body region is mounted, to the footer's Close
   button.
2. **Section rhythm is the container's.** `PanelStack` owns the 32px gap
   between sections; a `PanelSection` MUST NOT carry an outer margin
   (`branding.md:215-225`). Same rule inside a card: `Card`'s own `padding` owns
   its inner gaps.

---

## 4. Primitive inventory

Every `className` goes through `cn` (`branding.md:420-428`). Every colour is a
role. No primitive owns an outer margin. Every prop marked `MUST NOT` is a
requirement to be checked in review, not advice.

### 4.1 `PanelStack` / `PanelSection` / `PanelHeader` — `panel-frame.tsx`

```ts
export type PanelStackProps = { children: ReactNode };

export type PanelSectionProps = {
  /** Sentence case. Names the scope when the section has one ("Sessions on this machine"). */
  title: string;
  /** Qualifier line: the span, the source, or the caveat. One clause. */
  meta?: string;
  /** A control that affects THIS section only. Panel-wide controls go in the host toolbar. */
  action?: ReactNode;
  children: ReactNode;
};
```

`PanelStack` renders `flex flex-col gap-8`. `PanelSection` renders
`<section>` with a header row (`flex items-baseline justify-between gap-3`:
title `text-heading text-ink`, meta `text-meta text-ink-dim`) and children.

MUST NOT: own margin; use a card/surface for its own frame (a panel section is a
region, and eight bordered regions is the busy-panel failure `branding.md:212-213`
names); render a meta that restates the title.

### 4.2 `StatCard` / `StatGrid` — `primitives/stat-card.tsx`

```ts
export type Stat = {
  label: string;
  /** Display text, formatted by the caller through `formatters.ts`. */
  value: string;
  /** Unit suffix rendered beside the value, e.g. "tokens". */
  unit?: string;
  /** One clause of context (a denominator, a coverage, a measurement caveat). */
  note?: string;
  /** A share with a denominator, or null when unmeasurable (dotted). */
  fraction?: number | null;
  tone?: "neutral" | "accent" | "warning" | "danger";
};
export type StatCardProps = Stat;
```

`StatGrid` renders `grid gap-3 sm:grid-cols-2 lg:grid-cols-4`; at 1024px that is
four ~236px cells, which fits `$128.40` plus a `note` without wrapping.
`StatCard` is a `Card variant="surface" padding="md"`: label `text-meta
text-ink-dim`, value `font-mono text-title tabular-nums text-ink`, unit
`text-meta text-ink-muted`, note `text-meta text-ink-dim` with `text-balance`,
and a `ProportionBar` under the value when `fraction` is a number. `tone`
tints the value ink only (`accent` / `warning` / `danger` / `ink`).

MUST NOT: format its own numbers (one spelling per quantity lives in
`formatters.ts`); infer a tone from a magnitude (tone states a measured
condition — failover in force, unpriced cost — never "this number is big");
carry hover, focus or click; render `0` for an unmeasured quantity (callers pass
the unknown spelling).

### 4.3 `ProportionBar` — `primitives/proportion-bar.tsx`

```ts
export type ProportionBarProps = {
  /** 0..1, or null when unmeasurable. Values outside 0..1 are clamped. */
  fraction: number | null;
  tone?: "accent" | "success" | "warning" | "danger";
  /** The track's width class, so every bar in one table shares a column. Default "w-24". */
  className?: string;
  /** The text alternative; the bar itself is `aria-hidden`. */
  srLabel: string;
  /** `gauge` is the taller single-value form used by the context window. */
  size?: "row" | "gauge";
};
```

Geometry and semantics are copied from the `/usage` meter, which is the only
verified one in the tree: track `h-1.5 overflow-hidden rounded-xs border
border-control bg-sunken` (`usage-view.tsx:233-236`), fill `block h-full` in one
role, minimum 1% width for any non-zero fraction (`:244-246`), and for `null` a
`border-ink-dim border-t border-dotted` rule instead of a track (`:212-215`).
`size="gauge"` is `h-2` on the track and is used **once per panel at most**.

MUST NOT: animate anything (the datum is static; `Progress` is the moving one);
render an empty track for an unmeasurable value (an empty track is
pixel-identical to zero, which is a claim); be used as a progress indicator;
render a value without its number somewhere in the row.

### 4.4 `DataTable` — `primitives/data-table.tsx` over a new `ui/table.tsx`

`shared/components/ui/table.tsx` is the shadcn table (`Table`, `TableHeader`,
`TableBody`, `TableRow`, `TableHead`, `TableCell`) with every className routed
through `cn`, `border-hairline` rules only, and no `border-control` except where
a cell is a control (none are). It is added to `shared/components/ui/index.ts`
by name (no star re-export: `index.ts:1-13`).

```ts
export type Column<T> = {
  key: string;
  header: string;
  /** Cell renderer. The caller formats; numeric cells use `font-mono tabular-nums`. */
  cell: (row: T) => ReactNode;
  /** Right-aligns and applies `tabular-nums`. */
  numeric?: boolean;
  /** A leading cell that must survive a narrow frame (a label, a share bar). */
  priority?: "high" | "low";
  className?: string;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** The table's accessible name; also becomes the region's label when wrapped. */
  label: string;
  /** Rendered in place of the table body when `rows` is empty. */
  empty?: ReactNode;
  /** A leading cell rendered before the first column (a proportion bar). */
  leading?: (row: T) => ReactNode;
};
```

Header row is `text-meta text-ink-dim` on `bg-sunken`; body rows are
`text-body-sm`, separated by `hairline` rules, with cells at `py-1.5` so 12 rows
fit the panel's scroll box. Numbers are right-aligned mono.

MUST NOT: sort, paginate, filter or virtualise (every table here is bounded by
its payload — the largest is 50 recent requests, and the design cap is 12 rows
plus a `+N more` line); be a `<div>` grid posing as a table; own its own
scrolling box (the host's body scrolls); allocate a background beyond the header
row.

### 4.5 `ChartFrame` — `primitives/chart-frame.tsx`

```ts
export type ChartFrameProps = {
  /** Sentence case heading; the chart is never unlabelled. */
  title: string;
  meta?: string;
  /** A REAL height. ResponsiveContainer measures its box, so `h-full` renders nothing. */
  heightClassName?: string;   // default "h-56"
  /** Y-axis gutter; must fit the widest abbreviated label. Default 48. */
  yAxisWidth?: number;
  /** Summary sentence for the accessibility tree (§9). */
  srSummary: string;
  /** The recharts element (a single-series `<BarChart>` or `<LineChart>`). */
  children: ReactNode;
};
```

The frame owns, in one place, exactly what `settings-page.tsx:238-246` spells
inline today: `[&_.recharts-cartesian-grid_line]:stroke-hairline`,
`[&_.recharts-cartesian-axis-tick-value]:fill-ink-dim
…:text-meta`, `[&_.recharts-bar-rectangle]:fill-accent` (or
`…-line-curve]:stroke-accent`), `[&_.recharts-tooltip-cursor]:stroke-hairline`,
plus a `<XAxis tickLine={false} axisLine={false}>`, `<YAxis
tickLine={false} axisLine={false} width={yAxisWidth}>`, a horizontal-only
`<CartesianGrid strokeDasharray="3 3">`, and the custom tooltip
(`bg-elevated border border-hairline shadow-overlay rounded-md px-3 py-2`, label
`text-meta text-ink-dim`, value `font-mono text-ink`). The tooltip is a custom
renderer because recharts' `contentStyle`/`itemStyle` take literal colours
(`settings-page.tsx:128-137`).

Consequence for the existing chart: `settings-page.tsx`'s inline wrapper MUST be
migrated onto `ChartFrame` in the same PR, so the app has one chart idiom from
the start rather than two (`branding.md:466-467`). It is a ~10-line swap. If
that file turns out to be concurrently edited, defer it with a one-line note in
the PR body and record it under "not addressed" — do not leave two wrappers and
do not ship a silent third.

MUST NOT: accept a colour, `stroke` or `fill` prop from a caller; draw with an
empty data array (the caller renders `PanelEmpty` — see §7); change a mark's
fill on hover (the tooltip cursor is the hover affordance; there is no
`chart-bar-hover` role in the contract).

### 4.6 `PanelNotice` / `PanelEmpty` / `PanelSkeleton` — `panel-states.tsx`

```ts
export type PanelNoticeProps = {
  kind: "loading" | "unavailable" | "empty" | "degraded";
  /** One sentence: what happened, what it means, what to do, in that order. */
  text: string;
  /** The backend's own detail text or a measurement caveat. Mono, one line. */
  detail?: string;
};

export type PanelSkeletonProps = {
  /** The shape of what is coming, so first paint does not jump. */
  shape: "stats" | "chart" | "table";
  /** Table rows to sketch. Default 6. */
  rows?: number;
};
```

`loading` renders the skeleton, never a bare word in an empty body
(`usage-view.stories.tsx` README makes the same point about `/usage`).
`unavailable` replaces the section's content **and** its meta, in the
`Ledger unavailable` shape the TUI settled on
(`tui/widgets/session_panel.py:841-843`). `degraded` is a quiet line *above*
content that is still shown. `empty` is a claim about an answer, so it is only
reachable once an answer exists.

MUST NOT: show a spinner and a sentence for the same state; use `danger` ink for
a missing measurement (an unread field is not an error — `ink-dim`; the TUI's
"unknown must never be drawn as a warning" is enforced in the model at
`analytics/model.py:860-869`).

### 4.7 `formatters.ts`

Ported one-for-one from the Python, because two surfaces disagreeing about one
number is the defect this file exists to prevent
(`info/model.py:354-379` explains the same reasoning for `format_duration`).

| Function | Source of truth | Output |
|---|---|---|
| `formatMicroUsd(cost_micro, cost_known_calls, calls)` | `analytics_panel.py` money rows, `store.py:411-448` | `$18.40`; `$18.40+` when `cost_known_calls < calls`; `$0.0042` below a cent; `—` when `cost_known_calls === 0` |
| `formatTokens(n)` | `analytics_panel.py:103-123` | `912` / `3.4k` / `1.2M` / `4.1B`, promoting at rounding and stripping `.0` |
| `formatContextTokens(n)` | `frontend_state.py:4329-4343` | `12.4k` / `1.2m` — **lower-case `m`**, deliberately different from `formatTokens` |
| `formatWindow(n)` | `frontend_state.py:4346-4359` | `1M` / `200k`, no decimal on a whole value |
| `formatCount(n)` | new (a count, not an estimate) | `1,234` — never abbreviated where the exact count is the answer |
| `formatMs(v \| null)` | `session_panel.py:215` | `840 ms` / `1.2 s` / `12.4 s`; `unknown` for null |
| `formatClock(ts_ms)` | `session_panel.py:203` | local `HH:MM` |
| `formatDayBucket(period)` | new | `Sep 13` from `YYYY-MM-DD`, parsed as a **local** date |
| `formatPercent(fraction \| null)` | `analytics_panel.py:126-133` | `73%`; `100%` only at exactly 1.0; `—` for null |
| `formatBytes(n \| null)` | `info/model.py:382-393` | `181 MB` / `1.9 GB` / `—` |
| `formatDuration(s \| null)` | `info/model.py:354-379` | `42s` / `4m` / `3h 12m` / `2d 4h` / `unknown` |

MUST NOT: import from or duplicate `usage-view-model.ts` (that file owns the
provider-usage amount ladder with its own half-even float rules, `:215-425`);
return `0` or `$0.00` for a null input; parse a formatted string back into a
number.

---

## 5. Payload contract

This section is what the backend implementer codes against. Field names are
exact; units are stated; the absent/unknown convention is stated per field.

### 5.0 Conventions that apply to every op below

- **Money** is integer **micro-USD** (`cost_micro`), always paired with
  `cost_known_calls`. `cost_known_calls < calls` means the figure is a **lower
  bound**; `cost_known_calls === 0` means nothing in scope is priceable and the
  client renders `—`, never `$0.00` (`store.py:411-448`).
- **Tokens** are raw integers. Abbreviation is the client's job
  (`formatters.ts`), never the wire's.
- **Time**: `ts_ms` is epoch **milliseconds**; `captured_at` in `info.get` is
  epoch **seconds** (a float, `collect.py:1161`); `days` is a count of calendar
  buckets; `since_ms`/`until_ms` are epoch ms, half-open (`ts_ms >= since_ms`,
  `ts_ms < until_ms` — `store.py:1292-1299`).
- **Unknown is not zero.** Every field that can be unmeasured is nullable and
  the client renders the unknown spelling. Where the ledger's *absence* is a
  distinct fact from a zero (tool-call stats, descendant spend, an unopenable
  store) the payload says so explicitly and the client MUST NOT fold the two
  together.
- **Capability negotiation is mandatory** (`docs/desktop-controls.md`: "New
  feature controls must negotiate `GET /v1/capabilities` before enabling
  themselves"): the two new ops ride one new key, `diagnostics: 1`.

### 5.1 NEW — `info.get`

- Op: `info.get`
- HTTP: `GET /v1/desktop/info`
- Parameters: **none.** `/info` has exactly one answer per host, which is why
  the command takes no argument at all (`slash_commands.py:356-362`).
- Capability: `diagnostics >= 1`.
- Implementation note: `collect_snapshot` blocks (≈880 ms for the memory probe
  alone, `collect.py:1115-1122`) and MUST run through `asyncio.to_thread`, the
  same call shape the analytics route already uses
  (`desktop_catalogues.py:176`). Build it as
  `collect_snapshot(LiveState())` — **with no live session**, see below.
- Response: `{data: {...}}` (the `reply()` envelope; `desktopResult` unwraps
  `result`, `desktop-api.ts:208-227`), where `data` is
  `dataclasses.asdict(InfoSnapshot)`:

```ts
type InfoGetData = {
  install: {
    version: string;                 // "" when unreadable
    kind: string;                    // Update.InstallKind value: uv_tool | editable | ...
    prefix: string; executable: string;
    import_path: string;             // the package dir that ACTUALLY resolved
    import_path_foreign: boolean;    // do NOT render a warning from this directly
    is_git_snapshot: boolean; source_ref: string;
    build_age_s: number | null;
    latest_known: string | null;     // last PyPI answer ON DISK; null = never checked
    latest_age_s: number | null;
    behind: boolean;
    python_version: string; python_implementation: string;
    platform: string; machine: string;
  };
  process: {
    pid: number; session_id: string; conversation_name: string;
    cwd: string; model_label: string; effective_model: string;
    uptime_s: number | null;
    config_dir: string; config_dir_redirected: boolean;
    agent_home: string; agent_home_redirected: boolean;
    cache_dir: string; log_dir: string;
    control_port: number | null;     // null = not listening; a port is not a measurement otherwise
    protocol: number | null;         // control-socket protocol version
    kind: string;                    // daemon | tui | ...
  };
  sessions: {
    lines: Array<{
      pid: number; kind: string;
      state: "live" | "wedged" | "stale" | "stored" | "";
      session_id: string; conversation_name: string; model_label: string; cwd: string;
      uptime_s: number; heartbeat_age_s: number;
      rss_bytes: number | null; footprint_bytes: number | null;
      last_activity_s: number | null;
      pending: string | null; busy: boolean; detached: boolean;
      version: string; source_ref: string;
      // NOTE: no control_key — its absence is a tested invariant
    }>;
    total: number; live: number; wedged: number; stale: number;
    busy: number; pending: number; detached: number;
    build_skew: boolean;             // >1 distinct (version, source_ref) among LIVE
    usage_available: boolean;        // false = memory probes returned nothing at all
    available: boolean;              // false = the registry scan itself failed
    subagents_reporting: number; subagents_unreported: number;
    fleet_subagents_running: number; fleet_subagents_queued: number;
    fleet_session_trajectories: number; fleet_trajectories: number;
  };
  agents: {
    profiles: number; teams: number;
    tree: Array<{ job_id: string; label: string; status: string; depth: number;
                 agent_role: string; effort: string;
                 parent_job_id: string | null; session_id: string | null; live: boolean }> | null;
    running: number | null; queued: number | null; settled: number | null;
    max_running: number | null; at_capacity: boolean | null;
    max_depth: number | null; deeper: number | null;
    cross_session_known: boolean | null; roster_unread: boolean | null;
  };
  env: {
    mcp_configured: number | null; mcp_connected: number | null; mcp_failed: number | null;
    mcp_settling: boolean | null;
    mcp_failures: Array<[string, string]> | null;   // [server name, truncated message]
    approval_mode: string | null; theme: string;
    terminal_size: [number, number] | null;
    term: string; colorterm: string; multiplexer: string; is_tty: boolean;
    browser_backend: string; browser_name: string; browser_paired: boolean;
    mobile_installed: boolean; mobile_healthy: boolean; mobile_port: number | null;
    credential_keys: string[];               // NAMES ONLY, never a value/length/prefix
    guides: number; skills: number | null;
  };
  degraded: Array<[string, string]>;   // [field or block name, one-line reason]
  captured_at: number;                 // epoch SECONDS
};
```

**A deliberate consequence: the live half of `InfoSnapshot` is not filled, and
the client does not read it.** `collect_snapshot(LiveState())` leaves
`agents.tree`, `agents.running/queued/settled/max_running`, `env.mcp_*` and
`env.approval_mode` at their empty defaults, and that is correct for this
surface: those facts belong to a *session*, and the desktop already holds them
live for the conversation on screen (`canonical.frontend.jobs`,
`canonical.frontend.mcp_servers`, `desktop-session-contract.ts:208-216`). Filling
them from the backend would require resolving the owner's `subagent_comms`,
`jobs` and `mcp_startup` objects across the bridge, which the bridge does not
expose (`desktop_sessions.py:155-221` gives `remote.frontend_state`, `model`,
and the registries). So: **the panel renders subagents and MCP from
`canonical.frontend`, and MUST NOT render `agents.*` or `env.mcp_*` from this
payload.** If the backend ever fills them, nothing changes on the client — the
fields are present and ignored, which is stated here so a later reader does not
"fix" the panel to read them and introduce a second source of truth for a live
fact.

**CORRECTED AFTER THE BACKEND QA ROUND (cross-repo).** Those fields are not merely
empty on this payload: the route NULLS them
(`_unmeasure_live_half` in `server/routes/desktop_catalogues.py`) —
`agents.tree`, the agent counters, `env.mcp_*`, `env.approval_mode` and
`env.skills` — because the desktop's read has no session attached, so their
`LiveState()` defaults are the values of a state nothing measured, and `0`,
`false` and `[]` are indistinguishable from readings on the one screen whose job
is to be believed. The TS block above is corrected to `| null` accordingly, and
this document was WRONG on it when the UI half was implemented: the client cannot
read a value it was not sent, and the panel must render §8's unknown for those
fields rather than a default. The distinction to keep is exactly the one
`_UNMEASURED_ON_THE_HOST_VIEW` draws: `agents.profiles`/`teams`, the session
registry, `env.guides`/`credential_keys` and the install/process/terminal probes
ARE real probes of this machine and keep rendering as readings.

The backend implementer should therefore pass `LiveState()` and need not touch
the session bridge at all.

### 5.2 NEW — `sessions.report`

- Op: `sessions.report`
- HTTP: `GET /v1/desktop/sessions/{session_id}/report`
- Parameters: `recent_limit` (query, int, default 12, clamped 0..50 —
  `store.py:1550`); `session_id` is a path segment validated by the existing
  `^[a-f0-9]{12}$` pattern.
- Capability: `diagnostics >= 1`.
- Source: `AnalyticsStore.session_report(session_id, recent_limit=...)`
  (`store.py:1424-1578`), unmodified arithmetic. It is a single explicit read
  transaction, so every number on the panel comes from one WAL snapshot; that
  property is the reason `/session` reads this and not `analytics.get`.
- Response: `{data: SessionReportPayload}`:

```ts
type UsageAggregatePayload = {
  calls: number; ok_calls: number;
  input_tokens: number; output_tokens: number;
  cache_read_tokens: number; cache_write_tokens: number;
  reasoning_tokens: number; context_tokens: number;
  cost_micro: number; cost_known_calls: number;
  components: Record<string, number>;          // exactly COMPONENT_KEYS, all 9 present
  by_provider: Record<string, UsageAggregatePayload>;  // always {} on this op
  by_session: Record<string, UsageAggregatePayload>;   // always {} on this op
};

type TimingSummaryPayload = {
  samples: number;
  mean_ms: number | null; min_ms: number | null; max_ms: number | null;
};

type SessionRequestPayload = {
  request_id: string; ts_ms: number;
  provider: string; model_id: string;
  purpose: string;                              // turn | compaction | aside | naming | ... | unknown
  outcome: string;                              // provider finish reason, or an exception class name
  usage_reported: boolean | null;
  context_tokens: number; output_tokens: number;
  duration_ms: number | null; ttft_ms: number | null; preparation_ms: number | null;
  ok: boolean | null;                           // null = unknown, NEVER painted as a failure
};

type ToolCallStatsPayload = {
  total: number;                                // MODEL-EMITTED calls, all faults included
  ok: number;
  faults: Record<string, number>;               // fault name -> count
  faults_by_tool: Record<string, number>;
  nested_total: number; nested_ok: number; nested_excluded: number;
  // The rates are NOT on the wire (they are Python properties). The client derives
  // them with the formulas in §6.2, which are the ones the docstrings define.
};

type SessionReportPayload = {
  session_id: string;
  available: boolean;                           // false = the ledger could not be read
  aggregate: UsageAggregatePayload;             // OWN scope, exact session id
  descendants_aggregate: UsageAggregatePayload | null;  // null = the walk could not run
  descendant_ids: string[];                     // nearest-first
  by_model: Array<{ provider: string; model_id: string; aggregate: UsageAggregatePayload }>;
  by_purpose: Array<{ purpose: string; aggregate: UsageAggregatePayload }>;
  by_purpose_outcome: Array<{ purpose: string; outcome: string; calls: number }>;
  missing_usage_calls: number;                  // usage_reported = 0
  unknown_usage_calls: number;                  // usage_reported IS NULL
  timings: { duration_ms: TimingSummaryPayload; ttft_ms: TimingSummaryPayload;
             preparation_ms: TimingSummaryPayload };   // all three keys always present
  recent: SessionRequestPayload[];              // newest first, <= recent_limit
  first_ts_ms: number | null; last_ts_ms: number | null;
  tool_calls: ToolCallStatsPayload | null;      // null = not measured (NOT zero)
};
```

**JSON encoding is part of this contract.** `by_model` is a
`dict[tuple[str, str], UsageAggregate]` (`store.py:1471-1479`) and
`by_purpose_outcome` a `dict[tuple[str, str], int]` (`:1494-1499`); a JSON object
cannot have tuple keys, so `dataclasses.asdict(report)` MUST NOT be returned
as-is. The route builds the arrays above explicitly. This is the single most
likely way to ship a 500 on the panel's first frame.

Everything else is a faithful `asdict`, and two facts about that are load-bearing:

- `descendants_aggregate: null` means the subtree walk could not run (an older
  ledger with no `parent_session_id`). It is **not** "$0.00 of subagents"
  (`model.py:920-926`).
- `tool_calls: null` means no tool-call rows were recorded (a session predating
  the feature), which is the opposite of a zeroed `ToolCallStats`
  (`model.py:931-937`).

### 5.3 EXISTING — `analytics.get`, plus two additive fields

Unchanged: op `analytics.get`, `GET /v1/desktop/analytics?days&session_id&since_ms&until_ms`
(`desktop-contract.ts:1356-1364`), response
`{data: {aggregate: UsageAggregatePayload, daily: UsagePeriodPayload[], daily_scope: "all_sessions"}}`
(`desktop_catalogues.py:151-176`).

`daily` is the `usage_daily` rollup, oldest-first, at most `days` entries
(`store.py:1861-1887`), each:

```ts
type UsagePeriodPayload = {
  period: string;     // local YYYY-MM-DD; "" only for a totals row, never here
  model: string;      // "" — the route asks for the across-models series
  input_tokens: number; output_tokens: number;
  cache_read_tokens: number; cache_write_tokens: number;
  reasoning_tokens: number; context_tokens: number;
  cost_micro: number; cost_known_calls: number; calls: number;
};
```

**Two additive fields MUST be added to `data`** (not a new read — an existing
response gaining a field, which `store.py:1394-1405` explicitly invites):

```ts
  session_names: Record<string, string>;    // id -> human name; {} when unknown
  session_parents: Record<string, string>;  // child id -> parent id; {} when the column is absent
```

They are the store's `session_names` and `session_parents` side attributes
(`store.py:1386-1412`), which `asdict` drops. Without them the by-session table
can only print 12-hex ids and cannot show the tree. **Fallback rule:** when
either field is absent (an older backend), the panel renders the hex id as the
label and no indentation, and says nothing about it — an id is a true label, so
there is nothing to apologise for.

Note the existing caveat, still true: the *aggregate* is per-session OWN figures
and never rolled up over children; `session_parents` is what lets the client
re-partition. The route does not do that rollup for you.

### 5.4 EXISTING — `sessions.failovers`

Unchanged: op `sessions.failovers`, `GET /v1/desktop/sessions/{id}/failovers`,
response (`desktop_catalogues.py:215-233`):

```ts
{ data: {
    selected: ModelSpecPayload | null,   // state.selected_model
    effective: ModelSpecPayload | null,  // state.effective_model
    chains: Record<string, string[]>,    // key -> display hops ("provider/model (effort)")
    scope: "configured_defaults",
    live_model_source: "owner",
} }
```

`ModelSpecPayload` is a `ModelSpec` dump (`harness/types.py:1948-1960`): at least
`provider`, `model_id`, `context_window`; the client uses `provider` and
`model_id` only. `chains` hops are already display labels with the effort folded
in (`settings_io.py:2701-2726`), so the client MUST NOT re-compose them.

### 5.5 EXISTING — `sessions.command` for `context`, plus `data.numbers`

The `/context` panel reads the routed command's block
(`slash-dispatch.ts:296-356` → `POST /v1/desktop/sessions/{id}/commands`, which
returns the owner's `SlashResult`). Today:

```ts
{ kind: "block", data: {
    type: "context",
    title: "Estimated next request",
    items: Array<[string, string]>,   // [label, "~12.3k"] — ALREADY FORMATTED
} }
```
(`serving.py:3195-3210`, `tui/app.py:35660-35673`.)

**`data.numbers` MUST be added**, carrying the dict the rows were built from —
it exists one line earlier in the same function
(`session.py:3751-3800`):

```ts
    numbers: {
      instructions: number; tool_inventory: number; tool_schemas: number;
      environment: number; knowledge_mcp_goal: number; messages: number;
      context_window: number; cache_read: number; total: number;
    }
```

This is an addition to an existing payload on an existing route, not a third
read: it is additive, nothing reads it today, and it is the only way the panel
can draw a bar rather than parse a human string. **Fallback rule:** when
`numbers` is absent, the rows render without bars (labels and values still
exact) — the panel MUST NOT parse `items` to recover the numbers, because a
formatter change would then silently move a chart.

Keys map to the panel's row labels in §6.4. `cache_read` is 0 when there is no
last usage, and `context_window` is the **effective** model's window
(`session.py:3787-3790`), not the selected one.

### 5.6 Capability keys and registry rows

| What | Value | Why separate |
|---|---|---|
| `features.diagnostics` | `1` (new) | Gates `info.get` and `sessions.report`. It is a new key, not a bump, because `/analytics` and `/failovers` must keep working against a backend that lacks the two new routes — the rule `capabilities.py:36-50` states. |
| `features.catalogues` | stays `1` | Already covers `analytics.get` and `sessions.failovers`. |

Renderer gating: `/analytics` and `/failovers` need no new gate;
`InfoView`/`SessionView` MUST call `desktopFeatureEnabled(capabilities, "diagnostics", 1)`
(`desktop-hooks.ts:73-79`) and, when it is false, MUST NOT call the op — the
panel renders one `PanelNotice kind="unavailable"` naming the backend update
action, as `docs/desktop-controls.md` requires.

Backend registry rows:

| Command | Change |
|---|---|
| `/info` | Gains `desktop_destination="info"` (`slash_commands.py:368-386`); the comment block above it MUST be rewritten — it currently argues the destination must not exist, and that argument is now half right (the caveat survives as the panel's host label). |
| `/session` | Unchanged: `session.diagnostics` (`:351-355`) already exists and is already the right destination. |

Renderer registry rows (`picker-registry.tsx:59-107`):

| Destination | Entry |
|---|---|
| `info` | `{ kind: "picker", component: InfoView }` |
| `session.diagnostics` | `{ kind: "picker", component: SessionView }` |

`session.context`, `session.failovers` and `analytics` already have rows; their
components change behind the same names.

### 5.7 Query keys and freshness (`panel-queries.ts`)

| Panel | Query key | staleTime | Notes |
|---|---|---|---|
| `/info` | `["desktop", "info"]` | 15 s | No `keepPreviousData` — a second open should show the skeleton, not a stale install block. |
| `/session` | `["desktop", "session-report", sessionId]` | 0 | A diagnostics panel is re-read on every open. |
| `/analytics` | `["desktop", "analytics", days, scopeSessionId ?? "", sinceMs, untilMs]` | 15 s | `keepPreviousData` — the window toggle must not blank the chart it is changing. |
| `/failovers` | `["desktop", "failovers", sessionId]` | 15 s | |
| `/context` | **no react-query key** | — | This is a routed command, not a catalogue read: the panel keeps `useSessionCommand` (`destination-pickers.tsx:1493-1497`), which runs `sessions.command` once on open and holds the owner's answer in component state. There is nothing to cache or refetch. |

No polling anywhere. Every panel is a snapshot the user opened, refreshed by
reopening — the same contract `/usage` uses.

---

## 6. Per-panel grammar

Order is top-to-bottom. "Display" names the primitive; "field" names the exact
payload path; "degrades" is the required behaviour for each failure.

### 6.1 `/analytics` → `AnalyticsView` (destination `analytics`)

Reads `analytics.get`. The window rule is the fix from §1.5: the aggregate is
**windowed**, the chart is **filtered to the same window**, and both are derived
from one computed local day.

```
const days = 7;                                  // toolbar, default 7
const firstDay = localDayString(now, -(days - 1));   // "YYYY-MM-DD", local
const sinceMs  = localMidnightMs(now, -(days - 1));
const untilMs  = localMidnightMs(now, +1);           // half-open: includes today
// op args: { days, sinceMs, untilMs, sessionId: thisSession ? sessionId : undefined }
// chart rows: data.daily.filter((row) => row.period >= firstDay)
```

Toolbar (`PickerHost` `toolbar`): `PickerSegment` **Window** (Today / 7 days /
30 days), `PickerSegment` **Metric** (Tokens / Spend), `PickerCheck` **This
session only**. One metric control for the whole panel — the chart and both
tables follow it — because two metric toggles on one screen is the defect the
TUI avoided with its single `t` key (`session_panel.py:770-775`).

| # | Section | Display | Fields | Why this form |
|---|---|---|---|---|
| 1 | **Totals** | `StatGrid` of 4 | `aggregate.calls`, `ok_calls`; `context_tokens + output_tokens`; `cost_micro`/`cost_known_calls`/`calls`; `cache_read_tokens/context_tokens` | Four unrelated scalars with no shared denominator. A bar implies one (`analytics_panel.py:990-991` says the same for the TUI). Meta: `Last 7 days · Sep 7–Sep 13 · all sessions` (or `this session`). Notes: `N failed` only when `ok_calls !== calls`; `X in · Y out`; `N of M calls priced` when partial; `X read · Y written`. Cost card's `fraction` is `cost_known_calls/calls`, so partial pricing is visible without a second section. |
| 2 | **Daily spend** | `ChartFrame` + `BarChart`, one series | `daily[].cost_micro` (Spend) or `context_tokens + output_tokens` (Tokens) | Buckets are discrete calendar days and the user compares magnitudes; a **bar per bucket** is the honest form, and it is the only form that can show a day with no calls as absent rather than interpolated. One hue (§7). Meta: `Daily rollup · Sep 7–Sep 13`, plus `all sessions` whenever the scope check is on (`daily_scope` is always `all_sessions`). |
| 3 | **By provider** | `DataTable` with a `ProportionBar` leading cell | `aggregate.by_provider[k]` | Rows of bars, not a stacked or multi-series chart: the shares are within one total, and a multi-hue chart would need roles with invented semantics (§7). Columns: Provider · Calls · Tokens · Cost. Sorted by the selected metric, descending. |
| 4 | **By session** | `DataTable`, top 12, same shape | `aggregate.by_session`, `data.session_names`, `data.session_parents` | Same reason. Label is `session_names[id] ?? id` (the id in mono when a name is unknown); depth from `session_parents`, indented up to 2 levels then folded into a `+N more` row. Meta: `Own figures per session · totals include subagents` — the aggregate serves OWN figures, and a reader comparing a row with the headline total must be told why they differ (`store.py:1394-1405`). |

Degrades:

| Condition | Required behaviour |
|---|---|
| `calls === 0` | The whole body becomes one `PanelNotice kind="empty"`: "No calls recorded in the last 7 days." + "Analytics accrue as sessions make provider calls." Sections 2-4 are **not** rendered. (`analytics_panel.py:1058-1073` is the copy's source.) |
| `daily.length === 0` while `calls > 0` | Section 2 alone becomes `PanelNotice kind="empty"`: "No daily rows for this window. The daily rollup only covers calls recorded since it began." This is a real state on a ledger written before the rollup existed. |
| Metric = Spend, window `cost_known_calls === 0` | Section 2 becomes `PanelNotice kind="empty"`: "No priced calls in this window." Never a flat zero line. |
| Cost partial (`0 < cost_known_calls < calls`) | `$X+` in the stat, `N of M calls priced` in its note. No second section. |
| `session_names` / `session_parents` absent | Ids as labels, no indent (silent fallback, §5.3). |
| Backend unreachable / 4xx | Whole body = `PanelNotice kind="unavailable"` with `errorText(error)` — the backend's own detail, never synthesised (`desktop-api.ts:214-224`). |
| `diagnostics` capability irrelevant here; `catalogues` covers it | No gate. |

**CORRECTED AFTER THE UI QA ROUND — the "backend unreachable" row is
UNREACHABLE in the shipped app.** The command list is owned by the backend
runtime, so with the server down the slash command is not offered at all: the
failure is reported by the offline surface and by the transcript, and no panel
mounts to render this row. The row stays in the tables below as the rendering a
panel owes a 4xx it *can* still receive (a route that answers an error while the
session is up), which is why the code path exists and is tested — but a reader
should not expect to reach it by killing the backend (QA round 1, Q5). The same
applies to § 6.2's, § 6.3's and § 6.4's rows of that name.

### 6.2 `/session` → `SessionView` (destination `session.diagnostics`)

Reads **only** `sessions.report` (one snapshot; this is the answer to the taken
decision's "say which"). `analytics.get?session_id=` is **not** used: it would
give a second aggregate computed by a different query path, and the whole point
of `session_report` is that all of its numbers came from one pinned read
transaction (`store.py:1425-1432`).

Header, above the sections: conversation title
(`canonical.frontend.conversation_title || "Untitled session"`) at
`text-heading text-ink`, then the session id in `font-mono text-meta
text-ink-dim`.

Toolbar: `PickerSegment` **Metric** (Tokens / Cost) — one control, applied to
sections 3, 4 and 5.

| # | Section | Display | Fields |
|---|---|---|---|
| 1 | **Totals** | `StatGrid` of 4 | Requests `aggregate.calls` (+ `N failed` when `ok_calls !== calls`); Cost **incl. subagents**; Tokens `context_tokens + output_tokens`; Cache hit rate |
| 2 | **Context window** | one `ProportionBar size="gauge"` + its numbers | `canonical.frontend.context_tokens / context_window` |
| 3 | **By model** | `DataTable` + bar per row | `by_model[]` → `provider/model_id`, `aggregate` |
| 4 | **By purpose** | `DataTable` + bar per row | `by_purpose[]` |
| 5 | **Where input went** | `DataTable` + bar per row | `aggregate.components` over `COMPONENT_KEYS` |
| 6 | **Timings** | `DataTable`, 3 rows | `timings.duration_ms`, `ttft_ms`, `preparation_ms` |
| 7 | **Tool calls** | `StatGrid` (2) + `DataTable` of faults | `tool_calls` |
| 8 | **Recent requests** | `DataTable`, ≤ `recent_limit` rows | `recent[]` |
| 9 | **Scope** | `Disclosure`, closed | `first_ts_ms`, `last_ts_ms` |

Details that are decisions, not choices:

- **Section 2 is live and says so.** Meta: `live · not from the ledger`. Text:
  `12.4k / 200k (6.2%)` via `formatContextTokens` / `formatWindow` /
  `formatPercent`, with the word `estimate` appended when
  `context_is_estimate === true`. A fresh session with an empty ledger still
  gets this section — it is the one true visual of a session that has spent
  nothing.
- **Section 1's cost scope.** Meta gains `· cost incl. subagents` **only when
  `descendant_ids.length > 0`**. The stat is
  `aggregate.cost_micro + (descendants_aggregate?.cost_micro ?? 0)`. When
  `descendants_aggregate === null` the note MUST read `subagent spend not
  measured` — the tree total is unknown, not zero (`model.py:920-926`).
- **Section 5's caveat.** Meta: `≈ estimated split of context tokens`. Rows are
  the nine `COMPONENT_KEYS` with `COMPONENT_LABELS` (`model.py:60-85`), sorted
  descending, over `sum(components)`. No bars when the sum is 0.
- **Section 6 is a table, not a chart.** Three quantities with no shared
  denominator and no shared unit interpretation (preparation is not wall time
  the user waited). Row: name · `mean` · `min–max` · `N samples`; when
  `samples === 0`, the value is `unknown (0 samples)` — the TUI's own spelling
  (`session_panel.py:604`).
- **Section 7 must not draw the two rates as neighbouring bars.** `validity`
  and `execution_error_rate` share no denominator (`model.py:710-713`). Display:
  a `StatGrid` of two with each rate's denominator in its note
  (`validity = 1 − model_faults/emitted`, `execution_error_rate =
  execution_faults/(emitted − model_faults)`, `emitted = total −
  Σfaults[denied|aborted|skipped|gate_failed]` — `model.py:757-842`), then a
  table of `faults` by name, then a separate labelled line for the nested set
  (`nested_total`, `nested_ok`) that states it is **not** in either rate.
- **Section 8's outcome cell.** Badge `ok === true` → neutral `ok`;
  `ok === false` → `danger` `failed`; `ok === null` → dim `unknown`. `outcome`
  is a *label* (a provider finish reason or an exception class name) and MUST
  NOT be used to decide failure — an older ledger reports every row as
  `unknown` and deriving failure from it "painted an entire healthy session in
  warning" (`model.py:905-912`).

Degrades:

| Condition | Required behaviour |
|---|---|
| `available === false` | Body = `PanelNotice kind="unavailable"`: "Could not read local usage records. Close and reopen to try again." + the backend's `degraded` reason when present. **No** sections, including the gauge: when the read failed we cannot say which numbers are trustworthy (`session_panel.py:837-840`). |
| `available === true`, `aggregate.calls === 0` | `PanelNotice kind="empty"` "No recorded requests for this session yet." + section 2 only. |
| `tool_calls === null` | Section 7 = one line, `Not measured for this session.` Never a zeroed stat. |
| `timings.*.samples === 0` | `unknown (0 samples)` in that row. |
| `cost_known_calls === 0` | `—` + `No call in this session has a published price`. |
| Section 2 with `context_tokens === null` | Dotted rule, `not measured`. |
| Backend unreachable | `PanelNotice kind="unavailable"` with `errorText(error)`. |
| `diagnostics < 1` | One `PanelNotice kind="unavailable"` naming the backend update action; the op is never called. |

### 6.3 `/info` → `InfoView` (destination `info`)

Reads `info.get` **and** `canonical.frontend`. Sections, in order — the install
block first, because both audiences open with it (`info_panel.py:413-421`).

| # | Section | Display | Fields |
|---|---|---|---|
| 1 | **Install** | `StatGrid` of 3 + a two-row path block | `install.*` |
| 2 | **Host runtime** | `DataTable` | `process.*` |
| 3 | **Sessions on this machine** | `StatGrid` of 4 + `DataTable` | `sessions.*` |
| 4 | **Agents and subagents** | `StatGrid` of 4 + prose caveats | `sessions.*` fleet roll-ups + `agents.profiles`/`teams` |
| 5 | **This conversation** | `DataTable` | `canonical.frontend.*` |
| 6 | **Environment** | `DataTable` + a `Disclosure` | `env.*` + `frontend.mcp_servers` |
| 7 | **Could not be read** | `DataTable` of reasons | `degraded[]` |

- **Section 1.** Version + a `warning` `Badge` `vX.Y.Z available — /update` when
  `behind && latest_known`; install kind; interpreter. Then `Install path` and
  `Running code` (`import_path`) as two adjacent rows, because "which install
  claims to be executing" and "which code is executing" are only meaningful side
  by side. `Running code` takes the `warning` tone when
  **`is_shadowed_install`** is true — and the client MUST re-implement that
  predicate exactly as `import_path_foreign && kind !== "editable"`
  (`info/model.py:396-412`), never as `import_path_foreign` alone: spelling it
  twice is what made the TUI screen and its export reach opposite conclusions
  (QA round 1, Q1 there). `latest_known === null` renders `never checked`, which
  is a different fact from `up to date` (`model.py:80-83`). Meta: python
  version, platform, `machine`.
- **Section 2's meta is the caveat, not decoration:** `the machine this app is
  connected to`. Rows: pid, started (`formatDuration(uptime_s)`), working dir,
  config dir (+ `redirected by LOCAL_OPERATOR_CONFIG_DIR` when the flag is set),
  cache dir, agent home (+ the same for `LOCAL_OPERATOR_HOME`), log dir, control
  port (+ `protocol vN`). Rows are **omitted** when their value is empty — a
  backend that serves many sessions legitimately has no `session_id`,
  `conversation_name` or `model_label`, and a row whose only content is "—" is
  noise.
- **Section 3.** `StatGrid`: Live, Wedged, Busy, Needs input (`pending !== null`).
  `DataTable` columns: name (`conversation_name || session_id`), state badge,
  model, uptime (`formatDuration`) or `last_activity_s` for a `stored` row,
  memory (`formatBytes(footprint_bytes ?? rss_bytes)`), and the markers
  (`this session` / `busy` / `needs X`) as badges. Meta: `N live · M total`.
- **Section 4** answers the terminal's other question — how many agent runtimes
  and how many agent trajectories this machine is running — over
  `info_panel.py::_agents_section` and `_fleet_caveats`. It follows those rules,
  and departs from them in the five places named at the end of this bullet.
  `StatGrid` of four: **Runtimes** (`live + wedged`, the value being the
  denominator of the tally beside it; the note `N live · M wedged` appears only
  when something is wedged, because with nothing wedged it restates the Live and
  Wedged tiles directly above it), **Trajectories** (`≥M total` — the `≥` only
  when some runtimes did not report — with `S sessions + B subagents` and, when
  the meta does not already say it, `· Q queued`), **Agent profiles** and
  **Teams** (`agents.profiles`/`agents.teams`, rendered `—` when the probe's own
  name OR its block prefix appears in `degraded[]` — `("agents", …)` is how a
  failed agent collection arrives, and its fallback is `profiles: 0, teams: 0`;
  a zero from a probe that answered is still a zero).
  Meta: `N runtimes · ≥M trajectories`; `N runtimes · trajectories —` when some
  runtimes did not report AND nothing was measured; `N runtimes · none running ·
  Q queued` when the measured total is zero with children waiting;
  `N runtimes · none running` when every runtime reported zero. Caveats are
  quiet prose under the grid and appear only when they apply: `U session(s)
  run(s) an older build and do(es) not report subagents — the fleet total is a
  lower bound.` (both verbs inflect together) and `M session(s) is/are wedged;
  its/their counts are as of its/their last heartbeat.` (the possessives inflect
  with the subject). Four rules are NOT presentation choices: an unmeasured term
  is never rendered as `0` (`—` is the unknown spelling), queued children are
  named BESIDE the trajectory total and never added into it, `runtimes` is
  `live + wedged` so the meta agrees with the sum beneath it, and **no fact is
  stated twice in one viewport** — the note and the meta are one viewport here,
  where the terminal's header is a page-turn away, so the note drops what the
  meta already says (`Q queued`) and what the caveat line beneath it already says
  (`U did not report`). The once-per-viewport rule is scoped to a MEASURED total:
  at `0 total` the note's addends (`0 sessions + 0 subagents`) are deliberately
  KEPT even though the meta has already said `none running`, because they are this
  panel's only spelling of a measured zero as distinct from `—`, and the terminal
  weighs the same shape and keeps it too (design round 2, D8). Same plural helper
  for the meta and the rows
  (`render.py::plural`'s irregular map: `1 trajectory` / `N trajectories`).
  Two sections share one spelling of a failed scan, from a single exported
  constant (section 3 and this one); with the scan failed, NEITHER section
  carries a meta, because the meta is a reading of that scan.

  **The five deliberate departures from the terminal**, all recorded rather than
  implied, so "mirrors it" is not read as "differs nowhere":

  1. **The lower-bound caveat is suppressed when the total is refused.** The
     terminal emits `… the fleet total is a lower bound.` whenever
     `subagents_unreported` is non-zero (`render.py::_fleet_caveats`), including
     the state in which the panel refuses the total entirely (`trajectories —`
     in the meta, `—` on the card). A sentence qualifying a total the same
     viewport refuses to state is the section contradicting itself, so it is
     dropped there (design round 1, D1); the card's own note — `U of N runtimes
     did not report` — carries the fact. The terminal's copy of this is a
     follow-up for the local-operator repository, not a change here.
  2. **The refused-count note inflects its noun.** `U of N runtime(s) did not
     report` where `info_panel.py:1080` hard-codes `runtimes`, which reads `1 of
     1 runtimes did not report` on a single-runtime host (review round 1, N1).
  3. **The wedged row says `wedged`, the terminal's says `not answering`.** This
     panel's own section 3 state badge says `wedged` one section above.
  4. **A failed agent collection is an unknown.** `countOrUnknown` matches the
     field or its block prefix; the terminal's `_counted` compares the field name
     only, so `("agents", …)` renders `0` there.
  5. **With the registry unscanned, this section shows no numbers at all** —
     where the terminal still prints `agents.profiles`/`agents.teams`, whose
     collector has its own guard. This section's headline is the fleet answer,
     which comes from the scan that failed.
- **Section 5** is the half that keeps `/info` honest on a remote backend: the
  host facts above describe the machine the backend runs on; this section
  describes the window in front of the user. Rows: session id, model
  (`selected_model.provider/model_id`), **answering model only when it differs**
  (the failover fact, `info_panel.py:647-654`), context
  `context_tokens / context_window` (via `formatContextTokens` /
  `formatWindow`), cost knowledge (`cost_knowledge`), active team or agent when
  set, goal when set. Meta: `live · this conversation`.
- **Section 6.** MCP: `mcp_servers` from `canonical.frontend` — configured /
  connected / failed counts with a `settling` note, then failure rows
  `name → error`. Then approval mode (`env.approval_mode`), browser backend and
  pairing, mobile installed/healthy/port, guides and skills counts, and
  `credential_keys` as a wrapped list of **names** with the one-line note
  "Names only. Values are never read." The terminal-only fields
  (`term`, `colorterm`, `multiplexer`, `is_tty`, `terminal_size`, `theme`) go
  inside a `Disclosure` labelled `Runtime terminal`, because they describe the
  terminal the *backend runtime* has (or does not have), not this window.
- **Section 7** renders only when `degraded.length > 0`: two columns,
  `field` in mono and the reason in prose. This is the answer to "why is this
  `—`" and its absence is the reason `/info` costs a round trip
  (`info/model.py:417-423`).

Degrades:

| Condition | Required behaviour |
|---|---|
| `sessions.available === false` | Sections 3 and 4 become `PanelNotice kind="unavailable"`: "Could not scan the session registry. Close and reopen this panel to try again." — one exported constant, rendered by both (the desktop has no `r` key; do not borrow the TUI's copy). **Neither section carries a meta in this state**: the meta is a reading of the scan that failed. Section 4 carries no numbers at all then — no cards, no caveat — because every number it has comes from that scan. |
| `sessions.usage_available === false` | One line under the table: "Memory could not be measured on this machine." Never a column of `—` (`model.py:192-195`). |
| `sessions.build_skew === true` | One `PanelNotice kind="degraded"` line: "More than one build is running. A change may look absent in a window that has not been restarted." |
| `sessions.lines.length === 0` | "No other lop sessions are running on this machine." |
| `install.*` all empty | The section still renders, with `unavailable` in place of each value — a missing section reads as a rendering bug (`info_panel.py:422-427`). |
| `env.mcp_settling` | Note "Still connecting deferred servers" — reporting "1 of 3 up" mid-handshake makes a user file a bug about a server that came up a second later (`model.py:323-326`). |
| `diagnostics < 1` | One `PanelNotice kind="unavailable"`, op never called. |
| Backend unreachable | `PanelNotice kind="unavailable"` with `errorText(error)`; sections 5 and 6 still render from `canonical.frontend`, because they are live local facts. This is a **requirement**: the panel must degrade section by section, not blank. |

### 6.4 `/context` → `ContextView` (destination `session.context`)

Reads `sessions.command("context")` (below) and `canonical.frontend`.

| # | Section | Display | Fields |
|---|---|---|---|
| 1 | **This conversation** | `ProportionBar` + numbers | `frontend.context_tokens / context_window`, `context_is_estimate` |
| 2 | **Next request** | `DataTable` + bar per row when `numbers` is present | `block.data.items`, `block.data.numbers` |
| 3 | **Last cache read** | one `StatCard` | `numbers.cache_read` |

- Section 1's meta: `live · measured on the last request`; the value carries
  `estimate` when `context_is_estimate === true`. It is the measured half, so it
  is rendered first.
- Section 2's meta: `≈ estimated · tokenized when this panel opened`. Rows map
  `numbers` → labels: `instructions` → `Instructions`, `tool_inventory` → `Tool
  inventory`, `tool_schemas` → `Tool schemas`, `environment` → `Environment`,
  `knowledge_mcp_goal` → `Skills / MCP / goal`, `messages` → `Messages`,
  `total` → `Total`. Values render `~` + `formatContextTokens(n)` — the tilde is
  part of the estimate's meaning, and the row labels are the owner's, not
  re-invented. The `Total` row sits behind a `Separator` and carries the
  block's own text when it is available: `~12.4k / 200k (6.2%)`.
- Section 3 renders only when `numbers.cache_read > 0`; it is the one **exact**
  number on the panel and its meta is `exact, from the last provider reply`.
- Without `numbers` (an older backend): section 2 renders the `items` pairs as a
  two-column table with no bars, and section 1 still renders. **No parsing.**

Degrades:

| Condition | Required behaviour |
|---|---|
| `command.busy` | `PanelNotice kind="loading"` "Asking the owner." The block arrives from the owner, so this is a real wait. |
| `command.result` is an error | `PanelNotice kind="unavailable"` with the owner's own text (never re-worded; `use-picker-backend.ts:46-85` maps the style). |
| The block's notice "context breakdown unavailable." | `PanelNotice kind="empty"`: "The breakdown is not available for this session yet. Send a turn and open it again." |
| `frontend.context_tokens === null` | Section 1 renders the dotted rule and `not measured`; sections 2-3 still render if the block arrived. |
| No block and no error (a command that returned nothing) | `PanelNotice kind="empty"` "The owner returned no breakdown." |

### 6.5 `/failovers` → `FailoversView` (destination `session.failovers`)

Reads `sessions.failovers`. No chart: a cascade is not a quantity.

| # | Section | Display | Fields |
|---|---|---|---|
| 1 | **Serving** | two `StatCard`s side by side | `selected`, `effective` |
| 2 | **Fallback chains** | one row per chain: key + a chip cascade | `chains` |
| 3 | **Scope** | one prose line under the meta | `scope`, `live_model_source` |

- Section 1: **Selected** (`provider/model_id`, truncated with a tooltip
  carrying the full selector) and **Serving**. When they are equal, Serving's
  note reads `Same as selected` on the neutral tone. When they differ it takes
  `tone="warning"` and the note reads `Failover is in force`. This is the panel's
  one loud fact and the reason the panel exists. Meta on the section: `live ·
  from the session's owner`. When either is `null` — or arrives with both halves
  blank, which is what the owner sends when nothing is chosen — the value reads
  the unknown spelling (`—`) and the note `No model recorded`. It is NOT `none`:
  `none` is a claim that nothing is serving, and the panel knows only that
  nothing was recorded (QA round 1, Q3).
- Section 2: meta `configured defaults · not live routing state`. Each row:
  the key in mono, then the hops as `Badge variant="neutral"` chips (mono
  `text-mono-sm`, `bg-sunken`, `border-hairline`) separated by
  `ArrowRight` at 14px in `text-ink-dim`. Hops are already display labels
  (`settings_io.py:2702-2709`) — render them verbatim. An empty chain renders
  `(none)` and the note `A failure here goes straight to an error`.
- Section 3 states the distinction that the old view put in its description:
  "Chains are configuration read from your settings file. What is actually
  serving is the live value above."

Degrades:

| Condition | Required behaviour |
|---|---|
| `chains` empty | Section 2 = `PanelNotice kind="empty"` "No fallback chains configured." |
| `selected` and `effective` both null | Section 1 renders with `none` / `No model recorded`; section 2 unchanged. |
| Backend unreachable / 4xx | `PanelNotice kind="unavailable"` with `errorText(error)`. |

---

## 7. Chart rules

1. **One series per chart.** The only chart hue is `accent` (via `fill-accent`
   / `stroke-accent`), which `check-themes` already asserts at ≥ 4.5:1 as text on
   `canvas` and `surface` in all twelve palettes (`branding.md:143-152`). A
   second series colour is not available: `branding.md:109-116` gives the accent
   a budget of about three spends per screen, and re-purposing `success` /
   `info` decoratively would invent a semantic that the contrast contract has no
   row for. Breakdowns are therefore **many rows of single-hue bars**, never a
   stacked or multi-series chart.
2. **The chart type follows the data shape.**
   - One quantity per discrete calendar bucket → `BarChart`. Bars, because a
     line interpolates across days the ledger has no rows for, which is a claim
     about days nobody measured.
   - Shares of one total, one row per category → `ProportionBar` rows. Not a
     pie (unreadable below ~5% and it has no honest unknown form), not a stacked
     bar (needs N hues, see rule 1).
   - One measured value against a capacity → the `size="gauge"` bar.
   - Unrelated scalars with no shared denominator → `StatCard`s, never bars.
3. **Axis and grid.** No axis lines, no tick lines; horizontal grid lines only,
   `stroke-hairline`, `strokeDasharray="3 3"`; X ticks are `formatDayBucket`;
   Y ticks are `formatTokens` in `fill-ink-dim text-meta`; `yAxisWidth` is
   measured once from the largest label the panel can produce and then fixed
   (a per-render width makes bars jitter as data changes).
4. **Tooltip.** Always the custom renderer (§4.5): `bg-elevated`, `border-hairline`,
   `shadow-overlay`, label `text-meta text-ink-dim`, value `font-mono text-ink`
   with its unit. The tooltip is the only place a chart value appears at full
   ink.
5. **Legibility at the dialog's width.** `max-w-5xl` minus the body's `px-5` is
   ~984px. A 30-bucket bar chart gives ~30px per bar, which is legible; past 40
   it is not, so the window control stops at 30 and the op's 366 ceiling is
   never offered. In a table, the bar column is a fixed `w-24` and the value
   column is right-aligned mono with `tabular-nums`, so bars align down the
   table and the numbers form one right edge.
6. **The theme set.** Nothing may be carried by colour alone: the series is
   named in the section title, and every bar has its number in the row. Because
   the only chart role is `accent`, a chart cannot be legible in one theme and
   invisible in another — and the two frames per theme that evidence this
   (`localOperatorDark`, `localOperatorLight`) are the minimum, not the set.
7. **All values zero, or no rows.** No invented axis. A chart with no data is
   never rendered: the caller substitutes `PanelNotice kind="empty"` with a
   sentence about *why* it is empty (no calls in the window / no priced calls /
   no daily rollup). A `domain` of `[0, 0]` makes recharts paint a flat mark at
   the top of an empty box, which reads as data.
8. **No motion on marks.** Bars and lines do not transition, do not animate in,
   and do not change fill on hover; the hover affordance is the tooltip cursor
   (`stroke-hairline`) plus the tooltip. `branding.md:249-259` caps durations at
   240ms and reserves transitions for entrances; a chart mark is not an
   entrance.

---

## 8. States and copy

Copy rules: sentence case (`branding.md:413-414`), no emoji, no internal
vocabulary — no routing ids, and **never "this build"**
(`slash-dispatch.ts:311-323` is the precedent for both). Errors say what
happened, what it means, what to do, in that order (`branding.md:410-411`).

| State | Rendering | One line of copy |
|---|---|---|
| `loading` (first paint, no data) | `PanelSkeleton` shaped like the content | (no sentence — the skeleton is the message) |
| `refreshing` (data on screen, refetch in flight) | Content unchanged; the toolbar's trailing slot shows a quiet `Refreshing` line in `text-meta text-ink-dim` | `Refreshing` |
| `empty` (a real answer with no rows) | `PanelNotice kind="empty"` in place of that section | per section, §6 |
| `degraded` (partial read, or a caveat) | `PanelNotice kind="degraded"` above content | per section, §6 |
| `unavailable` (the read failed) | `PanelNotice kind="unavailable"` replacing the affected section's content **and** meta | `errorText(error)` — the backend's own detail |
| `gated` (`diagnostics < 1`) | whole-body `PanelNotice kind="unavailable"` | `This backend cannot serve this panel yet. Update the backend and try again.` |
| unmeasured value inside a rendered row | the value's own unknown spelling | `—`, `not measured`, `unknown (0 samples)`, `not reported` — never `0` |

Two anti-patterns named so review can reject them: a spinner **and** a sentence
for the same state; and `danger` ink for a value nobody could measure (that is
`ink-dim`; `red` means something is wrong, not that something is absent).

---

## 9. Accessibility and keyboard

- **Focus.** Radix's `Dialog` traps focus and handles Esc; nothing in a panel may
  stop propagation. On open, `shell="panel"` focuses the body scroll region
  (§3). Every interactive element a panel adds (the toolbar segments and checks)
  is an existing `Button`/`Checkbox`, so it is already in the tab order.
- **The scroll region is a named tab stop.** `tabIndex={0}`,
  `role="region"`, `aria-label` naming the *region* rather than repeating the
  dialog title — the exact fix and the exact reasoning at `usage-view.tsx:632-655`
  ("Provider usage region" inside "Provider usage dialog" tells the user
  nothing new).
- **Esc** closes the panel. The footer's control is `Close`, never `Cancel`
  (`picker-host.tsx:1019-1028`: closing does not cancel anything).
- **Tables are tables.** `<table>` with `<th scope="col">` headers and
  `aria-label` from `label`; a `ProportionBar` is `aria-hidden` and its number is
  the text alternative (the bar is redundant with the value beside it, so
  announcing it twice is noise).
- **What a screen reader gets from a chart.** `ChartFrame` renders the
  `srSummary` in a `<p className="sr-only">` — one sentence naming the series,
  the span, the number of buckets, the total, and the peak
  ("Daily tokens from Sep 7 to Sep 13: 5 days with usage, 1.2M tokens total,
  highest Sep 11 at 340k."). The recharts SVG is `aria-hidden`. A chart is never
  the only carrier of a fact: every value on it also appears in a table or a
  stat.
- **Keyboard-only parity.** Every control in a panel toolbar is reachable and
  operable by keyboard; the context gauge and the bar rows are not controls and
  are not in the tab order.

---

## 10. The composer interaction contract: a pointer pick runs the command

**Today.** `SlashSuggestionsPopup` picks on `mousedown`
(`slash-commands.tsx:213-218`) and the pick handler only completes the token:
`completeSlashToken(...)` then `slash.close()`
(`message-input.tsx:451-464`). Keyboard `Enter`/`Tab` call the same handler
(`slash-commands.tsx:264-271`).

**Required change (composer, not the panels).** `handleSlashPick` gains a
source argument and a second effect:

```ts
handleSlashPick(command: SlashCommandMeta, source: "keyboard" | "pointer")
```

- `source === "keyboard"`: unchanged — complete the token, close the popup, no
  dispatch. All keyboard behaviour stays exactly as it is.
- `source === "pointer"`: complete the token **and**, when the command is
  eligible, dispatch it as a bare command (`/name` with empty args) through the
  existing `dispatch` path (`slash-dispatch.ts:194-376`). The popup closes, the
  panel opens, and the composer keeps the completed line so the user can see
  what ran.

Eligibility — `isPointerPickRunnable(command)`, one exported predicate in
`slash-commands.tsx` (not `slash-dispatch.ts`: the composer decides before the
text becomes a submission):

```ts
/**
 * Destinations a pointer pick must NOT run, because running the bare command
 * that opens them is not opening a view.
 */
const POINTER_PICK_COMPLETION_ONLY: ReadonlySet<string> = new Set([
  "window.close",     // closes the app. The operator's rule names this one.
  "session.team",     // name + message: the picker exists to collect both
  "session.agent",    // name + message: same shape (desktop_commands.py:57-65)
  "session.compact",  // its bare form STARTS a compaction pass, not a read
  "transcript.clear", // its bare form empties the rendered transcript
]);
// plus: a command whose `arguments === "required"` has no bare form and stays
// completion-only (/login, /credential would be a 422).
```

On `session.team` / `session.agent`: the operator's brief calls these
"name+message destinations (`slash.inline.nameThenMessage`)". That identifier
does not exist anywhere in either tree — the destinations are `session.team` and
`session.agent`, and `ProfilePicker` submits `name` + optional `request` as one
owner command (`destination-pickers.tsx:679-688`). The predicate keys on the
destination names for that reason.

On the last two entries: they are the one place this contract is **stricter**
than the rule as stated. A single click must not compact a context or wipe a
transcript; both are recoverable-but-surprising, and both are one entry away
from being allowed if the operator says so. Everything else — including `/stop`
(whose destructive step is gated behind an explicit `confirmed` checkbox,
`desktop_commands.py:98-107`), `/new`, `/resume`, `/reload`, `/clear`… *except*
the two named above — runs.

Result handling: the dispatch already returns `"not-a-command" | "consumed" |
"retained"`. A `retained` result means the command never ran (a budget refusal
or a transport failure) — the completed text stays in the composer and the
existing note explains; no panel opens. A `consumed` result where the
destination is `navigate` routes to settings instead of a panel, which is
correct and unchanged.

---

## 11. Theme gates: rows to add to `scripts/contrast-contract.mjs`

`AGENTS.md:63-65` and `branding.md:167-179`: a component with its own fill and
border needs a row, or green output says nothing about it. Four rows, in the
tables that already exist for exactly these shapes:

`GRAPHICS` (a fill that carries meaning and holds no text — `:445-460`):

| name | on | fg |
|---|---|---|
| `panel proportion fill (accent)` | `["sunken"]` | `accent` |
| `panel chart bar (accent)` | `["surface"]` | `accent` |
| `panel chain chip` | `["surface"]` | *(fill/border form: fill `sunken`, border `hairline`, fg `ink` — as a `CONTROLS` row, see below)* |

`CONTROLS` (`:127`): one row, because a chip is a filled, bounded box holding
text:

| name | on | fill | border | ink |
|---|---|---|---|---|
| `panel chain chip` | `["elevated", "surface"]` | `sunken` | `hairline` | `ink` |

If that row cannot clear its edge floor (a `hairline` is capped below 2:1 by the
contract, `:573-575`), the chip drops its border and keeps the `sunken` fill —
the chip's identity is the fill, and the boundary test in `branding.md:96-107`
says a rule that carries no information comes off rather than being promoted to
`border-control`.

Not added, deliberately: a `StatCard` row. A card is not a control — it has no
state the user operates — and its `surface`-on-`elevated` edge is the same
ground step `/usage`'s provider blocks already rely on, which `branding.md:156-165`
governs by ΔE00 rather than by a contrast ratio. Adding a floor row for it would
assert something the design does not claim.

Then run `pnpm check-themes` (freshness + floors), and `pnpm check-themes` again
after any palette edit — never hand-edit `styles/themes.generated.css`.

---

## 12. Evidence

Per panel, one story file with a shared title prefix so a narrowed recapture
catches all of them: `title: "panels-analytics"`, `"panels-session"`,
`"panels-info"`, `"panels-context"`, `"panels-failovers"` (the title is the
evidence directory name; `usage-view.stories.tsx:279-281` is the precedent, and
`scripts/capture-evidence.mjs:799` matches `--only` against the story id).

Each story renders the **production presentational component** (`AnalyticsPanel`
etc.) with its query lifted, over fixtures — never a story-shaped imitation
(`usage-view.stories.tsx:1-30`). Fixtures MUST be real-shaped: exact field names
and types from §5, including the null cases, with a fixed clock
(`NOW_MS`-style constant) so a frame is reproducible.

Required stories per panel (the minimum reviewable set):

| Story | What it proves |
|---|---|
| `populated` | the default state, at `localOperatorDark` **and** `localOperatorLight` |
| `empty` | the empty copy and that no axis is invented |
| `loading` | the skeleton matches the real content's shape |
| `unavailable` | the failure shape and the backend's own sentence |
| `narrow` | 720px: bars surrender width first, labels and values hold |
| `dense` | the largest legal payload: a body that overflows, evidencing the fold rule and the fade |
| per-panel hard states | `/analytics`: `unpriced` (`cost_known_calls === 0`) and `partial-cost`; `/session`: `tree-cost` (descendants present), `no-tool-calls` (null), `zero-samples`; `/info`: `build-skew`, `roster-unread`, `remote-host`, and the fleet honesty states `fleet-one-does-not-report`, `fleet-nobody-reports`, `fleet-queued-only`, `fleet-all-idle`, `fleet-wedged`, `fleet-unavailable`, `fleet-probes-failed`, `fleet-agents-unread` (the `≥` bound, the `—` refusal, the measured-zero-with-a-queue, the earned `none running`, the wedged split, the registry that could not be scanned, and a probe that failed — by field and by block), plus `fleet-neighbours` (the section in situ, under the sessions section), `fleet-narrow` (720px) and `fleet-note-wraps` (the one frame whose note WRAPS, where the separator's non-breaking spacing is judged from pixels); `/context`: `no-numbers` (pre-`numbers` backend); `/failovers`: `failover-in-force`, `no-chains` |

Then, in the UI PR:

```
pnpm check-types && pnpm lint && pnpm check-themes
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=panels- --themes=localOperatorDark,localOperatorLight
```

`--only`/`--themes` switch the capture to append mode and record
`partialCapture` in `docs/evidence/manifest.json`; a narrowed set is legitimate
for a remediation recapture and must not be presented as a sweep
(`capture-evidence.mjs:46-62`).

Live evidence is still required for the two claims a fixture cannot make: that
`info.get` and `sessions.report` really answer on this machine. Capture those as
`docs/evidence/panels-*/real-data/` from the running app in `headless` mode
(`AGENTS.md:169-207`: every agent-driven launch names a window mode) against a
real backend, with the command and its actual response recorded in the same
README style as `docs/evidence/chat-usage/README.md`.

---

## 13. Non-goals

1. **No router routes.** Panels stay in the picker host (§1.3). A route would
   need its own deep-link semantics, its own Esc handling, and a second way for
   Esc to close something — for a surface whose whole mental model is "a panel".
2. **No new npm dependencies.** recharts 2.15.3, radix-ui 1.6.7, lucide-react
   0.507, tailwind v4, `class-variance-authority` are all present
   (`package.json:158-169`).
3. **No ag-grid, no virtualised table.** Every table is bounded by its payload.
4. **No chart in the transcript.** These panels are opened, read and closed;
   nothing here becomes an inline chat widget.
5. **No persistence of panel state.** Window, metric and scope reset on open —
   a remembered "30 days" on a panel the user opens twice a month is a stale
   setting they did not set.
6. **No sparkline** (§2), no drill-down, no export, no copy-to-clipboard from a
   panel (a follow-up if wanted; `/copy` owns clipboard semantics today).
7. **`/info` does not become a log viewer.** `env.log_dir` is a path, not a
   reader.
8. **No settings-page redesign.** The only touch outside `panels/` is migrating
   its one chart onto `ChartFrame` (§4.5) and the shell/registry/type edits in
   §15.

---

## 14. The riskiest assumption, and the check that would falsify it

**Assumption.** `collect_snapshot(LiveState())` — the `/info` host read with no
session attached — produces a snapshot whose *host* half (install, process,
sessions, agents counts, env) is meaningful on the machine running the backend,
and whose *live* half is safely empty because the client never reads it.

**Why it is risky.** `LiveState()`'s defaults are not merely empty: they are
indistinguishable from measured zeros for `mcp_*` and `agents.*`. If any
implementer forgets §5.1's rule and renders `env.mcp_connected`, a host whose
backend never attached a session paints "MCP 0 connected", which is precisely
the "confident zero" failure the collector's own docstrings campaign against
(`collect.py:1014-1023`, and the `_counted` rule at `info_panel.py:752-760`).

**The check that falsifies it (do this first, before writing any panel code):**

```sh
# On this machine, with the UI's backend running:
curl -s -H "Authorization: Bearer $LOCAL_OPERATOR_DESKTOP_TOKEN" \
  http://127.0.0.1:<port>/v1/desktop/info | python3 -m json.tool | head -40
```

Pass if: `install.version` is a real version, `process.pid` is the backend's own
pid, `sessions.total >= 1`, `captured_at` is a plausible epoch in **seconds**,
and `degraded` is a list of pairs (possibly empty). Falsified if: any block is
missing rather than defaulted, `process.config_dir` is empty on a host with a
config dir, or the call blocks the event loop long enough to delay a concurrent
`/v1/health` (the ~880 ms memory probe is the reason for `to_thread`).

Second check, for the label: start the backend with
`LOCAL_OPERATOR_DESKTOP_BACKEND_URL` pointed at a *different* host (or note the
field's default, which is loopback) and confirm the panel's section 2 meta reads
`the machine this app is connected to` and its values change with the backend.
If the shipped product can only ever be loopback, the label is still correct —
it costs one clause and it is the only thing standing between this panel and the
registry comment at `slash_commands.py:363-367` becoming a lie.

---

## 15. Implementation order, and the two shared files

Order (each step leaves the tree green):

1. `ui/table.tsx` + its `index.ts` export; `panels/formatters.ts`;
   `panels/primitives/*`. Nothing imports them yet.
2. `PickerHost` `shell="panel"` (§3), including the focus change. `/usage` is
   unaffected (it keeps `wide`).
3. Backend: `info.get`, `sessions.report`, the two additive analytics fields,
   `data.numbers`, the capability key, the `/info` registry row and its comment.
4. One panel at a time, adapter + model + stories, ending with `/failovers`
   (the simplest) because it exercises the shell end-to-end with no chart.
5. Migrate `settings-page.tsx`'s chart onto `ChartFrame` (§4.5).
6. `docs/desktop-controls.md`: add `info.get` and `sessions.report` to the
   operation list and `diagnostics` to the capability list — that file is the
   transport's own record and it goes stale silently otherwise.

**Edits allowed in the two files a concurrent PR (#143, slash completion) is
touching.** Everything else in them is out of bounds for this work.

`picker-registry.tsx`:
- two names added to the existing `./destination-pickers` import block
  (`InfoView`, `SessionView`);
- two rows in `DESTINATIONS`: `info`, `session.diagnostics`.
- The header comment at `:6-13` gains one clause naming the panel shell.

`destination-pickers.tsx`:
- `AnalyticsView`, `FailoversView` and `ContextView` are **deleted** and
  replaced by re-exports from `./panels/*` — the file's own pattern for
  `/usage` already (`:2089-2095`), extended to five panes;
- no other edit. In particular `useEntities` (`:90-108`) **stays** where it is:
  no panel needs it (`/context` reads a command, not entities), so moving it
  would churn a concurrently edited file for nothing.

Panels import `PickerContext` as a **type** from `../destination-pickers`,
exactly as `usage-view.tsx:33` does — a type-only import through the cycle is
erased at build and is the existing precedent.

---

## 16. Items the manager must hold both sides to

Numbered so they can be ticked on the MRs. The first is the only one that stops
the UI work entirely.

1. **The `info.get` smoke check in §14 passes**, including the epoch-seconds
   unit of `captured_at` and the `to_thread` call shape.
2. `sessions.report` encodes `by_model` and `by_purpose_outcome` as **arrays**,
   not tuple-keyed objects (§5.2) — verified by reading a real response, not by
   reading the code.
3. `analytics.get` serves `session_names` and `session_parents` explicitly
   (§5.3), and the client's fallback (ids, no indent) is exercised by a story.
4. `sessions.command("context")` blocks carry `data.numbers` (§5.5), and the
   no-`numbers` path is exercised by a story.
5. `features.diagnostics: 1` is in `/v1/capabilities`, and the two gated panels
   render the update action without calling the op when it is absent (§5.6).
6. The `/info` registry comment is rewritten rather than deleted
   (`slash_commands.py:363-367`) — the caveat it names is now the panel's host
   label.
7. The four `contrast-contract.mjs` rows in §11 are added, or the chip drops its
   border, and `pnpm check-themes` is green.
8. `settings-page.tsx`'s chart is on `ChartFrame`, or its deferral is recorded
   in the PR body — two chart wrappers is the defect this item exists to
   prevent.
9. The pointer-pick predicate (§10) is one exported function, its two extra
   exclusions are visible in the diff, and `/exit`, `/team`, `/agent`,
   `/compact` and `/clear` are shown to stay completion-only in the PR's QA
   matrix.
10. `docs/desktop-controls.md` is updated (§15.6).
