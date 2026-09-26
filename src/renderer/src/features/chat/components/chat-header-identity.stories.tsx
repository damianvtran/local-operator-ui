/**
 * The chat header's identity controls, as surfaces of their own.
 *
 * WHY THIS FILE EXISTS. The operator's request (2026-09-26) is a change to the
 * bar everybody looks at forty times an hour, and the claim - "the team and the
 * agent are now menus you can switch from the header" - is a claim about
 * pixels, hover, and what a menu holds when it opens. The real `ChatHeader`
 * needs a live session for any of it, and Storybook is the instrument here
 * that can supply one with no backend: the bridge below answers the same ops
 * the app's transport answers (`teams.list`, `commands.entities`,
 * `sessions.command`), so a reviewer can CLICK a control in these stories and
 * watch the real menus open.
 *
 * WHAT EACH STORY IS FOR:
 *
 * - `TeamBound` is the operator's own case ("typically would be 'manager'"):
 *   a team bound with no /agent, so the agent control reads the team's
 *   manager and the team control reads the team.
 * - `NoTeamNoAgent` is the assign affordance both controls fall to - subdued
 *   copy, a chevron, and a menu that can set either.
 * - `AgentAndTeam` is both bound: two independent controls, agent first, the
 *   order the joined description string had.
 * - `Before` renders TODAY's string (`description`, no identity): the half a
 *   before/after pair needs, and the one this file can render on both trees
 *   unchanged, because it uses nothing this branch adds.
 * - `Wide` is the same TeamBound arrangement at 1380, the width the operator's
 *   own screenshot was taken at.
 * - `TeamMenuEmpty` and `TeamMenuRefused` are the menu's two honest states:
 *   the catalogue answering with no rows, and the registry refusing in its own
 *   words - the latter behind the settle latch below, because a shutter can
 *   otherwise catch the retry window and photograph `Loading teams…`.
 * - `TeamMenuBusy` holds the receipt for six seconds so the trigger's busy
 *   spinner is photographable; `NarrowFold` is the operator's own 49-char
 *   title at the 560 band, where the identity folds onto the clipped line.
 *
 * The bridge is installed from `render`, synchronously, before the header
 * mounts - the pattern `session-archive.stories.tsx` documents - because a
 * mount effect runs after the header's first query and a capability answer
 * cached from a previous story would otherwise be the one this frame is
 * built from.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
import type { ReactNode } from "react";
import "../../../styles/index.css";
import { ChatHeader } from "./chat-header";
import type { HeaderIdentityData } from "./chat-header-identity";

const meta = {
	title: "Chat/Header identity",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

const SESSION = "2d5ad5da0025";

const TEAMS = [
	{
		name: "lopdev",
		manager: "manager",
		description: "Builds and ships local-operator itself.",
	},
	{
		name: "minerva",
		manager: "ops-lead",
		description: "The Minerva platform's own roster.",
	},
];

const AGENTS = [
	{
		value: "coder",
		name: "coder",
		kind: "role",
		description: "Implements one bounded slice.",
	},
	{
		value: "manager",
		name: "manager",
		kind: "role",
		description: "Orchestrates a team.",
	},
	{
		value: "ops-lead",
		name: "ops-lead",
		kind: "specialist",
		description: "The Minerva operations lead.",
	},
	{
		value: "reviewer",
		name: "reviewer",
		kind: "role",
		description: "Reviews every diff.",
	},
];

type BridgeOptions = {
	/** Whether the catalogue answers rows at all, or refuses/empties instead. */
	entities?: "rows" | "empty" | "refused";
	/**
	 * How long `sessions.command` stays in flight. The busy state the rig
	 * photographs needs the receipt UNSETTLED at shutter time, and the story
	 * owes the frame that rather than a promise that races it.
	 */
	holdCommandMs?: number;
};

/**
 * The bridge, standing where the preload's `desktop.request` stands.
 *
 * One function rather than the app's transport, because these stories have no
 * app - but the ENVELOPE is the shipped one ({status, body:{result}}), so the
 * components' own `desktopResult` path is what unwraps these answers and
 * nothing about the read path is stubbed out.
 */
const installBridge = ({
	entities = "rows",
	holdCommandMs = 0,
}: BridgeOptions = {}) => {
	const ok = <T,>(result: T) => ({ status: 200, body: { result } });
	const bridge = async (request: { op: string; command?: string }) => {
		switch (request.op) {
			case "teams.list":
				return ok({ teams: TEAMS });
			case "commands.entities":
				if (entities === "refused") {
					return {
						status: 503,
						body: { detail: "The profile registry is unavailable" },
					};
				}
				return ok({
					command: request.command ?? "team",
					entities:
						entities === "rows"
							? request.command === "agent"
								? AGENTS
								: TEAMS.map((team) => ({ ...team, value: team.name }))
							: [],
					current: null,
				});
			case "sessions.command":
				/*
				 * `holdCommandMs` is the busy frame's fixture: the receipt is held
				 * long enough that the trigger is still `aria-busy` when the shutter
				 * fires, and the entry's own claim reads that attribute from the DOM
				 * rather than trusting the timing (see the rig's busy entry).
				 */
				if (holdCommandMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, holdCommandMs));
				}
				return ok({
					command: request.command ?? "",
					result: {
						kind: "notice",
						text: "the pick was received",
						style: "info",
						data: {},
					},
				});
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};

	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: {
					op: string;
					command?: string;
				}) => Promise<{ status: number; body: unknown }>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

/**
 * The band the header's own frames use: the production component on the ground
 * it really sits on, deliberately not narrowed further - the identity controls
 * are a width question, and a frame at a width the app does not have would
 * price them against a bar nobody uses.
 */
const Band = ({
	width = 560,
	children,
}: {
	width?: number;
	children: ReactNode;
}) => (
	<div
		/* An inert hook, for the measurement pass rather than any frame: it is
		   what a driver grabs to re-price the same band at the app's own widths
		   (the 220px pane-open header, the 560 band) without a second story. */
		data-header-band=""
		className={cn("flex h-[84px] shrink-0 flex-col bg-canvas")}
		style={{ width }}
	>
		{children}
	</div>
);

const identity = (over: Partial<HeaderIdentityData>): HeaderIdentityData => ({
	sessionId: SESSION,
	activeAgent: null,
	activeTeam: null,
	boundAgent: null,
	boundTeam: null,
	...over,
});

export const TeamBound: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

export const NoTeamNoAgent: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="~"
					identity={identity({})}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

export const AgentAndTeam: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="coder · lopdev"
					identity={identity({ activeAgent: "coder", activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/** The half a pair needs: today's plain string, with nothing this branch adds. */
export const Before: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/** The operator's own width, same arrangement as `TeamBound`. */
export const Wide: Story = {
	render: () => {
		installBridge();
		return (
			<Band width={1380}>
				<ChatHeader
					agentName="Redesign local-operator-ui installer loading panel"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/** The team menu's honest empty state, for a catalogue with no teams. */
export const TeamMenuEmpty: Story = {
	render: () => {
		installBridge({ entities: "empty" });
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * Holds the shutter until the REFUSED row has settled.
 *
 * WHY THIS EXISTS (design D1 / agent review round 1's finding 2). The story's
 * bridge answers `commands.entities` with a 503, and the app's own query
 * policy retries once after its default delay - so for about a second after
 * the menu opens, the row reads `Loading teams…`; the first sweep's shutter
 * fired in that window and committed a loading row under the refusal's name.
 * The fix is not a longer sleep but a SETTLE CONDITION: this component sets
 * the rig's `capturePending` latch on mount (layout effect, so it is on the
 * document before the readiness probe can conclude) and clears it only when
 * the refusal row itself - `[data-header-identity-error]`, the hook the
 * component puts on that label - is in the DOM. The rig waits on the latch
 * before any shutter (capture-evidence.mjs), so the frame cannot be taken
 * mid-fetch by construction, and the entry's `expectPresent` on the same hook
 * makes a regression fail the run rather than photograph the wrong state.
 */
const RefusedSettleLatch = () => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const poll = () => {
			if (cancelled) return;
			if (document.querySelector("[data-header-identity-error]")) {
				delete document.documentElement.dataset.capturePending;
				return;
			}
			window.setTimeout(poll, 100);
		};
		window.setTimeout(poll, 100);
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, []);
	return null;
};

/**
 * The team menu's honest failure state: the owner's own refusal text.
 *
 * The latch beside it is load-bearing: without it the shutter can fire while
 * the query is still retrying and file `Loading teams…` under this story's
 * name - the defect that made this frame's first capture wrong while the
 * component itself was right (design round 1, D1).
 */
export const TeamMenuRefused: Story = {
	render: () => {
		installBridge({ entities: "refused" });
		return (
			<Band>
				<RefusedSettleLatch />
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The switch IN FLIGHT: the trigger's own busy state, photographed rather than
 * argued. The bridge holds the receipt for six seconds and the entry drives
 * the pick keyboard-first, so the frame carries the spinner in the chevron's
 * slot while `aria-busy` is true - the state design round 1's D4 called
 * unframed, and the one whose docblock claims a switch never moves the box.
 */
export const TeamMenuBusy: Story = {
	render: () => {
		installBridge({ entities: "rows", holdCommandMs: 6000 });
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The fold the controls accept, at the operator's own title length.
 *
 * Design round 1's D3 asked for the boundary frame: 49 characters at the 560
 * band is the operator's own title (their screenshot), and the identity line
 * wraps onto the clipped second line there - the controls are PRESENT but not
 * visible, and the command surface remains their keyboard path. Photographed
 * rather than only recorded so the trade reads as a decision.
 */
export const NarrowFold: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Redesign local-operator-ui installer loading panel"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					onRenameConversation={() => undefined}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};
