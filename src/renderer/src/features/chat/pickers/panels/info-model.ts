import type { DesktopInfoData } from "../../../../../../shared/desktop-contract";
import {
	UNKNOWN,
	UNKNOWN_WORD,
	formatBytes,
	formatCount,
	formatDuration,
	formatModelSpec,
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
 *
 * The route settles the argument by shipping them as `null`
 * (`_unmeasure_live_half`), and the fields this file DOES read out of that block
 * — `env.approval_mode`, `env.skills` — are nulled too, so they render §8's
 * unknown rather than a default. Everything else it reads (`agents.profiles`,
 * the session registry, `env.guides`, the install/process probes) is a real
 * reading of this machine and stays one.
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

/**
 * Section 1's meta: the interpreter, the platform, and the architecture.
 *
 * § 6.3 asks this line for the Python version, the platform and the machine.
 * The platform string usually already ENDS in the machine — the collected
 * `macOS-26.0-arm64` does — so printing both is one fact twice, which is what
 * the panel did (`macOS-26.0-arm64 · arm64`, design round 1, D10). The machine is
 * therefore stated only when the platform does not already say it, and the
 * Python version moves onto the line the contract asks it for rather than living
 * only inside the interpreter card.
 */
export function installMeta(install: DesktopInfoData["install"]): string {
	const python = install.python_version
		? `Python ${install.python_version}`
		: "";
	const platform = install.platform || "unknown platform";
	const machine =
		install.machine && !platform.endsWith(install.machine)
			? install.machine
			: "";
	return [python, platform, machine].filter(Boolean).join(" · ");
}

export function installFacts(
	install: DesktopInfoData["install"],
): InstallFacts {
	const version = install.version || "unavailable";
	/*
	 * `never checked` is a different fact from `up to date`: an install whose
	 * latest PyPI answer was never written to disk has no opinion, and calling
	 * that "up to date" is a claim nobody measured.
	 *
	 * When a newer version IS known the note must not be where that version is
	 * stated. It used to read `0.22.0 available` on a card whose badge, 40px
	 * below, reads `v0.22.0 available — /update` — one fact, two statements, one
	 * of them missing the `v` — and § 6.3 gives the version to the badge, which
	 * is the copy that carries the action (design round 1, D11). So the note takes
	 * the fact the badge cannot: how stale the answer is.
	 */
	const versionNote =
		install.behind && install.latest_known
			? install.latest_age_s === null
				? "update available"
				: `checked ${formatDuration(install.latest_age_s)} ago`
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
			/*
			 * A duration and its direction belong in ONE cell. Split as label +
			 * "ago" the row read `Started  ago   3h 26m`, which is two halves of a
			 * sentence on either side of a column gap and a value in the middle.
			 *
			 * Mono, because a duration is machine voice here: every neighbour in this
			 * table is mono (a pid, ids, a path, a model id) and `Conversation` is
			 * the only prose column, so a sans duration was the odd one out in a
			 * column of monospace values (design round 1, D13).
			 */
			/*
			 * `null` is "never measured", which is not a duration: the word takes no
			 * unit, because `unknown ago` is an unknown spelling with a suffix glued on
			 * and reads as a measurement that went wrong rather than one nobody took
			 * (QA round 1, Q2).
			 */
			value:
				process.uptime_s === null
					? UNKNOWN_WORD
					: `${formatDuration(process.uptime_s)} ago`,
			mono: true,
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
	const selected = formatModelSpec(frontend.selected_model);
	const effective = formatModelSpec(frontend.effective_model);
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
			/*
			 * The note follows the VALUE: over an unmeasured context it used to say
			 * "measured" above a `—`, which the QA round read, correctly, as a
			 * measurement claim over an unknown (Q3's `Contextmeasured` cell).
			 */
			note:
				frontend.context_tokens === null || !frontend.context_window
					? "not measured"
					: frontend.context_is_estimate === true
						? "estimate"
						: "measured",
		},
		{ key: "cost", label: "Cost knowledge", value: frontend.cost_knowledge },
		{ key: "active", label: "Active", value: active },
		{ key: "goal", label: "Goal", value: frontend.goal },
	]);
}

export type McpSummary = {
	/**
	 * Whether a live renderer copy was there to read at all.
	 *
	 * `false` is NOT "none configured": with no `canonical.frontend` this panel
	 * has no MCP reading, and reporting `0 of 0 connected` would answer a question
	 * nobody asked of a source that does not exist — the same defect the route's
	 * own nulls prevent on the fields beside it.
	 */
	measured: boolean;
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
		measured: frontend !== null,
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
			/*
			 * Three different facts, three spellings: no live copy to read at all
			 * (`—`), a copy that lists nothing ("none configured"), and a copy with
			 * servers. Folding the first into the second is the mistake the route's own
			 * nulls exist to prevent on the fields beside this one.
			 */
			value: !mcp.measured
				? UNKNOWN
				: mcp.configured === 0
					? "none configured"
					: `${formatCount(mcp.connected)} of ${formatCount(mcp.configured)} connected`,
			/*
			 * Reporting "1 of 3 up" mid-handshake is how a user files a bug about
			 * a server that came up a second later.
			 */
			note:
				mcp.measured && mcp.settling
					? "still connecting deferred servers"
					: undefined,
		},
		{
			key: "approval",
			label: "Approval mode",
			/*
			 * `null` is the desktop's NORMAL payload here (no session is attached to
			 * this read), and it is a different fact from an empty approval mode: one
			 * is "nothing measured this", the other is a mode with no name. Blank was
			 * worse than either — the row vanished under `omitEmpty` and the reader
			 * could not tell the fact existed.
			 */
			value: env.approval_mode ?? UNKNOWN,
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
			/*
			 * `guides` is a real count of this install's files; `skills` is nulled on
			 * this route, because a skill is discovered with a session attached. Both
			 * halves are stated because the row is one fact per half — but the nulled
			 * half says so, instead of `formatCount(null)`'s confident "0 skills"
			 * about a machine that was never asked (backend QA round, cross-repo
			 * finding).
			 */
			value: `${formatCount(env.guides)} guides · ${
				env.skills === null ? UNKNOWN : `${formatCount(env.skills)} skills`
			}`,
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
