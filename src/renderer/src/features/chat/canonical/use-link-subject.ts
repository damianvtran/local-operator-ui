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
 *
 * ## The pointer dwells, and the keyboard does not
 *
 * A POINTER has to REST on a link for `HOVER_DWELL_MS` before its toolbar is
 * raised. Round 1 (UX U6) measured the un-dwelled behaviour: sweeping the pointer
 * across a paragraph that names several paths re-mounted the strip for each one it
 * crossed, so the strip flashed and moved under a gesture the reader was not
 * aiming with. The dwell is short enough to read as immediate and long enough that
 * a sweep crosses without raising anything. Focus, the context-menu key and
 * `Shift+F10` are NOT delayed - a keyboard reader has already chosen, and a wait
 * there would be latency with nothing to protect.
 *
 * A subject raised by the pointer is also ESCAPE's to dismiss, which is why the
 * key is answered here rather than only inside the toolbar
 * (`link-toolkit.tsx` owns that half). With a pointer-raised strip, focus is
 * wherever it was - usually the body - so a listener on the toolbar would never
 * see the key at all, and the strip stayed up over the reader's text with no way
 * out (round 1, UX U2).
 *
 * ## The Tab contract
 *
 * `Tab` from a focused link enters THAT link's toolbar, `Shift+Tab` on the first
 * button goes back to the link, and `Tab` off the last button walks on to the
 * next link in the turn. The order is stated here because the DOM's own order
 * cannot express it: the toolbar is rendered ONCE per turn, after the markdown
 * body, so every one of the turn's buttons sits after every one of its links and
 * a plain Tab reaches the buttons of the LAST link only - earlier links' actions
 * were Tab-unreachable and `Shift+F10`, a key a Mac keyboard does not label, was
 * the only per-link route (round 1, UX U1).
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

/**
 * How long the pointer must rest on a link before its toolbar is raised.
 *
 * 120ms: long enough that a sweep across a paragraph does not raise a strip per
 * path it crosses, short enough to read as the same gesture as the pointer
 * arriving. It is deliberately NOT the tooltip's 400-700ms - a tooltip explains, a
 * toolbar acts, and the reader who has rested on a link wants the buttons.
 */
export const HOVER_DWELL_MS = 120;

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
	/**
	 * The published subject, for the callbacks that need its CURRENT value without
	 * being re-created when it changes (`dismiss`, which records it as the one
	 * `focusin` to ignore). Written during render rather than in an effect, so a
	 * callback fired by an event that follows this commit always reads this commit's
	 * value.
	 */
	const subjectRef = useRef<Element | null>(null);
	subjectRef.current = subject;
	/*
	 * What the POINTER or the KEYBOARD last chose, held in a ref rather than in
	 * state because it is not itself renderable: the renderable answer is the
	 * subject, and it depends on the highlight too. Keeping it in state would
	 * re-render the row on every pointer move across a link.
	 */
	const pinnedRef = useRef<Element | null>(null);

	/**
	 * The link whose next `focusin` is IGNORED, because a dismissal asked for it.
	 *
	 * Escape hides the strip AND hands focus back to the anchor (`link-toolkit.tsx`,
	 * and the contract in the module header) - and `focusin` is one of the events
	 * that REVEALS a link, so without this the strip is back one frame after it was
	 * dismissed: a dismissal the code undoes. One-shot, and cleared by a pointer
	 * arriving, because a reader who hovers that link again has asked for it again.
	 */
	const suppressedRef = useRef<Element | null>(null);

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

		/*
		 * The pointer's dwell (see the module header): `reveal` is deferred for a
		 * link and immediate for `null`, so leaving a link takes its toolbar away at
		 * once while arriving at one waits. A sweep that crosses five paths raises
		 * nothing, and the strip a reader sees always belongs to the link the pointer
		 * has actually stopped on.
		 */
		let dwell = 0;
		const reveal = (link: Element | null) => {
			if (dwell) {
				clearTimeout(dwell);
				dwell = 0;
			}
			pinnedRef.current = link;
			read();
		};
		const revealAfterDwell = (link: Element | null) => {
			if (dwell) clearTimeout(dwell);
			if (!link) {
				dwell = 0;
				pinnedRef.current = null;
				read();
				return;
			}
			if (pinnedRef.current === link) return;
			suppressedRef.current = null;
			dwell = setTimeout(() => {
				dwell = 0;
				pinnedRef.current = link;
				read();
			}, HOVER_DWELL_MS) as unknown as number;
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
			revealAfterDwell(target?.closest(LINK_TARGET_SELECTOR) ?? null);
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
			if (!link) return;
			if (link === suppressedRef.current) {
				suppressedRef.current = null;
				return;
			}
			reveal(link);
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
		 *
		 * TAB IS HANDLED IN THE SAME LISTENER, and the contract it implements is in
		 * the module header: into the FOCUSED link's own toolbar, back out of it to
		 * the link, and on from its last button to the next link. It has to be
		 * intercepted because the DOM's order cannot express it - the toolbar is
		 * mounted once per turn, after the whole markdown body, so a plain Tab walks
		 * link, link, link, ..., and lands in the LAST link's buttons.
		 */
		const toolbarButtons = () =>
			Array.from(
				turn.querySelectorAll<HTMLButtonElement>(
					`[${LINK_TOOLBAR_ATTR}] button:not([disabled])`,
				),
			);

		/**
		 * Answer a Tab that the row's own order would answer wrongly.
		 *
		 * Returns whether the event was consumed; a `false` leaves the browser's
		 * default in charge, which is what a Tab between two buttons should be.
		 */
		const handleTab = (event: KeyboardEvent): boolean => {
			const target = event.target as Element | null;
			if (!target) return false;
			const insideToolbar = target.closest(`[${LINK_TOOLBAR_ATTR}]`);
			if (insideToolbar) {
				const buttons = toolbarButtons();
				const at = buttons.indexOf(target as HTMLButtonElement);
				if (at === -1) return false;
				/*
				 * `Shift+Tab` off the FIRST button hands focus back to the link the strip
				 * is about. Left to the browser it would go to the last link in the turn,
				 * because the strip is rendered after all of them.
				 */
				if (event.shiftKey && at === 0) {
					const owner = pinnedRef.current;
					if (!(owner instanceof HTMLElement)) return false;
					owner.focus();
					return true;
				}
				/*
				 * A forward Tab off the LAST button walks to the next link in the turn, so
				 * every link's own actions stay reachable in document order. With no next
				 * link the default runs, which leaves the turn for the next row.
				 */
				if (!event.shiftKey && at === buttons.length - 1) {
					const anchors = Array.from(
						turn.querySelectorAll<HTMLElement>(LINK_TARGET_SELECTOR),
					);
					const owner = pinnedRef.current as HTMLElement | null;
					const after = owner ? anchors.indexOf(owner) + 1 : -1;
					const next = after > 0 ? anchors[after] : undefined;
					if (!next) return false;
					next.focus();
					return true;
				}
				return false;
			}
			/*
			 * Tab ON a link enters that link's toolbar. `Shift+Tab` is left alone: it is
			 * the reader going backwards, and backwards is the previous link, which the
			 * browser's own order gives them.
			 */
			if (event.shiftKey) return false;
			const link = target.closest(LINK_TARGET_SELECTOR);
			if (!link || !turn.contains(link)) return false;
			const [first] = toolbarButtons();
			if (!first) return false;
			first.focus();
			return true;
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Tab" && handleTab(event)) {
				event.preventDefault();
				return;
			}
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
			if (dwell) clearTimeout(dwell);
			turn.removeEventListener("pointerover", onPointerOver);
			turn.removeEventListener("pointerout", onPointerOut);
			turn.removeEventListener("focusin", onFocusIn);
			turn.removeEventListener("focusout", onFocusOut);
			turn.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("selectionchange", read);
		};
	}, [turnRef, read]);

	/**
	 * Clear a pointer- or keyboard-owned subject; a highlight's is not affected.
	 *
	 * Declared before the effects that use it, because React's lint rules read the
	 * dependency list of an effect literally: a `dismiss` defined after the
	 * document Escape listener would be a capture of a `const` in its temporal dead
	 * zone, which TypeScript refuses for the same reason the runtime would.
	 */
	const dismiss = useCallback(() => {
		suppressedRef.current = subjectRef.current;
		pinnedRef.current = null;
		read();
	}, [read]);

	/*
	 * ESCAPE FOR A SUBJECT THE POINTER RAISED, on the DOCUMENT rather than on the	 * turn: the pointer moved nothing but the cursor, so the key arrives with focus
	 * wherever the reader left it - usually the body, which is outside this turn and
	 * therefore outside every listener above. One listener per turn that has a
	 * subject, which is at most one turn in practice, so this costs nothing on the
	 * rows that have no strip.
	 */
	useEffect(() => {
		if (!subject) return;
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const target = event.target as Element | null;
			/*
			 * A toolbar answers Escape for its own focused buttons
			 * (`link-toolkit.tsx`); answering it here as well would dismiss twice.
			 */
			if (target?.closest(`[${LINK_TOOLBAR_ATTR}]`)) return;
			/*
			 * A highlight that is WHAT the strip is about has to go with it, or the next
			 * `read()` derives the same subject from the selection and the strip comes
			 * straight back - the round-1 behaviour was that Escape did nothing at all.
			 */
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) selection.removeAllRanges();
			dismiss();
			/*
			 * NO FOCUS HAND-BACK ON THIS PATH, which is a measured decision rather than
			 * a simplification: focusing the anchor fires `focusin`, and `focusin` is
			 * one of the events that RE-RAISES the strip - so "Escape hides it" would
			 * be a promise the code breaks one frame later. The keyboard reader who is
			 * already inside the toolbar gets their hand-back from
			 * `link-toolkit.tsx`'s own handler, where the focus was theirs to return and
			 * no pointer is hovering to bring the strip back.
			 */
		};
		document.addEventListener("keydown", onEscape);
		return () => document.removeEventListener("keydown", onEscape);
	}, [subject, dismiss]);

	return { subject, quoteAvailable, dismiss };
}
