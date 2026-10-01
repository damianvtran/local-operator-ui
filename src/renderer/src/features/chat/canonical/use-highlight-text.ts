/**
 * The reader's highlight of one turn, as text, for the controls that act on it.
 *
 * WHY TEXT RATHER THAN THE BOOLEAN THE QUOTE CONTROL USED TO STORE: the
 * highlight is now also what the selection's Speak control renders its state
 * against - the store key is `sel:<scope>:<fnv1a(text)>`, so the control needs
 * the words, not just their existence. The two rules the boolean protected
 * still hold under the string: an EQUAL highlight maps to an equal string, so
 * React's own `Object.is` check bails the re-render a scroll would otherwise
 * cause (scrolling fires no `selectionchange`; only a moved, extended, cleared
 * or replaced highlight changes the text), and the state is still local to the
 * toolkit, so the row's markdown never re-renders through a selection.
 *
 * The mount-time read is not ceremony: this pane is windowed, so a row can
 * mount under a highlight that already exists.
 *
 * Both endpoints are tested against the toolkit by `quoteSelectionIn` (see its
 * own comment for why a drag that reaches the control is refused); a highlight
 * that BEGINS elsewhere answers `null` here, which is what keeps one control
 * per highlight a property of the DOM rather than of an agreement.
 */

import { useCallback, useEffect, useState } from "react";
import { quoteSelectionIn } from "./quote-model";

export type HighlightText = {
	/** The turn's part of the reader's highlight, trimmed, or `null`. */
	text: string | null;
	/**
	 * Take the state down without moving the DOM selection. Escape's
	 * belt-and-braces in `quote-toolkit.tsx`: `removeAllRanges()` fires
	 * `selectionchange` and would take the gate down on its own, but this is
	 * what makes the dismissal hold whatever the engine does with the event.
	 */
	clear: () => void;
};

export function useHighlightText(turnRef: {
	readonly current: HTMLElement | null;
}): HighlightText {
	const [text, setText] = useState<string | null>(null);
	useEffect(() => {
		const read = () => setText(quoteSelectionIn(turnRef.current)?.text ?? null);
		read();
		document.addEventListener("selectionchange", read);
		return () => document.removeEventListener("selectionchange", read);
	}, [turnRef]);
	const clear = useCallback(() => setText(null), []);
	return { text, clear };
}
