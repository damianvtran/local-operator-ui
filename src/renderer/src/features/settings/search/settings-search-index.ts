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
import {
	PROMOTED_SETTING_SECTIONS,
	sectionForSettingKey,
} from "../promoted-setting-sections";

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
	/**
	 * The SIDEBAR destination the thing lives in — the place a jump lands, named
	 * as the rail names it. A registry row's own sub-section ("Tools",
	 * "Failover and retry") is NOT this: it is `detail` below, because a
	 * heading that names a sub-section while the jump lands in Backend settings
	 * is a caption the action does not carry (review round 1, M2/D2).
	 */
	sectionId: string;
	sectionLabel: string;
	/**
	 * A secondary line, when the destination is not the whole story: the
	 * registry's own sub-section title for a registry row. Never used as a group
	 * heading — that is `sectionLabel`'s job.
	 */
	detail?: string;
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
	options: {
		startOrder?: number;
		/** The sidebar's own sections, for destination ids and labels. */
		sections?: readonly { id: string; label: string }[];
	} = {},
): SettingSearchEntry[] {
	if (!payload) return [];
	const { startOrder = 0, sections: destinations = [] } = options;
	const registrySections = registrySectionTitles(payload.sections);
	const destinationLabels = new Map(
		destinations.map((section) => [section.id, section.label]),
	);
	return payload.settings.map((setting: BackendSetting, index: number) => {
		const section = registrySections.get(setting.section);
		/*
		 * WHERE THE JUMP LANDS, not where the row is filed. A promoted key's
		 * control lives outside Backend settings (`PROMOTED_SETTING_SECTIONS` is
		 * the one map that says so), so its destination — and therefore the
		 * group heading and the row's "In …" line — is the sidebar section the
		 * reader actually arrives at.
		 */
		const destinationId = sectionForSettingKey(setting.key, "backend");
		return {
			id: `setting:${setting.key}`,
			source: "registry" as const,
			label: setting.label || setting.key,
			description: setting.help ?? "",
			sectionId: destinationId,
			sectionLabel: destinationLabels.get(destinationId) ?? "",
			detail: section?.label ?? setting.section,
			order: startOrder + index,
			settingKey: setting.key,
			fields: foldFields({
				label: setting.label,
				synonym: setting.synonyms ?? [],
				key: setting.key,
				/*
				 * CHOICE COPY, LABELS AND DESCRIPTIONS. The registry's synonym
				 * hygiene rule forbids a synonym that repeats any text the row's
				 * choices already carry, on the stated ground that the row "is
				 * searchable by its choice copy" — so a synonym list alone cannot
				 * reach a word that lives only in an option's description. Folding
				 * both halves is what makes the UI's promise match the backend's
				 * rule (reviewer note, round 1).
				 */
				choice: (setting.choices ?? []).flatMap((choice) => [
					choice.label,
					choice.description ?? "",
				]),
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

/**
 * The row's own title, never its whole subtree.
 *
 * `textContent` concatenates SIBLING names without a separator, because JSX
 * emits no whitespace text node between them: the theme grid's row read
 * "DarkLocal Operator DarkCatppuccin Macchiato…" and a provider card read
 * "AnthropicConnected" (review round 1, M3). So the label is resolved in this
 * order, and every step is a thing the author marked or a heading the row
 * already has:
 *
 * 1. `data-search-label` on the row itself — the explicit answer.
 * 2. A `[data-search-label]` descendant — a title element further in.
 * 3. The row's own heading (`h2`/`h3`/`h4`/`legend`), which is a title by
 *    construction.
 * 4. The row's `aria-label`, for a row that is a single control.
 * 5. The FIRST element child's text — the title-plus-detail shape's title,
 *    never its siblings.
 *
 * `data-search-terms` remains where a row genuinely needs words it does not
 * print; the reader's vocabulary and the label's are separate fields.
 */
export function rowLabel(row: Element): string {
	const explicit = row.getAttribute("data-search-label");
	if (explicit?.trim()) return explicit.trim();
	const marked = row.querySelector("[data-search-label]");
	if (marked?.textContent?.trim()) return marked.textContent.trim();
	const heading = row.querySelector("h2, h3, h4, legend");
	if (heading?.textContent?.trim()) return heading.textContent.trim();
	const aria = row.getAttribute("aria-label");
	if (aria?.trim()) return aria.trim();
	const first = row.firstElementChild ?? row;
	return (first.textContent ?? "").trim();
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
 * The row's text with its own title removed: the help sentence, the option
 * labels, the reason line — everything that row PRINTS beyond its name.
 *
 * A row may print its title more than once (a heading plus an `aria-label`
 * copy); only the first occurrence is the title, and the rest is context.
 */
function rowTextWithoutLabel(row: Element, label: string): string {
	const whole = (row.textContent ?? "").trim();
	if (!label) return whole;
	const at = whole.indexOf(label);
	if (at < 0) return whole;
	return `${whole.slice(0, at)} ${whole.slice(at + label.length)}`.trim();
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
		/*
		 * THE SECTION ROOT'S OWN LABEL FIRST.
		 *
		 * `querySelector` searches DESCENDANTS, so it cannot see an attribute on
		 * the root itself — and every section root in the page carries exactly
		 * that attribute (`data-search-section-label="General settings"`). The
		 * query therefore fell through to the first `h2` inside the section, and a
		 * row in General was announced as "In Interface language" while Enter
		 * landed in the Model settings block (QA round 2c, Q-R2b-1). The
		 * descendant query stays as the fallback for a root that names itself only
		 * by its heading (the legacy `speech`/`keyboard` roots do).
		 */
		const ownLabel =
			root_?.getAttribute("data-search-section-label")?.trim() ?? "";
		const sectionLabel =
			ownLabel ||
			root_
				?.querySelector<HTMLElement>("[data-search-section-label], h2")
				?.textContent?.trim() ||
			"";
		const rendered = rowLabel(row);
		// A control's own value is not its text (`<input value>` has no text
		// node), so `data-search-terms` is where a value-shaped row says what it
		// holds — and where a row spells an older name it no longer prints.
		const terms = row.getAttribute("data-search-terms") ?? "";
		/*
		 * THE REST OF THE ROW IS DESCRIPTION, NOT MORE NAME.
		 *
		 * `rowLabel` resolves the row's TITLE (`data-search-label` where a shared
		 * row component marks one, a heading, the first child as the last resort).
		 * Everything else the row prints — the help sentence under the title — is
		 * still searchable, but as a DESCRIPTION: it answers "the row that talks
		 * about blurred glass", and it must not answer "the row called Translucent
		 * window" more weakly than the name does. Folding the two into one haystack
		 * made a row's own title compete with long prose: a subsequence of `effort`
		 * matched a 249-character title+help blob and outranked the effort row
		 * itself (QA round 1, Q6), and a query equal to a row's printed title was
		 * weaker than the row's slab of help text (QA round 1, Q5).
		 */
		const rest = rowTextWithoutLabel(row, rendered);
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
				description: rest,
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
	/*
	 * A PROMOTED ROW IS THIS PAGE'S ROW, not a second registry result for the
	 * same control. `PROMOTED_SETTING_SECTIONS` is the one list that says a key
	 * already has a first-class row elsewhere on this page, so indexing it twice
	 * offers the reader two rows for one setting under two different names
	 * (review round 1, m1).
	 */
	const registry = buildRegistryEntries(parts.registry, {
		startOrder: 0,
		sections: parts.sections,
	}).filter(
		(entry) =>
			!(entry.settingKey && entry.settingKey in PROMOTED_SETTING_SECTIONS),
	);
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
