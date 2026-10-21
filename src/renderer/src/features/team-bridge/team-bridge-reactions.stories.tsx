import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { QUICK_EMOJI } from "./team-bridge-emoji-model";
import { TeamBridgeEmojiPicker } from "./team-bridge-emoji-picker";
import { TeamBridgeReactions } from "./team-bridge-reactions";

const meta = {
	title: "Team Bridge/Reactions",
	component: TeamBridgeReactions,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="group/message w-[480px] max-w-full bg-canvas p-6 text-ink">
				<Story />
			</div>
		),
	],
	args: {
		conversationId: "bcv_example1",
		messageId: "bcmsg_example1",
		accountId: "story-account",
		tenantId: "tnt_1",
		reactions: [
			{
				emoji: "👍",
				count: 4,
				reacted_by_me: true,
				sample_labels: ["Ada", "Bea", "Cleo"],
			},
		],
		toggle: async (_conversation, message, emoji, active) => ({
			message_id: message,
			reactions: active
				? [{ emoji, count: 1, reacted_by_me: true, sample_labels: ["You"] }]
				: [],
		}),
	},
} satisfies Meta<typeof TeamBridgeReactions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = { args: { reactions: [] } };
export const ManyReactionsWrap: Story = {
	args: {
		reactions: [...QUICK_EMOJI, "🚀", "💯", "🤝", "🥳", "🧑🏻‍❤️‍💋‍🧑🏼"].map(
			(emoji, index) => ({
				emoji,
				count: index + 1,
				reacted_by_me: index % 3 === 0,
				sample_labels: ["Ada", "Bea", "Cleo"],
			}),
		),
	},
};
export const RefusedRollback: Story = {
	args: {
		toggle: async () => {
			await new Promise((resolve) => setTimeout(resolve, 500));
			throw new Error("reaction_limit");
		},
	},
};
export const Pending: Story = {
	args: {
		toggle: async () => {
			await new Promise((resolve) => setTimeout(resolve, 2500));
			return { message_id: "bcmsg_example1", reactions: [] };
		},
	},
};
export const Picker: Story = {
	render: () => {
		const [selected, setSelected] = useState("");
		return (
			<>
				<TeamBridgeEmojiPicker
					accountId="story-account"
					onSelect={setSelected}
					onClose={() => {}}
				/>
				<output>{selected}</output>
			</>
		);
	},
};
