import type { DesktopContextNumbers } from "../../../../../../shared/desktop-contract";
import type { SlashOutcome } from "../use-picker-backend";
import { formatContextTokens, formatPercent, formatWindow } from "./formatters";

/**
 * `/context` — the pure decisions.
 *
 * The panel reads a ROUTED command (`sessions.command("context")`), not a
 * catalogue: the breakdown is computed on the process that holds the session,
 * so the owner's answer is the only one that can be right. What this file owns
 * is the reading of that answer — which of its shapes means "here are rows",
 * which means "the owner has no breakdown for you", and how a row becomes a bar.
 */

/** The block the owner returns for a routed `/context`. */
export type ContextBlock = {
	title?: string;
	/** `[label, "~12.3k"]` — ALREADY FORMATTED by the owner. */
	items?: [string, string][];
	/** Additive (§5.5): the dict those rows were built from. */
	numbers?: DesktopContextNumbers;
};

/** The block, or `null` when the outcome is not one. */
export function contextBlockOf(
	outcome: SlashOutcome | null | undefined,
): ContextBlock | null {
	if (!outcome || outcome.kind !== "block") return null;
	return outcome.data as ContextBlock;
}

/**
 * Whether the owner answered "there is no breakdown to give".
 *
 * A `notice`, not a block, and its text is the owner's own sentence. Matched on
 * the phrase rather than on a field because there is no field: the owner has
 * one notice for this case and the panel must not invent a second wording for
 * it. The panel does NOT show this text — it shows copy that says what to do
 * about it — which is why the test lives here rather than in the JSX.
 */
export function isBreakdownUnavailable(
	outcome: SlashOutcome | null | undefined,
): boolean {
	return Boolean(
		outcome?.kind === "notice" &&
			outcome.text?.includes("context breakdown unavailable"),
	);
}

/** One row of the "Next request" estimate. */
export type EstimateRow = {
	key: string;
	label: string;
	value: number;
	/** Share of the estimate's own total, or `null` when there is no total. */
	fraction: number | null;
};

/**
 * The six content rows, in the owner's order and with the owner's labels.
 *
 * The labels are the owner's, not re-invented: they are the same strings the
 * terminal prints and the same ones a user would read in the routed answer, and
 * two spellings of one row is how the two surfaces start disagreeing about what
 * a number was.
 *
 * `cache_read` and `context_window` are deliberately absent — the first is a
 * different kind of fact (an exact measurement rather than an estimate) and the
 * second is the denominator, not a row.
 */
const ESTIMATE_ROWS: { key: keyof DesktopContextNumbers; label: string }[] = [
	{ key: "instructions", label: "Instructions" },
	{ key: "tool_inventory", label: "Tool inventory" },
	{ key: "tool_schemas", label: "Tool schemas" },
	{ key: "environment", label: "Environment" },
	{ key: "knowledge_mcp_goal", label: "Skills / MCP / goal" },
	{ key: "messages", label: "Messages" },
];

/**
 * The estimate's rows, measured against the estimate's own total.
 *
 * Bars are shares OF THE ESTIMATE, not of the context window: the six rows sum
 * to the total, so a bar that read against the window would draw six short
 * marks and answer a different question from the one the section asks.
 */
export function estimateRows(
	numbers: DesktopContextNumbers | undefined,
): EstimateRow[] {
	if (!numbers) return [];
	const total = numbers.total;
	return ESTIMATE_ROWS.map(({ key, label }) => {
		const value = numbers[key];
		return {
			key,
			label,
			value,
			fraction: total > 0 ? value / total : null,
		};
	});
}

/** The share of the WINDOW the estimated request occupies. `null` when unknown. */
export function windowShare(
	numbers: DesktopContextNumbers | undefined,
): number | null {
	if (!numbers || !numbers.context_window) return null;
	return numbers.total / numbers.context_window;
}

/**
 * The owner's own total line, e.g. `~12.4k / 200k (6.2%)`.
 *
 * Taken VERBATIM from the block's `Total` row when it is there, so the panel
 * and the terminal print one string. When the block has no such row (an older
 * owner) the sentence is not invented: the caller renders the numbers it has.
 */
export function ownerTotalText(block: ContextBlock | null): string | null {
	const row = block?.items?.find(([label]) => label === "Total");
	return row ? row[1] : null;
}

/**
 * The pre-`numbers` fallback rows.
 *
 * Rendered as a two-column table with no bars, and NEVER parsed back into
 * numbers: `items` holds formatted strings, so recovering a magnitude from
 * `~12.4k` would make a formatter change silently move a chart.
 */
export function itemRows(block: ContextBlock | null): [string, string][] {
	return block?.items ?? [];
}

/** Section 1's line: the measured half, which carries the word `estimate` when it is one. */
export function headline(
	frontend: {
		context_tokens: number | null;
		context_window: number | null;
		context_is_estimate: boolean | null;
	} | null,
): { value: string; fraction: number | null; estimated: boolean } {
	if (
		!frontend ||
		frontend.context_tokens === null ||
		!frontend.context_window
	) {
		return { value: "not measured", fraction: null, estimated: false };
	}
	const fraction = frontend.context_tokens / frontend.context_window;
	return {
		value: `${formatContextTokens(frontend.context_tokens)} / ${formatWindow(
			frontend.context_window,
		)} (${formatPercent(fraction)})`,
		fraction,
		estimated: frontend.context_is_estimate === true,
	};
}
