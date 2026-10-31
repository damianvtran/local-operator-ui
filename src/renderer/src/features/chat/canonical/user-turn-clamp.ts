import { flushSync } from "react-dom";

/**
 * The long user-turn clamp's geometry rule and its one shared observer.
 *
 * ## Why the cap is CSS and the measurement only decides the control
 *
 * D2 caps a user turn at eight lines (`text-body` at 1.55 is 8 x 21.7 = 174px)
 * so a pasted brief or stack trace cannot own the pane. The first build of it
 * applied the cap only AFTER a layout read had found the box overflowing - but
 * an uncapped box never overflows, so the read always said "fits" and no turn
 * was ever clamped (measured on the 300-step session-switch fixture with
 * `?userLines=12`: 0 of 31 user rows capped, a 1,078-character turn painted at
 * 413px). Gating the cap on a measurement also guarantees a height JUMP on the
 * frame the measurement lands, which is exactly the layout shift the
 * conversation-first-paint project removes.
 *
 * So the collapsed box carries the cap from its very first paint, by class, and
 * a turn's first painted height is its settled height. What a measurement may
 * still decide is whether the `Show more` control EXISTS: a turn that fits
 * under the cap must not grow a control that reveals nothing.
 *
 * ## Why the rule compares against the constant, not `clientHeight`
 *
 * The answer has to be the same whether the box is collapsed or expanded: a turn
 * the reader left expanded is remounted expanded (`useTranscriptViewBoolean`
 * outlives the row's DOM slot), and an expanded box has no cap, so
 * `scrollHeight > clientHeight` would report "fits" and strand the reader with
 * no `Show less`. `scrollHeight` is the content's height in both states (the
 * box has no padding), so comparing it to the cap answers the same question
 * either way. The 1px slack absorbs sub-pixel line boxes, the slack the first
 * build used.
 *
 * `USER_TURN_CLAMP_PX` and the `max-h-[174px]` class at the call site are the
 * same number spelled twice because Tailwind only emits classes it can read
 * literally in source; `scripts/user-turn-clamp.test.mjs` pins that they agree.
 */
export const USER_TURN_CLAMP_PX = 174;

/** Whether a box whose content is `scrollHeight` tall is hiding anything under the cap. */
export function overflowsUserTurnClamp(scrollHeight: number): boolean {
	return scrollHeight > USER_TURN_CLAMP_PX + 1;
}

/*
 * ONE observer for every mounted user turn, rather than one per row, for what
 * changes AFTER the row's first decision (made in its layout effect, see the
 * call site): the column narrowing under a docked pane, a web font swapping in,
 * an image inside the markdown decoding. With the cap unconditional, a turn
 * that starts overflowing after mount would otherwise hide text behind no
 * control at all.
 *
 * Its notifications arrive in the frame's rendering step, after the browser's
 * own layout and before paint, so the reads here are clean and force nothing.
 * `flushSync` commits a changed answer inside that callback so the control
 * lands in the same painted frame as the resize, not one frame later; the one
 * callback carries every row, so it is one commit. Observing an element also
 * delivers an initial notification - it repeats the layout effect's answer, so
 * its setState is a no-op.
 *
 * WHY THE OPEN-PATH DECISION IS NOT MADE HERE. It was tried and measured (the
 * 300-step `?userLines=12` session-switch fixture): the browser runs
 * `requestAnimationFrame` callbacks and the transcript slot's own height cache
 * ahead of this observer, so 15 of 31 user rows were first seen at 230px (the
 * cap without the control) and settled at 264px, and the slot cache paid an
 * extra forced layout re-saving them. Deciding in the layout effect keeps that
 * at 0 changed rows.
 *
 * Observing the capped box is enough: content crossing the cap in either
 * direction changes the box's own height (`min(content, 174)` collapsed,
 * `content` expanded), and a column narrowing is a size change. Content
 * changing while ALREADY over the cap leaves the box at 174px, and cannot
 * change the answer either.
 */
type Listener = (overflows: boolean) => void;
const listeners = new WeakMap<Element, Listener>();
let observer: ResizeObserver | null = null;

export function observeUserTurnClamp(
	element: Element,
	listener: Listener,
): () => void {
	if (typeof ResizeObserver === "undefined") return () => {};
	observer ??= new ResizeObserver((entries) => {
		flushSync(() => {
			for (const entry of entries) {
				listeners.get(entry.target)?.(
					overflowsUserTurnClamp(entry.target.scrollHeight),
				);
			}
		});
	});
	listeners.set(element, listener);
	observer.observe(element);
	return () => {
		listeners.delete(element);
		observer?.unobserve(element);
	};
}
