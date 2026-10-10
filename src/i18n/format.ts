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
 * `formatBytes` have no call sites yet, and that is the plan rather than an
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
 * deliberately: same unit letters (ASCII — the style guide's kept-English
 * list), same zero-omission and decimal rules, localised digits via
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

/** Byte-size units, base 1000 (SI) — ASCII identifiers, as in the core layer. */
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

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
 * A byte size in SI units, base 1000: `1536` -> `"1.5 KB"`.
 *
 * Mirrors `local_operator/i18n/format.py::format_bytes`: one decimal below 10
 * units (trailing zeros stripped by `Intl` itself), whole numbers above, `"0 B"`
 * for zero, and negatives clamp to zero — a size is never negative.
 */
export function formatBytes(size: number, locale?: string): string {
	const tag = locale ?? currentLocale();
	let value = size;
	if (!Number.isFinite(value) || value < 0) value = 0;
	let unitIndex = 0;
	while (value >= 1000 && unitIndex < BYTE_UNITS.length - 1) {
		value /= 1000;
		unitIndex += 1;
	}
	const digits = value < 10 ? 1 : 0;
	return `${formatNumber(value, { maximumFractionDigits: digits }, tag)} ${
		BYTE_UNITS[unitIndex]
	}`;
}
