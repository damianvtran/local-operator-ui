/**
 * The desktop's own words for the rows whose registry copy is written for the
 * terminal.
 *
 * WHY THIS EXISTS. The registry authors one label and one help sentence per row
 * and both surfaces paint them. The terminal's are terse and carry its own
 * idioms: a `↳` marks a child row there, and the age row's label ends in "(hours)"
 * because a bare number field needs the unit spelled out. On this page the age
 * row is a stepped control that says "7 days", so a label ending in "(hours)"
 * would be wrong beside it, and "Delegated cleanup" does not say what the switch
 * DOES. These rows are the only ones overridden; every other row paints the
 * registry's copy untouched, and an override changes presentation only - the
 * key, the value and every write are the registry's.
 *
 * Keyed by registry key, so a rename on the server makes the override stop
 * applying (the row falls back to the registry's own words) instead of
 * attaching our copy to the wrong row. `scripts/retention-duration.test.mjs`'s
 * "copy overrides name real keys" arm asserts every key named here is one the
 * fixture's rows carry.
 *
 * THE HELP SENTENCES CARRY THE WORDS A READER SEARCHES FOR ("retention",
 * "subagent", "delegated"): search matches label, help, key and section NAME, not
 * the section's title, so a row that never says "subagent" is unreachable by it.
 * `scripts/retention-duration.test.mjs` pins the three queries.
 *
 * `gateLabel` is the phrase the gated child's note uses for this switch ("Needs
 * automatic removal on."): the row label is a full sentence-case action and
 * reads badly inside "Needs ... on".
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import {
	DELEGATED_ENABLED_KEY,
	DELEGATED_MAX_AGE_KEY,
} from "./retention-duration";

type RowCopy = {
	label: string;
	help: string;
	/** What a gated child's note calls this switch; defaults to the label. */
	gateLabel?: string;
};

export const ROW_COPY: Record<string, RowCopy> = {
	[DELEGATED_ENABLED_KEY]: {
		label: "Remove delegated sessions automatically",
		help: "Applies to subagent runs, agent shells and background runs only.",
		gateLabel: "automatic removal",
	},
	[DELEGATED_MAX_AGE_KEY]: {
		label: "Remove after",
		help: "The retention window: how long a delegated session (a subagent or background run) can sit idle before it is removed.",
	},
};

/**
 * Section titles the desktop spells out in full.
 *
 * The registry's `session_delegated` title is the short "Delegated work": the
 * terminal's header column is 34 cells and the longer phrase overran it and cost
 * the header its scope tag. This page has the width, and the full phrase is what
 * tells a reader which sessions the group governs before they read a line of it.
 */
const SECTION_TITLES: Record<string, string> = {
	session_delegated: "Delegated work: subagents and background sessions",
};

/** A section's title as this page shows it. */
export function sectionTitle(section: { name: string; title: string }): string {
	return SECTION_TITLES[section.name] ?? section.title;
}

/** The setting with the desktop's words applied, or the same object untouched. */
export function presentSetting(setting: BackendSetting): BackendSetting {
	const copy = ROW_COPY[setting.key];
	return copy ? { ...setting, label: copy.label, help: copy.help } : setting;
}

/** The phrase a gated child's note should use for the switch `key`. */
export function gateLabelFor(key: string, fallback: string): string {
	return ROW_COPY[key]?.gateLabel ?? fallback;
}
