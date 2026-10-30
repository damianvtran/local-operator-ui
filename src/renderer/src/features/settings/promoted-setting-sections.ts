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
 * elsewhere — the interface-language row moved into General, and the Default
 * effort row took ownership of `model_effort` — where its own control is the
 * canonical editor and the Backend list filters the registry row OUT
 * (`hideInterfaceLanguage`, `hideModelEffort`). A link that still resolved to
 * Backend then highlighted a section that no longer contains the row, and the
 * user was left to hunt for a control the link claimed to reveal.
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
import { START_RECORDING_SETTING_KEY } from "../../../../shared/recording-shortcut";

/** The sidebar section the interface-language control now lives in. */
export const GENERAL_SECTION = "general";

/**
 * The settings-registry key the Default effort row owns.
 *
 * Exported here rather than restated at the row and the filter: promotion, the
 * write path and the hidden registry row must all name the same key, and this
 * module is already the one place that decides who owns it.
 */
export const MODEL_EFFORT_SETTING_KEY = "model_effort";

/** The sidebar section the agent-messages controls now live in. */
export const AGENT_MESSAGES_SECTION = "agent-messages";
export const KEYBOARD_SHORTCUTS_SECTION = "keyboard";

/**
 * The two local preferences the Agent messages section owns.
 *
 * Both are MACHINE-LOCAL (`settings.edit`) and both still exist as registry
 * keys for the TUI; promoting them means the settings page renders their one
 * canonical editor, and the Backend list filters the registry rows out.
 */
export const TEAM_BRIDGE_ENABLED_SETTING_KEY = "team_bridge.enabled";
export const TEAM_BRIDGE_SESSION_SETTING_KEY = "team_bridge.session";

/**
 * Registry key -> the sidebar section its (promoted) control lives in.
 *
 * A plain map rather than an array of predicates: the lookup is by the exact
 * registry key the backend serves, so it cannot drift from a spelling.
 *
 * `model_effort` is here because the Default effort row IS its canonical
 * editor: the row offers the selected model's own ladder and clamps into it,
 * while the registry editor offered the global `EFFORT_ORDER` ladder with its
 * own "auto" label for `""`. Two controls for one key meant two vocabularies
 * and a silent cross-control overwrite, so the registry row is now filtered out
 * of Backend settings (`hideModelEffort`) and this map is what sends a
 * `?setting=model_effort` link to where the control is.
 */
export const PROMOTED_SETTING_SECTIONS: Readonly<Record<string, string>> = {
	[LANGUAGE_SETTING_KEY]: GENERAL_SECTION,
	[MODEL_EFFORT_SETTING_KEY]: GENERAL_SECTION,
	[TEAM_BRIDGE_ENABLED_SETTING_KEY]: AGENT_MESSAGES_SECTION,
	[TEAM_BRIDGE_SESSION_SETTING_KEY]: AGENT_MESSAGES_SECTION,
	[START_RECORDING_SETTING_KEY]: KEYBOARD_SHORTCUTS_SECTION,
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
