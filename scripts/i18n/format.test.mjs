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
	assert.equal(format.formatDuration(3725, "fr"), "1h 2m 5s");
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
