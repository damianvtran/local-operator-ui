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
	TeamBridgeUnreadOrganization,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeOrganization,
	conversationOrganizationName,
	conversationTitle,
	notificationPreference,
	storedLabel,
} from "./team-bridge-model";

/** The watcher's cadence. One number, so the hook and the tests agree. */
export const TEAM_BRIDGE_NOTIFY_POLL_MS = 30_000;

/**
 * How many organizations one poll may fan out to.
 *
 * The account unread answer is the org DISCOVERY read and deliberately carries
 * no conversation rows; the rows come from one tenant-scoped read per org. A
 * pathological membership list must not turn a 30 s timer into an unbounded
 * fan-out, so the poll takes the loudest organizations up to this bound. An
 * org outside the bound is not skipped permanently: next poll it can enter the
 * top slice if its count grows.
 */
export const TEAM_BRIDGE_NOTIFY_MAX_ORGS = 10;

/**
 * One tenant-scoped unread row, tagged with the organization it was read in.
 *
 * The wire row carries no tenant id (the read scope names it), and a
 * conversation belongs to exactly one organization, so the tag is the read's
 * own scope rather than a field the server might omit.
 */
export type TeamBridgeNotifyUnreadRow = {
	conversation_id: string;
	tenant_id: string;
	unread_count: number;
	last_read_seq: number;
	latest_seq: number;
};

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
	threadId?: string;
	conversationId: string;
	tenantId: string;
	seq: number;
	conversationName: string | null;
	organizationName: string | null;
	senderLabel: string | null;
	/** What the banner's subtitle names: a DM, a group, or a channel. */
	kind: TeamBridgeConversation["kind"];
	/** The conversation's own name (a channel's `name`), not the derived title. */
	name: string | null;
	/** The server's unread count for the reader, for the "N new messages" line. */
	unreadCount: number;
};

/**
 * The organizations one poll should read tenant-scoped unread for.
 *
 * The account answer is the ONLY org discovery source (the UI never invents a
 * membership list), and only an organization that reports unread can produce a
 * banner row. Selection is deterministic: loudest first, tenant id breaking
 * ties, bounded by `TEAM_BRIDGE_NOTIFY_MAX_ORGS`.
 *
 * An org with `unread: 0` is deliberately not queried: there can be no row to
 * notify about, and the next poll re-evaluates it when its total moves.
 */
export function teamBridgeNotifyOrganizations(
	unread: TeamBridgeUnread | undefined,
	max = TEAM_BRIDGE_NOTIFY_MAX_ORGS,
): TeamBridgeUnreadOrganization[] {
	return [...(unread?.organizations ?? [])]
		.filter((organization) => organization.eligible && organization.unread > 0)
		.sort(
			(a, b) => b.unread - a.unread || a.tenant_id.localeCompare(b.tenant_id),
		)
		.slice(0, max);
}

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
		"member" | "members" | "notify" | "muted" | "builtin"
	>,
	selfAccountId: string | undefined,
): boolean {
	return (
		isTeamBridgeMember(conversation, selfAccountId) &&
		notificationPreference(conversation) === "all" &&
		/*
		 * THE BUILT-IN #agents CHANNEL IS AGENT-TO-AGENT TRAFFIC. Its membership
		 * is every enrolled chief of staff, and a person who can see it sees a
		 * firehose of coordination they did not take part in; Slack's rule for a
		 * busy channel is "only when mentioned". Mention parsing does not exist
		 * yet, so "unless mentioned" is never true and the channel never raises
		 * a banner. When mentions ship, this is the line that learns them.
		 */
		conversation.builtin !== "agents"
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
		// The list row's label is the degraded-banner title (the message read that
		// names the sender can fail, and a thread reply is invisible to it), so the
		// legacy "Member" placeholder is dropped here exactly as the rail drops it.
		senderLabel: storedLabel(conversation.last_sender_label ?? ""),
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
	/**
	 * The tenant-scoped unread rows for ONE organization. The watcher calls this
	 * once per organization because the account read cannot answer with rows.
	 */
	rows: readonly TeamBridgeNotifyUnreadRow[];
	organizations: readonly TeamBridgeOrganization[];
	selfAccountId: string | undefined;
	cursors: TeamBridgeNotifyCursors;
	/** False until this organization's first unread answer has been seen. */
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
 * that list is deliberately NOT advanced: without metadata this module cannot
 * prove membership, and advancing would swallow a new conversation's first
 * message while the two reads race. The next poll asks again with metadata.
 */
export function planTeamBridgeNotifications(
	input: TeamBridgeNotifyPlanInput,
): TeamBridgeNotifyPlan {
	const cursors = new Map(input.cursors);
	const rows = input.rows;
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
		// Badge and summary are separate reads. Never pair one snapshot's seq with
		// another's root id (or advance past a reply before its root metadata arrives).
		if (conversation.latest_seq !== row.latest_seq) continue;
		cursors.set(row.conversation_id, row.latest_seq);
		if (!shouldNotifyTeamBridge(conversation, input.selfAccountId)) continue;
		if (input.quiet) continue;

		candidates.push({
			conversationId: conversation.id,
			...(conversation.last_thread_root_id
				? { threadId: conversation.last_thread_root_id }
				: {}),
			// The org the unread row was READ in, not a second derivation from the
			// list row: the click must land in the organization whose unread the
			// watcher actually saw.
			tenantId: row.tenant_id,
			seq: row.latest_seq,
			...teamBridgeNotificationSubject(
				conversation,
				input.selfAccountId,
				input.organizations,
			),
			kind: conversation.kind,
			name: conversation.name?.trim() || null,
			unreadCount: row.unread_count,
		});
	}

	return { candidates, cursors, seeded: true };
}
