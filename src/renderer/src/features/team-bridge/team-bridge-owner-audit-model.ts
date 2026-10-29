import type {
	OwnerAuditConversation,
	OwnerAuditMessage,
} from "../../../../shared/team-bridge-owner-audit-contract";

/** Missing verdict is normal only on the audited agent's own messages. Treat
 * future/missing verdicts conservatively without inventing an admission. */
export function ownerAuditDelivery(
	message: OwnerAuditMessage,
	agentAccountId: string,
) {
	if (message.agent_delivery_status === "admitted") return "admitted";
	if (message.agent_delivery_status === "rejected") return "rejected";
	if (message.agent_delivery_status === "not_screened") return "not_screened";
	if (
		!message.agent_delivery_status &&
		message.sender.kind === "agent" &&
		message.sender.account_id === agentAccountId
	)
		return "own";
	return "unknown";
}

export function ownerAuditTitle(
	conversation: OwnerAuditConversation,
	fallback: string,
) {
	return (
		conversation.name?.trim() ||
		conversation.members
			.map((member) => member.display_label.trim())
			.filter(Boolean)
			.join(", ") ||
		fallback
	);
}

/** Both history and inclusive thread pages can overlap. Never show a duplicate
 * boundary row, and keep chronology independent of the server page direction.
 *
 * A LATER COPY NEVER BLANKS TEXT ALREADY SHOWN. `after_seq` is inclusive on the
 * replies route, so the boundary row arrives twice; the second copy is normally
 * the fresher one and wins, but a copy that arrives without a body (a projection
 * that omitted it, a page whose body was withheld) must not erase the body the
 * reader can already see. Preferring the copy with text costs nothing when both
 * carry it, which is the ordinary case. */
export function ownerAuditChronology(
	pages: ReadonlyArray<ReadonlyArray<OwnerAuditMessage>>,
) {
	const messages = new Map<string, OwnerAuditMessage>();
	for (const page of pages)
		for (const message of page) {
			const seen = messages.get(message.id);
			if (seen?.body && !message.body) continue;
			messages.set(message.id, message);
		}
	return [...messages.values()].sort((a, b) => a.seq - b.seq);
}
