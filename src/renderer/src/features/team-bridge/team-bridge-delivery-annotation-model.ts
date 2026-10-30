import type { TeamBridgeDeliveryState } from "../../../../shared/team-bridge-contract";

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
 * Labels are trimmed; an empty one comes back as "" and the component fills
 * in the shared "unknown agent/person" copy, so a blank wire label never
 * renders "Not delivered to  ()".
 */
export function teamBridgeDeliveryLines(
	states: readonly TeamBridgeDeliveryState[] | undefined,
): TeamBridgeDeliveryLine[] {
	if (!states || states.length === 0) return [];
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
				refusalClass: isRefusalClass(entry.refusal_class)
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
