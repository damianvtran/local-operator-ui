/**
 * @file promoted-setting-sections.ts
 * @description
 * The registry keys whose control the settings page has PROMOTED out of the
 * Backend section, and the sidebar section that control now lives in.
 *
 * ## Why this exists
 *
 * Every registry key used to be reachable one way: the Backend section's
 * searchable list. So a `?setting=<key>` deep link resolved to `backend`, and
 * the command palette's per-key row (which builds exactly that link) could
 * honestly hint `backend` for all of them.
 *
 * That stopped being true when a key's control was given a first-class home
 * elsewhere — the interface-language row moved into General, where its own
 * control is the canonical editor and the Backend list filters the row OUT
 * (`hideInterfaceLanguage`). A link that still resolved to Backend then
 * highlighted a section that no longer contains the row, and the user was left
 * to hunt for a control the link claimed to reveal.
 *
 * ## The rule this file makes mechanical
 *
 * Promotion is a decision the page makes in ONE place, and both consumers read
 * it from here rather than each remembering:
 *
 * - `settings-page.tsx` resolves a `?setting=` deep link's target section
 *   (`targetSection`) so the scroll and the sidebar highlight follow the
 *   control.
 * - `backend-setting-copy.ts`'s `presentSetting` reports the row's section so
 *   the palette's hint names where the link actually lands.
 *
 * Adding a promoted key is therefore a one-line change here, and a future
 * relocation cannot half-land: a key in this map renders as promoted
 * everywhere, or nowhere.
 *
 * ## What a promotion does NOT mean
 *
 * The Backend section keeps the key in its REGISTRY (search, `Modified`, the
 * star), because the row is still a registry fact; only its editor moved. Keys
 * absent from this map are unchanged and still resolve to `backend`.
 */

import { LANGUAGE_SETTING_KEY } from "@shared/i18n";

/** The sidebar section the interface-language control now lives in. */
export const GENERAL_SECTION = "general";

/**
 * Registry key -> the sidebar section its (promoted) control lives in.
 *
 * A plain map rather than an array of predicates: the lookup is by the exact
 * registry key the backend serves, so it cannot drift from a spelling.
 */
export const PROMOTED_SETTING_SECTIONS: Readonly<Record<string, string>> = {
	[LANGUAGE_SETTING_KEY]: GENERAL_SECTION,
};

/**
 * The section a `?setting=<key>` link must resolve to.
 *
 * `fallback` is the caller's own default (the page passes `"backend"`, the
 * section that owns every unpromoted registry key).
 */
export function sectionForSettingKey(key: string, fallback: string): string {
	return PROMOTED_SETTING_SECTIONS[key] ?? fallback;
}
