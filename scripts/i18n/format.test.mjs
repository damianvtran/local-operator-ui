import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Intl formatter layer: the migrated sites' exact equivalences, the
 * locale pass-through, and the four functions the extraction slices will call.
 *
 * THE EQUIVALENCE PINS ARE THE POINT OF THE FIRST TEST. The sites this PR
 * moved onto the layer used `toLocaleDateString` / `toLocaleTimeString` /
 * `toLocaleString` with `navigator.language`; the layer builds
 * `Intl.DateTimeFormat` instead, and "same output" must be MEASURED for every
 * option set those sites pass, in both the pre-connection device tag (`en-US`
 * here — the app's own locale) and the backend-resolved `en`. If an option
 * set's equivalence ever breaks, that test names it.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as format from "./src/i18n/format";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { format, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const INSTANT = new Date(2026, 7, 5, 15, 42, 0);

/** `[method, options, layer call]` — the exact shapes the migrated sites use. */
const MIGRATED = [
	[
		"toLocaleDateString",
		{ year: "numeric", month: "long", day: "numeric" },
		(date, options, tag) => format.formatDate(date, options, tag),
	],
	[
		"toLocaleTimeString",
		{ hour: "numeric", minute: "2-digit", hour12: true },
		(date, options, tag) => format.formatTime(date, options, tag),
	],
	[
		"toLocaleDateString",
		{ month: "short", day: "numeric" },
		(date, options, tag) => format.formatDate(date, options, tag),
	],
	[
		"toLocaleTimeString",
		{ hour: "numeric", minute: "2-digit" },
		(date, options, tag) => format.formatTime(date, options, tag),
	],
	[
		"toLocaleString",
		{
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		},
		(date, options, tag) => format.formatDateTime(date, options, tag),
	],
	[
		"toLocaleString",
		{
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		},
		(date, options, tag) => format.formatDateTime(date, options, tag),
	],
];

test("every migrated option set is byte-identical to the toLocale* call it replaces", () => {
	for (const tag of ["en-US", "en"]) {
		for (const [method, options, viaLayer] of MIGRATED) {
			const direct = INSTANT[method](tag, options);
			assert.equal(
				viaLayer(INSTANT, options, tag),
				direct,
				`${method} ${JSON.stringify(options)} differs for ${tag}`,
			);
		}
	}
});

test("the default path reads the store: device tag before an answer, resolved after", () => {
	for (const [method, options, viaLayer] of MIGRATED) {
		const direct = INSTANT[method](globalThis.navigator.language, options);
		assert.equal(viaLayer(INSTANT, options), direct);
	}
	const withLocale = format.formatDate(INSTANT, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	assert.equal(withLocale, "August 5, 2026");
});

test("dates render in the resolved locale, not English by accident", () => {
	assert.equal(
		format.formatDate(
			INSTANT,
			{ year: "numeric", month: "long", day: "numeric" },
			"fr",
		),
		"5 août 2026",
	);
	assert.equal(
		format.formatTime(
			INSTANT,
			{ hour: "numeric", minute: "2-digit", hour12: true },
			"fr",
		),
		"3:42 PM",
	);
});

test("numbers: a bare call matches a bare Intl, and the panel shapes hold", () => {
	assert.equal(format.formatNumber(1234.567), "1,234.567");
	assert.equal(
		format.formatNumber(999.9999, { maximumFractionDigits: 0 }),
		"1,000",
	);
	assert.equal(format.formatNumber(Math.trunc(1240.4)), "1,240");
	assert.equal(format.formatNumber(-3.5, { maximumFractionDigits: 0 }), "-4");
});

test("relative time is Intl.RelativeTimeFormat, numeric-always by default", () => {
	assert.equal(
		format.formatRelativeTime(-3, "day", undefined, "en"),
		"3 days ago",
	);
	assert.equal(
		format.formatRelativeTime(3, "hour", undefined, "en"),
		"in 3 hours",
	);
	assert.equal(
		format.formatRelativeTime(-3, "day", undefined, "fr"),
		"il y a 3 jours",
	);
	// Numeric-always means "yesterday" stays "1 day ago" — the core layer's
	// contract, kept; a site wanting the specials opts in.
	assert.equal(
		format.formatRelativeTime(-1, "day", undefined, "en"),
		"1 day ago",
	);
	assert.equal(
		format.formatRelativeTime(-1, "day", { numeric: "auto" }, "en"),
		"yesterday",
	);
});

test("durations mirror the core's compact shape: zero units omitted, digits localised", () => {
	assert.equal(format.formatDuration(3725, "en"), "1h 2m 5s");
	assert.equal(format.formatDuration(59, "en"), "59s");
	assert.equal(format.formatDuration(3600, "en"), "1h");
	assert.equal(format.formatDuration(86_461, "en"), "1d 1m 1s");
	assert.equal(format.formatDuration(0, "en"), "0s");
	assert.equal(format.formatDuration(-5, "en"), "0s");
	// i18n slice C3: the unit words are CLDR's narrow units now, so French
	// takes `min` (measured, ICU 78.3) rather than the former ASCII `m`.
	assert.equal(format.formatDuration(3725, "fr"), "1h 2min 5s");
});

/** The RTL bidi isolates `translate()` adds around an argument, removed. */
const stripIsolates = (text) => text.replace(/[\u2066-\u2069]/g, "");

test("C3: every duration shape is byte-identical in English", () => {
	const compact = [
		[0, "0s"],
		[59, "59s"],
		[60, "1m"],
		[65, "1m5s"],
		[3599, "59m59s"],
		[3600, "1h"],
		[3725, "1h2m"],
		[86_399, "23h59m"],
		[90_000, "1d1h"],
		[99 * 86_400 + 23 * 3600, "99d23h"],
		[100 * 86_400, "100d+"],
		[-5, "0s"],
	];
	for (const [seconds, expected] of compact) {
		assert.equal(format.formatCompactDuration(seconds, "en"), expected);
	}
	const settled = [
		[0, "<0.1s"],
		[0.049, "<0.1s"],
		[0.05, "0.1s"],
		[2, "2.0s"],
		// `toFixed` rounding, not Intl's: 9.95 is `9.9`, and stays under ten.
		[9.95, "9.9s"],
		[12.4, "12s"],
		[65, "1m5s"],
	];
	for (const [seconds, expected] of settled) {
		assert.equal(format.formatSettledDuration(seconds, "en"), expected);
	}
	assert.equal(format.formatDurationUnit(250, "millisecond", 0, "en"), "250ms");
	assert.equal(format.formatDurationUnit(1, "week", 0, "en"), "1w");
	assert.equal(
		format.formatDurationParts(
			[
				[1, "hour"],
				[30, "minute"],
			],
			{ compact: true },
			"en",
		),
		"1h30m",
	);
});

test("C3: French and Urdu durations take their own units through the helper", () => {
	assert.equal(format.formatCompactDuration(5, "fr"), "5s");
	assert.equal(format.formatCompactDuration(65, "fr"), "1min 5s");
	assert.equal(format.formatCompactDuration(5400, "fr"), "1h 30min");
	assert.equal(format.formatSettledDuration(1.5, "fr"), "1,5s");
	assert.equal(format.formatCompactDuration(100 * 86_400, "fr"), "100j+");
	assert.equal(format.formatSettledDuration(0, "fr"), "<0,1s");

	assert.equal(format.formatCompactDuration(5, "ur"), "5 سیکنڈ");
	assert.equal(format.formatCompactDuration(65, "ur"), "1 منٹ اور 5 سیکنڈ");
	assert.equal(
		format.formatDuration(3725, "ur"),
		"1 گھنٹہ، 2 منٹ، اور 5 سیکنڈ",
	);
	assert.equal(
		stripIsolates(format.formatCompactDuration(100 * 86_400, "ur")),
		"100 دن+",
	);
	assert.equal(
		stripIsolates(format.formatSettledDuration(0.01, "ur")),
		"<0.1 سیکنڈ",
	);
	// No ASCII unit letter survives in either locale's compound shape.
	assert.doesNotMatch(format.formatCompactDuration(3725, "ur"), /[a-z]/);
});

test("C3: a duration resolved without a pin follows a live locale switch", () => {
	// The formatter instances are cached per locale; the call that does not
	// pin one must read the CURRENT locale every time, never the first one.
	locale.setLocale("en");
	const before = format.formatCompactDuration(65);
	locale.setLocale("fr");
	const after = format.formatCompactDuration(65);
	locale.setLocale("en");
	assert.equal(before, "1m5s");
	assert.equal(after, "1min 5s");
	assert.equal(format.formatCompactDuration(65), "1m5s");
});

test("byte sizes mirror the core's SI ladder, one decimal below ten units", () => {
	assert.equal(format.formatBytes(999, "en"), "999 B");
	assert.equal(format.formatBytes(1000, "en"), "1 KB");
	assert.equal(format.formatBytes(1536, "en"), "1.5 KB");
	assert.equal(format.formatBytes(12_345, "en"), "12 KB");
	assert.equal(format.formatBytes(999_999, "en"), "1,000 KB");
	assert.equal(format.formatBytes(1_500_000, "en"), "1.5 MB");
	assert.equal(format.formatBytes(0, "en"), "0 B");
	assert.equal(format.formatBytes(-5, "en"), "0 B");
});

test("formatter instances are cached per (locale, options) and locale switches reach them", () => {
	const first = format.formatDate(INSTANT, { month: "long" }, "fr");
	const second = format.formatDate(INSTANT, { month: "long" }, "fr");
	assert.equal(first, second);
	assert.notEqual(format.formatDate(INSTANT, { month: "long" }, "en"), first);
	// The store path: setLocale moves what an unpinned call reads...
	try {
		locale.setLocale("fr");
		assert.equal(format.formatDate(INSTANT, { month: "long" }), "août");
	} finally {
		locale.applyCapabilities(null);
	}
});
