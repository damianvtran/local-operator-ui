/**
 * The Team Bridge OS-notification policy, as pure decisions.
 *
 * WHAT THIS MODULE IS NOT. It does not poll, render or deliver. The watcher
 * hook owns the 30 s cadence and the IPC call; main owns the native banner and
 * the persisted seq cursor. What lives here is the part that has to be
 * testable without a DOM, an Electron process or a backend: who may be
 * notified, how loudly, what the banner says, and whether a given unread
 * answer is new enough to interrupt someone.
 *
 * THE ONE RULE THAT MUST NOT DRIFT: a banner is raised only for a conversation
 * where the signed-in HUMAN is a member and the conversation's notify policy
 * is `all`. `mention` is silent in v1 because mention parsing is not
 * implemented; `mute` is silent because it was asked to be. A discoverable
 * channel the reader has not joined has no unread row on the server, and this
 * module would refuse it even if one appeared.
 *
 * FIRST LOAD IS A SEED, NOT A BURST. Unread that already existed when the app
 * started is badge state, not an event: the first complete answer advances
 * every cursor without raising anything. Only a later, strictly newer seq is a
 * candidate.
 */
import type {
	TeamBridgeConversation,
	TeamBridgeUnread,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeOrganization,
	conversationOrganizationName,
	conversationTitle,
	notificationPreference,
} from "./team-bridge-model";

/** The watcher's cadence. One number, so the hook and the tests agree. */
export const TEAM_BRIDGE_NOTIFY_POLL_MS = 30_000;

/**
 * One banner the renderer is asking main to raise.
 *
 * The parts, not the finished sentence: the hook applies the catalogue's own
 * copy at the edge, so this module stays a pure decision table and the tests
 * assert facts ("this is Ada, in the Minerva org") rather than one locale's
 * wording. `organizationName` is `null` when the caller cannot name the org;
 * the tenant id is not a human label and is never substituted.
 */
export type TeamBridgeNotifyCandidate = {
	conversationId: string;
	tenantId: string;
	seq: number;
	conversationName: string | null;
	organizationName: string | null;
	senderLabel: string | null;
};

/**
 * Whether the signed-in human is an active member of this conversation.
 *
 * THREE ANSWERS, NOT TWO. An explicit `member: true` is the server's word; an
 * explicit `member: false` is refused even if a member array disagrees, because
 * that is the discoverable-channel case the flag exists for. Absent means the
 * server predates the flag, so membership is derived from the member rows the
 * same page already carries - never assumed.
 */
export function isTeamBridgeMember(
	conversation: Pick<TeamBridgeConversation, "member" | "members">,
	selfAccountId: string | undefined,
): boolean {
	if (conversation.member === true) return true;
	if (conversation.member === false) return false;
	if (!selfAccountId) return false;
	return conversation.members.some(
		(member) =>
			member.kind === "human" &&
			member.account_id === selfAccountId &&
			member.state === "active",
	);
}

/**
 * Whether this conversation may raise an OS banner at all.
 *
 * Membership AND the loudest register. Deliberately says nothing about quiet
 * hours, focus or dedupe: those are per-event questions applied by the
 * planner.
 */
export function shouldNotifyTeamBridge(
	conversation: Pick<
		TeamBridgeConversation,
		"member" | "members" | "notify" | "muted"
	>,
	selfAccountId: string | undefined,
): boolean {
	return (
		isTeamBridgeMember(conversation, selfAccountId) &&
		notificationPreference(conversation) === "all"
	);
}

/**
 * The banner's subject, split into the parts a translation needs.
 *
 * The conversation name is this app's existing title rule (a DM is named for
 * the other person), so the banner and the rail cannot disagree about what the
 * conversation is called. An organization the caller cannot name is omitted
 * rather than guessed. The sender is the list row's already-exposed label or
 * `null`; the caller's fallback copy is the honest sentence then.
 */
export function teamBridgeNotificationSubject(
	conversation: TeamBridgeConversation,
	selfAccountId: string | undefined,
	organizations: readonly TeamBridgeOrganization[],
): Pick<
	TeamBridgeNotifyCandidate,
	"conversationName" | "organizationName" | "senderLabel"
> {
	return {
		conversationName: conversationTitle(conversation, selfAccountId),
		organizationName: conversationOrganizationName(conversation, organizations),
		senderLabel: conversation.last_sender_label?.trim() || null,
	};
}

/** The cursor map the watcher carries between polls. */
export type TeamBridgeNotifyCursors = ReadonlyMap<string, number>;

/**
 * One planner answer: the banners to raise and the cursor map to carry into
 * the next poll.
 *
 * `cursors` is returned even when nothing is raised, because silence is a
 * decision that has to stick: a muted, mention-only, quiet or first-load row
 * advances too, or the next unfocus would banner a backlog the user already
 * saw.
 */
export type TeamBridgeNotifyPlan = {
	candidates: TeamBridgeNotifyCandidate[];
	cursors: Map<string, number>;
	seeded: boolean;
};

export type TeamBridgeNotifyPlanInput = {
	conversations: readonly TeamBridgeConversation[];
	unread: TeamBridgeUnread | undefined;
	organizations: readonly TeamBridgeOrganization[];
	selfAccountId: string | undefined;
	cursors: TeamBridgeNotifyCursors;
	/** False until one complete unread + conversation answer has been seen. */
	seeded: boolean;
	/**
	 * The app window is focused. Quiet when active: the badge and rail still
	 * update, but no OS banner interrupts the screen the user is already on.
	 */
	quiet: boolean;
};

/**
 * Decide what (if anything) this poll should raise.
 *
 * `conversations` is the account-scoped list, so every row carries its own
 * tenant and the membership facts. An unread row whose conversation is not in
 * that list is advanced without notifying: without metadata this module
 * cannot prove membership, and a banner is not worth guessing about.
 */
export function planTeamBridgeNotifications(
	input: TeamBridgeNotifyPlanInput,
): TeamBridgeNotifyPlan {
	const cursors = new Map(input.cursors);
	const rows = input.unread?.conversations ?? [];
	const firstAnswer = !input.seeded;

	if (firstAnswer) {
		for (const row of rows) {
			cursors.set(row.conversation_id, row.latest_seq);
		}
		return { candidates: [], cursors, seeded: true };
	}

	const byId = new Map(
		input.conversations.map((conversation) => [conversation.id, conversation]),
	);
	const candidates: TeamBridgeNotifyCandidate[] = [];

	for (const row of rows) {
		const previous = cursors.get(row.conversation_id);
		if (
			row.unread_count === 0 ||
			row.latest_seq <= row.last_read_seq ||
			(previous !== undefined && row.latest_seq <= previous)
		) {
			// Still advance over a read row: the server can clear unread without
			// moving `latest_seq`, and a cursor left behind would make the NEXT
			// message's seq look like a jump.
			if (previous === undefined || row.latest_seq > previous) {
				cursors.set(row.conversation_id, row.latest_seq);
			}
			continue;
		}

		const conversation = byId.get(row.conversation_id);
		/*
		 * NO METADATA, NO DECISION - and NO ADVANCE. The two reads are separate
		 * requests, so an unread row can arrive one render before the
		 * conversation list that proves membership. Advancing here would swallow
		 * a new conversation's first message; leaving the cursor alone makes the
		 * next poll ask the same question again, when the metadata is there.
		 */
		if (conversation === undefined) continue;
		cursors.set(row.conversation_id, row.latest_seq);
		if (!shouldNotifyTeamBridge(conversation, input.selfAccountId)) continue;
		if (input.quiet) continue;

		candidates.push({
			conversationId: conversation.id,
			tenantId: conversation.tenant_id,
			seq: row.latest_seq,
			...teamBridgeNotificationSubject(
				conversation,
				input.selfAccountId,
				input.organizations,
			),
		});
	}

	return { candidates, cursors, seeded: true };
}
