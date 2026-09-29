/**
 * When a click on the transcript's own blank space hands the caret to the
 * composer, and the guards that keep it from stealing one (issue #661).
 *
 * WHAT THIS RULES ON. Clicking an empty part of the transcript — below the last
 * row, the padding around the column, the placeholder ground — moves focus
 * nowhere today, so the next keystroke reaches no one until the reader clicks
 * the box. In a single-conversation window the composer is the only sensible
 * focus target for a press that landed on no control, so the transcript's own
 * container forwards it through the composer's one door (`composer-field.ts`,
 * the same hand-off the Quote toolkit uses).
 *
 * WHICH GUARDS, AND WHY EACH IS HERE. A focus grab is easy to get wrong in the
 * direction that loses the reader something, so a click focuses only when all
 * of these are false:
 *
 * - **control** — the press or the click landed on a control (`button`, `a`,
 *   `input`, `textarea`, `[role="button"]`, `[contenteditable]`). The control's
 *   own activation is the whole interaction; a caret moved beside it afterwards
 *   is the "clicked Copy and the keyboard went to the composer" defect.
 *   Both the PRESS's target and the CLICK's target are asked, because a
 *   press that begins on a control and ends elsewhere still synthesises its
 *   click on the common ancestor.
 * - **modal** — a dialog or sheet is open. While one is up its overlay owns
 *   the screen, so this is normally unreachable and is a belt for the paths
 *   that are not: a modal that closes on the same press it received, and any
 *   future non-modal overlay drawn over the chat.
 * - **selection** — transcript text is selected, or was when the press began.
 *   Selecting text to copy is the transcript's most common pointer gesture, and
 *   the click that ends it must not move the caret. BOTH readings are needed
 *   because the browser collapses the selection on mousedown and the `click`
 *   that follows is too late to see it, while a drag-select ends with a fresh
 *   non-collapsed selection and no press-time reading of it.
 * - **drag** — the pointer travelled more than `TRANSCRIPT_DRAG_SLOP_PX`
 *   between press and click. That is what a scrollbar drag, a selection drag
 *   and a touch drag all look like at this container; none of them is a click
 *   on blank space even though the browser may still emit one.
 * - **scroll** — a wheel notch arrived within `TRANSCRIPT_WHEEL_GUARD_MS` of
 *   the click. A trackpad scroll never synthesises a click by itself, but the
 *   tap that STOPS a momentum scroll does, and that tap is the scroll's own
 *   gesture, not a request for the caret.
 *
 * A module of its own, following `composer-caret.ts`, `sidebar-focus-hold.ts`
 * and `keyboard-scopes.ts`: the decision is pure over the observations, so
 * `scripts/transcript-focus.test.mjs` pins every guard as a table row instead
 * of as a browser run, and the DOM half stays a translation layer in
 * `canonical-transcript.tsx` with no policy in it. It imports nothing, so the
 * test bundles it alone.
 */

/**
 * Elements whose press is their own. The same vocabulary the issue names, and
 * deliberately not wider: a row carries no other interactive role the app
 * treats as a control.
 */
export const TRANSCRIPT_CONTROL_SELECTOR =
	'button, a, input, textarea, [role="button"], [contenteditable]';

/**
 * An open modal as the DOM declares it: a Radix dialog — and a sheet IS a
 * Radix dialog — in the open state. Read rather than inferred from a store,
 * because the dialog the guard must see may belong to a subtree this component
 * never renders.
 */
export const TRANSCRIPT_MODAL_SELECTOR =
	'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/**
 * Pointer travel, in px, past which the gesture is a drag rather than a click.
 *
 * Four, matching `mesh-drag.ts`'s `DRAG_THRESHOLD_PX` for the same reason: it
 * is a hand's tremor, not a movement. A drag that scrolls or selects travels
 * tens of pixels; a click with a pixel or two of wobble must still focus.
 */
export const TRANSCRIPT_DRAG_SLOP_PX = 4;

/**
 * How soon after a wheel notch a click still counts as that scroll's gesture.
 *
 * Momentum emits notches for as long as it runs, so the tap that stops it
 * arrives well within this window and is absorbed; a reader who scrolled and
 * then deliberately clicked blank space waits longer than this and keeps the
 * caret hand-off. 200 ms is under the tap-stop interval of a decaying momentum
 * (a notch per frame, so the last one precedes the tap by well under it) and
 * above the fastest deliberate "scroll, then click" the hand produces.
 */
export const TRANSCRIPT_WHEEL_GUARD_MS = 200;

/**
 * Whether the target of a press or click is one of the app's own controls.
 *
 * `true` when the target cannot answer the question at all (not an element, no
 * `closest`) rather than `false`: a target whose nature cannot be read is not
 * one this rule may call blank space, and the failure direction that costs the
 * reader something is stealing the caret, not withholding it.
 */
export const clickTargetIsControl = (target: EventTarget | null): boolean => {
	const element = target as { closest?: (selector: string) => unknown } | null;
	if (typeof element?.closest !== "function") return true;
	return element.closest(TRANSCRIPT_CONTROL_SELECTOR) !== null;
};

/** Whether an open dialog or sheet is in `root`. */
export const modalIsOpen = (root: Pick<ParentNode, "querySelector">): boolean =>
	root.querySelector(TRANSCRIPT_MODAL_SELECTOR) !== null;

/**
 * Whether a wheel notch at `wheelAt` is close enough to `clickAt` to be the
 * gesture the click belongs to. `lastWheelAt` starts at -Infinity so a click
 * before any notch is always a click.
 */
export const wheelWithinGuard = (wheelAt: number, clickAt: number): boolean =>
	clickAt - wheelAt < TRANSCRIPT_WHEEL_GUARD_MS;

/** What a click on the transcript resolves to. */
export type TranscriptClickVerdict =
	/** Blank space: hand the caret to the composer. */
	| "focus"
	/** A control received the press. */
	| "control"
	/** A dialog or sheet is open. */
	| "modal"
	/** Transcript text is selected, or was when the press began. */
	| "selection"
	/** The press travelled: a scrollbar, selection or touch drag ended here. */
	| "drag"
	/** A wheel notch is still in flight: this is the scroll gesture's own click. */
	| "scroll";

/**
 * The whole rule, pure over the observations the container reads.
 *
 * The order names the guard when several apply — and the reason is returned
 * rather than a boolean so the tests assert WHICH guard fired, which is the
 * part a later edit breaks silently.
 */
export const transcriptClickVerdict = (facts: {
	/** A control received the press: the click's target or the press's own. */
	controlPress: boolean;
	/** A dialog or sheet is open. */
	modalOpen: boolean;
	/** A non-collapsed selection was present in the transcript at press time. */
	pressHadSelection: boolean;
	/** A non-collapsed selection in the transcript is present at click time. */
	selectionNotCollapsed: boolean;
	/** The pointer travelled past `TRANSCRIPT_DRAG_SLOP_PX` between press and click. */
	dragged: boolean;
	/** A wheel notch arrived within `TRANSCRIPT_WHEEL_GUARD_MS` of the click. */
	scrolledRecently: boolean;
}): TranscriptClickVerdict => {
	if (facts.controlPress) return "control";
	if (facts.modalOpen) return "modal";
	if (facts.pressHadSelection || facts.selectionNotCollapsed)
		return "selection";
	if (facts.dragged) return "drag";
	if (facts.scrolledRecently) return "scroll";
	return "focus";
};
