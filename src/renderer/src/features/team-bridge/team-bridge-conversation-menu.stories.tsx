import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeConversationMenu } from "./team-bridge-conversation-menu";

/*
 * The conversation header menu, open, in each "Your agent" state a reviewer
 * must see (wake-on-every-message): the reader's own agent woken by every
 * message (the default), only by @-mentions, never, a hub that reports no
 * level (nothing checked), and a conversation without the reader's own active
 * agent (no group at all). Presentational: the callbacks are no-ops and
 * `defaultOpen` replaces a click.
 */
const meta = {
	title: "Team Bridge/Conversation menu",
	component: TeamBridgeConversationMenu,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[520px] justify-end bg-surface p-4 text-ink">
				<Story />
			</div>
		),
	],
	args: {
		conversation: { notify: "all", muted: false },
		onNotifyChange: () => {},
		onAgentNotifyChange: () => {},
		onAddMembers: () => {},
		onArchive: () => {},
		defaultOpen: true,
	},
} satisfies Meta<typeof TeamBridgeConversationMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AgentEveryMessage: Story = {
	args: { ownAgent: { notify: "all" } },
};
export const AgentOnlyMentions: Story = {
	args: { ownAgent: { notify: "mention" } },
};
export const AgentNeverWakes: Story = {
	args: { ownAgent: { notify: "mute" } },
};
/* An older hub serves no level for the agent row: no row is checked. */
export const AgentLevelUnknown: Story = {
	args: { ownAgent: { notify: null } },
};
/* No own active agent here: the group is not drawn. */
export const NoOwnAgent: Story = {};
