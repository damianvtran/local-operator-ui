import { t } from "@shared/i18n";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMemberInput,
} from "../../../../../shared/team-bridge-contract";
import {
	type ChiefLabels,
	nameKey,
	personDisplayLabel,
	recipientMemberInput,
} from "../team-bridge-model";
import { type MentionCandidateRow, buildMentionCandidates } from "./candidates";
import { type MentionSource, MentionSourceContext } from "./mention-context";

const chiefLabels = (): ChiefLabels => ({
	named: (agent, person) => t("ui.teamBridge.chief.label", { agent, person }),
	unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
});

/**
 * The reader as message highlighting sees them.
 *
 * IDENTITY IS THE AUTHENTICATED ACCOUNT, never the directory. `self` used to
 * be built only when the directory held the reader's own row, so a directory
 * that had not answered (or a merged view whose tenant roster is absent) left
 * `self` null and every wire `mentions[]` row naming the reader rendered in
 * the "other" accent. The account id is known whenever `selfAccountId` is;
 * only the LABEL depends on a roster, and it falls back from the directory row
 * to the conversation's own participant row, then to "" (identity known, no
 * text to match - the wire path then highlights nothing for it rather than
 * guessing a spelling).
 *
 * `labelUnique` is the one input the name-matching fallback may use to choose
 * the viewer treatment (see `message-mentions.ts`): it is true only when no
 * OTHER account in the directory and no other participant of this
 * conversation, in any state, displays the same name. A departed member
 * still counts, because their old messages may mention them.
 *
 * "The same name" is `nameKey` (case, spacing and NFKC folded), deliberately
 * looser than the case-sensitive match that finds the mention: a reader takes
 * "damian tran" and "Damian  Tran" for the same person, so a twin spelled that
 * way must keep the reader's yellow off rather than let a hand-typed mention
 * meant for the twin turn yellow (review R1 M1). Looser here only ever makes
 * the viewer treatment rarer.
 *
 * The reader's OWN rows never count as a namesake, agent rows included: a
 * legacy agent participant stored under the owner's bare name (see
 * `storedAgentName`) is still the reader's, and counting it suppressed the
 * reader's yellow in every room their agent had joined (review R1 M2).
 */
function mentionSelf(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string,
): NonNullable<MentionSource["self"]> {
	const directoryRow = people.find((row) => row.account_id === selfAccountId);
	const memberRow = conversation.members.find(
		(row) => row.kind === "human" && row.account_id === selfAccountId,
	);
	const label = directoryRow
		? personDisplayLabel(directoryRow)
		: (memberRow?.display_label.trim() ?? "");
	const key = nameKey(label);
	const labelUnique =
		label !== "" &&
		!people.some(
			(row) =>
				row.account_id !== selfAccountId &&
				nameKey(personDisplayLabel(row)) === key,
		) &&
		!conversation.members.some(
			(member) =>
				member.account_id !== selfAccountId &&
				nameKey(member.display_label) === key,
		);
	return { accountId: selfAccountId, label, labelUnique };
}

/**
 * Provides @-mentions for every composer under it (the channel composer and
 * the thread pane's), from the page's cached reads.
 *
 * A new message has no members yet, so a null source keeps mentions unavailable
 * until its conversation exists. Keep the provider mounted even then: changing
 * a fragment into a provider remounts the whole page, including optimistic rows
 * during the draft-to-conversation handoff. The page separately keys the boundary
 * by account and tenant; privacy takes precedence over continuity across either.
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
			agentRole: t("ui.teamBridge.chief.fallback"),
		});
		/*
		 * Invite is offered only where it can work: not in a DM (fixed
		 * membership), not for someone already invited, and never for an agent
		 * without an endpoint - add-members would receive an empty
		 * `endpoint_id` (review R1-05). `canInvite` gates the button.
		 */
		const invite =
			onAddMembers && conversation.kind !== "dm"
				? (row: MentionCandidateRow) =>
						onAddMembers(conversation, [
							recipientMemberInput(
								row.kind === "agent"
									? {
											kind: "agent",
											accountId: row.accountId,
											endpointId: row.endpointId as string,
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
			// Ownership cannot depend on the directory having loaded a self row:
			// the authenticated account and conversation tenant are the boundary.
			draftOwner: selfAccountId
				? { accountId: selfAccountId, tenantId: conversation.tenant_id }
				: null,
			self: selfAccountId
				? mentionSelf(conversation, people, selfAccountId)
				: null,
			candidates,
			conversationKind: conversation.kind,
			sendMentions,
			onInvite: invite,
			canInvite: (row: MentionCandidateRow) =>
				invite !== undefined &&
				!row.invited &&
				(row.kind === "human" || Boolean(row.endpointId)),
		};
	}, [conversation, people, selfAccountId, sendMentions, onAddMembers]);
	return (
		<MentionSourceContext.Provider value={value}>
			{children}
		</MentionSourceContext.Provider>
	);
}
