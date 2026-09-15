import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { type FC, useState } from "react";
import { Bar, BarChart } from "recharts";
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
	sessionRows,
	spendTick,
	tokenTick,
	totalTokens,
	windowMeta,
} from "./analytics-model";
import { formatCount, formatMicroUsd, formatTokens } from "./formatters";
import { PanelSection, PanelStack } from "./panel-frame";
import { analyticsQueryOptions } from "./panel-queries";
import { PanelEmpty, PanelNotice, PanelSkeleton } from "./panel-states";
import { ChartFrame } from "./primitives/chart-frame";
import { type Column, DataTable, MoreRowsLine } from "./primitives/data-table";
import { ProportionBar } from "./primitives/proportion-bar";
import { StatCard, StatGrid } from "./primitives/stat-card";

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

const SessionTable: FC<{ data: AnalyticsData; metric: AnalyticsMetric }> = ({
	data,
	metric,
}) => {
	const { rows, hidden } = sessionRows(
		data.aggregate.by_session,
		data.session_names,
		data.session_parents,
		metric,
	);
	const columns: Column<(typeof rows)[number]>[] = [
		{
			key: "session",
			header: "Session",
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
		/* Same column, same rule, one row per session (see `ProviderTable`). */
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
				label={`Usage by session in this window. ${CACHE_HIT_MEANING}`}
				columns={columns}
				rows={rows}
				rowKey={(row) => row.id}
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
			{hidden > 0 ? <MoreRowsLine count={hidden} /> : null}
		</>
	);
};

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
							<SessionTable data={data} metric={metric} />
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
