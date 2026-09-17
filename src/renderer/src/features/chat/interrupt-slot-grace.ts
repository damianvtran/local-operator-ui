/**
 * How long the Stop control's box stays reserved after the turn it belonged to
 * settles: the grace that keeps a reflex second press off the dictation control
 * without leaving a standing gap in the idle composer.
 *
 * THE MEASUREMENT THIS NUMBER COMES FROM. UX round 1's U1 and QA's Q1 found the
 * same hazard independently, on a build where the box was not reserved at all:
 * pressing Stop slid the dictation control 36px right - 32px of control plus the
 * row's 4px gap - into the exact centre of the box the press had just landed in,
 * so a second press at the same coordinates started a MICROPHONE RECORDING
 * (`elementFromPoint` there resolved to `button[aria-label="Start recording"]`,
 * and a 120ms double press still hit Stop twice, i.e. whether it hurt depended
 * on how fast the second press landed). Reserving the box permanently removes
 * the hazard and costs the idle composer a one-control gap between dictation and
 * Send, which the operator then reported as a defect of its own.
 *
 * WHY A GRACE RATHER THAN EITHER EXTREME. The geometry cannot have both: the
 * composer's right cluster is right-justified (`ml-auto`), so the dictation
 * control sits exactly one control-plus-gap - the Stop's own 32px plus the row's
 * 4px - further from Send while the Stop is rendered than when it is not, and a
 * settled idle row in which the two are adjacent necessarily moves the dictation
 * control into the vacated box. What a user
 * actually needs protection from is the seconds right after a turn ends, which
 * is when a reflex press is coming; a row that settles afterwards is a row
 * nobody is mid-double-press on. So the reservation is EMPTY rather than
 * permanent: held while a turn runs and for `INTERRUPT_SLOT_GRACE_MS` after it
 * ends, released to nothing once the row has settled.
 *
 * 500ms is a judgement, and its cost is stated rather than hidden: a second
 * press landing more than 500ms after the turn settles reaches the dictation
 * control, which by then is where it is drawn. It is short enough that a user
 * perceives the row as settled rather than as slow (the row's own layout the
 * eye is tracking settles well inside it), and long enough to cover the reflex
 * press the measurement above is about - the reported trap was a press that
 * followed the first by a fraction of a second, not one that followed it by a
 * second.
 *
 * WHAT IS DELIBERATELY NOT DONE, because a control that lies is worse than a
 * gap: the recording action is never refused, gated or greyed. The dictation
 * control stays visible, live and pressable at every instant - during the grace
 * it is at its busy position, which is the row the operator sees today - and the
 * grace only decides whether the CONTROL's box holds an invisible placeholder
 * beside it.
 *
 * This module is pure and clock-injected so the window can be tested without a
 * browser; the composer owns the timer that re-reads it (`message-input.tsx`).
 */

/**
 * The window, in milliseconds, the Stop control's box is held after the turn it
 * belonged to ends.
 *
 * Derived from the hazard it covers rather than chosen: the reflex press U1/Q1
 * measured was a second press a fraction of a second behind the first, which is
 * why this covers half a second and not a few frames. Nothing in the app depends
 * on this being a round number.
 */
export const INTERRUPT_SLOT_GRACE_MS = 500;

/** The box's hold: whether it is held, and the deadline it is held until. */
export type InterruptSlotHold = {
	/** Whether the box must be held at `now`. */
	held: boolean;
	/**
	 * The instant (same clock as `now`) the hold expires, or null when no
	 * deadline is live. Held in a deadline rather than a boolean so that folding
	 * the same inputs twice cannot lose or extend the window.
	 */
	heldUntil: number | null;
};

/**
 * Fold one sample of the Stop control's own `active` into the previous one, and
 * answer whether its box is held.
 *
 * TOTAL AND IDEMPOTENT, which is the whole reason it takes `previousActive` and
 * `heldUntil` rather than reading component state: folding the same four inputs
 * twice gives the same answer, so a caller that runs it on a mount, on a
 * re-render in a double-invoked effect, or twice for one transition cannot
 * shorten the window, extend it, or open one that was never opened.
 *
 * A FRESHLY MOUNTED IDLE COMPOSER HOLDS NOTHING: `previousActive` and
 * `currentActive` are both false with no deadline, which is the settled state,
 * so mounting the composer never renders a reservation.
 */
export function interruptSlotHold({
	previousActive,
	currentActive,
	heldUntil,
	now,
	graceMs = INTERRUPT_SLOT_GRACE_MS,
}: {
	/** Whether the control was rendered at the previous observation. */
	previousActive: boolean;
	/** Whether the control is rendered now. */
	currentActive: boolean;
	/** The deadline a previous fold returned, or null. */
	heldUntil: number | null;
	/** The current instant, in milliseconds. */
	now: number;
	/** Override for the window; the shipped value is `INTERRUPT_SLOT_GRACE_MS`. */
	graceMs?: number;
}): InterruptSlotHold {
	// A running turn fills the box with the control itself, so there is nothing
	// to hold and no deadline to remember: the next fold must be the one that
	// opens the window, and it opens it from the true -> false edge below.
	if (currentActive) return { held: true, heldUntil: null };
	// The edge that matters: the control just left the row, and this is the
	// instant the reflex press the measurement is about is aimed at.
	if (previousActive) return { held: true, heldUntil: now + graceMs };
	// Settled: inside a live window, or with no window at all.
	if (heldUntil !== null && now < heldUntil) return { held: true, heldUntil };
	return { held: false, heldUntil: null };
}
