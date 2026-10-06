import { HOVER_INTENT_MS } from "@shared/components/common/resizable-divider";
import { useCallback, useEffect, useRef } from "react";

/*
 * THE ROW'S POINTER-INTENT GATE (issue #840, `docs/design/sidebar-row-space.md`
 * §4/D3 and §15/T1).
 *
 * WHAT IT REPLACES. The row's per-row acts (the pin/archive pair wrapper, the
 * archive button, the pin button and #697's drag grip) used to reveal on the
 * row's bare `group-hover` - i.e. on the FIRST frame the pointer was anywhere on
 * the row. `docs/design/sidebar-row-space.md` §15/T1 deferred a dwell for those
 * controls because "a CSS-only version cannot express 'after the pointer has
 * dwelt here'"; the operator's report then recorded the cost of that deferral (a
 * click on its way to SELECTING a row meets a control that has just arrived), so
 * the tradeoff is reopened and the dwell is adopted here.
 *
 * THE DWELL IS THE APP'S OWN HOVER-INTENT CONSTANT, not a new number: the
 * sidebar's collapse cluster and the panel dividers already reveal on
 * `HOVER_INTENT_MS` (`shared/components/common/resizable-divider.tsx`), and one
 * number for "the pointer has decided to stay" is the rule the title's own dwell
 * (`TOOLTIP_DELAY_MS`, 400ms) is written under too. The two are deliberately
 * different numbers and the ORDER between them is load-bearing: the acts reveal
 * at ~200ms and the pan measures the HOVERED box at ~400ms, so the title the pan
 * gives back is the narrowed one (`chat-row-title.tsx`'s `startPan`).
 *
 * WHY A MOUNTED COMPONENT. The row is built by a plain render function
 * (`sessionRow` in `chat-sidebar.tsx`), where a hook would run a different number
 * of times per render - the constraint `silentRemedyId` and `chat-row-title.tsx`
 * both record. So the per-row dwell state lives here, in the one shape that can
 * hold it: a component mounted once per row, exactly as the title's own pan does.
 *
 * HOW IT REACHES THE ROW. It renders a `hidden` anchor and resolves the row from
 * it (`closest('[data-session-row]')`), the same ancestry `chat-row-title.tsx`
 * walks. It does NOT render the acts' classes itself - the reveal has to compose
 * with the keyboard path and with each control's own state, so the gate is an
 * ATTRIBUTE the row box carries and the controls read through Tailwind's
 * `group-data-[...]` variant (the row box is the `group`). That keeps the dwell
 * in one place and the reveal where the controls already are.
 *
 * IT IS NOT MOTION, so it is NOT suppressed under `prefers-reduced-motion`: a
 * `display` switch with no transition is not one of the four properties
 * `docs/branding.md` § 5 animates, and a reader who has asked for less motion
 * still needs the acts to arrive. The gate widens the gap between the pointer
 * arriving and the acts arriving; it does not add a frame of motion to either.
 *
 * THE ANCHOR IS `hidden` (`display: none`), so it is out of the row's flex
 * layout entirely - it takes no width, creates no gap, and cannot be reached or
 * read by any user.
 */

/**
 * The attribute the row's acts reveal on. The `group-data-[session-hover-intent]`
 * class strings in `chat-sidebar.tsx` are its readers; Tailwind needs them
 * written literally, so this constant is the writer's half of that contract and
 * `scripts/chat-sidebar-hover-intent.test.mjs` pins the two together.
 */
export const ROW_HOVER_INTENT_ATTRIBUTE = "data-session-hover-intent";

export function ChatRowHoverIntent() {
	const hostRef = useRef<HTMLElement | null>(null);
	const timerRef = useRef<number | null>(null);
	const detachRef = useRef<(() => void) | null>(null);

	/**
	 * The rest state, in one step: no pending dwell, no attribute. It is also the
	 * ENTRY path's first move, which is what makes a re-entering pointer re-arm
	 * from rest and wait a FRESH interval rather than inherit the last one.
	 */
	const reset = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		hostRef.current?.removeAttribute(ROW_HOVER_INTENT_ATTRIBUTE);
	}, []);

	/**
	 * A ref CALLBACK rather than an effect, for the reason `chat-row-title.tsx`
	 * records: the row's DOM ancestry is not stable across the row's life, so
	 * listeners keyed on nothing can end up on a node that has left the document.
	 * The callback re-attaches whenever React hands it a new node.
	 */
	const attach = useCallback(
		(node: HTMLSpanElement | null) => {
			detachRef.current?.();
			detachRef.current = null;
			if (!node) return;
			/*
			 * The row's own box is the host: it is the element that carries `group`
			 * (so it is the one the controls read), and it wraps both the button and
			 * the acts, so moving from the title onto a revealed control never leaves
			 * it. The button fallback covers the withdrawn branch, where the button
			 * IS the whole row - that branch draws no acts, so the gate is inert
			 * there and the fallback only keeps the ancestry walk total.
			 */
			const host =
				node.closest<HTMLElement>("[data-session-row]") ??
				node.closest<HTMLElement>("button[data-chat-row]");
			if (!host) return;
			hostRef.current = host;
			const onEnter = () => {
				reset();
				timerRef.current = window.setTimeout(() => {
					timerRef.current = null;
					host.setAttribute(ROW_HOVER_INTENT_ATTRIBUTE, "");
				}, HOVER_INTENT_MS);
			};
			const onLeave = () => reset();
			host.addEventListener("pointerenter", onEnter);
			host.addEventListener("pointerleave", onLeave);
			detachRef.current = () => {
				host.removeEventListener("pointerenter", onEnter);
				host.removeEventListener("pointerleave", onLeave);
				hostRef.current = null;
				reset();
			};
		},
		[reset],
	);

	/* Nothing may outlive the row: a pending dwell would write to a detached node. */
	useEffect(() => () => detachRef.current?.(), []);

	return <span ref={attach} hidden />;
}
