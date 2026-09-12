/**
 * The session's spend, and how well it is known.
 *
 * ONE module owns this arithmetic for the whole app. It is a port, not a
 * design, and the thing it ports is a pair of computed properties on the
 * backend's own state object:
 *
 *   - `FrontendSessionState.cumulative_cost`
 *     (`local_operator/session/frontend_state.py:1649-1658`)
 *   - `FrontendSessionState.cumulative_cost_knowledge`
 *     (`local_operator/session/frontend_state.py:1661-1670`)
 *
 * and the SPELLING rules the TUI's status band applies to the result:
 *
 *   - `format_cost` (`local_operator/tui/widgets/status_line.py:671`)
 *   - `LocalOperatorApp._spend_text` (`local_operator/tui/app.py:34769`)
 *   - `LocalOperatorApp._spend_total` (`local_operator/tui/app.py:34831`)
 *   - `LocalOperatorApp._frontend_child_costs` (`local_operator/tui/app.py:34811`)
 *   - `RESTORED_COST_PREFIX` (`local_operator/tui/app.py:369`)
 *
 * ## Why a port rather than a number on the wire
 *
 * `cumulative_cost` is a Python `@property`. Pydantic does not serialise
 * properties, so the canonical frontend state carries the four INPUTS
 * (`cumulative_parent_cost`, `child_costs`, `subagent_cost`,
 * `subagent_cost_knowledge`, `cost_knowledge`) and no total. Every surface
 * that wants the total computes it, which is why the TUI computes it too.
 *
 * ## What would make this mirror wrong
 *
 * Four edits on the Python side, in rough order of likelihood:
 *
 * 1. `cumulative_cost` changing which ledger wins. Today the switch is
 *    `subagent_cost_knowledge is not None` — the OWNER ledger when the owner
 *    reports one, the compatibility `child_costs` map otherwise, and NEVER
 *    both, because the owner ledger already includes swept work and live
 *    descendants that the per-row costs omit. Summing them double-counts.
 * 2. `cumulative_cost_knowledge` changing when a total degrades to `partial`.
 *    Today: an own-ledger `partial`/`floor` wins outright; an owner-ledger
 *    `partial` degrades the total; and an owner-ledger `unknown` degrades it
 *    only when `child_costs` is non-empty (unknown children we can see).
 * 3. `format_cost`'s magnitude thresholds (0.01, 1.0) or its decimal counts.
 * 4. `_spend_text`'s zero policy. A zero spend renders NOTHING — not
 *    `$0.0000` — because an unpriced model reaching the band as `0.0` would
 *    otherwise print a confident zero over real billed tokens, which
 *    `turn_cost` calls the more expensive of the two lies.
 *
 * A fifth: `format_cost` is spelled through `pyFixed` rather than `toFixed`,
 * because Python rounds half-to-even on the exact binary value. Real prices
 * essentially never land on a representable tie (round 1 swept 58,260 realistic
 * totals and found none), so this one is insurance rather than a live defect —
 * but the context reading next to it diverged once per 351 counts on a 32k
 * window, and one rounding rule for the strip is the only version of this that
 * stays true.
 *
 * A sixth, less obvious: `CostKnowledge` gaining a rung. `partial` and `floor`
 * both mark the figure as a floor here; a new rung would land in neither set
 * and would silently render as exact.
 *
 * The Node suite `scripts/session-status.test.mjs` asserts every rule above
 * against payloads captured from a real backend, so a drift on either side
 * fails a gate rather than shipping a wrong number.
 */

import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { pyFixed } from "./fixed-point";

/**
 * `local_operator/session/frontend_state.py:787` `CostKnowledge`.
 *
 * Modelled as a string union rather than an enum because the wire carries the
 * StrEnum's VALUE, and a value this app does not recognise (a future rung)
 * must degrade rather than crash — see `isFloorKnowledge`.
 */
export type CostKnowledge = "unknown" | "exact" | "partial" | "floor";

/** The mark `_spend_text` prefixes to a figure that is a floor, not a total. */
export const FLOOR_MARK = "\u2265";

/**
 * What the band says when tokens were billed at a price nobody could resolve.
 *
 * `local_operator/tui/app.py:7703` writes `"$—"` when the turn reports usage
 * and `cumulative_cost` is `None`. Distinct from "no spend to show": the
 * session DID spend, and the app cannot say how much.
 */
export const UNPRICEABLE_TEXT = "$\u2014";

/** The four accounting fields this module reads, as the wire delivers them. */
export type SessionCostInput = Pick<
	CanonicalFrontendState,
	| "cumulative_parent_cost"
	| "child_costs"
	| "subagent_cost"
	| "subagent_cost_knowledge"
	| "cost_knowledge"
>;

export type SessionCost = {
	/** `cumulative_cost`: parent plus children, or null when neither is known. */
	total: number | null;
	/** `cumulative_cost_knowledge`, defaulted to `unknown` on a malformed wire. */
	knowledge: CostKnowledge;
	/** True when `knowledge` marks the total as a lower bound (`partial`/`floor`). */
	isFloor: boolean;
	/**
	 * What the band prints, mark included. `""` when there is nothing to show,
	 * which is `_spend_text`'s zero and null policy in one value — every caller
	 * hides the segment on the same test rather than each inventing its own.
	 */
	text: string;
};

/** Coerce a wire number, treating a non-finite or absent value as unknown. */
function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `_frontend_child_costs` (`tui/app.py:34811`).
 *
 * The owner ledger is fed to the total as a SINGLE contribution and never
 * alongside the compatibility row costs, which omit swept work and live
 * descendants. Note this returns the owner's `subagent_cost` when the owner
 * reports knowledge AT ALL, including `unknown` — `is not None` is the switch,
 * exactly as in Python, because an owner that says "I do not know what my
 * children cost" is still the authority on the question.
 */
function childTotal(state: SessionCostInput): number | null {
	if (state.subagent_cost_knowledge != null) return finite(state.subagent_cost);
	const rows = state.child_costs;
	if (!rows) return null;
	const values = Object.values(rows).filter(
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value),
	);
	// `sum(self.child_costs.values()) if self.child_costs else None`: an EMPTY
	// map is "no children", not "children cost zero". The distinction survives
	// into the total, where zero children plus a null parent is null rather
	// than 0.0 — which is what keeps a fresh session's segment absent.
	return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
}

/** True for the two rungs that mark a figure as a lower bound. */
function isFloorKnowledge(knowledge: CostKnowledge): boolean {
	// `_apply_frontend_state`: `knowledge in {"floor", "partial"}`.
	return knowledge === "floor" || knowledge === "partial";
}

/** Normalise a wire value to a rung this app knows, or `unknown`. */
function rung(value: unknown): CostKnowledge {
	return value === "exact" || value === "partial" || value === "floor"
		? value
		: "unknown";
}

/**
 * `format_cost` (`status_line.py:671`): `$0.0021` under a cent, `$0.123` under
 * a dollar, `$1.23` above.
 *
 * Exported because the picker surfaces a cost too and two roundings of one
 * number is exactly the drift `CONTEXT_FORMS` exists to prevent on the other
 * reading.
 */
export function formatCost(cost: number): string {
	if (cost < 0.01) return `$${pyFixed(cost, 4)}`;
	if (cost < 1.0) return `$${pyFixed(cost, 3)}`;
	return `$${pyFixed(cost, 2)}`;
}

/**
 * `cumulative_cost_knowledge` (`frontend_state.py:1661-1670`), field for field.
 *
 * The order is load-bearing: the session's OWN `partial`/`floor` wins before
 * the owner ledger is consulted at all, because a parent figure that is
 * already a floor cannot be made exact by a child that happens to be known.
 */
export function cumulativeCostKnowledge(
	state: SessionCostInput,
): CostKnowledge {
	const own = rung(state.cost_knowledge);
	if (own === "partial" || own === "floor") return own;
	const child = state.subagent_cost_knowledge;
	if (child === "partial") return "partial";
	// An owner that reports `unknown` degrades the total only when there are
	// children we can actually see. With no rows the unknown is about nothing.
	if (
		child === "unknown" &&
		state.child_costs &&
		Object.keys(state.child_costs).length > 0
	)
		return "partial";
	return own;
}

/**
 * `cumulative_cost` (`frontend_state.py:1649-1658`), plus the band's spelling.
 *
 * `usage` is the one input that does not come from the accounting fields: it
 * answers `_apply_frontend_state`'s `billed_unknown` question — did this turn
 * bill tokens at a price that could not be resolved. When it did and the total
 * is null, the band writes `$—` rather than nothing, because "we spent
 * something we cannot price" is a different fact from "we have not spent".
 */
export function sessionCost(
	state: SessionCostInput,
	usage?: {
		input_tokens?: number | null;
		output_tokens?: number | null;
	} | null,
): SessionCost {
	const parent = finite(state.cumulative_parent_cost);
	const children = childTotal(state);
	const knowledge = cumulativeCostKnowledge(state);
	const isFloor = isFloorKnowledge(knowledge);
	const total =
		parent === null && children === null
			? null
			: (parent ?? 0) + (children ?? 0);

	if (total === null) {
		const billed = Boolean(
			usage && ((usage.input_tokens ?? 0) || (usage.output_tokens ?? 0)),
		);
		return {
			total: null,
			knowledge,
			isFloor,
			text: billed ? UNPRICEABLE_TEXT : "",
		};
	}
	// `if not spend: return ""`. Python's falsiness covers 0.0 and -0.0, and
	// this is the policy paragraph of `_spend_text`: a zero spends no segment,
	// because an unpriced model reaching the band as 0.0 is exactly the case
	// that would otherwise print a confident `$0.0000` over billed tokens.
	if (!total) return { total, knowledge, isFloor, text: "" };
	return {
		total,
		knowledge,
		isFloor,
		text: `${isFloor ? FLOOR_MARK : ""}${formatCost(total)}`,
	};
}

/**
 * The sentence the cost readout's tooltip carries.
 *
 * The band has one cell and can only show the mark; a tooltip has room to say
 * what the mark MEANS, which is the half a `≥` cannot carry on its own. The
 * wording follows `_spend_text`'s docstring: a floor survives a restore, so
 * "at least" is a statement about the session's history and not about a
 * rounding.
 */
export function costTooltip(cost: SessionCost): string {
	if (cost.total === null) {
		return cost.text === UNPRICEABLE_TEXT
			? "This session billed tokens on a model with no published price, so the spend cannot be calculated."
			: "Nothing has been spent in this session yet.";
	}
	if (!cost.total) return "Nothing has been spent in this session yet.";
	const exact = `Session spend so far: ${formatCost(cost.total)}.`;
	if (!cost.isFloor) return exact;
	return `Session spend is at least ${formatCost(cost.total)}. Part of this conversation ran before the app was tracking it, or a subagent's spend is not fully known.`;
}
