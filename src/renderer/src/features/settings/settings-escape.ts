/**
 * Escape closes Settings, but only when nothing nearer has taken the press.
 *
 * WHY "NEARER THING WINS" IS THE WHOLE FEATURE. Settings is a page of controls,
 * and several of them answer Escape already: a combobox dismisses its list, an
 * input keeps the key, a shortcut recorder cancels its capture, an inline
 * confirm backs out of its question, a dialog closes itself. A page-level
 * handler that closed the route on the SAME press would take the user out of
 * Settings when they meant to close a dropdown - so this handler is the LAST
 * reader of the press and stands aside for every one of those owners.
 *
 * WHY THE LISTENER LIVES ON THE DOCUMENT (round 1: R1, D1, U1, Q-1 - four
 * reviewers, one blocker). The first cut heard keys through a React `onKeyDown`
 * on the content column, so it only ever saw presses whose TARGET was inside
 * that column. Every common way into the page leaves focus outside it: opening
 * from the sidebar gear keeps focus on the gear, a click on plain text leaves
 * `<body>`, and a dismissed dialog hands focus back to neither. The tooltip's
 * "Close (Esc)" was then a promise the page broke. The predicate below is
 * target-based rather than scope-based, so hearing the press where focus
 * actually is costs nothing: every owner test still answers first.
 *
 * WHY FOCUS IS NOT MOVED INTO THE PAGE ON OPEN. A forced focus move would take
 * the keyboard away from the control the reader pressed (the gear), break the
 * tour's anchor on that same gear, and fight the page's own search focus
 * (Cmd/Ctrl+F). The listener above makes the focus move unnecessary; the only
 * focus rule this feature keeps is the one on the way OUT (back to the gear,
 * `use-settings-route.ts`).
 *
 * HOW EACH OWNER IS RECOGNISED, and why by evidence rather than by name:
 *
 *  - `event.defaultPrevented`: the field, list or dialog that acted on this
 *    press said so. Radix layers dismiss in the CAPTURE phase, before any
 *    bubble listener runs, so this is how a dialog, menu or select keeps its
 *    press. One exception, measured in round 1 (U2, Q-3): a TOOLTIP also marks
 *    the press handled, and a tooltip is not something a press is owed to -
 *    otherwise the Close button's own tooltip swallowed the reader's first
 *    Escape. When the only layer in the document is a tooltip, the press is
 *    still the page's (see `onlyTooltipHoldsThePress`).
 *  - the settings search widget, tested BEFORE the generic editable rule: while
 *    it has text or an open list it clears first and dismisses second
 *    (`settingsSearchOwnsEscape`); with neither, the press is the page's
 *    (round 1: U3 - the field used to claim Esc forever, so the keyboard road
 *    dead-ended in it).
 *  - a text field (`input`/`textarea`/`select`/`contenteditable`): Escape means
 *    "undo what I am doing here" while a caret is in one, and the backend
 *    registry's hotkey rows and the filter bar both live in inputs.
 *  - `[data-shortcut-recorder]`: the recorder has ALREADY cancelled its capture
 *    and stopped the propagation itself (the four recorders mark their field
 *    with this attribute); the marker is checked anyway so a future recorder
 *    that forgets the stop is still not heard as "close the page".
 *  - `[role="combobox"]` while `aria-expanded="true"`: an OPEN list owns the
 *    key. A CLOSED combobox does not (round 1: U4 - after dismissing a select,
 *    the trigger keeps focus, and an unconditional claim left the next Esc
 *    dead).
 *  - `pressLandsOnOverlay` (the chat keyboard-scopes module): a press whose
 *    target is inside a dialog, menu or listbox belongs to it.
 *
 * WHAT DOES NOT NEED A CHECK. The inline confirms
 * (`account-profile-editor.tsx`, `integrations/*`) call `stopPropagation` on
 * their own Escape, so their press never reaches this listener at all.
 */
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { useEffect } from "react";

/** Elements whose Escape belongs to the caret inside them. */
const EDITABLE_SELECTOR =
	'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

/** The recorder's own marker. */
const RECORDER_SELECTOR = "[data-shortcut-recorder]";

/** The settings search's widget root (see its `data-settings-search` attribute). */
const SETTINGS_SEARCH_SELECTOR = "[data-settings-search]";

/** The layers whose dismissal is a nearer owner's claim on the press. */
const OWNER_LAYER_SELECTOR =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

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
 * Whether the only thing that consumed this press was a tooltip.
 *
 * Radix dismisses a tooltip from a CAPTURE listener on the document and calls
 * `preventDefault()` first, so by the time a bubble listener reads the event a
 * tooltip has "handled" it. That is true of a dialog too - but a dialog is a
 * surface the press was aimed at, while a tooltip is a hint beside the control
 * the reader is on. The distinction is read from what is open: with any real
 * overlay layer mounted the press stays theirs; with a tooltip alone it does
 * not. (Round 1: U2, Q-3 - the Close button's tooltip made the reader press
 * Escape twice, with `aria-keyshortcuts="Escape"` on the button.)
 */
function onlyTooltipHoldsThePress(): boolean {
	if (typeof document === "undefined") return false;
	return (
		document.querySelector('[role="tooltip"]') !== null &&
		document.querySelector(OWNER_LAYER_SELECTOR) === null
	);
}

/**
 * What the document looked like when the press STARTED.
 *
 * MEASURED, and the reason it is an argument rather than a live read: Radix
 * closes a tooltip from a capture-phase listener and React commits that state
 * during the same discrete event, so by the time a bubble listener runs the
 * tooltip is gone from the DOM - and a live read then answers "nothing open",
 * which is exactly the wrong answer for the tooltip rule below. The hook takes
 * the snapshot in its own capture listener, registered before any layer's.
 */
export type EscPressContext = { tooltipOnlyAtStart?: boolean };

/**
 * Whether something nearer than the page has a claim on this Escape.
 *
 * Pure, so the rules above can be asserted without a rendered page; the hook
 * below is the only production caller.
 */
export function settingsEscapeIsClaimed(
	event: KeyboardEvent,
	context: EscPressContext = {},
): boolean {
	if (event.defaultPrevented) {
		const tooltipOnly =
			context.tooltipOnlyAtStart ?? onlyTooltipHoldsThePress();
		if (!tooltipOnly) return true;
	}
	const target = event.target;
	if (closest(target, RECORDER_SELECTOR) !== null) return true;
	const search = closest(target, SETTINGS_SEARCH_SELECTOR);
	if (search !== null) return settingsSearchOwnsEscape(search);
	const editable = closest(target, EDITABLE_SELECTOR);
	if (editable !== null) {
		// A combobox is judged by its own rule below, not as a bare input: a
		// closed one must not claim the key forever.
		if (editable.getAttribute("role") !== "combobox") return true;
	}
	const combobox = closest(target, '[role="combobox"]');
	if (combobox?.getAttribute("aria-expanded") === "true") return true;
	return pressLandsOnOverlay(target);
}

/**
 * The Settings page's Esc scope: one bubble-phase listener on the document for
 * as long as the page is mounted.
 *
 * `onClose` is the page's single close path (`useCloseSettings`), so Esc and the
 * Close button cannot drift apart.
 */
export function useSettingsEscapeClose(onClose: () => void): void {
	useEffect(() => {
		/*
		 * CAPTURE, so the snapshot runs before any layer's dismiss handler:
		 * listeners on one node fire in registration order, and this one is
		 * registered when the page mounts while a tooltip's layer registers when
		 * it opens.
		 */
		let tooltipOnlyAtStart = false;
		const snapshot = (event: KeyboardEvent) => {
			if (event.key !== "Escape" && event.key !== "Esc") return;
			tooltipOnlyAtStart = onlyTooltipHoldsThePress();
		};
		const onKeyDown = (event: KeyboardEvent) => {
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
			if (settingsEscapeIsClaimed(event, { tooltipOnlyAtStart })) return;
			onClose();
		};
		document.addEventListener("keydown", snapshot, true);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", snapshot, true);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);
}
