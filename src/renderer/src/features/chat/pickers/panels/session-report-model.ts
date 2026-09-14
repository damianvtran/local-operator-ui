import type {
	DesktopSessionReport,
	DesktopToolCallStats,
	DesktopUsageAggregate,
} from "../../../../../../shared/desktop-contract";
import {
	formatDayBucket,
	formatMicroUsd,
	formatMs,
	formatTokens,
} from "./formatters";

/**
 * `/session` — the pure decisions.
 *
 * The panel reads ONE op (`sessions.report`) because every number on it comes
 * from one pinned read transaction; a second aggregate computed by a different
 * query path is exactly what that op exists to avoid. What this file owns is
 * therefore not fetching but arithmetic: the two rates the wire does not
 * compute, the subtree sums, and the ordering of every table.
 */

/** Tokens the panel counts as "billed": what went in plus what came out. */
export const totalTokens = (aggregate: DesktopUsageAggregate): number =>
	aggregate.context_tokens + aggregate.output_tokens;

/**
 * Fraction of read context served from cache, or `null` when unknowable.
 *
 * `cache_read / context_tokens`, taken from the model layer's own definition:
 * for providers whose `input_tokens` excludes cache, `context_tokens` already
 * sums the three, and for providers whose input includes cache it equals
 * input — so one formula is the honest hit rate in both worlds. Clamped at 1,
 * because an aggregate is not a single call and rounding can exceed it.
 */
export function cacheHitRate(aggregate: DesktopUsageAggregate): number | null {
	if (aggregate.context_tokens <= 0) return null;
	return Math.min(1, aggregate.cache_read_tokens / aggregate.context_tokens);
}

/** Whether a subagent breakdown is worth drawing at all. */
export const hasDescendants = (report: DesktopSessionReport): boolean =>
	report.descendant_ids.length > 0;

/**
 * This session's money INCLUDING its subagents.
 *
 * The headline answers "what has this session cost me", and a session that
 * spent through twenty subagents did not spend only its own figure. When the
 * subtree walk could not run the total is the OWN figure and the note says so —
 * an unmeasured subtree is not a $0.00 one.
 */
export function costWithSubagents(report: DesktopSessionReport): number {
	return (
		report.aggregate.cost_micro +
		(report.descendants_aggregate?.cost_micro ?? 0)
	);
}

/**
 * Whether the subtree walk could not run, which is a different fact from a
 * session with no subagents.
 */
export const subtreeUnmeasured = (report: DesktopSessionReport): boolean =>
	report.descendants_aggregate === null && hasDescendants(report);

/** The Totals meta: the counts, the failures when there are any, and the scope. */
export function totalsMeta(report: DesktopSessionReport): string {
	const aggregate = report.aggregate;
	let meta = `${aggregate.calls} ${aggregate.calls === 1 ? "request" : "requests"}`;
	if (aggregate.ok_calls !== aggregate.calls) {
		meta += ` (${aggregate.calls - aggregate.ok_calls} failed)`;
	}
	if (hasDescendants(report)) meta += " · cost incl. subagents";
	return meta;
}

/**
 * The cost stat's value: this session's money, subagents included.
 *
 * `formatMicroUsd` owns the whole ladder and the lower-bound `+`; this call
 * passes the session's OWN pricing counts, because a partial own figure is a
 * partial tree figure too. Nothing here re-derives a money spelling.
 */
export const costValue = (report: DesktopSessionReport): string =>
	formatMicroUsd(
		costWithSubagents(report),
		report.aggregate.cost_known_calls,
		report.aggregate.calls,
	);

/**
 * The cost stat's note: the scope, or why the scope cannot be stated.
 *
 * Three facts in priority order, and the third is the one that must never be
 * guessed: an unwalked subtree is not a $0.00 subtree.
 */
export function costNote(report: DesktopSessionReport): string | undefined {
	const aggregate = report.aggregate;
	if (aggregate.cost_known_calls === 0) {
		return "No call in this session has a published price";
	}
	if (!hasDescendants(report)) return undefined;
	const descendants = report.descendants_aggregate;
	if (subtreeUnmeasured(report) || descendants === null) {
		return "subagent spend not measured";
	}
	return `${formatMicroUsd(
		aggregate.cost_micro,
		aggregate.cost_known_calls,
		aggregate.calls,
	)} own · ${formatMicroUsd(
		descendants.cost_micro,
		descendants.cost_known_calls,
		descendants.calls,
	)} subagents`;
}

/**
 * The component split's own keys, in the order the model layer declares them.
 *
 * Ported rather than derived from the payload's key order: `components` is a
 * dict, so its order is the producer's, and a table whose rows reorder between
 * two frames of the same session is a table nobody can compare with itself.
 */
export const COMPONENT_KEYS = [
	"system_prompt",
	"custom_instructions",
	"tool_inventory",
	"tool_schemas",
	"environment",
	"knowledge",
	"conversation",
	"tool_results",
	"images",
] as const;

/** Human labels for each component key (`analytics/model.py` `COMPONENT_LABELS`). */
export const COMPONENT_LABELS: Record<string, string> = {
	system_prompt: "System prompt",
	custom_instructions: "Custom instructions (agents/teams)",
	tool_inventory: "Tool inventory",
	tool_schemas: "Tool schemas",
	environment: "Environment",
	knowledge: "Knowledge / skills",
	conversation: "Conversation",
	tool_results: "Tool results",
	images: "Images (est.)",
};

/** The metric the section tables are ranked and drawn by. */
export type SessionMetric = "tokens" | "cost";

export const SESSION_METRIC_LABEL: Record<SessionMetric, string> = {
	tokens: "Tokens",
	cost: "Cost",
};

/** One aggregated row of a proportional section. */
export type BarRow = {
	key: string;
	label: string;
	calls: number;
	/** The row's own figure, formatted in the selected metric. */
	value: string;
	/** Share of the section's total in the same metric. */
	fraction: number | null;
	note?: string;
};

const metricOf = (
	aggregate: DesktopUsageAggregate,
	metric: SessionMetric,
): number =>
	metric === "cost" ? aggregate.cost_micro : totalTokens(aggregate);

const metricText = (
	aggregate: DesktopUsageAggregate,
	metric: SessionMetric,
): string =>
	metric === "cost"
		? formatMicroUsd(
				aggregate.cost_micro,
				aggregate.cost_known_calls,
				aggregate.calls,
			)
		: formatTokens(totalTokens(aggregate));

/** Rows over one list of same-denominator aggregates, ranked by the metric. */
function barRows(
	entries: { key: string; label: string; aggregate: DesktopUsageAggregate }[],
	metric: SessionMetric,
): BarRow[] {
	const total = entries.reduce(
		(sum, entry) => sum + metricOf(entry.aggregate, metric),
		0,
	);
	return entries
		.map((entry) => ({
			key: entry.key,
			label: entry.label,
			calls: entry.aggregate.calls,
			value: metricText(entry.aggregate, metric),
			fraction: total > 0 ? metricOf(entry.aggregate, metric) / total : null,
		}))
		.sort(
			(a, b) =>
				(b.fraction ?? -1) - (a.fraction ?? -1) || a.key.localeCompare(b.key),
		);
}

/** Section 3: one row per (provider, model) pair. */
export const modelRows = (
	report: DesktopSessionReport,
	metric: SessionMetric,
): BarRow[] =>
	barRows(
		report.by_model.map((entry) => ({
			key: `${entry.provider}/${entry.model_id}`,
			label: `${entry.provider}/${entry.model_id}`,
			aggregate: entry.aggregate,
		})),
		metric,
	);

/**
 * Purpose rows.
 *
 * §5.2 declares `by_purpose` an ARRAY, for the same reason the route converts
 * `by_model` and `by_purpose_outcome`: a `dict` reaches JSON as a keyed object
 * and the client cannot order it. As driven against the backend head at the
 * time, it still arrived as the raw `dict[str, UsageAggregate]`, which is
 * reported as a cross-repo finding and fixed upstream — so this reads the array
 * the contract promises and nothing else. A tolerant reader that accepted both
 * shapes would make two shapes permanent, and there is no deployment case for
 * it: a backend without the routes also lacks `features.diagnostics`, so the
 * gate means the op is never called there. {@link reportShapeProblem} is what
 * turns the other shape into a sentence on the panel instead of a crash.
 */
export const purposeRows = (
	report: DesktopSessionReport,
	metric: SessionMetric,
): BarRow[] =>
	barRows(
		report.by_purpose.map((entry) => ({
			key: entry.purpose,
			label: entry.purpose,
			aggregate: entry.aggregate,
		})),
		metric,
	);

/**
 * Whether this report carries a shape the panel cannot render, and why.
 *
 * A group-by that arrives keyed rather than listed is not an empty answer and
 * not an outage: it is an answer written to a different contract, and the one
 * thing the panel must not do about it is render anyway — `by_purpose.map` over
 * an object throws inside the render pass, which unmounts the panel to the
 * app's error boundary and loses the ledger facts that WERE readable. Naming
 * the field here turns it into the panel's own `unavailable` state, which says
 * what happened and what it means. Reported upstream rather than absorbed.
 */
export function reportShapeProblem(
	report: DesktopSessionReport,
): string | null {
	if (!Array.isArray(report.by_purpose)) {
		return "This backend sent the purpose breakdown as keyed rows rather than a list, which this panel cannot draw. Update the backend and try again.";
	}
	return null;
}

/**
 * Section 5: where the input went, as the nine declared components.
 *
 * Rows are the nine keys with the model layer's own labels, sorted descending,
 * over `sum(components)`. A component the payload does not carry renders `0`
 * rather than being dropped: the split is a partition of the context, so a
 * missing key is a zero in that slot, and dropping the row would silently
 * rescale every share beside it.
 */
export function componentRows(aggregate: DesktopUsageAggregate): {
	rows: BarRow[];
	total: number;
} {
	const components = aggregate.components ?? {};
	const total = COMPONENT_KEYS.reduce(
		(sum, key) => sum + (components[key] ?? 0),
		0,
	);
	const rows = COMPONENT_KEYS.map((key) => ({
		key,
		label: COMPONENT_LABELS[key] ?? key,
		calls: 0,
		value: formatTokens(components[key] ?? 0),
		fraction: total > 0 ? (components[key] ?? 0) / total : null,
	})).sort(
		(a, b) =>
			(b.fraction ?? -1) - (a.fraction ?? -1) || a.label.localeCompare(b.label),
	);
	return { rows, total };
}

/** One timings row: the mean, the range, and how many samples it came from. */
export type TimingRow = {
	key: string;
	label: string;
	mean: string;
	range: string;
	samples: number;
};

const TIMING_ROWS: {
	key: keyof DesktopSessionReport["timings"];
	label: string;
}[] = [
	{ key: "duration_ms", label: "Duration" },
	{ key: "ttft_ms", label: "First output" },
	{ key: "preparation_ms", label: "Preparation" },
];

/**
 * Section 6's three rows.
 *
 * A table rather than a chart: three quantities with no shared denominator and
 * no shared unit interpretation — preparation is not wall time the user waited
 * — so drawing them beside one another would assert a comparison nobody made.
 * Zero samples renders `unknown (0 samples)`, the TUI's own spelling, because a
 * mean over no samples is not a zero.
 */
export const timingRows = (report: DesktopSessionReport): TimingRow[] =>
	TIMING_ROWS.map(({ key, label }) => {
		const summary = report.timings[key];
		if (!summary || summary.samples === 0) {
			return {
				key,
				label,
				mean: "unknown (0 samples)",
				range: "unknown",
				samples: 0,
			};
		}
		return {
			key,
			label,
			mean: formatMs(summary.mean_ms),
			range: `${formatMs(summary.min_ms)} – ${formatMs(summary.max_ms)}`,
			samples: summary.samples,
		};
	});

/**
 * The two tool-call rates, derived here because they are Python properties.
 *
 * They are returned as ONE object with the counts they came from so a caller
 * cannot print a rate without its denominator: the two share no denominator,
 * and a panel that drew them as neighbouring bars would invite exactly the
 * comparison that is not available.
 *
 * `null` means "no eligible calls", never a zero rate.
 */
export type ToolRates = {
	emitted: number;
	modelFaults: number;
	executionFaults: number;
	excluded: number;
	validity: number | null;
	executionErrorRate: number | null;
};

const EXCLUDED_FAULTS = [
	"denied",
	"aborted",
	"skipped",
	"gate_failed",
] as const;
const MODEL_FAULTS = [
	"unknown_tool",
	"invalid_arguments",
	"duplicate_id",
] as const;

export function toolRates(stats: DesktopToolCallStats): ToolRates {
	const faults = stats.faults ?? {};
	const count = (names: readonly string[]) =>
		names.reduce((sum, name) => sum + (faults[name] ?? 0), 0);
	const excluded = count(EXCLUDED_FAULTS);
	const modelFaults = count(MODEL_FAULTS);
	const emitted = stats.total - excluded;
	const dispatched = emitted - modelFaults;
	return {
		emitted,
		modelFaults,
		executionFaults: faults.execution ?? 0,
		excluded,
		validity: emitted > 0 ? (emitted - modelFaults) / emitted : null,
		executionErrorRate:
			dispatched > 0 ? (faults.execution ?? 0) / dispatched : null,
	};
}

/** Faults by name, most frequent first, for sections 7's table. */
export const faultRows = (
	stats: DesktopToolCallStats,
): { key: string; count: number }[] =>
	Object.entries(stats.faults ?? {})
		.filter(([, count]) => count > 0)
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

/** Section 8's rows: the recent-requests tail, newest first as received. */
export type RequestRow = {
	request_id: string;
	/** The outcome cell's state, derived from `ok` and NEVER from `outcome`. */
	state: "ok" | "failed" | "unknown";
	purpose: string;
	model: string;
	context: string;
	output: string;
	duration: string;
};

export const requestRows = (report: DesktopSessionReport): RequestRow[] =>
	report.recent.map((row) => ({
		request_id: row.request_id,
		state: row.ok === true ? "ok" : row.ok === false ? "failed" : "unknown",
		purpose: row.purpose,
		model: `${row.provider}/${row.model_id}`,
		context: formatTokens(row.context_tokens),
		output: formatTokens(row.output_tokens),
		duration: formatMs(row.duration_ms),
	}));

/**
 * The Scope disclosure's two facts: the record's own span.
 *
 * Formatted from the panel's own formatters rather than `toLocaleString`, whose
 * output depends on the machine's locale: a frame captured on one host would
 * then not be reproducible on another, and a date is not a place to discover
 * that.
 */
export function scopeSpan(report: DesktopSessionReport): {
	first: string;
	last: string;
} {
	const stamp = (ms: number | null): string => {
		if (ms === null) return "unknown";
		const at = new Date(ms);
		const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
		return `${formatDayBucket(day)} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
	};
	return { first: stamp(report.first_ts_ms), last: stamp(report.last_ts_ms) };
}
