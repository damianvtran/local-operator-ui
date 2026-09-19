import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Badge } from "@shared/components/ui/badge";
import { Disclosure } from "@shared/components/ui/disclosure";
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
	if (rows.length === 0) {
		return <PanelNotice kind="empty" text="Nothing to report here." />;
	}
	const columns: Column<InfoRow>[] = [
		{
			key: "item",
			header: "Item",
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
			header: "Value",
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

const INSTALL_COLUMNS: Column<InfoRow>[] = [
	{
		key: "item",
		header: "Path",
		cell: (row) => <span className={cn("text-ink-muted")}>{row.label}</span>,
	},
	{
		key: "value",
		header: "Value",
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
	live: { variant: "neutral", label: "live" },
	wedged: { variant: "warning", label: "not answering" },
	stale: { variant: "neutral", label: "stale", className: "text-ink-dim" },
	stored: { variant: "neutral", label: "stored", className: "text-ink-dim" },
};

const MARKER_BADGE: Record<
	"neutral" | "warning" | "dim",
	{ variant: "neutral" | "warning"; className?: string }
> = {
	neutral: { variant: "neutral" },
	warning: { variant: "warning" },
	dim: { variant: "neutral", className: "text-ink-dim" },
};

export const InfoPanel: FC<InfoPanelProps> = ({
	data,
	loading,
	error,
	frontend,
	sessionId,
	onClose,
	gated,
}) => {
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
		{ key: "name", header: "Session", cell: (row) => row.name },
		{
			key: "state",
			header: "State",
			cell: (row) => {
				const badge = STATE_BADGE[row.state] ?? STATE_BADGE.stale;
				return (
					<Badge variant={badge.variant} className={badge.className}>
						{badge.label}
					</Badge>
				);
			},
		},
		{ key: "model", header: "Model", cell: (row) => row.model },
		{ key: "uptime", header: "Uptime", cell: (row) => row.uptime },
		{
			key: "memory",
			header: "Memory",
			numeric: true,
			cell: (row) => row.memory,
		},
		{
			key: "markers",
			header: "Markers",
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
			bodyLabel="Host info region"
			title="Info"
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
					? "The install, the host this app is connected to, and the sessions on this machine."
					: "The install, the host this app is connected to, and the conversation in front of you."
			}
			body={
				gated ? (
					<PanelNotice
						kind="unavailable"
						text="This backend cannot serve this panel yet. Update the backend and try again."
					/>
				) : (
					<PanelStack>
						<PanelSection
							title="Install"
							meta={data ? installMeta(data.install) : undefined}
						>
							{hostBody() ?? (
								<>
									<StatGrid>
										<StatCard
											label="Version"
											value={install?.version ?? "unavailable"}
											note={install?.versionNote}
											tone={data?.install.behind ? "warning" : "neutral"}
										/>
										<StatCard
											label="Install kind"
											value={install?.kind ?? "unavailable"}
										/>
										<StatCard
											label="Interpreter"
											value={install?.interpreter ?? "unavailable"}
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
											label="Install and running code paths"
											columns={INSTALL_COLUMNS}
											rows={[
												{
													key: "install_path",
													label: "Install path",
													value: install?.installPath ?? "unavailable",
												},
												{
													key: "running_code",
													label: "Running code",
													value: install?.runningCode ?? "unavailable",
													tone: install?.runningCodeShadowed
														? "warning"
														: "neutral",
													note: data?.install.is_git_snapshot
														? `git snapshot ${data.install.source_ref || ""}`.trim()
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
							title="Host runtime"
							meta="the machine this app is connected to"
						>
							{hostBody() ?? (
								<FactsTable
									label="Host runtime"
									rows={hostRows(data?.process as DesktopInfoData["process"])}
								/>
							)}
						</PanelSection>
						<PanelSection
							title="Sessions on this machine"
							meta={
								/*
								 * No meta when the scan failed: `N live · M total` over a notice saying the
								 * registry could not be read is a number the same viewport disclaims, and
								 * the section below it already renders a bare heading in that state
								 * (design round 1, D4). The meta is a reading of the scan, so it goes with
								 * the scan.
								 */
								sessions?.available
									? `${formatCount(sessions.live)} live · ${formatCount(sessions.total)} total`
									: undefined
							}
						>
							{hostBody() ??
								(sessions && !sessions.available ? (
									<PanelNotice
										kind="unavailable"
										text={REGISTRY_UNAVAILABLE_NOTICE}
									/>
								) : (
									<>
										{sessions?.build_skew ? (
											<PanelNotice
												kind="degraded"
												text="More than one build is running. A change may look absent in a window that has not been restarted."
											/>
										) : null}
										<StatGrid>
											<StatCard
												label="Live"
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
												label="Not answering"
												value={formatCount(sessions?.wedged ?? 0)}
												tone={
													(sessions?.wedged ?? 0) > 0 ? "warning" : "neutral"
												}
											/>
											<StatCard
												label="Busy"
												value={formatCount(sessions?.busy ?? 0)}
											/>
											<StatCard
												label="Needs input"
												value={formatCount(sessions?.pending ?? 0)}
												tone={
													(sessions?.pending ?? 0) > 0 ? "warning" : "neutral"
												}
											/>
										</StatGrid>
										<div className={cn("pt-3")}>
											<DataTable<(typeof sessionRows)[number]>
												label="Sessions on this machine"
												columns={sessionColumns}
												rows={sessionRows}
												rowKey={(row) => row.key}
												empty={
													<PanelNotice
														kind="empty"
														text="No other lop sessions are running on this machine."
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
												Memory could not be measured on this machine.
											</p>
										) : null}
									</>
								))}
						</PanelSection>
						<PanelSection title="Agents and subagents" meta={fleet?.meta}>
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
										text={REGISTRY_UNAVAILABLE_NOTICE}
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
								title="This conversation"
								meta="live · this conversation"
							>
								<FactsTable
									label="This conversation"
									rows={conversationRows(frontend, sessionId)}
								/>
							</PanelSection>
						) : null}
						<PanelSection
							title="Environment"
							meta="backend runtime and this app"
						>
							<FactsTable
								label="Environment"
								rows={data ? environmentRows(data.env, frontend) : []}
							/>
							{mcp.failures.length > 0 ? (
								<div className={cn("pt-3")}>
									<DataTable<{ name: string; error: string }>
										label="MCP server failures"
										columns={[
											{
												key: "name",
												header: "Server",
												cell: (row) => row.name,
											},
											{
												key: "error",
												header: "Reported",
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
								<Disclosure summary="Runtime terminal">
									<FactsTable
										label="Runtime terminal"
										rows={data ? terminalRows(data.env) : []}
									/>
								</Disclosure>
							</div>
						</PanelSection>
						{data && data.degraded.length > 0 ? (
							<PanelSection
								title="Could not be read"
								meta="why a field above shows an unknown"
							>
								<DataTable<{ field: string; reason: string }>
									label="Fields that could not be read"
									columns={[
										{
											key: "field",
											header: "Field",
											cell: (row) => (
												<span className={cn("font-mono text-mono-sm")}>
													{row.field}
												</span>
											),
										},
										{
											key: "reason",
											header: "Reason",
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
	return (
		<InfoPanel
			data={query.data?.data ?? null}
			loading={!gated && query.isLoading}
			error={query.isError ? errorText(query.error) : null}
			frontend={frontend}
			sessionId={sessionId}
			onClose={onClose}
			gated={gated}
		/>
	);
};
