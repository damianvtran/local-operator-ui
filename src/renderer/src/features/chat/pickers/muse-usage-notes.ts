/**
 * The backend's fixed Muse provenance vocabulary, as stable protocol values.
 *
 * `/v1/desktop/usage` does not forward arbitrary provider notes:
 * `local_operator/providers/usage.py` defines exactly these four strings and
 * the route filters `notes` down to them (`META_MUSE_USAGE_NOTES`). The UI
 * reads that field to decide whether a report is an ageable passive
 * observation, so the comparison must use the server's bytes — never
 * catalogue copy. A comparison against `t()` made the same payload resolve
 * differently per UI language: with `en` a 1h-old passive note aged to
 * unavailable, while `ru`/`es` left it available and lost the passive
 * provenance sentence entirely.
 *
 * Keep this module free of `t()` and of anything the catalogue generator
 * reads. Display copy for each note lives under
 * `ui.chat.pickers.usage_view_model.*` and is selected by
 * `museNoteText()` in `usage-view-model.ts`; this file is the WIRE vocabulary
 * only. Values must stay byte-identical to the Python constants —
 * `scripts/i18n/canvas-picker-review-remediation.test.mjs` pins them against
 * real payloads.
 */

/** `META_MUSE_ALLOWANCE_NOTE`: a sign-in allowance with no usable observation. */
export const META_MUSE_ALLOWANCE_NOTE =
	"Stale sign-in allowance; current usage unknown; refresh does not query Muse.";

/** `META_MUSE_PASSIVE_NOTE`: evidence from an ordinary serving reply. */
export const META_MUSE_PASSIVE_NOTE =
	"Last response allowance; refresh does not query Muse.";

/** `META_MUSE_STALE_NOTE`: the passive observation outlived its TTL. */
export const META_MUSE_STALE_NOTE =
	"Stale response allowance; current usage unknown; refresh does not query Muse.";

/** `META_MUSE_NO_OBSERVATION_NOTE`: passive provenance with no timestamp. */
export const META_MUSE_NO_OBSERVATION_NOTE =
	"No allowance observation recorded; refresh does not query Muse.";

export type MetaMuseUsageNote =
	| typeof META_MUSE_ALLOWANCE_NOTE
	| typeof META_MUSE_PASSIVE_NOTE
	| typeof META_MUSE_STALE_NOTE
	| typeof META_MUSE_NO_OBSERVATION_NOTE;

/** The exact set the Python route may emit (`META_MUSE_USAGE_NOTES`). */
export const META_MUSE_USAGE_NOTES: ReadonlySet<string> = new Set([
	META_MUSE_ALLOWANCE_NOTE,
	META_MUSE_PASSIVE_NOTE,
	META_MUSE_STALE_NOTE,
	META_MUSE_NO_OBSERVATION_NOTE,
]);

/**
 * Whether `note` is one of the server's fixed Muse provenance statements.
 *
 * A type predicate so callers can switch on the narrowed value without a
 * cast: the wire value is a closed union once this returns true.
 */
export const isMetaMuseUsageNote = (
	note: string | null | undefined,
): note is MetaMuseUsageNote =>
	typeof note === "string" && META_MUSE_USAGE_NOTES.has(note);
