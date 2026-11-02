import "../chat/components/story-electron-shim";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import {
	MentionSourceContext,
	type MentionSource,
} from "./mentions/mention-context";
import {
	clearStagedMentions,
	stagedMentions,
} from "./mentions/mention-outbox";
import { TeamBridgeComposer } from "./team-bridge-composer";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";

type FixtureMode = "dm" | "agent-dm" | "channel" | "group" | "thread";
type SendRow = {
	mode: FixtureMode;
	body: string;
	attachments: readonly string[];
	mentions: ReturnType<typeof stagedMentions>;
	clientRef?: string;
};

/**
 * Baseline and after-state use the REAL main/thread hosts, not a textarea copy.
 * Each host's actual submit callback appends a visible journal row: Enter that
 * wrongly sends cannot hide behind the no-op callbacks in presentational stories.
 * All identities are synthetic; no API mutation, file chooser or microphone is
 * needed. Main's omitted recording probe fails closed; attachments are disabled.
 */
function AutocompleteFixture({ mode }: { mode: FixtureMode }) {
	const conversationId = `emoji-fixture-${mode}`;
	const [journal, setJournal] = useState<SendRow[]>([]);
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	);
	useEffect(() => {
		const store = useConversationInputStore.getState();
		store.setComposerText(conversationId, "");
		return () => {
			store.setComposerText(conversationId, "");
			client.clear();
		};
	}, [client, conversationId]);
	const source: MentionSource = {
		conversationId,
		draftOwner: {
			accountId: "emoji-fixture-self",
			tenantId: "emoji-fixture-tenant",
		},
		conversationKind:
			mode === "dm" || mode === "agent-dm"
				? "dm"
				: mode === "channel"
					? "channel"
					: "group",
		self: { accountId: "emoji-fixture-self", label: "Fixture Self" },
		sendMentions: true,
		candidates: [
			{
				kind: "human",
				accountId: "emoji-fixture-person",
				label: "Fixture Person",
				member: true,
				bridgeOff: false,
			},
		],
	};
	const record = (
		body: string,
		attachments: readonly string[],
		clientRef?: string,
	) => {
		const mentions = stagedMentions(conversationId, body);
		setJournal((rows) => [
			...rows,
			{ mode, body, attachments, mentions, clientRef },
		]);
		clearStagedMentions(conversationId, body);
	};
	const root: TeamBridgeMessage = {
		id: "emoji-fixture-root",
		conversation_id: conversationId,
		seq: 1,
		sender: {
			account_id: "emoji-fixture-person",
			kind: "human",
			display_label: "Fixture Person",
		},
		body: "Synthetic thread root",
		origin: "human",
		created_at: "2026-11-02T00:00:00Z",
	};
	return (
		<QueryClientProvider client={client}>
			<MentionSourceContext.Provider value={source}>
				<div className="flex h-screen min-w-0 flex-col bg-surface text-ink">
					<output
						data-send-journal=""
						data-send-count={journal.length}
						className="max-h-40 shrink-0 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs"
					>
						{JSON.stringify({ mode, count: journal.length, sends: journal })}
					</output>
					{mode === "thread" ? (
						<div className="min-h-0 flex-1">
							<TeamBridgeThreadPaneView
								root={root}
								replies={[]}
								state="ready"
								conversationId={conversationId}
								labelFor={(sender) => sender.display_label}
								onClose={() => {}}
								onRetry={() => {}}
								onSend={async (body, clientRef, attachments = []) => {
									record(body, attachments, clientRef);
								}}
							/>
						</div>
					) : (
						<>
							<div className="min-h-0 flex-1" />
							<div className="shrink-0 px-4 pt-1 pb-4">
								<TeamBridgeComposer
									conversationId={conversationId}
									placeholder="Synthetic message"
									canAttach={false}
									onSendMessage={(body, attachments) => {
										record(body, attachments);
										return true;
									}}
								/>
							</div>
						</>
					)}
				</div>
			</MentionSourceContext.Provider>
		</QueryClientProvider>
	);
}

const meta = {
	title: "Team Bridge/Emoji autocomplete",
	component: AutocompleteFixture,
	parameters: { layout: "fullscreen" },
	args: { mode: "group" },
	render: (args) => <AutocompleteFixture key={args.mode} {...args} />,
} satisfies Meta<typeof AutocompleteFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MainDm: Story = { args: { mode: "dm" } };
export const MainAgentDm: Story = { args: { mode: "agent-dm" } };
export const MainChannel: Story = { args: { mode: "channel" } };
export const MainGroup: Story = { args: { mode: "group" } };
export const Thread: Story = { args: { mode: "thread" } };
