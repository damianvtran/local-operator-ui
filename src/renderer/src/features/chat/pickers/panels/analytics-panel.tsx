import { Button, Input } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import {
	type Dispatch,
	type FC,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { Bar, BarChart } from "recharts";
import type { DesktopModelRate } from "../../../../../../shared/desktop-contract";
import { clearSearch } from "../../clear-search";
import { PickerCheck, PickerHost, PickerSegment } from "../picker-host";
import type { MachinePanelContext } from "../picker-registry";
import { errorText } from "../use-picker-backend";
import {
	type AnalyticsData,
	type AnalyticsMetric,
	type AnalyticsWindow,
	CACHE_HIT_LABEL,
	CACHE_HIT_MEANING,
	COVERAGE_LABEL,
	METRIC_LABEL,
	type ModelRow,
	TOK_PER_SECOND_LABEL,
	WALL_TOK_PER_SECOND_LABEL,
	analyticsWindow,
	cacheReadFraction,
	chartSeries,
	chartSummary,
	costKnownFraction,
	dailyMeta,
	decodeCoverage,
	modelCoverage,
	modelRateLegend,
	modelRows,
	percentageOf,
	providerRows,
	rateLegend,
	spendTick,
	tokenTick,
	totalTokens,
	windowMeta,
	windowTitle,
} from "./analytics-model";
import {
	INITIAL_SESSION_TABLE_STATE,
	type SessionTableAction,
	type SessionTableChange,
	type SessionTableScope,
	type SessionTableState,
	asSessionSortKey,
	effectiveSortDirection,
	effectiveSortKey,
	enrichSessionRows,
	isNarrowed,
	narrowSessionIndex,
	sessionAnnouncement,
	sessionEmptyText,
	sessionIndex,
	sessionMatchLine,
	sessionPage,
	sessionTableReducer,
	sessionTableScopeKey,
	sortSessionIndex,
} from "./analytics-session-state";
import {
	formatCount,
	formatMicroUsd,
	formatTokens,
	formatTokensPerSecond,
} from "./formatters";
import { PanelSection, PanelStack } from "./panel-frame";
import {
	analyticsModelsQueryOptions,
	analyticsQueryOptions,
} from "./panel-queries";
import { PanelEmpty, PanelNotice, PanelSkeleton } from "./panel-states";
import { ChartFrame } from "./primitives/chart-frame";
import { type Column, DataTable } from "./primitives/data-table";
import { ProportionBar } from "./primitives/proportion-bar";
import { StatCard, StatGrid } from "./primitives/stat-card";
import { TablePager } from "./primitives/table-pager";

/**
 * `/analytics` as a panel: KPIs, one bar chart and two bounded tables.
 *
 * The panel is the *window view* — the aggregate and the day series are asked
 * for the same span, so the stat cards, the axis and the tables describe one
 * period rather than three. That is the whole reason `analytics-model.ts` owns
 * the window: a toolbar that says "7 days" beside a chart spanning twelve is
 * the defect the terminal's own screen had.
 *
 * One metric control for the whole panel, feeding the chart and both tables.
 * Two metric toggles on one screen is the defect the TUI avoided with a single
 * key, and it is why the chart's title names its series: the metric is not
 * carried by hue anywhere.
 */

export type AnalyticsPanelProps = {
	/** The selected window in days: 1 (Today), 7 or 30. */
	windowDays: number;
	metric: AnalyticsMetric;
	thisSessionOnly: boolean;
	/**
	 * Whether a conversation is in front of the user, and so whether the scope
	 * control may exist at all.
	 *
	 * The same rule the info panel's conversation section follows, for the same
	 * reason: `This session only` with no session paints a control whose label
	 * names nothing on screen, and the query already drops a falsy `sessionId` — so
	 * the check would change the query KEY and nothing else, which is the dead
	 * affordance the palette's own contract forbids. `thisSessionOnly` stays false
	 * in that state, so the scope reads `all sessions`, which is the honest answer
	 * and becomes information rather than redundancy once the panel is reachable
	 * with no conversation at all.
	 */
	canScopeToSession: boolean;
	data: AnalyticsData | null;
	loading: boolean;
	/** A refetch is in flight over data that is already on screen. */
	refreshing: boolean;
	/** The backend's own detail. Never synthesised here. */
	error: string | null;
	/**
	 * The By-model read's rows, from its OWN op and its own query.
	 *
	 * `null` is "no answer yet" and `[]` is "an answer with no rows", which are
	 * different facts the section renders differently; the two are separate
	 * props rather than one nullable-with-a-length because a caller that
	 * confused them would show an empty state for a read still in flight.
	 */
	models: DesktopModelRate[] | null;
	/** The By-model read is in flight. Its own flag: it does not gate the pane. */
	modelsLoading: boolean;
	/** The By-model read's failure. Its own sentence, or `null`. */
	modelsError: string | null;
	/** The clock the window is derived from. Fixed in stories, so a frame is reproducible. */
	now: Date;
	/**
	 * When the read behind `data` finished, for the Totals line's `as of`.
	 *
	 * Taken from the query's own `dataUpdatedAt` rather than a render-time clock:
	 * the panel states when it READ, not when it drew. Null when nothing has been
	 * read, and the clause is then absent rather than unknown (design round 1,
	 * D6 — these panels no longer refresh themselves, so the age of what is on
	 * screen has to be stated rather than inferred).
	 */
	readAt: number | null;
	onWindowChange: (days: number) => void;
	onMetricChange: (metric: AnalyticsMetric) => void;
	onThisSessionChange: (thisSessionOnly: boolean) => void;
	onClose: () => void;
};

/**
 * One dim line under a table: its measures' own footnote.
 *
 * A visible line rather than a `title` attribute (review round 1, D4): the
 * explanation has to survive a frame, a screenshot, a screen reader and a
 * keyboard, and a tooltip survives none of the four. It sits with the table it
 * explains because it is the table's own measure, and the cache half is folded
 * into the table's accessible name too (`DataTable`'s `label`), so a reader who
 * arrives at the table by navigation hears it rather than only seeing it.
 *
 * ONE component for every legend on this panel rather than one per sentence,
 * for the reason `formatters.ts` exists: the two lines are the same visual
 * object and two spellings of its type would drift apart on the first edit.
 */
const Legend = ({ text }: { text: string }) => (
	<p className={cn("pt-1 text-balance text-ink-dim text-meta")}>{text}</p>
);

const CacheHitLegend = () => <Legend text={CACHE_HIT_MEANING} />;

/**
 * The rate column's footnote, or nothing.
 *
 * `rateLegend` returns `null` when the column covers every call in scope, and
 * the panel then draws no line: an "all N of N calls" sentence is noise, and
 * this panel already refuses that shape (`sessionMatchLine`). The two states it
 * DOES speak in are the ones a reader can be misled by — partial coverage, and
 * no coverage at all, where every cell in the column is `—` and the line says
 * why rather than leaving a column of dashes to be read as a broken panel.
 */
const RateLegend = ({ text }: { text: string | null }) =>
	text === null ? null : <Legend text={text} />;

const ProviderTable: FC<{ data: AnalyticsData; metric: AnalyticsMetric }> = ({
	data,
	metric,
}) => {
	const rows = providerRows(data.aggregate.by_provider, metric);
	const columns: Column<(typeof rows)[number]>[] = [
		{
			key: "provider",
			header: "Provider",
			cell: (row) => row.key,
		},
		{
			key: "calls",
			header: "Calls",
			numeric: true,
			cell: (row) => formatCount(row.calls),
		},
		{
			key: "tokens",
			header: "Tokens",
			numeric: true,
			cell: (row) => formatTokens(row.tokens),
		},
		/*
		 * The rate sits immediately after Tokens, which is where the terminal's
		 * own table puts it (`analytics_panel.py:2122`, design §9.1): the rate is
		 * a reading of the token count beside it, and a reader who has just read
		 * "1.2M" should not have to cross the Cost column to find out how fast.
		 *
		 * Not sortable HERE because no column in this table is — its rows are the
		 * providers that answered, in the order the selected metric ranks them,
		 * and the primitive's `sortable: false` default is what says so. The
		 * by-session table's identical column IS sortable, because that table has
		 * a header sort contract and this one does not.
		 */
		{
			key: "rate",
			header: TOK_PER_SECOND_LABEL,
			numeric: true,
			cell: (row) => formatTokensPerSecond(row.decodeRate),
		},
		{
			key: "cost",
			header: "Cost",
			numeric: true,
			cell: (row) => row.cost,
		},
		/*
		 * The last column, like the terminal's own row suffix
		 * (`analytics_panel.py:1856`), and read from the row's OWN aggregate: the
		 * section meta already says the totals here include subagents, so a rate
		 * taken from the panel's headline aggregate would be a different claim
		 * about the same row.
		 *
		 * The header names the measure (`CACHE_HIT_LABEL`, the same name the totals
		 * tile uses) and the legend under the table states the denominator and what
		 * `—` means: a `title` attribute alone reached no keyboard or touch reader
		 * and appeared in no frame (review round 1, D4).
		 */
		{
			key: "cache",
			header: CACHE_HIT_LABEL,
			numeric: true,
			cell: (row) => percentageOf(row.cacheHit),
		},
	];
	return (
		<>
			<DataTable<(typeof rows)[number]>
				label={`Usage by provider in this window. ${CACHE_HIT_MEANING}`}
				columns={columns}
				rows={rows}
				rowKey={(row) => row.key}
				leading={(row) => (
					<ProportionBar
						fraction={row.fraction}
						className="w-24"
						srLabel={`${row.key}: ${percentageOf(row.fraction)} of ${METRIC_LABEL[metric].toLowerCase()} in this window`}
					/>
				)}
				empty={<PanelEmpty text="No per-provider rows in this window." />}
			/>
			<CacheHitLegend />
			{/*
			 * The window's own coverage, from the panel's headline aggregate —
			 * `by_provider` is a partition of it, so the counts are the same fact
			 * either way, and taking them from the headline keeps this line and
			 * the by-session line below reading one number.
			 */}
			<RateLegend text={rateLegend(decodeCoverage(data.aggregate))} />
		</>
	);
};

/**
 * The By-session section: a control strip, one page of rows, and the pager.
 *
 * It is the CONTROLLER of this table, and the state it drives is the panel's
 * (`useSessionTableState`), not its own: the reset rule (§4.3) needs the window,
 * the metric and the scope, which are `AnalyticsPanel`'s props. Keeping the
 * state here would force that rule to watch values threaded through two
 * components; putting it in the adapter would put presentational state where
 * the query is decided.
 *
 * The work is five memos, each keyed on what it actually depends on, so that a
 * page turn does not re-sort and a refetch does not re-narrow: the index (labels,
 * the metric's value per row and the window total) on the payload plus `metric`,
 * the narrowing on `[index, query, filters]`, the order on the effective key and
 * direction, the slice on `[ordered, page]`, and the enriched page on the slice.
 * The failure mode of a wrong key is SILENT — the table stays correct and merely
 * slower, and no gate notices — which is why the keys are each named against
 * their inputs in `analytics-session-state.ts`, why §9.1 of the design carries
 * the same table, and why the in-app budget (§9) is measured rather than inferred
 * from a green suite.
 */
const SessionTable: FC<{
	data: AnalyticsData;
	metric: AnalyticsMetric;
	state: SessionTableState;
	dispatch: Dispatch<SessionTableAction>;
}> = ({ data, metric, state, dispatch }) => {
	const names = data.session_names;
	const parents = data.session_parents;
	const bySession = data.aggregate.by_session;
	/*
	 * `metric` is a dependency of the index, and §9.1 of the design says so: the
	 * index holds each row's `value` for the SELECTED metric, so a metric change
	 * that did not re-index would rank the new metric by the old metric's numbers.
	 */
	const index = useMemo(
		() => sessionIndex(bySession, names, parents, metric),
		[bySession, names, parents, metric],
	);
	const narrowed = useMemo(
		() => narrowSessionIndex(index, state.query, state.filters),
		[index, state.query, state.filters],
	);
	const sortKey = effectiveSortKey(state, metric);
	const sortDirection = effectiveSortDirection(state);
	const ordered = useMemo(
		() => sortSessionIndex(narrowed, sortKey, sortDirection),
		[narrowed, sortKey, sortDirection],
	);
	const slice = useMemo(
		() => sessionPage(ordered, state.page),
		[ordered, state.page],
	);
	const pageRows = useMemo(
		() => enrichSessionRows(slice.rows, { total: index.total, names, parents }),
		[slice, index.total, names, parents],
	);
	/*
	 * The pool the search ran over, needed only by the empty state's detail —
	 * "clear the search to see them" has to be true of what clearing it reveals.
	 * Computed on demand rather than as a fifth memo, so a keystroke that matched
	 * something never pays for a second walk.
	 */
	const emptyText = sessionEmptyText({
		total: index.rows.length,
		filtered:
			narrowed.length > 0
				? narrowed.length
				: narrowSessionIndex(index, "", state.filters).length,
		matched: narrowed.length,
		query: state.query,
		topLevelOnly: state.filters.topLevelOnly,
	});
	const matchLine = sessionMatchLine({
		matched: narrowed.length,
		total: index.rows.length,
		query: state.query,
		topLevelOnly: state.filters.topLevelOnly,
	});
	/*
	 * The sort the header RENDERS, and the way back.
	 *
	 * `key` is the EFFECTIVE key — the column the rows are in fact ordered by,
	 * which is `state.sort` when the reader has activated one and the panel's
	 * own metric column when they have not. `aria-sort` states the sort the
	 * table is IN, not how it got there, so a ranked table that announced
	 * "nothing is sorted" on every header would be describing a different table
	 * than the one on screen. The glyph and the ink step follow the same key for
	 * the same reason: the first state every reader meets is a ranked list, and
	 * the ranking column is the one that has to say so.
	 *
	 * `state.sort` staying `null` while the order follows the metric is what
	 * keeps a metric change re-ranking the table, so this is a change of what
	 * the header SAYS rather than of what the table does. Clicking the column
	 * that is already ranking it still sets an explicit sort, which is the
	 * reader taking ownership of an order they were being given.
	 *
	 * Hoisted out of the JSX rather than written inline: a block comment as the
	 * FIRST token of a JSX attribute's object literal is mis-lexed by both the
	 * TypeScript and the Biome parsers — the expression container is closed at the
	 * comment's end, so everything after it parses as if the attribute were
	 * finished — and the explanation belongs beside the object either way.
	 */
	const sortIntent = {
		key: sortKey,
		direction: sortDirection,
		onSort: (key: string) => {
			const nextKey = asSessionSortKey(key);
			if (nextKey === null) return;
			setChange("sort");
			dispatch({
				type: "sort",
				key: nextKey,
				/*
				 * The EFFECTIVE order, so a first press on the column that is ranking
				 * the table flips the way that column's own chevron says instead of
				 * re-deriving the order already on screen — which changed nothing
				 * visible while silently taking ownership of it (UX round 2, U5).
				 * This is the same pair the header renders, which is exactly why it
				 * is read here: the reducer does not know the metric.
				 */
				ranking: { key: sortKey, direction: sortDirection },
			});
		},
	};

	const [change, setChange] = useState<SessionTableChange | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const announcement = sessionAnnouncement(change, {
		query: state.query,
		matched: narrowed.length,
		page: slice.page,
		pageCount: slice.pageCount,
		sortKey,
		sortDirection,
		topLevelOnly: state.filters.topLevelOnly,
	});
	const onSearch = (query: string) => {
		setChange("search");
		dispatch({ type: "search", query });
	};
	const columns: Column<(typeof pageRows)[number]>[] = [
		{
			key: "session",
			header: "Session",
			sortable: true,
			cell: (row) => (
				<span
					style={{ paddingLeft: `${row.depth * 12}px` }}
					className={cn(
						"block max-w-72 truncate",
						row.unnamed && "font-mono text-mono-sm",
					)}
				>
					{row.label}
				</span>
			),
		},
		{
			key: "calls",
			header: "Calls",
			numeric: true,
			sortable: true,
			cell: (row) => formatCount(row.calls),
		},
		{
			key: "tokens",
			header: "Tokens",
			numeric: true,
			sortable: true,
			cell: (row) => formatTokens(row.tokens),
		},
		/*
		 * The same column, in the same position, as the By-provider table's —
		 * the two are meant to read as one table stacked twice (design §9.1),
		 * and the position is also the one the rate's own meaning asks for: a
		 * rate is a reading of the token count beside it.
		 *
		 * Sortable, unlike the By-provider copy, because every value column in
		 * THIS table is: a reader comparing two sessions on generation speed is
		 * asking a question, and an unsortable column would answer it by
		 * scrolling. The `rate` key partitions its unknowns to the end in both
		 * directions like Cost and Cache hit rate do — on a ledger written
		 * before the feature shipped EVERY row is unknown, and without that
		 * partition a descending sort would be ordering the table by nothing at
		 * all while looking like a ranking.
		 */
		{
			key: "rate",
			header: TOK_PER_SECOND_LABEL,
			numeric: true,
			sortable: true,
			cell: (row) => formatTokensPerSecond(row.decodeRate),
		},
		{
			key: "cost",
			header: "Cost",
			numeric: true,
			sortable: true,
			cell: (row) => row.cost,
		},
		/* Same column, same rule, one row per session (see `ProviderTable`). */
		{
			key: "cache",
			header: CACHE_HIT_LABEL,
			numeric: true,
			sortable: true,
			cell: (row) => percentageOf(row.cacheHit),
		},
	];
	return (
		<>
			{/*
			 * The strip is rendered while there is anything to narrow OR while
			 * something is already narrowing. The second half of that condition is a
			 * trap rather than tidiness: the window can empty under a live query or
			 * filter (Today's window with a query typed in the seven-day one), and a
			 * strip that vanished then would leave the reader with a narrowed,
			 * invisible state and no control to clear it.
			 *
			 * It lives in the BODY and not in `PanelSection`'s `action` slot: that
			 * slot has the right scope but the wrong geometry (a text field on a
			 * heading's baseline), and the host toolbar owns panel-wide controls —
			 * the By-provider table must not move when this search changes.
			 *
			 * TWO ROWS, and the split is the point (design round 1, D4). The controls
			 * sit on the first; the match line gets the second to itself at EVERY
			 * width. Inline it was one `gap-3` from the filter's own label with
			 * nothing between them — the same 12px the row uses BETWEEN controls — so
			 * at a glance the count read as the rest of that label, at 1140 as well as
			 * at 720. And at a narrow panel the same line wrapped onto a row of its
			 * own only once the query passed a length threshold, which moved the
			 * table, the legend and the pager down 30px WHILE the reader was typing.
			 * On its own row it cannot be read as that label at any width, and the
			 * strip's height is a function of the state rather than of how much has
			 * been typed.
			 */}
			{index.rows.length > 0 || isNarrowed(state) ? (
				<div className={cn("flex flex-col gap-2 pb-2")}>
					<div className={cn("flex flex-wrap items-center gap-3")}>
						<div className={cn("relative w-64")}>
							<Search
								className={cn(
									"-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-ink-dim",
								)}
								aria-hidden="true"
							/>
							<Input
								ref={searchRef}
								aria-label="Search sessions"
								placeholder="Search sessions"
								value={state.query}
								onChange={(event) => onSearch(event.target.value)}
								className={cn("pl-8", state.query ? "pr-9" : undefined)}
								autoComplete="off"
								spellCheck={false}
							/>
							{state.query ? (
								/*
								 * `clearSearch` rather than two statements, because the pairing is
								 * the whole contract: this control unmounts in the same commit that
								 * empties the query, and the browser drops focus to `<body>` when the
								 * focused element leaves the DOM rather than handing it to a
								 * sibling. The inset ring is the same one the sidebar's field needed
								 * for the same reason: `icon-sm`'s own 2px offset needs 3px of
								 * clearance inside a 1px-bordered field and there is only 2px.
								 */
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Clear search"
									className={cn(
										"-translate-y-1/2 absolute top-1/2 right-1 focus-visible:outline-offset-[-2px]!",
									)}
									onClick={() => {
										setChange("search");
										clearSearch(searchRef.current, (value) => {
											dispatch({ type: "search", query: value });
										});
									}}
								>
									<X aria-hidden="true" />
								</Button>
							) : null}
						</div>
						<PickerCheck
							checked={state.filters.topLevelOnly}
							onCheckedChange={(next) => {
								setChange("filter");
								dispatch({ type: "filter", topLevelOnly: next });
							}}
							tone="muted"
						>
							Top-level only
						</PickerCheck>
					</div>
					{matchLine && !emptyText ? (
						<p className={cn("text-ink-dim text-meta")}>{matchLine}</p>
					) : null}
				</div>
			) : null}
			{emptyText ? (
				/*
				 * Nothing to show and something to explain. No table, no legend and no
				 * pager: a pager over an empty set is four disabled controls and a
				 * `0–0 of 0 sessions` line, which is noise where the notice is the
				 * answer. The strip stays, so the narrowing can be undone from here.
				 */
				<PanelNotice
					kind="empty"
					text={emptyText.text}
					detail={emptyText.detail}
				/>
			) : (
				<>
					<DataTable<(typeof pageRows)[number]>
						label={`Usage by session in this window. ${CACHE_HIT_MEANING}`}
						columns={columns}
						rows={pageRows}
						rowKey={(row) => row.id}
						sort={sortIntent}
						leading={(row) => (
							<ProportionBar
								fraction={row.fraction}
								className="w-24"
								srLabel={`${row.label}: ${percentageOf(row.fraction)} of ${METRIC_LABEL[metric].toLowerCase()} in this window`}
							/>
						)}
						empty={<PanelEmpty text="No per-session rows in this window." />}
					/>
					<CacheHitLegend />
					<RateLegend text={rateLegend(decodeCoverage(data.aggregate))} />
					{/*
					 * The pager replaces the `+N more not shown` line this section used
					 * to end with. That line was a disclosure that the table was a
					 * summary; it is gone because the rows behind it are now reachable,
					 * and `1–20 of 4,550 sessions` beside a working Next is the same fact
					 * stated as something the reader can act on.
					 *
					 * Absent only when the window has no sessions at all, where the
					 * section's behaviour is what it was before this change: the table's
					 * own empty state above, and no controls counting nothing.
					 */}
					{index.rows.length > 0 ? (
						<TablePager
							page={slice.page}
							pageCount={slice.pageCount}
							from={slice.from}
							to={slice.to}
							total={slice.total}
							label="session"
							onPage={(page) => {
								setChange("page");
								dispatch({ type: "page", page });
							}}
						/>
					) : null}
				</>
			)}
			{/*
			 * ONE polite live region for the section, and it is `sr-only` on purpose:
			 * the visible match line and the pager's counts are the same facts in a
			 * form a reader can look at, and a live region that repeated them on
			 * every keystroke would be noise on top of the screen they are already
			 * on. `<output>` rather than a `div role="status"` because that is the
			 * element this tree already uses for an announcement.
			 */}
			<output className={cn("sr-only")} aria-live="polite">
				{announcement}
			</output>
		</>
	);
};

/**
 * The By-model section: the one table on this panel that reads the RAW LEDGER.
 *
 * It is a separate read for a reason a reader can see on screen rather than a
 * reason about modules — the rows cover the operator's whole existing history
 * (the wall `tok/s` column has a value on a ledger written before this feature
 * existed), and the price of that coverage is a grouped scan that takes SECONDS
 * on a large ledger. So the section owns its own three states and the rest of
 * the pane never waits on it: the stat cards, the chart and both aggregate
 * tables render from `analytics.get` the moment it answers, and this one
 * arrives under a skeleton of its own.
 *
 * **It does not claim to partition the Totals above it**, and three things say
 * so instead of one: the meta line names its source (`from the ledger`) where
 * the Totals read the rollup; the legend under the table names the source again
 * beside the coverage counts; and the bar's own accessible name says its share
 * is of output tokens read from the ledger rather than of the headline's token
 * total. What the two DO share is the window — both are windowed by the same
 * `since_ms`/`until_ms` bounds — so the largest row's share is still comparable
 * to the headline's output-token figure, which is the consistency the design
 * argues for and the most a table without a model dimension in the rollup can
 * honestly offer.
 *
 * **Ranked by output tokens, in both metric positions.** `DesktopModelRate`
 * carries no price — the grouped scan does not read `cost_micro` — so under
 * `Spend` there is no column here to rank by, and the section says what it is
 * ranked by rather than silently ignoring the toolbar's metric control.
 */
const ModelTable: FC<{
	rows: DesktopModelRate[] | null;
	loading: boolean;
	error: string | null;
}> = ({ rows, loading, error }) => {
	/*
	 * The failure REPLACES the section, per `panel-states.tsx`: `unavailable`
	 * takes the content and the meta with it, because "Last 30 days" beside a
	 * read that failed is a claim about a window nothing was read from.
	 */
	if (error) return <PanelNotice kind="unavailable" text={error} />;
	/*
	 * No answer yet — the slow read is in flight, or the query has not been
	 * handed a result. FIRST PAINT is a skeleton rather than a sentence, because
	 * the shape of what is coming is known and a skeleton says "here is where
	 * the content will be" (the same rule the panel's own first paint follows).
	 */
	if (loading || rows === null) return <PanelSkeleton shape="table" rows={4} />;
	/*
	 * An empty ANSWER, which is a different fact from both of the above: the
	 * read succeeded and the window has no calls against a model. `rows: []` is
	 * what the route sends, so this is reachable on a fresh install.
	 */
	if (rows.length === 0) {
		return (
			<PanelNotice
				kind="empty"
				text="No per-model rows in this window."
				detail="The ledger records a model on every provider call, so this window has none."
			/>
		);
	}
	const tableRows = modelRows(rows);
	const coverage = modelCoverage(rows);
	const columns: Column<ModelRow>[] = [
		{
			key: "model",
			header: "Model",
			cell: (row) => row.label,
		},
		{
			key: "calls",
			header: "Calls",
			numeric: true,
			cell: (row) => formatCount(row.calls),
		},
		{
			key: "tokens",
			header: "Tokens",
			numeric: true,
			/*
			 * `output_tokens`, not the input+output total the other tables
			 * print: the grouped scan sums the output column only, so a total
			 * here would be a different quantity wearing the same header.
			 */
			cell: (row) => formatTokens(row.outputTokens),
		},
		{
			key: "rate",
			header: TOK_PER_SECOND_LABEL,
			numeric: true,
			cell: (row) => formatTokensPerSecond(row.decodeRate),
		},
		/*
		 * The column that must never be read as decode speed — and the reason
		 * both headers carry their qualifier rather than one of them being
		 * called plain `tok/s`. It is `null` only when no call of the model has
		 * a recorded duration, which covers the operator's entire existing
		 * ledger today, so it is the column that has a number when the one
		 * beside it has none.
		 */
		{
			key: "wall",
			header: WALL_TOK_PER_SECOND_LABEL,
			numeric: true,
			cell: (row) => formatTokensPerSecond(row.wallRate),
		},
		/*
		 * How much of the row's calls the decode column actually speaks for.
		 * A RATE, and `0%` here is a measured zero rather than an unknown — the
		 * reverse of the column beside it, which is why the two are separate
		 * columns and why the legend states the counts in words as well.
		 */
		{
			key: "coverage",
			header: COVERAGE_LABEL,
			numeric: true,
			cell: (row) => percentageOf(row.decodeCoverage),
		},
	];
	return (
		<>
			<DataTable<ModelRow>
				label={`Generation rate by model, read from the usage ledger. ${modelRateLegend(coverage.decode, coverage.wall) ?? ""}`}
				columns={columns}
				rows={tableRows}
				rowKey={(row) => row.key}
				leading={(row) => (
					<ProportionBar
						fraction={row.fraction}
						className="w-24"
						srLabel={`${row.label}: ${percentageOf(row.fraction)} of the output tokens this ledger read recorded in this window`}
					/>
				)}
				empty={<PanelEmpty text="No per-model rows in this window." />}
			/>
			<RateLegend text={modelRateLegend(coverage.decode, coverage.wall)} />
		</>
	);
};

/**
 * The by-session table's state, owned by the panel and reset when the window
 * moves under it.
 *
 * The reset is a render-phase adjustment rather than an effect, and the reason
 * is a frame the reader would otherwise see: `useEffect` runs AFTER the commit,
 * so a `setPage(0)` there paints the new ranking at the old page once — "page 3
 * of a set that no longer has a page 3" — and pays for a second rank pass on a
 * frame nobody sees. Dispatching here, before React commits, applies the reset
 * in the same pass that received the new props.
 *
 * The reset is a REDUCER action rather than a `setState` beside it so the
 * transition table (§4.3) has one definition the node suite can exercise, and
 * so the three triggers cannot drift apart: a fourth trigger added later is one
 * more term in the scope key rather than one more call site to remember. The
 * key itself is derived in the model (`sessionTableScopeKey`) for the same
 * reason — a term dropped from it in this file would be a term no test could
 * see.
 *
 * What is deliberately NOT here is any watch on the DATA. A refetch, a new
 * payload object and the `refreshing` flag all arrive as new props to this
 * section and none of them reaches this function as a new key, which is the
 * whole of the rule that a refetch does not throw the reader off their page.
 */
function useSessionTableState(
	trigger: SessionTableScope,
): [SessionTableState, Dispatch<SessionTableAction>] {
	const [state, dispatch] = useReducer(
		sessionTableReducer,
		INITIAL_SESSION_TABLE_STATE,
	);
	const key = sessionTableScopeKey(trigger);
	if (state.scope !== key) dispatch({ type: "scope", key });
	return [state, dispatch];
}

export const AnalyticsPanel: FC<AnalyticsPanelProps> = ({
	windowDays,
	metric,
	thisSessionOnly,
	canScopeToSession,
	data,
	loading,
	refreshing,
	error,
	models,
	modelsLoading,
	modelsError,
	now,
	readAt,
	onWindowChange,
	onMetricChange,
	onThisSessionChange,
	onClose,
}) => {
	const win: AnalyticsWindow = analyticsWindow(windowDays, now);
	const aggregate = data?.aggregate;
	const rows = data ? chartSeries(data.daily, win, metric) : [];
	const scope = thisSessionOnly ? "this session" : "all sessions";
	const chartTitle = metric === "spend" ? "Daily spend" : "Daily tokens";
	const [sessionState, sessionDispatch] = useSessionTableState({
		metric,
		windowDays,
		thisSessionOnly,
	});
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			bodyLabel="Analytics region"
			title="Analytics"
			description="Model calls, tokens and known cost from the backend analytics ledger."
			toolbar={
				<div className={cn("flex flex-wrap items-center gap-4")}>
					<PickerSegment
						label="Window"
						value={String(windowDays)}
						onChange={(value) => onWindowChange(Number(value))}
						options={[
							{ value: "1", label: "Today" },
							{ value: "7", label: "7 days" },
							{ value: "30", label: "30 days" },
						]}
					/>
					<PickerSegment
						label="Metric"
						value={metric}
						onChange={(value) => onMetricChange(value as AnalyticsMetric)}
						options={[
							{ value: "tokens", label: "Tokens" },
							{ value: "spend", label: "Spend" },
						]}
					/>
					{canScopeToSession ? (
						<PickerCheck
							checked={thisSessionOnly}
							onCheckedChange={onThisSessionChange}
							tone="muted"
						>
							This session only
						</PickerCheck>
					) : null}
					{refreshing ? (
						<p className={cn("ml-auto text-ink-dim text-meta")}>Refreshing</p>
					) : null}
				</div>
			}
			body={
				loading ? (
					<PanelSkeleton shape="stats" />
				) : error || !aggregate ? (
					<PanelNotice
						kind="unavailable"
						text={error ?? "The backend returned no analytics."}
					/>
				) : aggregate.calls === 0 ? (
					/*
					 * An empty ANSWER, so the whole body is this and nothing else:
					 * a chart with no data invents an axis, and a table with no rows
					 * would restate the sentence in worse words.
					 */
					<PanelNotice
						kind="empty"
						text={
							windowDays === 1
								? "No calls recorded today."
								: `No calls recorded in the last ${windowDays} days.`
						}
						detail="Analytics accrue as sessions make provider calls."
					/>
				) : (
					<PanelStack>
						<PanelSection title="Totals" meta={windowMeta(win, scope, readAt)}>
							<StatGrid>
								<StatCard
									label="Requests"
									value={formatCount(aggregate.calls)}
									note={
										aggregate.ok_calls === aggregate.calls
											? undefined
											: `${formatCount(aggregate.calls - aggregate.ok_calls)} failed`
									}
								/>
								<StatCard
									label="Tokens"
									value={formatTokens(totalTokens(aggregate))}
									note={`${formatTokens(aggregate.context_tokens)} in · ${formatTokens(aggregate.output_tokens)} out`}
								/>
								<StatCard
									label="Cost"
									value={formatMicroUsd(
										aggregate.cost_micro,
										aggregate.cost_known_calls,
										aggregate.calls,
									)}
									note={
										aggregate.cost_known_calls === 0
											? "No call in this window has a published price"
											: aggregate.cost_known_calls < aggregate.calls
												? `${formatCount(aggregate.cost_known_calls)} of ${formatCount(aggregate.calls)} calls priced`
												: undefined
									}
									fraction={costKnownFraction(aggregate)}
								/>
								{/*
								 * The note names the DENOMINATOR, which is what the ratio is
								 * over: `840k read · 96k written` read as read/(read+written)
								 * and gave 90% where the tile says 44% (review round 1, D5b).
								 * The written count stays because it is a real fact about the
								 * window, just not the one the percentage is about.
								 */}
								<StatCard
									label={CACHE_HIT_LABEL}
									value={percentageOf(cacheReadFraction(aggregate))}
									note={`${formatTokens(aggregate.cache_read_tokens)} of ${formatTokens(aggregate.context_tokens)} context · ${formatTokens(aggregate.cache_write_tokens)} written`}
									fraction={cacheReadFraction(aggregate)}
								/>
							</StatGrid>
						</PanelSection>
						{/*
						 * The populated chart is NOT wrapped in a `PanelSection`: `ChartFrame`
						 * renders its own heading row, and a section around it would print the
						 * series name twice. The empty states keep a section, because a notice
						 * with no heading would leave the reader without the series it is about.
						 */}
						{metric === "spend" && aggregate.cost_known_calls === 0 ? (
							<PanelSection title={chartTitle}>
								<PanelNotice
									kind="empty"
									text="No priced calls in this window."
								/>
							</PanelSection>
						) : rows.length === 0 ? (
							<PanelSection title={chartTitle}>
								<PanelNotice
									kind="empty"
									text="No daily rows for this window."
									detail="The daily rollup only covers calls recorded since it began."
								/>
							</PanelSection>
						) : (
							<ChartFrame
								title={chartTitle}
								meta={dailyMeta(win, thisSessionOnly)}
								srSummary={chartSummary(rows, win, metric)}
								unit={metric === "spend" ? undefined : "tokens"}
								yAxisWidth={56}
								yTickFormatter={metric === "spend" ? spendTick : tokenTick}
							>
								<BarChart data={rows}>
									<Bar dataKey="value" name={chartTitle} />
								</BarChart>
							</ChartFrame>
						)}
						<PanelSection title="By provider">
							<ProviderTable data={data} metric={metric} />
						</PanelSection>
						{/*
						 * `from the ledger` is in the meta and not only in the legend,
						 * because the meta is what a reader sees BEFORE deciding whether
						 * this table and the Totals above it are one partition — and they
						 * are not. The by-session table, which stays below, shares the
						 * Totals' rollup source; this one does not.
						 *
						 * `ranked by output tokens` is the other half of the honesty: the
						 * toolbar's metric control orders the chart and the two aggregate
						 * tables, and this table has no price column to follow it with.
						 */}
						<PanelSection
							title="By model"
							meta={`${windowTitle(windowDays)} · from the ledger · ranked by output tokens`}
						>
							<ModelTable
								rows={models}
								loading={modelsLoading}
								error={modelsError}
							/>
						</PanelSection>
						<PanelSection
							title="By session"
							meta="Own figures per session · totals include subagents"
						>
							<SessionTable
								data={data}
								metric={metric}
								state={sessionState}
								dispatch={sessionDispatch}
							/>
						</PanelSection>
					</PanelStack>
				)
			}
		/>
	);
};

/** The adapter the registry mounts: owns the read and the presentation state. */
export const AnalyticsView: FC<MachinePanelContext> = ({
	sessionId,
	onClose,
}) => {
	const [windowDays, setWindowDays] = useState(7);
	const [metric, setMetric] = useState<AnalyticsMetric>("tokens");
	const [thisSessionOnly, setThisSessionOnly] = useState(false);
	/*
	 * One clock per open, not one per render: the window is derived from it, and
	 * a clock that moved would change the query key under the user mid-read.
	 */
	const [now] = useState(() => new Date());
	const win = analyticsWindow(windowDays, now);
	/*
	 * The panel's own window, computed once and handed to BOTH reads, so the
	 * table's rows and the headline are windowed by the same two numbers rather
	 * than by two derivations of one clock that could disagree near midnight.
	 */
	const scopeSession = thisSessionOnly ? sessionId : undefined;
	const query = useQuery(
		analyticsQueryOptions({
			days: windowDays,
			sessionId: scopeSession,
			sinceMs: win.sinceMs,
			untilMs: win.untilMs,
		}),
	);
	/*
	 * The per-model read runs BESIDE the panel's own, not behind it: it is a
	 * grouped scan of the raw ledger and takes seconds on a large ledger, so
	 * gating the stat cards, the chart or either aggregate table on it would put
	 * the slowest read on the panel's critical path for no gain. Its three
	 * states are handed to the By-model section, which is the only thing that
	 * waits.
	 *
	 * `query.dataUpdatedAt || null` has no counterpart here: the By-model
	 * section states its source and its window, not when it read, and a second
	 * `as of` on one screen would invite a reader to compare two clocks rather
	 * than two numbers.
	 */
	const modelsQuery = useQuery(
		analyticsModelsQueryOptions({
			days: windowDays,
			sessionId: scopeSession,
			sinceMs: win.sinceMs,
			untilMs: win.untilMs,
		}),
	);
	return (
		<AnalyticsPanel
			windowDays={windowDays}
			metric={metric}
			thisSessionOnly={thisSessionOnly}
			canScopeToSession={sessionId !== ""}
			data={query.data?.data ?? null}
			loading={query.isLoading}
			refreshing={query.isFetching && !query.isLoading}
			error={query.isError ? errorText(query.error) : null}
			models={modelsQuery.data?.data.rows ?? null}
			modelsLoading={modelsQuery.isLoading}
			modelsError={modelsQuery.isError ? errorText(modelsQuery.error) : null}
			now={now}
			readAt={query.dataUpdatedAt || null}
			onWindowChange={setWindowDays}
			onMetricChange={setMetric}
			onThisSessionChange={setThisSessionOnly}
			onClose={onClose}
		/>
	);
};
