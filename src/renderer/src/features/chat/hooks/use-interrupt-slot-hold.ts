import { useEffect, useRef, useState } from "react";
import {
	type InterruptSlotHold,
	interruptSlotHold,
} from "../interrupt-slot-grace";

/*
 * The Stop control's box, held on a clock rather than as a standing reservation.
 *
 * WHY THIS IS A HOOK AND NOT FIVE LINES IN THE COMPOSER. The rules are
 * `interruptSlotHold`'s (pure, clock-injected, and tested without a browser);
 * this is the half a pure module cannot describe - arm ONE timer per edge, drop
 * a live deadline when the control comes back, never fire on mount, and dispose
 * the timer with the composer. A code-review round asked for that half to be a
 * result rather than a reading (`scripts/interrupt-slot-hold-react.test.mjs`
 * drives the measured edge sequence through it), and it is separable for the
 * same reason the fold is: the composer is a 3,000-line component that no
 * harness can mount, and a timer nobody can test is a timer nobody can keep.
 *
 * THE EDGE COMES FROM A REF, not from state: what opens the window is a
 * TRANSITION - the control was rendered and now is not - which no single render
 * can answer. The fold itself is idempotent, so a double-invoked effect (React's
 * development StrictMode) cannot shorten the window, extend it, or open one that
 * was never opened; a freshly mounted idle composer folds (false, false, no
 * deadline) and holds nothing.
 *
 * THE TIMER IS CLEARED BEFORE EVERY REPLACEMENT rather than by the effect's own
 * cleanup. The effect re-runs when the state it just set lands (`hold` is in the
 * dependencies, because the fold reads its deadline), and a cleanup responsible
 * for the timer would cancel the window the same run had opened. Disposal is the
 * unmount-only effect's job. Both are load-bearing: the first is why the window
 * survives its own re-render, the second is why nothing calls `setState` on a
 * composer that has gone away.
 *
 * ONE FRAME OF THE CONTROL'S OWN STATE RESTARTS THE WINDOW, and this hook does
 * not filter it: `interrupt-slot-grace.ts` carries the measured sequence, why it
 * is an upstream re-derivation rather than something this wiring invents, and why
 * a debounce is deliberately not the answer.
 */
export function useInterruptSlotHold(active: boolean): InterruptSlotHold {
	const [hold, setHold] = useState<InterruptSlotHold>({
		held: false,
		heldUntil: null,
	});
	const previousActiveRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const now = Date.now();
		const next = interruptSlotHold({
			previousActive: previousActiveRef.current,
			currentActive: active,
			heldUntil: hold.heldUntil,
			now,
		});
		previousActiveRef.current = active;
		// Equal values are what makes the self-feeding effect terminate: a re-run
		// folds the same inputs to the same answer and returns without a re-render.
		if (next.held === hold.held && next.heldUntil === hold.heldUntil) return;
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setHold(next);
		if (next.heldUntil !== null) {
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				setHold({ held: false, heldUntil: null });
			}, next.heldUntil - now);
		}
	}, [active, hold]);

	useEffect(
		() => () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		},
		[],
	);

	return hold;
}
