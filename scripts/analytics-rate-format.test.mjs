/**
 * The tokens-per-second formatting rules, executable.
 *
 *     node --test scripts/analytics-rate-format.test.mjs
 *
 * These are the rules no frame can put on trial. A still image shows one row at
 * one rate; it cannot show that `—` and `0.0` are different answers, that a real
 * sub-tenth rate is not rounded into the stopped reading, or where the scaling
 * boundary sits. The analytics pane's `/usage`-style surfaces are covered by
 * stories and evidence frames, which is why the CELLS are judged there — but the
 * two-sided decimal rule and the unknown-versus-zero split are decisions, and
 * review round 1 on this repository's analytics PR found them unpinned (and, at
 * the bottom of the range, wrong: a genuine 0.0333 tok/s printed `0.0 tok/s`,
 * which is the stopped reading the rule exists to avoid).
 *
 * The module is BUNDLED in memory rather than re-implemented, the same way
 * `analytics-session-table.test.mjs` does it, so this suite fails when the
 * shipped function changes and not when a copy of it does.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/pickers/panels/formatters";',
			'export * as i18n from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/* The panel formatters read the i18n locale layer (@shared/i18n), whose
	 * shim reaches src/i18n by relative path — only the @shared alias is
	 * needed here (the `turn-timestamp.test.mjs` recipe). */
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { UNKNOWN, formatTokensPerSecond, tokensPerSecond, i18n } = mod;

test("a rate with no samples is UNKNOWN, and a measured zero is not", () => {
	// The count is what disambiguates: no contributing calls means no rate, while
	// a call that really decoded at nothing is a measurement and prints as one.
	assert.equal(tokensPerSecond(0, 0, 0), null);
	assert.equal(tokensPerSecond(100, 0, 1), null);
	assert.equal(formatTokensPerSecond(null), UNKNOWN);
	assert.equal(formatTokensPerSecond(undefined), UNKNOWN);
	assert.equal(formatTokensPerSecond(0), "0.0 tok/s");
	assert.notEqual(formatTokensPerSecond(0), UNKNOWN);
});

test("a positive rate below the tenth boundary is not rounded into a stop", () => {
	// The trap one decimal below the docstring's own example: 1 token over a 30 s
	// window is 0.0333 tok/s, which toFixed(1) renders as `0.0 tok/s` — i.e. it
	// presents a slow call as a stopped one.
	assert.equal(
		formatTokensPerSecond(tokensPerSecond(1, 30_000_000, 1)),
		"<0.1 tok/s",
	);
	assert.equal(formatTokensPerSecond(0.049), "<0.1 tok/s");
	// At the boundary the ordinary spelling takes over, so the two rules meet
	// rather than overlapping.
	// `0.05` is the case a threshold misses: round-half-even sends its tenth to
	// `0.0`, so the guard tests the ROUNDED value rather than a hand-picked cut.
	assert.equal(formatTokensPerSecond(0.05), "<0.1 tok/s");
	assert.equal(formatTokensPerSecond(0.06), "0.1 tok/s");
	assert.equal(formatTokensPerSecond(0.4), "0.4 tok/s");
});

test("below ten keeps one decimal; at ten and above it is a whole count", () => {
	assert.equal(formatTokensPerSecond(9.94), "9.9 tok/s");
	assert.equal(formatTokensPerSecond(62.5), "62 tok/s");
	assert.equal(formatTokensPerSecond(1240), "1,240 tok/s");
	// Grouped digits, NOT a scale suffix: this pane deliberately prints `1,240`
	// where the TUI prints `1.2k`, and the difference is recorded on the PR rather
	// than quietly harmonised — the two surfaces have their own conventions.
	assert.equal(formatTokensPerSecond(12_400), "12,400 tok/s");
});

test("every value in the domain prints a string, and none of them is numeric", () => {
	// Totality matters because this string is dropped straight into a table cell:
	// a formatter that could throw or return a number would render `NaN` in the
	// one column this feature exists to show.
	// `NaN` and `Infinity` are IN the domain deliberately: the guard for them lives
	// one function away from a textually identical opening line, and an earlier
	// revision of it landed in the byte formatter, where every assertion in this
	// file still passed. A value the guard answers for has to be a value the test
	// asks about.
	for (const value of [
		null,
		undefined,
		0,
		0.0001,
		0.05,
		9.99,
		10,
		999,
		1e9,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	]) {
		const printed = formatTokensPerSecond(value);
		assert.equal(typeof printed, "string");
		assert.ok(printed.endsWith("tok/s") || printed === UNKNOWN, printed);
	}
});

/*
 * S16c: the panels no longer pin en-US. The first test is the ENGLISH
 * IDENTITY witness (the same bytes the pin printed, plus the toFixed rounding
 * that `Intl` alone would change: 1150/1000 is `1.1` under toFixed and `1.2`
 * under Intl half-away); the rest are one witness per locale, each moved
 * through the real store and restored in `finally`.
 */
const withLocale = (tag, fn) => {
	try {
		i18n.setLocale(tag);
		assert.equal(i18n.currentLocale(), tag);
		fn();
	} finally {
		i18n.applyCapabilities(null);
	}
};

test("English is byte-identical to the pre-S16c spellings", () => {
	withLocale("en", () => {
		assert.equal(mod.formatCount(1234), "1,234");
		assert.equal(mod.formatCount(1240.4), "1,240");
		assert.equal(mod.formatMs(999.6), "1,000 ms");
		assert.equal(mod.formatMs(1234), "1.2 s");
		assert.equal(mod.formatTokens(912), "912");
		assert.equal(mod.formatTokens(3400), "3.4k");
		assert.equal(
			mod.formatTokens(1150),
			"1.1k",
			"toFixed rounds the exact binary value",
		);
		assert.equal(mod.formatTokens(2_000), "2k");
		assert.equal(mod.formatTokens(999_950), "1M");
		assert.equal(mod.formatTokens(4_100_000_000), "4.1B");
		assert.equal(mod.formatContextTokens(12_400), "12.4k");
		assert.equal(mod.formatContextTokens(1_200_000), "1.2m");
		assert.equal(mod.formatWindow(1_000_000), "1M");
		assert.equal(mod.formatWindow(1_500_000), "1.5M");
		assert.equal(mod.formatWindow(200_000), "200k");
		assert.equal(mod.formatBytes(1500 * 2 ** 30), "1500.0 GB");
		assert.equal(mod.formatTokensPerSecond(1240), "1,240 tok/s");
		assert.equal(mod.formatTokensPerSecond(0.4), "0.4 tok/s");
		assert.equal(mod.formatTokensPerSecond(0.049), "<0.1 tok/s");
		assert.equal(mod.formatDuration(3725), "1h 2m");
		assert.equal(mod.formatDayBucket("2026-09-13"), "Sep 13");
	});
});

/* [locale, grouped count, 3400 tokens, 1234 ms, <0.1 rate, 13 Sep bucket] */
const WITNESSES = [
	["fr", "1\u202f234", "3,4k", "1,2 s", "<0,1 tok/s", "13 sept."],
	["de", "1.234", "3,4k", "1,2 s", "<0,1 tok/s", "13. Sept."],
	["ru", "1\u00a0234", "3,4k", "1,2 s", "<0,1 tok/s", "13 сент."],
	["ur", "1,234", "3.4k", "1.2 s", "<0.1 tok/s", "13 ستمبر"],
	["hi", "1,234", "3.4k", "1.2 s", "<0.1 tok/s", "13 सित॰"],
	["vi", "1.234", "3,4k", "1,2 s", "<0,1 tok/s", "13 thg 9"],
	["zh-CN", "1,234", "3.4k", "1.2 s", "<0.1 tok/s", "9月13日"],
];
for (const [tag, count, tokens, ms, tiny, day] of WITNESSES) {
	test(`the panel numbers and day buckets follow the live locale: ${tag}`, () => {
		withLocale(tag, () => {
			assert.equal(mod.formatCount(1234), count);
			assert.equal(mod.formatTokens(3400), tokens);
			assert.equal(mod.formatMs(1234), ms);
			assert.equal(mod.formatTokensPerSecond(0.049), tiny);
			assert.equal(mod.formatDayBucket("2026-09-13"), day);
			// A rate at ten and above goes through formatCount, so it groups too.
			assert.equal(mod.formatTokensPerSecond(1234), `${count} tok/s`);
		});
	});
}

test("a locale switch repaints: the same call answers the NEW locale", () => {
	// The formatters resolve the locale per call, never at import: a pin
	// captured at module load would keep the first answer after the switch.
	withLocale("fr", () => assert.equal(mod.formatCount(1234), "1\u202f234"));
	withLocale("en", () => assert.equal(mod.formatCount(1234), "1,234"));
});

test("the unit symbols stay ASCII in every locale (documented exception)", () => {
	withLocale("fr", () => {
		assert.equal(mod.formatMs(840), "840 ms");
		assert.equal(mod.formatTokensPerSecond(5), "5,0 tok/s");
		assert.equal(mod.formatContextTokens(1_200_000), "1,2m");
		assert.equal(mod.formatWindow(1_500_000), "1,5M");
		assert.equal(mod.formatTokens(2_000), "2k");
		assert.equal(mod.formatDuration(3725), "1h 2m");
	});
});

test("file sizes follow #1861's localised helper (number AND unit label)", () => {
	// Not an exception: formatBytes delegates to formatByteQuantity, whose unit
	// labels are localised (fr: Go) and whose decimal follows the locale.
	withLocale("en", () => assert.equal(mod.formatBytes(3 * 2 ** 30), "3.0 GB"));
	withLocale("fr", () => assert.equal(mod.formatBytes(3 * 2 ** 30), "3,0\u202fGo"));
});

test("an unparseable day bucket is still returned verbatim in any locale", () => {
	withLocale("fr", () => {
		assert.equal(mod.formatDayBucket("not-a-date"), "not-a-date");
		assert.equal(mod.formatDayBucket("2026-13-01"), "2026-13-01");
	});
});
