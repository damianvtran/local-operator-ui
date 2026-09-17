/**
 * Which link on a canonical turn the toolbar is about, and nothing else.
 *
 * ONE SUBJECT PER ROW, DECIDED IN ONE PLACE. The alternative - each link owning
 * its own hover state - is the shape that produces two toolbars on screen at
 * once, or a toolbar left behind by a link that scrolled away, because no link
 * can see its neighbours. Here the row asks the DOM a single question per event
 * ("what is the pointer over, what is highlighted") and holds the answer, so
 * "one toolbar at a time" is a property of the state rather than of five
 * components agreeing.
 *
 * THE SUBJECT IS THE ELEMENT, not an href or an index. Two links can carry the
 * same href (`~/x` twice in one answer) and a streaming row re-renders per
 * delta, so an index would address a different link after a re-render and an
 * href cannot tell them apart at all. Identity also makes the state update free:
 * `setSubject` bails out when the element is the same, so a pointer moving
 * within one link, or a scroll, re-renders nothing.
 *
 * A HIGHLIGHT OUTRANKS THE POINTER, and that ordering is what keeps a quote
 * attributed to the link it came from. A drag that ends on a link leaves the
 * pointer over it, so a pointer-first rule would raise the DRAGGED-OVER link's
 * toolbar with a Quote button for a highlight that came from somewhere else.
 * The selection-first order makes the state machine:
 *
 * | the reader's state | the row's subject |
 * |---|---|
 * | pointer over a link, nothing highlighted | that link |
 * | a highlight wholly inside a link | that link, Quote offered |
 * | a highlight that leaves a link (spans prose, or two links, or two turns) | none - the turn's own Quote control |
 * | a link focused with Tab | that link |
 * | nothing | none |
 *
 * The third row is deliberate rather than a gap: `quote-model.ts` already owns
 * the cross-turn case and the turn's own control answers it, and this hook has
 * nothing to add to a highlight it cannot attribute to exactly one link.
 *
 * TWO MEMBERS ARE UNMOUNTED RATHER THAN HIDDEN, which is the accessibility rule
 * the quote control's own comment states: nothing invisible is ever in the tab
 * order. The row renders the toolbar only for a subject, and the hook is careful
 * to publish `null` rather than a stale element.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	LINK_TARGET_SELECTOR,
	hasHighlight,
	selectionLinkIn,
} from "../utils/link-actions";
import { QUOTE_TOOLKIT_ATTR } from "./quote-model";

/**
 * The toolbar's own marker, on top of the `QUOTE_TOOLKIT_ATTR` its shell shares.
 *
 * Shared with the quote control's attr because that attribute is what keeps a
 * dragged-over control out of a quote (`quote-model.ts`) - one attribute, one
 * meaning, and a toolbar that joined a quote would be the defect that comment
 * describes. This second name is what the keyboard path uses to find the
 * toolbar's own buttons, which the shared attribute cannot express.
 */
export const LINK_TOOLBAR_ATTR = "data-lo-link-toolbar";

export type LinkSubjectState = {
	/** The link the toolbar is about, or `null` when nothing is. */
	subject: Element | null;
	/** The reader's highlight lies wholly inside `subject`, so Quote is offered. */
	quoteAvailable: boolean;
	/** Clear a pointer- or keyboard-owned subject; a highlight's is not affected. */
	dismiss: () => void;
};

export function useLinkSubject(turnRef: {
	readonly current: HTMLElement | null;
}): LinkSubjectState {
	const [subject, setSubject] = useState<Element | null>(null);
	const [quoteAvailable, setQuoteAvailable] = useState(false);
	/*
	 * What the POINTER or the KEYBOARD last chose, held in a ref rather than in
	 * state because it is not itself renderable: the renderable answer is the
	 * subject, and it depends on the highlight too. Keeping it in state would
	 * re-render the row on every pointer move across a link.
	 */
	const pinnedRef = useRef<Element | null>(null);

	const read = useCallback(() => {
		const turn = turnRef.current;
		if (!turn) {
			pinnedRef.current = null;
			setSubject((previous) => (previous === null ? previous : null));
			setQuoteAvailable((previous) => (previous === false ? previous : false));
			return;
		}
		const highlighted = selectionLinkIn(turn);
		if (highlighted) {
			setSubject((previous) =>
				previous === highlighted ? previous : highlighted,
			);
			setQuoteAvailable((previous) => (previous === true ? previous : true));
			return;
		}
		setQuoteAvailable((previous) => (previous === false ? previous : false));
		/*
		 * A highlight that is not wholly inside a link takes the toolbar away rather
		 * than leaving the hovered one up: the reader is mid-gesture, and a strip that
		 * keeps offering Copy over a growing selection is noise on the one surface
		 * that repaints while they drag. It is also what makes the state machine's
		 * spanning cases (a link and the prose beside it, two links, two turns) fall
		 * to the turn's own Quote control instead of to a link that owns half of it.
		 */
		if (hasHighlight()) {
			setSubject((previous) => (previous === null ? previous : null));
			return;
		}
		const pinned =
			pinnedRef.current && turn.contains(pinnedRef.current)
				? pinnedRef.current
				: null;
		setSubject((previous) => (previous === pinned ? previous : pinned));
	}, [turnRef]);

	useEffect(() => {
		const turn = turnRef.current;
		if (!turn) return;

		const reveal = (link: Element | null) => {
			pinnedRef.current = link;
			read();
		};

		const onPointerOver = (event: Event) => {
			const target = event.target as Element | null;
			/*
			 * The pointer on the toolbar is still the reader pointing at the
			 * subject, so the subject stays: without this, moving one pixel up from
			 * a link onto the toolbar it just raised would unmount the toolbar
			 * before the press could land. `closest` on the shared quote attribute
			 * covers both toolbars - the link one here, and the turn's own Quote
			 * control, which sits inside this same turn element.
			 */
			if (target?.closest(`[${QUOTE_TOOLKIT_ATTR}]`)) return;
			reveal(target?.closest(LINK_TARGET_SELECTOR) ?? null);
		};

		const onPointerOut = (event: PointerEvent) => {
			const related = event.relatedTarget as Node | null;
			// Still inside the turn - another link, the prose, or the toolbar.
			if (related && turn.contains(related)) return;
			reveal(null);
		};

		const onFocusIn = (event: Event) => {
			const link = (event.target as Element | null)?.closest(
				LINK_TARGET_SELECTOR,
			);
			if (link) reveal(link);
		};

		const onFocusOut = (event: FocusEvent) => {
			const related = event.relatedTarget as Node | null;
			if (related && turn.contains(related)) return;
			reveal(null);
		};

		/*
		 * THE CONTEXT-MENU KEY, and `Shift+F10` with it: the keyboard's own way to
		 * ask "what can I do with this". The first button is focused rather than
		 * merely revealed, because a reader who reached for this key is asking to
		 * ACT, and Tab would otherwise be the next thing they have to press.
		 */
		const onKeyDown = (event: KeyboardEvent) => {
			const asked =
				event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
			if (!asked) return;
			const link = (event.target as Element | null)?.closest(
				LINK_TARGET_SELECTOR,
			);
			if (!link || !turn.contains(link)) return;
			event.preventDefault();
			reveal(link);
			/*
			 * The first button rather than merely revealed: a reader who reached for this
			 * key is asking to ACT, and Tab would otherwise be the next thing they have
			 * to press. The commit has happened by the next frame, because React flushes
			 * a discrete event's state update before it yields.
			 */
			requestAnimationFrame(() => {
				turn
					.querySelector<HTMLButtonElement>(`[${LINK_TOOLBAR_ATTR}] button`)
					?.focus();
			});
		};

		/*
		 * A press anywhere outside this turn is the reader moving on, and it
		 * clears the subject even when no pointerout follows (a click on the
		 * composer does not move the pointer out of the transcript's DOM first in
		 * every path). Captured, so a handler that stops propagation inside a row
		 * cannot keep a stale toolbar alive.
		 */
		const onPointerDown = (event: Event) => {
			const target = event.target as Node | null;
			if (target && turn.contains(target)) return;
			reveal(null);
		};

		turn.addEventListener("pointerover", onPointerOver);
		turn.addEventListener("pointerout", onPointerOut);
		turn.addEventListener("focusin", onFocusIn);
		turn.addEventListener("focusout", onFocusOut);
		turn.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("selectionchange", read);
		// A row can mount under a highlight that already exists: this pane is
		// windowed, and a scroll can bring a highlighted, already-selected row
		// back into the window.
		read();
		return () => {
			turn.removeEventListener("pointerover", onPointerOver);
			turn.removeEventListener("pointerout", onPointerOut);
			turn.removeEventListener("focusin", onFocusIn);
			turn.removeEventListener("focusout", onFocusOut);
			turn.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("selectionchange", read);
		};
	}, [turnRef, read]);

	const dismiss = useCallback(() => {
		pinnedRef.current = null;
		read();
	}, [read]);

	return { subject, quoteAvailable, dismiss };
}
