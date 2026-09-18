/**
 * Where the caret goes when a gesture that moved the view ends, and the one DOM
 * helper that hands it to the composer that gesture mounted.
 *
 * WHY THIS IS A MODULE OF ITS OWN. The rule has exactly one caller today
 * (`command-palette.tsx`'s `restoreFocus`, the close-time auto-focus a Radix
 * dialog ends with), and the temptation is to leave it in that component. It is
 * here for two reasons the component cannot supply:
 *
 * - **The decision is pure over observations, so it is asserted without a DOM.**
 *   A close-time restore is a race against the pane commit (the composer that
 *   the picked conversation mounts focuses ITSELF, 8-13 ms before the restore
 *   runs), and the three orderings of that race - restore first, commit first,
 *   commit first with nothing registered yet - are walked as a table of inputs
 *   rather than as three browser runs. `scripts/palette-focus.test.mjs` is that
 *   table.
 * - **Focusing the composer is the composer's own business.** The helper below
 *   goes through `focusComposer()` (`composer-field.ts`) rather than calling
 *   `.focus()` on the textarea, because that registry carries `MessageInput`'s
 *   own `focusInput`, which is the single place focus is given AND the single
 *   place the "the user took the box" flag the ask gate reads is reset. A
 *   second implementation here would leave that flag set and make the next
 *   automatic hand-off think the user had moved on, which is the defect
 *   `composer-field.ts` exists to make impossible.
 *
 * A leaf on purpose: no React, no store, no component import - so a test can
 * bundle it alone (the same reason `composer-field.ts` is a leaf, and the same
 * idiom `scripts/interrupt-control.test.mjs` relies on).
 */

import { composerField, focusComposer } from "./composer-field";

/** Who the caret belongs to when a close-time restore runs. */
export type CloseFocusOutcome =
	/**
	 * The element that had it is still here: put it back (the pre-existing rule).
	 *
	 * ONLY for a close that did NOT move the view. A moved view never reaches
	 * this outcome: see `closeTimeFocusOutcome`.
	 */
	| "captured"
	/** The flow moved the view: the caret belongs in the composer it mounted. */
	| "composer"
	/** Someone else took the caret during the flow: do not touch it. */
	| "leave"
	/** Nothing to restore to but the palette's own door on the rail. */
	| "trigger";

/**
 * Whether the caret is still exactly where the palette left it.
 *
 * DOM-free: the caller passes the three elements it read. `paletteField` is the
 * node the palette captured on open - the box the user was in. Two of the three
 * answers are "nobody took it": nothing is focused at all (`active === null`,
 * which is a state a background tear-down produces) and the body (which is
 * where a removed node's focus goes). The third is the captured field itself,
 * which happens whenever the flow did not replace it: the palette's own field
 * never held it in that case, so there was nothing to take.
 *
 * The NEGATIVE is the case worth naming: another text field - one the user
 * moved to during the flow - reads `false`, and the outcome table turns that
 * into `leave`. Asking the question this way rather than by matching a selector
 * against a list of overlays is deliberate: at close the palette's own field is
 * inside a `[role="dialog"]`, so any "an overlay owns focus" test would veto the
 * palette's own restore.
 */
export const caretIsUntouched = (
	paletteField: Element | null,
	active: Element | null,
	body: Element | null,
): boolean =>
	active === null ||
	active === body ||
	(paletteField !== null && active === paletteField);

/**
 * The whole rule, pure over observations.
 *
 * `viewMoved` is the pane identity the panel is keyed on
 * (`panelIdentityOfView`) at open versus now, so it answers "did the flow the
 * palette just ran move the view onto another conversation" - and it is the
 * pane's own key rather than a per-arm flag, because the three doors that move
 * the view from inside the palette (a session row, the New-chat row, any future
 * row that switches) must not each have to remember to set it.
 *
 * THE ORDER OF THE ARMS IS THE RULE, and the moved view decides FIRST.
 *
 * 1. `viewMoved` - and a moved view NEVER answers `captured`. When the view
 *    moved, the captured node is stale by construction in the only sense that
 *    matters here: it belongs to the pane the user has just left. Whether it is
 *    still CONNECTED is beside the point, and asking that first is how the rail
 *    door kept the defect. Open the palette by clicking the sidebar's Search
 *    row, pick a conversation: the node captured at open is that rail button,
 *    and the button survives the switch, so a `capturedUsable`-first rule put
 *    the caret back on the rail 8.6 ms after the destination composer had
 *    focused ITSELF - and every keystroke afterwards reached a button. So:
 *    - nobody has claimed the caret (`caretUntouched`) -> `composer`, the box
 *      the flow mounted takes it, with the rail as `handCaretToComposer`'s own
 *      fallback when there is nothing there yet;
 *    - the incoming composer (or any other field) already took it -> `leave`,
 *      which is the measured ordering in every entrance: the composer focuses
 *      itself 8-13 ms BEFORE this restore runs, and overriding that is the
 *      defect rather than the fix.
 * 2. a close that did NOT move the view is the pre-existing rule, byte for
 *    byte: the captured node is still usable -> `captured`, put it back. This
 *    is what preserves the Escape contract and the panel-exit path, and it is
 *    the arm the rail door used to (wrongly) fall into from a moved view.
 * 3. otherwise, if something else holds the caret, move nothing. This is
 *    strictly FEWER focus moves than the rule it replaces, so it cannot
 *    regress the unproven dialogs that can mount over the palette;
 * 4. otherwise fall through to the rail's Search row, never the body.
 *
 * The eight cells of the table are pinned in `scripts/palette-focus.test.mjs`,
 * including `{viewMoved: true, capturedUsable: true, caretUntouched: false}` -
 * the rail door's cell, and the one the `capturedUsable`-first rule got wrong.
 */
export const closeTimeFocusOutcome = (input: {
	viewMoved: boolean;
	/** `captured !== null && captured.isConnected && captured !== document.body`. */
	capturedUsable: boolean;
	caretUntouched: boolean;
}): CloseFocusOutcome => {
	if (input.viewMoved) return input.caretUntouched ? "composer" : "leave";
	if (input.capturedUsable) return "captured";
	if (!input.caretUntouched) return "leave";
	return "trigger";
};

/**
 * Give the caret to the mounted composer. `true` when it landed.
 *
 * `readOnly` is deliberately NOT a bail: a composer that refuses input still
 * holds the reader's own words, and the change that made it `readOnly` rather
 * than `disabled` exists precisely so such a box can hold the caret. `disabled`
 * is a bail because a disabled control cannot take focus at all, so asking it
 * and reporting the failure would leave the caller's fallback to do the honest
 * thing.
 *
 * The trade this makes when nothing is registered yet - the pane has committed
 * and its composer has not mounted - is `false` and the caller's rail fallback,
 * which is the same door the pre-existing rule fell back to. It is not a loss:
 * a mounting composer's own self-focus effect defers only to a focused
 * INPUT/TEXTAREA, and a button is neither.
 *
 * THE CHECK AND THE HAND-OFF NAME THE SAME NODE, through `composerField()`
 * (review round 1, NIT 1). They used to disagree: this read the document for
 * the first `textarea[aria-label="Message"]` and then focused whatever the
 * REGISTRY held, so with a second composer mounted anywhere - a story, a rig -
 * it could report `false` about a focus that had landed, sending the caller to
 * the rail for no reason. The registry is the single source of "the composer",
 * and it is the only one that can be focused by name.
 *
 * WHERE A REFUSED BOX MAY TAKE THE CARET, AND WHERE IT MAY NOT (UX round 1,
 * U4). This helper is the gesture's restore: the user picked a row and the flow
 * moved the view, so the caret has to end somewhere sensible, and `readOnly` is
 * deliberately not a bail because the refused box holds the reader's own words.
 * The composer's own MOUNT self-focus keeps its `!isInputDisabled` gate, and the
 * rule those two halves state is: a gesture-driven restore may land in a box
 * that refuses input, an UNPROMPTED focus grab may not - pulling the caret into
 * a box the app has just declared inert is the silent steal this module exists
 * to remove, and the gate is what stops a refusal landing mid-read from taking
 * the caret out of the transcript. It is the same rule from every door; what
 * differs is only whether a gesture asked for the caret.
 */
export const handCaretToComposer = (): boolean => {
	const field = composerField();
	if (!field || field.disabled) return false;
	focusComposer();
	return document.activeElement === field;
};
