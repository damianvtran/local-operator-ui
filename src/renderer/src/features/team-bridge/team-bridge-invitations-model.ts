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
 * KNOWN LIMITS OF THAT SOURCE (review round 1, R4/R5). It is a stopgap until
 * agent-server's owner-invitations read (`GET /v1/messaging/agents/owned/
 * invitations`, paginated, with `invited_by_label`) ships and core passes it
 * through; this module then switches to it.
 *  - FIRST PAGE ONLY: the rail loads one list page (up to 50 rows, no paging),
 *    so an invitation to a quiet older conversation is neither counted nor
 *    listed.
 *  - OWNER-MEMBER ONLY: the list returns conversations where the caller's
 *    HUMAN row is a member, plus tenant channels it can discover. An agent
 *    added to a private channel or group its owner is not in never appears.
 *
 * Pure functions only (no React, no transport), so the decisions below are
 * tested against the shipped TypeScript (`scripts/team-bridge-invitations.test.mjs`).
 */
import {
	TEAM_BRIDGE_OWNER_GUARD_UNAVAILABLE,
	type TeamBridgeConversation,
	type TeamBridgeConversationList,
	type TeamBridgeParticipant,
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
 * (`TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY`); when the hub serves a newer version
 * this pin is what answers `consent_version_unknown`, which the view reports as
 * "update the app" rather than as a retryable failure.
 */
export const TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION =
	"bridge_agent_participation_v1";

/**
 * The consent statement for THAT version, as an i18n key named for it.
 *
 * DECISION (review round 1, R1): the design calls the participation text
 * "server-served"; the hub serves none yet, so the text is embedded. To keep
 * the embedded text honest about what was agreed to, the key carries the
 * version, and `scripts/team-bridge-invitations.test.mjs` pins the English
 * text beside this pair: editing the copy fails that test until the version
 * (and the key) move with it. Seven translations are then consent to exactly
 * the text recorded under that version.
 */
export const TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY =
	`ui.teamBridge.invitations.consent.${TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION}` as const;

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
 * Whether the rail shows its Invitations entry, given what it showed last.
 *
 * The entry exists only while something waits (or the view is open), so it
 * mounts and unmounts as the list re-reads - and a 30 px row appearing above
 * the conversation list moves every row under a pointer that is about to
 * click one (review round 1, N1). The change is therefore HELD while the
 * pointer is over the rail and applied when it leaves: the reader never sees
 * the list move under them, and a rail nobody is pointing at still shows no
 * row when nothing waits.
 */
export function railInvitationsEntryShown(
	shownBefore: boolean,
	wanted: boolean,
	pointerInRail: boolean,
): boolean {
	return pointerInRail ? shownBefore : wanted;
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
	return withSelfAgentState(
		page,
		invitation,
		selfAccountId,
		"invited",
		decision === "accept" ? "active" : "removed",
	);
}

/**
 * The exact inverse of `withAgentInvitationAnswer`, for a refused answer.
 *
 * WHY AN INVERSE PATCH, NOT A SNAPSHOT RESTORE (review round 1, R3). The view
 * lets the owner answer several rows at once. A whole-page snapshot taken by
 * the second answer already holds the first answer's optimistic state, so
 * restoring snapshots in refusal order left the first row "joined" after both
 * were refused. Reverting only this conversation's own agent row, and only
 * from the state this answer wrote, composes with any other answer in flight.
 * A refetch that already landed the answer is indistinguishable from this
 * write (the deadline-but-applied case), so the unconditional `onSettled`
 * refetch — not this patch — is what corrects the cache to the server's truth.
 */
export function withoutAgentInvitationAnswer(
	page: TeamBridgeConversationList,
	invitation: Pick<TeamBridgeInvitation, "conversationId" | "tenantId">,
	selfAccountId: string,
	decision: "accept" | "decline",
): TeamBridgeConversationList {
	return withSelfAgentState(
		page,
		invitation,
		selfAccountId,
		decision === "accept" ? "active" : "removed",
		"invited",
	);
}

function withSelfAgentState(
	page: TeamBridgeConversationList,
	invitation: Pick<TeamBridgeInvitation, "conversationId" | "tenantId">,
	selfAccountId: string,
	from: TeamBridgeParticipant["state"],
	state: TeamBridgeParticipant["state"],
): TeamBridgeConversationList {
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
							member.state === from
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
 * `invalid_transition` (the row is no longer invited; the server's answer for
 * this names `details.rule=not_invited`, and `rule=builtin` is the built-in
 * refusal, which eligibility already excludes), `member_not_found` /
 * `conversation_not_found` (the invitation is gone), `consent_version_unknown`
 * (this client's pinned version is stale) and the plan/kill refusals.
 */
export type InvitationFailureKind =
	| "agent_unavailable"
	| "already_answered"
	| "gone"
	| "outdated"
	| "runtime_outdated"
	| "not_available"
	| "sign_in"
	| "unreachable"
	| "unconfirmed";

export function invitationFailureKind(error: unknown): InvitationFailureKind {
	const candidate = error as {
		status?: unknown;
		code?: unknown;
		detail?: { details?: { rule?: unknown } };
	} | null;
	const status =
		typeof candidate?.status === "number" ? candidate.status : null;
	const code = typeof candidate?.code === "string" ? candidate.code : null;
	const rule = candidate?.detail?.details?.rule;
	if (status === 401 || code === "bridge_signin_required") return "sign_in";
	if (code === "agent_not_permitted") return "agent_unavailable";
	if (code === "invalid_transition")
		return rule === "builtin" ? "gone" : "already_answered";
	// The runtime cannot bind the write to its owner (R7): only a runtime update
	// helps, which is a different sentence from the stale-participation-version
	// one (review round 2, M3).
	if (code === TEAM_BRIDGE_OWNER_GUARD_UNAVAILABLE) return "runtime_outdated";
	if (code === "member_not_found" || code === "conversation_not_found")
		return "gone";
	if (code === "consent_version_unknown") return "outdated";
	if (code === "bridge_not_available" || code === "bridge_disabled")
		return "not_available";
	/*
	 * "Nothing was changed" is claimed ONLY for a status-null failure with NO
	 * code: the IPC call itself failed, so the request never left this machine.
	 * A CODED status-null failure is not that: `deadline_exceeded` means the
	 * request was sent and may have been applied (review round 1, R2). It and
	 * every other unknown answer are unconfirmed, never "nothing changed".
	 */
	if (
		status === null &&
		code === null &&
		error instanceof Error &&
		"status" in error
	)
		return "unreachable";
	return "unconfirmed";
}
