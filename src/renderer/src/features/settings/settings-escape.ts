/**
 * Escape closes Settings, but only when nothing nearer has taken the press.
 *
 * WHY "NEARER THING WINS" IS THE WHOLE FEATURE. Settings is a page of controls,
 * and several of them answer Escape already: a combobox dismisses its list, an
 * input keeps the key, a shortcut recorder cancels its capture, an inline
 * confirm backs out of its question, a dialog closes itself. A page-level
 * handler that closed the route on the SAME press would take the user out of
 * Settings when they meant to close a dropdown - so this handler is the LAST
 * reader of the press, mounted on the content column (bubble phase) rather than
 * on the document, and it stands aside for every one of those owners.
 *
 * HOW EACH OWNER IS RECOGNISED, and why by evidence rather than by name:
 *
 *  - `event.defaultPrevented`: the field, list or dialog that acted on this
 *    press said so. This is how the settings search (`settings-search.tsx`'s
 *    own Escape branch) and a Radix menu's item keep their press.
 *  - a text field (`input`/`textarea`/`select`/`contenteditable`): Escape means
 *    "undo what I am doing here" while a caret is in one, and the backend
 *    registry's hotkey rows and the filter bar both live in inputs.
 *  - `[data-shortcut-recorder]`: the recorder has ALREADY cancelled its capture
 *    and stopped the propagation itself (the four recorders mark their field
 *    with this attribute); the marker is checked anyway so a future recorder
 *    that forgets the stop is still not heard as "close the page".
 *  - `[role="combobox"]`, and `pressLandsOnOverlay` (the chat keyboard-scopes
 *    module): a focused Radix dialog, menu or listbox owns its own keys, and the
 *    settings search's field and list are exactly those roles.
 *  - the settings search widget while it has text or an open list: the search
 *    clears first and dismisses second, so its own two presses must land before
 *    this one. The root carries `data-settings-search` for that reading.
 *
 * WHAT DOES NOT NEED A CHECK. The inline confirms
 * (`account-profile-editor.tsx`, `integrations/*`) call `stopPropagation` on
 * their own Escape, so their press never reaches this handler at all.
 */
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { type KeyboardEvent, useCallback } from "react";

/** Elements whose Escape belongs to the caret inside them. */
const EDITABLE_SELECTOR =
	'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/** The recorder's own marker, and the combobox that opens a list. */
const NEARER_OWNER_SELECTOR = '[data-shortcut-recorder], [role="combobox"]';

/** The settings search's widget root (see its `data-settings-search` attribute). */
const SETTINGS_SEARCH_SELECTOR = "[data-settings-search]";

/** `target.closest(...)`, for a target that may not be an element. */
function closest(target: EventTarget | null, selector: string): Element | null {
	const element = target as Element | null;
	return typeof element?.closest === "function"
		? element.closest(selector)
		: null;
}

/** Whether the search field holds a query or its results list is open. */
function settingsSearchOwnsEscape(root: Element): boolean {
	const combobox = root.querySelector('[role="combobox"]');
	if (combobox?.getAttribute("aria-expanded") === "true") return true;
	const field = root.querySelector("input");
	return (field as HTMLInputElement | null)?.value !== "";
}

/**
 * Whether something nearer than the page has a claim on this Escape.
 *
 * Pure, so the rules above can be asserted without a rendered page; the hook
 * below is the only production caller.
 */
export function settingsEscapeIsClaimed(
	event: KeyboardEvent<HTMLElement>,
): boolean {
	if (event.defaultPrevented) return true;
	const target = event.target;
	if (closest(target, NEARER_OWNER_SELECTOR) !== null) return true;
	if (closest(target, EDITABLE_SELECTOR) !== null) return true;
	if (pressLandsOnOverlay(target)) return true;
	const search = closest(target, SETTINGS_SEARCH_SELECTOR);
	return search !== null && settingsSearchOwnsEscape(search);
}

/**
 * The Settings content column's bubble-phase `onKeyDown`.
 *
 * `onClose` is the page's single close path (`useCloseSettings`), so Esc and the
 * Close button cannot drift apart.
 */
export function useSettingsEscapeClose(
	onClose: () => void,
): (event: KeyboardEvent<HTMLElement>) => void {
	return useCallback(
		(event: KeyboardEvent<HTMLElement>) => {
			// "Esc" is the legacy spelling the app's own END_EDIT_KEYS also accepts.
			if (event.key !== "Escape" && event.key !== "Esc") return;
			/*
			 * A MODIFIED Escape is a chord, not this key: the shortcut recorders
			 * store `ctrl+escape`/`alt+escape` as bindings, and Windows itself
			 * reserves Ctrl+Esc. Only the bare press closes the page.
			 */
			if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
				return;
			}
			if (settingsEscapeIsClaimed(event)) return;
			onClose();
		},
		[onClose],
	);
}
