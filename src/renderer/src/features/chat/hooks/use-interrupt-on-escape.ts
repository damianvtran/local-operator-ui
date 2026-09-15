/**
 * Escape interrupts the running turn.
 *
 * ONE listener for the whole document, with a stated predicate, rather than a
 * handler per surface. Every layer that must win already claims the press, so
 * this one inherits the precedence instead of re-deriving it - and the ladder
 * below is where that precedence is written down, because a rule about who owns
 * a key is only honest if it is one rule in one place.
 *
 * THE LADDER, highest claim first:
 *
 * 1. Radix layers - dialog, menu, select, popover, tooltip, the picker host, the
 *    command palette, credential and MCP dialogs. `DismissableLayer` calls
 *    `preventDefault` from a CAPTURE-phase listener on the document
 *    (`react-dismissable-layer`'s `handleKeyDown`, `{ capture: true }`), which is
 *    why every capture listener here runs before this one.
 * 2. The canvas: the inline edit and the document viewer. Both bind on `window`
 *    and call `preventDefault` (see `canvas/inline-edit.tsx`, which documents
 *    yielding to ANY dismissable layer, and `canvas/index.tsx`).
 * 3. The run panel and its child reader (`run-panel.tsx` § 3.5). It binds on the
 *    DOCUMENT and calls `stopPropagation`, and this listener is bound on
 *    `window` precisely so that claim works: `stopPropagation` on a document
 *    listener does not stop other listeners on the DOCUMENT (only
 *    `stopImmediatePropagation` does), and the pane's effect registers before
 *    this one because it is a DESCENDANT - React flushes child effects before
 *    parent ones on mount. Bound on `document`, the pane and this hook would
 *    both act on one press.
 * 4. VOICE RECORDING CANCEL. Esc during a recording cancels the recording and
 *    never the turn. This is the one that bites, and it is why the decision below
 *    is taken in a MICROTASK rather than at listener time - see the note there.
 * 5. The slash autocomplete (`slash-contract.ts`'s `Escape` intent). It is a
 *    React handler on the composer's textarea, so it runs during the delegated
 *    dispatch - before this listener - and it calls `preventDefault`, which the
 *    early check already sees.
 * 6. The sidebar's search field and the working-directory chip's inline edit.
 *    Both consume Escape in a React handler that calls NO `preventDefault` -
 *    `chat-sidebar.tsx` clears the query and blurs, `directory-indicator.tsx`
 *    cancels the edit - so they cannot be inherited and are named by the
 *    `ownsEscapeOutsideComposer` rule below instead. That is a finding, not a
 *    preference: the rule exists because those two surfaces claim the key
 *    without announcing it, and the alternative - editing two components this
 *    change has no other business in - would have been the larger diff.
 * 7. This listener: the turn interrupt.
 * 8. Nothing running. Do nothing, and specifically do NOT clear the composer:
 *    the TUI states that as a hard rule, and a half-written message is not the
 *    interrupt's to discard.
 *
 * WHAT THIS IS NOT: it is not `sessions.stop`, which is the kill switch one rung
 * up, and it is not a ladder of its own. The desktop has no
 * `DOUBLE_STOP_WINDOW_S` and nowhere that would render "press again", so there
 * is nothing for a second press to escalate to - and there does not need to be,
 * because a second press is a no-op with nothing left to stop and the control
 * leaves the DOM as `busy` goes false.
 */

import { useEffect } from "react";
import { COMPOSER_TEXTAREA_SELECTOR } from "../composer-field";

/**
 * What the predicate reads.
 *
 * `busy` is the SAME `canonical.frontend?.streaming === true` the Stop control
 * reads, because a key and a button that answer the same question from two
 * readings is a pair that will eventually disagree.
 */
export type InterruptEscapeState = {
	sessionId: string | null | undefined;
	busy: boolean;
	/** Whether this backend advertises `session_interrupt` at all. */
	available: boolean;
};

/** The subset of a keyboard event the predicate reads, for tests. */
export type InterruptEscapeEvent = {
	key: string;
	defaultPrevented: boolean;
	isComposing?: boolean;
	target: EventTarget | null;
};

/**
 * Fields that own Escape for themselves.
 *
 * The composer's textarea is the ONE exception, and it is the whole feature: the
 * user types there, so a rule that deferred to every text field would make the
 * interrupt unreachable from the place it is most wanted. The composer's own
 * Escape behaviours (the slash popup) announce themselves with `preventDefault`,
 * so they are already handled above rather than by this rule.
 *
 * Exported because `interrupt-control.test.mjs` drives this rule at node level,
 * where there is no DOM: a second copy of the selector in the test would pin the
 * test's own string rather than the shipped one.
 */
export const ESCAPE_OWNING_FIELDS =
	"input, textarea, select, [contenteditable]";

/**
 * Whether the press belongs to a field rather than to the turn.
 *
 * A test of the EVENT TARGET rather than of `document.activeElement`, which is
 * the same choice `run-panel.tsx` makes and for the same reason: a synthetic key
 * event carries its own target.
 *
 * `closest` is asked for as a FUNCTION rather than tested with `instanceof
 * Element`, which covers the same real cases (a keydown target is an element,
 * and a text node, the document or a targetless synthetic event owns nothing)
 * and is the only form the node-level test can drive - the DOM here is a test's
 * stand-in, and a stub that had to be an `Element` could not be one.
 */
export function ownsEscapeOutsideComposer(target: EventTarget | null): boolean {
	const closest = (
		target as { closest?: (selector: string) => unknown } | null | undefined
	)?.closest;
	if (typeof closest !== "function") return false;
	const field = closest.call(target, ESCAPE_OWNING_FIELDS) as {
		closest?: (selector: string) => unknown;
	} | null;
	if (!field) return false;
	const owner = field.closest?.(COMPOSER_TEXTAREA_SELECTOR);
	return owner === null || owner === undefined;
}

/**
 * The predicate, exactly: Escape, unclaimed, not mid-composition, a session, and
 * a turn actually running.
 *
 * `isComposing` is checked because an IME uses Escape to cancel a candidate
 * string: interrupting a turn on that press would stop work the user never
 * asked to stop, and the composer's own submit path runs the same guard
 * (`event.nativeEvent.isComposing`).
 */
export function interruptEscapeApplies(
	event: InterruptEscapeEvent,
	state: InterruptEscapeState,
): boolean {
	return (
		event.key === "Escape" &&
		!event.defaultPrevented &&
		!event.isComposing &&
		Boolean(state.sessionId) &&
		state.busy &&
		state.available &&
		!ownsEscapeOutsideComposer(event.target)
	);
}

/**
 * Run the interrupt for a press the predicate accepted.
 *
 * THE MICROTASK IS NOT DECORATION. Bubble-phase listeners on `window` run in
 * REGISTRATION order, and this hook mounts with the panel - before any dialog,
 * palette, canvas edit or recording that opens later adds its own `window`
 * listener. Reading `defaultPrevented` at listener time would therefore answer
 * "nothing claimed this" for precisely the layers bound after it, and the
 * recording cancel is the one that would be measurably wrong: Esc during a
 * recording would stop the turn instead of the recording. Deferring one
 * microtask lets the whole dispatch finish first, and `defaultPrevented` stays
 * readable on the event object afterwards, so the answer is the one every layer
 * agrees on. Nothing is lost: a microtask runs before the next task, and the
 * press is not re-checked against anything that could have moved in between.
 *
 * `preventDefault` is deliberately NOT called. Up front it would be
 * indistinguishable from a layer's own claim and would blind the check above;
 * afterwards it is a no-op, because the key's default action is already over.
 * Nothing in this app gives Escape a default action worth cancelling.
 *
 * The return value is whether the interrupt was SCHEDULED, so a caller can see
 * that the press was accepted; it is not a claim that the request succeeded.
 */
export function dispatchInterruptOnEscape(
	event: InterruptEscapeEvent,
	state: InterruptEscapeState,
	onInterrupt: () => void,
): boolean {
	if (!interruptEscapeApplies(event, state)) return false;
	queueMicrotask(() => {
		if (event.defaultPrevented) return;
		onInterrupt();
	});
	return true;
}

/**
 * Attach the one listener. Consumed by the component that owns `stop` and
 * `busy`, so the key and the button are the same decision.
 */
export function useInterruptOnEscape({
	sessionId,
	busy,
	available,
	onInterrupt,
}: InterruptEscapeState & { onInterrupt: () => void }): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) =>
			void dispatchInterruptOnEscape(
				event,
				{ sessionId, busy, available },
				onInterrupt,
			);
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [sessionId, busy, available, onInterrupt]);
}
