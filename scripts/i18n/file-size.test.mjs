import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * File sizes in every language (i18n slice B4).
 *
 * The census found `KB` / `MB` and ASCII decimal points in every locale, from
 * seven hand-rolled formatters. They now spell their result through
 * `formatByteQuantity` (digits, decimal mark, separator and unit symbol from
 * `Intl`); the SCALE and rounding stay with each surface and are pinned by that
 * surface's own suite. This file pins (1) the shared helper per locale and
 * (2) that each real surface follows the active locale, with (3) a source
 * guard so a new `/ 1024` formatter cannot land beside them.
 *
 * EXPECTED STRINGS WERE MEASURED, not typed from memory: each was produced by
 * running `Intl.NumberFormat` under the runtime recorded in the first test
 * (ICU/CLDR change a unit symbol between releases, so a drift there fails
 * with the version printed beside it).
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as format from "./src/i18n/format";',
			'export * as locale from "./src/i18n/locale";',
			'export { formatBytes as libraryBytes } from "./src/renderer/src/features/library/library-model";',
			'export { fileSizeText } from "./src/renderer/src/features/chat/canonical/supplement-model";',
			'export { attachmentSizeText } from "./src/renderer/src/features/projects/project-model";',
			'export { formatBytes as traceBytes } from "./src/renderer/src/features/chat/components/trace/tool-row-model";',
			'export { formatBytes as panelBytes } from "./src/renderer/src/features/chat/pickers/panels/formatters";',
			'export { formatByteSize } from "./src/renderer/src/shared/lib/format-bytes";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const NNBSP = "\u202f";
const NBSP = "\u00a0";
const SAMPLES = [0, 1, 1023, 1024, 1536, 1_048_576, 2.5e9];

/** Measured with ICU 78.3 / CLDR 48.0 (Node v24.22.1); `formatBytes` is the SI ladder. */
const EXPECTED = {
	en: ["0 B", "1 B", "1 KB", "1 KB", "1.5 KB", "1 MB", "2.5 GB"],
	fr: [
		`0${NNBSP}o`,
		`1${NNBSP}o`,
		`1${NNBSP}ko`,
		`1${NNBSP}ko`,
		`1,5${NNBSP}ko`,
		`1${NNBSP}Mo`,
		`2,5${NNBSP}Go`,
	],
	es: ["0 B", "1 B", "1 kB", "1 kB", "1,5 kB", "1 MB", "2,5 GB"],
	ru: ["0 Б", "1 Б", "1 кБ", "1 кБ", "1,5 кБ", "1 МБ", "2,5 ГБ"],
	"zh-CN": ["0 B", "1 B", "1 kB", "1 kB", "1.5 kB", "1 MB", "2.5 GB"],
	vi: ["0 B", "1 B", "1 kB", "1 kB", "1,5 kB", "1 MB", "2,5 GB"],
	hi: ["0 बाइट", "1 बाइट", "1 kB", "1 kB", "1.5 kB", "1 MB", "2.5 GB"],
	ur: ["0 B", "1 B", "1 kB", "1 kB", "1.5 kB", "1 MB", "2.5 GB"],
};

test("runtime ICU is recorded beside the measured expectations", () => {
	// Printed so a failure in the next test can be read against the data it
	// was measured with.
	console.log(
		`# file-size expectations measured with ICU ${process.versions.icu} / CLDR ${process.versions.cldr} (Node ${process.version})`,
	);
	assert.ok(process.versions.icu);
});

test("formatBytes spells the SI ladder per locale at 0, 1, 1023, 1024, 1536, 1 MiB and 2.5e9 bytes", () => {
	for (const [tag, expected] of Object.entries(EXPECTED)) {
		assert.deepEqual(
			SAMPLES.map((bytes) => m.format.formatBytes(bytes, tag)),
			expected,
			`${tag} (ICU ${process.versions.icu})`,
		);
	}
});

test("French has no ASCII B/KB/MB/GB left: octets with the French decimal comma", () => {
	for (const text of EXPECTED.fr) assert.doesNotMatch(text, /[KMGT]?B\b/);
	assert.equal(m.format.formatBytes(2_400_000, "fr"), `2,4${NNBSP}Mo`);
});

test("the byte symbol never falls back to the English noun `byte`", () => {
	// CLDR's SHORT style is `byte` for en/ur/vi; the helper reads NARROW so an
	// Urdu or Vietnamese interface shows the symbol, not a lowercase English word.
	for (const tag of Object.keys(EXPECTED)) {
		assert.doesNotMatch(m.format.formatBytes(5, tag), /\bbytes?\b/i, tag);
	}
});

test("IEC symbols stay as the standard writes them; digits and separators follow the locale", () => {
	const q = (tag) =>
		m.format.formatByteQuantity(
			1234.5,
			"MiB",
			{ maximumFractionDigits: 1 },
			tag,
		);
	assert.equal(q("en"), "1,234.5 MiB");
	assert.equal(q("fr"), `1${NNBSP}234,5${NNBSP}MiB`);
	assert.equal(q("ru"), `1${NBSP}234,5 MiB`);
	assert.equal(q("ur"), "1,234.5 MiB");
});

test("an invalid or negative size clamps to zero rather than printing NaN", () => {
	assert.equal(m.format.formatBytes(Number.NaN, "fr"), `0${NNBSP}o`);
	assert.equal(m.format.formatBytes(-5, "ru"), "0 Б");
});

/** Run `fn` with the app locale set, restoring the device default afterwards. */
function inLocale(tag, fn) {
	try {
		m.locale.setLocale(tag);
		return fn();
	} finally {
		m.locale.applyCapabilities(null);
	}
}

test("every surface follows the active locale and keeps its own scale (en pinned byte-identical)", () => {
	// [surface, call, en, fr, ru]. The scales differ on purpose (1024 file rows,
	// 1000 message budgets), so the SAME byte count reads differently per
	// surface; what is pinned is that none of them is English in fr/ru.
	const rows = [
		[
			"library",
			() => m.libraryBytes(2_500_000),
			"2.4 MB",
			`2,4${NNBSP}Mo`,
			"2,4 МБ",
		],
		[
			"library 1 KiB",
			() => m.libraryBytes(1024),
			"1.0 KB",
			`1,0${NNBSP}ko`,
			"1,0 кБ",
		],
		[
			"canvas file row",
			() => m.fileSizeText(1536),
			"1.5 KB",
			`1,5${NNBSP}ko`,
			"1,5 кБ",
		],
		[
			"canvas file row B",
			() => m.fileSizeText(912),
			"912 B",
			`912${NNBSP}o`,
			"912 Б",
		],
		[
			"project asset",
			() => m.attachmentSizeText(5_452_595),
			"5.2 MB",
			`5,2${NNBSP}Mo`,
			"5,2 МБ",
		],
		[
			"tool trace",
			() => m.traceBytes(12_688),
			"12.4 KB",
			`12,4${NNBSP}ko`,
			"12,4 кБ",
		],
		[
			"info panel",
			() => m.panelBytes(190_000_000),
			"181 MB",
			`181${NNBSP}Mo`,
			"181 МБ",
		],
		[
			"message budget",
			() => m.formatByteSize(2_400_000),
			"2.4 MB",
			`2,4${NNBSP}Mo`,
			"2,4 МБ",
		],
	];
	for (const [name, call, en, fr, ru] of rows) {
		assert.equal(inLocale("en", call), en, `${name} en`);
		assert.equal(inLocale("fr", call), fr, `${name} fr`);
		assert.equal(inLocale("ru", call), ru, `${name} ru`);
	}
});

test("a locale change is read at call time, never captured at import", () => {
	const first = inLocale("fr", () => m.libraryBytes(2_500_000));
	const second = inLocale("en", () => m.libraryBytes(2_500_000));
	assert.notEqual(first, second);
	// `inLocale` restores the device default between the two calls: no cache
	// keyed on a previous locale answers for the next.
	assert.equal(second, "2.4 MB");
});

/* --------------------------------------------------- source guard ------ */

const RENDERER = join(process.cwd(), "src", "renderer", "src");

function sourceFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(path));
		else if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!/\.(stories|test)\.(ts|tsx)$/.test(entry.name)
		)
			out.push(path);
	}
	return out;
}

/** Strip comments so prose about `/ 1024` in a doc block is not a finding. */
function codeOnly(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/*
 * Files that divide by 1024 for a number that goes into a CATALOGUE message
 * carrying its own unit word (`{size} KiB`, `{megabytes} MB`): the unit is
 * translator-owned copy there, not an ad-hoc formatter. Anything else that
 * divides by a byte radix must route its spelling through `formatByteQuantity`.
 */
const KEYED_UNIT_CALLERS = new Set([
	"features/agents/components/agent-avatar-field.tsx",
	"features/agents/utils/publication-failure.ts",
	"features/settings/components/notification-sound-list.tsx",
]);

test("no renderer file builds a unit-suffixed size by hand", () => {
	const offenders = [];
	for (const file of sourceFiles(RENDERER)) {
		const rel = relative(RENDERER, file);
		const code = codeOnly(readFileSync(file, "utf8"));
		if (/\}\s?(?:[KMGT]i?B)\b[`'"]/.test(code))
			offenders.push(`${rel}: template ends in a byte-unit symbol`);
		const radix =
			/\/\s*\(?\s*(?:1024\b|1\s*<<\s*(?:10|20|30))|\b1024\s*\*\*/.test(code);
		if (
			radix &&
			!KEYED_UNIT_CALLERS.has(rel) &&
			!/formatByteQuantity/.test(code)
		)
			offenders.push(
				`${rel}: divides by a byte radix without formatByteQuantity`,
			);
	}
	assert.deepEqual(
		offenders,
		[],
		"route file sizes through formatByteQuantity (src/i18n/format.ts): it owns digits, decimal mark and unit symbol per locale",
	);
});

test("the guard detects the shapes it exists for", () => {
	const bad = ["return `${(n / 1024).toFixed(1)} KB`;", "return `${x}MiB`;"];
	for (const line of bad) {
		const code = codeOnly(line);
		assert.ok(
			/\}\s?(?:[KMGT]i?B)\b[`'"]/.test(code) || /\/\s*\(?\s*1024\b/.test(code),
			line,
		);
	}
});
