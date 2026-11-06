import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import type {
	OwnerAuditConversation,
	OwnerAuditMessage,
} from "../../../../shared/team-bridge-owner-audit-contract";
import {
	type ChiefLabels,
	memberStoredName,
	participantLabel,
	storedLabel,
} from "./team-bridge-model";

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
		/*
		 * Through `memberStoredName`, as `conversationTitle` reads the same rows:
		 * a raw stored label titled a thread "Ana, Ben Tran (Ben Tran), Member"
		 * (review m1 on #1643). An unknown kind reads as a human label.
		 */
		conversation.members
			.map((member) =>
				memberStoredName({
					kind: member.kind === "agent" ? "agent" : "human",
					display_label: member.display_label,
				}),
			)
			.filter((label): label is string => label !== null)
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
	// Sequence is unique on today's hub, but defensive/tie fixtures must still
	// have one deterministic display order independent of overlapping page order.
	return [...messages.values()].sort(
		(a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
}

/**
 * An audit row as the SHARED message list's input.
 *
 * WHY AN ADAPTER AND NOT A SECOND RENDERER. The audit view began as a wip slice
 * (c766a8c2daa) on its own wire shape, `OwnerAuditMessage`: nullable and
 * passthrough fields mirroring the proxy's `exclude_unset` projection, an
 * `agent_delivery_status` verdict, a body that may be null, and attachments
 * with no bytes behind them. Because nothing mapped that onto
 * `TeamBridgeMessage`, the transcript was drawn by hand and drifted from every
 * channel and DM (no markdown, avatar, runs or day dividers). This is that
 * missing map, kept pure so it is tested without a DOM; what only an audit adds
 * (the verdict, the null-body sentence, the attachment notes, thread replies) travels
 * separately through the list's `decorate` hook.
 *
 * WHAT IS DELIBERATELY NOT CARRIED OVER:
 * - `attachments`: the shared attachment component FETCHES BYTES, and this
 *   human-only surface must never load a private attachment. The caller names
 *   them from the wire row instead.
 * - `reactions`: an audit has none to show and none to add.
 * - the reply rollup (`reply_count`, `reply_participants`, `last_reply_at`):
 *   the list draws its "N replies" button only for a caller that can open the
 *   thread pane, which an audit never is; replies are read through the audit's
 *   own disclosure, fed from the wire row.
 *
 * NARROWING. `sender.kind` is a free string on this wire (hub vocabularies are
 * additive). `human` and `agent` pass through; anything else becomes `human`
 * MARKED `audit_unknown_kind` (a passthrough field), so the caller can refuse
 * to resolve it against the directory: drawing a person's name on a sender of
 * an unknown kind would be inventing an identity, whereas the stored label (or
 * the "Unknown person" placeholder) claims nothing. `body` keeps its null: null
 * means "the hub sent no text", which the row says in the open, and inventing
 * an empty string would draw an empty prose block instead.
 */
export function ownerAuditToBridgeMessage(
	message: OwnerAuditMessage,
): TeamBridgeMessage {
	const kind = ownerAuditSenderKind(message.sender.kind);
	return {
		id: message.id,
		conversation_id: message.conversation_id,
		seq: message.seq,
		sender: {
			account_id: message.sender.account_id,
			kind: kind ?? "human",
			display_label: message.sender.display_label,
			...(kind === null ? { audit_unknown_kind: true } : {}),
		},
		body: message.body ?? null,
		body_hash: message.body_hash ?? undefined,
		/* A missing, empty or future origin is NOT evidence of a person. The
		   delivery annotation discloses a coarse refusal class only for an
		   explicit `human` origin (the anti-oracle rule: agent-origin and
		   unknown-origin senders never get a category), so falling back to the
		   sender kind here used to turn an unknown origin into a human one and
		   leak the class. `system` is the closed vocabulary's only non-person,
		   non-agent value, so an unrecognised origin fails closed to it. */
		origin:
			message.origin === "human" ||
			message.origin === "agent" ||
			message.origin === "system"
				? message.origin
				: "system",
		agent_label: message.agent_label ?? undefined,
		created_at: message.created_at,
		thread_root_id: message.thread_root_id ?? undefined,
		// Carried so the owner sees why their agent refused or is holding a
		// message (`TeamBridgeDeliveryAnnotation`); the hub scopes the entries.
		delivery_states: message.delivery_states ?? undefined,
	};
}

/** `human` / `agent`, or null for a kind this build does not know. */
export function ownerAuditSenderKind(kind: string): "human" | "agent" | null {
	return kind === "human" || kind === "agent" ? kind : null;
}

/**
 * The name an audit row shows for its sender: the SAME rule a channel uses
 * (`participantLabel` against the tenant directory), so two agents called Aida
 * read "Aida (Damian Tran)" and "Aida (Ben Tran)" here exactly as they do in a
 * channel. When the directory has not answered (loading, failed, or the person
 * left the organization) the stored label still names the sender, then the
 * conversation's own member label for that account; only when all of those are
 * blank does the caller paint the shared "Unknown person/agent" placeholder.
 * `chiefLabels` is injected (as `participantLabel` takes it) so this module
 * stays pure: it is bundled for tests with no path aliases or catalogue.
 */
export function ownerAuditSenderLabel(
	sender: TeamBridgeMessage["sender"],
	people: readonly TeamBridgeDirectoryMember[],
	members: OwnerAuditConversation["members"],
	chiefLabels: ChiefLabels,
): string | null {
	if (sender.audit_unknown_kind === true)
		return storedLabel(sender.display_label);
	const resolved = participantLabel(sender, people, chiefLabels);
	if (resolved !== null) return resolved;
	const member = members.find(
		(row) => row.account_id === sender.account_id && row.kind === sender.kind,
	);
	return member
		? participantLabel(
				{ ...sender, display_label: member.display_label },
				people,
				chiefLabels,
			)
		: null;
}

/** The directory row behind a sender, never for a sender of unknown kind. */
export function ownerAuditSenderProfile(
	sender: TeamBridgeMessage["sender"],
	people: readonly TeamBridgeDirectoryMember[],
): TeamBridgeDirectoryMember | undefined {
	if (sender.audit_unknown_kind === true) return undefined;
	return people.find((row) => row.account_id === sender.account_id);
}
