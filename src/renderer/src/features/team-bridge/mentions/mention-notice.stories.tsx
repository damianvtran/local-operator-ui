import type { Meta, StoryObj } from "@storybook/react";
import { MentionNotice } from "./mention-notice";
import type { MentionAutocomplete } from "./use-mention-autocomplete";

/**
 * The non-member notice above the composer, in a group (both actions) and a
 * DM (only "Mention without notifying"), light and dark.
 */
function Harness({ kind }: { kind: "group" | "dm" }) {
	const candidate = {
		kind: "human" as const,
		accountId: "acct_sherman",
		label: "Sherman Tsui",
		member: false,
		bridgeOff: false,
	};
	const mentions = {
		notice: {
			candidate,
			token: {
				start: 0,
				end: 13,
				kind: "human",
				accountId: "acct_sherman",
				label: "Sherman Tsui",
				notify: true,
			},
		},
		source: {
			conversationId: "bcv_story",
			candidates: [candidate],
			conversationKind: kind,
			sendMentions: true,
			self: null,
			onInvite: async () => {},
		},
		resolveNotice: () => {},
		silenceNotice: () => {},
		dismissNotice: () => {},
	} as unknown as MentionAutocomplete;
	return (
		<div className="w-[640px] bg-canvas p-6">
			<MentionNotice mentions={mentions} />
		</div>
	);
}

const meta = {
	title: "Team Bridge/Mention notice",
	component: Harness,
	args: { kind: "group" },
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const GroupLight: Story = {
	args: { theme: "localOperatorLight" } as Story["args"],
};
export const GroupDark: Story = {
	args: { theme: "localOperatorDark" } as Story["args"],
};
export const DirectMessageLight: Story = {
	args: { kind: "dm", theme: "localOperatorLight" } as Story["args"],
};
export const DirectMessageDark: Story = {
	args: { kind: "dm", theme: "localOperatorDark" } as Story["args"],
};
