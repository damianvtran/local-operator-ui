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
import type { PickerContext } from "../destination-pickers";
import { PickerHost } from "../picker-host";
import { errorText } from "../use-picker-backend";
import { formatCount } from "./formatters";
import {
	type InfoFrontend,
	type InfoRow,
	conversationRows,
	environmentRows,
	hostRows,
	installFacts,
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
 * implementation detail: sections 1-3 describe the machine the BACKEND runs on
 * (one read, and it can fail on its own), while sections 4 and 5 describe the
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
			cell: (row) =>
				row.names ? (
					<span className={cn("font-mono text-ink-muted text-mono-sm")}>
						{row.names.join(", ")}
					</span>
				) : (
					<span
						className={cn(
							"break-all",
							row.mono ? "font-mono text-mono-sm" : "text-body-sm",
							row.tone === "warning" ? "text-warning" : "text-ink",
						)}
					>
						{row.value}
					</span>
				),
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

const STATE_BADGE: Record<
	string,
	{
		variant: "neutral" | "warning" | "danger";
		label: string;
		className?: string;
	}
> = {
	live: { variant: "neutral", label: "live" },
	wedged: { variant: "warning", label: "wedged" },
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
	/** The host half's own state, which can fail independently of the live half. */
	const hostBody = () =>
		error ? (
			<PanelNotice kind="unavailable" text={error} />
		) : loading || !data ? (
			<PanelSkeleton shape="table" />
		) : null;
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			title="Info"
			description="The install, the host this app is connected to, and the conversation in front of you."
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
							meta={
								data
									? `${data.install.platform || "unknown platform"} · ${data.install.machine || UNKNOWN_MACHINE}`
									: undefined
							}
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
								sessions
									? `${formatCount(sessions.live)} live · ${formatCount(sessions.total)} total`
									: undefined
							}
						>
							{hostBody() ??
								(sessions && !sessions.available ? (
									<PanelNotice
										kind="unavailable"
										text="Could not scan the session registry. Close and reopen this panel to try again."
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
												label="Wedged"
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
						<PanelSection
							title="This conversation"
							meta="live · this conversation"
						>
							<FactsTable
								label="This conversation"
								rows={conversationRows(frontend, sessionId)}
							/>
						</PanelSection>
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

const UNKNOWN_MACHINE = "unknown machine";

/** The adapter the registry mounts: owns the read and the capability gate. */
export const InfoView: FC<PickerContext> = ({
	sessionId,
	canonical,
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
			frontend={canonical.frontend ?? null}
			sessionId={sessionId}
			onClose={onClose}
			gated={gated}
		/>
	);
};
