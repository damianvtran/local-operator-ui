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

export type EffectiveStatus = "ok" | "warning" | "exhausted" | "unknown";

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
 * otherwise the derived one. `UsageLimit.effective_status()`.
 *
 * A vendor string outside the four known words is passed through as-is by the
 * Python (`self.status or self.amount.status()`), so it is normalised here to
 * `unknown` rather than tinting a row by a word the view has no colour for.
 */
export const effectiveStatus = (limit: UsageLimit): EffectiveStatus => {
	const stated = limit.status;
	if (stated === "ok" || stated === "warning" || stated === "exhausted")
		return stated;
	if (stated === "unknown") return "unknown";
	return statusOf(limit.amount);
};

/** Milliseconds until the window rolls over, or null when unknown or past. */
export const resetsInMs = (limit: UsageLimit, nowMs: number): number | null => {
	if (limit.resets_at_ms === null) return null;
	const remaining = limit.resets_at_ms - nowMs;
	return remaining > 0 ? Math.trunc(remaining) : null;
};

/** Exponent sign in a JS exponential string; `%g` pads the digits to two. */
const EXPONENT_SIGN = /^[+-]/;
/** Trailing zeros (and a bare point) in a mantissa, which `%g` does not print. */
const MANTISSA_ZEROS = /\.?0+$/;
/** Trailing zeros in the discarded tail, which decide an exact-half case. */
const TRAILING_ZEROS = /0+$/;

/**
 * Fixed-point formatting that rounds half to EVEN, as Python's format spec does.
 *
 * This exists because `toFixed` and `Math.round` round half AWAY FROM ZERO
 * while `f"{v:.2f}"` and `f"{v:.0f}"` round half to even, so the two languages
 * disagree on every exactly-representable half: Python prints `0.125` as
 * `0.12` and `12.5` as `12`, JS as `0.13` and `13`. Checked differentially
 * against the real `format_amount` over 3,325 amounts, that was the ONLY
 * divergence in the port, and it produced 125 rows where this view and the TUI
 * would quote different numbers for the same report — the exact class of
 * defect a port is supposed to rule out.
 *
 * It rounds the value's own decimal expansion rather than a scaled float:
 * multiplying by 100 to inspect the remainder reintroduces the binary error
 * this is trying to read. `toFixed(20)` is that expansion, and the tail after
 * the kept digits decides the direction — anything past a bare `5` is more
 * than half and rounds up, a bare `5` is the exact half and goes to even.
 */
const toFixedHalfEven = (value: number, places: number): string => {
	if (!Number.isFinite(value)) return String(value);
	const negative = value < 0;
	const [whole, fraction = ""] = Math.abs(value).toFixed(20).split(".");
	const kept = fraction.slice(0, places).padEnd(places, "0");
	const tail = fraction.slice(places).replace(TRAILING_ZEROS, "");
	let digits = BigInt(`${whole}${kept}`);
	if (tail) {
		// A bare `5` is the exact half and goes to the even neighbour; anything
		// after it makes the tail more than half, which always rounds up.
		const up = tail === "5" ? digits % 2n === 1n : tail[0] >= "5";
		if (up) digits += 1n;
	}
	const text = digits.toString().padStart(places + 1, "0");
	const point = places
		? `${text.slice(0, text.length - places)}.${text.slice(text.length - places)}`
		: text;
	return negative && digits !== 0n ? `-${point}` : point;
};

/** `%g`: the shortest representation, which is what Python's `:g` produces. */
const generalFormat = (value: number): string => {
	if (value === 0) return "0";
	const exponent = Math.floor(Math.log10(Math.abs(value)));
	// `%g` switches to exponential outside [-4, precision); precision is 6.
	if (exponent < -4 || exponent >= 6) {
		const text = value.toExponential(5);
		const [mantissa, exp] = text.split("e");
		const sign = exp.startsWith("-") ? "-" : "+";
		const digits = exp.replace(EXPONENT_SIGN, "").padStart(2, "0");
		return `${mantissa.replace(MANTISSA_ZEROS, "")}e${sign}${digits}`;
	}
	return String(Number(value.toPrecision(6)));
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
 */
export type UsageStats = {
	windows: number;
	exhausted: number;
	warning: number;
	unknown: number;
};

/** Tally every window across every report by its effective status. `collect_stats()`. */
export const collectStats = (reports: UsageReport[]): UsageStats => {
	const stats: UsageStats = {
		windows: 0,
		exhausted: 0,
		warning: 0,
		unknown: 0,
	};
	for (const report of reports) {
		for (const limit of report.limits) {
			stats.windows += 1;
			const status = effectiveStatus(limit);
			if (status === "exhausted") stats.exhausted += 1;
			else if (status === "warning") stats.warning += 1;
			else if (status === "unknown") stats.unknown += 1;
		}
	}
	return stats;
};

/** `6 windows · 1 exhausted · 1 near limit` — worst state first. `UsageStats.describe()`. */
export const describeStats = (stats: UsageStats): string => {
	if (!stats.windows) return "";
	const parts = [`${stats.windows} window${stats.windows === 1 ? "" : "s"}`];
	if (stats.exhausted) parts.push(`${stats.exhausted} exhausted`);
	if (stats.warning) parts.push(`${stats.warning} near limit`);
	if (stats.unknown) parts.push(`${stats.unknown} not reported`);
	return parts.join(" · ");
};

/**
 * Whether this report is materially older than the stamp the title shows.
 * The `behind_header` branch of `_account_status_note()`.
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
	if (report.credential_invalid) {
		// The provider is named because the view lists several accounts and the
		// note sits under one block; `/login kimi` is runnable as printed, which
		// "sign in again" would not be. `sign-in expired` deliberately does not
		// reuse the "needs login" vocabulary: the user HAS logged in, and what
		// they need to know is that it stopped working.
		const note = `Sign-in expired — run /login ${report.provider}`;
		return age ? `${note} · numbers ${age}` : note;
	}
	if (report.usage_unavailable) {
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
	status: EffectiveStatus;
	/** `Sonnet 4.5 82%` — the label and its integer percentage. */
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
	return {
		limit,
		status: effectiveStatus(limit),
		text: `${limit.label} ${toFixedHalfEven(fraction * 100, 0)}%`,
		countdown: formatCountdown(resetsInMs(limit, nowMs)),
	};
};

/** Everything one window's row renders, derived once so the view stays declarative. */
export type LimitRow = {
	limit: UsageLimit;
	status: EffectiveStatus;
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

/** One provider block, fully derived. The view renders this and nothing else. */
export type ProviderBlock = {
	report: UsageReport;
	binding: BindingSummary | null;
	note: string;
	rows: LimitRow[];
	/** Last-known numbers are on screen: the dots stop claiming freshness. */
	degraded: boolean;
};

/**
 * Derive every block for one payload.
 *
 * `headerMs` is the stamp the view's description shows (the response's
 * `fetched_at`), and `nowMs` is the clock the countdowns are measured against.
 * Both are parameters rather than `Date.now()` reads so a story and a test can
 * pin them — a countdown that moves between two frames is not evidence.
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
		degraded:
			report.credential_invalid ||
			report.usage_unavailable ||
			isStale(report, headerMs),
	}));

/** `cached report, 3m ago` — the view's description line. */
export const describeSource = (
	source: string,
	fetchedAtMs: number,
	nowMs: number,
): string =>
	`${source === "live" ? "Live" : "Cached"} report, ${formatAge(Math.max(0, nowMs - fetchedAtMs))}.`;
