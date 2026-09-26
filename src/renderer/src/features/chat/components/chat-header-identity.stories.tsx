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
 *
 * The bridge is installed from `render`, synchronously, before the header
 * mounts - the pattern `session-archive.stories.tsx` documents - because a
 * mount effect runs after the header's first query and a capability answer
 * cached from a previous story would otherwise be the one this frame is
 * built from.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
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
};

/**
 * The bridge, standing where the preload's `desktop.request` stands.
 *
 * One function rather than the app's transport, because these stories have no
 * app - but the ENVELOPE is the shipped one ({status, body:{result}}), so the
 * components' own `desktopResult` path is what unwraps these answers and
 * nothing about the read path is stubbed out.
 */
const installBridge = ({ entities = "rows" }: BridgeOptions = {}) => {
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

/** The team menu's honest failure state: the owner's own refusal text. */
export const TeamMenuRefused: Story = {
	render: () => {
		installBridge({ entities: "refused" });
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
