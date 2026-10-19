import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";

/**
 * Pure render decisions for the Team Bridge page.
 *
 * Kept out of the components for the same reason the chat transcript's helpers
 * are: a title rule, a member sort or an unread total is testable without a
 * DOM, and a component that re-derives one is how the list row and the thread
 * header come to disagree about what a conversation is called.
 */

/**
 * The name to render for a conversation.
 *
 * - a named group/channel uses its name;
 * - a DM is named for the OTHER person (and, when that person is an agent, the
 *   agent's own label), because "Direct message" as a title tells the reader
 *   nothing about who they are talking to;
 * - an unnamed group/channel lists its members, capped so a 40-person channel
 *   does not turn the row into a paragraph.
 *
 * Returns `null` when nothing can be named; the caller renders its untitled
 * copy rather than an empty string.
 */
export function conversationTitle(
	conversation: TeamBridgeConversation,
	selfAccountId?: string,
): string | null {
	const name = conversation.name?.trim();
	if (name) return name;
	const others = conversation.members.filter(
		(member) =>
			member.state !== "removed" &&
			!(member.kind === "human" && member.account_id === selfAccountId),
	);
	if (conversation.kind === "dm") {
		const other =
			others.find((member) => member.state === "active") ?? others[0];
		return other?.display_label ?? null;
	}
	const labels = others
		.filter((member) => member.state === "active")
		.map((member) => member.display_label);
	if (labels.length === 0) return null;
	if (labels.length <= 3) return labels.join(", ");
	return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/** The icon/glyph family a conversation row uses, before Lucide picks one. */
export function conversationGlyph(
	conversation: TeamBridgeConversation,
): "hash" | "users" | "at" {
	if (conversation.kind === "channel") return "hash";
	if (conversation.kind === "group") return "users";
	return "at";
}

/** True when at least one ACTIVE member is an agent. Badges read this. */
export function hasAgentParticipant(
	conversation: TeamBridgeConversation,
): boolean {
	return conversation.members.some(
		(member) => member.kind === "agent" && member.state === "active",
	);
}

/**
 * The members a reader sees, in a stable order.
 *
 * Active people first, then agents, then invited people: the header's badges
 * and the create dialog's summary both read this order, so "who is in this
 * conversation" answers the same way wherever it is asked.
 */
export function orderedMembers(
	conversation: TeamBridgeConversation,
): TeamBridgeParticipant[] {
	const rank = (member: TeamBridgeParticipant): number => {
		if (member.state === "active" && member.kind === "human") return 0;
		if (member.state === "active" && member.kind === "agent") return 1;
		if (member.state === "invited") return 2;
		return 3;
	};
	return [...conversation.members].sort((a, b) => rank(a) - rank(b));
}

/**
 * The badge'able total: unmuted unread, exactly the server's `total`.
 *
 * A muted conversation still shows its count on its own row (the user may want
 * to look), but it does not raise the sidebar badge — that is the one place a
 * mute has to be honoured, because the badge is what interrupts.
 */
export function badgeTotal(unread: {
	total: number;
	conversations: Array<{ muted: boolean; unread_count: number }>;
}): number {
	const summed = unread.conversations
		.filter((row) => !row.muted)
		.reduce((sum, row) => sum + row.unread_count, 0);
	// The server's total is authoritative when it says something is waiting. A
	// zero total beside non-zero rows means the two reads raced (a message
	// arrived between them), and falling back to the rows is the answer that
	// cannot undercount.
	if (Number.isFinite(unread.total) && unread.total > 0) {
		return Math.max(0, unread.total);
	}
	return summed;
}

/**
 * Whether the page should claim the attention it is showing.
 *
 * A visible window is already showing the conversation list; a notification on
 * top of it would be noise. The caller passes `document.visibilityState` so a
 * test does not need a DOM.
 */
export function shouldNotify(
	visibility: "visible" | "hidden" | "prerender",
): boolean {
	return visibility === "hidden";
}

/** The messages in display order: oldest first, gaps allowed (purged history). */
export function chronological(
	messages: TeamBridgeMessage[],
): TeamBridgeMessage[] {
	return [...messages].sort((a, b) => a.seq - b.seq);
}
