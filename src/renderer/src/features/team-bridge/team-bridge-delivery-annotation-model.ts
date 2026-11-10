import type {
	TeamBridgeDeliveryState,
	TeamBridgeDeliverySummary,
} from "../../../../shared/team-bridge-contract";

/**
 * The view model behind the muted "not delivered" lines under a sent message
 * (Team Bridge delivery-state contract v1, "UI").
 *
 * WHY A PURE MODEL. The hub's vocabularies are closed today but the renderer
 * parses them as plain strings (`teamBridgeDeliveryStateSchema`), so a newer hub
 * that adds a state or class must not make this surface claim something it does
 * not know. Every narrowing decision lives here, where a unit test can pin it,
 * and the component only maps the result to copy.
 *
 * THE CONSERVATIVE RULES, each the safe reading of "I do not know this value":
 * - an unknown `state` renders NOTHING: it cannot be called refused or held,
 *   and silence is what `delivered` and "no data" already look like;
 * - an unknown `refusal_class` drops the parenthetical (the generic refusal);
 * - an unknown `hold_class` drops the reason (the generic hold).
 *
 * SECURITY SHAPE. The line names the recipient agent, its owner and, at most,
 * ONE coarse class from a closed list. It never reads anything else off the
 * entry: the hub sends no score, reason or body, and a passthrough field a
 * future hub adds stays unread until this model is deliberately extended.
 */

export const TEAM_BRIDGE_REFUSAL_CLASSES = [
	"manipulation",
	"personal_info",
	"abusive",
	"unsafe_content",
	"out_of_scope",
] as const;
export type TeamBridgeRefusalClass =
	(typeof TEAM_BRIDGE_REFUSAL_CLASSES)[number];

export const TEAM_BRIDGE_HOLD_CLASSES = [
	"screening_unavailable",
	"awaiting_review",
	"delivery_pending",
] as const;
export type TeamBridgeHoldClass = (typeof TEAM_BRIDGE_HOLD_CLASSES)[number];

/*
 * `pending` is the owner-view `delivery_pending` hold: screening finished and
 * only delivery is outstanding, so "waiting to be screened" would be false
 * (design review round 1, D1). It is its own line, not a held reason.
 */
export type TeamBridgeDeliveryLine =
	| {
			kind: "refused";
			key: string;
			agent: string;
			owner: string;
			refusalClass: TeamBridgeRefusalClass | null;
	  }
	| {
			kind: "held";
			key: string;
			agent: string;
			owner: string;
			holdReason: Exclude<TeamBridgeHoldClass, "delivery_pending"> | null;
	  }
	| { kind: "pending"; key: string; agent: string; owner: string };

const isRefusalClass = (value: unknown): value is TeamBridgeRefusalClass =>
	(TEAM_BRIDGE_REFUSAL_CLASSES as readonly unknown[]).includes(value);
const isHoldClass = (value: unknown): value is TeamBridgeHoldClass =>
	(TEAM_BRIDGE_HOLD_CLASSES as readonly unknown[]).includes(value);

/**
 * One line per non-delivered recipient, in the hub's order.
 *
 * Every line names its recipient (design review round 1, D5): an unnamed
 * "waiting" line beside named refusals reads as the whole message's status.
 * Naming discloses nothing new, since the sender already sees each agent
 * recipient's label. Lines are merged only WITHIN one recipient: the hub keys
 * entries by endpoint, so a repeated `endpoint_id` is a duplicate, and the
 * first entry wins (this also keeps React keys unique).
 *
 * `agent` and `owner` are the WIRE labels, trimmed and otherwise untouched:
 * the agent member's stored label (which an older client may have written
 * already composed, "Aida (Ben Tran)") and its owner's name. They are never
 * rendered as a pair. The component resolves them to ONE display label through
 * the shared `recipientLabel`, so the line names the recipient exactly as the
 * message rows do and the owner never twice (operator report, 2026-11-03). A
 * label that resolves to nobody renders the shared "Unknown agent" copy, so a
 * blank wire label never renders "Not delivered to  ()" (review R2).
 */
export function teamBridgeDeliveryLines(
	states: readonly TeamBridgeDeliveryState[] | undefined,
	source: {
		origin?: unknown;
		sender?: { kind?: unknown; audit_unknown_kind?: unknown };
	} = {},
): TeamBridgeDeliveryLine[] {
	if (!states || states.length === 0) return [];
	// Only a positively identified human-origin message may carry the hub's
	// already-clamped coarse hint. Never infer humanity from a missing sender:
	// agent/system/future origins stay generic even if a class was supplied.
	// The audit mapper marks unrecognized sender kinds while normalizing their
	// display shape to human, so that marker must also suppress disclosure.
	// The gate keys on the SENDER's origin, not on who is viewing, so it is
	// conservative for owner views: an owner auditing their agent's refusal of
	// an agent-sent message sees the generic line even though the hub sent them
	// the class. That is deliberate (anti-oracle default). Widening it for
	// owners needs a viewer-scoped flag from the hub plus its own security
	// review, never a renderer-side guess about who is looking.
	const knownHuman =
		source.origin === "human" &&
		source.sender?.kind === "human" &&
		source.sender.audit_unknown_kind !== true;
	const lines: TeamBridgeDeliveryLine[] = [];
	const seen = new Set<string>();
	for (const entry of states) {
		if (seen.has(entry.endpoint_id)) continue;
		const agent = entry.recipient_label.trim();
		const owner = entry.recipient_owner_label.trim();
		const key = `${entry.state}:${entry.endpoint_id}`;
		if (entry.state === "refused") {
			seen.add(entry.endpoint_id);
			lines.push({
				kind: "refused",
				key,
				agent,
				owner,
				refusalClass:
					knownHuman && isRefusalClass(entry.refusal_class)
						? entry.refusal_class
						: null,
			});
		} else if (entry.state === "held") {
			seen.add(entry.endpoint_id);
			const holdClass = isHoldClass(entry.hold_class) ? entry.hold_class : null;
			lines.push(
				holdClass === "delivery_pending"
					? { kind: "pending", key, agent, owner }
					: { kind: "held", key, agent, owner, holdReason: holdClass },
			);
		}
		// `delivered` and any state this build does not know: nothing.
	}
	return lines;
}

/**
 * The counts behind the ONE summary line under a message ("Delivered to 3 ·
 * 2 screening · 2 not delivered"), in render order. Zero segments are omitted
 * by the component, never here, so a test can pin every count.
 *
 * `screening` is screening in progress (including "could not be screened yet,
 * retrying"); `held` waits for the recipient owner's review; `notReviewed` is
 * such a hold the hub has given up waiting on; `pending` is a recipient whose
 * outcome this viewer cannot classify (an unclassified hold, a screened
 * delivery still in flight, or a recipient that never reported).
 */
export type TeamBridgeDeliveryCounts = {
	delivered: number;
	screening: number;
	held: number;
	notReviewed: number;
	pending: number;
	notDelivered: number;
};

export const TEAM_BRIDGE_DELIVERY_SEGMENTS = [
	"delivered",
	"screening",
	"held",
	"notReviewed",
	"pending",
	"notDelivered",
] as const satisfies readonly (keyof TeamBridgeDeliveryCounts)[];

/**
 * What the summary line under one message shows to THIS viewer, or `null` when
 * it shows nothing.
 *
 * WHY ONE LINE. One line per recipient grew without bound in a busy channel
 * (operator report 2026-11-09): six agents meant six muted sentences under
 * every message. The line now carries counts, and the per-recipient sentences
 * move into a popover behind it.
 *
 * WHO SEES WHAT. `lines` is non-empty only for a viewer the hub already sent
 * per-recipient entries to (the sender, an agent member's owner), so the
 * popover never discloses anything that viewer could not already read. Every
 * other member sees the counts alone, from the hub's neutral
 * `delivery_summary`; with no summary (an older hub) they see nothing, never a
 * guess.
 *
 * WHERE THE COUNTS COME FROM. The hub's `delivery_summary` wins when present:
 * it counts EVERY recipient, while a viewer's `delivery_states` may cover only
 * their own agents, and only the hub can tell a review hold from screening for
 * a sender. Without it the counts are derived from `delivery_states` with the
 * same narrowing as the lines: unknown states count nowhere, an unclassified
 * hold is `pending` (the sender cannot tell screening from review, and calling
 * a review hold "screening" is the mislabel this replaced).
 *
 * WHEN IT IS SILENT. Only when nothing is outstanding: an all-delivered message
 * stays as quiet as before, so the line itself means "look here".
 */
export function teamBridgeDeliverySummary(message: {
	delivery_states?: readonly TeamBridgeDeliveryState[];
	delivery_summary?: TeamBridgeDeliverySummary;
	origin?: unknown;
	sender?: { kind?: unknown; audit_unknown_kind?: unknown };
}): {
	counts: TeamBridgeDeliveryCounts;
	lines: TeamBridgeDeliveryLine[];
} | null {
	const lines = teamBridgeDeliveryLines(message.delivery_states, message);
	const counts =
		countsFromSummary(message.delivery_summary) ??
		countsFromStates(message.delivery_states);
	const outstanding =
		counts.screening +
		counts.held +
		counts.notReviewed +
		counts.pending +
		counts.notDelivered;
	if (outstanding === 0) return null;
	return { counts, lines };
}

const zeroCounts = (): TeamBridgeDeliveryCounts => ({
	delivered: 0,
	screening: 0,
	held: 0,
	notReviewed: 0,
	pending: 0,
	notDelivered: 0,
});

function countsFromSummary(
	summary: TeamBridgeDeliverySummary | undefined,
): TeamBridgeDeliveryCounts | null {
	if (!summary) return null;
	return {
		delivered: summary.delivered ?? 0,
		screening: summary.screening ?? 0,
		held: summary.held ?? 0,
		notReviewed: summary.not_reviewed ?? 0,
		pending: summary.pending ?? 0,
		notDelivered: summary.not_delivered ?? 0,
	};
}

function countsFromStates(
	states: readonly TeamBridgeDeliveryState[] | undefined,
): TeamBridgeDeliveryCounts {
	const counts = zeroCounts();
	const seen = new Set<string>();
	for (const entry of states ?? []) {
		// Same first-entry-wins dedup as the lines, so the count matches them.
		if (seen.has(entry.endpoint_id)) continue;
		if (entry.state === "delivered") counts.delivered += 1;
		else if (entry.state === "refused") counts.notDelivered += 1;
		else if (entry.state === "held") {
			const holdClass = isHoldClass(entry.hold_class) ? entry.hold_class : null;
			if (holdClass === "awaiting_review") counts.held += 1;
			else if (holdClass === "screening_unavailable") counts.screening += 1;
			else counts.pending += 1;
		} else continue; // unknown state: counted nowhere, like the lines
		seen.add(entry.endpoint_id);
	}
	return counts;
}
