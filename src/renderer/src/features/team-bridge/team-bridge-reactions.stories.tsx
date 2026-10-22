import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";
import { QUICK_EMOJI } from "./team-bridge-emoji-model";
import { TeamBridgeEmojiPicker } from "./team-bridge-emoji-picker";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { TeamBridgeReactions } from "./team-bridge-reactions";

const meta = {
	title: "Team Bridge/Reactions",
	component: TeamBridgeReactions,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="group/message relative w-[480px] max-w-full bg-canvas p-6 text-ink">
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

/** Permanent design-regression boards: no temporary story edits are needed for the reviewed
 * 720px viewport, empty-message rhythm, unsupported glyph or keyboard interaction. */
export const ShortWindowPicker: Story = {
	parameters: {
		viewport: {
			defaultViewport: "reactionShort",
			viewports: {
				reactionShort: {
					name: "Reaction short window",
					styles: { width: "800px", height: "720px" },
					type: "desktop",
				},
			},
		},
	},
	args: { defaultOpen: true },
	render: (args) => (
		<div className="relative flex h-[560px] items-end">
			<TeamBridgeReactions {...args} />
		</div>
	),
};
export const EmptyTimeline: Story = {
	render: () => (
		<TeamBridgeMessageList
			labelFor={() => "Ada"}
			reactionContext={{ accountId: "story-account", tenantId: "tnt_1" }}
			messages={Array.from({ length: 8 }, (_, index) => ({
				id: `bcmsg_story${index}`,
				conversation_id: "bcv_example1",
				seq: index + 1,
				sender: {
					account_id: "ada",
					kind: "human" as const,
					display_label: "Ada",
				},
				body: "A short status update.",
				origin: "human" as const,
				created_at: new Date(Date.UTC(2026, 9, 21, 12, index)).toISOString(),
			}))}
		/>
	),
};
export const UnsupportedGlyphSearch: Story = {
	render: () => (
		<TeamBridgeEmojiPicker
			accountId="story-account"
			initialQuery="cracking face"
			onSelect={() => {}}
			onClose={() => {}}
		/>
	),
};
export const BusyPicker: Story = {
	render: () => (
		<TeamBridgeEmojiPicker
			accountId="story-account"
			disabled
			onSelect={() => {}}
			onClose={() => {}}
		/>
	),
};
export const KeyboardNavigation: Story = {
	...Picker,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: t("ui.teamBridge.reactions.search"),
		});
		await userEvent.click(input);
		await userEvent.type(input, "thumbs up");
		await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");
		await waitFor(() =>
			expect(canvasElement.querySelector("output")).toHaveTextContent("👍🏻"),
		);
	},
};
export const EscapeReturnsFocus: Story = {
	args: { defaultOpen: true },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await waitFor(() =>
			expect(
				body.getByRole("textbox", {
					name: t("ui.teamBridge.reactions.search"),
				}),
			).toBeVisible(),
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(
				within(canvasElement).getByRole("button", {
					name: t("ui.teamBridge.reactions.add"),
				}),
			).toHaveFocus(),
		);
	},
};
