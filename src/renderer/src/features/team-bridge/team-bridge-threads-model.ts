import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";

/** The facepile shows at most this many repliers; the hub caps its list at three too. */
export const THREAD_FACEPILE_MAX = 3;

/**
 * One replier on a thread row: always a label (the facepile's initial
 * fallback), plus an id and kind when the hub sent `reply_participant_ids`.
 * The id lets the row resolve a real avatar through the directory and keep the
 * agent mark; without it the row can only draw an initial.
 */
export type ThreadParticipant = {
	label: string;
	accountId?: string;
	kind?: "human" | "agent";
};

export function threadSummary(message: TeamBridgeMessage) {
	const count = message.reply_count ?? 0;
	return {
		count,
		participants: threadParticipants(message),
		lastReply:
			message.last_reply_at &&
			Number.isFinite(Date.parse(message.last_reply_at))
				? new Date(message.last_reply_at)
				: null,
		/*
		 * `undefined` means THE HUB CANNOT TELL (pre-TR1), never "read": the row
		 * draws no badge and no emphasis rather than claiming a thread is read
		 * on a server that does not track it.
		 */
		unread: message.thread_unread_count,
	};
}

/**
 * Merge `reply_participants` (labels) with the parallel
 * `reply_participant_ids` by INDEX — the hub emits both in the same order.
 * Labels lead: they are what every hub sends, so an id list that is shorter,
 * longer or absent never drops or invents a replier. An id row only enriches
 * the label at its own position.
 */
export function threadParticipants(
	message: Pick<
		TeamBridgeMessage,
		"reply_participants" | "reply_participant_ids"
	>,
): ThreadParticipant[] {
	const ids = message.reply_participant_ids ?? [];
	return (message.reply_participants ?? [])
		.slice(0, THREAD_FACEPILE_MAX)
		.map((label, index) => {
			const id = ids[index];
			return id
				? { label, accountId: id.account_id, kind: id.kind }
				: { label };
		});
}

/**
 * Which phrasing the "last reply" clause takes, decided by calendar day (not
 * elapsed hours), the way `formatTurnTimestamp` decides a chat stamp: 23:50
 * yesterday read at 00:10 is "yesterday", which "20 minutes ago" would hide.
 * Pure and `now`-injected so every branch is testable; production passes the
 * default.
 */
export type LastReplyWhen = "today" | "yesterday" | "older";

export function lastReplyWhen(at: Date, now: Date = new Date()): LastReplyWhen {
	if (at.toDateString() === now.toDateString()) return "today";
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (at.toDateString() === yesterday.toDateString()) return "yesterday";
	return "older";
}
