import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Badge } from "@shared/components/ui/badge";
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
	spendBasisLegend,
	spendBasisTitle,
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
	useI18nLocale();
	const columns: Column<BarRow>[] = [
		{ key: "row", header: firstHeader, cell: (row) => row.label },
	];
	if (withCalls) {
		columns.push({
			key: "calls",
			header: t("ui.chat.pickers.session_panel.calls"),
			numeric: true,
			cell: (row) => formatCount(row.calls),
		});
	}
	if (metric === "cost" && rows.some((row) => row.basis !== undefined)) {
		columns.push({
			key: "basis",
			header: t("ui.chat.pickers.session_panel.basis"),
			cell: (row) => row.basis ?? "—",
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
					srLabel={t("ui.chat.pickers.session_panel.of_this_session_s", {
						label: row.label,
						formatpercent: formatPercent(row.fraction),
						value: SESSION_METRIC_LABEL[metric].toLowerCase(),
					})}
				/>
			)}
		/>
	);
};

const OUTCOME_BADGE: Record<
	"ok" | "failed" | "unknown",
	{ variant: "neutral" | "danger"; label: string; className?: string }
> = {
	get ok() {
		return {
			variant: "neutral" as const,
			label: t("ui.chat.pickers.session_panel.ok"),
		};
	},
	get failed() {
		return {
			variant: "danger" as const,
			label: t("ui.chat.pickers.session_panel.failed"),
		};
	},
	/*
	 * Dim, not warning: an older ledger reports every row as unknown, and
	 * deriving failure from the `outcome` LABEL painted an entire healthy
	 * session in warning. `ok` is the only field that decides this.
	 */
	get unknown() {
		return {
			variant: "neutral" as const,
			label: t("ui.chat.pickers.session_panel.unknown"),
			className: "text-ink-dim",
		};
	},
};

const ToolCallsSection: FC<{ report: DesktopSessionReport }> = ({ report }) => {
	useI18nLocale();
	const stats = report.tool_calls;
	if (!stats) {
		// `null` is "not measured" — a session predating tool-call recording —
		// which is the opposite of a zeroed counter, so it never renders a rate.
		return (
			<PanelNotice
				kind="empty"
				text={t("ui.chat.pickers.session_panel.not_measured_for_this_session")}
			/>
		);
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
					label={t("ui.chat.pickers.session_panel.tool_call_validity")}
					value={formatPercent(rates.validity)}
					note={t("ui.chat.pickers.session_panel.emitted_excluded", {
						formatcount: formatCount(rates.emitted),
						formatcount2: formatCount(rates.excluded),
					})}
					fraction={rates.validity}
				/>
				<StatCard
					label={t("ui.chat.pickers.session_panel.execution_error_rate")}
					value={formatPercent(rates.executionErrorRate)}
					note={t("ui.chat.pickers.session_panel.dispatched", {
						formatcount: formatCount(rates.emitted - rates.modelFaults),
					})}
					fraction={rates.executionErrorRate}
				/>
			</StatGrid>
			{faults.length === 0 ? (
				<PanelNotice
					kind="empty"
					text={t("ui.chat.pickers.session_panel.no_tool_call_faults_recorded")}
				/>
			) : (
				<DataTable<{ key: string; count: number }>
					label={t("ui.chat.pickers.session_panel.tool_call_faults_by_name")}
					columns={[
						{
							key: "fault",
							header: t("ui.chat.pickers.session_panel.fault"),
							cell: (row) => row.key,
						},
						{
							key: "count",
							header: t("ui.chat.pickers.session_panel.calls"),
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
					{t("ui.chat.pickers.session_panel.nested_calls")}{" "}
					{formatCount(stats.nested_total)} ({formatCount(stats.nested_ok)}{" "}
					{t(
						"ui.chat.pickers.session_panel.ok_they_are_a_different_population_and_are_counted_in_neither_rate_above",
					)}
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
	useI18nLocale();
	const title =
		frontend?.conversation_title ||
		t("ui.chat.pickers.session_panel.untitled_session");
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
		: {
				first: t("ui.chat.pickers.session_panel.unknown_value"),
				last: t("ui.chat.pickers.session_panel.unknown_value"),
			};
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
			bodyLabel={t("ui.chat.pickers.session_panel.session_diagnostics_region")}
			title={t("ui.chat.pickers.session_panel.session")}
			description={t(
				"ui.chat.pickers.session_panel.what_this_session_has_used_from_one_read_of_the_local_ledger",
			)}
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
							label={t("ui.chat.pickers.session_panel.metric")}
							value={metric}
							onChange={(value) => onMetricChange(value as SessionMetric)}
							options={[
								{
									value: "tokens",
									label: t("ui.chat.pickers.session_panel.tokens"),
								},
								{
									value: "cost",
									label: t("ui.chat.pickers.session_panel.cost"),
								},
							]}
						/>
					</div>
				) : undefined
			}
			body={
				gated ? (
					<PanelNotice
						kind="unavailable"
						text={t(
							"ui.chat.pickers.session_panel.this_backend_cannot_serve_this_panel_yet_update_the_backend_and_try_agai",
						)}
					/>
				) : loading ? (
					<PanelSkeleton shape="stats" />
				) : error ? (
					<PanelNotice kind="unavailable" text={error} />
				) : !report ? (
					<PanelNotice
						kind="unavailable"
						text={t(
							"ui.chat.pickers.session_panel.the_backend_returned_no_report",
						)}
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
						text={t(
							"ui.chat.pickers.session_panel.could_not_read_local_usage_records_close_and_reopen_to_try_again",
						)}
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
							<PanelSection
								title={t("ui.chat.pickers.session_panel.totals")}
								meta={totalsMeta(report)}
							>
								<StatGrid>
									<StatCard
										label={t("ui.chat.pickers.session_panel.requests")}
										value={formatCount(aggregate.calls)}
										note={
											aggregate.ok_calls === aggregate.calls
												? undefined
												: t("ui.chat.pickers.session_panel.failed4d8830", {
														formatcount: formatCount(
															aggregate.calls - aggregate.ok_calls,
														),
													})
										}
									/>
									<StatCard
										label={t("ui.chat.pickers.session_panel.cost")}
										value={costValue(report)}
										note={costNote(report)}
									/>
									<StatCard
										label={t("ui.chat.pickers.session_panel.tokens")}
										value={formatTokens(totalTokens(aggregate))}
										note={t("ui.chat.pickers.session_panel.in_out", {
											formattokens: formatTokens(aggregate.context_tokens),
											formattokens2: formatTokens(aggregate.output_tokens),
										})}
									/>
									<StatCard
										label={t("ui.chat.pickers.session_panel.cache_hit_rate")}
										value={formatPercent(cacheHitRate(aggregate))}
										note={t(
											"ui.chat.pickers.session_panel.of_context_from_cache",
										)}
										fraction={cacheHitRate(aggregate)}
									/>
								</StatGrid>
								{spendBasisLegend(report) && (
									<p className="mt-2 text-meta text-ink-muted">
										{spendBasisTitle(report)}: {spendBasisLegend(report)}
									</p>
								)}
							</PanelSection>
						) : (
							<PanelNotice
								kind="empty"
								text={t(
									"ui.chat.pickers.session_panel.no_recorded_requests_for_this_session_yet",
								)}
							/>
						)}
						<PanelSection
							title={t("ui.chat.pickers.session_panel.context_window")}
							meta={t("ui.chat.pickers.session_panel.live_not_from_the_ledger")}
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
											? t(
													"ui.chat.pickers.session_panel.context_window_not_measured",
												)
											: t("ui.chat.pickers.session_panel.context_window_of", {
													formatcontexttokens: formatContextTokens(
														contextTokens ?? 0,
													),
													formatwindow: formatWindow(contextWindow ?? 0),
													formatpercent: formatPercent(measured),
												})
									}
								/>
								<p
									className={cn(
										"ms-auto shrink-0 font-mono text-body-sm tabular-nums",
										measured === null ? "text-ink-dim" : "text-ink",
									)}
								>
									{measured === null
										? t("ui.chat.pickers.session_panel.not_measured")
										: `${formatContextTokens(contextTokens ?? 0)} / ${formatWindow(contextWindow ?? 0)} (${formatPercent(measured)})`}
									{frontend?.context_is_estimate === true ? (
										<span className={cn("text-ink-muted")}>
											{" "}
											{t("ui.chat.pickers.session_panel.estimate")}
										</span>
									) : null}
								</p>
							</div>
						</PanelSection>
						{showSections && report ? (
							<>
								<PanelSection
									title={t("ui.chat.pickers.session_panel.by_model")}
								>
									<BarTable
										label={t(
											"ui.chat.pickers.session_panel.usage_by_model_in_this_session",
										)}
										firstHeader={t("ui.chat.pickers.session_panel.model")}
										rows={modelRows(report, metric)}
										withCalls
										empty={t(
											"ui.chat.pickers.session_panel.no_model_rows_recorded_for_this_session",
										)}
										metric={metric}
									/>
								</PanelSection>
								<PanelSection
									title={t("ui.chat.pickers.session_panel.by_purpose")}
								>
									{shapeProblem ? (
										<PanelNotice kind="unavailable" text={shapeProblem} />
									) : (
										<BarTable
											label={t(
												"ui.chat.pickers.session_panel.usage_by_purpose_in_this_session",
											)}
											firstHeader={t("ui.chat.pickers.session_panel.purpose")}
											rows={purposeRows(report, metric)}
											withCalls
											empty={t(
												"ui.chat.pickers.session_panel.no_purpose_rows_recorded_for_this_session",
											)}
											metric={metric}
										/>
									)}
								</PanelSection>
								<PanelSection
									title={t("ui.chat.pickers.session_panel.where_input_went")}
									meta={t(
										"ui.chat.pickers.session_panel.estimated_split_of_context_tokens",
									)}
								>
									<BarTable
										label={t(
											"ui.chat.pickers.session_panel.estimated_context_split_by_component",
										)}
										firstHeader={t("ui.chat.pickers.session_panel.component")}
										rows={components.rows}
										withCalls={false}
										empty={t(
											"ui.chat.pickers.session_panel.no_component_split_recorded_for_this_session",
										)}
										metric="tokens"
									/>
								</PanelSection>
								<PanelSection
									title={t("ui.chat.pickers.session_panel.timings")}
								>
									<DataTable<ReturnType<typeof timingRows>[number]>
										label={t("ui.chat.pickers.session_panel.request_timings")}
										columns={[
											{
												key: "phase",
												header: t("ui.chat.pickers.session_panel.phase"),
												cell: (row) => row.label,
											},
											{
												key: "mean",
												header: t("ui.chat.pickers.session_panel.mean"),
												numeric: true,
												cell: (row) => row.mean,
											},
											{
												key: "range",
												header: t("ui.chat.pickers.session_panel.range"),
												numeric: true,
												cell: (row) => row.range,
											},
											{
												key: "samples",
												header: t("ui.chat.pickers.session_panel.samples"),
												numeric: true,
												cell: (row) => formatCount(row.samples),
											},
										]}
										rows={timingRows(report)}
										rowKey={(row) => row.key}
									/>
								</PanelSection>
								<PanelSection
									title={t("ui.chat.pickers.session_panel.tool_calls")}
								>
									<ToolCallsSection report={report} />
								</PanelSection>
								<PanelSection
									title={t("ui.chat.pickers.session_panel.recent_requests")}
									meta={t("ui.chat.pickers.session_panel.newest_first_shown", {
										formatcount: formatCount(report.recent.length),
									})}
								>
									<DataTable<ReturnType<typeof requestRows>[number]>
										label={t("ui.chat.pickers.session_panel.recent_requests")}
										columns={[
											{
												key: "purpose",
												header: t("ui.chat.pickers.session_panel.purpose"),
												cell: (row) => row.purpose,
											},
											{
												key: "model",
												header: t("ui.chat.pickers.session_panel.model"),
												cell: (row) => row.model,
											},
											{
												key: "context",
												header: t("ui.chat.pickers.session_panel.context"),
												numeric: true,
												cell: (row) => row.context,
											},
											{
												key: "output",
												header: t("ui.chat.pickers.session_panel.output"),
												numeric: true,
												cell: (row) => row.output,
											},
											{
												key: "duration",
												header: t("ui.chat.pickers.session_panel.duration"),
												numeric: true,
												cell: (row) => row.duration,
											},
											{
												key: "outcome",
												header: t("ui.chat.pickers.session_panel.outcome"),
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
												text={t(
													"ui.chat.pickers.session_panel.no_recent_requests_recorded_for_this_session",
												)}
											/>
										}
									/>
								</PanelSection>
								<PanelSection title={t("ui.chat.pickers.session_panel.scope")}>
									<Disclosure
										summary={t(
											"ui.chat.pickers.session_panel.ledger_coverage_for_this_session",
										)}
									>
										<p className={cn("text-body-sm text-ink-muted")}>
											{t("ui.chat.pickers.session_panel.records_run_from")}{" "}
											{span.first} {t("ui.chat.pickers.session_panel.to")}{" "}
											{span.last}
											{t(
												"ui.chat.pickers.session_panel.cost_and_tokens_above_cover_this_session",
											)}
											{hasDescendants(report)
												? t(
														"ui.chat.pickers.session_panel.plus_its_subagents_where_the_ledger_could_be_walked",
													)
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
