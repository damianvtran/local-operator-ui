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

/**
 * The input types whose Escape is the field's.
 *
 * WHY AN ALLOWLIST (round 2: M1). `input` as a blanket claim also matched
 * `type=range` and `type=radio` - the window-glass slider, contrast, the theme
 * editor's controls, notification volume, the speech-provider radios - which
 * have no Escape of their own, so after a keyboard adjustment on one, Esc did
 * nothing until focus moved: the same dead end U3 and U4 were fixed for. Only
 * a caret has something to undo; a slider's Escape is the page's.
 */
const TEXT_INPUT_TYPES = new Set([
	"",
	"text",
	"search",
	"email",
	"url",
	"tel",
	"password",
	"number",
]);

/** Whether this element is a caret the press belongs to. */
function isTextEntry(element: Element): boolean {
	const tag = element.tagName.toLowerCase();
	if (tag === "textarea" || tag === "select") return true;
	if (element.hasAttribute("contenteditable")) return true;
	if (tag !== "input") return false;
	const type = (element.getAttribute("type") ?? "").toLowerCase();
	return TEXT_INPUT_TYPES.has(type);
}

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
 * The tooltip trigger's own open state, as Radix renders it.
 *
 * `data-state` is on the TRIGGER, so it survives the tooltip being unmounted
 * during the same press - which is exactly what the `[role="tooltip"]` node
 * does not (round 2: U8, Q-7 measured that ordering).
 */
const OPEN_TOOLTIP_TRIGGER_SELECTOR =
	'[data-state="delayed-open"], [data-state="instant-open"]';

/**
 * Whether THIS press was the tooltip's to consume, and nothing else's.
 *
 * Radix dismisses a tooltip from a CAPTURE listener and calls `preventDefault()`
 * first, so by the time a bubble listener reads the event a tooltip has
 * "handled" it. That is true of a dialog too - but a dialog is a surface the
 * press was aimed at, while a tooltip is a hint beside the control the reader
 * is on. Three conditions, each earned:
 *
 *  1. a tooltip is mounted and no real overlay layer is (a layer always wins);
 *  2. the press's TARGET is the trigger whose tooltip is open. Keying to the
 *     target is what keeps a real owner's claim intact when an unrelated
 *     tooltip happens to be open: the sound preview (R2/Q-4) and the disclosure
 *     selection (R4) claim by `preventDefault` from ordinary controls, and the
 *     page must keep standing aside for them (round 2: M3);
 *  3. the trigger reads as open, so a tooltip that was ALREADY open when the
 *     page mounted is still recognised after its layer has dismissed (U8/Q-7).
 */
function tooltipHoldsThisPress(target: EventTarget | null): boolean {
	if (typeof document === "undefined") return false;
	if (document.querySelector('[role="tooltip"]') === null) return false;
	if (document.querySelector(OWNER_LAYER_SELECTOR) !== null) return false;
	if (closest(target, OPEN_TOOLTIP_TRIGGER_SELECTOR) !== null) return true;
	/*
	 * A tooltip shown by the POINTER leaves focus where it was, so the press
	 * lands on whatever the reader last touched: the page ground, the gear, or
	 * nothing at all (round 3: Q-8 - hovering the X and pressing Esc dismissed
	 * only the tooltip). Those targets have no owner of their own, so the press
	 * is the page's; a target that DOES own its Escape (a text field, a
	 * recorder, the sound preview's radio, a disclosure) keeps it, because the
	 * allowlist below is deliberately narrow.
	 */
	const element = target as Element | null;
	if (element === null || element === document.body) return true;
	if (element === document.documentElement) return true;
	// A non-element target (the document, a text node) is nobody's control.
	if (typeof element.closest !== "function") return true;
	return (
		element.closest("[data-settings-close]") !== null ||
		element.closest('[data-tour-tag="nav-item-settings"]') !== null
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
 * the snapshot in its own WINDOW capture listener, the first phase of any press.
 */
export type EscPressContext = { tooltipOwnedThePress?: boolean };

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
		const tooltipOwned =
			context.tooltipOwnedThePress ?? tooltipHoldsThisPress(event.target);
		if (!tooltipOwned) return true;
	}
	const target = event.target;
	if (closest(target, RECORDER_SELECTOR) !== null) return true;
	const search = closest(target, SETTINGS_SEARCH_SELECTOR);
	if (search !== null) return settingsSearchOwnsEscape(search);
	const editable = closest(target, EDITABLE_SELECTOR);
	if (editable !== null && isTextEntry(editable)) {
		// A combobox is judged by its own rule below, not as a bare input: a
		// closed one must not claim the key forever.
		if (editable.getAttribute("role") !== "combobox") return true;
	}
	const combobox = closest(target, '[role="combobox"]');
	if (combobox?.getAttribute("aria-expanded") === "true") return true;
	return pressLandsOnOverlay(target);
}

/** The press this feature answers: a bare Escape, never a chord. */
export type EscapeLike = {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
};

/**
 * Whether a press is the bare Escape Settings answers.
 *
 * Pure and exported (round 2: M2a): a MODIFIED Escape is a chord - the shortcut
 * recorders store `ctrl+escape`/`alt+escape` as bindings, and Windows reserves
 * Ctrl+Esc - so only the bare press closes the page. "Esc" is the legacy
 * spelling the app's own END_EDIT_KEYS also accepts.
 */
export function isBareEscape(event: EscapeLike): boolean {
	if (event.key !== "Escape" && event.key !== "Esc") return false;
	return !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
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
		 * CAPTURE, and on WINDOW rather than the document. Two orderings had to be
		 * defeated, and both are registration-order accidents: a Radix layer's
		 * `document` capture listener runs before a listener this page registers
		 * LATER (a gear tooltip can already be open when a hash or history change
		 * mounts the page - round 2: U8, Q-7), and `document` listeners fire in
		 * registration order among themselves. Window capture is the first phase
		 * of any press, so this snapshot always runs before every layer's.
		 */
		let tooltipOwnedThePress = false;
		const snapshot = (event: KeyboardEvent) => {
			if (!isBareEscape(event)) return;
			tooltipOwnedThePress = tooltipHoldsThisPress(event.target);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isBareEscape(event)) return;
			if (settingsEscapeIsClaimed(event, { tooltipOwnedThePress })) return;
			onClose();
		};
		window.addEventListener("keydown", snapshot, true);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", snapshot, true);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);
}
