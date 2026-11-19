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
 * SCOPE, SAID OUT LOUD. `formatRelativeTime` and
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
 * deliberately: same zero-omission and decimal rules (duration units and
 * byte symbols follow the locale, see the DURATIONS and FILE-SIZE UNITS notes),
 * localised digits via
 * `formatNumber`. When a locale wave reviews widths, one algorithm review
 * covers both runtimes.
 *
 * Every function resolves its locale from `./locale` unless the caller PINS
 * one; the pin exists for sites whose output is deliberately
 * locale-independent (an explicit tag keeps them byte-stable while still going
 * through the layer).
 */

import type { MessageKey } from "./keys.gen";
import { currentLocale } from "./locale";
import { translate } from "./messages";

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

/**
 * The components `Date.prototype.toLocaleString()` printed with no arguments:
 * numeric date plus a clock with seconds (`11/5/2026, 3:42:01 PM` in en-US).
 *
 * WHY A NAMED BAG. Several sites (session picker rows, the update notice's
 * "Detected ...", the main process's "Install started ...") wrote a bare
 * `toLocaleString()`, which reads the OPERATING SYSTEM's region rather than the
 * language the user chose. Passing this bag to `formatDateTime` keeps the same
 * components (so English is byte-identical) while the locale becomes the live
 * UI one. Pinned against the bare call in `scripts/i18n/s16d-live-locale.test.mjs`.
 */
export const FULL_NUMERIC_STAMP: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "numeric",
	day: "numeric",
	hour: "numeric",
	minute: "numeric",
	second: "numeric",
};

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
 * A money amount: `5.09` -> `"$5.09"` (fr `"5,09 $US"`, hi `"US$5.09"`).
 *
 * WHY CURRENCY AND NOT A NUMBER WITH A SIGN GLUED ON. The amounts this app prints
 * are the remote-compute HOLD and CHARGE the server reports, both in USD - and a
 * symbol concatenated in JSX puts the symbol in the wrong place, keeps a `.` decimal
 * separator in every locale, and formats digits in the wrong script. `Intl` under
 * the resolved locale is the only one of those that is true everywhere.
 *
 * WHY THE AMOUNT IS PASSED IN RATHER THAN DERIVED: the rates are the deployment's
 * own configuration and the API publishes none (capacity carries no pricing today),
 * so nothing in this layer may compute what a run costs - it prints what the server
 * stated. A caller with no stated amount prints nothing, never `$0.00`.
 */
export function formatUsd(amount: number, locale?: string): string {
	return numberFormatFor(locale ?? currentLocale(), {
		style: "currency",
		currency: "USD",
	}).format(amount);
}

/**
 * DURATIONS: ONE LAYER, FOUR SHAPES (i18n slice C3).
 *
 * Before this slice the product spelled durations in five places — this
 * module's `formatDuration`, the tool row's running and settled clocks, the
 * session strip's active time, the run-detail child clock and the wake
 * cadence — each gluing ASCII `s / m / h / d` to a number, so a French or
 * Urdu interface read `1h5m`. They now all build their strings here.
 *
 * WHERE THE UNIT WORDS COME FROM. `Intl.NumberFormat` with `style: "unit"` and
 * `unitDisplay: "narrow"` (CLDR's narrow unit patterns), not catalogue keys:
 * CLDR already decides per language whether the unit is a letter, a word or a
 * symbol, and where the space goes (fr `5min`, ru `5 мин`, zh-CN `5分钟`,
 * ur `5 منٹ`). Measured on Node 24 / ICU 78.3, ENGLISH narrow output is
 * exactly the product's existing ASCII spelling — `5ms`, `5s`, `5m`, `5h`,
 * `5d`, `5w`, no space — so every English string the tests pin stays
 * byte-identical with no English special case for single units.
 *
 * COMPOUND VALUES (`1h 5m`, `1m5s`). Non-English locales go through
 * `Intl.DurationFormat` (narrow), which owns the locale's joiner and unit
 * agreement (ur `1 گھنٹہ اور 5 منٹ`, zh-CN `1小时5分钟`); it ships in the
 * renderer's Chromium (Electron 45) and the Node test runtime, and a runtime
 * without it falls back to joining the narrow pieces with the locale's
 * `unit`-type list. ENGLISH joins its own pieces instead: the compact shape
 * (`1m5s`, the TUI-parity clocks bounded at six cells) has no space at all,
 * which no CLDR pattern spells, and the spaced shape (`1h 2m 5s`) is what
 * `DurationFormat`'s English narrow output is anyway, so joining keeps both
 * byte-identical without depending on that coincidence.
 *
 * The two sentinel shapes that are not a number and a unit — `<0.1s` (too fast
 * to measure) and `100d+` (the width cap) — are keyed `ui.common.time.duration.*`
 * messages whose placeholder is the Intl-formatted quantity, so the translator
 * places the comparison mark and CLDR still spells the unit.
 *
 * Every function resolves the locale at CALL time (never at module load), so a
 * live language switch re-spells the next render.
 */
export type DurationUnit =
	| "week"
	| "day"
	| "hour"
	| "minute"
	| "second"
	| "millisecond";

/** One term of a compound duration: an amount (integral unless alone) and its unit. */
export type DurationPart = readonly [amount: number, unit: DurationUnit];

/**
 * `Intl.DurationFormat`'s shape, declared locally: the renderer's TS lib is
 * ES2020 and the constructor is ES2025, so it is feature-detected at runtime
 * rather than typed through a project-wide lib bump (same precedent as the
 * es2021.intl reference at the top of this file).
 */
type DurationFormatLike = { format(duration: Record<string, number>): string };
type DurationFormatCtor = new (
	locale: string,
	options: { style: "narrow" },
) => DurationFormatLike;

const DURATION_FIELD: Readonly<Record<DurationUnit, string>> = {
	week: "weeks",
	day: "days",
	hour: "hours",
	minute: "minutes",
	second: "seconds",
	millisecond: "milliseconds",
};

const durationFormats = new Map<string, DurationFormatLike | null>();

function durationFormatFor(locale: string): DurationFormatLike | null {
	let format = durationFormats.get(locale);
	if (format === undefined) {
		const Ctor = (Intl as unknown as { DurationFormat?: DurationFormatCtor })
			.DurationFormat;
		format = null;
		if (Ctor !== undefined) {
			try {
				format = new Ctor(locale, { style: "narrow" });
			} catch {
				format = null;
			}
		}
		durationFormats.set(locale, format);
	}
	return format;
}

/**
 * One amount in one unit, CLDR-narrow: `5s`, `1.5s`, `5min` (fr), `5 с` (ru).
 *
 * `fractionDigits` is FIXED (minimum = maximum), so `2.0s` stays `2.0s`. The
 * caller rounds first if it needs a particular rounding: Intl rounds the
 * decimal value half-expand, which differs from `toFixed`'s binary rounding
 * (9.95 is `10.0` in Intl and `9.9` via `toFixed`, measured).
 */
export function formatDurationUnit(
	amount: number,
	unit: DurationUnit,
	fractionDigits = 0,
	locale?: string,
): string {
	return formatNumber(
		amount,
		{
			style: "unit",
			unit,
			unitDisplay: "narrow",
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		},
		locale ?? currentLocale(),
	);
}

/**
 * A compound duration from its terms, largest first. `compact` is the
 * no-space English shape (`1m5s`) the bounded clocks use; it changes nothing
 * outside English, where the locale's own duration pattern decides.
 */
export function formatDurationParts(
	parts: readonly DurationPart[],
	options: { compact?: boolean } = {},
	locale?: string,
): string {
	const tag = locale ?? currentLocale();
	if (parts.length === 0) return formatDurationUnit(0, "second", 0, tag);
	if (parts.length === 1) {
		const [amount, unit] = parts[0];
		return formatDurationUnit(amount, unit, 0, tag);
	}
	const pieces = parts.map(([amount, unit]) =>
		formatDurationUnit(amount, unit, 0, tag),
	);
	if (isEnglish(tag)) return pieces.join(options.compact ? "" : " ");
	const format = durationFormatFor(tag);
	if (format !== null) {
		const value: Record<string, number> = {};
		for (const [amount, unit] of parts) value[DURATION_FIELD[unit]] = amount;
		try {
			return format.format(value);
		} catch {
			// A value DurationFormat refuses (a non-integer term) falls through.
		}
	}
	let list = unitLists.get(tag);
	if (list === undefined) {
		list = new Intl.ListFormat(tag, { type: "unit", style: "narrow" });
		unitLists.set(tag, list);
	}
	return list.format(pieces);
}

const unitLists = new Map<string, Intl.ListFormat>();

/**
 * Every non-zero term, spaced: `3725` -> `"1h 2m 5s"` (en).
 *
 * Mirrors `local_operator/i18n/format.py::format_duration`: zero units are
 * omitted, and zero and negative durations render the locale's `0s`.
 */
export function formatDuration(seconds: number, locale?: string): string {
	const tag = locale ?? currentLocale();
	const total = Math.trunc(seconds);
	if (!Number.isFinite(total) || total <= 0) {
		return formatDurationUnit(0, "second", 0, tag);
	}
	const units: ReadonlyArray<readonly [number, DurationUnit]> = [
		[86_400, "day"],
		[3_600, "hour"],
		[60, "minute"],
		[1, "second"],
	];
	const parts: DurationPart[] = [];
	let remaining = total;
	for (const [size, unit] of units) {
		const amount = Math.floor(remaining / size);
		remaining -= amount * size;
		if (amount > 0) parts.push([amount, unit]);
	}
	return formatDurationParts(parts, {}, tag);
}

/** The width cap of `formatCompactDuration`, in days. */
const COMPACT_DAY_CAP = 99;

/**
 * Integer seconds as AT MOST two terms, compact: `9s`, `41m1s`, `1h2m`,
 * `4d5h`, and `100d+` from a hundred days (en).
 *
 * The TUI's `tool_card.py::format_duration`, ported once for the four
 * desktop clocks that used to carry their own copies (tool row, session
 * strip, run-detail child clock). Bounded at six cells in English over the
 * whole domain — the property those sites' docblocks rely on — by dropping
 * the smaller term once it stops carrying information and by capping days.
 * Other locales are as wide as CLDR spells them; truncation, not this
 * function, was never the answer (a clipped duration is unreadable).
 * Negative, non-finite and sub-second inputs render `0s`.
 */
export function formatCompactDuration(
	seconds: number,
	locale?: string,
): string {
	const tag = locale ?? currentLocale();
	const total = Math.floor(
		Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
	);
	const pair = (
		big: number,
		bigUnit: DurationUnit,
		small: number,
		smallUnit: DurationUnit,
	): string =>
		formatDurationParts(
			small === 0
				? [[big, bigUnit]]
				: [
						[big, bigUnit],
						[small, smallUnit],
					],
			{ compact: true },
			tag,
		);
	if (total < 60) return formatDurationUnit(total, "second", 0, tag);
	if (total < 3600) {
		return pair(Math.floor(total / 60), "minute", total % 60, "second");
	}
	if (total < 86_400) {
		return pair(
			Math.floor(total / 3600),
			"hour",
			Math.floor((total % 3600) / 60),
			"minute",
		);
	}
	const days = Math.floor(total / 86_400);
	if (days > COMPACT_DAY_CAP) {
		return translate(
			"ui.common.time.duration.over_cap" satisfies MessageKey,
			{ duration: formatDurationUnit(COMPACT_DAY_CAP + 1, "day", 0, tag) },
			tag,
		);
	}
	return pair(days, "day", Math.floor((total % 86_400) / 3600), "hour");
}

/**
 * A SETTLED call's duration: `<0.1s`, `1.5s` (one decimal under ten seconds),
 * `42s`, then `formatCompactDuration` from a minute.
 *
 * The tool row's `_outcome_runs` (tool_card.py:2376-2396). The tenth is rounded
 * with `toFixed` BEFORE Intl sees it, so the digit is the one the TUI's
 * `f"{x:.1f}"` and the previous `toFixed` port printed (see
 * `formatDurationUnit` on why Intl's own rounding differs at 9.95).
 */
export function formatSettledDuration(
	seconds: number,
	locale?: string,
): string {
	const tag = locale ?? currentLocale();
	const elapsed = Math.max(0, seconds);
	if (elapsed < 0.05) {
		return translate(
			"ui.common.time.duration.under_minimum" satisfies MessageKey,
			{ duration: formatDurationUnit(0.1, "second", 1, tag) },
			tag,
		);
	}
	if (elapsed < 10) {
		return formatDurationUnit(Number(elapsed.toFixed(1)), "second", 1, tag);
	}
	if (elapsed < 60)
		return formatDurationUnit(Math.round(elapsed), "second", 0, tag);
	return formatCompactDuration(elapsed, tag);
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
