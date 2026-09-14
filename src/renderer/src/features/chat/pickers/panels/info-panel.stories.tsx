/**
 * `panels-info` — `/info` in every state it can be in.
 *
 * The production `InfoPanel` over a real-shaped `info.get` payload plus the live
 * `canonical.frontend` facts it also reads.
 *
 * The frames to judge the panel on are the degrade ones, because `/info` is the
 * one panel whose two halves come from different places:
 *
 * - `Unavailable` is a backend that did not answer, and sections 4 and 5 still
 *   render — the panel degrades SECTION BY SECTION, never to a blank, because
 *   the conversation facts are live local state rather than a second read.
 * - `BuildSkew` and `RosterUnread` are the two caveats the host half can carry,
 *   each a quiet line rather than a warning about a number nobody measured.
 * - `RemoteHost` is the label that keeps the panel honest when the backend is
 *   not on this machine: the host facts describe the machine the app is
 *   CONNECTED TO, which is why section 2's meta says exactly that.
 * - `MCP` counts come from the live `mcp_servers`, never from `env.mcp_*`: those
 *   are empty defaults on this payload and would paint a confident zero.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { DesktopInfoData } from "../../../../../../shared/desktop-contract";
import "../../../../styles/index.css";
import type { InfoFrontend } from "./info-model";
import { InfoPanel } from "./info-panel";
import { scrollPanelToSection } from "./story-scroll";

const noop = () => {};

const info = (over: Partial<DesktopInfoData> = {}): DesktopInfoData => ({
	install: {
		version: "0.21.0",
		kind: "uv_tool",
		prefix: "~/.local/share/uv/tools/local-operator",
		executable: "~/.local/share/uv/tools/local-operator/bin/local-operator",
		import_path:
			"~/.local/share/uv/tools/local-operator/lib/python3.14/site-packages/local_operator",
		import_path_foreign: false,
		is_git_snapshot: false,
		source_ref: "",
		build_age_s: 86_400,
		latest_known: "0.21.0",
		latest_age_s: 3_600,
		behind: false,
		python_version: "3.14.0",
		python_implementation: "CPython",
		platform: "macOS-26.0-arm64",
		machine: "arm64",
	},
	process: {
		pid: 83_412,
		session_id: "a1b2c3d4e5f6",
		conversation_name: "First-class panel views",
		cwd: "~/local-operator-ui-worktrees/panels",
		model_label: "anthropic/claude-sonnet-4-5",
		effective_model: "anthropic/claude-sonnet-4-5",
		uptime_s: 12_400,
		config_dir: "~/.local-operator",
		config_dir_redirected: false,
		agent_home: "~/.local-operator/agents",
		agent_home_redirected: false,
		cache_dir: "~/.local-operator/cache",
		log_dir: "~/.local-operator/logs",
		control_port: 51_204,
		protocol: 1,
		kind: "daemon",
	},
	sessions: {
		lines: [
			{
				pid: 83_412,
				kind: "daemon",
				state: "live",
				session_id: "a1b2c3d4e5f6",
				conversation_name: "First-class panel views",
				model_label: "anthropic/claude-sonnet-4-5",
				cwd: "~/local-operator-ui-worktrees/panels",
				uptime_s: 12_400,
				heartbeat_age_s: 2,
				rss_bytes: 412_000_000,
				footprint_bytes: 486_000_000,
				last_activity_s: 2,
				pending: null,
				busy: false,
				detached: false,
				version: "0.21.0",
				source_ref: "",
			},
			{
				pid: 84_020,
				kind: "daemon",
				state: "live",
				session_id: "b2c3d4e5f6a1",
				conversation_name: "Composer slash parity",
				model_label: "openai/gpt-5-codex",
				cwd: "~/local-operator-ui-worktrees/composer-slash-parity",
				uptime_s: 8_400,
				heartbeat_age_s: 4,
				rss_bytes: 380_000_000,
				footprint_bytes: null,
				last_activity_s: 12,
				pending: "approval",
				busy: true,
				detached: false,
				version: "0.21.0",
				source_ref: "",
			},
			{
				pid: 79_100,
				kind: "tui",
				state: "stored",
				session_id: "c3d4e5f6a1b2",
				conversation_name: "",
				model_label: "",
				cwd: "~/workspace",
				uptime_s: 0,
				heartbeat_age_s: 4_200,
				rss_bytes: null,
				footprint_bytes: null,
				last_activity_s: 4_200,
				pending: null,
				busy: false,
				detached: true,
				version: "0.20.1",
				source_ref: "",
			},
		],
		total: 3,
		live: 2,
		wedged: 0,
		stale: 0,
		busy: 1,
		pending: 1,
		detached: 1,
		build_skew: false,
		usage_available: true,
		available: true,
		subagents_reporting: 1,
		subagents_unreported: 0,
		fleet_subagents_running: 1,
		fleet_subagents_queued: 0,
		fleet_session_trajectories: 2,
		fleet_trajectories: 4,
	},
	agents: {
		profiles: 6,
		teams: 2,
		/*
		 * The live half is `null` in every fixture here, because that is what the
		 * wire always carries: `info.get` calls `_unmeasure_live_half`, so these are
		 * the dataclass defaults of a state with no session attached, shipped as the
		 * unknown rather than as a confident `0`. Typing them as numbers is how the
		 * panel came to state a measured "0 skills" nobody measured (backend QA
		 * round on the sibling PR), so the fixtures now carry the shape the desktop
		 * actually receives.
		 */
		tree: null,
		running: null,
		queued: null,
		settled: null,
		max_running: null,
		at_capacity: null,
		max_depth: null,
		deeper: null,
		cross_session_known: null,
		roster_unread: null,
	},
	env: {
		mcp_configured: null,
		mcp_connected: null,
		mcp_failed: null,
		mcp_settling: null,
		mcp_failures: null,
		approval_mode: null,
		theme: "localOperatorDark",
		terminal_size: null,
		term: "",
		colorterm: "",
		multiplexer: "",
		is_tty: false,
		browser_backend: "extension",
		browser_name: "Chrome",
		browser_paired: true,
		mobile_installed: true,
		mobile_healthy: true,
		mobile_port: 5_500,
		credential_keys: [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"LOCAL_OPERATOR_DESKTOP_TOKEN",
		],
		guides: 5,
		skills: null,
	},
	degraded: [],
	captured_at: 1_789_000_000,
	...over,
});

const frontend: InfoFrontend = {
	conversation_title: "First-class panel views",
	selected_model: { provider: "anthropic", model_id: "claude-sonnet-4-5" },
	effective_model: { provider: "anthropic", model_id: "claude-sonnet-4-5" },
	context_tokens: 12_400,
	context_window: 200_000,
	context_is_estimate: false,
	cost_knowledge: "known",
	active_agent: "",
	active_team: "",
	goal: "",
	mcp_servers: [
		{ name: "linear", status: "connected" },
		{ name: "notion", status: "connected" },
		{ name: "slack", status: "auth-required", error: "OAuth token expired" },
	],
};

const base = {
	loading: false,
	error: null,
	sessionId: "a1b2c3d4e5f6",
	onClose: noop,
	gated: false,
};

const meta: Meta<typeof InfoPanel> = {
	title: "panels-info",
	component: InfoPanel,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof InfoPanel>;

/** The default state: install, host, sessions, this conversation, environment. */
export const Populated: Story = { args: { ...base, data: info(), frontend } };

/**
 * The desktop's own shape: host half measured, live half NULL, nothing bound.
 *
 * This is the payload `info.get` always sends — `_unmeasure_live_half` nulls the
 * agent counters and `env.mcp_*`/`approval_mode`/`skills` because `LiveState()`
 * carries no session — and with no conversation in front of the app there is no
 * `canonical.frontend` either. So the panel has to say "not measured" in three
 * places at once, and must not say `0 skills`, `none configured` or a blank
 * approval mode: three false readings of a machine nobody asked. It is a story
 * of its own rather than a comment on `Populated` because the difference is the
 * whole point of the cross-repo finding (backend QA round), and because a frame
 * is the only thing that shows it.
 */
export const LiveHalfUnmeasured: Story = {
	args: { ...base, data: info(), frontend: null },
	/* The unknown spellings are the Environment section's rows, and that section
	   is below the fold of every `/info` frame (D2). */
	play: () => scrollPanelToSection("Environment"),
};

/** A newer release is known: the badge, and the version takes the warning tone. */
export const Behind: Story = {
	args: {
		...base,
		data: info({
			install: { ...info().install, latest_known: "0.22.0", behind: true },
		}),
		frontend,
	},
};

/** Never checked: a different fact from up to date, and it says which. */
export const NeverChecked: Story = {
	args: {
		...base,
		data: info({
			install: { ...info().install, latest_known: null, latest_age_s: null },
		}),
		frontend,
	},
};

/** The two cautions the host half can carry: skew, and an unread roster. */
export const BuildSkew: Story = {
	args: {
		...base,
		data: info({
			sessions: { ...info().sessions, build_skew: true },
			degraded: [["sessions.fleet_trajectories", "the registry answered late"]],
		}),
		frontend,
	},
	/* The notice is in section 3, and section 3 is below the fold: without this
	   the frame is the populated one (D2). */
	play: () => scrollPanelToSection("Sessions on this machine"),
};

export const RosterUnread: Story = {
	args: {
		...base,
		data: info({
			agents: { ...info().agents, roster_unread: true },
			degraded: [["agents", "the session roster could not be read"]],
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Sessions on this machine"),
};

/** Memory probes returned nothing: one line under the table, no column of `—`. */
export const NoMemory: Story = {
	args: {
		...base,
		data: info({
			sessions: {
				...info().sessions,
				usage_available: false,
				lines: info().sessions.lines.map((line) => ({
					...line,
					rss_bytes: null,
					footprint_bytes: null,
				})),
			},
		}),
		frontend,
	},
	/* The line under the table is the whole state, and the table is below the
	   fold (D2). */
	play: () => scrollPanelToSection("Sessions on this machine"),
};

/** The registry scan failed: section 3 says so, sections 4 and 5 still render. */
export const RegistryUnavailable: Story = {
	args: {
		...base,
		data: info({
			sessions: { ...info().sessions, available: false, lines: [] },
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Sessions on this machine"),
};

/**
 * A backend that did not answer: sections 1-3 are unavailable, 4 and 5 are not.
 *
 * The whole point of sectioning by SOURCE rather than by topic: the host facts
 * need the backend, the conversation facts do not, and a blank panel would throw
 * away the half that is still true.
 */
export const Unavailable: Story = {
	args: {
		...base,
		data: null,
		error:
			"The backend did not answer /v1/desktop/info within 30s. Close and reopen this panel to try again.",
		frontend,
	},
};

/** The backend predates the op: the update action, and no call to the route. */
export const Gated: Story = {
	args: { ...base, data: null, gated: true, frontend },
};

/** First paint. */
export const Loading: Story = {
	args: { ...base, data: null, loading: true, frontend },
};

/** Nothing on the host could be read: the install block still renders, per value. */
export const NothingRead: Story = {
	args: {
		...base,
		data: info({
			install: {
				...info().install,
				version: "",
				kind: "",
				prefix: "",
				executable: "",
				import_path: "",
				python_version: "",
			},
			process: {
				...info().process,
				config_dir: "",
				cache_dir: "",
				log_dir: "",
				agent_home: "",
			},
			degraded: [
				["install.version", "the install metadata could not be read"],
				[
					"process.config_dir",
					"no config dir is in this process's environment",
				],
			],
		}),
		frontend,
	},
};

/** A development host: the running code is a checkout shadowing the install. */
export const RemoteHost: Story = {
	args: {
		...base,
		data: info({
			install: {
				...info().install,
				kind: "editable",
				import_path_foreign: true,
				import_path: "~/local-operator/src/local_operator",
				is_git_snapshot: true,
				source_ref: "feat/panel-views",
				build_age_s: 900,
			},
			process: {
				...info().process,
				session_id: "",
				conversation_name: "",
				model_label: "",
				config_dir_redirected: true,
				agent_home_redirected: true,
				uptime_s: 90,
				control_port: null,
				protocol: null,
				kind: "daemon",
			},
		}),
		frontend,
	},
};

/** MCP mid-handshake: `Still connecting`, never "1 of 3 up" during a handshake. */
/** Settling counts are in section 5, below the fold (D2). */
export const McpSettling: Story = {
	args: {
		...base,
		data: info(),
		frontend: {
			...frontend,
			mcp_servers: [
				{ name: "linear", status: "connected" },
				{ name: "notion", status: "connecting" },
				{ name: "slack", status: "failed", error: "spawn ENOENT" },
			],
		},
	},
	play: () => scrollPanelToSection("Environment"),
};

/**
 * Every session is ours to show, including a detached TUI on an older build:
 * twelve rows, the table's own cap, so `+N more` never fires here.
 */
const manySessionLines = (): DesktopInfoData["sessions"]["lines"] =>
	Array.from({ length: 12 }, (_, index) => ({
		...info().sessions.lines[index % 3],
		pid: 83_412 + index * 60,
		session_id: `${index}f3a4b5c6d7`.slice(-12).padStart(12, "0"),
		conversation_name:
			index % 3 === 0 ? "" : `Session ${index} on build 0.2${index % 4}.0`,
		state: (index % 4 === 3 ? "stale" : "live") as "live" | "stale",
		busy: index % 5 === 0,
		pending: index % 7 === 0 ? "approval" : null,
	}));

export const ManySessions: Story = {
	args: {
		...base,
		data: info({
			sessions: {
				...info().sessions,
				lines: manySessionLines(),
				total: 12,
				live: 9,
				stale: 3,
			},
		}),
		frontend,
	},
	/* Twelve rows live in section 3; unscrolled, this story is the populated
	   image, which is what the design round found (D2). */
	play: () => scrollPanelToSection("Sessions on this machine"),
};

/**
 * The largest legal payload: every section at its cap on one body.
 *
 * It was `{ ...ManySessions.args, ...base }` — the same args object, so the two
 * stories shipped one image and only `many-sessions` was ever looked at (D2).
 * Everything added here is a branch the panel has and no other fixture reaches:
 * paths long enough to wrap, the full credential list (§ 6.3 wraps it), a failed
 * MCP server beside connected ones, and a populated `degraded` section.
 */
export const Dense: Story = {
	args: {
		...base,
		frontend: {
			...frontend,
			mcp_servers: [
				{ name: "linear", status: "connected" },
				{ name: "notion", status: "connected" },
				{
					name: "slack",
					status: "auth-required",
					error: "OAuth token expired",
				},
				{
					name: "postgres-observability",
					status: "failed",
					error: "spawn ENOENT",
				},
			],
		},
		data: info({
			install: {
				...info().install,
				prefix: "~/.local/share/uv/tools/local-operator-with-a-longer-name",
				import_path:
					"~/.local/share/uv/tools/local-operator-with-a-longer-name/lib/python3.14/site-packages/local_operator",
			},
			process: {
				...info().process,
				cwd: "~/oss/oh-my-pi/packages/coding-agent/src/very/deep/tree",
			},
			sessions: {
				...info().sessions,
				lines: manySessionLines(),
				total: 12,
				live: 9,
			},
			env: {
				...info().env,
				mcp_configured: 4,
				mcp_connected: 2,
				mcp_failed: 1,
				credential_keys: [
					"ANTHROPIC_API_KEY",
					"OPENAI_API_KEY",
					"DEEPSEEK_API_KEY",
					"GEMINI_API_KEY",
					"GITLAB_TOKEN",
					"GITHUB_TOKEN",
					"LOCAL_OPERATOR_DESKTOP_TOKEN",
				],
			},
			degraded: [
				["agents", "the session roster could not be read"],
				["sessions.fleet_trajectories", "the registry answered late"],
				["process.memory", "the memory probe timed out"],
			],
		}),
	},
	play: () => scrollPanelToSection("Sessions on this machine"),
};

/** 720px: the value column wraps and the markers stack. */
export const Narrow: Story = { args: { ...base, data: info(), frontend } };
