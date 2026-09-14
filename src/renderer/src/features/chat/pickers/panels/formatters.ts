/**
 * One spelling per quantity.
 *
 * Every number a panel prints goes through this file, because the defect it
 * exists to prevent is two surfaces disagreeing about one number: the Python
 * already had to unify two spellings of "tokens" across its own screens, and
 * these panels render the same quantities a third time. A formatter written
 * inline in a panel is a second opinion waiting to differ.
 *
 * Ported one-for-one from the modules the terminal renders from, with the
 * source named per function so a later reader can check the two against each
 * other. The rules that surprise a reader are written down as comments on the
 * functions rather than summarised here.
 *
 * Two shapes are deliberately NOT here:
 *
 * - The provider-usage amount ladder (`usage-view-model.ts`) owns its own
 *   half-even float rules for vendor quota amounts, which are a different
 *   quantity with a different denominator. Importing from it, or reproducing
 *   it, would merge two ladders into one.
 * - Parsing. Nothing here reads a formatted string back into a number: the
 *   panels are given numbers and format them once.
 */

/** The unknown sentinel. One character, the same one `info/model.py` uses. */
export const UNKNOWN = "—";

/** `unknown` for a duration-ish measurement that was never taken. */
export const UNKNOWN_WORD = "unknown";

/**
 * Money, from integer micro-USD (`analytics_panel.py` `format_cost`).
 *
 * Three honest answers, because collapsing them lies:
 *
 * - nothing priceable (`costKnownCalls === 0`) renders {@link UNKNOWN}, never
 *   `$0.00` — free and unknown are different facts, and a local-model-only run
 *   is the common case that produces the second;
 * - a partial figure takes a trailing `+`, marking it a LOWER BOUND, so it is
 *   never read as the whole bill;
 * - small sums keep more precision, because a fresh install's spend is
 *   fractions of a cent and rounding it to `$0.00` would read as free.
 *
 * `costKnownCalls < calls` implies `costKnownCalls > 0` on any payload the
 * routes produce, but the two tests are ordered defensively: the unknown case
 * is the one that must never grow a `+`.
 */
export function formatMicroUsd(
	costMicro: number,
	costKnownCalls: number,
	calls: number,
): string {
	if (costKnownCalls === 0) return UNKNOWN;
	const usd = costMicro / 1_000_000;
	let body: string;
	if (usd >= 1000) body = `$${(usd / 1000).toFixed(1)}k`.replace(".0k", "k");
	else if (usd >= 1) body = `$${usd.toFixed(2)}`;
	else if (usd >= 0.01) body = `$${usd.toFixed(3)}`;
	else body = `$${usd.toFixed(4)}`;
	return costKnownCalls < calls ? `${body}+` : body;
}

/** Round to one decimal the way a ceiling comparison wants it. */
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Compact token count: `912` / `3.4k` / `1.2M` / `4.1B`
 * (`analytics_panel.py` `format_tokens`).
 *
 * Analytics totals cross from a handful of tokens on a fresh install to
 * billions on a long-lived machine, so the headline numbers abbreviate. The
 * promotion test compares the ROUNDED value to each ceiling rather than the raw
 * one: `999_950` renders `1000.0k` under a raw `n < 1_000_000` check, so a
 * number that rounds up to the next unit is promoted to that unit.
 */
export function formatTokens(n: number): string {
	const value = Math.trunc(n);
	if (value < 1000) return String(value);
	const steps: [number, string, number][] = [
		[1000, "k", 1_000_000],
		[1_000_000, "M", 1_000_000_000],
	];
	for (const [divisor, suffix, ceiling] of steps) {
		if (value < ceiling && round1(value / divisor) < ceiling / divisor) {
			return `${(value / divisor).toFixed(1)}${suffix}`.replace(
				`.0${suffix}`,
				suffix,
			);
		}
	}
	return `${(value / 1_000_000_000).toFixed(1)}B`.replace(".0B", "B");
}

/**
 * Compact context estimate: `12.4k` / `1.2m`, plain under 1k
 * (`frontend_state.py` `format_context_tokens`).
 *
 * Lower-case `m` on purpose, and different from {@link formatTokens}: this is
 * an estimate the model's own window is denominated in, and the two spellings
 * exist side by side across the codebase's own history. Changing one to match
 * the other is the drift this file prevents, not a fix to it.
 */
export function formatContextTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/**
 * The denominator: `1M` / `200k`, no decimal on a whole value
 * (`frontend_state.py` `format_window`).
 *
 * Capital `M` and lower-case `k` are the conventional units for model windows,
 * and a window is a label rather than a measurement — `1M`, never `1.0M`.
 */
export function formatWindow(n: number): string {
	if (n >= 1_000_000) {
		const scaled = n / 1_000_000;
		return Number.isInteger(scaled)
			? `${scaled.toFixed(0)}M`
			: `${scaled.toFixed(1)}M`;
	}
	if (n >= 1_000) {
		const scaled = n / 1_000;
		return Number.isInteger(scaled)
			? `${scaled.toFixed(0)}k`
			: `${scaled.toFixed(1)}k`;
	}
	return String(n);
}

/**
 * An exact count: `1,234`.
 *
 * Deliberately NOT abbreviated. `formatTokens` abbreviates an estimate where
 * the glance matters more than the digit; a count of calls is the answer to a
 * question a user asked exactly ("how many did it fail"), so grouping is the
 * whole of its formatting.
 */
export function formatCount(n: number): string {
	return new Intl.NumberFormat("en-US").format(Math.trunc(n));
}

/**
 * One measurement in milliseconds: `840 ms` / `1.2 s` / `12.4 s`
 * (`session_panel.py` `_milliseconds`, extended past a second where the raw
 * `1,240 ms` stops being readable at a glance).
 *
 * `null` is `unknown`, never `0 ms`: a request whose duration was not recorded
 * did not take no time. The grouping separator survives into the
 * sub-second branch because the Python's own format carries it.
 */
export function formatMs(value: number | null | undefined): string {
	if (value === null || value === undefined) return UNKNOWN_WORD;
	if (Math.abs(value) < 1000) {
		return `${new Intl.NumberFormat("en-US").format(Math.round(value))} ms`;
	}
	return `${(value / 1000).toFixed(1)} s`;
}

/**
 * Wall-clock label for one request row: local `HH:MM`
 * (`session_panel.py` `_clock`).
 *
 * Time of day only: a session report's rows are a tail of one session, so the
 * date repeats on every row and would spend the label column saying nothing.
 */
export function formatClock(tsMs: number | null | undefined): string {
	if (tsMs === null || tsMs === undefined) return UNKNOWN_WORD;
	const at = new Date(tsMs);
	const hh = String(at.getHours()).padStart(2, "0");
	const mm = String(at.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/** `YYYY-MM-DD`, the only shape a rollup bucket may have. */
const DAY_BUCKET = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` rollup bucket as `Sep 13`.
 *
 * Parsed as a LOCAL date by splitting the string, not by `new Date(period)`:
 * that constructor reads a bare date as UTC midnight, which renders the
 * previous day for every user west of Greenwich — a chart labelled one day off
 * from the bucket it plots. The month names are spelled here rather than taken
 * from a locale so a frame is reproducible on any machine.
 *
 * An unparseable period is returned verbatim: the axis then shows what the
 * ledger actually said instead of `Invalid Date`.
 */
export function formatDayBucket(period: string): string {
	const match = DAY_BUCKET.exec(period);
	if (!match) return period;
	const month = Number(match[2]);
	if (month < 1 || month > 12) return period;
	return `${MONTHS[month - 1]} ${Number(match[3])}`;
}

/**
 * A rate: `73%` / {@link UNKNOWN}
 * (`analytics_panel.py` `format_percent`).
 *
 * `100%` is reserved for a genuinely complete rate: a value that is merely
 * close (99.6%) floors to `99%` rather than rounding up to a flat `100%` that
 * reads as mocked or broken beside the total it was derived from.
 */
export function formatPercent(fraction: number | null | undefined): string {
	if (fraction === null || fraction === undefined) return UNKNOWN;
	const pct = fraction * 100;
	if (pct > 99 && pct < 100) return "99%";
	return `${Math.round(pct)}%`;
}

/**
 * A byte count: `181 MB` / `1.9 GB` / {@link UNKNOWN}
 * (`info/model.py` `format_bytes`).
 *
 * `null` means nothing was measured — a process whose memory could not be read
 * is not a process using no memory, so `0 MB` is not available as an answer.
 */
export function formatBytes(value: number | null | undefined): string {
	if (value === null || value === undefined) return UNKNOWN;
	if (value >= 1 << 30) return `${(value / (1 << 30)).toFixed(1)} GB`;
	return `${Math.round(value / (1 << 20))} MB`;
}

/**
 * A duration in seconds: `42s` / `4m` / `3h 12m` / `2d 4h` / `unknown`
 * (`info/model.py` `format_duration`).
 *
 * One spelling shared by every surface for the same reason this whole file
 * exists. `null` is not a zero duration and says so.
 */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return UNKNOWN_WORD;
	const total = Math.trunc(Math.max(0, seconds));
	if (total < 60) return `${total}s`;
	if (total < 3600) return `${Math.floor(total / 60)}m`;
	if (total < 86400) {
		return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
	}
	return `${Math.floor(total / 86400)}d ${Math.floor((total % 86400) / 3600)}h`;
}
