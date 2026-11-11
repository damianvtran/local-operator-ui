/// <reference lib="es2021.intl" />
// `Intl.ListFormat` (see `formatList`) is es2021.intl; Electron 44 and the Node
// test runtime both provide it, so declare its types rather than widen the
// project-wide ES target (same precedent as `src/shared/team-bridge-notify.ts`).
/**
 * The Intl formatter layer: the one place UI code builds formatters.
 *
 * RFC §2.8: "one formatting layer per runtime: TS wraps `Intl`". The sites
 * this layer migrated constructed their formats inline — `toLocale*` calls
 * with `navigator.language`, or a pinned `new Intl.NumberFormat("en-US")` —
 * so locale selection lived in N call sites and could drift in each. They now
 * ask here, which puts locale choice in ONE place (the `./locale` store: the
 * backend's resolved language once it answers, the device before that) and
 * caches formatter instances per (locale, options).
 *
 * SCOPE, SAID OUT LOUD. `formatRelativeTime`, `formatDuration` and
 * `formatBytes` have no call sites yet (file sizes go through
 * `formatByteQuantity`, see below), and that is the plan rather than an
 * oversight: the remaining hand-rolled format sites in the product have
 * DELIBERATE per-site spellings ("2m ago", "1.5s", "1.2 MB" and friends, each
 * pinned by its own tests), and this PR may not change what any of them
 * print. Their extraction slices switch them onto these functions — the
 * functions exist so that switch is a call, not a rewrite, and so a NEW
 * hand-rolled formatter has nowhere to land. The scanner's baseline is what
 * keeps that promise honest.
 *
 * `formatDuration` and `formatBytes` mirror the core's implementations
 * (`local_operator/i18n/format.py::format_duration` / `format_bytes`)
 * deliberately: same zero-omission and decimal rules (duration unit letters
 * stay ASCII; byte symbols follow the locale, see the FILE-SIZE UNITS note),
 * localised digits via
 * `formatNumber`. When a locale wave reviews widths, one algorithm review
 * covers both runtimes.
 *
 * Every function resolves its locale from `./locale` unless the caller PINS
 * one; the pin exists for sites whose output is deliberately
 * locale-independent (an explicit tag keeps them byte-stable while still going
 * through the layer).
 */

import { currentLocale } from "./locale";

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();

/** Stable cache keys for option bags — called with literal objects in practice. */
function optionsKey(options: object | undefined): string {
	return options === undefined ? "" : JSON.stringify(options);
}

function dateFormatFor(
	locale: string,
	options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const cacheKey = `${locale}\u0000${optionsKey(options)}`;
	let format = dateFormats.get(cacheKey);
	if (format === undefined) {
		format = new Intl.DateTimeFormat(locale, options);
		dateFormats.set(cacheKey, format);
	}
	return format;
}

function numberFormatFor(
	locale: string,
	options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
	const cacheKey = `${locale}\u0000${optionsKey(options)}`;
	let format = numberFormats.get(cacheKey);
	if (format === undefined) {
		format = new Intl.NumberFormat(locale, options);
		numberFormats.set(cacheKey, format);
	}
	return format;
}

/**
 * A date, as `toLocaleDateString` spelled it — options pass straight through
 * to `Intl.DateTimeFormat` (call sites name their own components, which is
 * also what keeps the migrated output byte-identical: see
 * `scripts/i18n/format.test.mjs`).
 */
export function formatDate(
	date: Date | number,
	options?: Intl.DateTimeFormatOptions,
	locale?: string,
): string {
	return dateFormatFor(locale ?? currentLocale(), options).format(date);
}

/** The clock half — same pass-through; the name is the call site's intent. */
export function formatTime(
	date: Date | number,
	options?: Intl.DateTimeFormatOptions,
	locale?: string,
): string {
	return dateFormatFor(locale ?? currentLocale(), options).format(date);
}

/** A date and a clock reading in one string (the "last modified" shape). */
export function formatDateTime(
	date: Date | number,
	options?: Intl.DateTimeFormatOptions,
	locale?: string,
): string {
	return dateFormatFor(locale ?? currentLocale(), options).format(date);
}

/** A number. Defaults are `Intl`'s, so a bare call matches a bare `Intl`. */
export function formatNumber(
	value: number,
	options?: Intl.NumberFormatOptions,
	locale?: string,
): string {
	return numberFormatFor(locale ?? currentLocale(), options).format(value);
}

/**
 * `-3, "hour"` -> `"3 hours ago"`; `+3` -> `"in 3 hours"` (en).
 *
 * `numeric: "always"` is `Intl.RelativeTimeFormat`'s DEFAULT and it is also
 * the contract the core layer keeps ("no `yesterday` specials in v1") — pass
 * `{ numeric: "auto" }` in `options` to opt into the specials at a site that
 * wants them. Options are per-call, so the cache key includes them.
 */
export function formatRelativeTime(
	value: number,
	unit: Intl.RelativeTimeFormatUnit,
	options?: Intl.RelativeTimeFormatOptions,
	locale?: string,
): string {
	const tag = locale ?? currentLocale();
	const cacheKey = `${tag}\u0000${optionsKey(options)}`;
	let format = relativeFormats.get(cacheKey);
	if (format === undefined) {
		format = new Intl.RelativeTimeFormat(tag, options);
		relativeFormats.set(cacheKey, format);
	}
	return format.format(value, unit);
}

/**
 * A compact duration: `3725` -> `"1h 2m 5s"` (digits localised).
 *
 * Mirrors `local_operator/i18n/format.py::format_duration`: zero units are
 * omitted, zero and negative durations render `"0s"`, the unit letters stay
 * ASCII, and the digits format like every other number.
 */
export function formatDuration(seconds: number, locale?: string): string {
	const tag = locale ?? currentLocale();
	const total = Math.trunc(seconds);
	if (!Number.isFinite(total) || total <= 0) {
		return `${formatNumber(0, { maximumFractionDigits: 0 }, tag)}s`;
	}
	const units: ReadonlyArray<readonly [number, string]> = [
		[86_400, "d"],
		[3_600, "h"],
		[60, "m"],
		[1, "s"],
	];
	const parts: string[] = [];
	let remaining = total;
	for (const [size, suffix] of units) {
		const amount = Math.floor(remaining / size);
		remaining -= amount * size;
		if (amount > 0) {
			parts.push(
				`${formatNumber(amount, { maximumFractionDigits: 0 }, tag)}${suffix}`,
			);
		}
	}
	return parts.join(" ");
}

/**
 * FILE-SIZE UNITS: THE DECISION, WITH ITS SOURCES (i18n slice B4).
 *
 * Question: are `B / KB / MB / GB` language-neutral technical symbols that may
 * stay ASCII in every locale, or UI text that has to follow the language?
 *
 * What was already here. The first version of this layer (and the core's
 * `format_bytes` it mirrors) kept ASCII letters and treated them as "kept
 * English". That was a per-token call made before the French census, and it is
 * not a policy: nothing in `docs/I18N.md` lists unit symbols as exempt, and the
 * operator's acceptance for the programme is that NO English remains after
 * switching to `fr`. Seven further hand-rolled formatters (supplement, library,
 * project, tool-row, info panel, message-budget, browser transfer row) each
 * repeated the ASCII spelling and the ASCII decimal point.
 *
 * What the standards say. CLDR (ICU 78.3 / CLDR 48.0 in the Node 24 test
 * runtime, measured by running `Intl.NumberFormat` with `style: "unit"`) spells
 * the byte units per language: fr `o / ko / Mo / Go / To` (the established
 * French octet), ru `Б / кБ / МБ / ГБ / ТБ`, hi `बाइट` for the byte; es, zh-CN,
 * vi, ur and hi keep the Latin `kB / MB / GB` because their CLDR data carries
 * the international symbol. So the symbols are language-neutral in SOME
 * locales and genuinely localized in others: neither "always ASCII" nor
 * "always translate" is right, and CLDR is the authority that already decides
 * it per locale. This module therefore asks Intl and does not hold a table.
 *
 * Two deliberate exceptions, both documented because a reader will ask:
 * - English keeps ASCII `B / KB / MB / GB / TB`, not CLDR's `byte / kB`: that is
 *   the spelling the English product, its tests and the terminal UI print, and
 *   `kB` (SI, 1000) would mislabel the 1024-based callers.
 * - IEC `KiB / MiB / GiB` are ISO/IEC 80000-13 symbols, defined by an
 *   international standard rather than a language, and Intl has no unit for
 *   them. They stay as written in every locale (French `Kio/Mio` is a
 *   regional alternative of the same standard). Number formatting around
 *   them is still the locale's.
 *
 * Byte, specifically, is read from the NARROW style: the short style gives the
 * English word `byte` for en, ur and vi, which would put a lowercase English
 * noun in an Urdu interface, while narrow gives the symbol `B` everywhere the
 * locale has no native one.
 */
export type ByteUnit = "B" | "KB" | "MB" | "GB" | "TB" | "PB";
export type BinaryByteUnit = "KiB" | "MiB" | "GiB";
export type FileSizeUnit = ByteUnit | BinaryByteUnit;

const INTL_BYTE_UNIT: Readonly<Record<ByteUnit, string>> = {
	B: "byte",
	KB: "kilobyte",
	MB: "megabyte",
	GB: "gigabyte",
	TB: "terabyte",
	PB: "petabyte",
};

const sizeLabels = new Map<string, string>();
const sizeSeparators = new Map<string, string>();

/** `en`, `en-US`, `en-GB`: every English tag takes the product's ASCII spelling. */
function isEnglish(locale: string): boolean {
	return locale.split("-")[0]?.toLowerCase() === "en";
}

/**
 * The symbol for `unit` in `locale`. Resolved at call time (never cached on the
 * unit alone) because the active locale can change while the app is mounted.
 */
function fileSizeUnitLabel(unit: FileSizeUnit, locale: string): string {
	if (unit === "KiB" || unit === "MiB" || unit === "GiB") return unit;
	if (isEnglish(locale)) return unit;
	const cacheKey = `${locale}\u0000${unit}`;
	let label = sizeLabels.get(cacheKey);
	if (label === undefined) {
		label = unit;
		try {
			const parts = new Intl.NumberFormat(locale, {
				style: "unit",
				unit: INTL_BYTE_UNIT[unit],
				unitDisplay: "narrow",
			}).formatToParts(1);
			label = parts.find((part) => part.type === "unit")?.value ?? unit;
		} catch {
			// A runtime without this unit: the ASCII symbol is a readable answer.
		}
		sizeLabels.set(cacheKey, label);
	}
	return label;
}

/**
 * The glue between number and unit: the locale's own (French puts a narrow
 * no-break space there; most others a plain space). Read from the short-style
 * kilobyte pattern, which carries a literal in every locale tested.
 */
function fileSizeSeparator(locale: string): string {
	let separator = sizeSeparators.get(locale);
	if (separator === undefined) {
		separator = " ";
		try {
			const parts = new Intl.NumberFormat(locale, {
				style: "unit",
				unit: "kilobyte",
				unitDisplay: "short",
			}).formatToParts(1);
			separator = parts.find((part) => part.type === "literal")?.value ?? " ";
		} catch {
			// Keep the plain space.
		}
		sizeSeparators.set(locale, separator);
	}
	return separator;
}

/**
 * ONE byte-size spelling for the renderer: `(2.4, "MB", { maximumFractionDigits:
 * 1 })` -> `"2.4 MB"` (en), `"2,4 Mo"` (fr), `"2,4 МБ"` (ru).
 *
 * WHY THE CALLER PICKS THE UNIT. The product has several deliberately different
 * scales (SI 1000 for the message budgets, 1024 for file rows, MiB for the
 * transfer caps), each with its own rounding and each pinned by tests. Changing
 * a scale is a visible-number change outside this slice, so the SCALE and the
 * rounding stay with the call site and only the localized spelling (digits,
 * separators, unit symbol) is centralised here. A new `/ 1024` formatter has
 * nowhere to land: `scripts/i18n/file-size.test.mjs` fails on one.
 *
 * NO THOUSANDS GROUPING by default. The 1024 ladders legitimately print a
 * 1000-1023 operand before the next rung (`1008 B`, `1000 KB`, `1010 MB`), and
 * every hand-built formatter this helper replaced printed those bare, so
 * `Intl`'s default grouping would have turned English `1008 B` into `1,008 B`
 * (review round 1, M1). A size is also a value read at a glance beside others
 * in a column, where a group separator is noise. A caller that wants grouping
 * passes `useGrouping: true`.
 *
 * Callers that inject the result into running text through `t()` get RTL
 * isolation from `translate()`; a caller that paints it as JSX beside other
 * runs wraps it in `<bdi>` (see `finder-files-view.tsx`).
 */
export function formatByteQuantity(
	value: number,
	unit: FileSizeUnit,
	options?: {
		minimumFractionDigits?: number;
		maximumFractionDigits?: number;
		useGrouping?: boolean;
	},
	locale?: string,
): string {
	const tag = locale ?? currentLocale();
	const number = formatNumber(value, { useGrouping: false, ...options }, tag);
	return `${number}${fileSizeSeparator(tag)}${fileSizeUnitLabel(unit, tag)}`;
}

const SI_BYTE_LADDER: readonly ByteUnit[] = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * A byte size in SI units, base 1000: `1536` -> `"1.5 KB"`.
 *
 * Mirrors `local_operator/i18n/format.py::format_bytes` for the SCALE and
 * rounding: one decimal below 10 units (trailing zeros stripped by `Intl`
 * itself), whole numbers above, `"0 B"` for zero, and negatives clamp to zero
 * -- a size is never negative. The unit symbol is the locale's
 * (`formatByteQuantity`); the core's stays ASCII until its own locale pass.
 */
export function formatBytes(size: number, locale?: string): string {
	const tag = locale ?? currentLocale();
	let value = size;
	if (!Number.isFinite(value) || value < 0) value = 0;
	let unitIndex = 0;
	while (value >= 1000 && unitIndex < SI_BYTE_LADDER.length - 1) {
		value /= 1000;
		unitIndex += 1;
	}
	const digits = value < 10 ? 1 : 0;
	return formatByteQuantity(
		value,
		SI_BYTE_LADDER[unitIndex] ?? "B",
		// Grouped on purpose: this ladder's pre-helper output (`1,000 KB` for
		// 999_999 bytes, pinned in `format.test.mjs`) always grouped, and it is
		// the one size formatter that mirrors the core's table rather than a
		// hand-built renderer template.
		{ maximumFractionDigits: digits, useGrouping: true },
		tag,
	);
}

/**
 * A bare enumeration spelled with the locale's own separator: `["low",
 * "medium", "high"]` -> `"low, medium, high"` (en), `"低、中、高"` (zh-CN),
 * `"low، medium، high"` (ur).
 *
 * WHY THIS EXISTS. User-visible sentences that spliced a list in with
 * `items.join(", ")` rendered an ASCII comma and space in every language, so a
 * Chinese sentence read `此模型支持低, 中, 高。` (zh-CN audit of the composer
 * batch, `ui.chat.session_readout.effort.detail.offers`) and an Urdu one
 * carried a Latin comma. The separator is the locale's, not the catalogue's:
 * it belongs to the joiner, which only code can supply.
 *
 * WHY `conjunction` + `narrow`. The English sentences this replaced are bare
 * enumerations with no "and" ("It offers low, medium, high."), and this
 * output must stay byte-identical for them. Measured against Node's ICU:
 * `conjunction`/`narrow` is `"a, b, c"` in en (and fr, ru, vi, pt), `"a、b、c"`
 * in zh-CN/ja, `"a، b، c"` in ur; the `unit` types are NOT usable because ru
 * and zh-CN run the items together with no separator at all. Where CLDR
 * spells even the narrow list with a word (hi `और`, es `y`) the locale's own
 * conjunction is the grammatical form, and it is used.
 *
 * Items are passed through verbatim: a list of file names or command tokens is
 * still the caller's data. Fewer than two items need no separator.
 */
export function formatList(items: readonly string[], locale?: string): string {
	const tag = locale ?? currentLocale();
	let format = listFormats.get(tag);
	if (format === undefined) {
		format = new Intl.ListFormat(tag, {
			type: "conjunction",
			style: "narrow",
		});
		listFormats.set(tag, format);
	}
	return format.format(items);
}

/**
 * The clause separator of a sentence that strings whole clauses together
 * (`"a; b"`): ASCII `; ` for most languages, the full-width `；` for Chinese
 * (no following space) and the Arabic-script `؛ ` for Urdu.
 *
 * `Intl.ListFormat` has no semicolon form (it only spells item lists), so the
 * three spellings are held here, keyed by primary language, with the same
 * source as the comma in `formatList`: CLDR's punctuation for those scripts
 * (zh `；` U+FF1B, ur/ar `؛` U+061B). Clause text is the caller's own, already
 * localized sentence fragments (`ui.chat.attachment_refusal.*`).
 */
const CLAUSE_SEPARATORS: Readonly<Record<string, string>> = {
	zh: "\uFF1B",
	ja: "\uFF1B",
	ur: "\u061B ",
	ar: "\u061B ",
};

export function formatClauses(
	clauses: readonly string[],
	locale?: string,
): string {
	const language = (locale ?? currentLocale()).split("-")[0]?.toLowerCase();
	return clauses.join(CLAUSE_SEPARATORS[language ?? ""] ?? "; ");
}
