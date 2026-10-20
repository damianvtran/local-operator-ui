/**
 * The per-conversation picker's Escape decision, as a pure function.
 *
 * WHY IT IS SEPARATE FROM THE DIALOG: this is the one branch of the picker that
 * has to be checkable without mounting Radix. Driving two Escapes through the
 * real dialog in jsdom allocates without bound (the desktop runner killed the
 * group well past its budget after the rest of the suite had passed), and the
 * decision itself is state, not a DOM fact: two booleans in, one action out.
 *
 * THE THREE OUTCOMES ARE EACH LOAD-BEARING:
 * - `ignore` while a write is in flight. Closing mid-write would hide the
 *   failure or the rollback that is about to arrive, so the press is swallowed.
 * - `collapse` while the suggestion list is open. Escape closes the list first;
 *   that is navigation, not dismissal.
 * - `close` once the list is closed. The handler leaves the event UNPREVENTED so
 *   the dialog layer dismisses it; this function never calls anything.
 *
 * ESCAPE NEVER WRITES. Nothing here, and nothing in the handler that calls it,
 * touches ids, primary or the tag store. There is no staged draft for Escape to
 * discard, so it cannot revert a committed selection - the surface offers no
 * undo, and a press can only narrow or dismiss what is on screen.
 */
export type PickerEscapeAction = "ignore" | "collapse" | "close";

export function nextPickerEscapeAction({
	pending,
	listOpen,
}: {
	pending: boolean;
	listOpen: boolean;
}): PickerEscapeAction {
	if (pending) return "ignore";
	return listOpen ? "collapse" : "close";
}
