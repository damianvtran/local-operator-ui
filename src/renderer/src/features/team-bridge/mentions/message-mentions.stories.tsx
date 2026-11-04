import { useDocumentDirection } from "@shared/i18n/use-document-direction";
import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeMessageList } from "../team-bridge-message-list";
import { MentionSourceContext } from "./mention-context";
import { TeamBridgeMentionProvider } from "./mention-source";

/** Authoritative account IDs select viewer ink; a fallback name only when unique to the reader. */
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
		{
			kind: "agent" as const,
			accountId: "acct_me",
			endpointId: "bep_self",
			label: "My agent",
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
	mentions: [
		{ kind: "human" as const, account_id: "acct_ben" },
		{ kind: "human" as const, account_id: "acct_me" },
		{ kind: "agent" as const, account_id: "acct_ben", endpoint_id: "bep_aida" },
		{ kind: "agent" as const, account_id: "acct_me", endpoint_id: "bep_self" },
	],
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
							"@Ben Tran can you and @Aida (Ben Tran) and @My agent take the reindex?",
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

/*
 * THE OPERATOR'S CASE (2026-11-03), through the REAL provider rather than a
 * hand-built context: Sherman's message carries no `mentions` key (most hub
 * messages do not), so the reader's mention is found by the name fallback and
 * must still take the viewer ink, while another person keeps the accent.
 */
const member = (account_id: string, display_label: string) => ({
	account_id,
	kind: "human" as const,
	display_label,
	role: "member" as const,
	state: "active" as const,
});
const person = (account_id: string, display_label: string) => ({
	account_id,
	display_label,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active" as const,
});
const general = {
	id: "bcv_general",
	tenant_id: "tnt_story",
	kind: "channel" as const,
	name: "general",
	visibility: "tenant" as const,
	agent_capable: false,
	status: "open" as const,
	created_by: "acct_sher",
	last_message_at: "2026-11-02T16:17:44Z",
	latest_seq: 2,
	last_read_seq: 2,
	unread_count: 0,
	muted: false,
	members: [
		member("acct_me", "Damian Tran"),
		member("acct_sher", "Sherman Tsui"),
		member("acct_ben", "Ben Tran"),
	],
};

function ProviderHarness() {
	useDocumentDirection();
	return (
		<TeamBridgeMentionProvider
			conversation={general}
			people={[
				person("acct_me", "Damian Tran"),
				person("acct_sher", "Sherman Tsui"),
				person("acct_ben", "Ben Tran"),
			]}
			selfAccountId="acct_me"
			sendMentions
		>
			<div className="w-[720px] bg-canvas p-4">
				<TeamBridgeMessageList
					messages={[
						{
							id: "m1",
							conversation_id: "bcv_general",
							seq: 1,
							sender: {
								account_id: "acct_sher",
								kind: "human",
								display_label: "Sherman Tsui",
							},
							body: "@Damian Tran Yeah, I've been noticing that too. @Ben Tran can you take a look at the theming?",
							origin: "human",
							created_at: "2026-11-02T16:17:44Z",
						},
					]}
					labelFor={(sender) => sender.display_label}
				/>
			</div>
		</TeamBridgeMentionProvider>
	);
}

export const NoWireMentionsLight: StoryObj<typeof ProviderHarness> = {
	render: () => <ProviderHarness />,
	args: { theme: "localOperatorLight" } as object,
};
export const NoWireMentionsDark: StoryObj<typeof ProviderHarness> = {
	render: () => <ProviderHarness />,
	args: { theme: "localOperatorDark" } as object,
};

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
