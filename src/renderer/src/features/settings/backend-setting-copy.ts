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
import { type WithoutParams, t } from "@shared/i18n";
import { sectionForSettingKey } from "./promoted-setting-sections";
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

/*
 * COPY IS RESOLVED PER RENDER, NOT AT MODULE LOAD (the French activation bug).
 *
 * A `t()` call inside a module-level object literal evaluates ONCE, when the
 * module is first imported, and freezes whatever locale was active then. That is
 * the defect the operator hit: switching to Francais would leave these rows
 * English until a reload, and a second switch would keep the older language. So
 * this table holds TRANSLATION KEYS and `rowCopyFor` resolves them through `t()`
 * when it runs - each render - which is what lets the locale subscription reach
 * them.
 */
type RowCopyKeys = {
	label: WithoutParams;
	help: WithoutParams;
	gateLabel?: WithoutParams;
};

const ROW_COPY_KEYS: Record<string, RowCopyKeys> = {
	/*
	 * The language row. Two user-visible reasons it is overridden:
	 *
	 * SEARCH DISAMBIGUATION (round-1 UX U3). Searching `language` matches
	 * this row and `speech.voice.language`, and two rows both labelled
	 * `Language` made the wrong pick plausible - the voice setting is scoped
	 * to speech, this one is the whole app. The label therefore names the
	 * scope, and keeps the word itself, which is what the search finds.
	 *
	 * SCOPE, SPELLED OUT (round-1 UX U4). The wire help never says the TUI's
	 * /settings writes the same key, because on the terminal that is its own
	 * page; here the reader cannot see it, so the sentence says it once.
	 */
	language: {
		label: "ui.settings.section.interface_language.label",
		help: "ui.settings.section.interface_language.help",
	},
	[DELEGATED_ENABLED_KEY]: {
		label: "ui.settings.section.delegated_enabled.label",
		help: "ui.settings.section.delegated_enabled.help",
		gateLabel: "ui.settings.section.delegated_enabled.gate_label",
	},
	[DELEGATED_MAX_AGE_KEY]: {
		label: "ui.settings.section.delegated_max_age.label",
		help: "ui.settings.section.delegated_max_age.help",
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
const SECTION_TITLE_KEYS: Record<string, WithoutParams> = {
	session_delegated: "ui.settings.section.session_delegated.title",
};

/**
 * A keyed row's copy, resolved in the CURRENT locale at call time.
 *
 * The only way to a label: `ROW_COPY_KEYS` holds keys, so no caller can read a
 * stale load-time string. This indirection is what the French activation fix
 * turns on.
 */
function rowCopyFor(key: string): RowCopy | undefined {
	const keys = ROW_COPY_KEYS[key];
	if (keys) {
		return {
			label: t(keys.label),
			help: t(keys.help),
			...(keys.gateLabel ? { gateLabel: t(keys.gateLabel) } : {}),
		};
	}
	return undefined;
}

/** A section's title as this page shows it. */
export function sectionTitle(section: { name: string; title: string }): string {
	const key = SECTION_TITLE_KEYS[section.name];
	return key ? t(key) : section.title;
}

/** The setting with the desktop's words applied, or the same object untouched. */
export function presentSetting(setting: BackendSetting): BackendSetting {
	const copy = rowCopyFor(setting.key);
	/*
	 * A PROMOTED key reports the section its control actually lives in, so the
	 * palette's per-key row hints where its `?setting=` link lands rather than
	 * the section it left (see `promoted-setting-sections.ts`). The row's own
	 * label/help are unaffected; only its section is re-homed.
	 */
	const section = sectionForSettingKey(setting.key, setting.section);
	if (!copy)
		return section === setting.section ? setting : { ...setting, section };
	return { ...setting, label: copy.label, help: copy.help, section };
}

/** The phrase a gated child's note should use for the switch `key`. */
export function gateLabelFor(key: string, fallback: string): string {
	return rowCopyFor(key)?.gateLabel ?? fallback;
}
