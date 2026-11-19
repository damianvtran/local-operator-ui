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
			'export { attachmentSizeLabel } from "./src/renderer/src/features/chat/components/attachment-file-card";',
			'export { commandBudgetRefusal, systemPromptBudgetRefusal } from "./src/renderer/src/features/chat/utils/message-budget";',
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
	// Ungrouped by default (a size never carried a group separator in English),
	// grouped on request.
	assert.equal(q("en"), "1234.5 MiB");
	assert.equal(q("fr"), `1234,5${NNBSP}MiB`);
	assert.equal(q("ru"), "1234,5 MiB");
	assert.equal(q("ur"), "1234.5 MiB");
	const grouped = (tag) =>
		m.format.formatByteQuantity(
			1234.5,
			"MiB",
			{ maximumFractionDigits: 1, useGrouping: true },
			tag,
		);
	assert.equal(grouped("en"), "1,234.5 MiB");
	assert.equal(grouped("fr"), `1${NNBSP}234,5${NNBSP}MiB`);
	assert.equal(grouped("ru"), `1${NBSP}234,5 MiB`);
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

test("English never groups thousands: the 1000-1023 operands print bare, as before the helper", () => {
	// Review M1 / design D2 / QA Q3. Every 1024 ladder reaches a 1000-1023
	// operand before its next rung, and the hand-built formatters printed it
	// bare; `Intl`'s default grouping had made it `1,008 B`.
	const MiB = 1024 ** 2;
	const rows = [
		["library 1008 B", () => m.libraryBytes(1008), "1008 B"],
		["library 1000 KB", () => m.libraryBytes(1000 * 1024), "1000 KB"],
		["library 1010 MB", () => m.libraryBytes(1010 * MiB), "1010 MB"],
		["canvas row 1008 B", () => m.fileSizeText(1008), "1008 B"],
		["canvas row 1000 KB", () => m.fileSizeText(1000 * 1024), "1000 KB"],
		["canvas row 1010 MB", () => m.fileSizeText(1010 * MiB), "1010 MB"],
		["project 1008 B", () => m.attachmentSizeText(1008), "1008 B"],
		["project 1000.0 KB", () => m.attachmentSizeText(1000 * 1024), "1000.0 KB"],
		["project 1010.0 MB", () => m.attachmentSizeText(1010 * MiB), "1010.0 MB"],
		["tool trace 1008 B", () => m.traceBytes(1008), "1008 B"],
		["tool trace 1000.0 KB", () => m.traceBytes(1000 * 1024), "1000.0 KB"],
		["info panel 1010 MB", () => m.panelBytes(1010 * MiB), "1010 MB"],
		["info panel 1000 MB", () => m.panelBytes(1000 * MiB), "1000 MB"],
		[
			"SI ladder 2588.3 GB",
			() => m.formatByteSize(2_588_300_000_000),
			"2588.3 GB",
		],
	];
	for (const [name, call, expected] of rows)
		assert.equal(inLocale("en", call), expected, name);
	// fr keeps the same bare digits, with the locale's decimal mark and glue.
	assert.equal(
		inLocale("fr", () => m.libraryBytes(1008)),
		`1008${NNBSP}o`,
	);
});

test("formatByteSize stays byte-identical to the toFixed ladder it replaced (ties, -0)", () => {
	// Review m1 / m2: `Intl` rounds an exact tie half-expand where `toFixed(1)`
	// rounded the binary double, and prints the sign of negative zero.
	const cases = [
		[1_450_000, "1.4 MB"],
		[1_150_000, "1.1 MB"],
		[1_650_000, "1.6 MB"],
		[1_950_000, "1.9 MB"],
		[2_050_000, "2.0 MB"],
		[-5, "0 KB"],
		[0, "0 KB"],
	];
	for (const [bytes, expected] of cases)
		assert.equal(
			inLocale("en", () => m.formatByteSize(bytes)),
			expected,
			String(bytes),
		);
});

test("the attachment size label localizes the sub-kilobyte rung too (design D1)", () => {
	// Feeds the composer chip, the canvas Attachments list and Team Bridge file
	// cards; `92 B` beside `4 ko` was English in the middle of a French row.
	const rows = [
		[0, "0 B", `0${NNBSP}o`, "0 Б"],
		[92, "92 B", `92${NNBSP}o`, "92 Б"],
		[999, "999 B", `999${NNBSP}o`, "999 Б"],
		[1000, "1 KB", `1${NNBSP}ko`, "1 кБ"],
		[2_500_000, "2.5 MB", `2,5${NNBSP}Mo`, "2,5 МБ"],
	];
	for (const [bytes, en, fr, ru] of rows) {
		assert.equal(
			inLocale("en", () => m.attachmentSizeLabel(bytes)),
			en,
		);
		assert.equal(
			inLocale("fr", () => m.attachmentSizeLabel(bytes)),
			fr,
		);
		assert.equal(
			inLocale("ru", () => m.attachmentSizeLabel(bytes)),
			ru,
		);
	}
	assert.equal(m.attachmentSizeLabel(null), null);
	assert.equal(m.attachmentSizeLabel(-1), null);
});

test("the message-budget refusal picks its rung from the number, in every locale (review M2 / QA Q1)", () => {
	// 200,000 SOH characters serialise to 6 bytes each (1.2 MB), so the command
	// and system-prompt budgets sit in the window where both operands round to
	// the same one-decimal size and the pair escalates precision.
	const soh = "\u0001".repeat(200_000);
	const cmd = (tag, budget) =>
		inLocale(tag, () => m.commandBudgetRefusal("x", soh, budget));
	const en = cmd("en", 1_190_000);
	assert.match(en, /1\.20 MB.*1\.19 MB/, en);
	assert.doesNotMatch(en, /KB/);
	const fr = cmd("fr", 1_190_000);
	assert.match(
		fr,
		new RegExp(`1${NNBSP}?200,\\d+${NNBSP}Mo|1,20${NNBSP}Mo`),
		fr,
	);
	assert.doesNotMatch(fr, /\bKB\b|\bMB\b|\bko\b/, fr);
	assert.match(fr, new RegExp(`1,19${NNBSP}Mo`), fr);
	const ru = cmd("ru", 1_190_000);
	assert.match(ru, /1,20 МБ/, ru);
	assert.match(ru, /1,19 МБ/, ru);
	assert.doesNotMatch(ru, /\bKB\b|\bMB\b|кБ/, ru);

	// The KB rung (budget 149,950; total ~150,0xx): the unit is the locale's.
	const small = "\u0001".repeat(25_000);
	const frKb = inLocale("fr", () =>
		m.commandBudgetRefusal("x", small, 149_950),
	);
	assert.match(frKb, new RegExp(`${NNBSP}ko`), frKb);
	assert.doesNotMatch(frKb, /\bKB\b/, frKb);
	const ruKb = inLocale("ru", () =>
		m.commandBudgetRefusal("x", small, 149_950),
	);
	assert.match(ruKb, / кБ/, ruKb);
	assert.doesNotMatch(ruKb, /\bKB\b/, ruKb);

	// The system-prompt escalation window from QA: 185,000 NULs, budget 1.1 MB.
	const nul = "\u0000".repeat(185_000);
	const sys = (tag) => inLocale(tag, () => m.systemPromptBudgetRefusal(nul));
	assert.match(sys("en"), /1\.11 MB.*1\.10 MB/);
	assert.match(sys("fr"), new RegExp(`1,11${NNBSP}Mo.*1,10${NNBSP}Mo`));
	assert.match(sys("ru"), /1,11 МБ.*1,10 МБ/);
	for (const tag of ["fr", "ru"])
		assert.doesNotMatch(sys(tag), /\bKB\b|\bMB\b/, tag);
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

/*
 * Template shapes that hand-build a byte size. The first two were the original
 * guard; the others close the blind spots found in review (M2/M3, D1): a bare
 * `B` (`${bytes} B`), a template whose unit is a variable (`${n} ${unit}`), and
 * a unit decided by reading the formatted text (`base.endsWith("MB")`), which
 * breaks as soon as the text is localized.
 */
const HAND_BUILT_SIZE = [
	// A bare `B` needs the space (`${bytes} B`): `${n}B` is the parameter-count
	// suffix of `1.5B` in the model picker, which is not a byte size.
	[/\}(?:\s?[KMGT]i?B|\sB)\b[`'"]/, "template ends in a byte-unit symbol"],
	[
		/\$\{[^}]*\}\s\$\{\s*unit\s*\}/,
		"template appends a byte unit held in a variable",
	],
	[
		/\.endsWith\(\s*["'](?:[KMGT]i?B)["']\s*\)/,
		"unit decided from formatted text",
	],
];

function handBuiltSize(code) {
	return HAND_BUILT_SIZE.filter(([re]) => re.test(code)).map(([, why]) => why);
}

test("no renderer file builds a unit-suffixed size by hand", () => {
	const offenders = [];
	for (const file of sourceFiles(RENDERER)) {
		const rel = relative(RENDERER, file);
		const code = codeOnly(readFileSync(file, "utf8"));
		for (const why of handBuiltSize(code)) offenders.push(`${rel}: ${why}`);
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
	const bad = [
		"return `${(n / 1024).toFixed(1)} KB`;",
		"return `${x}MiB`;",
		"return bytes < 1000 ? `${bytes} B` : other(bytes);",
		"return [`${totalText} ${unit}`, `${budgetText} ${unit}`];",
		'const inMb = base.endsWith("MB");',
	];
	for (const line of bad) {
		const code = codeOnly(line);
		assert.ok(
			handBuiltSize(code).length > 0 || /\/\s*\(?\s*1024\b/.test(code),
			line,
		);
	}
	// And it leaves the legitimate spelling alone.
	assert.deepEqual(
		handBuiltSize('return formatByteQuantity(bytes, "B", { x: 1 });'),
		[],
	);
});
