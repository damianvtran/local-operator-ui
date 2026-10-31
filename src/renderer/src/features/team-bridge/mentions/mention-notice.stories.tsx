import { useDocumentDirection } from "@shared/i18n/use-document-direction";
import type { Meta, StoryObj } from "@storybook/react";
import { MentionNotice } from "./mention-notice";
import type { MentionAutocomplete } from "./use-mention-autocomplete";

/**
 * The non-member notice above the composer, in a group (both actions) and a
 * DM (only "Mention without notifying"), light and dark.
 */
function Harness({
	kind,
	state = "picked",
}: {
	kind: "group" | "dm";
	state?: "picked" | "invited" | "pending";
}) {
	useDocumentDirection();
	const candidate = {
		kind: "human" as const,
		accountId: "acct_sherman",
		label: "Sherman Tsui",
		member: false,
		invited: state === "pending",
		bridgeOff: false,
	};
	const mentions = {
		notice: {
			candidate,
			invited: state === "invited",
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
			canInvite: () => kind !== "dm" && state === "picked",
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
/* After Invite: still non-notifying until they join (review R1-01). */
export const InvitedLight: Story = {
	args: { state: "invited", theme: "localOperatorLight" } as Story["args"],
};
/* An already-invited member was picked: no Invite, the reason in the sentence. */
export const PendingDark: Story = {
	args: { state: "pending", theme: "localOperatorDark" } as Story["args"],
};
/* D5: real RTL. */
export const GroupUrduLight: Story = {
	args: { locale: "ur", theme: "localOperatorLight" } as Story["args"],
};
