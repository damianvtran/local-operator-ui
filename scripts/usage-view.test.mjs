import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The `/usage` view's arithmetic, asserted against the TUI semantics it ports.
 *
 * `usage-view-model.ts` is a port of `local_operator/tui/widgets/usage_panel.py`
 * and `local_operator/providers/usage.py`. A port whose only check is "the
 * story looks right" drifts from its source the first time either side is
 * edited — and the rules here all HAVE a right answer, decided in Python:
 * which fraction wins, where a window turns from ok to near-limit, how a
 * balance with no cap prints, which window is the binding one, what the tally
 * says. Each test below names the Python function it mirrors, so a reviewer
 * can read the two side by side.
 *
 * Bundled rather than imported because the module is TypeScript in the
 * renderer tree; esbuild into a data: URL is the pattern `tool-row.test.mjs`
 * established for exactly this.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/pickers/usage-view-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	STALE_BEHIND_MS,
	WARNING_FRACTION,
	accountNote,
	amountText,
	bindingLimit,
	bindingSummary,
	collectStats,
	describeSource,
	describeStats,
	effectiveStatus,
	formatAge,
	formatAmount,
	formatCountdown,
	fractionOf,
	isStale,
	limitRow,
	newestConfirmedMs,
	providerBlocks,
	resetsInMs,
	statsTerms,
	statusOf,
	statusTone,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const NOW = 1_760_000_000_000;

/** An amount with every field explicit, the way the route actually sends it. */
const amount = (over = {}) => ({
	used: null,
	limit: null,
	remaining: null,
	used_fraction: null,
	unit: "percent",
	...over,
});

const limit = (over = {}) => ({
	id: "five_hour",
	label: "5-hour",
	amount: amount(),
	window: "five_hour",
	status: null,
	resets_at: null,
	resets_at_ms: null,
	tier: "",
	shared: true,
	...over,
});

/**
 * A report as the ROUTE sends it, including a `state` derived the way the route
 * derives it (`desktop_catalogues.py`).
 *
 * `state` is computed rather than defaulted to `"available"` because it is
 * authoritative and the view reads it: a fixture that pinned
 * `credential_invalid: true` beside `state: "available"` is a shape the backend
 * cannot produce, so a test written on it would assert about a contract that
 * does not exist. An explicit `state` in `over` still wins, which is how the
 * xai unified-billing case (no limits, `usage_unavailable` false) is expressed.
 */
const report = (over = {}) => {
	const base = {
		provider: "anthropic",
		fetched_at: NOW,
		limits: [],
		notes: null,
		identity: null,
		consecutive_failures: 0,
		usage_unavailable: false,
		next_probe_at_ms: null,
		credential_invalid: false,
		age_ms: 0,
		...over,
	};
	if (over.state) return base;
	return {
		...base,
		state: base.credential_invalid
			? "reauth_required"
			: base.usage_unavailable || base.limits.length === 0
				? "unavailable"
				: base.consecutive_failures
					? "partial"
					: "available",
	};
};

/* ---------------------------------------------------- fraction (SPEC rule 2) */

test("an explicit used_fraction beats anything derivable", () => {
	// `UsageAmount.fraction()` checks `used_fraction` FIRST. The vendor
	// endpoints quote utilization directly; a used/limit pair that disagrees
	// with it is the derived answer, and the vendor's is the stated one.
	assert.equal(
		fractionOf(amount({ used_fraction: 0.3, used: 90, limit: 100 })),
		0.3,
	);
});

test("used over limit, but only when the limit is a positive number", () => {
	assert.equal(fractionOf(amount({ used: 12, limit: 40, unit: "usd" })), 0.3);
	// A zero limit is not a denominator; the Python guards with `self.limit and > 0`.
	assert.equal(fractionOf(amount({ used: 12, limit: 0, unit: "usd" })), null);
});

test("used over used+remaining when there is no limit to divide by", () => {
	assert.equal(
		fractionOf(amount({ used: 25, remaining: 75, unit: "usd" })),
		0.25,
	);
	// Both halves zero: the sum is not positive, so there is nothing to state.
	assert.equal(fractionOf(amount({ used: 0, remaining: 0, unit: "usd" })), null);
});

test("a fraction is never guessed", () => {
	// Remaining alone (the balance fetchers' shape) has no denominator, so the
	// window is unmeasurable rather than zero — SPEC rule 4.
	assert.equal(fractionOf(amount({ remaining: 519.86, unit: "usd" })), null);
	assert.equal(fractionOf(amount({ limit: 100, unit: "usd" })), null);
	assert.equal(fractionOf(amount()), null);
});

/* ------------------------------------------- status thresholds (SPEC rule 1) */

test("the warning threshold is 0.85 and the exhausted threshold is 1.0", () => {
	assert.equal(WARNING_FRACTION, 0.85);
	assert.equal(statusOf(amount({ used_fraction: 0.8499 })), "ok");
	// Inclusive on the way up: `>= 0.85`.
	assert.equal(statusOf(amount({ used_fraction: 0.85 })), "warning");
	assert.equal(statusOf(amount({ used_fraction: 0.9999 })), "warning");
	assert.equal(statusOf(amount({ used_fraction: 1 })), "exhausted");
	// Over the cap is still exhausted, not a fifth state.
	assert.equal(statusOf(amount({ used_fraction: 1.4 })), "exhausted");
});

test("an unmeasurable amount is unknown, not ok", () => {
	assert.equal(statusOf(amount()), "unknown");
	assert.equal(statusOf(amount({ used_fraction: 0 })), "ok");
});

test("a vendor status wins over the derived one", () => {
	// `UsageLimit.effective_status()` is `self.status or self.amount.status()`.
	assert.equal(
		effectiveStatus(limit({ status: "exhausted", amount: amount({ used_fraction: 0.1 }) })),
		"exhausted",
	);
	assert.equal(
		effectiveStatus(limit({ status: null, amount: amount({ used_fraction: 0.9 }) })),
		"warning",
	);
});

test("a vendor status the view has no colour for survives as the vendor's word", () => {
	// Python is `self.status or self.amount.status()`: an unrecognised word
	// passes through VERBATIM. The port used to normalise anything outside the
	// four known words back to the DERIVED status, which is not "fall back to
	// unknown" but "pretend the vendor said nothing" — a vendor reporting
	// `throttled` at 10% of its cap rendered as a healthy green `ok` row and was
	// counted as healthy in the tally.
	const throttled = limit({
		status: "throttled",
		amount: amount({ used_fraction: 0.1 }),
	});
	assert.equal(effectiveStatus(throttled), "throttled");
	// The colour problem is real, and is solved where colour is chosen: any word
	// the view has no semantic for paints on the dim ramp, exactly as
	// `_status_color()`'s `.get(status, dim)` does.
	assert.equal(statusTone("throttled"), "dim");
	assert.equal(statusTone("ok"), "ok");
	assert.equal(statusTone("unknown"), "dim");
	// And it is NOT counted as a healthy window, which is what the green row did.
	const stats = collectStats([report({ limits: [throttled] })]);
	assert.equal(stats.windows, 1);
	assert.equal(stats.exhausted, 0);
	assert.equal(stats.warning, 0);
	assert.equal(stats.unreported, 0);
	// An empty string is not a stated status: Python's `or` treats it as absent.
	assert.equal(
		effectiveStatus(limit({ status: "", amount: amount({ used_fraction: 0.9 }) })),
		"warning",
	);
	assert.equal(effectiveStatus(limit({ status: "unknown" })), "unknown");
});

/* ------------------------------------------------ amount text (SPEC rule 3) */

test("a percent prints as an integer with a suffix and no denominator", () => {
	// The endpoints quote `2.0` and `100.0`; a trailing `.0` on every row costs
	// width to say nothing. A percentage already carries its own denominator,
	// so the limit is NOT repeated even when one is present.
	assert.equal(formatAmount(amount({ used: 2, unit: "percent" })), "2%");
	assert.equal(
		formatAmount(amount({ used: 82.4, limit: 100, unit: "percent" })),
		"82%",
	);
	assert.equal(formatAmount(amount({ used: 100, unit: "percent" })), "100%");
});

test("USD keeps its cents and prints both halves of a used/limit pair", () => {
	// "$12.00" is meaningless without the cap it is drawn against.
	assert.equal(
		formatAmount(amount({ used: 12, limit: 40, unit: "usd" })),
		"12.00 USD / 40.00 USD",
	);
	assert.equal(formatAmount(amount({ used: 3.5, unit: "usd" })), "3.50 USD");
});

test("a half rounds to even, the way Python's format spec does", () => {
	// `toFixed`/`Math.round` round half AWAY FROM ZERO; `f"{v:.2f}"` rounds half
	// to EVEN, so the two languages disagree on every exactly-representable
	// half — rows where this view and the TUI would quote different numbers for
	// the same report. Pinned here so it cannot come back the next time someone
	// "simplifies" the formatter.
	assert.equal(formatAmount(amount({ used: 0.125, unit: "usd" })), "0.12 USD");
	assert.equal(formatAmount(amount({ used: 0.135, unit: "usd" })), "0.14 USD");
	assert.equal(formatAmount(amount({ used: 12.5, unit: "percent" })), "12%");
	assert.equal(formatAmount(amount({ used: 13.5, unit: "percent" })), "14%");
	// Past the exact half there is no tie to break, so it rounds up as usual.
	assert.equal(formatAmount(amount({ used: 12.51, unit: "percent" })), "13%");
	assert.equal(
		formatAmount(amount({ used_fraction: 0.125, unit: "unknown" })),
		"12% used",
	);
});

test("the formatter rounds the double's own value, not a shortened decimal", () => {
	// The obvious mechanism for half-even in JS is `Intl.NumberFormat` with
	// `roundingMode: "halfEven"`, and it is WRONG here: it rounds the shortest
	// decimal that round-trips to the double rather than the double, so it
	// disagrees with Python on ordinary money. `0.005` is stored just ABOVE the
	// half, so Python's `.2f` carries it up; Intl sees the literal "0.005", calls
	// it an exact tie and rounds to even, printing `0.00`. Measured at 1,525
	// divergences over 6,039 amounts.
	assert.equal(formatAmount(amount({ used: 0.005, unit: "usd" })), "0.01 USD");
	// Stored just BELOW the half, so it rounds down even though `0.015` looks
	// like a tie that should go to even (0.02). Intl prints `0.02` here.
	assert.equal(formatAmount(amount({ used: 0.015, unit: "usd" })), "0.01 USD");
	assert.equal(formatAmount(amount({ used: 2.675, unit: "usd" })), "2.67 USD");
});

test("a large amount formats exactly instead of throwing or lying", () => {
	// `toFixed(20)` returns EXPONENTIAL notation at |v| >= 1e21, so the previous
	// `BigInt(\`${whole}${kept}\`)` was handed "1e+2100" and threw a SyntaxError
	// — inside `providerBlocks`, during render, with no error boundary between
	// it and the dialog, so the whole view unmounted rather than one row being
	// wrong. A fetcher's contract is that a number is a number; the Python this
	// ports never raises for a finite float.
	assert.doesNotThrow(() =>
		formatAmount(amount({ used: 1e21, unit: "usd" })),
	);
	assert.equal(
		formatAmount(amount({ used: 1e21, unit: "usd" })),
		"1000000000000000000000.00 USD",
	);
	// The worse half: below the throw threshold it did not fail, it returned a
	// silently wrong number — this one off by 21 orders of magnitude. Checked
	// against Python's `f"{v:.2f}"`, which prints the exact binary value.
	assert.equal(
		formatAmount(amount({ used: 8.557429317644532e21, unit: "usd" })),
		"8557429317644531531776.00 USD",
	);
	// `percent` reaches the same path through `used_fraction * 100`, so a
	// corrupt or hostile fraction must not crash the dialog either.
	assert.doesNotThrow(() =>
		formatAmount(amount({ used_fraction: 1e300, unit: "percent" })),
	);
	// And the whole float range stays finite and printable.
	for (const value of [1e300, -1e300, 5e-324, Number.MAX_VALUE]) {
		const text = formatAmount(amount({ used: value, unit: "usd" }));
		assert.ok(!text.includes("e"), `${value} -> ${text}`);
		assert.ok(!text.includes("NaN"), `${value} -> ${text}`);
	}
});

test("%g rounds first and only then chooses exponential form", () => {
	// Python's `%g` rounds to six significant digits BEFORE deciding fixed vs
	// exponential. Deciding first from `Math.log10` of the unrounded value put
	// the port on the wrong side of every boundary a value rounds UP across:
	// `999999.5` rounds to 1000000, whose exponent is 6, so `%g` switches to
	// exponential — the port printed `1000000 tokens` where the TUI prints
	// `1e+06 tokens`, for the same report. `tokens` and `requests` are real
	// units and a high-six-figure token count is ordinary.
	assert.equal(
		formatAmount(amount({ used: 999999.5, unit: "tokens" })),
		"1e+06 tokens",
	);
	// Just below the tie, it stays fixed — the boundary is real, not a blanket
	// switch, and half-even applies here too (999999.5 -> 1000000 is even).
	assert.equal(
		formatAmount(amount({ used: 999999.4, unit: "tokens" })),
		"999999 tokens",
	);
	assert.equal(
		formatAmount(amount({ used: -999999.6, unit: "tokens" })),
		"-1e+06 tokens",
	);
	// Both sides of the small-magnitude boundary, which is exclusive at -4.
	assert.equal(
		formatAmount(amount({ used: 0.0001, unit: "tokens" })),
		"0.0001 tokens",
	);
	assert.equal(
		formatAmount(amount({ used: 0.00001, unit: "tokens" })),
		"1e-05 tokens",
	);
	// Six significant digits, and the exponent's digits are padded to two.
	assert.equal(
		formatAmount(amount({ used: 1234567, unit: "tokens" })),
		"1.23457e+06 tokens",
	);
	assert.equal(
		formatAmount(amount({ used: 1e21, unit: "tokens" })),
		"1e+21 tokens",
	);
	// Realistic token counts still print plainly, which is what makes the
	// boundary cases above worth getting right rather than papering over.
	assert.equal(
		formatAmount(amount({ used: 2500000, limit: 10000000, unit: "tokens" })),
		"2.5e+06 tokens / 1e+07 tokens",
	);
});

test("other units use %g and their own label", () => {
	assert.equal(
		formatAmount(amount({ used: 1500, limit: 100000, unit: "tokens" })),
		"1500 tokens / 100000 tokens",
	);
	assert.equal(
		formatAmount(amount({ used: 12.5, unit: "requests" })),
		"12.5 req",
	);
	// `unknown` has no label (a CNY balance rides in the row's label instead),
	// so the number prints bare rather than wearing a unit it did not earn.
	assert.equal(formatAmount(amount({ remaining: 88.25, unit: "unknown" })), "88.25 left");
});

test("a remaining-only balance still prints its number", () => {
	// Both account-balance fetchers report this shape; without it a row
	// labelled "Balance" never says how much.
	assert.equal(
		formatAmount(amount({ remaining: 519.86, unit: "usd" })),
		"519.86 USD left",
	);
});

test("a limit with no spend prints the cap", () => {
	assert.equal(
		formatAmount(amount({ limit: 40, unit: "usd" })),
		"40.00 USD limit",
	);
});

test("an explicit fraction with no numbers prints a percentage of use", () => {
	assert.equal(
		formatAmount(amount({ used_fraction: 0.42, unit: "unknown" })),
		"42% used",
	);
});

test("an amount carrying nothing is empty, and the row says not reported", () => {
	assert.equal(formatAmount(amount()), "");
	assert.equal(amountText(amount()), "not reported");
	// A real number is never replaced by the fallback.
	assert.equal(amountText(amount({ used: 0, unit: "percent" })), "0%");
});

test("the used half wins over remaining and limit, in that order", () => {
	// `format_amount` order: used, then remaining, then limit, then fraction.
	assert.equal(
		formatAmount(amount({ used: 1, remaining: 9, limit: null, unit: "usd" })),
		"1.00 USD",
	);
	assert.equal(
		formatAmount(amount({ remaining: 9, limit: 10, unit: "usd" })),
		"9.00 USD left",
	);
});

/* --------------------------------------------------- countdown (SPEC rule 5) */

test("a countdown is two units at most, largest first", () => {
	assert.equal(formatCountdown(45 * 60_000), "45m");
	assert.equal(formatCountdown(3 * 3_600_000 + 24 * 60_000), "3h24m");
	assert.equal(formatCountdown(2 * 86_400_000 + 11 * 3_600_000), "2d11h");
	// `3d11h47m` answers "wait or switch model" no better than `3d11h`.
	assert.equal(
		formatCountdown(3 * 86_400_000 + 11 * 3_600_000 + 47 * 60_000),
		"3d11h",
	);
});

test("a zero smaller unit is dropped rather than printed", () => {
	assert.equal(formatCountdown(3 * 3_600_000), "3h");
	assert.equal(formatCountdown(2 * 86_400_000), "2d");
});

test("a countdown is empty when the reset is unknown or has passed", () => {
	assert.equal(formatCountdown(null), "");
	assert.equal(formatCountdown(0), "");
	assert.equal(formatCountdown(-5_000), "");
});

test("a countdown under a minute still says one minute, never zero", () => {
	// `max(1, minutes)`: "0m" reads as "now", which is a different claim.
	assert.equal(formatCountdown(30_000), "1m");
	assert.equal(formatCountdown(59_999), "1m");
});

test("resetsInMs is null once the window has rolled over", () => {
	assert.equal(resetsInMs(limit({ resets_at_ms: NOW + 60_000 }), NOW), 60_000);
	assert.equal(resetsInMs(limit({ resets_at_ms: NOW - 1 }), NOW), null);
	assert.equal(resetsInMs(limit({ resets_at_ms: null }), NOW), null);
});

/* --------------------------------------------------------- age (SPEC rule 6) */

test("the age ladder is just now, minutes, hours, days", () => {
	// Sub-minute is `just now`: the exact second a report landed is never the
	// question, so there is deliberately no `40s ago` rung.
	assert.equal(formatAge(0), "just now");
	assert.equal(formatAge(40_000), "just now");
	assert.equal(formatAge(59_999), "just now");
	assert.equal(formatAge(60_000), "1m ago");
	assert.equal(formatAge(3 * 60_000), "3m ago");
	assert.equal(formatAge(59 * 60_000), "59m ago");
	assert.equal(formatAge(3_600_000), "1h ago");
	assert.equal(formatAge(5 * 3_600_000 + 30 * 60_000), "5h ago");
	assert.equal(formatAge(86_400_000), "1d ago");
	assert.equal(formatAge(4 * 86_400_000), "4d ago");
});

test("a negative age is clamped rather than printed", () => {
	// Clock skew between the server stamp and this machine is real.
	assert.equal(formatAge(-10_000), "just now");
});

/* --------------------------------------------- binding window (SPEC rule 7) */

test("an account-wide window beats a fuller per-model row", () => {
	// A model family capped at 100% stops that family; a shared window at 80%
	// is throttling every request. Calling the tier row "binding" would tell a
	// user to stop working when they only needed to change model.
	const shared = limit({
		id: "weekly",
		label: "7-day",
		shared: true,
		tier: "",
		amount: amount({ used_fraction: 0.8 }),
	});
	const tier = limit({
		id: "opus-weekly",
		label: "Opus 7-day",
		shared: false,
		tier: "opus",
		amount: amount({ used_fraction: 1 }),
	});
	assert.equal(bindingLimit(report({ limits: [tier, shared] })).id, "weekly");
});

test("among account-wide windows the fullest binds", () => {
	const five = limit({
		id: "five_hour",
		shared: true,
		amount: amount({ used_fraction: 0.2 }),
	});
	const week = limit({
		id: "weekly",
		shared: true,
		amount: amount({ used_fraction: 0.62 }),
	});
	assert.equal(bindingLimit(report({ limits: [five, week] })).id, "weekly");
});

test("a per-model cap leads only when no account-wide window is measurable", () => {
	const shared = limit({ id: "weekly", shared: true, amount: amount() });
	const tier = limit({
		id: "opus-weekly",
		shared: false,
		tier: "opus",
		amount: amount({ used_fraction: 0.5 }),
	});
	assert.equal(
		bindingLimit(report({ limits: [shared, tier] })).id,
		"opus-weekly",
	);
});

test("an unmeasurable report has no binding window at all", () => {
	assert.equal(bindingLimit(report({ limits: [limit()] })), null);
	assert.equal(bindingLimit(report({ limits: [] })), null);
});

test("the binding summary states the label, an integer percent, and a countdown", () => {
	const block = bindingSummary(
		report({
			limits: [
				limit({
					label: "5-hour",
					amount: amount({ used_fraction: 0.824 }),
					resets_at_ms: NOW + 3 * 3_600_000 + 24 * 60_000,
				}),
			],
		}),
		NOW,
	);
	assert.equal(block.text, "5-hour 82%");
	assert.equal(block.countdown, "3h24m");
	assert.equal(block.status, "ok");
});

/* ---------------------------------------------------- the tally (SPEC rule 12) */

test("the tally counts windows, not providers", () => {
	const reports = [
		report({
			provider: "anthropic",
			limits: [
				limit({ id: "a", amount: amount({ used_fraction: 0.1 }) }),
				limit({ id: "b", amount: amount({ used_fraction: 0.9 }) }),
				limit({ id: "c", amount: amount({ used_fraction: 1 }) }),
			],
		}),
		report({
			provider: "openrouter",
			limits: [
				limit({ id: "d", amount: amount({ used_fraction: 0.2 }) }),
				limit({ id: "e", amount: amount() }),
				limit({ id: "f", amount: amount({ used_fraction: 0.3 }) }),
			],
		}),
	];
	assert.deepEqual(collectStats(reports), {
		windows: 6,
		exhausted: 1,
		tierExhausted: 0,
		warning: 1,
		withoutLimit: 0,
		unreported: 1,
	});
	// Worst state first, `·` separated — the TUI's `UsageStats.describe()`.
	assert.equal(
		describeStats(collectStats(reports)),
		"6 windows · 1 exhausted · 1 near limit · 1 not reported",
	);
});

const stats = (over = {}) => ({
	windows: 0,
	exhausted: 0,
	tierExhausted: 0,
	warning: 0,
	withoutLimit: 0,
	unreported: 0,
	...over,
});

test("the tally names only the states that are present", () => {
	assert.equal(describeStats(stats({ windows: 4 })), "4 windows");
	assert.equal(
		describeStats(stats({ windows: 3, warning: 2 })),
		"3 windows · 2 near limit",
	);
	// One window is singular; zero windows says nothing at all.
	assert.equal(
		describeStats(stats({ windows: 1, exhausted: 1 })),
		"1 window · 1 exhausted",
	);
	assert.equal(describeStats(stats()), "");
});

test("an exhausted per-model cap is not counted as the account being dead", () => {
	// Rule 8 subordinates a tier row everywhere else in the view precisely so
	// "a 100% family cap never reads as a dead account" — and then a flat
	// `7 exhausted`, six of them Opus caps, undid that in the line read FIRST.
	// The windows are all still counted; the caps are named as caps.
	const reports = [
		report({
			limits: [
				limit({ id: "weekly", amount: amount({ used_fraction: 0.4 }), shared: true }),
				limit({ id: "opus", tier: "opus", amount: amount({ used_fraction: 1 }) }),
				limit({ id: "sonnet", tier: "sonnet", amount: amount({ used_fraction: 1 }) }),
			],
		}),
	];
	const counted = collectStats(reports);
	assert.equal(counted.windows, 3);
	assert.equal(counted.exhausted, 0);
	assert.equal(counted.tierExhausted, 2);
	assert.equal(
		describeStats(counted),
		"3 windows · 2 model caps exhausted",
	);
	// An account-wide window at its cap IS the account being blocked, and keeps
	// the unqualified word.
	const blocked = collectStats([
		report({
			limits: [limit({ id: "weekly", shared: true, amount: amount({ used_fraction: 1 }) })],
		}),
	]);
	assert.equal(blocked.exhausted, 1);
	assert.equal(describeStats(blocked), "1 window · 1 exhausted");
	// Singular when there is one cap.
	assert.equal(
		describeStats(stats({ windows: 1, tierExhausted: 1 })),
		"1 window · 1 model cap exhausted",
	);
});

test("a window that printed a number is not called 'not reported'", () => {
	// A remaining-only balance has no denominator to grade, so it is `unknown`
	// to `effective_status` — but `1 not reported` beside a row plainly reading
	// `519.86 USD left` is a claim the frame itself contradicts. The row printing
	// a number and the tally counting it must agree, so the tally asks the same
	// question the row does.
	const balance = limit({
		id: "balance",
		label: "Balance",
		amount: amount({ remaining: 519.86, unit: "usd" }),
	});
	const counted = collectStats([report({ limits: [balance] })]);
	assert.equal(counted.withoutLimit, 1);
	assert.equal(counted.unreported, 0);
	assert.equal(describeStats(counted), "1 window · 1 without a limit");
	// The row it sits beside really does print a number, which is the whole
	// premise of the finding.
	assert.equal(limitRow(balance, NOW).amount, "519.86 USD left");
	// A window carrying nothing at all is still "not reported".
	const silent = collectStats([report({ limits: [limit({ id: "q" })] })]);
	assert.equal(silent.withoutLimit, 0);
	assert.equal(silent.unreported, 1);
	assert.equal(describeStats(silent), "1 window · 1 not reported");
});

test("the tally's counts are machine voice and its words are not", () => {
	// Branding § 4 permits mono for machine voice only — "Monospace for
	// emphasis, or for prose, is forbidden" — and the tally is a ~50-character
	// sentence carrying about 8 numerals. Setting the whole string in mono is
	// what made the toolbar read as console output beside the proportional
	// button on the same row. The split is structural, so it is pinned here
	// rather than left to the frame: the COUNT is separable from its words.
	const terms = statsTerms(stats({ windows: 6, exhausted: 1, warning: 2 }));
	assert.deepEqual(terms, [
		{ count: 6, label: "windows" },
		{ count: 1, label: "exhausted" },
		{ count: 2, label: "near limit" },
	]);
	// Every label is words only: a digit in a label means the split leaked.
	for (const term of terms) assert.ok(!/\d/.test(term.label), term.label);
	// And the one-string form still reads exactly as before.
	assert.equal(
		terms.map((t) => `${t.count} ${t.label}`).join(" · "),
		"6 windows · 1 exhausted · 2 near limit",
	);
	assert.deepEqual(statsTerms(stats()), []);
});

/* ------------------------------------------------ staleness (SPEC rule 10) */

test("the stale threshold is the cache TTL plus its jitter", () => {
	// `_stale_behind_ms()` = USAGE_REPORT_TTL_MS (5 min) * 1.25. Anchored to
	// the cache's freshness contract, not to a display resolution: the warmer
	// only refreshes the ACTIVE provider, so an idle one is supposed to be
	// minutes old.
	assert.equal(STALE_BEHIND_MS, 375_000);
	const header = NOW;
	assert.equal(isStale(report({ fetched_at: header - 374_999 }), header), false);
	assert.equal(isStale(report({ fetched_at: header - 375_000 }), header), true);
});

test("a failure streak on a fresh report produces no note", () => {
	// A 429 after a fresh confirmation misdates nothing: the numbers were
	// confirmed seconds ago, so the description's age still describes the row.
	const fresh = report({
		consecutive_failures: 3,
		limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
	});
	assert.equal(accountNote(fresh, NOW, NOW), "");
});

test("a report behind its freshest sibling says how old its numbers are", () => {
	const old = report({
		fetched_at: NOW - 40 * 60_000,
		limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
	});
	assert.equal(accountNote(old, NOW, NOW), "Last known 40m ago");
});

test("staleness is measured from the newest confirmation, not the response stamp", () => {
	// THE BASELINE IS THE RULE, not just the threshold. The TUI's `header_ms` is
	// `OperatorApp._usage_data_fetched_ms` — the newest CONFIRMED `fetched_at`
	// across the set — so a block is stale relative to its freshest sibling.
	// The response's own `fetched_at` is the SERVER CLOCK at response time
	// (`desktop_catalogues.py` sets it to `int(time.time() * 1000)`), which says
	// nothing about how old the data is. Measuring against it turned the rule
	// into "older than 6.25 minutes in absolute terms" — and against a 5-minute
	// cache TTL whose warmer only refreshes the ACTIVE provider, that marks
	// healthy reports: the flagship `real-data` frame had all 11 blocks
	// degraded, which is the mark distinguishing nothing.
	const twentyMinutesAgo = NOW - 20 * 60_000;
	const siblings = [
		report({
			provider: "anthropic",
			identity: "a@example.com",
			fetched_at: twentyMinutesAgo,
			limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
		}),
		report({
			provider: "anthropic",
			identity: "b@example.com",
			fetched_at: twentyMinutesAgo,
			limits: [limit({ amount: amount({ used_fraction: 0.5 }) })],
		}),
	];
	// Confirmed together, so neither is behind the other: the TUI marks neither.
	const headerMs = newestConfirmedMs(siblings, NOW);
	assert.equal(headerMs, twentyMinutesAgo);
	for (const block of providerBlocks(siblings, NOW, headerMs)) {
		assert.equal(block.note, "");
		assert.equal(block.degraded, false);
	}
	// The same two against the RESPONSE stamp is the defect, and it marked both.
	for (const block of providerBlocks(siblings, NOW, NOW)) {
		assert.equal(block.note, "Last known 20m ago");
		assert.equal(block.degraded, true);
	}
	// The mark still fires where it means something: one genuinely behind its
	// sibling is marked, and the fresh sibling is not.
	const mixed = [
		report({
			provider: "openrouter",
			fetched_at: NOW - 30_000,
			limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
		}),
		report({
			provider: "kimi",
			fetched_at: NOW - 40 * 60_000,
			limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
		}),
	];
	const blocks = providerBlocks(mixed, NOW, newestConfirmedMs(mixed, NOW));
	assert.equal(blocks[0].note, "");
	assert.equal(blocks[0].degraded, false);
	assert.equal(blocks[1].note, "Last known 40m ago");
	assert.equal(blocks[1].degraded, true);
});

test("the newest confirmation is the max, so one stuck account cannot pin the set", () => {
	// It used to be the `min` in the TUI, and one stuck account then pinned the
	// whole header: five logins refreshed 1.8 minutes earlier with one account
	// serving last-good for 169 minutes read `2h ago` over rows two minutes old.
	const reports = [
		report({ provider: "a", fetched_at: NOW - 169 * 60_000 }),
		report({ provider: "b", fetched_at: NOW - 2 * 60_000 }),
	];
	assert.equal(newestConfirmedMs(reports, NOW), NOW - 2 * 60_000);
	// A report with no stamp at all contributes nothing rather than zero, which
	// as a `max` baseline would be harmless but as a `min` would be catastrophic.
	assert.equal(
		newestConfirmedMs([report({ fetched_at: 0 }), report({ fetched_at: NOW - 60_000 })], NOW),
		NOW - 60_000,
	);
	// An empty set has no confirmation to measure from and falls back to now.
	assert.equal(newestConfirmedMs([], NOW), NOW);
});

test("only a CONFIRMED report can be the freshness baseline", () => {
	// The gap this closes: the stamp on a failing report is not evidence of
	// freshness. `ProviderController._mark_account_failure` builds a
	// never-successful account's stub as `UsageReport(fetched_at=now_ms)` with
	// no limits at all — the moment a probe FAILED — so under a plain `max` the
	// account that has never once reported a number became the baseline every
	// healthy sibling was aged against. The title then read `just now` above
	// blocks dated `40m ago` with all of them marked, which is the exact symptom
	// the confirmed-baseline rule exists to prevent, reachable whenever any
	// account is failing.
	const fortyMinutesAgo = NOW - 40 * 60_000;
	const confirmed = report({
		provider: "anthropic",
		fetched_at: fortyMinutesAgo,
		limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
	});

	// A failure stub holding the NEWEST stamp must not win.
	const withStub = [
		confirmed,
		report({
			provider: "kimi",
			fetched_at: NOW,
			consecutive_failures: 3,
			usage_unavailable: true,
			limits: [],
		}),
	];
	assert.equal(newestConfirmedMs(withStub, NOW), fortyMinutesAgo);
	// And the consequence the user reads: the set is described at its true age
	// rather than as `just now`.
	assert.match(describeSource("cached", newestConfirmedMs(withStub, NOW), NOW), /40m ago/);

	// A dead grant is tested FIRST and separately in the Python, because it
	// carries neither a streak nor the unavailable flag — it never enters the
	// retry path that sets them — and would otherwise pass both tests while
	// being the least confirmed state there is.
	const withDeadGrant = [
		confirmed,
		report({ provider: "xai", fetched_at: NOW, credential_invalid: true, limits: [] }),
	];
	assert.equal(newestConfirmedMs(withDeadGrant, NOW), fortyMinutesAgo);

	// `usage_unavailable` is reachable on its own: `_reset_account_for_force`
	// zeroes the streak while a cache round-trip can carry the flag alone, so
	// the flag alone must also disqualify.
	const withFlagOnly = [
		confirmed,
		report({
			provider: "openrouter",
			fetched_at: NOW,
			consecutive_failures: 0,
			usage_unavailable: true,
			limits: [limit({ amount: amount({ used_fraction: 0.2 }) })],
		}),
	];
	assert.equal(newestConfirmedMs(withFlagOnly, NOW), fortyMinutesAgo);
});

test("a wholly degraded set reports the age of its last-good numbers", () => {
	// When NOTHING is confirmed the baseline falls back to the newest stamp
	// among failing reports THAT CARRY LIMITS, so a fully degraded panel states
	// the true age of the numbers on screen instead of `just now`. The limits
	// requirement is what keeps the failure stub out of this branch too — with
	// only the confirmation filter it would simply win here instead.
	const anHourAgo = NOW - 60 * 60_000;
	const degraded = [
		report({
			provider: "anthropic",
			fetched_at: anHourAgo,
			consecutive_failures: 2,
			usage_unavailable: true,
			limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
		}),
		// Newer, but it is a stub carrying no numbers: it dates a failed probe
		// rather than any data, so it must not be the baseline.
		report({
			provider: "kimi",
			fetched_at: NOW,
			consecutive_failures: 4,
			usage_unavailable: true,
			limits: [],
		}),
	];
	assert.equal(newestConfirmedMs(degraded, NOW), anHourAgo);
	assert.match(describeSource("cached", newestConfirmedMs(degraded, NOW), NOW), /1h ago/);

	// Nothing confirmed AND no failing report carries limits: real stamps exist,
	// but every one of them dates a failed probe, so the wall clock is the only
	// honest answer. Such a frame has no meters in it and the per-account notes
	// already say the accounts are not reporting.
	const noNumbersAnywhere = [
		report({
			provider: "kimi",
			fetched_at: NOW - 1000,
			consecutive_failures: 1,
			usage_unavailable: true,
			limits: [],
		}),
	];
	assert.equal(newestConfirmedMs(noNumbersAnywhere, NOW), NOW);
});

test("unavailable names itself, and dates its numbers only when that helps", () => {
	const withNumbers = report({
		usage_unavailable: true,
		fetched_at: NOW - 2 * 3_600_000,
		limits: [limit({ amount: amount({ used_fraction: 0.9 }) })],
	});
	assert.equal(
		accountNote(withNumbers, NOW, NOW),
		"Usage unavailable — last known 2h ago",
	);
	// A sub-minute report renders `just now` — exactly what the description
	// already says — so appending it would contradict itself.
	const justNow = report({
		usage_unavailable: true,
		limits: [limit({ amount: amount({ used_fraction: 0.9 }) })],
	});
	assert.equal(accountNote(justNow, NOW, NOW), "Usage unavailable");
	// No meters means no vintage to state.
	assert.equal(
		accountNote(report({ usage_unavailable: true }), NOW, NOW),
		"Usage unavailable",
	);
});

/* ----------------------------------------------- a dead grant (SPEC rule 11) */

test("a dead grant names the command that fixes it, and outranks staleness", () => {
	const dead = report({
		provider: "kimi",
		credential_invalid: true,
		usage_unavailable: true,
		fetched_at: NOW - 2 * 86_400_000,
		limits: [limit({ amount: amount({ used_fraction: 1 }) })],
	});
	// `/login kimi` is runnable as printed, which "sign in again" would not be.
	assert.equal(
		accountNote(dead, NOW, NOW),
		"Sign-in expired — run /login kimi. Last known 2d ago.",
	);
	// The last-known numbers keep rendering under it.
	const blocks = providerBlocks([dead], NOW, NOW);
	assert.equal(blocks[0].rows.length, 1);
	assert.equal(blocks[0].degraded, true);
});

/* --------------------------------------------------- rows and whole blocks */

test("an unmeasurable window renders no fill and the words not reported", () => {
	const row = limitRow(limit({ label: "Balance", amount: amount({ remaining: 12, unit: "usd" }) }), NOW);
	assert.equal(row.fraction, null);
	assert.equal(row.amount, "12.00 USD left");
	assert.equal(row.status, "unknown");
	const bare = limitRow(limit(), NOW);
	assert.equal(bare.fraction, null);
	assert.equal(bare.amount, "not reported");
});

test("a row's fraction is clamped into the bar's range", () => {
	const over = limitRow(limit({ amount: amount({ used_fraction: 1.4 }) }), NOW);
	assert.equal(over.fraction, 1);
	assert.equal(over.status, "exhausted");
});

test("a tier row marks itself subordinate", () => {
	assert.equal(limitRow(limit({ tier: "opus" }), NOW).subordinate, true);
	assert.equal(limitRow(limit({ tier: "" }), NOW).subordinate, false);
});

test("a healthy block is not degraded", () => {
	const blocks = providerBlocks(
		[report({ limits: [limit({ amount: amount({ used_fraction: 0.2 }) })] })],
		NOW,
		NOW,
	);
	assert.equal(blocks[0].degraded, false);
	assert.equal(blocks[0].note, "");
	assert.equal(blocks[0].binding.text, "5-hour 20%");
});

test("the description names the source and the age of the numbers", () => {
	assert.equal(
		describeSource("cached", NOW - 3 * 60_000, NOW),
		"Cached report, 3m ago.",
	);
	assert.equal(describeSource("live", NOW, NOW), "Live report, just now.");
});

test("the description ages the numbers, not the response against itself", () => {
	// The route stamps a cached response with the server clock at RESPONSE time,
	// so passing `payload.fetched_at` made the age term structurally ~0 and the
	// line always read `Cached report, just now.` however old the numbers were.
	// The committed `real-data` frame said exactly that above 28 windows the
	// same frame dated `1h ago`. This is the dialog's most-read line.
	const reports = [
		report({ provider: "a", fetched_at: NOW - 60 * 60_000 }),
		report({ provider: "b", fetched_at: NOW - 90 * 60_000 }),
	];
	const responseStamp = NOW;
	// The defect: age the response against itself.
	assert.equal(
		describeSource("cached", responseStamp, NOW),
		"Cached report, just now.",
	);
	// The rule: age from the newest confirmation, the same baseline the blocks
	// are marked against — one fix, two call sites.
	assert.equal(
		describeSource("cached", newestConfirmedMs(reports, responseStamp), NOW),
		"Cached report, 1h ago.",
	);
});

test("the backend's state decides the note, not counters re-derived from it", () => {
	// SPEC's data contract: "`state` is derived server-side and is
	// authoritative; do not re-derive it from counters." The field was typed,
	// documented, and never read. It is not a formality — the route folds "no
	// limits at all" into `unavailable` even when `usage_unavailable` is FALSE,
	// which is xai's unified-billing shape.
	const unifiedBilling = report({
		provider: "xai",
		identity: "acct@example.com",
		usage_unavailable: false,
		credential_invalid: false,
		state: "unavailable",
		limits: [],
	});
	const [block] = providerBlocks([unifiedBilling], NOW, NOW);
	// Re-deriving from the counters yields "available" here and says nothing at
	// all, which is the silent block that reads as a rendering defect.
	assert.equal(block.degraded, true);
	assert.equal(block.note, "Usage unavailable");
	// And the block says why it is empty rather than rendering a bare heading.
	assert.equal(block.rows.length, 0);
	assert.equal(block.emptyNote, "No windows reported.");
	// A block WITH windows carries no empty note.
	const [populated] = providerBlocks(
		[report({ limits: [limit({ amount: amount({ used_fraction: 0.2 }) })] })],
		NOW,
		NOW,
	);
	assert.equal(populated.emptyNote, "");
});

test("a dead grant's note keeps the vocabulary its siblings teach", () => {
	// `… · numbers 2d ago` is telegraphic in a way no other copy in this view
	// is, and the interpunct implied the two clauses were peers when one is a
	// remedy and the other a provenance caveat. The siblings say `Last known
	// 40m ago` and `Usage unavailable — last known 2h ago`.
	const dead = report({
		provider: "xai",
		credential_invalid: true,
		usage_unavailable: true,
		state: "reauth_required",
		fetched_at: NOW - 2 * 86_400_000,
		limits: [limit({ amount: amount({ used_fraction: 1 }) })],
	});
	assert.equal(
		accountNote(dead, NOW, NOW),
		"Sign-in expired — run /login xai. Last known 2d ago.",
	);
	// With no numbers to date, the remedy stands alone.
	const noNumbers = report({
		provider: "xai",
		credential_invalid: true,
		state: "reauth_required",
		limits: [],
	});
	assert.equal(
		accountNote(noNumbers, NOW, NOW),
		"Sign-in expired — run /login xai.",
	);
});

test("a negative percent that rounds to zero keeps Python's sign", () => {
	// `f"{-0.49999:.0f}"` is `-0`, and the module's contract is "if you change
	// anything here, change it there too". Cosmetic, but a divergence from the
	// stated source of truth is exactly what this file exists to catch.
	assert.equal(formatAmount(amount({ used: -0.49999, unit: "percent" })), "-0%");
	assert.equal(formatAmount(amount({ used: 0, unit: "percent" })), "0%");
});

test("the binding summary separates its label from its number", () => {
	// The heading's percentage has to land in the rows' amount column, and the
	// words are prose while the number is machine voice (branding § 4). Both
	// need the two halves separable, so the split is part of the model rather
	// than a slice taken in JSX.
	const summary = bindingSummary(
		report({
			limits: [
				limit({
					id: "seven_day",
					label: "7-day",
					amount: amount({ used_fraction: 0.88 }),
					resets_at_ms: NOW + 2 * 86_400_000 + 11 * 3_600_000,
					shared: true,
				}),
			],
		}),
		NOW,
	);
	assert.equal(summary.label, "7-day");
	assert.equal(summary.percent, "88%");
	assert.equal(summary.countdown, "2d11h");
	// The joined form is unchanged, so nothing that reads `text` moved.
	assert.equal(summary.text, "7-day 88%");
});
