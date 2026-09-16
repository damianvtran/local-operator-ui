import type {
	DesktopUsageAggregate,
	DesktopUsagePeriod,
} from "../../../../../../shared/desktop-contract";
import {
	formatDayBucket,
	formatMicroUsd,
	formatPercent,
	formatTokens,
} from "./formatters";

/**
 * `/analytics` — the pure decisions.
 *
 * The window rule lives here because it was the defect the design found: the
 * old view passed `days` to the op and drew every row the series returned, so
 * the chart could span more calendar days than the toolbar claimed (the series
 * returns the newest N buckets **that exist**, and one idle day consumes a
 * bucket slot). One computed local day now derives all three of the op's
 * arguments, and the chart filters to the same first day, so the header, the
 * axis and the aggregate cannot describe three different windows.
 *
 * Both tables carry the aggregate's cache hit rate as a COLUMN, which is the
 * form the terminal prints it in (`analytics_panel.py:1856`,
 * `f"{format_percent(agg.cache_hit_rate):>4} cache"`): a per-provider and
 * per-session rate belongs beside the row it describes, where a reader comparing
 * two providers can see it. The stat card alone cannot say whose rate it is.
 */

export type AnalyticsData = {
	aggregate: DesktopUsageAggregate;
	daily: DesktopUsagePeriod[];
	daily_scope?: string;
	/** Optional: a backend predating these renders ids and no tree (§5.3). */
	session_names?: Record<string, string>;
	session_parents?: Record<string, string>;
};

/** The one metric control, applied to the chart and both tables. */
export type AnalyticsMetric = "tokens" | "spend";

export const METRIC_LABEL: Record<AnalyticsMetric, string> = {
	tokens: "Tokens",
	spend: "Spend",
};

export type AnalyticsWindow = {
	days: number;
	/** Local `YYYY-MM-DD` of the window's first day. */
	firstDay: string;
	sinceMs: number;
	untilMs: number;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` for a local calendar day, `offsetDays` from `now`. */
export function localDayString(now: Date, offsetDays: number): string {
	const day = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + offsetDays,
	);
	return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Local midnight, `offsetDays` from `now`, as epoch milliseconds. */
export function localMidnightMs(now: Date, offsetDays: number): number {
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + offsetDays,
	).getTime();
}

/**
 * The window the op is asked for and the chart is filtered to.
 *
 * `untilMs` is local midnight TOMORROW, so the half-open range
 * (`ts_ms >= sinceMs && ts_ms < untilMs`) includes today's calls — an
 * exclusive bound at today's midnight would drop the current day from a panel
 * opened at 10am.
 */
export function analyticsWindow(days: number, now: Date): AnalyticsWindow {
	return {
		days,
		firstDay: localDayString(now, -(days - 1)),
		sinceMs: localMidnightMs(now, -(days - 1)),
		untilMs: localMidnightMs(now, 1),
	};
}

/** `Sep 7–Sep 13` — the span the window actually covers, local. */
export function spanLabel(win: AnalyticsWindow): string {
	const first = formatDayBucket(win.firstDay);
	const last = formatDayBucket(localDayString(new Date(win.untilMs - 1), 0));
	return `${first}–${last}`;
}

/** `Last 7 days · Sep 7–Sep 13 · this session` — the Totals section's qualifier. */
export function windowMeta(
	win: AnalyticsWindow,
	scope: "this session" | "all sessions",
): string {
	return `${windowTitle(win.days)} · ${spanLabel(win)} · ${scope}`;
}

/**
 * The day chart's own meta line.
 *
 * It names `all sessions` whenever the scope check is ON, because the daily
 * series is always the across-models, across-sessions rollup (`daily_scope`) —
 * a reader who ticked "this session only" and saw a chart with no scope stated
 * would reasonably read the bars as their session's.
 */
export function dailyMeta(
	win: AnalyticsWindow,
	scopeIsThisSession: boolean,
): string {
	const base = `Daily rollup · ${spanLabel(win)}`;
	return scopeIsThisSession ? `${base} · all sessions` : base;
}

export function windowTitle(days: number): string {
	return days === 1 ? "Today" : `Last ${days} days`;
}

/** Tokens the panel counts: what went in plus what came out. */
export const totalTokens = (aggregate: DesktopUsageAggregate): number =>
	aggregate.context_tokens + aggregate.output_tokens;

/**
 * ONE name for one measure, used by the tile and by both tables' column.
 *
 * Review round 1 (D3) caught the tile saying `Cache read` above a column saying
 * `Cache hit` with nothing in the frame to say they are the same number from the
 * same function. The name is the backend's own (`cache_hit_rate`, the property
 * the terminal prints), which is also the one that cannot be misread as
 * read/(read+written) — the reading the tile's note used to imply (D5b).
 *
 * A constant rather than two literals because the two surfaces have to agree by
 * construction: a rename that missed one of them is the defect the review round
 * found, and a single export cannot drift.
 */
export const CACHE_HIT_LABEL = "Cache hit rate";

/**
 * What that number is, and what `—` means, in one sentence.
 *
 * Rendered as a visible line under both tables AND folded into each table's own
 * accessible name, because the `title` attribute this replaced (review round 1,
 * D4) is reachable by neither a keyboard nor a touch reader and appears in no
 * captured frame — so neither the denominator nor the difference between `0%`
 * and `—` was ever stated anywhere a reader could find it.
 */
export const CACHE_HIT_MEANING =
	"Cache reads as a share of read context tokens; — means no call reported a context total.";

/**
 * `cache_read_tokens / context_tokens`, or `null` when there is no denominator.
 *
 * The ONE definition of the cache hit rate on this side, read by the "Cache
 * read" stat card and by the `Cache hit` column of both tables, so a card and a
 * column cannot disagree about one aggregate.
 *
 * CLAMPED at 1, which is the model layer's own rule
 * (`min(1.0, cache_read / context)`, `analytics/model.py:485-496`). A rate above
 * 100% is not a rate: on an aggregate the numerator and the denominator are
 * summed over different calls, so a provider that reads a cache it did not write
 * into `context_tokens` carries the ratio past 1, and the unclamped arithmetic
 * prints `137%` beside rows reading `99%`.
 *
 * `session-report-model.ts`'s `cacheHitRate` is the same function under another
 * name (the `/session` panel's port of the same model property) and already
 * carried the clamp; folding the two into one export would cross the two panel
 * models, so it is recorded rather than done here.
 */
export function cacheReadFraction(
	aggregate: DesktopUsageAggregate,
): number | null {
	if (!aggregate.context_tokens) return null;
	return Math.min(1, aggregate.cache_read_tokens / aggregate.context_tokens);
}

/** The priced share of the window: the cost card's own bar. */
export function costKnownFraction(
	aggregate: DesktopUsageAggregate,
): number | null {
	if (!aggregate.calls) return null;
	/*
	 * Nothing priceable in scope is NOT measured, which is a different fact from
	 * a measured zero, and the card's two halves have to agree about it: the
	 * value renders `—` when `cost_known_calls === 0` (§ 6.1), while a fraction
	 * of `0` draws the bar's AT-ZERO spelling — an empty track, which
	 * `proportion-bar.tsx` defines as the claim "nothing was spent". One card
	 * cannot say both (design round 1, D6). `null` is the unknown the bar renders
	 * as a dotted rule, so a window with no priced call says it once.
	 */
	if (aggregate.cost_known_calls === 0) return null;
	return aggregate.cost_known_calls / aggregate.calls;
}

/** The value a row is ranked and drawn by, in the selected metric. */
export function metricValue(
	aggregate: DesktopUsageAggregate,
	metric: AnalyticsMetric,
): number {
	return metric === "spend" ? aggregate.cost_micro : totalTokens(aggregate);
}

/**
 * A tick on a spend axis: a COMPLETE figure with no lower-bound mark.
 *
 * The `+` a partial sum carries marks a denominator the stat knows
 * (`cost_known_calls < calls`); an axis label has no denominator, so it states
 * the figure the axis is at. The one ladder is reused rather than re-derived,
 * which is what stops the axis and the tooltip spelling the same number twice.
 */
export function spendTick(micro: number): string {
	if (micro === 0) return "$0";
	return formatMicroUsd(micro, 1, 1);
}

/** A tick on a token axis: the same ladder the stat cards use. */
export const tokenTick = formatTokens;

/**
 * The day series, filtered to the window's first day.
 *
 * `daily` arrives as the newest N buckets that EXIST rather than as a
 * wall-clock window, so it can hold days before the window opened. Filtering
 * by the period string — both sides are local `YYYY-MM-DD`, which sorts
 * lexicographically — is what makes the axis agree with the header.
 */
export function chartSeries(
	daily: DesktopUsagePeriod[],
	win: AnalyticsWindow,
	metric: AnalyticsMetric,
): { bucket: string; value: number }[] {
	return daily
		.filter((row) => row.period >= win.firstDay)
		.map((row) => ({
			bucket: row.period,
			value:
				metric === "spend"
					? row.cost_micro
					: row.context_tokens + row.output_tokens,
		}));
}

/**
 * What a screen reader gets instead of the chart.
 *
 * Names the series, the span, how many buckets carry usage, the total and the
 * peak — the five facts the picture carries, in one sentence. A chart is never
 * the only carrier of a fact, but a summary that omitted the peak would make
 * the axis the only place the shape of the window is stated.
 */
export function chartSummary(
	rows: { bucket: string; value: number }[],
	win: AnalyticsWindow,
	metric: AnalyticsMetric,
): string {
	const series = metric === "spend" ? "Daily spend" : "Daily tokens";
	const span = `${formatDayBucket(win.firstDay)} to ${formatDayBucket(
		localDayString(new Date(win.untilMs - 1), 0),
	)}`;
	const withUsage = rows.filter((row) => row.value > 0);
	const total = rows.reduce((sum, row) => sum + row.value, 0);
	const peak = rows.reduce<{ bucket: string; value: number } | null>(
		(best, row) => (best === null || row.value > best.value ? row : best),
		null,
	);
	const format = metric === "spend" ? spendTick : tokenTick;
	const unit = metric === "spend" ? "" : " tokens";
	const parts = [
		`${series} from ${span}: ${withUsage.length} ${withUsage.length === 1 ? "day" : "days"} with usage`,
		`${format(total)}${unit} total`,
	];
	if (peak && peak.value > 0) {
		parts.push(
			`highest ${formatDayBucket(peak.bucket)} at ${format(peak.value)}${unit}`,
		);
	}
	return `${parts.join(", ")}.`;
}

export type ProviderRow = {
	key: string;
	calls: number;
	tokens: number;
	cost: string;
	fraction: number;
	/** The provider's OWN cache hit rate, `null` when it has no denominator. */
	cacheHit: number | null;
};

/**
 * Provider rows, ranked by the selected metric.
 *
 * A share is `row / total` over the same metric, so a bar's length and the
 * table's order agree: sorting by one quantity and drawing another is how a
 * bar chart starts contradicting its own table.
 */
export function providerRows(
	byProvider: Record<string, DesktopUsageAggregate> | undefined,
	metric: AnalyticsMetric,
): ProviderRow[] {
	const entries = Object.entries(byProvider ?? {});
	const total = entries.reduce(
		(sum, [, aggregate]) => sum + metricValue(aggregate, metric),
		0,
	);
	return entries
		.map(([key, aggregate]) => ({
			key,
			calls: aggregate.calls,
			tokens: totalTokens(aggregate),
			cost: formatMicroUsd(
				aggregate.cost_micro,
				aggregate.cost_known_calls,
				aggregate.calls,
			),
			fraction: total > 0 ? metricValue(aggregate, metric) / total : 0,
			cacheHit: cacheReadFraction(aggregate),
		}))
		.sort((a, b) => b.fraction - a.fraction || a.key.localeCompare(b.key));
}

export type SessionRow = {
	id: string;
	label: string;
	/** `true` when the label is the hex id rather than a name. */
	unnamed: boolean;
	/** 0-2; the walk stops at 2 so one deep subtree cannot indent the table away. */
	depth: number;
	calls: number;
	tokens: number;
	cost: string;
	fraction: number;
	/** The session's OWN rate; the totals beside it include subagents. */
	cacheHit: number | null;
};

/**
 * The by-session table: the top `cap` sessions by the selected metric.
 *
 * Depth comes from `session_parents`, walked upward with a cycle guard —
 * `_PARENT_EDGE_SQL` cannot produce a cycle, but a client that trusted another
 * process's data enough to loop forever would hang the renderer. When the
 * parent map is absent the table renders ids and no indentation, and says
 * nothing: an id is a true label, so there is nothing to apologise for.
 */
export function sessionRows(
	bySession: Record<string, DesktopUsageAggregate> | undefined,
	names: Record<string, string> | undefined,
	parents: Record<string, string> | undefined,
	metric: AnalyticsMetric,
	cap = 12,
): { rows: SessionRow[]; hidden: number } {
	const entries = Object.entries(bySession ?? {});
	const total = entries.reduce(
		(sum, [, aggregate]) => sum + metricValue(aggregate, metric),
		0,
	);
	const ranked = entries
		.map(([id, aggregate]) => ({
			id,
			aggregate,
			value: metricValue(aggregate, metric),
		}))
		.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
	const rows = ranked.slice(0, cap).map(({ id, aggregate }) => {
		const name = names?.[id];
		return {
			id,
			label: name ?? id,
			unnamed: !name,
			depth: sessionDepth(id, names, parents),
			calls: aggregate.calls,
			tokens: totalTokens(aggregate),
			cost: formatMicroUsd(
				aggregate.cost_micro,
				aggregate.cost_known_calls,
				aggregate.calls,
			),
			fraction: total > 0 ? metricValue(aggregate, metric) / total : 0,
			cacheHit: cacheReadFraction(aggregate),
		};
	});
	return { rows, hidden: Math.max(0, ranked.length - rows.length) };
}

/** How many parents a session has, clamped to 2, with a cycle guard. */
function sessionDepth(
	id: string,
	_names: Record<string, string> | undefined,
	parents: Record<string, string> | undefined,
): number {
	if (!parents) return 0;
	let depth = 0;
	const seen = new Set([id]);
	let cursor = parents[id];
	while (cursor && depth < 2) {
		if (seen.has(cursor)) break;
		seen.add(cursor);
		depth += 1;
		cursor = parents[cursor];
	}
	return depth;
}

/** The percentage label beside a bar. */
export const percentageOf = formatPercent;
