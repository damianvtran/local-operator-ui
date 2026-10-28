import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeRecipient,
	composeChiefLabel,
	participantLabel,
	personDisplayLabel,
	personRowState,
} from "./team-bridge-model";

/**
 * Administration follows the server's per-conversation answer, never a guessed
 * organization role. An older server that omits `can_administer` therefore hides
 * member administration rather than offering writes that may not be authorized.
 */
export function canAdministerMembers(
	conversation: Pick<
		TeamBridgeConversation,
		"kind" | "status" | "builtin" | "can_administer"
	>,
): boolean {
	return (
		conversation.kind !== "dm" &&
		conversation.status === "open" &&
		!conversation.builtin &&
		conversation.can_administer === true
	);
}

export type TeamBridgeMemberCandidate = {
	recipient: TeamBridgeRecipient;
	/** A disabled row is visible with this reason instead of silently absent. */
	disabledReason:
		| "already_member"
		| "bridge_unavailable"
		| "agent_unavailable"
		| "agent_not_permitted"
		| null;
};

function memberKey(kind: "human" | "agent", accountId: string): string {
	return `${kind}:${accountId}`;
}

/** Current means active or invited: both must block a duplicate invitation. */
function currentMemberKeys(
	members: readonly TeamBridgeParticipant[],
): ReadonlySet<string> {
	return new Set(
		members
			.filter((member) => member.state === "active" || member.state === "invited")
			.map((member) => memberKey(member.kind, member.account_id)),
	);
}

/**
 * The add-member roster is derived from the whole organization directory, not
 * the direct-message candidate list. In particular, `chiefsOfStaff` deliberately
 * excludes the reader's own agent for DMs; inviting it into a group is a valid,
 * distinct action, so this function includes it.
 */
export function memberCandidates(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string | undefined,
	chiefLabel: (agentName: string, ownerLabel: string) => string,
): TeamBridgeMemberCandidate[] {
	const current = currentMemberKeys(conversation.members);
	const candidates: TeamBridgeMemberCandidate[] = [];
	for (const person of people) {
		const personLabel = personDisplayLabel(person);
		const humanState = personRowState(person, selfAccountId);
		const humanRecipient: TeamBridgeRecipient = {
			kind: "human",
			accountId: person.account_id,
			label: personLabel,
		};
		candidates.push({
			recipient: humanRecipient,
			disabledReason: current.has(memberKey("human", person.account_id))
				? "already_member"
				: humanState === "openable" ||
						humanState === "paused" ||
						humanState === "self"
					? null
					: "bridge_unavailable",
		});

		// The reader's own chief is intentionally NOT skipped. Adding it only
		// creates an invitation; owner consent remains a separate human action.
		const agent = person.agent;
		if (!agent) continue;
		const agentName = agent.name.trim();
		const agentRecipient: TeamBridgeRecipient = {
			kind: "agent",
			accountId: person.account_id,
			endpointId: agent.endpoint_id,
			agentName,
			ownerLabel: personLabel,
			label: chiefLabel(agentName, personLabel),
		};
		candidates.push({
			recipient: agentRecipient,
			disabledReason: current.has(memberKey("agent", person.account_id))
				? "already_member"
				: !conversation.agent_capable
					? "agent_not_permitted"
					: agent.state === "active" || agent.state === "paused"
						? null
						: "agent_unavailable",
		});
	}
	return candidates;
}

/**
 * The member list is server state, not the directory's roster. Invitation state
 * is rendered explicitly so an invited person/agent never appears active.
 */
export function currentMembers(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	chiefLabel: (agentName: string, ownerLabel: string) => string,
): Array<{
	member: TeamBridgeParticipant;
	label: string;
	state: "active" | "invited" | "left";
}> {
	return conversation.members
		.filter(
			(member) =>
				member.state === "active" ||
				member.state === "invited" ||
				member.state === "left",
		)
		.map((member) => {
			const label =
				participantLabel(
					member,
					people,
					participantChiefLabels(chiefLabel),
				) ?? member.account_id;
			return { member, label, state: member.state };
		});
}

/** Adapt the locale's one composed-label formatter to the shared participant helper. */
function participantChiefLabels(
	chiefLabel: (agentName: string, ownerLabel: string) => string,
): { named: (agentName: string, ownerLabel: string) => string; unnamed: (ownerLabel: string) => string } {
	return {
		named: chiefLabel,
		// Empty is a deliberate sentinel: composeChiefLabel treats it as the
		// directory's unnamed-agent case and calls this formatter.
		unnamed: (ownerLabel) => chiefLabel("", ownerLabel),
	};
}

/** Stable key for one pending write; only that row is disabled while it settles. */
export function memberMutationKey(member: TeamBridgeParticipant): string {
	return memberKey(member.kind, member.account_id);
}
