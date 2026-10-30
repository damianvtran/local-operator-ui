/**
 * @file settings-search-index.ts
 * @description
 * What the Settings page's search knows about, as one flat, immutable list.
 *
 * ## Why an index rather than a second catalogue
 *
 * Settings has two populations of things worth finding, and they arrive from
 * different places:
 *
 * 1. **Registry rows** — what the backend's `settings.list` payload serves
 *    (label, help, key, choices, and the optional `synonyms`). Cached at the
 *    same query key the Backend section reads (`backendSettingsKeys.all`), so
 *    the search costs no extra request.
 * 2. **The page's own rows** — the profile fields, the theme grid, the
 *    shortcut recorder, the provider cards, the integrations. Those are
 *    renderer-local: they are not registry facts, and no payload lists them.
 *
 * The trap this module exists to avoid is the obvious one: writing a static
 * list of the page's rows here as well, which starts drifting from the page the
 * first time someone renames a label — and every rename would have to remember
 * a file nobody looks at. Instead those rows are read from the **rendered DOM**
 * through a small attribute contract (`buildRenderedEntries`):
 *
 * - `data-search-row="<stable-id>"` marks an element as one searchable row.
 * - `data-search-terms="..."` adds words that are not in the rendered text (an
 *   old name, a synonym the row does not print).
 * - `data-search-control` marks the element inside the row that should take
 *   focus on arrival; absent, the row itself is the landing site.
 * - `data-search-section="<section-id>"` marks a section root; a row's section
 *   context is read from it, and its heading is the section's label.
 * - `data-search-ignore="<reason>"` marks a control deliberately out of scope,
 *   so the annotation ratchet
 *   (`scripts/settings-search-annotations.test.mjs`) can tell "not yet
 *   annotated" from "not meant to be searchable".
 *
 * Because the label is the RENDERED text, translation cannot drift from the
 * index: a translated row is indexed in the reader's own words, and there is no
 * second list to keep in step. The registry half has the same property, since
 * its label and help are the backend's own copy — which is why the only extra
 * vocabulary it carries is `synonyms`, a field the REGISTRY owns. This module
 * never invents a synonym.
 *
 * ## Cost
 *
 * Entries hold PRE-FOLDED haystacks (`fields`), so a keystroke costs no
 * `normalize` pass over the corpus — only the query itself. The registry and
 * section halves are built once per (payload identity, locale) by the page's
 * `useMemo`; the rendered half is read on first use and cached by the search
 * component, so typing never rebuilds it and never re-renders the settings tree
 * (`scripts/settings-search.test.mjs` pins the build count).
 */

import type {
	BackendSetting,
	BackendSettings,
} from "../../../../../shared/desktop-contract";
import { normalizeText } from "../../command-palette/palette-search";

/**
 * Where an entry came from, which decides how a jump resolves it.
 *
 * - `registry` — a backend registry row. Unpromoted rows live inside the
 *   Backend section; promoted ones have a first-class control elsewhere, which
 *   is what `PROMOTED_SETTING_SECTIONS` answers.
 * - `page` — a rendered row on this page (`data-search-row`).
 * - `section` — a sidebar destination. A section-only result scrolls to the
 *   section root and focuses it, because that is all "the Appearance section"
 *   can honestly mean.
 */
export type SettingSearchSource = "registry" | "page" | "section";

/**
 * The fields a query is matched against.
 *
 * The set is closed so an entry cannot grow a haystack the ranker does not know
 * about; the ORDER of the weights lives in `settings-search-match.ts` and is
 * label > synonym > key > choice > section > description.
 */
export type SettingSearchField =
	| "label"
	| "synonym"
	| "key"
	| "choice"
	| "section"
	| "description";

/** One field's folded text, pre-lowercased for the matcher. */
export type FoldedFields = Readonly<Record<SettingSearchField, string>>;

/** One thing the search can offer. */
export type SettingSearchEntry = {
	/** Stable across rebuilds; the listbox's option id is derived from it. */
	id: string;
	source: SettingSearchSource;
	/** The row's printed title, as the panel shows it. */
	label: string;
	/** The registry's help / the row's own description, when there is one. */
	description?: string;
	/** The sidebar section the thing lives in. */
	sectionId: string;
	sectionLabel: string;
	/** Document order, and the tie-break when two entries score the same. */
	order: number;
	/** The registry key, for a `registry` entry. */
	settingKey?: string;
	fields: FoldedFields;
};

const EMPTY_FIELDS: FoldedFields = {
	label: "",
	synonym: "",
	key: "",
	choice: "",
	section: "",
	description: "",
};

/**
 * Fold the fields a builder has into the full record.
 *
 * One normalisation pass per field, at BUILD time — never per keystroke. A
 * missing field folds to `""`, which `matchQuality` refuses, so an absent field
 * can neither match nor claim a match.
 */
function foldFields(
	parts: Partial<Record<SettingSearchField, string | readonly string[]>>,
): FoldedFields {
	const fold = (value: string | ReadonlyArray<string> | undefined): string =>
		typeof value === "string"
			? normalizeText(value)
			: normalizeText((value ?? []).join(" "));
	return {
		label: fold(parts.label),
		synonym: fold(parts.synonym),
		key: fold(parts.key),
		choice: fold(parts.choice),
		section: fold(parts.section),
		description: fold(parts.description),
	};
}

/** Section name -> the title the registry gives it, folded and printed. */
export type RegistrySectionTitles = ReadonlyMap<
	string,
	{ label: string; folded: string }
>;

/** The map `buildRegistryEntries` and the panel's section context both read. */
export function registrySectionTitles(
	sections: readonly { name: string; title: string }[] | undefined,
): Map<string, { label: string; folded: string }> {
	const titles = new Map<string, { label: string; folded: string }>();
	for (const section of sections ?? []) {
		titles.set(section.name, {
			label: section.title || section.name,
			folded: normalizeText([section.title, section.name].join(" ")),
		});
	}
	return titles;
}

/**
 * The registry half: one entry per `settings.list` row.
 *
 * `synonyms` is read as `?? []` — the field is additive and optional, and an
 * older server must produce exactly the index this feature had before the field
 * existed (pinned by `scripts/settings-search-index.test.mjs`, which indexes a
 * payload with the field absent and one with it empty and compares).
 *
 * A registry row's label and help are the SERVER's copy, not this app's, which
 * is why no `t()` appears here: the search must find the row under the words the
 * Backend section renders beside it.
 */
export function buildRegistryEntries(
	payload: Pick<BackendSettings, "sections" | "settings"> | undefined,
	startOrder = 0,
): SettingSearchEntry[] {
	if (!payload) return [];
	const sections = registrySectionTitles(payload.sections);
	return payload.settings.map((setting: BackendSetting, index: number) => {
		const section = sections.get(setting.section);
		return {
			id: `setting:${setting.key}`,
			source: "registry" as const,
			label: setting.label || setting.key,
			description: setting.help ?? "",
			sectionId: "backend",
			sectionLabel: section?.label ?? setting.section,
			order: startOrder + index,
			settingKey: setting.key,
			fields: foldFields({
				label: setting.label,
				synonym: setting.synonyms ?? [],
				key: setting.key,
				choice: (setting.choices ?? []).map((choice) => choice.label),
				// `folded` already carries BOTH the section's title and its name, so a
				// known section is not joined with its name a second time; an unknown
				// one falls back to the raw name rather than to nothing.
				section: section?.folded ?? setting.section,
				description: setting.help,
			}),
		};
	});
}

/**
 * The section half: one entry per sidebar destination.
 *
 * The label is the SIDEBAR's label — the same string the rail prints — so the
 * search and the rail cannot disagree about what a section is called.
 */
export function buildSectionEntries(
	sections: readonly { id: string; label: string }[],
	startOrder = 0,
): SettingSearchEntry[] {
	return sections.map((section, index) => ({
		id: `section:${section.id}`,
		source: "section" as const,
		label: section.label,
		sectionId: section.id,
		sectionLabel: section.label,
		order: startOrder + index,
		fields: foldFields({ label: section.label }),
	}));
}

/** Collapse a row's rendered text into a title-shaped label. */
export function labelFromRenderedText(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= 80) return collapsed;
	// A row's text is its title followed by its description; the title is what
	// the reader recognises. Cutting mid-word is worse than cutting at the last
	// space, so the label is trimmed there.
	const cut = collapsed.slice(0, 80);
	const space = cut.lastIndexOf(" ");
	return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The nearest `data-search-section` ancestor, or null for an unannotated row. */
function sectionRootOf(row: Element): Element | null {
	return row.closest("[data-search-section]");
}

/**
 * The rendered half: every `[data-search-row]` under `root`, in document order.
 *
 * This is the ONLY function in the feature that reads text out of the DOM, and
 * it is deliberately pure-DOM (a `ParentNode` in, an array out) so
 * `scripts/settings-search-index.test.mjs` can hand it a jsdom tree instead of
 * a React render. Nothing here touches React, the network or locale state: the
 * DOM already carries the reader's language.
 *
 * A row outside any `[data-search-section]` is still indexed — its label is
 * still a thing a reader typed — but it has no section context to show, and the
 * annotation ratchet is what catches the missing section root.
 */
export function buildRenderedEntries(
	root: ParentNode,
	startOrder = 0,
): SettingSearchEntry[] {
	const rows = Array.from(
		root.querySelectorAll<HTMLElement>("[data-search-row]"),
	);
	return rows.map((row, index) => {
		const root_ = sectionRootOf(row);
		const sectionId = root_?.getAttribute("data-search-section") ?? "";
		const sectionLabel =
			root_
				?.querySelector<HTMLElement>("[data-search-section-label], h2")
				?.textContent?.trim() ?? "";
		const rendered = row.textContent ?? "";
		// A control's own value is not its text (`<input value>` has no text
		// node), so `data-search-terms` is where a value-shaped row says what it
		// holds — and where a row spells an older name it no longer prints.
		const terms = row.getAttribute("data-search-terms") ?? "";
		return {
			id: `page:${row.getAttribute("data-search-row") ?? index}`,
			source: "page" as const,
			label: labelFromRenderedText(rendered),
			sectionId,
			sectionLabel,
			order: startOrder + index,
			fields: foldFields({
				label: rendered,
				synonym: terms,
				section: [sectionLabel, sectionId],
			}),
		};
	});
}

/**
 * Merge the three halves into the one list the matcher and the panel read.
 *
 * Order is registry, page, sections: the registry is the long tail a reader
 * cannot see, so it wins ties against a same-named page row; sections come last
 * because "Appearance" as a destination is less useful than the theme row
 * inside it.
 */
export function buildSettingsIndex(parts: {
	registry?: Pick<BackendSettings, "sections" | "settings"> | undefined;
	sections?: readonly { id: string; label: string }[];
	rendered?: readonly SettingSearchEntry[];
}): SettingSearchEntry[] {
	const registry = buildRegistryEntries(parts.registry, 0);
	const rendered = [...(parts.rendered ?? [])].map((entry, index) => ({
		...entry,
		order: registry.length + index,
	}));
	return [
		...registry,
		...rendered,
		...buildSectionEntries(
			parts.sections ?? [],
			registry.length + rendered.length,
		),
	];
}

export { EMPTY_FIELDS };
