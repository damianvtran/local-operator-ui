import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeRecipient,
	participantLabel,
	personDisplayLabel,
	personRowState,
} from "./team-bridge-model";

/*
 * MEMBER AUTHORITY COMES FROM THE HUB'S OWN RULES, NOT `can_administer`.
 *
 * `can_administer` on the conversation view is the ARCHIVE/DELETE authority
 * (`lifecycleAuthority` in agent-server): the conversation owner, or an
 * organization owner/admin on a channel. It is deliberately NOT reused here,
 * because the member routes enforce two different rules:
 *
 *   - POST /conversations/{id}/members (invite): any ACTIVE human member. The
 *     service's only membership proof is `loadForMember`, plus refusals for a
 *     DM, a built-in channel and an archived conversation.
 *   - DELETE /conversations/{id}/members/{account}: `requireOwner` — the
 *     caller's own active human row must have role "owner". The route is
 *     HUMAN-keyed (`BridgeConversationMemberKey(accountID, "")`), so it can
 *     never address an agent row; an invited agent is answered through consent
 *     (decline) and an active one through withdraw, not through this route.
 *
 * Reading the caller's own published member row is therefore not a second
 * opinion about authority: it is the same row the server reads, sent to this
 * client. An unresolved account fails closed (no controls).
 */

function selfHumanMember(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): TeamBridgeParticipant | null {
	if (!selfAccountId) return null;
	return (
		conversation.members.find(
			(member) =>
				member.kind === "human" &&
				member.account_id === selfAccountId &&
				member.state === "active",
		) ?? null
	);
}

/** The invite route's prerequisites, as the hub enforces them. */
export function canInviteMembers(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): boolean {
	return (
		conversation.kind !== "dm" &&
		conversation.status === "open" &&
		!conversation.builtin &&
		selfHumanMember(conversation, selfAccountId) !== null
	);
}

/** The remove route's prerequisite: the caller's active human row is the owner. */
export function canRemoveMembers(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
): boolean {
	const self = selfHumanMember(conversation, selfAccountId);
	return (
		conversation.kind !== "dm" &&
		conversation.status === "open" &&
		!conversation.builtin &&
		self !== null &&
		self.role === "owner"
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

/** Active and invited both block a duplicate invitation. */
function currentMemberKeys(
	members: readonly TeamBridgeParticipant[],
): ReadonlySet<string> {
	return new Set(
		members
			.filter(
				(member) => member.state === "active" || member.state === "invited",
			)
			.map((member) => memberKey(member.kind, member.account_id)),
	);
}

/**
 * The add-member roster is derived from the whole organization directory, not
 * the direct-message candidate list. In particular `chiefsOfStaff` deliberately
 * excludes the reader's own agent for DMs; inviting it into a group is a valid,
 * distinct action, so this function includes it. The label is the directory's
 * CURRENT agent name ("Aida (Ben)"), never a stored add-time label.
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
		candidates.push({
			recipient: {
				kind: "human",
				accountId: person.account_id,
				label: personLabel,
			},
			disabledReason: current.has(memberKey("human", person.account_id))
				? "already_member"
				: humanState === "openable" ||
						humanState === "paused" ||
						humanState === "self"
					? null
					: "bridge_unavailable",
		});

		// The reader's own chief is intentionally NOT skipped. Adding it creates
		// an invitation only; owner consent remains a separate human action.
		const agent = person.agent;
		if (!agent) continue;
		candidates.push({
			recipient: {
				kind: "agent",
				accountId: person.account_id,
				endpointId: agent.endpoint_id,
				agentName: agent.name.trim(),
				ownerLabel: personLabel,
				label: chiefLabel(agent.name.trim(), personLabel),
			},
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

/*
 * Current membership only: active and invited.
 *
 * The conversation also carries `left` and `removed` participants: the server
 * keeps them so history reads correctly and so a person who left can be
 * invited back. Neither is a member of the room now, and listing them under a
 * "Current members" heading puts departed people beside a room they are not
 * in - the opposite of what the heading promises. `removed` is the invitation
 * outcome after a decline (see team-bridge-invitations-model), so the same
 * argument applies: a declined invitation is not an occupied seat.
 *
 * Both states stay ADDIABLE as candidates (`currentMemberKeys` blocks only
 * active and invited), which is how a declined or departed person is
 * re-invited from this same dialog.
 */

/** One row of the current-members list. */
export type TeamBridgeCurrentMember = {
	member: TeamBridgeParticipant;
	label: string;
	state: "active" | "invited";
	/*
	 * The remove route is human-keyed, so an agent row is never removable here:
	 * DELETE .../members/{account} would resolve the OWNER's human row, not the
	 * agent's. Invited agents are answered through consent, not this dialog.
	 */
	removable: boolean;
};

/**
 * The member list is server state, not the directory's roster. Invitation state
 * is rendered explicitly so an invited person/agent never appears active.
 * `canRemove` is the caller-level owner check; `selfAccountId` keeps the
 * owner's own "remove" out of the list (leaving is its own action).
 */
export function currentMembers(
	conversation: TeamBridgeConversation,
	people: readonly TeamBridgeDirectoryMember[],
	selfAccountId: string | undefined,
	chiefLabel: (agentName: string, ownerLabel: string) => string,
	canRemove: boolean,
): TeamBridgeCurrentMember[] {
	return conversation.members
		.flatMap((member) =>
			member.state === "active" || member.state === "invited"
				? [{ member, state: member.state }]
				: [],
		)
		.map(({ member, state }) => ({
			member,
			label:
				participantLabel(
					member,
					people,
					{
						named: chiefLabel,
						// Empty is the directory's unnamed-agent case; let the locale
						// formatter produce its own "X's chief of staff" wording.
						unnamed: (ownerLabel) => chiefLabel("", ownerLabel),
					},
					null,
				) ?? member.account_id,
			state,
			// `state` is active or invited here, so the only removal the route can
			// address is a human row that is not the reader's own.
			removable:
				canRemove &&
				member.kind === "human" &&
				member.account_id !== selfAccountId,
		}));
}
