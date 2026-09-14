import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Badge } from "@shared/components/ui/badge";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { type FC, useState } from "react";
import type { DesktopSessionReport } from "../../../../../../shared/desktop-contract";
import type { PickerContext } from "../destination-pickers";
import { PickerHost, PickerSegment } from "../picker-host";
import { errorText } from "../use-picker-backend";
import {
	formatContextTokens,
	formatCount,
	formatPercent,
	formatTokens,
	formatWindow,
} from "./formatters";
import { PanelSection, PanelStack } from "./panel-frame";
import { sessionReportQueryOptions } from "./panel-queries";
import { PanelNotice, PanelSkeleton } from "./panel-states";
import { type Column, DataTable } from "./primitives/data-table";
import { ProportionBar } from "./primitives/proportion-bar";
import { StatCard, StatGrid } from "./primitives/stat-card";
import {
	type BarRow,
	SESSION_METRIC_LABEL,
	type SessionMetric,
	cacheHitRate,
	componentRows,
	costNote,
	costValue,
	faultRows,
	hasDescendants,
	modelRows,
	purposeRows,
	reportShapeProblem,
	requestRows,
	scopeSpan,
	timingRows,
	toolRates,
	totalTokens,
	totalsMeta,
} from "./session-report-model";

/**
 * `/session` as a panel: one session's diagnostics, from one ledger read.
 *
 * Everything below the identity block comes from `sessions.report`, which is a
 * single explicit read transaction. That property is the reason the panel does
 * not ask `analytics.get` a second time, and it is why section 2 says out loud
 * that it is the ONE section which is not from the ledger: the live context
 * gauge is runtime state, and a fresh session with an empty ledger still has a
 * true one — it is the one honest visual of a session that has spent nothing.
 *
 * The single metric control reaches the three proportional sections and nothing
 * else, because the panel must not show two metric toggles on one screen; the
 * component split is a token partition and says so in its own meta.
 */

export type SessionFrontend = {
	conversation_title: string;
	context_tokens: number | null;
	context_window: number | null;
	context_is_estimate: boolean | null;
};

export type SessionPanelProps = {
	report: DesktopSessionReport | null;
	loading: boolean;
	/** The backend's own detail. Never synthesised here. */
	error: string | null;
	/** `diagnostics < 1`: the op is never called and this is the whole body. */
	gated: boolean;
	frontend: SessionFrontend | null;
	sessionId: string;
	metric: SessionMetric;
	onMetricChange: (metric: SessionMetric) => void;
	onClose: () => void;
};

/** A proportional section: rows of bars, ranked by the selected metric. */
const BarTable: FC<{
	label: string;
	/**
	 * The first column's header: `Model`, `Purpose`, `Component`, `Tool`.
	 *
	 * "Row" said nothing about what the labels below it are, which the header
	 * row is the only place to say — the section heading names the grouping, not
	 * the column.
	 */
	firstHeader: string;
	rows: BarRow[];
	/** `Calls` is a column only where the rows are aggregates of calls. */
	withCalls: boolean;
	empty: string;
	metric: SessionMetric;
}> = ({ label, firstHeader, rows, withCalls, empty, metric }) => {
	const columns: Column<BarRow>[] = [
		{ key: "row", header: firstHeader, cell: (row) => row.label },
	];
	if (withCalls) {
		columns.push({
			key: "calls",
			header: "Calls",
			numeric: true,
			cell: (row) => formatCount(row.calls),
		});
	}
	columns.push({
		key: "value",
		header: SESSION_METRIC_LABEL[metric],
		numeric: true,
		cell: (row) => row.value,
	});
	if (rows.length === 0) return <PanelNotice kind="empty" text={empty} />;
	return (
		<DataTable<BarRow>
			label={label}
			columns={columns}
			rows={rows}
			rowKey={(row) => row.key}
			leading={(row) => (
				<ProportionBar
					fraction={row.fraction}
					className="w-24"
					srLabel={`${row.label}: ${formatPercent(row.fraction)} of this session's ${SESSION_METRIC_LABEL[
						metric
					].toLowerCase()}`}
				/>
			)}
		/>
	);
};

const OUTCOME_BADGE: Record<
	"ok" | "failed" | "unknown",
	{ variant: "neutral" | "danger"; label: string; className?: string }
> = {
	ok: { variant: "neutral", label: "ok" },
	failed: { variant: "danger", label: "failed" },
	/*
	 * Dim, not warning: an older ledger reports every row as unknown, and
	 * deriving failure from the `outcome` LABEL painted an entire healthy
	 * session in warning. `ok` is the only field that decides this.
	 */
	unknown: { variant: "neutral", label: "unknown", className: "text-ink-dim" },
};

const ToolCallsSection: FC<{ report: DesktopSessionReport }> = ({ report }) => {
	const stats = report.tool_calls;
	if (!stats) {
		// `null` is "not measured" — a session predating tool-call recording —
		// which is the opposite of a zeroed counter, so it never renders a rate.
		return <PanelNotice kind="empty" text="Not measured for this session." />;
	}
	const rates = toolRates(stats);
	const faults = faultRows(stats);
	return (
		<PanelStack>
			{/*
			 * Two rates, drawn as two cards rather than as neighbouring bars:
			 * they share no denominator, and a pair of bars would invite exactly
			 * the comparison that is not available. Each note names its own
			 * denominator, so neither figure has to be taken on faith.
			 */}
			<StatGrid>
				<StatCard
					label="Tool call validity"
					value={formatPercent(rates.validity)}
					note={`${formatCount(rates.emitted)} emitted · ${formatCount(rates.excluded)} excluded`}
					fraction={rates.validity}
				/>
				<StatCard
					label="Execution error rate"
					value={formatPercent(rates.executionErrorRate)}
					note={`${formatCount(rates.emitted - rates.modelFaults)} dispatched`}
					fraction={rates.executionErrorRate}
				/>
			</StatGrid>
			{faults.length === 0 ? (
				<PanelNotice kind="empty" text="No tool-call faults recorded." />
			) : (
				<DataTable<{ key: string; count: number }>
					label="Tool-call faults by name"
					columns={[
						{ key: "fault", header: "Fault", cell: (row) => row.key },
						{
							key: "count",
							header: "Calls",
							numeric: true,
							cell: (row) => formatCount(row.count),
						},
					]}
					rows={faults}
					rowKey={(row) => row.key}
				/>
			)}
			{stats.nested_total > 0 ? (
				<p className={cn("text-body-sm text-ink-muted")}>
					Nested calls: {formatCount(stats.nested_total)} (
					{formatCount(stats.nested_ok)} ok). They are a different population
					and are counted in neither rate above.
				</p>
			) : null}
		</PanelStack>
	);
};

export const SessionPanel: FC<SessionPanelProps> = ({
	report,
	loading,
	error,
	gated,
	frontend,
	sessionId,
	metric,
	onMetricChange,
	onClose,
}) => {
	const title = frontend?.conversation_title || "Untitled session";
	const aggregate = report?.aggregate;
	const contextTokens = frontend?.context_tokens ?? null;
	const contextWindow = frontend?.context_window ?? null;
	const measured =
		contextTokens !== null && contextWindow
			? contextTokens / contextWindow
			: null;
	const components = aggregate
		? componentRows(aggregate)
		: { rows: [] as BarRow[], total: 0 };
	const showSections = Boolean(
		report?.available && aggregate && aggregate.calls > 0,
	);
	const span = report
		? scopeSpan(report)
		: { first: "unknown", last: "unknown" };
	/*
	 * A shape the panel cannot draw. Section-scoped, not whole-body — § 8 makes
	 * `unavailable` replace the affected section's content, and § 6.2 reserves a
	 * whole-body state for `available === false` and the capability gate. On the
	 * payload this was found with, sections 1-3 and 5-9 parsed perfectly, so a
	 * body-level notice would have been one sentence where a panel of readable
	 * facts belongs: the error stays visible, it just stays where it belongs
	 * (review round 1, R3).
	 */
	const shapeProblem = report ? reportShapeProblem(report) : null;
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			title="Session"
			description="What this session has used, from one read of the local ledger."
			toolbar={
				showSections ? (
					/*
					 * Wrapped in a flex row for the reason `/analytics` wraps its own: the
					 * shell's toolbar slot is a block container, and `PickerSegment`'s root is
					 * a block-level `fieldset`, so a bare segment stretches to the dialog's
					 * full width and paints ~950px of empty `sunken` track beside its two
					 * pills — an empty well as a panel's first impression, in every state
					 * (design round 1, D3). The wrapper is local rather than a `w-fit` on the
					 * primitive: other surfaces pass a segment into a flex row that already
					 * sizes it, and a segment that cannot stretch would change them too.
					 */
					<div className={cn("flex flex-wrap items-center gap-4")}>
						<PickerSegment
							label="Metric"
							value={metric}
							onChange={(value) => onMetricChange(value as SessionMetric)}
							options={[
								{ value: "tokens", label: "Tokens" },
								{ value: "cost", label: "Cost" },
							]}
						/>
					</div>
				) : undefined
			}
			body={
				gated ? (
					<PanelNotice
						kind="unavailable"
						text="This backend cannot serve this panel yet. Update the backend and try again."
					/>
				) : loading ? (
					<PanelSkeleton shape="stats" />
				) : error ? (
					<PanelNotice kind="unavailable" text={error} />
				) : !report ? (
					<PanelNotice
						kind="unavailable"
						text="The backend returned no report."
					/>
				) : !report.available ? (
					/*
					 * No sections at all, including the live gauge: when the read
					 * failed we cannot say which of these numbers are trustworthy, and
					 * one lone bar under a failure heading invites the reader to trust
					 * the rest.
					 */
					<PanelNotice
						kind="unavailable"
						text="Could not read local usage records. Close and reopen to try again."
					/>
				) : (
					<PanelStack>
						<div className={cn("flex flex-col gap-0.5")}>
							<p className={cn("text-heading text-ink")}>{title}</p>
							<p className={cn("font-mono text-ink-dim text-meta")}>
								{sessionId}
							</p>
						</div>
						{showSections && aggregate && report ? (
							<PanelSection title="Totals" meta={totalsMeta(report)}>
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
										label="Cost"
										value={costValue(report)}
										note={costNote(report)}
									/>
									<StatCard
										label="Tokens"
										value={formatTokens(totalTokens(aggregate))}
										note={`${formatTokens(aggregate.context_tokens)} in · ${formatTokens(aggregate.output_tokens)} out`}
									/>
									<StatCard
										label="Cache hit rate"
										value={formatPercent(cacheHitRate(aggregate))}
										note="of context from cache"
										fraction={cacheHitRate(aggregate)}
									/>
								</StatGrid>
							</PanelSection>
						) : (
							<PanelNotice
								kind="empty"
								text="No recorded requests for this session yet."
							/>
						)}
						<PanelSection
							title="Context window"
							meta="live · not from the ledger"
						>
							<div className={cn("flex items-center gap-4")}>
								<ProportionBar
									fraction={measured}
									size="gauge"
									/*
									 * The gauge keeps its capped width — a bar the width of the panel
									 * would read as a progress bar for the whole report — and the number
									 * moves to the panel's own number edge, where every table value on
									 * this panel is right-aligned. Inline after the bar it was the one
									 * number sitting mid-row (design round 1, D9).
									 */
									className={cn("min-w-0 max-w-96 flex-1")}
									srLabel={
										measured === null
											? "Context window: not measured"
											: `Context window: ${formatContextTokens(contextTokens ?? 0)} of ${formatWindow(contextWindow ?? 0)}, ${formatPercent(measured)}`
									}
								/>
								<p
									className={cn(
										"ml-auto shrink-0 font-mono text-body-sm tabular-nums",
										measured === null ? "text-ink-dim" : "text-ink",
									)}
								>
									{measured === null
										? "not measured"
										: `${formatContextTokens(contextTokens ?? 0)} / ${formatWindow(contextWindow ?? 0)} (${formatPercent(measured)})`}
									{frontend?.context_is_estimate === true ? (
										<span className={cn("text-ink-muted")}> estimate</span>
									) : null}
								</p>
							</div>
						</PanelSection>
						{showSections && report ? (
							<>
								<PanelSection title="By model">
									<BarTable
										label="Usage by model in this session"
										firstHeader="Model"
										rows={modelRows(report, metric)}
										withCalls
										empty="No model rows recorded for this session."
										metric={metric}
									/>
								</PanelSection>
								<PanelSection title="By purpose">
									{shapeProblem ? (
										<PanelNotice kind="unavailable" text={shapeProblem} />
									) : (
										<BarTable
											label="Usage by purpose in this session"
											firstHeader="Purpose"
											rows={purposeRows(report, metric)}
											withCalls
											empty="No purpose rows recorded for this session."
											metric={metric}
										/>
									)}
								</PanelSection>
								<PanelSection
									title="Where input went"
									meta="≈ estimated split of context tokens"
								>
									<BarTable
										label="Estimated context split by component"
										firstHeader="Component"
										rows={components.rows}
										withCalls={false}
										empty="No component split recorded for this session."
										metric="tokens"
									/>
								</PanelSection>
								<PanelSection title="Timings">
									<DataTable<ReturnType<typeof timingRows>[number]>
										label="Request timings"
										columns={[
											{
												key: "phase",
												header: "Phase",
												cell: (row) => row.label,
											},
											{
												key: "mean",
												header: "Mean",
												numeric: true,
												cell: (row) => row.mean,
											},
											{
												key: "range",
												header: "Range",
												numeric: true,
												cell: (row) => row.range,
											},
											{
												key: "samples",
												header: "Samples",
												numeric: true,
												cell: (row) => formatCount(row.samples),
											},
										]}
										rows={timingRows(report)}
										rowKey={(row) => row.key}
									/>
								</PanelSection>
								<PanelSection title="Tool calls">
									<ToolCallsSection report={report} />
								</PanelSection>
								<PanelSection
									title="Recent requests"
									meta={`newest first · ${formatCount(report.recent.length)} shown`}
								>
									<DataTable<ReturnType<typeof requestRows>[number]>
										label="Recent requests"
										columns={[
											{
												key: "purpose",
												header: "Purpose",
												cell: (row) => row.purpose,
											},
											{
												key: "model",
												header: "Model",
												cell: (row) => row.model,
											},
											{
												key: "context",
												header: "Context",
												numeric: true,
												cell: (row) => row.context,
											},
											{
												key: "output",
												header: "Output",
												numeric: true,
												cell: (row) => row.output,
											},
											{
												key: "duration",
												header: "Duration",
												numeric: true,
												cell: (row) => row.duration,
											},
											{
												key: "outcome",
												header: "Outcome",
												cell: (row) => {
													const badge = OUTCOME_BADGE[row.state];
													return (
														<Badge
															variant={badge.variant}
															className={badge.className}
														>
															{badge.label}
														</Badge>
													);
												},
											},
										]}
										rows={requestRows(report)}
										rowKey={(row) => row.request_id}
										empty={
											<PanelNotice
												kind="empty"
												text="No recent requests recorded for this session."
											/>
										}
									/>
								</PanelSection>
								<PanelSection title="Scope">
									<Disclosure summary="Ledger coverage for this session">
										<p className={cn("text-body-sm text-ink-muted")}>
											Records run from {span.first} to {span.last}. Cost and
											tokens above cover this session
											{hasDescendants(report)
												? ", plus its subagents where the ledger could be walked"
												: ""}
											.
										</p>
									</Disclosure>
								</PanelSection>
							</>
						) : null}
					</PanelStack>
				)
			}
		/>
	);
};

/** The adapter the registry mounts: owns the read and the capability gate. */
export const SessionView: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const [metric, setMetric] = useState<SessionMetric>("tokens");
	const capabilities = useDesktopCapabilities();
	const gated = !desktopFeatureEnabled(capabilities.data, "diagnostics", 1);
	const query = useQuery({
		...sessionReportQueryOptions(sessionId),
		// The op does not exist on a backend without the capability, so it is
		// never called: a 404 rendered as "unavailable" would tell the user
		// something is broken rather than that something is older.
		enabled: !gated,
	});
	return (
		<SessionPanel
			report={query.data?.data ?? null}
			loading={!gated && query.isLoading}
			error={query.isError ? errorText(query.error) : null}
			gated={gated}
			frontend={canonical.frontend ?? null}
			sessionId={sessionId}
			metric={metric}
			onMetricChange={setMetric}
			onClose={onClose}
		/>
	);
};
