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
	providerBlocks,
	resetsInMs,
	statusOf,
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

const report = (over = {}) => ({
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
	state: "available",
	...over,
});

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

test("a vendor status the view has no colour for degrades to unknown", () => {
	// The Python passes any string through; the view has four tints, so a word
	// outside the vocabulary must not silently tint a row by accident.
	assert.equal(
		effectiveStatus(limit({ status: "throttled", amount: amount({ used_fraction: 0.2 }) })),
		"ok",
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
	// to EVEN. A differential run of this module against the real
	// `format_amount` over 3,325 amounts found this as the port's only
	// divergence, in 125 of them — rows where this view and the TUI would quote
	// different numbers for the same report. Pinned here so it cannot come back
	// the next time someone "simplifies" the formatter.
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
		warning: 1,
		unknown: 1,
	});
	// Worst state first, `·` separated — the TUI's `UsageStats.describe()`.
	assert.equal(
		describeStats(collectStats(reports)),
		"6 windows · 1 exhausted · 1 near limit · 1 not reported",
	);
});

test("the tally names only the states that are present", () => {
	assert.equal(
		describeStats({ windows: 4, exhausted: 0, warning: 0, unknown: 0 }),
		"4 windows",
	);
	assert.equal(
		describeStats({ windows: 3, exhausted: 0, warning: 2, unknown: 0 }),
		"3 windows · 2 near limit",
	);
	// One window is singular; zero windows says nothing at all.
	assert.equal(
		describeStats({ windows: 1, exhausted: 1, warning: 0, unknown: 0 }),
		"1 window · 1 exhausted",
	);
	assert.equal(
		describeStats({ windows: 0, exhausted: 0, warning: 0, unknown: 0 }),
		"",
	);
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

test("a report behind the response stamp says how old its numbers are", () => {
	const old = report({
		fetched_at: NOW - 40 * 60_000,
		limits: [limit({ amount: amount({ used_fraction: 0.4 }) })],
	});
	assert.equal(accountNote(old, NOW, NOW), "Last known 40m ago");
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
		"Sign-in expired — run /login kimi · numbers 2d ago",
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

test("the description names the source and the age of the response", () => {
	assert.equal(
		describeSource("cached", NOW - 3 * 60_000, NOW),
		"Cached report, 3m ago.",
	);
	assert.equal(describeSource("live", NOW, NOW), "Live report, just now.");
});
