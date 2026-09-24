/**
 * The one hazard the row's archive control has that the pin's does not.
 *
 * Pinning moves a row to a section of its own; archiving REMOVES it from the
 * list. So a double-click on the reveal - or a second press from a hand that has
 * not moved since the first - lands on whatever row slid up into the vacated
 * slot, with the pointer already inside that row's own reveal. Without this
 * guard, one gesture archives two conversations, and the second is one the user
 * never chose (the pin work measured the same class of defect as U3: "a press
 * that repeats is not a new gesture").
 *
 * The rule is the pin's, deliberately, because it was arrived at by measurement
 * rather than by taste: a repeat is identified by IDENTITY *and* a small radius -
 * a press on a DIFFERENT conversation within `slopPx` of the last pointer press
 * is dropped - while a press on the same conversation is always the user's own
 * (it is a toggle back, and the control is where their finger is). The record is
 * expired by the pointer's own PATH (a move beyond the slop, or leaving the list)
 * rather than by a timer, because a hand that came back to the same pixels has
 * made a new gesture only after it moved, and the reflex this exists to protect
 * never leaves the two pixels between its two clicks.
 *
 * Pure and synchronous so it can be tested without a browser: the component holds
 * the record in a ref (`ArchivePressRecord | null`) and this module decides.
 */

/** How far the pointer may wander between two presses and still be one gesture. */
export const ARCHIVE_PRESS_SLOP_PX = 6;

export type ArchivePressRecord = {
	x: number;
	y: number;
	/** The conversation the last pointer press acted on. */
	sessionId: string;
};

export type ArchivePressOutcome = {
	/** Whether THIS press is a repeat of the last one on another row. */
	drop: boolean;
	/** What the caller should keep as the last pointer press. */
	record: ArchivePressRecord | null;
};

/**
 * Whether an incoming archive press should be dropped, and what to remember.
 *
 * `pointer === null` is the KEYBOARD (a click synthesised from Enter or Space
 * carries no position) and it is never dropped: it acts on the row that has
 * focus, which is by construction the row the user is on. It also does not clear
 * the record — a keyboard press re-orders the list exactly as a pointer press
 * does, so the pointer is left parked over a different conversation by it too,
 * and clearing here would disarm the guard for the very press it exists for.
 *
 * A DROPPED press does not advance the record either: the row under a parked
 * pointer is not the row the gesture was aimed at, and the hand has still not
 * moved, so recording the dropped row would let the hazard through on the next
 * click instead of refusing it for the whole gesture.
 */
export function archivePressOutcome(
	last: ArchivePressRecord | null,
	pointer: { x: number; y: number } | null,
	sessionId: string,
	slopPx: number = ARCHIVE_PRESS_SLOP_PX,
): ArchivePressOutcome {
	if (pointer === null) return { drop: false, record: last };
	if (
		last !== null &&
		Math.hypot(pointer.x - last.x, pointer.y - last.y) <= slopPx &&
		last.sessionId !== sessionId
	) {
		return { drop: true, record: last };
	}
	return { drop: false, record: { ...pointer, sessionId } };
}

/**
 * Whether a pointer that has moved to `pointer` makes the record stale.
 *
 * The expiry half, kept here rather than in the component so the rule has one
 * home: a record describes a gesture that has not moved since its press.
 */
export function archivePressExpired(
	last: ArchivePressRecord | null,
	pointer: { x: number; y: number },
	slopPx: number = ARCHIVE_PRESS_SLOP_PX,
): boolean {
	if (last === null) return false;
	return Math.hypot(pointer.x - last.x, pointer.y - last.y) > slopPx;
}
