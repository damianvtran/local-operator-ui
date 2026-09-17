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
import { clearSearch } from "../../clear-search";
import type { PickerContext } from "../destination-pickers";
import { PickerCheck, PickerHost, PickerSegment } from "../picker-host";
import { errorText } from "../use-picker-backend";
import {
	type AnalyticsData,
	type AnalyticsMetric,
	type AnalyticsWindow,
	CACHE_HIT_LABEL,
	CACHE_HIT_MEANING,
	METRIC_LABEL,
	analyticsWindow,
	cacheReadFraction,
	chartSeries,
	chartSummary,
	costKnownFraction,
	dailyMeta,
	percentageOf,
	providerRows,
	spendTick,
	tokenTick,
	totalTokens,
	windowMeta,
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
import { formatCount, formatMicroUsd, formatTokens } from "./formatters";
import { PanelSection, PanelStack } from "./panel-frame";
import { analyticsQueryOptions } from "./panel-queries";
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
	data: AnalyticsData | null;
	loading: boolean;
	/** A refetch is in flight over data that is already on screen. */
	refreshing: boolean;
	/** The backend's own detail. Never synthesised here. */
	error: string | null;
	/** The clock the window is derived from. Fixed in stories, so a frame is reproducible. */
	now: Date;
	onWindowChange: (days: number) => void;
	onMetricChange: (metric: AnalyticsMetric) => void;
	onThisSessionChange: (thisSessionOnly: boolean) => void;
	onClose: () => void;
};

/**
 * The one sentence that says what the cache rate is, under both tables.
 *
 * A visible line rather than a `title` attribute (review round 1, D4): the
 * explanation has to survive a frame, a screenshot, a screen reader and a
 * keyboard, and a tooltip survives none of the four. It sits with the table it
 * explains because it is the table's own measure, and it is folded into the
 * table's accessible name too (`DataTable`'s `label`), so a reader who arrives at
 * the table by navigation hears it rather than only seeing it.
 */
const CacheHitLegend = () => (
	<p className={cn("pt-1 text-balance text-ink-dim text-meta")}>
		{CACHE_HIT_MEANING}
	</p>
);

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
	data,
	loading,
	refreshing,
	error,
	now,
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
					<PickerCheck
						checked={thisSessionOnly}
						onCheckedChange={onThisSessionChange}
						tone="muted"
					>
						This session only
					</PickerCheck>
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
						<PanelSection title="Totals" meta={windowMeta(win, scope)}>
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
export const AnalyticsView: FC<PickerContext> = ({ sessionId, onClose }) => {
	const [windowDays, setWindowDays] = useState(7);
	const [metric, setMetric] = useState<AnalyticsMetric>("tokens");
	const [thisSessionOnly, setThisSessionOnly] = useState(false);
	/*
	 * One clock per open, not one per render: the window is derived from it, and
	 * a clock that moved would change the query key under the user mid-read.
	 */
	const [now] = useState(() => new Date());
	const win = analyticsWindow(windowDays, now);
	const query = useQuery(
		analyticsQueryOptions({
			days: windowDays,
			sessionId: thisSessionOnly ? sessionId : undefined,
			sinceMs: win.sinceMs,
			untilMs: win.untilMs,
		}),
	);
	return (
		<AnalyticsPanel
			windowDays={windowDays}
			metric={metric}
			thisSessionOnly={thisSessionOnly}
			data={query.data?.data ?? null}
			loading={query.isLoading}
			refreshing={query.isFetching && !query.isLoading}
			error={query.isError ? errorText(query.error) : null}
			now={now}
			onWindowChange={setWindowDays}
			onMetricChange={setMetric}
			onThisSessionChange={setThisSessionOnly}
			onClose={onClose}
		/>
	);
};
