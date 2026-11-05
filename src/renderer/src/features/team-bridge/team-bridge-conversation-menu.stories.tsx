import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, screen, waitFor } from "@storybook/test";
import type { TeamBridgeConversation } from "../../../../shared/team-bridge-contract";
import {
	TeamBridgeConversationMenu,
	TeamBridgeMenuConfirmDialog,
} from "./team-bridge-conversation-menu";
import {
	menuAgents,
	menuConversation,
	menuGeneral,
	menuSectionsFor,
} from "./team-bridge-conversation-menu.fixtures";
import { ConversationRailRow, RailSection } from "./team-bridge-rail";

/*
 * THE CONVERSATION MENU (operator 2026-11-04: leave, members, notification
 * settings on every channel/group; remove your own agent). One item list
 * (`conversationMenuSections`), three openers: the header "…" (the first
 * stories), a rail row's "…" and the row's right-click (`Row*`). Every story
 * takes its items from the real model through the fixtures, so the disabled
 * reasons on #general and #agents are the model's, not a story's.
 * Presentational: callbacks are no-ops and `defaultOpen` replaces a click.
 */
const meta = {
	title: "Team Bridge/Conversation menu",
	component: TeamBridgeConversationMenu,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[620px] justify-end bg-surface p-4 text-ink">
				<Story />
			</div>
		),
	],
	args: {
		sections: menuSectionsFor(menuConversation()),
		conversation: { notify: "all", muted: false },
		agentNotify: "all",
		handlers: {
			onNotifyChange: () => {},
			onAgentNotifyChange: () => {},
			onViewMembers: () => {},
			onAddMembers: () => {},
			onJoin: () => {},
			onOwnAgent: () => {},
			onLeave: () => {},
			onArchive: () => {},
		},
		defaultOpen: true,
	},
} satisfies Meta<typeof TeamBridgeConversationMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The header menu on an ordinary channel the reader owns: every section. */
export const HeaderChannel: Story = {};
export const AgentMentionsAndThreads: Story = {
	args: { agentNotify: "mention" },
};
export const AgentMuted: Story = { args: { agentNotify: "mute" } };
/* An older hub serves no level for the agent row: no row is checked. */
export const AgentLevelUnknown: Story = { args: { agentNotify: null } };
/* No own agent here: no wake group, and "Add Aida" in its place. */
export const NoOwnAgent: Story = {
	args: {
		sections: menuSectionsFor(
			menuConversation({
				members: menuConversation().members.filter(
					(row) => row.kind === "human",
				),
			}),
		),
	},
};
/** #general: Leave disabled with its reason; Remove Aida is a withdraw. */
export const HeaderGeneral: Story = {
	args: { sections: menuSectionsFor(menuGeneral) },
};

/* ------------------------------------------------------------ rail rows */

const RowBoard = ({
	rows,
	openId,
}: {
	rows: TeamBridgeConversation[];
	openId?: string;
}) => (
	<div className="w-72 bg-canvas py-2 text-ink">
		<RailSection id="conversation-menu-story-channels" title="Channels">
			<ul className="flex flex-col">
				{rows.map((row) => (
					<ConversationRailRow
						key={row.id}
						conversation={row}
						selected={false}
						selfAccountId="acct_self"
						onSelect={() => {}}
						menu={{
							sections: menuSectionsFor(row),
							conversation: row,
							agentNotify: null,
							handlers: meta.args.handlers,
						}}
						initialMenuOpen={row.id === openId}
					/>
				))}
			</ul>
		</RailSection>
	</div>
);

const railRows = [
	menuGeneral,
	menuAgents,
	menuConversation({ unread_count: 3 }),
	menuConversation({
		id: "bcv_ops",
		name: "ops",
		muted: true,
		notify: "mute",
	}),
];

/** The rail at rest: no "…" anywhere; counts and bells in their slot. */
export const RowsAtRest: Story = {
	render: () => <RowBoard rows={railRows} />,
};
/** A channel row's "…" open (the hover/focus trigger). */
export const RowMenuChannel: Story = {
	render: () => <RowBoard rows={railRows} openId="bcv_launch" />,
};
/** #general's row menu: Leave disabled, "mute it instead". */
export const RowMenuGeneral: Story = {
	render: () => <RowBoard rows={railRows} openId="bcv_general" />,
};
/** #agents' row menu: Remove Aida disabled, "Pause your agent…". */
export const RowMenuAgents: Story = {
	render: () => <RowBoard rows={railRows} openId="bcv_agents" />,
};
/** Right-click on a row opens the same menu at that row. */
export const RowRightClick: Story = {
	render: () => <RowBoard rows={railRows} />,
	play: async ({ canvasElement }) => {
		const row = canvasElement.querySelector(
			'[data-conversation-id="bcv_launch"]',
		);
		if (!row) throw new Error("launch row missing");
		fireEvent.contextMenu(row);
		await waitFor(() => expect(screen.getByRole("menu")).toBeVisible());
	},
};

/* ------------------------------------------------------------ confirms */

const Confirm = (props: Parameters<typeof TeamBridgeMenuConfirmDialog>[0]) => (
	<TeamBridgeMenuConfirmDialog {...props} />
);
const confirmBase = {
	conversationName: "#launch",
	pending: false,
	error: null,
	onClose: () => {},
	onConfirm: () => {},
} as const;

export const LeaveConfirm: Story = {
	render: () => (
		<Confirm
			{...confirmBase}
			subject={{ kind: "leave", conversationKind: "channel" }}
		/>
	),
};
export const RemoveAgentConfirm: Story = {
	render: () => (
		<Confirm
			{...confirmBase}
			subject={{ kind: "remove_agent", agentName: "Aida", action: "withdraw" }}
		/>
	),
};
/** The hub's 404 before the agent has a #general row, stated plainly. */
export const RemoveAgentNotInGeneral: Story = {
	render: () => (
		<Confirm
			{...confirmBase}
			conversationName="#general"
			error="not_in_general"
			subject={{ kind: "remove_agent", agentName: "Aida", action: "withdraw" }}
		/>
	),
};
