/**
 * How long the Stop control's box stays reserved after the turn it belonged to
 * settles: the grace that keeps a reflex second press off the dictation control
 * without leaving a standing gap in the idle composer.
 *
 * THE MEASUREMENT THE WINDOW IS SIZED AGAINST. UX round 1's U1 and QA's Q1 found
 * the same hazard independently, on a build where the box was not reserved at
 * all: when the Stop leaves the row the dictation control moves into the exact
 * centre of the box the press had just landed in - 32px of control plus the
 * row's 4px gap, and it is the DICTATION control that moves rather than Send,
 * which is pinned to the row's right edge in every state - so a second press at
 * the same coordinates started a MICROPHONE RECORDING (`elementFromPoint` there
 * resolved to `button[aria-label="Start recording"]`, and a 120ms double press
 * still hit Stop twice, i.e. whether it hurt depended on how fast the second
 * press landed). Reserving the box permanently removes the hazard and costs the
 * idle composer a one-control gap between dictation and Send, which the operator
 * then reported as a defect of its own.
 *
 * THE REFLEX ITSELF IS 120-210ms, and the window is 500 because it is CHOSEN to
 * cover that plus the settle latency around it rather than derived from it: U1/Q1
 * measured a 120ms double press that still hit Stop twice, and this branch's own
 * record puts the re-press it is sized for at 161-170ms after the composer's own
 * flip with the release at 1776ms (`docs/evidence/interrupt-live/
 * interrupt-proof.json`, `slot.repress` and `slot.clusterSettled`). So
 * 170 < 500 < 1776: the window covers the reflex and a press the user makes
 * after seeing the turn end, and ends before the row has been still long enough
 * to read as settled-then-moving again.
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
 * control, which by then is where it is drawn. What the frames show about the
 * window is NOT "the row settles quietly inside it": the boxes do not settle in
 * the window at all. At 74ms they are still the busy row's (dictation 1235 /
 * box 1271 / Send 1307) and they become the idle row's (dictation 1271 / Send
 * 1307) only at the release, 1776ms in. What settles at the flip is the Stop glyph, the copy
 * and the ledger line - and the window's real cost is that the LAST visible
 * change is the one 500ms later, alone, after the row has otherwise stopped
 * moving (the arrival's own trade, in `docs/evidence/interrupt-live/README.md`).
 * Its length is still the right instrument: the reflex arrives at 161-170ms, so a
 * window short enough to hide the arrival would be inside the hazard it exists to
 * cover, while a longer one only moves the same arrival later.
 *
 * WHAT IS DELIBERATELY NOT DONE, because a control that lies is worse than a
 * gap: the recording action is never refused, gated or greyed. The dictation
 * control stays visible, live and pressable at every instant - during the grace
 * it is at its busy position, which is the row the operator sees today - and the
 * grace only decides whether the CONTROL's box holds an invisible placeholder
 * beside it.
 *
 * ONE FRAME OF `active` IS ENOUGH TO RESTART THE WINDOW, and that is deliberate
 * rather than papered over. QA round 1 (Q1) and UX round 1 (U4) both sampled a
 * single frame in which the Stop control is re-rendered and the box is gone, a
 * few milliseconds after a turn settles - and the box and the control are
 * mutually exclusive by construction, so a transient re-derivation of `active`
 * shows up exactly that way. The fold below treats it as any other edge: the
 * pulse drops the live deadline, and its own true -> false edge opens a FRESH
 * window, so the arrival is bounded at one window after the pulse and the hazard
 * stays closed throughout (while the pulse is up the point belongs to the Stop,
 * never to the dictation control). `scripts/interrupt-control.test.mjs` replays
 * that measured sequence so a change that made the pulse unbounded or silent is
 * visible there. What is NOT done about it: a debounce or a minimum-hold
 * heuristic, which would trade a measured, bounded delay for a rule nobody can
 * check against the tree.
 *
 * This module is pure and clock-injected so the window can be tested without a
 * browser; the composer's timer that re-reads it is the hook beside this file
 * (`hooks/use-interrupt-slot-hold.ts`), which runs these same rules against a
 * live tree.
 */

/**
 * The window, in milliseconds, the Stop control's box is held after the turn it
 * belonged to ends.
 *
 * CHOSEN, not derived: the reflex press U1/Q1 measured was a second press a
 * fraction of a second behind the first (120ms in their double-press probe, and
 * 161-170ms after the flip in this branch's own record), so the window is sized
 * to cover that plus the settle latency around it rather than read off a
 * measurement of it. Nothing in the app depends on this being a round number;
 * the header states what the number covers and what it costs.
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
