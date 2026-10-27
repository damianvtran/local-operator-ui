/**
 * Pending AGENT invitations: what the Invitations view lists and the rail counts.
 *
 * WHY THIS EXISTS. When a teammate adds your chief of staff to a channel or a
 * group, agent-server creates its member row `invited` with `joined_seq=0`
 * (TEAM-BRIDGE-CONVERSATIONS.md §6.2). It becomes `active` only when ITS OWNER
 * answers `POST .../members/{account}/consent` — the agent can never accept
 * for itself, and nobody else can accept for it. No feed event announces the
 * invitation, so the conversation list is the only place it shows: the caller's
 * list already carries every member row with its state.
 *
 * Pure functions only (no React, no transport), so the decisions below are
 * tested against the shipped TypeScript (`scripts/team-bridge-invitations.test.mjs`).
 */
import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import { conversationTitle, storedLabel } from "./team-bridge-model";

/**
 * The participation version the hub accepts (`bridgeAgentParticipationVersion`).
 *
 * PINNED HERE BECAUSE THE SERVER DOES NOT SERVE IT YET. The design says the
 * participation text and version are server-served; agent-server today only
 * checks the constant and refuses any other value with 409
 * `consent_version_unknown`. Until a served version exists the client echoes
 * the one the hub knows and shows its own copy
 * (`ui.teamBridge.invitations.consent`); when the hub serves a newer version
 * this pin is what answers `consent_version_unknown`, which the view reports as
 * "update the app" rather than as a retryable failure.
 */
export const TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION =
	"bridge_agent_participation_v1";

export type TeamBridgeInvitation = {
	/** `tenant|conversation`: a conversation id is unique only inside its org. */
	key: string;
	conversationId: string;
	tenantId: string;
	conversationKind: TeamBridgeConversation["kind"];
	/** The channel or group name, or null when nothing can be named. */
	conversationName: string | null;
	/** The invited agent's own label, or null when the row has none. */
	agentName: string | null;
	/**
	 * Who the row can honestly name, and as what: `added` when the server says
	 * who added the agent, `created` when it only says who created the
	 * conversation, null when it says neither. `self` is the reader.
	 */
	inviter:
		| { role: "added" | "created"; name: string; self: false }
		| { role: "added" | "created"; self: true }
		| null;
};

/**
 * Who the row may name, from what the server publishes.
 *
 * agent-server STORES the inviter (`invited_by`) but does not serialize it
 * (`json:"-"`), and the participant view carries no `added_at` either, so the
 * person who added the agent is not knowable today. The two honest readings:
 *
 * 1. a served `invited_by` account id on the agent row (additive; the schema
 *    passes unknown fields through) - "Added by Ada";
 * 2. otherwise the conversation's served `created_by` - "Created by Ada". That
 *    is a different fact, and the copy says so: a later add could have been
 *    any member, so the creator is never presented as the inviter.
 *
 * A label that does not resolve to a human member answers null and the row
 * omits the line rather than printing an account id.
 */
function inviterOf(
	conversation: TeamBridgeConversation,
	agent: TeamBridgeParticipant,
	selfAccountId: string,
): TeamBridgeInvitation["inviter"] {
	const served = (agent as { invited_by?: unknown }).invited_by;
	const [role, accountId] =
		typeof served === "string" && served !== ""
			? (["added", served] as const)
			: (["created", conversation.created_by] as const);
	if (accountId === selfAccountId) return { role, self: true };
	const name = humanLabel(conversation, accountId);
	return name ? { role, name, self: false } : null;
}

function humanLabel(
	conversation: TeamBridgeConversation,
	accountId: string,
): string | null {
	const human = conversation.members.find(
		(member) => member.kind === "human" && member.account_id === accountId,
	);
	return human ? storedLabel(human.display_label) : null;
}

/**
 * The caller's pending agent invitations in one conversation page.
 *
 * A row qualifies when it is an open, non-built-in conversation holding an
 * AGENT member owned by `selfAccountId` in state `invited`. A discoverable row
 * (a tenant channel the reader has not joined) still qualifies: the hub's
 * consent needs only the owner's org membership, not a human seat in the
 * channel, and the discoverable view still carries the member rows. Built-ins are
 * excluded because the hub refuses consent there (their membership follows the
 * endpoint's enrolment, §14.4), and an archived conversation cannot be joined.
 * Order follows the list (activity, newest first), so the view and the rail
 * agree without a second sort.
 */
export function pendingAgentInvitations(
	conversations: readonly TeamBridgeConversation[],
	selfAccountId: string | undefined,
): TeamBridgeInvitation[] {
	if (!selfAccountId) return [];
	const out: TeamBridgeInvitation[] = [];
	for (const conversation of conversations) {
		if (conversation.builtin || conversation.status !== "open") continue;
		const agent = conversation.members.find(
			(member) =>
				member.kind === "agent" &&
				member.account_id === selfAccountId &&
				member.state === "invited",
		);
		if (!agent) continue;
		out.push({
			key: `${conversation.tenant_id}|${conversation.id}`,
			conversationId: conversation.id,
			tenantId: conversation.tenant_id,
			conversationKind: conversation.kind,
			conversationName: conversationTitle(conversation, selfAccountId),
			agentName: storedLabel(agent.display_label),
			inviter: inviterOf(conversation, agent, selfAccountId),
		});
	}
	return out;
}

/**
 * The rows the view shows: everything it has shown while open, in first-seen
 * order, plus anything new.
 *
 * NO JITTER. An answer patches the cache at once, so the answered row drops out
 * of `pendingAgentInvitations` immediately; removing it from the view at that
 * moment would pull every row below it up under the pointer, and the next
 * click would land on a different invitation. The view therefore keeps an
 * answered row in place (showing its outcome) until it unmounts, and only
 * appends genuinely new invitations at the end.
 *
 * A row that left the pending set WITHOUT being answered here (answered on
 * another device, or the conversation was archived) is dropped: it is not this
 * view's outcome to show.
 */
export function stableInvitationRows(
	previous: readonly TeamBridgeInvitation[],
	current: readonly TeamBridgeInvitation[],
	answered: ReadonlySet<string>,
): TeamBridgeInvitation[] {
	const live = new Map(current.map((row) => [row.key, row]));
	const kept = previous.flatMap((row) => {
		const fresh = live.get(row.key);
		if (fresh) return [fresh];
		return answered.has(row.key) ? [row] : [];
	});
	const seen = new Set(kept.map((row) => row.key));
	return [...kept, ...current.filter((row) => !seen.has(row.key))];
}

/**
 * The optimistic patch for one answer, applied to every cached list page.
 *
 * Accept moves the caller's agent row to `active`; decline to `removed` —
 * exactly the server's two transitions. The member's `notify` is NEVER touched:
 * accepting must not unmute the agent (it joins on the agent default, `mute`,
 * and is woken only by mentions until its owner chooses otherwise). Paging
 * fields and every other row are preserved.
 */
export function withAgentInvitationAnswer(
	page: TeamBridgeConversationList,
	invitation: Pick<TeamBridgeInvitation, "conversationId" | "tenantId">,
	selfAccountId: string,
	decision: "accept" | "decline",
): TeamBridgeConversationList {
	const state = decision === "accept" ? "active" : "removed";
	return {
		...page,
		conversations: page.conversations.map((row) =>
			row.id === invitation.conversationId &&
			row.tenant_id === invitation.tenantId
				? {
						...row,
						members: row.members.map((member) =>
							member.kind === "agent" &&
							member.account_id === selfAccountId &&
							member.state === "invited"
								? { ...member, state }
								: member,
						),
					}
				: row,
		),
	};
}

/**
 * Why an answer was refused, from the hub's own code — never its sentence.
 *
 * Each kind maps to one sentence the view owns. The codes are agent-server's
 * `Consent` refusals: `agent_not_permitted` (the endpoint is not this owner's,
 * not active, or its enrolment consent is not bound to this membership),
 * `invalid_transition` (the row is no longer invited), `member_not_found` /
 * `conversation_not_found` (the invitation is gone), `consent_version_unknown`
 * (this client's pinned version is stale) and the plan/kill refusals.
 */
export type InvitationFailureKind =
	| "agent_unavailable"
	| "already_answered"
	| "gone"
	| "outdated"
	| "not_available"
	| "sign_in"
	| "unreachable"
	| "unconfirmed";

export function invitationFailureKind(error: unknown): InvitationFailureKind {
	const candidate = error as { status?: unknown; code?: unknown } | null;
	const status =
		typeof candidate?.status === "number" ? candidate.status : null;
	const code = typeof candidate?.code === "string" ? candidate.code : null;
	if (status === 401 || code === "bridge_signin_required") return "sign_in";
	if (code === "agent_not_permitted") return "agent_unavailable";
	if (code === "invalid_transition") return "already_answered";
	if (code === "member_not_found" || code === "conversation_not_found")
		return "gone";
	if (code === "consent_version_unknown") return "outdated";
	if (code === "bridge_not_available" || code === "bridge_disabled")
		return "not_available";
	// A transport failure never reached the hub; anything else answered without
	// a code this view knows, so the decision is unconfirmed, not refused.
	if (status === null && error instanceof Error && "status" in error)
		return "unreachable";
	return "unconfirmed";
}
