import { useDocumentDirection } from "@shared/i18n/use-document-direction";
import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeMessageList } from "../team-bridge-message-list";
import { MentionSourceContext } from "./mention-context";

/**
 * Mentions in received message bodies: another person's mention and the
 * READER's own (the stronger, Slack-yellow token), light and dark. The bodies
 * carry no `mentions` field, so this is the `@Name` fallback path every hub
 * serves today; a body in inline code stays unhighlighted.
 */
const source = {
	conversationId: "bcv_story",
	candidates: [
		{
			kind: "human" as const,
			accountId: "acct_ben",
			label: "Ben Tran",
			member: true,
			bridgeOff: false,
		},
		{
			kind: "agent" as const,
			accountId: "acct_ben",
			endpointId: "bep_aida",
			label: "Aida (Ben Tran)",
			member: true,
			bridgeOff: false,
		},
	],
	conversationKind: "group" as const,
	sendMentions: true,
	self: { accountId: "acct_me", label: "Damian Tran" },
};
const message = (id: string, seq: number, body: string, name: string) => ({
	id,
	conversation_id: "bcv_story",
	seq,
	sender: {
		account_id: `acct_${seq}`,
		kind: "human" as const,
		display_label: name,
	},
	body,
	origin: "human" as const,
	created_at: `2026-10-30T10:0${seq}:00Z`,
});

function Harness() {
	useDocumentDirection();
	return (
		<MentionSourceContext.Provider value={source}>
			<div className="w-[720px] bg-canvas p-4">
				<TeamBridgeMessageList
					messages={[
						message(
							"m1",
							1,
							"@Ben Tran can you and @Aida (Ben Tran) take the reindex?",
							"Ada Lovelace",
						),
						message(
							"m2",
							2,
							"@Damian Tran this one needs your sign-off.",
							"Ben Tran",
						),
						message(
							"m3",
							3,
							"Literal `@Ben Tran` in code is left alone.",
							"Sherman Tsui",
						),
					]}
					labelFor={(sender) => sender.display_label}
				/>
			</div>
		</MentionSourceContext.Provider>
	);
}

const meta = {
	title: "Team Bridge/Message mentions",
	component: Harness,
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {
	args: { theme: "localOperatorLight" } as Story["args"],
};
export const Dark: Story = {
	args: { theme: "localOperatorDark" } as Story["args"],
};
export const UrduDark: Story = {
	args: { locale: "ur", theme: "localOperatorDark" } as Story["args"],
};
