import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useTeamLabelFor } from "@shared/api/local-operator/profile-hooks";
import { Badge } from "@shared/components/ui/badge";
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { FC } from "react";
import type { DesktopInfoData } from "../../../../../../shared/desktop-contract";
import { PickerHost } from "../picker-host";
import type { MachinePanelContext } from "../picker-registry";
import { errorText } from "../use-picker-backend";
import { formatCount } from "./formatters";
import {
	type InfoFrontend,
	type InfoRow,
	REGISTRY_UNAVAILABLE_NOTICE,
	conversationRows,
	environmentRows,
	fleetFacts,
	hostRows,
	installFacts,
	installMeta,
	mcpSummary,
	sessionLineRows,
	terminalRows,
} from "./info-model";
import { PanelSection, PanelStack } from "./panel-frame";
import { infoQueryOptions } from "./panel-queries";
import { PanelNotice, PanelSkeleton } from "./panel-states";
import { type Column, DataTable } from "./primitives/data-table";
import { StatCard, StatGrid } from "./primitives/stat-card";

/**
 * `/info` as a panel.
 *
 * The install block comes first because both audiences open with it: a user
 * asking "what am I running" and a user asking "why is this one window
 * behaving differently" both start at the version.
 *
 * The panel is split by SOURCE, and that split is the design rather than an
 * implementation detail: sections 1-4 describe the machine the BACKEND runs on
 * (one read, and it can fail on its own), while sections 5 and 6 describe the
 * window in front of the user, from state the renderer already holds. So a
 * backend that cannot be reached leaves the live half standing — the panel
 * degrades section by section, never to a blank.
 */

export type InfoPanelProps = {
	data: DesktopInfoData | null;
	loading: boolean;
	/** The backend's own detail. Never synthesised here. */
	error: string | null;
	frontend: InfoFrontend | null;
	sessionId: string;
	onClose: () => void;
	/** Whole-body gate: the op is never called when false. */
	gated: boolean;
	/**
	 * The team's readable name for the Active row (round 1, R1-3b). An ARGUMENT
	 * and not a lookup here, because this component renders; the adapter that
	 * mounts it owns the catalogue read (`useTeamLabelFor`), and absent means
	 * the slug renders exactly as it always did.
	 */
	teamLabelFor?: (slug: string) => string;
};

/**
 * What a facts row's value cell shows, as the DECISION rather than as markup.
 *
 * Exported so a test can bind the choice the view actually makes: the empty
 * case here is not a rendering detail, it is the difference between "no
 * credentials are recorded" and "this row has nothing to say".
 *
 * `length > 0` rather than a bare truthiness check, and that is the whole
 * reason this is a function: an EMPTY array is TRUTHY, so `row.names` alone
 * took the names branch for a host with no stored credentials and rendered
 * `[].join(", ")` — a blank cell where the row's computed answer is `none`
 * (design round 3, D19).
 */
export const factValue = (
	row: InfoRow,
): { kind: "names" | "value"; text: string } =>
	row.names?.length
		? { kind: "names", text: row.names.join(", ") }
		: { kind: "value", text: row.value };

/** Two columns, label and value. The shape every facts table here shares. */
const FactsTable: FC<{ label: string; rows: InfoRow[] }> = ({
	label,
	rows,
}) => {
	useI18nLocale();
	if (rows.length === 0) {
		return (
			<PanelNotice
				kind="empty"
				text={t("ui.chat.pickers.info_panel.nothing_to_report_here")}
			/>
		);
	}
	const columns: Column<InfoRow>[] = [
		{
			key: "item",
			header: t("ui.chat.pickers.info_panel.item"),
			cell: (row) => (
				<span className={cn("text-ink-muted")}>
					{row.label}
					{row.note ? (
						<span className={cn("pl-2 text-ink-dim text-meta")}>
							{row.note}
						</span>
					) : null}
				</span>
			),
		},
		{
			key: "value",
			header: t("ui.chat.pickers.info_panel.value"),
			/* One decision, taken by `factValue` above; the cell only styles it. */
			cell: (row) => {
				const value = factValue(row);
				return value.kind === "names" ? (
					<span className={cn("font-mono text-ink-muted text-mono-sm")}>
						{value.text}
					</span>
				) : (
					<span
						className={cn(
							"break-all",
							row.mono ? "font-mono text-mono-sm" : "text-body-sm",
							row.tone === "warning" ? "text-warning" : "text-ink",
						)}
					>
						{value.text}
					</span>
				);
			},
		},
	];
	return (
		<DataTable<InfoRow>
			label={label}
			columns={columns}
			rows={rows}
			rowKey={(row) => row.key}
		/>
	);
};

const INSTALL_COLUMNS = (): Column<InfoRow>[] => [
	{
		key: "item",
		header: t("ui.chat.pickers.info_panel.path"),
		cell: (row) => <span className={cn("text-ink-muted")}>{row.label}</span>,
	},
	{
		key: "value",
		header: t("ui.chat.pickers.info_panel.value"),
		cell: (row) => (
			<span
				className={cn(
					"break-all font-mono text-mono-sm",
					row.tone === "warning" ? "text-warning" : "text-ink",
				)}
			>
				{row.value}
			</span>
		),
	},
];

/*
 * THE PERSON'S WORD, NOT THE TOKEN, for the one state whose token is a machine's.
 *
 * `live`, `stale` and `stored` read as words already; `wedged` does not — it is
 * the wire's own spelling (`live_state`), and this panel was the last place in
 * the product still showing it to a person while every other surface says "not
 * answering" (`info_panel.py` renders the same table and the same count that
 * way, and the CLI's STATE cell was moved off its token for exactly this
 * reason). The badge keeps its warning variant: the INK was already right, and
 * only the label was the machine's.
 *
 * The key stays the raw code, because it is the key: `row.state` is what the
 * backend published, and translating the key would mean translating every
 * lookup too.
 */
const STATE_BADGE: Record<
	string,
	{
		variant: "neutral" | "warning" | "danger";
		label: string;
		className?: string;
	}
> = {
	get live() {
		return {
			variant: "neutral" as const,
			label: t("ui.chat.pickers.info_panel.live"),
		};
	},
	get wedged() {
		return {
			variant: "warning" as const,
			label: t("ui.chat.pickers.info_panel.not_answering"),
		};
	},
	get stale() {
		return {
			variant: "neutral" as const,
			label: t("ui.chat.pickers.info_panel.stale"),
			className: "text-ink-dim",
		};
	},
	get stored() {
		return {
			variant: "neutral" as const,
			label: t("ui.chat.pickers.info_panel.stored"),
			className: "text-ink-dim",
		};
	},
};

const MARKER_BADGE: Record<
	"neutral" | "warning" | "dim",
	{ variant: "neutral" | "warning"; className?: string }
> = {
	neutral: { variant: "neutral" as const },
	warning: { variant: "warning" as const },
	dim: { variant: "neutral" as const, className: "text-ink-dim" },
};

export const InfoPanel: FC<InfoPanelProps> = ({
	data,
	loading,
	error,
	frontend,
	sessionId,
	onClose,
	gated,
	teamLabelFor,
}) => {
	useI18nLocale();
	const install = data ? installFacts(data.install) : null;
	const sessions = data?.sessions;
	/*
	 * `null` is the registry that could not be scanned: the fleet section then
	 * carries no meta and no numbers at all, only the notice section 3 shows.
	 */
	const fleet = data ? fleetFacts(data) : null;
	const mcp = mcpSummary(frontend);
	const sessionRows = sessions
		? sessionLineRows(sessions.lines, sessionId)
		: [];
	const sessionColumns: Column<(typeof sessionRows)[number]>[] = [
		{
			key: "name",
			header: t("ui.chat.pickers.info_panel.session"),
			cell: (row) => row.name,
		},
		{
			key: "state",
			header: t("ui.chat.pickers.info_panel.state"),
			cell: (row) => {
				const badge = STATE_BADGE[row.state] ?? STATE_BADGE.stale;
				return (
					<Badge variant={badge.variant} className={badge.className}>
						{badge.label}
					</Badge>
				);
			},
		},
		{
			key: "model",
			header: t("ui.chat.pickers.info_panel.model"),
			cell: (row) => row.model,
		},
		/*
		 * `Activity`, not `Uptime`: the cell carries an uptime for a running row
		 * and a last-active or stopped sentence for a stored one, and a header
		 * naming only the first mislabels the two thirds of the column that are
		 * not running (design round 1, D3). `State` would collide with the badge
		 * column beside it and `Last seen` would mislabel a live row's uptime.
		 */
		{
			key: "uptime",
			header: t("ui.chat.pickers.info_panel.activity"),
			cell: (row) => row.uptime,
		},
		{
			key: "memory",
			header: t("ui.chat.pickers.info_panel.memory"),
			numeric: true,
			cell: (row) => row.memory,
		},
		{
			key: "markers",
			header: t("ui.chat.pickers.info_panel.markers"),
			cell: (row) => (
				<span className={cn("flex flex-wrap gap-1")}>
					{row.markers.map((marker) => (
						<Badge
							key={marker.label}
							variant={MARKER_BADGE[marker.tone].variant}
							className={MARKER_BADGE[marker.tone].className}
						>
							{marker.label}
						</Badge>
					))}
				</span>
			),
		},
	];
	/**
	 * The host half's own state, which can fail independently of the live half.
	 *
	 * `shape` is the caller's, because the skeleton exists to stop first paint
	 * jumping and what is coming differs by section: a table for the facts
	 * sections, a 4-up grid for the sections that settle into one (design round 1,
	 * Q1 — the fleet section drew three wide table rows and then became four
	 * cards, which is the jump the shape is meant to prevent).
	 */
	const hostBody = (shape: "table" | "stats" = "table") =>
		error ? (
			<PanelNotice kind="unavailable" text={error} />
		) : loading || !data ? (
			<PanelSkeleton shape={shape} />
		) : null;
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			bodyLabel={t("ui.chat.pickers.info_panel.host_info_region")}
			title={t("ui.chat.pickers.info_panel.info")}
			description={
				/*
				 * The third clause is a promise about what is on screen, so a
				 * sessionless pane must not make it: with no conversation in front of
				 * the user there is none to name, and the panel's conversation section
				 * is absent for the same reason (§ 5.1). What replaced it is the
				 * section that does not need one — and it names that section in the
				 * section's own words ("Sessions on this machine"), because the rows
				 * under it are not only running sessions: a stored or detached row is
				 * listed there too, and "the sessions running on it" was a narrower
				 * claim than the heading the reader then sees (design round 1, D2).
				 */
				sessionId === ""
					? t(
							"ui.chat.pickers.info_panel.the_install_the_host_this_app_is_connected_to_and_the_sessions_on_this_m",
						)
					: t(
							"ui.chat.pickers.info_panel.the_install_the_host_this_app_is_connected_to_and_the_conversation_in_fr",
						)
			}
			body={
				gated ? (
					<PanelNotice
						kind="unavailable"
						text={t(
							"ui.chat.pickers.info_panel.this_backend_cannot_serve_this_panel_yet_update_the_backend_and_try_agai",
						)}
					/>
				) : (
					<PanelStack>
						<PanelSection
							title={t("ui.chat.pickers.info_panel.install")}
							meta={data ? installMeta(data.install) : undefined}
						>
							{hostBody() ?? (
								<>
									<StatGrid>
										<StatCard
											label={t("ui.chat.pickers.info_panel.version")}
											value={
												install?.version ??
												t("ui.chat.pickers.info_panel.unavailable")
											}
											note={install?.versionNote}
											tone={data?.install.behind ? "warning" : "neutral"}
										/>
										<StatCard
											label={t("ui.chat.pickers.info_panel.install_kind")}
											value={
												install?.kind ??
												t("ui.chat.pickers.info_panel.unavailable")
											}
										/>
										<StatCard
											label={t("ui.chat.pickers.info_panel.interpreter")}
											value={
												install?.interpreter ??
												t("ui.chat.pickers.info_panel.unavailable")
											}
										/>
									</StatGrid>
									{install?.updateBadge ? (
										<div className={cn("flex items-center gap-2 pt-3")}>
											<Badge variant="warning">{install.updateBadge}</Badge>
										</div>
									) : null}
									{/*
									 * `Install path` and `Running code` sit side by side because
									 * "which install claims to be executing" and "which code is
									 * executing" are only meaningful next to each other.
									 */}
									<div className={cn("pt-3")}>
										<DataTable<InfoRow>
											label={t(
												"ui.chat.pickers.info_panel.install_and_running_code_paths",
											)}
											columns={INSTALL_COLUMNS()}
											rows={[
												{
													key: "install_path",
													label: t("ui.chat.pickers.info_panel.install_path"),
													value:
														install?.installPath ??
														t("ui.chat.pickers.info_panel.unavailable"),
												},
												{
													key: "running_code",
													label: t("ui.chat.pickers.info_panel.running_code"),
													value:
														install?.runningCode ??
														t("ui.chat.pickers.info_panel.unavailable"),
													tone: install?.runningCodeShadowed
														? "warning"
														: "neutral",
													note: data?.install.is_git_snapshot
														? t("ui.chat.pickers.info_panel.git_snapshot", {
																value: data.install.source_ref || "",
															}).trim()
														: undefined,
												},
											]}
											rowKey={(row) => row.key}
										/>
									</div>
								</>
							)}
						</PanelSection>
						<PanelSection
							title={t("ui.chat.pickers.info_panel.host_runtime")}
							meta={t(
								"ui.chat.pickers.info_panel.the_machine_this_app_is_connected_to",
							)}
						>
							{hostBody() ?? (
								<FactsTable
									label={t("ui.chat.pickers.info_panel.host_runtime")}
									rows={hostRows(data?.process as DesktopInfoData["process"])}
								/>
							)}
						</PanelSection>
						<PanelSection
							title={t("ui.chat.pickers.info_panel.sessions_on_this_machine")}
							meta={
								/*
								 * No meta when the scan failed: `N live · M total` over a notice saying the
								 * registry could not be read is a number the same viewport disclaims, and
								 * the section below it already renders a bare heading in that state
								 * (design round 1, D4). The meta is a reading of the scan, so it goes with
								 * the scan.
								 */
								sessions?.available
									? t("ui.chat.pickers.info_panel.live_total", {
											formatcount: formatCount(sessions.live),
											formatcount2: formatCount(sessions.total),
										})
									: undefined
							}
						>
							{hostBody() ??
								(sessions && !sessions.available ? (
									<PanelNotice
										kind="unavailable"
										text={REGISTRY_UNAVAILABLE_NOTICE()}
									/>
								) : (
									<>
										{sessions?.build_skew ? (
											<PanelNotice
												kind="degraded"
												text={t(
													"ui.chat.pickers.info_panel.more_than_one_build_is_running_a_change_may_look_absent_in_a_window_that",
												)}
											/>
										) : null}
										<StatGrid>
											<StatCard
												label={t("ui.chat.pickers.info_panel.live65c821")}
												value={formatCount(sessions?.live ?? 0)}
											/>
											<StatCard
												/*
												 * "Not answering", not "Wedged", to match the badge in the
												 * table below and the rest of the product: the count is the
												 * same fact the row marks and the TUI's own meta line state in
												 * the person's word, and this card was naming it in the
												 * wire's.
												 */
												label={t(
													"ui.chat.pickers.info_panel.not_answering824ea0",
												)}
												value={formatCount(sessions?.wedged ?? 0)}
												tone={
													(sessions?.wedged ?? 0) > 0 ? "warning" : "neutral"
												}
											/>
											<StatCard
												label={t("ui.chat.pickers.info_panel.busy")}
												value={formatCount(sessions?.busy ?? 0)}
											/>
											<StatCard
												label={t("ui.chat.pickers.info_panel.needs_input")}
												value={formatCount(sessions?.pending ?? 0)}
												tone={
													(sessions?.pending ?? 0) > 0 ? "warning" : "neutral"
												}
											/>
										</StatGrid>
										<div className={cn("pt-3")}>
											<DataTable<(typeof sessionRows)[number]>
												label={t(
													"ui.chat.pickers.info_panel.sessions_on_this_machine",
												)}
												columns={sessionColumns}
												rows={sessionRows}
												rowKey={(row) => row.key}
												empty={
													<PanelNotice
														kind="empty"
														text={t(
															"ui.chat.pickers.info_panel.no_other_lop_sessions_are_running_on_this_machine",
														)}
													/>
												}
											/>
										</div>
										{/*
										 * One line under the table, never a column of `—`: a host
										 * whose memory probes returned nothing has nothing to say
										 * per row.
										 */}
										{sessions?.usage_available === false ? (
											<p className={cn("pt-2 text-body-sm text-ink-muted")}>
												{t(
													"ui.chat.pickers.info_panel.memory_could_not_be_measured_on_this_machine",
												)}
											</p>
										) : null}
									</>
								))}
						</PanelSection>
						<PanelSection
							title={t("ui.chat.pickers.info_panel.agents_and_subagents")}
							meta={fleet?.meta}
						>
							{hostBody("stats") ??
								(fleet ? (
									<>
										{/*
										 * Four cards rather than a facts table, because each of the first two
										 * carries a BREAKDOWN beneath its number and that is what a stat card's
										 * note is for (§ 6.3's convention for this panel's counts, one section
										 * above). No tone on any of them: the terminal carries no colour here,
										 * and warning-red on a total that mostly counts healthy runtimes would
										 * be a judgement rather than the measured condition a tone is for.
										 */}
										<StatGrid>
											{fleet.facts.map((fact) => (
												<StatCard
													key={fact.key}
													label={fact.label}
													value={fact.value}
													note={fact.note}
												/>
											))}
										</StatGrid>
										{/*
										 * Quiet prose, and only when the state applies: a line that is always
										 * there is wallpaper and gets read as boilerplate, so the one time it
										 * matters it is not read either. The same register as the memory line
										 * under section 3.
										 */}
										{fleet.caveats.map((caveat) => (
											<p
												key={caveat}
												className={cn("pt-2 text-body-sm text-ink-muted")}
											>
												{caveat}
											</p>
										))}
									</>
								) : (
									/*
									 * The SAME notice section 3 draws, from ONE exported constant: one
									 * registry serves both sections, and two spellings of one failure read as
									 * two different problems (review round 1, M2).
									 */
									<PanelNotice
										kind="unavailable"
										text={REGISTRY_UNAVAILABLE_NOTICE()}
									/>
								))}
						</PanelSection>
						{/*
						 * The conversation half exists exactly when a conversation is in front
						 * of the user, which is what `sessionId` means at the point of paint:
						 * `""` at the shell host, the live id at the pane. Without this the
						 * section renders headed "This conversation" over
						 * `<PanelNotice kind="empty" text="Nothing to report here." />` — the
						 * heading is the lie, not the notice.
						 */}
						{sessionId !== "" ? (
							<PanelSection
								title={t("ui.chat.pickers.info_panel.this_conversation")}
								meta={t("ui.chat.pickers.info_panel.live_this_conversation")}
							>
								<FactsTable
									label={t("ui.chat.pickers.info_panel.this_conversation")}
									rows={conversationRows(frontend, sessionId, teamLabelFor)}
								/>
							</PanelSection>
						) : null}
						<PanelSection
							title={t("ui.chat.pickers.info_panel.environment")}
							meta={t(
								"ui.chat.pickers.info_panel.backend_runtime_and_this_app",
							)}
						>
							<FactsTable
								label={t("ui.chat.pickers.info_panel.environment")}
								rows={data ? environmentRows(data.env, frontend) : []}
							/>
							{mcp.failures.length > 0 ? (
								<div className={cn("pt-3")}>
									<DataTable<{ name: string; error: string }>
										label={t("ui.chat.pickers.info_panel.mcp_server_failures")}
										columns={[
											{
												key: "name",
												header: t("ui.chat.pickers.info_panel.server"),
												cell: (row) => row.name,
											},
											{
												key: "error",
												header: t("ui.chat.pickers.info_panel.reported"),
												cell: (row) => (
													<span
														className={cn(
															"break-all text-body-sm text-warning",
														)}
													>
														{row.error}
													</span>
												),
											},
										]}
										rows={mcp.failures}
										rowKey={(row) => row.name}
									/>
								</div>
							) : null}
							<div className={cn("pt-3")}>
								<Disclosure
									summary={t("ui.chat.pickers.info_panel.runtime_terminal")}
								>
									<FactsTable
										label={t("ui.chat.pickers.info_panel.runtime_terminal")}
										rows={data ? terminalRows(data.env) : []}
									/>
								</Disclosure>
							</div>
						</PanelSection>
						{data && data.degraded.length > 0 ? (
							<PanelSection
								title={t("ui.chat.pickers.info_panel.could_not_be_read")}
								meta={t(
									"ui.chat.pickers.info_panel.why_a_field_above_shows_an_unknown",
								)}
							>
								<DataTable<{ field: string; reason: string }>
									label={t(
										"ui.chat.pickers.info_panel.fields_that_could_not_be_read",
									)}
									columns={[
										{
											key: "field",
											header: t("ui.chat.pickers.info_panel.field"),
											cell: (row) => (
												<span className={cn("font-mono text-mono-sm")}>
													{row.field}
												</span>
											),
										},
										{
											key: "reason",
											header: t("ui.chat.pickers.info_panel.reason"),
											cell: (row) => (
												<span className={cn("text-body-sm")}>{row.reason}</span>
											),
										},
									]}
									rows={data.degraded.map(([field, reason]) => ({
										field,
										reason,
									}))}
									rowKey={(row) => row.field}
								/>
							</PanelSection>
						) : null}
					</PanelStack>
				)
			}
		/>
	);
};

/** The adapter the registry mounts: owns the read and the capability gate. */
export const InfoView: FC<MachinePanelContext> = ({
	sessionId,
	frontend,
	onClose,
}) => {
	const capabilities = useDesktopCapabilities();
	const gated = !desktopFeatureEnabled(capabilities.data, "diagnostics", 1);
	const query = useQuery({ ...infoQueryOptions(), enabled: !gated });
	/*
	 * The Active row reads the team the way the header chip on the same screen
	 * does (round 1, R1-3b): the chip was resolved through this same catalogue
	 * while the row beneath it printed the raw slug. Same hook family every
	 * resolved surface uses, same gate, and a slug the catalogue cannot resolve
	 * renders as itself.
	 */
	const teamLabelFor = useTeamLabelFor(
		desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	return (
		<InfoPanel
			data={query.data?.data ?? null}
			loading={!gated && query.isLoading}
			error={query.isError ? errorText(query.error) : null}
			frontend={frontend}
			sessionId={sessionId}
			onClose={onClose}
			gated={gated}
			teamLabelFor={teamLabelFor}
		/>
	);
};
