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
 *
 * ## The channel branch (`spend_channels`, wire v1)
 *
 * A second, ADDITIVE path sits beside the port above: when the caller says the
 * backend advertises `features.cost_channels` and the snapshot carries the
 * published `spend_channels` object, the strip shows THAT total instead of
 * re-adding the ledgers. This is not a mirror of anything — it is the backend's
 * one arithmetic site's result, passed through — and the rules live here rather
 * than in the component so a second surface can follow them without
 * re-deriving them:
 *
 *   - `total`/`knowledge` come from the object (`total_micro`, `knowledge`).
 *     NEVER recomputed: `total_micro` already contains inference, the channel
 *     records and the children, so adding anything to it double-counts.
 *   - `text` runs the SAME ladder (`formatCost`) over `total_micro / 1e6`, with
 *     the same zero policy: nothing is fabricated for an untracked session, and
 *     money that exists but could not be sized is `$—`, never `≥$0.0000`.
 *   - `channels` carries the breakdown the tooltip renders, spelled HERE so the
 *     component renders strings rather than making arithmetic decisions.
 *   - A malformed object, or one stamped with a wire version this build does
 *     not know, falls back to the legacy port — the legacy fields keep their
 *     inference-only meaning on every backend, so that answer is always true.
 *
 * The gate is the CALLER's `features.cost_channels >= 1`, passed in as
 * `options.costChannels`: a backend that does not advertise the capability has
 * not promised the object's semantics even if an object appears, so the
 * failure direction is legacy, never the channel branch.
 */

import type {
	CanonicalFrontendState,
	CanonicalSpendChannelRow,
	CanonicalSpendChannels,
} from "../../../../../shared/desktop-session-contract";
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
	| "spend_channels"
>;

/**
 * How the strip's caller gates the channel branch.
 *
 * `costChannels` is `(capabilities.features.cost_channels ?? 0) >= 1` from the
 * desktop capability read — a boolean rather than the capability object because
 * this module must stay pure (the Node suite bundles it with no window and no
 * query client). Absent/false means the legacy path, which is also what an old
 * server gets: the field would be missing there anyway, and this gate makes the
 * direction of a HALF-upgraded pair (capability present, field not yet) legacy
 * as well.
 */
export type SessionCostOptions = {
	costChannels?: boolean;
};

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
	/**
	 * The published channel object's reading, present exactly when the channel
	 * branch produced the figure (capability on AND a usable v1 object).
	 * `undefined` on the legacy path — the strip then renders no breakdown, and
	 * nothing may be inferred from the absence: legacy backends simply have no
	 * channel story to tell, and the tooltip already says what it can.
	 */
	channels?: SpendChannelsReading;
};

/**
 * The published channels object as a reading the strip can render.
 *
 * Spelled here, beside the arithmetic, for the reason `formatCost` is exported
 * rather than re-derived at each surface: the summary line and the row lines
 * ARE the reading, and two spellings of one number is the drift this module
 * exists to prevent.
 */
export type SpendChannelsReading = {
	/** The object's own `tracked`: false = "channels not tracked" (say so). */
	tracked: boolean;
	/** The grand total, integer micro-USD, exactly as published. */
	totalMicro: number;
	knowledge: CostKnowledge;
	/** Non-zero money buckets, in the contract's order (`by_basis`). */
	byBasis: Array<{ basis: string; micro: number }>;
	/** The `not_tracked_calls` COUNT — records with no trackable basis. */
	notTrackedCalls: number;
	/** One line per published row, spelled. */
	rows: string[];
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

/**
 * Normalise a wire value to a rung this app knows, or `unknown`.
 *
 * Exported because every reader of a knowledge field must degrade a future
 * rung the same way — the analytics panel's By-channel section reads rows of
 * the same object and a second copy of this coercion is how two surfaces come
 * to disagree about one figure's honesty.
 */
export function rung(value: unknown): CostKnowledge {
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

/* ---- channels: the published object, as the strip renders it ------------ */

/**
 * Integer micro-USD through the module's ONE dollar ladder.
 *
 * Deliberately not a new formatter: the wire's `total_micro` and the legacy
 * `cumulative_cost` must agree to the cent on the same session (the parity
 * tests pin that), and a second ladder is how two surfaces start disagreeing.
 * The division happens HERE, at the display edge, never in arithmetic.
 */
function microUsdText(micro: number): string {
	return formatCost(micro / 1_000_000);
}

/**
 * The wire's basis spellings as words, one map for the summary and the rows.
 *
 * `subscription_api_equivalent` is the one word that MUST NOT be shortened to
 * "subscription": the number beside it is the published API price of what a
 * plan funded, and "subscription" alone would read as money charged to the
 * plan. An unknown word passes through as-is — the vocabulary belongs to the
 * backend (see the contract's `CanonicalSpendChannelRow`).
 */
const BASIS_WORDS: Record<string, string> = {
	billed: "billed",
	subscription_api_equivalent: "API-equivalent",
	estimated: "estimated",
	not_tracked: "not tracked",
};

/**
 * The wire basis spelling as its display word; an unknown word passes through.
 *
 * The mid-label spelling (`estimated`, `API-equivalent`), which the strip's row
 * suffixes and the analytics panel's columns both build on; a sentence or a
 * line that needs a capital prefixes it itself.
 */
export function channelBasisLabel(basis: string): string {
	return BASIS_WORDS[basis] ?? basis;
}

/** Capitalise a wire word for the start of a label (`inference` -> `Inference`). */
function capitalise(word: string): string {
	return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * Channel words that are not a capitalised string: the two voice acronyms.
 *
 * `Tts` is not a word anyone writes; the backend's own channel names are
 * `tts`/`stt` and every surface that prints them prints the acronym. Kept
 * beside `capitalise` so a future channel word with the same problem has one
 * place to land.
 */
const CHANNEL_WORDS: Record<string, string> = { tts: "TTS", stt: "STT" };

/** The channel's display word, for the row label. */
export function channelWord(channel: string): string {
	return CHANNEL_WORDS[channel] ?? capitalise(channel);
}

/**
 * Whether `value` is a `spend_channels` object this build may render.
 *
 * Strict on the load-bearing members (version 1, a boolean `tracked`, an
 * INTEGER `total_micro`, an array of rows) and tolerant about nothing else —
 * every other member is read defensively at its own site. A future wire
 * version fails here on purpose: the design says an unknown version renders
 * the legacy view, and the legacy fields stay true on every backend.
 *
 * Exported because the analytics panel's By-channel section reads the SAME
 * object and must refuse it by the same rule — two version checks that could
 * disagree is the drift this module's docblock is about.
 */
export function spendChannelsUsable(
	value: unknown,
): value is CanonicalSpendChannels {
	if (typeof value !== "object" || value === null) return false;
	const object = value as Partial<CanonicalSpendChannels>;
	return (
		object.version === 1 &&
		typeof object.tracked === "boolean" &&
		typeof object.total_micro === "number" &&
		Number.isInteger(object.total_micro) &&
		Array.isArray(object.rows)
	);
}

/** The row's own name for its money: channel plus the serving identity. */
export function channelRowName(row: CanonicalSpendChannelRow): string {
	const channel =
		typeof row.channel === "string" && row.channel ? row.channel : "other";
	const label = typeof row.label === "string" ? row.label.trim() : "";
	const provider = typeof row.provider === "string" ? row.provider : "";
	const model = typeof row.model === "string" ? row.model : "";
	/*
	 * The inference bucket key when there is one (`label`), else the identity
	 * pair. A `provider/model` join only when both halves exist: `deepseek:read`
	 * and `tavily` are one half each, and `/` with an empty side would invent a
	 * slash nobody sent.
	 */
	const identity =
		label || (provider && model ? `${provider}/${model}` : provider || model);
	return identity
		? `${channelWord(channel)} · ${identity}`
		: channelWord(channel);
}

/**
 * One row's amount, mark included: `$0.90`, `≥$0.053`, or the word `not
 * tracked`.
 *
 * `null` never becomes a number and never becomes `$0.0000`: the wire's own
 * rule (`None` means unknown, never zero) restated at the last place it could
 * be violated. `knowledge`'s `partial`/`floor` on the row rides the same `≥`
 * the headline uses, because a group with unsized members is a lower bound.
 */
function rowAmountText(row: CanonicalSpendChannelRow): {
	text: string;
	unknown: boolean;
} {
	const amount =
		typeof row.amount_micro === "number" && Number.isFinite(row.amount_micro)
			? row.amount_micro
			: null;
	if (amount === null) return { text: BASIS_WORDS.not_tracked, unknown: true };
	const floor = isFloorKnowledge(rung(row.knowledge));
	return {
		text: `${floor ? FLOOR_MARK : ""}${microUsdText(amount)}`,
		unknown: false,
	};
}

/**
 * One row's basis words: `estimated`, `API-equivalent`, `billed`.
 *
 * `not_tracked` is deliberately NOT a row word when the row has a stated
 * amount: alongside a money basis it means "part of this group is unsized",
 * and that fact is already carried by the `≥` mark and the summary line's
 * count. Alone (the inference placeholder until the backend's basis columns
 * land), it would sit next to a figure that IS sized and read as if the figure
 * were not — so it is left to the summary count there too. An unreleased word
 * passes through as the backend spelled it.
 *
 * Exported (with `channelWord` and `channelRowName`) because the analytics
 * panel's By-channel table names the same rows; ONE site spells the
 * vocabulary, and the two surfaces differ only in their money ladders, which
 * the design deliberately does not unify.
 */
export function channelBasisWords(bases: readonly string[]): string[] {
	return [
		...new Set(
			bases
				.filter((basis): basis is string => typeof basis === "string")
				.filter((basis) => basis !== "not_tracked")
				.map((basis) => channelBasisLabel(basis)),
		),
	];
}

function rowBasisText(row: CanonicalSpendChannelRow): string {
	const bases = Array.isArray(row.basis) ? row.basis : [];
	return channelBasisWords(bases).join(" · ");
}

/** One row as the strip's tooltip prints it. */
function rowSpelling(row: CanonicalSpendChannelRow): string {
	const amount = rowAmountText(row);
	const basis = amount.unknown ? "" : rowBasisText(row);
	return `${channelRowName(row)} — ${amount.text}${basis ? ` · ${basis}` : ""}`;
}

/**
 * The published object as a `SpendChannelsReading`, or `null` when it is not
 * one this build can render (the caller then keeps the legacy path).
 */
function channelsReading(value: unknown): SpendChannelsReading | null {
	if (!spendChannelsUsable(value)) return null;
	const rawBasis = value.by_basis;
	const byBasis: SpendChannelsReading["byBasis"] = [];
	let notTrackedCalls = 0;
	if (rawBasis && typeof rawBasis === "object") {
		for (const [basis, bucket] of Object.entries(rawBasis)) {
			if (typeof bucket !== "number" || !Number.isFinite(bucket)) continue;
			if (basis === "not_tracked_calls") {
				notTrackedCalls = Math.max(0, Math.trunc(bucket));
				continue;
			}
			/* Zero buckets are left out of the summary: "Billed $0.0000" is a
			 * claim the line does not need to make, and the absent bucket is
			 * stated by the count beside the ones that are there. */
			if (bucket !== 0) byBasis.push({ basis, micro: bucket });
		}
	}
	const rows = value.rows.filter(
		(row): row is CanonicalSpendChannelRow =>
			Boolean(row) && typeof row === "object",
	);
	return {
		tracked: value.tracked,
		totalMicro: value.total_micro,
		knowledge: rung(value.knowledge),
		byBasis,
		notTrackedCalls,
		rows: rows.map(rowSpelling),
	};
}

/**
 * The summary line: `Billed $0.053 · API-equivalent $0.053 · estimated $0.010
 * · 2 not tracked`, or `null` when there is nothing to state.
 *
 * Exported for the tests that pin the fixture's exact line, and because the
 * analytics panel reads the same buckets — one spelling of one breakdown.
 */
export function channelSummaryLine(
	reading: SpendChannelsReading,
): string | null {
	const parts = reading.byBasis.map(
		(bucket) =>
			`${capitalise(channelBasisLabel(bucket.basis))} ${microUsdText(bucket.micro)}`,
	);
	if (reading.notTrackedCalls > 0) {
		parts.push(`${reading.notTrackedCalls} not tracked`);
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Every breakdown line after the spend sentence: the summary (when it has
 * something to state) and one line per published row.
 *
 * The strip renders this array verbatim, and the tracked=false sentence is
 * `costTooltip`'s rather than a line here — the object's rows are still true
 * for a recovered session, so they are listed, and the sentence beside them is
 * what stops them reading as the whole story.
 */
export function channelBreakdownLines(reading: SpendChannelsReading): string[] {
	const lines: string[] = [];
	const summary = channelSummaryLine(reading);
	if (summary) lines.push(summary);
	lines.push(...reading.rows);
	return lines;
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
 *
 * `options.costChannels` switches to the PUBLISHED total when the snapshot
 * carries a usable `spend_channels` object — see the module docblock for why
 * that branch exists and what it refuses to recompute. The legacy port below
 * stays byte-for-byte the answer for every backend that has no such object,
 * which is what keeps an old server's rendering unchanged.
 */
export function sessionCost(
	state: SessionCostInput,
	usage?: {
		input_tokens?: number | null;
		output_tokens?: number | null;
	} | null,
	options?: SessionCostOptions,
): SessionCost {
	/*
	 * The channel branch FIRST: when it answers, it answers for the whole
	 * figure, and the two paths must never be mixed (the published total
	 * already contains everything the legacy port sums; adding them
	 * double-counts). `channelsReading` returns null for a malformed object or
	 * a future wire version, and the legacy path is the one true answer about
	 * every backend, so that fallback is safe rather than merely convenient.
	 */
	if (options?.costChannels) {
		const reading = channelsReading(state.spend_channels);
		if (reading) return channelsSessionCost(reading);
	}
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
 * The channel branch's whole answer, from the reading and nothing else.
 *
 * `total_micro` is taken as published — the ONE place this module is forbidden
 * from recomputing — and the zero case splits on the knowledge rung exactly as
 * the "no fabricated zeros" rule demands: `unknown` is the fresh-session
 * silence the legacy path also renders, while `partial`/`floor` mean money
 * EXISTS that could not be sized and take the app's one unknown spelling, `$—`.
 * `≥$0.0000` appears in neither: a stated zero and an unstated total are
 * different facts, and only one of them may be printed as a figure.
 */
function channelsSessionCost(reading: SpendChannelsReading): SessionCost {
	const { totalMicro, knowledge } = reading;
	const isFloor = isFloorKnowledge(knowledge);
	if (totalMicro === 0) {
		return {
			total: 0,
			knowledge,
			isFloor,
			text: knowledge === "unknown" ? "" : UNPRICEABLE_TEXT,
			channels: reading,
		};
	}
	return {
		total: totalMicro / 1_000_000,
		knowledge,
		isFloor,
		text: `${isFloor ? FLOOR_MARK : ""}${microUsdText(totalMicro)}`,
		channels: reading,
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
	if (cost.channels) return channelsCostTooltip(cost);
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

/**
 * The sentence every surface says when the ledger was not tracking a session.
 *
 * `tracked: false` means the conversation predates the channel ledger: the
 * total is inference-only and the contract MANDATES saying so — a surface that
 * stayed silent would imply $0 of channel spend (fabricated zeros are the one
 * thing the wire's rules forbid twice). One constant, because the strip's
 * tooltip and the analytics panel's legend must not describe one session
 * differently.
 */
export const CHANNELS_UNTRACKED_NOTE =
	"Channels are not tracked for this conversation, so this covers model spend only.";

/**
 * The tooltip under the CHANNEL branch's figure.
 *
 * The legacy sentence's reasons ("ran before the app was tracking it", "a
 * subagent's spend is not fully known") are inference-era causes; on this path
 * the object's own `knowledge` says only THAT something could not be sized, and
 * the tracked=false sentence is the contract's mandate — every surface must SAY
 * "channels not tracked" rather than imply $0 of channel spend — so both
 * clauses are their own sentences beside the figure's.
 */
function channelsCostTooltip(cost: SessionCost): string {
	const reading = cost.channels;
	if (!reading) return "Nothing has been spent in this session yet.";
	if (cost.total === null || !cost.total) {
		return cost.text === UNPRICEABLE_TEXT
			? "Some spend in this conversation could not be priced, so the spend cannot be calculated."
			: "Nothing has been spent in this session yet.";
	}
	const base = cost.isFloor
		? `Session spend is at least ${formatCost(cost.total)}.`
		: `Session spend so far: ${formatCost(cost.total)}.`;
	const clauses: string[] = [];
	if (cost.isFloor) {
		clauses.push("Part of this conversation's spend could not be priced.");
	}
	if (!reading.tracked) {
		clauses.push(CHANNELS_UNTRACKED_NOTE);
	}
	return [base, ...clauses].join(" ");
}
