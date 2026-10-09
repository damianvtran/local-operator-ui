/**
 * The duration model behind the delegated-work retention control.
 *
 * WHY THIS IS ITS OWN MODULE. The control has three jobs that a bare number
 * field cannot do and a React component should not own: turn a stored number of
 * HOURS into words a person reads ("48 hours", "7 days", "1 month"), turn what a
 * person typed (a count plus a unit) back into hours, and decide whether a value
 * may be sent at all. All three are pure, so they are testable without a DOM
 * (`scripts/retention-duration.test.mjs`) and the component, the draft layer and
 * the tests cannot disagree about what "valid" means.
 *
 * THE STORED UNIT IS ALWAYS HOURS. `session.cleanup.delegated.max_age_hours` is
 * an integer number of hours on the wire and in `config.yml`; a control that
 * shows "7 days" still writes 168 (`SettingView.unit` documents the same
 * contract on the server). Nothing in this file ever produces a day count that
 * leaves the module: days exist only as a display and entry convenience.
 *
 * THE RANGE COMES FROM THE REGISTRY, NOT FROM HERE. `durationSpec` reads
 * `minimum`/`maximum` off the row the server sent (2 and 720 today), so a
 * server that widens the window widens the control without a UI release. The
 * `FALLBACK_*` constants below are a second copy of those two numbers and exist
 * for exactly one case: a row whose bounds are missing from the wire. Do not
 * read them anywhere else.
 *
 * WHY A STEPPED CONTROL. The window is a policy choice with a handful of
 * meaningful answers (a day, two days, a week, a month), and the range spans
 * 2 to 720, a factor of 360. A slider over that range is either log-scaled
 * (nobody can say where 48 is) or linear (2 through 24 occupy 3% of the
 * track). Named stops make the common answers one click and the default
 * visible; the exact-entry field next to them is what keeps every integer in
 * the range reachable.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";

/** The key of the age row this control edits. */
export const DELEGATED_MAX_AGE_KEY = "session.cleanup.delegated.max_age_hours";

/** The key of the master switch that gates the age row. */
export const DELEGATED_ENABLED_KEY = "session.cleanup.delegated.enabled";

/** The registry section the two delegated rows live in. */
export const DELEGATED_SECTION = "session_delegated";

/** Fallback bounds, used ONLY when the wire row carries none (see the header). */
const FALLBACK_MIN_HOURS = 2;
const FALLBACK_MAX_HOURS = 720;

const HOURS_PER_DAY = 24;
/** 30 days: what the registry means by "1 month". */
const HOURS_PER_MONTH = 30 * HOURS_PER_DAY;
/** From here up, whole days read better than hours ("3 days", not "72 hours"). */
const DAYS_FROM_HOURS = 72;

/**
 * Whole-number TEXT: digits and nothing else.
 *
 * The one spelling of "this text is a whole number" - `entryToDraft` passes
 * anything else through verbatim so validation can refuse it, `validateHours`
 * refuses it by name, and the control's entry split reads the same rule - so
 * the three cannot drift. Top-level for `lint/performance/useTopLevelRegex`.
 */
export const WHOLE_NUMBER_TEXT = /^\d+$/;

/**
 * The named stops, in hours: 2h, 6h, 12h, 24h, 48h (the default), 3d, 7d, 14d,
 * 30d. Clipped to the registry's range by `durationSpec`, so a stop outside it
 * is simply not offered.
 */
export const RETENTION_STOPS_HOURS: readonly number[] = [
	2, 6, 12, 24, 48, 72, 168, 336, 720,
];

export type DurationUnit = "hours" | "days";

export type DurationSpec = {
	min: number;
	max: number;
	/** The stops inside `[min, max]`, ascending. */
	stops: number[];
	/** The registry's default, when the row carries a numeric one. */
	defaultHours: number | null;
};

/**
 * The spec for a row, or `null` when the row is not a duration this control
 * understands.
 *
 * KEYED, not inferred from `unit`: other integer rows count hours too
 * (`runtime.unattended_gate_timeout` is "(h)", with 0 meaning "never"), and a
 * stepped control with no 0 stop would silently remove their meaning. The
 * `unit` field is still honoured as a guard: a future server that re-denominates
 * this key (say to minutes) must not have its value read as hours.
 */
export function durationSpec(
	setting: Pick<
		BackendSetting,
		"key" | "kind" | "minimum" | "maximum" | "default"
	> &
		Partial<Pick<BackendSetting, "unit">>,
): DurationSpec | null {
	if (setting.key !== DELEGATED_MAX_AGE_KEY || setting.kind !== "int") {
		return null;
	}
	if (setting.unit && setting.unit !== "hours") return null;
	const min = setting.minimum ?? FALLBACK_MIN_HOURS;
	const max = setting.maximum ?? FALLBACK_MAX_HOURS;
	return {
		min,
		max,
		stops: RETENTION_STOPS_HOURS.filter(
			(hours) => hours >= min && hours <= max,
		),
		defaultHours:
			typeof setting.default === "number" && Number.isInteger(setting.default)
				? setting.default
				: null,
	};
}

const plural = (count: number, one: string, many: string) =>
	`${count} ${count === 1 ? one : many}`;

/**
 * Hours as words: "6 hours", "48 hours", "3 days", "100 hours", "1 month".
 *
 * Under three days the number stays in hours, because "48 hours" is how the
 * default is described everywhere else and "2 days" for the same value would
 * read as a different setting. A value that is not a whole number of days (100
 * hours) stays in hours rather than being rounded: the label must never name a
 * time the setting is not.
 */
export function formatHours(hours: number): string {
	if (hours > 0 && hours % HOURS_PER_MONTH === 0) {
		return plural(hours / HOURS_PER_MONTH, "month", "months");
	}
	if (hours >= DAYS_FROM_HOURS && hours % HOURS_PER_DAY === 0) {
		return plural(hours / HOURS_PER_DAY, "day", "days");
	}
	return plural(hours, "hour", "hours");
}

/** The compact stop label: "6h", "48h", "3d", "30d". */
export function shortLabel(hours: number): string {
	if (hours >= DAYS_FROM_HOURS && hours % HOURS_PER_DAY === 0) {
		return `${hours / HOURS_PER_DAY}d`;
	}
	return `${hours}h`;
}

/** The count and unit the exact-entry field shows for a stored value. */
export function splitEntry(hours: number): {
	text: string;
	unit: DurationUnit;
} {
	if (hours >= DAYS_FROM_HOURS && hours % HOURS_PER_DAY === 0) {
		return { text: String(hours / HOURS_PER_DAY), unit: "days" };
	}
	return { text: String(hours), unit: "hours" };
}

/**
 * What the exact-entry field becomes in the draft.
 *
 * A whole number converts to the hours string the draft (and the wire) carry.
 * Anything else is passed through VERBATIM, on purpose: the draft must stay
 * dirty and must stay wrong, so `validateHours` can refuse it where it is
 * saved rather than this function inventing a number for text that is not one
 * (`"2.5"` must not quietly become 2).
 */
export function entryToDraft(entry: {
	text: string;
	unit: DurationUnit;
}): string {
	const text = entry.text.trim();
	if (!WHOLE_NUMBER_TEXT.test(text)) return text;
	return String(Number(text) * (entry.unit === "days" ? HOURS_PER_DAY : 1));
}

export type DurationVerdict =
	| { ok: true; hours: number }
	| {
			ok: false;
			/** A plain-language sentence, shown beside the field. */
			error: string;
			/** The nearest allowed value, when the text was a number out of range. */
			nearest: number | null;
	  };

/** "between 2 hours and 1 month (30 days)", from the spec's own bounds. */
export function rangeSentence(spec: Pick<DurationSpec, "min" | "max">): string {
	const upper =
		spec.max % HOURS_PER_MONTH === 0
			? `${formatHours(spec.max)} (${spec.max / HOURS_PER_DAY} days)`
			: formatHours(spec.max);
	return `between ${formatHours(spec.min)} and ${upper}`;
}

/** Clamp a number of hours into the spec's range. */
export function clampHours(
	hours: number,
	spec: Pick<DurationSpec, "min" | "max">,
): number {
	return Math.min(spec.max, Math.max(spec.min, hours));
}

/**
 * Whether a draft string may be sent, as a value rather than a throw.
 *
 * STRICT on purpose: `Number.parseInt("12abc")` is 12, which is how a typo
 * becomes a saved setting. Only digits pass. This is the one place the range is
 * enforced client-side, and it is called from the control (for the live message)
 * AND from `editOutcome` (the single place a wire request is built), so an
 * out-of-range value cannot be sent by any path - Save, Save all or Retry.
 *
 * The server still validates ("max_age_hours must be between 2 and 720 (30
 * days); got N") and its sentence is shown if it ever disagrees; this layer
 * exists so that disagreement is a bug report, not an everyday refusal.
 */
export function validateHours(
	draft: string,
	spec: Pick<DurationSpec, "min" | "max">,
): DurationVerdict {
	const text = draft.trim();
	if (!WHOLE_NUMBER_TEXT.test(text)) {
		return {
			ok: false,
			error: "Enter a whole number of hours or days.",
			nearest: null,
		};
	}
	const hours = Number(text);
	if (hours < spec.min || hours > spec.max) {
		const tooLong = hours > spec.max;
		return {
			ok: false,
			error: `${formatHours(hours)} is too ${tooLong ? "long" : "short"}. Choose a time ${rangeSentence(spec)}.`,
			nearest: clampHours(hours, spec),
		};
	}
	return { ok: true, hours };
}
