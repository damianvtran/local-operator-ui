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
			holdClass: TeamBridgeHoldClass | null;
	  };

const isRefusalClass = (value: unknown): value is TeamBridgeRefusalClass =>
	(TEAM_BRIDGE_REFUSAL_CLASSES as readonly unknown[]).includes(value);
const isHoldClass = (value: unknown): value is TeamBridgeHoldClass =>
	(TEAM_BRIDGE_HOLD_CLASSES as readonly unknown[]).includes(value);

/**
 * One line per non-delivered recipient, in the hub's order.
 *
 * Held lines carry no recipient name (the contract's copy is "Waiting to be
 * screened…"), so two holds with the same reason would print the same sentence
 * twice; identical held lines are collapsed into the first. Refusals are never
 * collapsed: each names a different agent.
 */
export function teamBridgeDeliveryLines(
	states: readonly TeamBridgeDeliveryState[] | undefined,
): TeamBridgeDeliveryLine[] {
	if (!states || states.length === 0) return [];
	const lines: TeamBridgeDeliveryLine[] = [];
	const heldSeen = new Set<string>();
	for (const entry of states) {
		if (entry.state === "refused") {
			lines.push({
				kind: "refused",
				key: `refused:${entry.endpoint_id}`,
				agent: entry.recipient_label,
				owner: entry.recipient_owner_label,
				refusalClass: isRefusalClass(entry.refusal_class)
					? entry.refusal_class
					: null,
			});
		} else if (entry.state === "held") {
			const holdClass = isHoldClass(entry.hold_class) ? entry.hold_class : null;
			const dedupe = holdClass ?? "";
			if (heldSeen.has(dedupe)) continue;
			heldSeen.add(dedupe);
			lines.push({ kind: "held", key: `held:${entry.endpoint_id}`, holdClass });
		}
		// `delivered` and any state this build does not know: nothing.
	}
	return lines;
}
