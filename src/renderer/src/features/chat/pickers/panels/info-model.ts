import type { DesktopInfoData } from "../../../../../../shared/desktop-contract";
import {
	UNKNOWN,
	formatBytes,
	formatCount,
	formatDuration,
	formatPercent,
	formatWindow,
} from "./formatters";

/**
 * `/info` — the pure decisions.
 *
 * Two rules drive everything here, and both are about honesty rather than
 * layout:
 *
 * 1. **A row whose value is empty is omitted.** A backend that serves many
 *    sessions legitimately has no `session_id`, `conversation_name` or
 *    `model_label`, and a row whose only content is `—` is noise that reads as
 *    a defect.
 * 2. **A section that could not be gathered says so in place of its content**
 *    rather than rendering a column of dashes.
 *
 * The panel renders the HOST facts from `info.get` and the LIVE facts from
 * `canonical.frontend`. It must never read `agents.*` or `env.mcp_*` from the
 * payload: those are `LiveState()` defaults, and rendering them would paint a
 * confident zero for a backend that never attached a session.
 */

/** A label/value row in a two-column facts table. */
export type InfoRow = {
	key: string;
	label: string;
	value: string;
	/** A qualifier clause rendered as dim prose (an env redirect, a caveat). */
	note?: string;
	/** Machine voice. Paths, ids, counts. */
	mono?: boolean;
	/** A measured condition, never a magnitude. */
	tone?: "neutral" | "warning";
	/** A list rendered as one wrapped mono line (the stored credential NAMES). */
	names?: string[];
};

export type InstallFacts = {
	version: string;
	kind: string;
	interpreter: string;
	installPath: string;
	runningCode: string;
	/** `true` when the running code is a checkout SHADOWING the reported install. */
	runningCodeShadowed: boolean;
	/** The install's own caveat: the never-checked / up-to-date / behind state. */
	versionNote: string;
	/** `vX.Y.Z available — /update`, only when a newer version is known. */
	updateBadge: string | null;
};

/**
 * Whether the running code is a checkout shadowing the reported install.
 *
 * Re-implemented here EXACTLY as the model layer spells it
 * (`import_path_foreign && kind !== "editable"`), because spelling it twice is
 * what made the TUI screen and its export reach opposite conclusions: the same
 * predicate evaluated as `import_path_foreign` alone painted an ordinary
 * editable install as a warning.
 */
export const isShadowedInstall = (
	install: DesktopInfoData["install"],
): boolean => install.import_path_foreign && install.kind !== "editable";

export function installFacts(
	install: DesktopInfoData["install"],
): InstallFacts {
	const version = install.version || "unavailable";
	/*
	 * `never checked` is a different fact from `up to date`: an install whose
	 * latest PyPI answer was never written to disk has no opinion, and calling
	 * that "up to date" is a claim nobody measured.
	 */
	const versionNote =
		install.behind && install.latest_known
			? `${install.latest_known} available`
			: install.latest_known === null
				? "never checked"
				: "up to date";
	const executable = install.executable ? ` (${install.executable})` : "";
	return {
		version,
		kind: install.kind || "unavailable",
		interpreter: install.python_version
			? `${install.python_version} ${install.python_implementation}`.trim()
			: "unavailable",
		installPath: `${install.prefix || "unavailable"}${executable}`,
		runningCode: install.import_path || "unavailable",
		runningCodeShadowed: isShadowedInstall(install),
		versionNote,
		updateBadge:
			install.behind && install.latest_known
				? `v${install.latest_known} available — /update`
				: null,
	};
}

/** Section 2's rows, in the order a host is asked about. */
export function hostRows(process: DesktopInfoData["process"]): InfoRow[] {
	return omitEmpty([
		{
			key: "pid",
			label: "Process",
			value: `pid ${formatCount(process.pid)}`,
			mono: true,
		},
		{ key: "kind", label: "Kind", value: process.kind, mono: true },
		{ key: "session", label: "Session", value: process.session_id, mono: true },
		{
			key: "conversation",
			label: "Conversation",
			value: process.conversation_name,
		},
		{ key: "model", label: "Model", value: process.model_label, mono: true },
		{
			key: "effective",
			label: "Answering model",
			/*
			 * Present only when it DIFFERS: on the common case the one line is
			 * enough, and a duplicate row reads as a distinction that is not there.
			 */
			value:
				process.effective_model &&
				process.effective_model !== process.model_label
					? process.effective_model
					: "",
			mono: true,
		},
		{
			key: "started",
			label: "Started",
			value: formatDuration(process.uptime_s),
			note: "ago",
		},
		{
			key: "cwd",
			label: "Working dir",
			value: process.cwd,
			mono: true,
		},
		{
			key: "config",
			label: "Config dir",
			value: process.config_dir,
			mono: true,
			note: process.config_dir_redirected
				? "redirected by LOCAL_OPERATOR_CONFIG_DIR"
				: undefined,
		},
		{ key: "cache", label: "Cache dir", value: process.cache_dir, mono: true },
		{
			key: "agent_home",
			label: "Agent home",
			value: process.agent_home,
			mono: true,
			note: process.agent_home_redirected
				? "redirected by LOCAL_OPERATOR_HOME"
				: undefined,
		},
		{ key: "log", label: "Log dir", value: process.log_dir, mono: true },
		{
			key: "control",
			label: "Control port",
			/*
			 * `null` is not listening, and it says so rather than rendering a
			 * number: a port is not a measurement otherwise.
			 */
			value:
				process.control_port === null
					? "not listening"
					: `${formatCount(process.control_port)}${process.protocol === null ? "" : ` · protocol v${process.protocol}`}`,
			mono: true,
		},
	]);
}

function omitEmpty(rows: (InfoRow & { value: string })[]): InfoRow[] {
	return rows.filter((row) => row.value !== "" && row.value !== undefined);
}

/** One row of the sessions table. */
export type SessionLineRow = {
	key: string;
	name: string;
	state: DesktopInfoData["sessions"]["lines"][number]["state"];
	model: string;
	uptime: string;
	memory: string;
	markers: { label: string; tone: "neutral" | "warning" | "dim" }[];
};

/**
 * Section 3's table rows.
 *
 * `this session` is matched on the id the panel was opened for, so a host
 * running five `lop` processes shows the user which row is the window in front
 * of them — the one fact the registry cannot know.
 */
export function sessionLineRows(
	lines: DesktopInfoData["sessions"]["lines"],
	thisSessionId: string,
): SessionLineRow[] {
	return lines.map((line) => {
		const markers: SessionLineRow["markers"] = [];
		if (line.session_id === thisSessionId) {
			markers.push({ label: "this session", tone: "neutral" });
		}
		if (line.busy) markers.push({ label: "busy", tone: "warning" });
		if (line.pending !== null) {
			markers.push({ label: `needs ${line.pending}`, tone: "warning" });
		}
		if (line.detached) markers.push({ label: "detached", tone: "dim" });
		return {
			key: `${line.pid}-${line.session_id}`,
			name: line.conversation_name || line.session_id || `pid ${line.pid}`,
			state: line.state,
			model: line.model_label,
			/*
			 * A `stored` row has no uptime to report — it is not running — so it
			 * reports how long ago it was last active instead. A row that showed
			 * `0s` uptime for a stored session would read as running.
			 */
			uptime:
				line.state === "stored"
					? line.last_activity_s === null
						? "unknown"
						: `${formatDuration(line.last_activity_s)} ago`
					: formatDuration(line.uptime_s),
			memory: formatBytes(line.footprint_bytes ?? line.rss_bytes),
			markers,
		};
	});
}

/** The frontend facts `/info` reads live, so the panel can degrade section by section. */
export type InfoFrontend = {
	conversation_title: string;
	selected_model: { provider: string; model_id: string } | null;
	effective_model: { provider: string; model_id: string } | null;
	context_tokens: number | null;
	context_window: number | null;
	context_is_estimate: boolean | null;
	cost_knowledge: string;
	active_agent: string;
	active_team: string;
	goal: string;
	mcp_servers: Array<{ name: string; status: string; error?: string | null }>;
};

/**
 * Section 4: the window in front of the user.
 *
 * This is the half that keeps `/info` honest against a remote backend: the host
 * facts above describe the machine the BACKEND runs on; these describe the
 * conversation on screen, and they stay true even when the read failed.
 */
export function conversationRows(
	frontend: InfoFrontend | null,
	sessionId: string,
): InfoRow[] {
	if (!frontend) return [];
	const selected = frontend.selected_model
		? `${frontend.selected_model.provider}/${frontend.selected_model.model_id}`
		: "";
	const effective = frontend.effective_model
		? `${frontend.effective_model.provider}/${frontend.effective_model.model_id}`
		: "";
	const context =
		frontend.context_tokens === null || !frontend.context_window
			? UNKNOWN
			: `${formatCount(frontend.context_tokens)} / ${formatWindow(frontend.context_window)} (${formatPercent(
					frontend.context_tokens / frontend.context_window,
				)})`;
	const active = frontend.active_team
		? `team ${frontend.active_team}`
		: frontend.active_agent
			? `agent ${frontend.active_agent}`
			: "";
	return omitEmpty([
		{ key: "session", label: "Session", value: sessionId, mono: true },
		{
			key: "title",
			label: "Title",
			value: frontend.conversation_title || "Untitled session",
		},
		{ key: "model", label: "Model", value: selected, mono: true },
		{
			key: "effective",
			label: "Answering model",
			// Only when it differs — the failover fact, and the only reason this
			// row exists at all.
			value: effective && effective !== selected ? effective : "",
			mono: true,
		},
		{
			key: "context",
			label: "Context",
			value: context,
			mono: true,
			note: frontend.context_is_estimate === true ? "estimate" : "measured",
		},
		{ key: "cost", label: "Cost knowledge", value: frontend.cost_knowledge },
		{ key: "active", label: "Active", value: active },
		{ key: "goal", label: "Goal", value: frontend.goal },
	]);
}

export type McpSummary = {
	configured: number;
	connected: number;
	failed: number;
	settling: boolean;
	failures: { name: string; error: string }[];
};

/**
 * The MCP counts, from the LIVE renderer copy rather than from `env.mcp_*`.
 *
 * `env.mcp_configured` and its siblings are `LiveState()` defaults on this
 * payload — they read as a confident zero — so the panel reads the session's
 * own `mcp_servers` and this file never touches `data.env.mcp_*`.
 *
 * The failure predicate is the owner's own (`status not in (connected,
 * connecting)`), and it exists because `== "failed"` only ever matched a
 * projection's placeholder: an auth-blocked server projected as `auth-required`
 * and the surface stayed calm while the manager's own state was red.
 */
export function mcpSummary(frontend: InfoFrontend | null): McpSummary {
	const servers = frontend?.mcp_servers ?? [];
	return {
		configured: servers.length,
		connected: servers.filter((server) => server.status === "connected").length,
		failed: servers.filter(
			(server) =>
				server.status !== "connected" && server.status !== "connecting",
		).length,
		settling: servers.some((server) => server.status === "connecting"),
		failures: servers
			.filter(
				(server) =>
					server.status !== "connected" && server.status !== "connecting",
			)
			.map((server) => ({
				name: server.name,
				error: server.error || server.status,
			})),
	};
}

/** Section 5's rows: everything except the terminal-only half. */
export function environmentRows(
	env: DesktopInfoData["env"],
	frontend: InfoFrontend | null,
): InfoRow[] {
	const mcp = mcpSummary(frontend);
	return omitEmpty([
		{
			key: "mcp",
			label: "MCP servers",
			value:
				mcp.configured === 0
					? "none configured"
					: `${formatCount(mcp.connected)} of ${formatCount(mcp.configured)} connected`,
			/*
			 * Reporting "1 of 3 up" mid-handshake is how a user files a bug about
			 * a server that came up a second later.
			 */
			note: mcp.settling ? "still connecting deferred servers" : undefined,
		},
		{
			key: "approval",
			label: "Approval mode",
			value: env.approval_mode,
			mono: true,
		},
		{
			key: "browser",
			label: "Browser",
			value: env.browser_backend
				? `${env.browser_backend}${env.browser_name ? ` · ${env.browser_name}` : ""}${env.browser_paired ? " · paired" : " · not paired"}`
				: "",
		},
		{
			key: "mobile",
			label: "Mobile relay",
			value: env.mobile_installed
				? `installed${env.mobile_healthy ? ", healthy" : ", not healthy"}${env.mobile_port === null ? "" : `, port ${formatCount(env.mobile_port)}`}`
				: "not installed",
		},
		{
			key: "guides",
			label: "Guides and skills",
			value: `${formatCount(env.guides)} guides · ${formatCount(env.skills)} skills`,
		},
		{
			key: "credentials",
			label: "Stored credentials",
			value:
				env.credential_keys.length === 0
					? "none"
					: formatCount(env.credential_keys.length),
			/*
			 * NAMES ONLY, and the note says so: the payload carries no value, and a
			 * reader who saw a count with no explanation would reasonably wonder
			 * what else was read.
			 */
			note: "names only · values are never read",
			names: env.credential_keys,
		},
	]);
}

/**
 * The terminal-only half, behind a disclosure.
 *
 * These describe the terminal the BACKEND runtime has (or does not have), not
 * the window in front of the user, so they are one click away rather than
 * beside facts about this app.
 */
export function terminalRows(env: DesktopInfoData["env"]): InfoRow[] {
	return omitEmpty([
		{ key: "term", label: "TERM", value: env.term, mono: true },
		{ key: "colorterm", label: "COLORTERM", value: env.colorterm, mono: true },
		{
			key: "multiplexer",
			label: "Multiplexer",
			value: env.multiplexer,
			mono: true,
		},
		{
			key: "is_tty",
			label: "Interactive terminal",
			value: env.is_tty ? "yes" : "no",
		},
		{
			key: "rows",
			label: "Rows",
			value:
				env.terminal_size === null ? "" : formatCount(env.terminal_size[0]),
			mono: true,
		},
		{
			key: "cols",
			label: "Columns",
			value:
				env.terminal_size === null ? "" : formatCount(env.terminal_size[1]),
			mono: true,
		},
		{ key: "theme", label: "Theme", value: env.theme, mono: true },
	]);
}
