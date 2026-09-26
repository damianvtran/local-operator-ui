import type {
	DesktopModelRate,
	DesktopUsageAggregate,
	DesktopUsagePeriod,
} from "../../../../../../shared/desktop-contract";
import {
	UNKNOWN,
	formatClock,
	formatCount,
	formatDayBucket,
	formatMicroUsd,
	formatPercent,
	formatTokens,
	tokensPerSecond,
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

/**
 * `Last 7 days · Sep 7–Sep 13 · this session` — the Totals section's qualifier.
 *
 * `readAtMs` appends the sentence's one time CLAIM: when the read that produced
 * these numbers finished. It exists because these panels stopped refreshing
 * themselves (`SNAPSHOT_READ_POLICY` in query-client.ts): the query answers once
 * per open, the user's next ask is reopening the panel, and a panel left up for
 * an hour would otherwise hold numbers of unknowable age next to a window title
 * that names only a date range (design round 1, D6).
 *
 * The clause is `as of HH:MM` — the same clock the session panel's request rows
 * use, so the app states one time of day one way. Omitted when no read has
 * landed, because a panel with no data has nothing whose age needs stating.
 */
export function windowMeta(
	win: AnalyticsWindow,
	scope: "this session" | "all sessions",
	readAtMs?: number | null,
): string {
	const base = `${windowTitle(win.days)} · ${spanLabel(win)} · ${scope}`;
	return readAtMs === null || readAtMs === undefined
		? base
		: `${base} · as of ${formatClock(readAtMs)}`;
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

/* ---------------------------------------------------------------------------
 * Generation rate: the measured-decode half, and its coverage.
 *
 * Two quantities live under the word "rate" and this file keeps them apart by
 * TYPE as well as by name, because a surface that could pick the wrong one by
 * reading a similarly-named field would eventually do so:
 *
 * - **decode** — the measured generation window, from a call's first output
 *   token to its last. It is what `aggregate()` carries (the three optional
 *   `decode_*` fields) and what all three tables' `tok/s (decode)` column
 *   reads. Forward-fill: a call recorded before the feature has no window, so
 *   `decode_calls === 0` means UNKNOWN and the column prints `—`.
 * - **wall** — the whole call, `wall_tokens / (wall_us / 1e6)`, which exists
 *   only on `DesktopModelRate` because it needs no new column and so covers the
 *   entire existing ledger. It includes time-to-first-token and any provider
 *   queueing, is NEVER decode speed, and is therefore the By-model table's
 *   second column and no other table's.
 *
 * The unknown-never-zero rule is enforced in ONE place (`tokensPerSecond` in
 * `formatters.ts`), so every cell below inherits it rather than restating it:
 * a rate is `null` exactly when nothing was measured, and a measured slow rate
 * stays a number.
 * ------------------------------------------------------------------------- */

/** The rate column's heading, spelled once for all three tables. */
export const TOK_PER_SECOND_LABEL = "tok/s (decode)";

/**
 * The By-model table's SECOND rate column.
 *
 * A different name rather than a second `tok/s`, because the two columns sit
 * side by side and a reader has to be able to tell which is which from the
 * header alone. `wall` is the backend's own word for it (`wall_us`,
 * `wall_tokens`, `wall_calls`) and the one the design uses.
 */
export const WALL_TOK_PER_SECOND_LABEL = "tok/s (wall)";

/** The coverage column's heading on the By-model table. */
export const COVERAGE_LABEL = "Coverage";

/**
 * `decode_tokens / (decode_us / 1e6)` for one aggregate, or `null` when no call
 * in it contributed a measured window.
 *
 * The `?? 0` on all three reads is the compatibility rule, not defensiveness:
 * the fields are ADDITIVE, so a backend that predates them omits them entirely
 * — and an absent triple and a present `{0, 0, 0}` are the same fact ("nothing
 * was measured"), which is why they converge here rather than producing two
 * spellings of unknown.
 */
export function decodeRate(aggregate: DesktopUsageAggregate): number | null {
	return tokensPerSecond(
		aggregate.decode_tokens ?? 0,
		aggregate.decode_us ?? 0,
		aggregate.decode_calls ?? 0,
	);
}

/** How much of a scope a rate actually speaks for. */
export type RateCoverage = {
	/** Calls in scope. */
	calls: number;
	/** Calls that contributed a measured window. Always `<= calls`. */
	covered: number;
};

/** The decode half of an aggregate's coverage. */
export const decodeCoverage = (
	aggregate: DesktopUsageAggregate,
): RateCoverage => ({
	calls: aggregate.calls,
	covered: aggregate.decode_calls ?? 0,
});

/** `covered / calls`, or `null` when the scope has no calls to cover. */
export function coverageFraction(coverage: RateCoverage): number | null {
	if (coverage.calls <= 0) return null;
	return coverage.covered / coverage.calls;
}

/**
 * What a rate column's `—` means, in one line, or `null` when there is nothing
 * to explain.
 *
 * Silent when coverage is complete: `Decode rate over 1,530 of 1,530 calls` is
 * a sentence that says nothing, and the panel already refuses those
 * (`sessionMatchLine` returns `null` for the same reason). It speaks in the two
 * states a reader can be misled by:
 *
 * - **Partial coverage**, where the number in the column is real but is not the
 *   whole scope — stated as the counts rather than as a percentage, because
 *   "how many calls does this speak for" is the question, and `81%` does not
 *   answer it.
 * - **No coverage at all**, which is the whole column rendering `—`. The
 *   sentence says WHY, because a reader who does not know the feature is
 *   forward-fill would read a column of `—` as a broken panel rather than as a
 *   ledger that predates the measurement. It is also the one place the panel
 *   states the inverse of the usual trap out loud: this is not `0 tok/s`, it is
 *   *nothing measured*.
 *
 * The words avoid the vocabulary the panel's copy rules forbid: no "decode
 * window" as a bare noun phrase without saying what it is, no "rollup", no
 * "field".
 */
export function rateLegend(coverage: RateCoverage): string | null {
	if (coverage.calls === 0) return null;
	if (coverage.covered === 0) {
		return `No call in this window has a measured generation time yet, so the rate reads ${UNKNOWN} rather than 0 tok/s.`;
	}
	if (coverage.covered < coverage.calls) {
		return `Decode rate over ${formatCount(coverage.covered)} of ${formatCount(coverage.calls)} calls.`;
	}
	return null;
}

/**
 * The By-model table's own line, which has to explain TWO columns at once.
 *
 * Composed from the same `rateLegend` sentence rather than re-spelled, so the
 * decode half of the two tables cannot drift; the wall clause is appended
 * because that table is the only one with a wall column, and it is stated as a
 * count for the same reason — the wall rate covers every call that has a
 * duration, which on a real ledger is nearly but not exactly all of them.
 *
 * The source clause is here rather than in the meta line because it is a fact
 * about the NUMBERS and not about the section: these counts come from the raw
 * ledger, while the Totals above them came from the rollup, and the columns
 * that must not be read as one partition are exactly these.
 */
export function modelRateLegend(
	decode: RateCoverage,
	wall: RateCoverage,
): string | null {
	const parts = [
		rateLegend(decode) ??
			`Decode rate over all ${formatCount(decode.calls)} calls.`,
		`Wall rate over ${formatCount(wall.covered)} of ${formatCount(wall.calls)} calls.`,
	];
	return parts.join(" ");
}

/**
 * The By-model rows, ranked by output tokens.
 *
 * **This table does not follow the metric control, and that is a property of
 * its payload rather than a choice.** `DesktopModelRate` carries `output_tokens`
 * and `calls` and no price at all — the grouped ledger scan does not read
 * `cost_micro` — so under `Spend` there is no column here to rank by. Ranking
 * it by the metric would mean printing a share of a number the row does not
 * have. The order is therefore the backend's own (`SUM(output_tokens) DESC`,
 * `provider`, `model_id`) and the section's meta says so out loud.
 *
 * The tie-break is the `provider/model_id` label, ascending, which is
 * `providerRows`' rule (`b.fraction - a.fraction || a.key.localeCompare(b.key)`)
 * applied to the one measure these rows carry — so two tables that rank by
 * different quantities still break ties the same way, and equal rows keep one
 * order across two identical renders.
 *
 * A row whose sum is meaningless is not dropped: a model with `calls: 0` cannot
 * arrive (the server groups rows that exist), but a model with zero output
 * tokens can, and it renders a zero-length bar rather than disappearing.
 */
export type ModelRow = {
	/** `provider/model_id`. A stable identity and the row's tie-break. */
	key: string;
	provider: string;
	modelId: string;
	/** `anthropic/claude-opus-5`; a missing half reads `—`, never a bare `/`. */
	label: string;
	calls: number;
	outputTokens: number;
	/** Share of the table's output tokens, which is what the bar draws. */
	fraction: number;
	decodeRate: number | null;
	wallRate: number | null;
	/** Share of the row's calls carrying a measured window. `null` at no calls. */
	decodeCoverage: number | null;
	wallCoverage: number | null;
};

/**
 * The row's label: two halves with the unknown spelling per half.
 *
 * `formatModelSpec` refuses the join of two empty strings, which is the right
 * rule for a `{provider: "", model_id: ""}` spec and the wrong one here: a
 * ledger row that recorded a provider but no model would lose its provider, and
 * the provider is the half that still identifies the group. So each half is
 * spelled and the separator is kept — unless NEITHER half is present, where a
 * bare `/` would be a fabricated glyph and the row says `—` once.
 */
function modelLabel(provider: string, modelId: string): string {
	if (!provider && !modelId) return UNKNOWN;
	return `${provider || UNKNOWN}/${modelId || UNKNOWN}`;
}

export function modelRows(
	rows: DesktopModelRate[] | undefined | null,
): ModelRow[] {
	const entries = rows ?? [];
	const total = entries.reduce((sum, row) => sum + row.output_tokens, 0);
	return entries
		.map((row) => ({
			/*
			 * The key is the pair and NOT the label: `(provider, model_id)` is the
			 * `GROUP BY`'s own key, so it is unique by construction, while the label
			 * folds a missing half into `—` and could therefore collide for two
			 * groups that each miss a different half.
			 */
			key: `${row.provider}\u0000${row.model_id}`,
			provider: row.provider,
			modelId: row.model_id,
			label: modelLabel(row.provider, row.model_id),
			calls: row.calls,
			outputTokens: row.output_tokens,
			fraction: total > 0 ? row.output_tokens / total : 0,
			decodeRate: tokensPerSecond(
				row.decode_tokens,
				row.decode_us,
				row.decode_calls,
			),
			wallRate: tokensPerSecond(row.wall_tokens, row.wall_us, row.wall_calls),
			decodeCoverage: coverageFraction({
				calls: row.calls,
				covered: row.decode_calls,
			}),
			wallCoverage: coverageFraction({
				calls: row.calls,
				covered: row.wall_calls,
			}),
		}))
		.sort((a, b) => b.fraction - a.fraction || a.key.localeCompare(b.key));
}

/** The decode coverage of a whole By-model table, summed over its rows. */
export function modelCoverage(rows: DesktopModelRate[] | undefined | null): {
	decode: RateCoverage;
	wall: RateCoverage;
} {
	const all = rows ?? [];
	return {
		decode: {
			calls: all.reduce((sum, row) => sum + row.calls, 0),
			covered: all.reduce((sum, row) => sum + row.decode_calls, 0),
		},
		wall: {
			calls: all.reduce((sum, row) => sum + row.calls, 0),
			covered: all.reduce((sum, row) => sum + row.wall_calls, 0),
		},
	};
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
	/**
	 * The provider's OWN measured decode rate, `null` when none of its calls
	 * carries a generation window.
	 *
	 * Read from the ROW's aggregate and never from the panel's headline: the
	 * heading's number is a different claim about a different scope, and the two
	 * would disagree on the first row that is not the whole table.
	 */
	decodeRate: number | null;
};

/**
 * Provider rows, ranked by the selected metric.
 *
 * A share is `row / total` over the same metric, so a bar's length and the
 * table's order agree: sorting by one quantity and drawing another is how a
 * bar chart starts contradicting its own table.
 *
 * The rate column does NOT participate in the ranking, and cannot: it is a
 * ratio of two quantities this table does not sum, its denominator is only some
 * of the row's calls, and ordering by it would put a provider with one measured
 * call above a provider with a hundred thousand. It is a reading beside the row
 * it describes, exactly as the cache hit rate is.
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
			decodeRate: decodeRate(aggregate),
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
	/**
	 * The session's OWN measured decode rate, same rule as `cacheHit`: read from
	 * the row's aggregate, and `null` when no call of this session carries a
	 * generation window. Filled by `analytics-session-state.ts`, which owns the
	 * row enrichment; this type is the column's reading of it.
	 */
	decodeRate: number | null;
};

/*
 * Where the by-session rows come from, now that this file no longer builds
 * them: `analytics-session-state.ts` indexes the payload, narrows it, orders it,
 * slices one page out of it and enriches those rows into `SessionRow[]`. This
 * file keeps the two things the move could have broken — the row's SHAPE, which
 * the columns read, and the depth walk below, whose clamp and cycle guard are
 * the reason a 4,550-row table cannot indent itself away or hang the renderer.
 */

/**
 * How many parents a session has, clamped to 2, with a cycle guard.
 *
 * Exported because the row enrichment lives in `analytics-session-state.ts` and
 * this walk must stay single-sourced: the clamp is a presentation decision
 * (`_PARENT_EDGE_SQL` cannot produce a cycle, but a client that trusted another
 * process's data enough to loop forever would hang the renderer) and a second
 * copy of it in the table's own module is how the two would drift.
 */
export function sessionDepth(
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
