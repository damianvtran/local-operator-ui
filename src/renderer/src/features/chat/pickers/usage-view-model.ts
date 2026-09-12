/**
 * The `/usage` view's arithmetic, ported from the TUI panel.
 *
 * Every rule in this file already exists in Python and is the SOURCE OF TRUTH
 * for what the numbers mean:
 *
 *   local_operator/tui/widgets/usage_panel.py   — formatting, tally, binding
 *   local_operator/providers/usage.py           — `UsageAmount.fraction()`,
 *                                                 `.status()`, `UNIT_LABELS`,
 *                                                 `UsageLimit.resets_in_ms()`
 *
 * It is React-free on purpose. These are the rules a reviewer has to be able
 * to check against their Python originals without reading JSX, and the rules
 * `scripts/usage-view.test.mjs` asserts — a port whose only check is "the
 * story looks right" drifts from its source the first time either side is
 * edited. If you change anything here, change it there too, or you have
 * invented a second answer to a question that already had one.
 *
 * The data shape is `GET /v1/desktop/usage` as the route actually sends it
 * (`dataclasses.asdict(UsageReport)` plus `age_ms` and `state`), documented in
 * `docs/evidence/chat-usage/SPEC.md`.
 */

export type UsageUnit = "usd" | "percent" | "tokens" | "requests" | "unknown";

/** The consumed/remaining numbers for one window, as the vendor reported them. */
export type UsageAmount = {
	used: number | null;
	limit: number | null;
	remaining: number | null;
	/** Explicit 0..1 utilisation; takes precedence over anything derived. */
	used_fraction: number | null;
	unit: UsageUnit;
};

/** One quota window: an account-wide umbrella or a per-model cap. */
export type UsageLimit = {
	id: string;
	label: string;
	amount: UsageAmount;
	/** Free-form window name from the vendor ("five_hour", "weekly", …). */
	window: string;
	/** Vendor-stated status; `null` when it only published numbers. */
	status: string | null;
	resets_at: string | null;
	resets_at_ms: number | null;
	/** Model family for a per-model cap; `""` when the window is account-wide. */
	tier: string;
	/** True for the account-wide umbrella windows. */
	shared: boolean;
};

/** One provider's quota state at one instant. */
export type UsageReport = {
	provider: string;
	fetched_at: number;
	limits: UsageLimit[];
	notes: null;
	identity: string | null;
	consecutive_failures: number;
	usage_unavailable: boolean;
	next_probe_at_ms: number | null;
	credential_invalid: boolean;
	/** Server clock minus `fetched_at`, computed server-side. */
	age_ms: number;
	state: UsageState;
};

export type UsageState =
	| "available"
	| "partial"
	| "unavailable"
	| "reauth_required";

/** What `usage.get` resolves to. `fetched_at` is the server clock, epoch ms. */
export type UsagePayload = {
	reports: UsageReport[];
	source: "cached" | "live" | string;
	fetched_at: number;
};

/** The four words this view has a colour and a screen-reader phrase for. */
export type EffectiveStatus = "ok" | "warning" | "exhausted" | "unknown";

/**
 * What a row's status actually IS, which may be a word this view has never
 * heard of.
 *
 * `UsageLimit.effective_status()` is `self.status or self.amount.status()` — a
 * vendor word passes through verbatim, and `usage_cache.py` rehydrates
 * `status` straight from cached JSON, so the value is not constrained to the
 * four. Modelling it as `EffectiveStatus` was what let a vendor saying
 * `throttled` at 10% fall back to the DERIVED status and render as a healthy
 * green row: the view did not merely lack a colour for the word, it discarded
 * the word and asserted something the vendor never said.
 */
export type ReportedStatus = EffectiveStatus | (string & {});

/**
 * The ramp a status paints on. `_status_color()` in `usage_panel.py` maps
 * `ok`/`warning`/`exhausted` to their semantics and EVERYTHING ELSE — the
 * derived `unknown` and any unrecognised vendor word alike — to `dim`.
 *
 * Separating the tone from the word is what lets an unrecognised status keep
 * its own meaning (it is spoken verbatim, it is not counted as a healthy
 * window) while still being painted in a colour the view can honestly claim.
 */
export type StatusTone = "ok" | "warning" | "exhausted" | "dim";

/**
 * The three words that have a semantic colour. A lookup rather than a chain of
 * `===` because `ReportedStatus` includes `string`, which a comparison cannot
 * narrow away \u2014 the widened branch would still be `string`, not the literal.
 */
const TONED: Record<string, StatusTone> = {
	ok: "ok",
	warning: "warning",
	exhausted: "exhausted",
};

export const statusTone = (status: ReportedStatus): StatusTone =>
	TONED[status] ?? "dim";

/**
 * Human labels for each unit — `UNIT_LABELS` in `providers/usage.py`.
 *
 * `unknown` is deliberately empty: a currency with no entry (a CNY balance)
 * rides in the limit's label and prints as a bare number rather than wearing a
 * dollar sign it did not earn.
 */
export const UNIT_LABELS: Record<string, string> = {
	usd: "USD",
	percent: "%",
	tokens: "tokens",
	requests: "req",
	unknown: "",
};

/** The fraction at which a window starts being called out. `UsageAmount.status()`. */
export const WARNING_FRACTION = 0.85;

/**
 * How far behind the response's own stamp a report must fall to be called stale.
 *
 * `_stale_behind_ms()` in `usage_panel.py`: `USAGE_REPORT_TTL_MS * 1.25`, where
 * the TTL is 5 min (`providers/usage_cache.py`) and is jittered ±25%. Anchored
 * to the CACHE's freshness contract rather than to a display resolution,
 * because the background warmer only refreshes the ACTIVE provider — an idle
 * provider's numbers are SUPPOSED to be minutes old, and calling that stale
 * marked a healthy panel on 97% of opens, which burns the signal for the one
 * genuinely stuck account this view exists to surface.
 *
 * A failure streak alone is NOT staleness (SPEC rule 10): a 429 after a fresh
 * confirmation does not change what the numbers say or when they were
 * confirmed, so `consecutive_failures > 0` must not produce a note.
 */
export const STALE_BEHIND_MS = 5 * 60_000 * 1.25;

/**
 * Best-effort consumed fraction 0..1, or null when unmeasurable.
 * `UsageAmount.fraction()`. Never guesses: a window with nothing to divide
 * returns null and renders as "not reported", not as zero (SPEC rule 4).
 */
export const fractionOf = (amount: UsageAmount): number | null => {
	if (amount.used_fraction !== null) return amount.used_fraction;
	if (amount.used !== null && amount.limit && amount.limit > 0)
		return amount.used / amount.limit;
	if (
		amount.used !== null &&
		amount.remaining !== null &&
		amount.used + amount.remaining > 0
	)
		return amount.used / (amount.used + amount.remaining);
	return null;
};

/** ok / warning / exhausted / unknown from the fraction. `UsageAmount.status()`. */
export const statusOf = (amount: UsageAmount): EffectiveStatus => {
	const fraction = fractionOf(amount);
	if (fraction === null) return "unknown";
	if (fraction >= 1) return "exhausted";
	if (fraction >= WARNING_FRACTION) return "warning";
	return "ok";
};

/**
 * The status a row renders with: the vendor's own word when it published one,
 * otherwise the derived one. `UsageLimit.effective_status()`, which is exactly
 * `self.status or self.amount.status()`.
 *
 * The word is returned VERBATIM, including one this view has no colour for.
 * An earlier version normalised anything outside the four known words back to
 * the DERIVED status, which is not "fall back to unknown" but "pretend the
 * vendor said nothing": a vendor reporting `throttled` at 10% of its cap
 * rendered as a healthy green `within limit` row and was counted as healthy in
 * the tally. The colour problem is real and is solved where colour is chosen
 * (`statusTone` paints any unrecognised word on the `dim` ramp, as
 * `_status_color()` does), not by discarding the vendor's answer here.
 *
 * An empty string is not a stated status: Python's `or` treats `""` as absent
 * and derives, so the falsy check has to match rather than merely testing for
 * `null`.
 */
export const effectiveStatus = (limit: UsageLimit): ReportedStatus =>
	limit.status ? limit.status : statusOf(limit.amount);

/** Milliseconds until the window rolls over, or null when unknown or past. */
export const resetsInMs = (limit: UsageLimit, nowMs: number): number | null => {
	if (limit.resets_at_ms === null) return null;
	const remaining = limit.resets_at_ms - nowMs;
	return remaining > 0 ? Math.trunc(remaining) : null;
};

/** Trailing zeros (and a bare point) in a mantissa, which `%g` does not print. */
const MANTISSA_ZEROS = /\.?0+$/;

/**
 * The exact value of a finite double, as sign plus a rational `mantissa/2^n`.
 *
 * Every formatter below rounds THIS rather than a decimal string or a scaled
 * float, and that is the whole design of this section. A double is an exact
 * binary rational; the question "is the discarded tail more than half" has one
 * right answer, and Python's format spec answers it from that exact value. Any
 * mechanism that first turns the number into a shorter decimal has already
 * thrown the tail away and can only guess.
 *
 * Two mechanisms were tried and rejected here, both of which LOOK correct:
 *
 *   - `toFixed(20)` plus `BigInt`, which this replaces. `toFixed` returns
 *     EXPONENTIAL notation at `|v| >= 1e21`, so `BigInt` was handed `1e+2100`
 *     and threw a `SyntaxError` mid-render, inside `providerBlocks`, with no
 *     error boundary between it and the dialog — the whole view unmounted. It
 *     was also silently wrong well below that threshold, because `toFixed(20)`
 *     caps at 20 fractional digits and 100 integer digits: a sweep found 2,334
 *     values where it printed a number off by 21 orders of magnitude.
 *   - `Intl.NumberFormat` with `roundingMode: "halfEven"`, the obvious
 *     candidate. It rounds the SHORTEST DECIMAL that round-trips to the double,
 *     not the double, so it disagrees with Python on ordinary money: `0.005`
 *     prints `0.00` where Python prints `0.01`, because the stored value is
 *     just above the half. Measured at 1,525 divergences over 6,039 amounts.
 *
 * The current mechanism was checked against the real `format_amount` over
 * 44,995 hostile values — every `%g` exponent boundary from 1e-320 to 1e308
 * both sides, every exact half at 0 and 2 places, denormals, and random
 * doubles drawn from raw bit patterns — with ZERO divergences, and it cannot
 * throw for any finite input.
 */
const FLOAT_BITS = new DataView(new ArrayBuffer(8));

type ExactFloat = { negative: boolean; mantissa: bigint; exponent: number };

const decompose = (value: number): ExactFloat => {
	FLOAT_BITS.setFloat64(0, value);
	const high = FLOAT_BITS.getUint32(0);
	const low = FLOAT_BITS.getUint32(4);
	const rawExponent = (high >>> 20) & 0x7ff;
	let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
	let exponent: number;
	if (rawExponent === 0) {
		// Subnormal: no implicit leading bit, and the exponent is pinned.
		exponent = -1074;
	} else {
		mantissa |= 1n << 52n;
		exponent = rawExponent - 1075;
	}
	return { negative: high >>> 31 === 1, mantissa, exponent };
};

/**
 * The value scaled by `10^places` and rounded half to even, exactly.
 *
 * Half-even is what `f"{v:.2f}"` and `f"{v:g}"` do and what `toFixed` and
 * `Math.round` do NOT: they round half away from zero, so the two languages
 * disagree on every exactly-representable half — Python prints `0.125` as
 * `0.12` and `12.5` as `12`, naive JS as `0.13` and `13`. That produced 125
 * rows where this view and the TUI quoted different numbers for one report.
 *
 * `places` may be negative, which is how `%g` rounds to a significant digit
 * left of the point.
 */
const scaledHalfEven = (
	value: number,
	places: number,
): { negative: boolean; digits: bigint } => {
	const { negative, mantissa, exponent } = decompose(value);
	let numerator = mantissa;
	let denominator = 1n;
	if (exponent >= 0) numerator <<= BigInt(exponent);
	else denominator <<= BigInt(-exponent);
	if (places >= 0) numerator *= 10n ** BigInt(places);
	else denominator *= 10n ** BigInt(-places);
	let digits = numerator / denominator;
	const remainder = numerator - digits * denominator;
	const twiceRemainder = remainder * 2n;
	// Past half always rounds up; exactly half goes to the even neighbour.
	if (
		twiceRemainder > denominator ||
		(twiceRemainder === denominator && digits % 2n === 1n)
	)
		digits += 1n;
	return { negative, digits };
};

/** Insert the decimal point into a digit string holding `places` decimals. */
const withPoint = (digits: string, places: number): string => {
	if (!places) return digits;
	const padded = digits.padStart(places + 1, "0");
	return `${padded.slice(0, padded.length - places)}.${padded.slice(padded.length - places)}`;
};

/**
 * Fixed-point formatting that rounds half to EVEN, as Python's format spec does.
 *
 * Python keeps the sign of a negative value that rounds to zero (`-0.49999`
 * at zero places is `-0`), so the sign is not suppressed on a zero result.
 */
const toFixedHalfEven = (value: number, places: number): string => {
	if (!Number.isFinite(value)) return String(value);
	const { negative, digits } = scaledHalfEven(value, places);
	const point = withPoint(digits.toString(), places);
	return negative ? `-${point}` : point;
};

/** `%g`'s significant-digit precision, and the exponent at which it flips form. */
const GENERAL_PRECISION = 6;

/**
 * `%g`: six significant digits, fixed or exponential.
 *
 * The ordering here is the fix for a real divergence. `%g` ROUNDS FIRST and
 * then decides which form to print, and an earlier version decided first from
 * `Math.log10` of the unrounded value: `999999.5 tokens` printed as
 * `1000000 tokens` where Python prints `1e+06 tokens`, because rounding to six
 * significant digits carries the value up across the `1e6` boundary that
 * selects exponential form. `tokens` and `requests` are real units and a
 * high-six-figure token count is ordinary, so that was a row where the desktop
 * view and the TUI quoted different strings for the same report.
 *
 * So the exponent is re-derived FROM THE ROUNDED DIGITS: round at the
 * estimated exponent, and if the carry made the digit string longer than the
 * precision, step the exponent and round again.
 */
const generalFormat = (value: number): string => {
	if (!Number.isFinite(value)) return String(value);
	if (value === 0) return Object.is(value, -0) ? "-0" : "0";
	let exponent = Math.floor(Math.log10(Math.abs(value)));
	let rounded = scaledHalfEven(value, GENERAL_PRECISION - 1 - exponent);
	/*
	 * `Math.log10` is itself approximate at the boundaries and the rounding can
	 * carry, so the estimate is corrected against the digit count it actually
	 * produced rather than trusted. Two corrections suffice — one for a wrong
	 * initial estimate, one for a carry the correction itself introduces — and
	 * the loop is bounded so a pathological value cannot spin.
	 */
	for (let attempt = 0; attempt < 2; attempt++) {
		const length = rounded.digits.toString().length;
		if (length === GENERAL_PRECISION) break;
		exponent += length - GENERAL_PRECISION;
		rounded = scaledHalfEven(value, GENERAL_PRECISION - 1 - exponent);
	}
	const sign = rounded.negative ? "-" : "";
	const raw = rounded.digits.toString();
	// `%g` switches to exponential outside [-4, precision).
	if (exponent < -4 || exponent >= GENERAL_PRECISION) {
		const mantissa = `${raw.slice(0, 1)}.${raw.slice(1)}`.replace(
			MANTISSA_ZEROS,
			"",
		);
		const expSign = exponent < 0 ? "-" : "+";
		// `%g` pads the exponent's digits to two.
		const expDigits = String(Math.abs(exponent)).padStart(2, "0");
		return `${sign}${mantissa}e${expSign}${expDigits}`;
	}
	const places = GENERAL_PRECISION - 1 - exponent;
	// `%g` does not print trailing zeros in the fraction.
	const point = places
		? withPoint(raw, places).replace(MANTISSA_ZEROS, "")
		: raw;
	return `${sign}${point}`;
};

const withUnit = (value: number, unit: UsageUnit): string => {
	const label = UNIT_LABELS[unit] ?? unit;
	const text =
		unit === "usd"
			? toFixedHalfEven(value, 2)
			: unit === "percent"
				? // Percent rows are integers: the endpoints quote `2.0` and `100.0`,
					// and a trailing `.0` on every row costs width to say nothing.
					toFixedHalfEven(value, 0)
				: generalFormat(value);
	if (!label) return text;
	// "%" is a suffix; every other label is a separate word.
	return label === "%" ? `${text}${label}` : `${text} ${label}`;
};

/**
 * The number for one row, or `""` when the amount carries none.
 * `format_amount()`.
 *
 * `used` first, then `remaining`, then `limit`, then an explicit fraction. A
 * remaining-only balance — what both account-balance fetchers report, since
 * neither vendor gives a limit to derive spend from — must still print its
 * number, or a row labelled "Balance" never says how much.
 */
export const formatAmount = (amount: UsageAmount): string => {
	const unit = amount.unit ?? "unknown";
	if (amount.used !== null) {
		// A used/limit pair in real units says more than the used half alone:
		// "$12.00" is meaningless without the cap it is drawn against, while a
		// percentage already carries its own denominator.
		if (unit !== "percent" && amount.limit)
			return `${withUnit(amount.used, unit)} / ${withUnit(amount.limit, unit)}`;
		return withUnit(amount.used, unit);
	}
	if (amount.remaining !== null)
		return `${withUnit(amount.remaining, unit)} left`;
	if (amount.limit !== null) return `${withUnit(amount.limit, unit)} limit`;
	if (amount.used_fraction !== null)
		return `${toFixedHalfEven(amount.used_fraction * 100, 0)}% used`;
	return "";
};

/** What a row shows when the vendor reported no number at all. */
export const NOT_REPORTED = "not reported";

/** `format_amount` with the TUI's own fallback applied. */
export const amountText = (amount: UsageAmount): string =>
	formatAmount(amount) || NOT_REPORTED;

/**
 * `3h24m` / `2d11h` / `45m` — time until a window rolls over.
 * `format_countdown()`.
 *
 * Two units at most, largest first, the smaller dropped when zero. A countdown
 * is read at a glance to answer "wait, or switch model", and `3d11h47m`
 * answers that no better than `3d11h` while costing width.
 */
export const formatCountdown = (ms: number | null): string => {
	if (ms === null || ms <= 0) return "";
	const minutes = Math.trunc(ms / 60_000);
	if (minutes < 60) return `${Math.max(1, minutes)}m`;
	const hours = Math.trunc(minutes / 60);
	const remMinutes = minutes % 60;
	if (hours < 24) return remMinutes ? `${hours}h${remMinutes}m` : `${hours}h`;
	const days = Math.trunc(hours / 24);
	const remHours = hours % 24;
	return remHours ? `${days}d${remHours}h` : `${days}d`;
};

/**
 * `just now` / `3m ago` / `2h ago` / `4d ago` — how stale the numbers are.
 * `format_age()`.
 *
 * Sub-minute is `just now` because the exact second a report landed is never
 * the question; whether it predates the work being done is.
 */
export const formatAge = (ms: number): string => {
	const seconds = Math.max(0, ms / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.trunc(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.trunc(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.trunc(hours / 24)}d ago`;
};

/**
 * The window closest to stopping this account, or null. `binding_limit()`.
 *
 * ACCOUNT-WIDE windows win over per-model ones regardless of fill: a model
 * family capped at 100% stops that family, while a shared window at 80% is the
 * one throttling every request, and calling the tier row "binding" would tell
 * a user to stop working when they only needed to change model. Ordering is
 * the Python's tuple compare `(shared, fraction)`.
 */
export const bindingLimit = (report: UsageReport): UsageLimit | null => {
	let best: UsageLimit | null = null;
	let bestKey: [number, number] | null = null;
	for (const limit of report.limits) {
		const fraction = fractionOf(limit.amount);
		if (fraction === null) continue;
		const key: [number, number] = [limit.shared ? 1 : 0, fraction];
		if (
			bestKey === null ||
			key[0] > bestKey[0] ||
			(key[0] === bestKey[0] && key[1] > bestKey[1])
		) {
			best = limit;
			bestKey = key;
		}
	}
	return best;
};

/**
 * The tally the toolbar reports. `UsageStats`.
 *
 * Counted over WINDOWS rather than providers because a window is what runs
 * out: one provider with an exhausted weekly cap and three healthy ones is a
 * different situation from four providers each at 90%, and a provider count
 * cannot tell them apart.
 *
 * Two counts here are FINER-GRAINED than `collect_stats()`, which buckets
 * everything by `effective_status` alone. Both splits exist because this
 * tally sits in the toolbar and is read BEFORE the table, where the TUI's sits
 * in the footer and is read after it. A summary read first has to survive
 * being the only thing a user reads:
 *
 *   - `tierExhausted` separates per-model caps from account-wide windows.
 *     Rule 8 subordinates a tier row everywhere else in this view precisely so
 *     "a 100% family cap never reads as a dead account" — and then a flat
 *     `7 exhausted`, of which six were Opus caps, undid that work in the one
 *     line read first. No window is dropped from the count; the caps are named
 *     as caps.
 *   - `withoutLimit` separates a window that printed a number but has no
 *     denominator to grade it against (a remaining-only balance, which is what
 *     both balance fetchers report) from one that reported nothing at all.
 *     Both are `unknown` to `effective_status`, but `1 not reported` sitting
 *     beside a row plainly reading `519.86 USD left` is a claim the frame
 *     itself contradicts.
 *
 * The totals still reconcile: `windows` counts every window, and every window
 * falls in at most one term.
 */
export type UsageStats = {
	windows: number;
	/** Account-wide windows at or over their cap: the account is blocked. */
	exhausted: number;
	/** Per-model caps at or over their cap: one model family is blocked. */
	tierExhausted: number;
	/** Near the cap. Not split by tier: it does not claim the account is dead. */
	warning: number;
	/** Reported a number, but no denominator to measure it against. */
	withoutLimit: number;
	/** Reported no number at all. */
	unreported: number;
};

/** Tally every window across every report by its effective status. `collect_stats()`. */
export const collectStats = (reports: UsageReport[]): UsageStats => {
	const stats: UsageStats = {
		windows: 0,
		exhausted: 0,
		tierExhausted: 0,
		warning: 0,
		withoutLimit: 0,
		unreported: 0,
	};
	for (const report of reports) {
		for (const limit of report.limits) {
			stats.windows += 1;
			const status = effectiveStatus(limit);
			if (status === "exhausted") {
				if (limit.tier) stats.tierExhausted += 1;
				else stats.exhausted += 1;
			} else if (status === "warning") stats.warning += 1;
			else if (status === "unknown") {
				// The row prints SOMETHING whenever the amount carries a number, so
				// the same test the row uses decides which word the tally uses.
				if (formatAmount(limit.amount)) stats.withoutLimit += 1;
				else stats.unreported += 1;
			}
			// A status word this view does not know is counted as a window and
			// nothing else, exactly as `collect_stats`'s own elif chain does.
		}
	}
	return stats;
};

/**
 * One term of the tally, split at the boundary between machine voice and prose.
 *
 * `docs/branding.md` § 4 permits monospace for machine voice only — "Monospace
 * for emphasis, or for prose, is forbidden" — and the tally is a ~50-character
 * sentence of which 8 characters are numerals. Setting the whole string in mono
 * is what made the toolbar read as console output beside the proportional
 * button next to it, which § 0 names as the failure mode. So the COUNT carries
 * mono and `tabular-nums` (it is the part that has to hold a column and the
 * part that is machine voice), and the words it qualifies are set in the
 * normal ramp.
 */
export type StatsTerm = { count: number; label: string };

/** `6 windows · 1 exhausted · 1 near limit` — worst state first. `UsageStats.describe()`. */
export const statsTerms = (stats: UsageStats): StatsTerm[] => {
	if (!stats.windows) return [];
	const terms: StatsTerm[] = [
		{ count: stats.windows, label: `window${stats.windows === 1 ? "" : "s"}` },
	];
	if (stats.exhausted)
		terms.push({ count: stats.exhausted, label: "exhausted" });
	if (stats.tierExhausted)
		terms.push({
			count: stats.tierExhausted,
			label: `model cap${stats.tierExhausted === 1 ? "" : "s"} exhausted`,
		});
	if (stats.warning) terms.push({ count: stats.warning, label: "near limit" });
	if (stats.withoutLimit)
		terms.push({ count: stats.withoutLimit, label: "without a limit" });
	if (stats.unreported)
		terms.push({ count: stats.unreported, label: "not reported" });
	return terms;
};

/** The tally as one string. The rendered form is `statsTerms`; this is the rule. */
export const describeStats = (stats: UsageStats): string =>
	statsTerms(stats)
		.map((term) => `${term.count} ${term.label}`)
		.join(" · ");

/**
 * The stamp every block is aged AGAINST: the newest confirmed `fetched_at` in
 * the set. `OperatorApp._usage_data_fetched_ms()`.
 *
 * This is the baseline, not merely the formula, and porting the formula
 * without it inverted what `STALE_BEHIND_MS` was calibrated for. The response's
 * own `fetched_at` is the SERVER CLOCK at response time
 * (`desktop_catalogues.py` sets it to `int(time.time() * 1000)`), which is
 * independent of how old the data in it is — so measuring against it turned
 * "this block is behind its freshest sibling" into "this block is more than
 * 6.25 minutes old in absolute terms". Against a 5-minute cache TTL whose
 * warmer only refreshes the ACTIVE provider, that marks routinely-healthy
 * reports: two siblings confirmed together twenty minutes ago were both
 * degraded and both labelled `Last known 20m ago`, where the TUI marks
 * neither. The flagship `real-data` frame showed all eleven blocks degraded,
 * which is the mark distinguishing nothing — exactly the failure
 * `_stale_behind_ms`'s docstring exists to prevent.
 *
 * The MAX rather than the min, deliberately: the age answers "when were these
 * numbers last confirmed?", a property of the SET. Taking the min let one
 * stuck account pin the whole header at `2h ago` over rows that were two
 * minutes old.
 *
 * Falls back to `nowMs` for an empty set, where there is no confirmation to
 * measure from and nothing to mark either way.
 */
export const newestConfirmedMs = (
	reports: UsageReport[],
	nowMs: number,
): number => {
	let newest: number | null = null;
	for (const report of reports) {
		const fetchedAt = report.fetched_at || 0;
		if (fetchedAt && (newest === null || fetchedAt > newest))
			newest = fetchedAt;
	}
	return newest ?? nowMs;
};

/**
 * Whether this report is materially older than the stamp the title shows.
 * The `behind_header` branch of `_account_status_note()`.
 *
 * `headerMs` must be `newestConfirmedMs(...)` — the set's newest confirmation —
 * and not the response stamp. See that function for what the difference costs.
 */
export const isStale = (report: UsageReport, headerMs: number): boolean =>
	Boolean(report.fetched_at) && headerMs - report.fetched_at >= STALE_BEHIND_MS;

/**
 * The per-account note, or `""` when the block is live. `_account_status_note()`.
 *
 * Load-bearing rather than decorative: the age in the view's description
 * speaks for the SET, so this is what stops a block the description does not
 * describe from being read at the description's age. The trigger is therefore
 * "the title does not describe this row", NOT "this row has a failure streak".
 *
 * A dead grant outranks the rest: it is the only one of these states with a
 * remedy the user can act on, so it names the command instead of an age. An
 * exhausted 100% weekly window is quota, not this path.
 *
 * The branch is selected from `report.state`, which `SPEC.md` declares derived
 * server-side and AUTHORITATIVE, and whose "do not re-derive it from counters"
 * this function used to violate by reading `credential_invalid` and
 * `usage_unavailable` directly. Reading the field is not a formality: the
 * route folds "no limits at all" into `unavailable` even when
 * `usage_unavailable` is false, which is the xai unified-billing shape that
 * otherwise rendered as a heading with silence under it.
 */
export const accountNote = (
	report: UsageReport,
	nowMs: number,
	headerMs: number,
): string => {
	const fetchedAt = report.fetched_at || 0;
	const age =
		fetchedAt && report.limits.length
			? formatAge(Math.max(0, nowMs - fetchedAt))
			: "";
	if (report.state === "reauth_required") {
		// The provider is named because the view lists several accounts and the
		// note sits under one block; `/login kimi` is runnable as printed, which
		// "sign in again" would not be. `sign-in expired` deliberately does not
		// reuse the "needs login" vocabulary: the user HAS logged in, and what
		// they need to know is that it stopped working.
		const note = `Sign-in expired — run /login ${report.provider}`;
		// The second clause is a provenance caveat, not a peer of the remedy, and
		// its siblings teach `last known` — a bare `· numbers 2d ago` is
		// telegraphic in a way no other copy in this view is.
		return age ? `${note}. Last known ${age}.` : `${note}.`;
	}
	if (report.state === "unavailable") {
		// The age rides along only when it would misdate the numbers. A
		// sub-minute report renders `just now` — exactly what the description
		// already says — so appending it produced a self-contradictory
		// "usage unavailable — last known just now".
		return age && age !== "just now"
			? `Usage unavailable — last known ${age}`
			: "Usage unavailable";
	}
	if (isStale(report, headerMs)) {
		// `headerMs - fetched_at >= STALE_BEHIND_MS` by construction, so the age
		// can never be `just now` here.
		return age ? `Last known ${age}` : "Last known";
	}
	// A probe miss after a fresh confirmation misdates nothing, so a bare
	// `consecutive_failures > 0` is deliberately NOT a trigger (SPEC rule 10).
	return "";
};

/** The binding window as the block's heading states it, or null. `_provider_header()`. */
export type BindingSummary = {
	limit: UsageLimit;
	status: ReportedStatus;
	/** `7-day` — the window's own name. Prose: it is the vendor's words. */
	label: string;
	/** `82%` — machine voice, and the part that holds the heading's column. */
	percent: string;
	/** `Sonnet 4.5 82%` — the two joined, for a caller that needs one string. */
	text: string;
	/** `3h24m`, or `""` when the reset is unknown or past. */
	countdown: string;
};

export const bindingSummary = (
	report: UsageReport,
	nowMs: number,
): BindingSummary | null => {
	const limit = bindingLimit(report);
	if (!limit) return null;
	const fraction = fractionOf(limit.amount) ?? 0;
	const percent = `${toFixedHalfEven(fraction * 100, 0)}%`;
	return {
		limit,
		status: effectiveStatus(limit),
		label: limit.label,
		percent,
		text: `${limit.label} ${percent}`,
		countdown: formatCountdown(resetsInMs(limit, nowMs)),
	};
};

/** Everything one window's row renders, derived once so the view stays declarative. */
export type LimitRow = {
	limit: UsageLimit;
	status: ReportedStatus;
	/** 0..1 clamped, or null when unmeasurable — a null bar draws NO fill. */
	fraction: number | null;
	amount: string;
	countdown: string;
	/** A per-model cap is subordinate to the shared rows (SPEC rule 8). */
	subordinate: boolean;
};

export const limitRow = (limit: UsageLimit, nowMs: number): LimitRow => {
	const fraction = fractionOf(limit.amount);
	return {
		limit,
		status: effectiveStatus(limit),
		fraction: fraction === null ? null : Math.max(0, Math.min(1, fraction)),
		amount: amountText(limit.amount),
		countdown: formatCountdown(resetsInMs(limit, nowMs)),
		subordinate: limit.tier !== "",
	};
};

/** What a block says instead of rows when the vendor answered with no windows. */
export const NO_WINDOWS = "No windows reported.";

/** One provider block, fully derived. The view renders this and nothing else. */
export type ProviderBlock = {
	report: UsageReport;
	binding: BindingSummary | null;
	note: string;
	rows: LimitRow[];
	/** Last-known numbers are on screen: the dots stop claiming freshness. */
	degraded: boolean;
	/**
	 * Copy for a report that carried no windows at all, or `""`.
	 *
	 * A block holding only its heading reads as a rendering defect, which is why
	 * the TUI prints `no windows reported` for the same case
	 * (`build_usage_body`). Reachable with `usage_unavailable` FALSE via xai's
	 * unified-billing shape, so the note above cannot cover it — the route folds
	 * that shape into `state: "unavailable"`, which is why `state` is what both
	 * this and `accountNote` read.
	 */
	emptyNote: string;
};

/**
 * Derive every block for one payload.
 *
 * `headerMs` is the stamp blocks are aged against — `newestConfirmedMs(...)`,
 * the newest confirmation in the SET, never the response's own stamp — and
 * `nowMs` is the clock the countdowns are measured against. Both are
 * parameters rather than `Date.now()` reads so a story and a test can pin
 * them: a countdown that moves between two frames is not evidence.
 */
export const providerBlocks = (
	reports: UsageReport[],
	nowMs: number,
	headerMs: number,
): ProviderBlock[] =>
	reports.map((report) => ({
		report,
		binding: bindingSummary(report, nowMs),
		note: accountNote(report, nowMs, headerMs),
		rows: report.limits.map((limit) => limitRow(limit, nowMs)),
		// A healthy-green dot on a two-hour-old meter is the block's
		// highest-contrast element saying "fine" while the note says otherwise.
		// `state` is the authoritative field (SPEC "Data contract"); `available`
		// and `partial` both mean the numbers are the vendor's current answer,
		// and a failure streak alone is not staleness (SPEC rule 10).
		degraded:
			report.state === "reauth_required" ||
			report.state === "unavailable" ||
			isStale(report, headerMs),
		emptyNote: report.limits.length ? "" : NO_WINDOWS,
	}));

/**
 * `Cached report, 3m ago.` — the view's description line.
 *
 * `confirmedAtMs` is the newest CONFIRMATION in the set, not the response's
 * own `fetched_at`. Ageing the response against itself made this line
 * structurally `Cached report, just now.` whatever the numbers' vintage,
 * because the route stamps a cached response with the server clock at response
 * time — the committed `real-data` frame read `just now` above blocks the
 * same frame dated `1h ago`. This is the dialog's most-read line, so it states
 * when the numbers were last confirmed, which is the same question the blocks'
 * own notes answer.
 */
export const describeSource = (
	source: string,
	confirmedAtMs: number,
	nowMs: number,
): string =>
	`${source === "live" ? "Live" : "Cached"} report, ${formatAge(Math.max(0, nowMs - confirmedAtMs))}.`;
