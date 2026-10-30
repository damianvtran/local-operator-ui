import { t } from "@shared/i18n";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
} from "../../../../../shared/team-bridge-contract";
import { type ChiefLabels, recipientMemberInput } from "../team-bridge-model";
import { type MentionCandidateRow, buildMentionCandidates } from "./candidates";
import { type MentionSource, MentionSourceContext } from "./mention-context";

const chiefLabels = (): ChiefLabels => ({
	named: (agent, person) => t("ui.teamBridge.chief.label", { agent, person }),
	unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
});

/**
 * Provides @-mentions for every composer under it (the channel composer and
 * the thread pane's), from the page's cached reads.
 *
 * Mounted only for an OPEN conversation: a new message has no members yet, so
 * every pick would be "not in this conversation" for a room that does not
 * exist. `conversation === null` therefore renders the children with no
 * provider, which is the composer's pre-mention behaviour.
 */
export function TeamBridgeMentionProvider({
	conversation,
	people,
	selfAccountId,
	sendMentions,
	onAddMembers,
	children,
}: {
	conversation: TeamBridgeConversation | null;
	people: readonly TeamBridgeDirectoryMember[];
	selfAccountId: string | undefined;
	sendMentions: boolean;
	onAddMembers?: (
		conversation: TeamBridgeConversation,
		members: TeamBridgeMemberInput[],
	) => Promise<unknown>;
	children: ReactNode;
}) {
	const value = useMemo<MentionSource | null>(() => {
		if (!conversation) return null;
		const candidates = buildMentionCandidates({
			conversation,
			people,
			selfAccountId,
			chiefLabels: chiefLabels(),
			agentSecondary: (person) =>
				t("ui.teamBridge.mentions.agent_secondary", { person }),
		});
		const invite =
			onAddMembers && conversation.kind !== "dm"
				? (row: MentionCandidateRow) =>
						onAddMembers(conversation, [
							recipientMemberInput(
								row.kind === "agent"
									? {
											kind: "agent",
											accountId: row.accountId,
											endpointId: row.endpointId ?? "",
											label: row.label,
										}
									: {
											kind: "human",
											accountId: row.accountId,
											label: row.label,
										},
							),
						])
				: undefined;
		return {
			conversationId: conversation.id,
			candidates,
			conversationKind: conversation.kind,
			sendMentions,
			onInvite: invite,
		};
	}, [conversation, people, selfAccountId, sendMentions, onAddMembers]);
	if (!value) return <>{children}</>;
	return (
		<MentionSourceContext.Provider value={value}>
			{children}
		</MentionSourceContext.Provider>
	);
}
