/**
 * `panels-info` — `/info` in every state it can be in.
 *
 * The production `InfoPanel` over a real-shaped `info.get` payload plus the live
 * `canonical.frontend` facts it also reads.
 *
 * The frames to judge the panel on are the degrade ones, because `/info` is the
 * one panel whose two halves come from different places:
 *
 * - `Unavailable` is a backend that did not answer, and sections 5 and 6 still
 *   render — the panel degrades SECTION BY SECTION, never to a blank, because
 *   the conversation facts are live local state rather than a second read.
 * - `BuildSkew` and `RosterUnread` are the two caveats the host half can carry,
 *   each a quiet line rather than a warning about a number nobody measured.
 * - The `Fleet*` frames are the new "Agents and subagents" section's honesty
 *   rules, and they are the ones to judge closely, because every one of them is
 *   a state in which a number would be a lie: `FleetAllReporting` (the measured
 *   answer), `FleetOneDoesNotReport` (the `≥` lower bound on the figure itself,
 *   not only in the sentence below it), `FleetNobodyReports` (the `—` refusal —
 *   never a fabricated `0`), `FleetQueuedOnly` (`none running · Q queued`, so a
 *   zero total does not contradict a visible queue), `FleetAllIdle` (the one
 *   state in which `none running` is a measurement) and `FleetWedged` (the
 *   runtime split plus the as-of-its-last-heartbeat caveat). `FleetUnavailable`
 *   is the registry that could not be scanned: the section then carries no
 *   numbers at all, only the notice section 3 shows. `FleetProbesFailed` is the
 *   sixth refusal — a probe that failed is `—`, never `0` — in its field-level
 *   spelling, and `FleetAgentsUnread` is its block-level half. `FleetNeighbours`
 *   is the section in SITU, with the sessions section directly above it, which is
 *   the only frame that can answer "does this belong to this panel". `FleetNarrow`
 *   is 720px, and the two-clause note at that width is what makes the separator's
 *   wrap safe or not.
 * - `RemoteHost` is the label that keeps the panel honest when the backend is
 *   not on this machine: the host facts describe the machine the app is
 *   CONNECTED TO, which is why section 2's meta says exactly that.
 * - `MCP` counts come from the live `mcp_servers`, never from `env.mcp_*`: those
 *   are empty defaults on this payload and would paint a confident zero.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
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
		/*
		 * The fleet roll-ups satisfy the terminal's own arithmetic, because this
		 * section renders them side by side: `fleet_session_trajectories` is the
		 * BUSY live count above, `fleet_trajectories` is that plus
		 * `fleet_subagents_running`, and `subagents_reporting + subagents_unreported`
		 * is the LIVE count. A fixture whose addends do not reach its total is a
		 * fixture a reviewer has to distrust, and the note column prints all three.
		 * The magnitudes stay SCALED to this host's three-row registry: the counter
		 * that fed `≥42 trajectories` at briefing time came from a host running
		 * twenty-one sessions, and a twenty-one-runtime counter above a three-row
		 * table would be the same defect in the other direction.
		 */
		subagents_reporting: 2,
		subagents_unreported: 0,
		fleet_subagents_running: 3,
		fleet_subagents_queued: 0,
		fleet_session_trajectories: 1,
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

/** The fleet roll-ups, overridden as one coherent set on top of the registry. */
const fleet = (
	over: Partial<DesktopInfoData["sessions"]> = {},
): DesktopInfoData => info({ sessions: { ...info().sessions, ...over } });

/**
 * The base registry with nothing in flight.
 *
 * The idle and queued states need it because `busy` is a LINE flag, not a
 * counter one can zero on its own: leaving the busy row in place under a
 * `none running` header is the contradiction those two stories exist to show.
 */
const idleLines = (
	lines: DesktopInfoData["sessions"]["lines"],
): DesktopInfoData["sessions"]["lines"] =>
	lines.map((line) => ({ ...line, busy: false, pending: null }));

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
			/*
			 * A name the harness really emits (`env.tty` is an `isatty` read that can
			 * fail; `_safe("env.tty", …)` writes this entry). The previous spelling,
			 * `sessions.fleet_trajectories`, is a field the collector cannot fail on:
			 * a scan that fails is spelled `available === false`, and now that this
			 * panel prints numbers from that field, naming it here would make section
			 * 7 disclaim a reading section 4 renders (review round 1, N3).
			 */
			degraded: [["env.tty", "IsattyError: stdout has no terminal"]],
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

/** The registry scan failed: section 3 says so, sections 5 and 6 still render. */
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
 * The measured answer: every runtime reported, and the fleet is doing work.
 *
 * `2 runtimes · 4 trajectories` in the section's own meta, with the addends
 * beside the figure. This is the state the section is normally read in, and the
 * one every other `Fleet*` frame is a departure from.
 */
export const FleetAllReporting: Story = {
	args: { ...base, data: fleet(), frontend },
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * One runtime is an older build and cannot report its subagents.
 *
 * The `≥` rides the FIGURE rather than only the caveat sentence, because a
 * qualifier the reader has to scroll to is not a qualifier: without it the meta
 * would present a sum with a missing term as a total.
 */
export const FleetOneDoesNotReport: Story = {
	args: {
		...base,
		data: fleet({ subagents_reporting: 1, subagents_unreported: 1 }),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * Nobody could report, and nothing at all was measured: the `—` refusal.
 *
 * `0` here would be pure fabrication — no runtime answered — and the note names
 * WHY the value is unknown instead of printing the addends as three zeros.
 */
export const FleetNobodyReports: Story = {
	args: {
		...base,
		data: fleet({
			busy: 0,
			lines: idleLines(info().sessions.lines),
			subagents_reporting: 0,
			subagents_unreported: 2,
			fleet_subagents_running: 0,
			fleet_session_trajectories: 0,
			fleet_trajectories: 0,
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * Nothing is running and children are waiting: `none running · 3 queued`.
 *
 * The queued children are named BESIDE the measured `0 total`, never added into
 * it — a child on a capacity slot spends nothing, so counting it as a trajectory
 * would inflate the number this section exists to state precisely. But a bare
 * `0` above a visible queue is the same contradiction reached by arithmetic.
 */
export const FleetQueuedOnly: Story = {
	args: {
		...base,
		data: fleet({
			busy: 0,
			lines: idleLines(info().sessions.lines),
			fleet_subagents_running: 0,
			fleet_subagents_queued: 3,
			fleet_session_trajectories: 0,
			fleet_trajectories: 0,
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * Every runtime reported zero and nothing is waiting: `none running`.
 *
 * The one state in which the bare word is earned, because it is a measurement
 * rather than a hedge over an unmeasured term.
 */
export const FleetAllIdle: Story = {
	args: {
		...base,
		data: fleet({
			busy: 0,
			lines: idleLines(info().sessions.lines),
			fleet_subagents_running: 0,
			fleet_session_trajectories: 0,
			fleet_trajectories: 0,
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * A runtime that stopped answering: it still counts, and its counts are stale.
 *
 * `runtimes` is `live + wedged` — a wedged pid is still there and its children
 * may still be working — so the meta counts it, the Runtimes card splits it out,
 * and the caveat says which number is as of when.
 */
export const FleetWedged: Story = {
	args: {
		...base,
		data: fleet({
			lines: [
				{ ...info().sessions.lines[0], busy: false },
				{
					...info().sessions.lines[1],
					pid: 84_020,
					state: "wedged",
					busy: false,
					heartbeat_age_s: 4_200,
				},
			],
			total: 2,
			live: 1,
			wedged: 1,
			busy: 0,
			subagents_reporting: 1,
			fleet_subagents_running: 2,
			fleet_session_trajectories: 0,
			fleet_trajectories: 2,
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * The registry that could not be scanned, one section lower than section 3.
 *
 * The same failure, framed where the new section draws it: the section shows
 * section 3's notice VERBATIM and carries no numbers at all — no meta, no
 * cards, no caveat — because every number it has comes from the scan that just
 * failed.
 */
export const FleetUnavailable: Story = {
	args: {
		...base,
		data: info({
			sessions: { ...info().sessions, available: false, lines: [] },
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * The section in situ: the sessions section directly above it, both on screen.
 *
 * The other `Fleet*` frames open at the section's own heading, so the one thing
 * they cannot show is whether this section belongs to this panel — the gap above
 * it, the heading rhythm, and whether the two count sections read as one
 * document (design round 1, D7). Scrolled to the SESSIONS heading instead, on the
 * three-row registry that leaves room for both.
 */
export const FleetNeighbours: Story = {
	args: { ...base, data: fleet(), frontend },
	play: () => scrollPanelToSection("Sessions on this machine"),
};

/**
 * 720px, and the one state whose note carries TWO clauses.
 *
 * The narrow width is what the other frames cannot answer — they are all 1140 —
 * and the two-clause note is what makes the wrap visible: `2 sessions + 4
 * subagents · 3 queued` in a 333px card is where the separator lands at the start
 * of a line if it is breakable (design round 1, D5/D7). The state is an ordinary
 * one: work running, more of it waiting.
 */
export const FleetNarrow: Story = {
	args: {
		...base,
		data: fleet({
			busy: 2,
			fleet_session_trajectories: 2,
			fleet_subagents_running: 4,
			fleet_subagents_queued: 3,
			fleet_trajectories: 6,
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * A probe that FAILED is `—`, never `0` — the sixth refusal rule, which had no
 * frame before this round (review round 1, N2).
 *
 * The FIELD-level spelling (`agents.profiles`): one probe of the agent block
 * failed and its neighbour answered, so the cards must differ.
 */
export const FleetProbesFailed: Story = {
	args: {
		...base,
		data: info({
			degraded: [["agents.profiles", "the agent registry could not be read"]],
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * The BLOCK-level spelling of the same rule: the whole agent collection failed.
 *
 * `_safe("agents", …)` wraps `collect_agents` and its fallback is
 * `AgentsInfo()` — `profiles: 0`, `teams: 0` — so the wire carries `("agents",
 * reason)` and BOTH cards must refuse rather than print two plausible zeros
 * (review round 1, M1). The `Dense` fixture carries this spelling too, but its
 * frame is scrolled to the Environment section, so it is this story that shows
 * the cards for the case.
 */
export const FleetAgentsUnread: Story = {
	args: {
		...base,
		data: info({
			degraded: [["agents", "the session roster could not be read"]],
		}),
		frontend,
	},
	play: () => scrollPanelToSection("Agents and subagents"),
};

/**
 * A backend that did not answer: sections 1-4 are unavailable, 5 and 6 are not.
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
/** Settling counts are in section 6, below the fold (D2). */
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
				["env.tty", "IsattyError: stdout has no terminal"],
			],
		}),
	},
	play: () => scrollPanelToSection("Environment"),
};

/**
 * A real HTTP wire adapter for isolated evidence, NOT native Electron/preload or
 * slash-dispatch coverage. Start the documented disposable backend first. The
 * token is a public synthetic fixture, never a credential for an operator store.
 * This story is deliberately excluded from the unattended fixture sweep.
 */
const WireEnvironmentPanel = () => {
	const [data, setData] = useState<DesktopInfoData | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const abort = new AbortController();
		fetch("http://127.0.0.1:6052/v1/desktop/info", {
			headers: { Authorization: "Bearer synthetic-storybook-evidence" },
			signal: abort.signal,
		})
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Isolated backend returned HTTP ${response.status}`);
				const body = await response.json();
				setData(body.result.data);
			})
			.catch((failure: Error) => {
				if (!abort.signal.aborted) setError(failure.message);
			});
		return () => abort.abort();
	}, []);
	useEffect(() => {
		if (data) scrollPanelToSection("Environment");
	}, [data]);
	return (
		<InfoPanel
			{...base}
			data={data}
			error={error}
			loading={!data && !error}
			frontend={null}
		/>
	);
};

export const WireEnvironment: Story = {
	render: () => <WireEnvironmentPanel />,
};

/** 720px: the value column wraps and the markers stack. */
export const Narrow: Story = { args: { ...base, data: info(), frontend } };
