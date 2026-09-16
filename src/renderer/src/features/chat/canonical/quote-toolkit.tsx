/**
 * The Quote control on a canonical transcript turn: one affordance, raised by a
 * highlight, floating above the highlighted frame.
 *
 * WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT. One control, the same visual
 * object as `message-controls.tsx`'s strip on the legacy transcript, because
 * two floating toolbars that look different is a defect rather than a style
 * choice. Copy and Speak deliberately do NOT ride along: both already exist on
 * `MessageControls`, and that component couples them to its own timestamp in
 * one strip. Reusing it here would drag the timestamp (out of scope for this
 * change) onto the canonical rows, and writing a second copy button would be
 * the second implementation § 9 of `docs/branding.md` refuses.
 *
 * THE TRIGGER IS THE HIGHLIGHT, AND NOTHING ELSE (the operator's first ask:
 * "The quote button should only show up when highlighting a section, not just
 * on hover, as it can look a bit out of place and confusing"). There is no
 * hover twin anywhere in this file - no `group-hover`, no `group-focus-within`,
 * no `opacity-0` strip kept in the tab order. A turn under the pointer with
 * nothing highlighted shows nothing at all, and the control is genuinely absent
 * from the DOM when no highlight begins in this turn, which is also what
 * settles the orphaned-tab-stop half of that ask: an `opacity-0` control keeps
 * its place in the tab order by design, so it could not have been left in.
 *
 * WHICH TURN OWNS A HIGHLIGHT, AND WHY THAT IS THE WHOLE OF "ONE AT A TIME". A
 * drag can touch two turns; the control belongs to the turn where the highlight
 * BEGINS, which `quoteSelectionIn` decides and which is unique because a range
 * has exactly one start endpoint. So this component's gate is a single boolean
 * about its own turn, and a highlight spanning two rows raises exactly one
 * control - not by coordinating the rows, but by one of them being able to
 * answer the question and the other not.
 *
 * `pointer-events` and focus. The shell cancels `mousedown` so a press cannot
 * collapse the very highlight it is about to quote, and so the press does not
 * move focus off the reader's highlight before the click lands; a `mousedown`
 * that defaulted would clear the selection in some engines before `click` runs,
 * which is a press that stages nothing.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { Quote } from "lucide-react";
import type { FC } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { focusComposer } from "../composer-field";
import { type QuotePlacement, placeQuoteControl } from "./quote-anchor";
import { QUOTE_TOOLKIT_ATTR, quoteSelectionIn } from "./quote-model";

type QuoteToolkitProps = {
	/**
	 * The conversation the staged quote is filed under.
	 *
	 * This MUST be the same identity the composer reads its replies by, or the
	 * quote is staged into a key nobody paints - which is why it is threaded from
	 * `chat-content.tsx` as that component's own local `conversationId` const, the
	 * same value it hands `MessageInput`, rather than derived here.
	 */
	conversationId: string;
	/**
	 * The turn element a highlight has to BEGIN inside to be a quote of it.
	 *
	 * Read-only rather than `RefObject<HTMLElement>`: the rows hold a
	 * `RefObject<HTMLDivElement>`, and `{ current: T }` is mutable, so a
	 * `RefObject` parameter would be invariant in `T` and no row's ref would be
	 * assignable to it. This type only ever reads `current`.
	 *
	 * The turn's own words are NOT handed in any more. They used to be, as
	 * `bodyText`, because a press with no selection staged them; no press
	 * happens without a highlight now, so the only text this control can stage
	 * is read back out of the DOM at the moment of the press. The row keeps
	 * using its body text for its own gate (`isQuotable`), which is where
	 * "this row has words to offer" belongs.
	 */
	turnRef: { readonly current: HTMLElement | null };
};

/**
 * The scroller the control is clamped inside: the transcript's own scroll box,
 * which already carries this marker for the harnesses and for the paging
 * policy. Read with `closest()` rather than threaded down through the rows,
 * because it is the element's own answer and a second prop would be a second
 * place to keep it correct.
 */
const SCROLLER_SELECTOR = "[data-lo-canonical-transcript]";

/** A viewport box, from any element or range rect. No scroll offset is applied. */
const boxOf = (rect: {
	top: number;
	left: number;
	right: number;
	bottom: number;
}) => ({
	top: rect.top,
	left: rect.left,
	right: rect.right,
	bottom: rect.bottom,
});

const viewportBox = () => ({
	top: 0,
	left: 0,
	right: window.innerWidth,
	bottom: window.innerHeight,
});

export const QuoteToolkit: FC<QuoteToolkitProps> = ({
	conversationId,
	turnRef,
}) => {
	const addReply = useConversationInputStore((state) => state.addReply);
	/*
	 * The gate, and deliberately a boolean rather than the highlight itself: it
	 * changes only when the highlight moves to another turn, so a scroll - which
	 * fires many times a second - cannot re-render this row's markdown through
	 * the position. The highlight is re-read at press time, which is also what
	 * keeps the staged text honest if the reader drags a second time before
	 * pressing.
	 */
	const [owns, setOwns] = useState(false);
	/*
	 * Where the control goes, in the ROW's own coordinates. Those two boxes move
	 * together when the scroller scrolls, so a scroll that changes neither the
	 * flip nor a clamp changes no number here and re-renders nothing - which is
	 * why this is worth stating as row-relative rather than viewport-relative.
	 */
	const [placement, setPlacement] = useState<QuotePlacement | null>(null);
	const controlRef = useRef<HTMLDivElement>(null);

	const measure = useCallback(() => {
		const turn = turnRef.current;
		const control = controlRef.current;
		if (!turn || !control) {
			setPlacement(null);
			return;
		}
		const selection = quoteSelectionIn(turn);
		if (!selection) {
			setPlacement(null);
			return;
		}
		/*
		 * `getClientRects()` and not `getBoundingClientRect()`: the flip is asked
		 * about the line the highlight begins on and its `left` is the reader's
		 * own start point, and the union box answers neither question - see
		 * `quote-anchor.ts`.
		 */
		const placed = placeQuoteControl({
			lines: Array.from(selection.range.getClientRects(), boxOf),
			container: boxOf(
				(turn.closest(SCROLLER_SELECTOR) ?? turn).getBoundingClientRect(),
			),
			viewport: viewportBox(),
			// Measured from the control itself rather than assumed from its
			// classes: the shell's height is pinned by the contrast gate but its
			// width comes from the button inside it, and a hard-coded pair here is
			// a second definition of the control's own size.
			size: { width: control.offsetWidth, height: control.offsetHeight },
		});
		const row = turn.getBoundingClientRect();
		const next = placed
			? {
					top: placed.top - row.top,
					left: placed.left - row.left,
					placement: placed.placement,
				}
			: null;
		setPlacement((previous) =>
			previous === next ||
			(previous &&
				next &&
				previous.top === next.top &&
				previous.left === next.left &&
				previous.placement === next.placement)
				? previous
				: next,
		);
	}, [turnRef]);

	/*
	 * THE GATE, and the only event that fires for every way a highlight is made
	 * or unmade: a drag, a double-click, shift+arrows, shift+click, and the click
	 * that clears it. Escape is the one dismissal that fires nothing and is
	 * handled below.
	 *
	 * The mount-time read is not ceremony: this pane is windowed, so a row can
	 * mount under a highlight that already exists.
	 */
	useEffect(() => {
		const read = () => setOwns(quoteSelectionIn(turnRef.current) !== null);
		read();
		document.addEventListener("selectionchange", read);
		return () => document.removeEventListener("selectionchange", read);
	}, [turnRef]);

	/*
	 * THE POSITION, and the dismissals that are not a selection change.
	 *
	 * `useLayoutEffect` because the position is measured from the control's own
	 * box: it runs after the DOM mutation and before paint, so the reader never
	 * sees a frame of the control standing at the row's origin before it is
	 * placed.
	 *
	 * Scroll and resize recompute rather than merely re-render, which is the
	 * technique `TextSelectionControls` already uses on this transcript: the
	 * position is derived from the highlight's own range rect, so it has to be
	 * re-read whenever the page moves under it. `selectionchange` is here too,
	 * because a second drag inside this turn changes the highlight's geometry
	 * without changing the gate.
	 *
	 * ESCAPE DISMISSES, and it CLEARS the highlight rather than hiding the
	 * control over one: a hidden control above a lit selection is a state the
	 * reader cannot get out of, since the next scroll or selection event would
	 * raise it again - and the operator's third ask is exactly that it goes away
	 * "instead of sticking around". It does not `preventDefault()` and it does
	 * not stop propagating: this app has its own Escape (it stops a running
	 * turn), and one key answering the gesture the product documents it for is
	 * the key working, not a conflict to arbitrate here.
	 */
	useLayoutEffect(() => {
		if (!owns) {
			setPlacement(null);
			return;
		}
		measure();
		const onReflow = () => measure();
		const onKeyDown = (event: KeyboardEvent) => {
			/*
			 * An Escape something else has already answered - a popup closing, the
			 * composer's own - is not this control's to answer as well, so the guard
			 * is `defaultPrevented` rather than relying on listener order.
			 */
			if (event.key !== "Escape" || event.defaultPrevented) return;
			window.getSelection()?.removeAllRanges();
			/*
			 * Belt and braces beside `removeAllRanges()`, which fires
			 * `selectionchange` and would take the gate down on its own: clearing the
			 * gate here means Escape cannot leave a control in the DOM over a
			 * highlight it has just dropped, whatever the engine does with the event.
			 */
			setOwns(false);
			setPlacement(null);
		};
		document.addEventListener("scroll", onReflow, true);
		document.addEventListener("selectionchange", onReflow);
		window.addEventListener("resize", onReflow);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("scroll", onReflow, true);
			document.removeEventListener("selectionchange", onReflow);
			window.removeEventListener("resize", onReflow);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [owns, measure]);

	const handleQuote = useCallback(() => {
		/*
		 * The highlight is read HERE, at the press, and it is the highlight this
		 * turn OWNS: the control is only up because a highlight begins in this
		 * turn, so re-reading cannot answer with a different turn's words, and it
		 * is what makes a press after a second drag quote what is lit rather than
		 * what was lit when the control was placed. Nothing to quote is a no-op
		 * rather than a fallback, which is the boundary that used to widen a
		 * quote to the whole turn (code review round 2, MINOR 2; UX U8; QA Q8).
		 */
		const selection = quoteSelectionIn(turnRef.current);
		if (!selection) return;
		addReply(conversationId, { id: uuidv4(), text: selection.text });
		// The highlight has been answered; leaving it lit over text that is now
		// also above the composer reads as two live selections.
		window.getSelection()?.removeAllRanges();
		/*
		 * THE PRESS HANDS THE CARET BACK (design round 1, D2; UX round 1, U1; QA
		 * round 1, Q1).
		 *
		 * Staging a quote is the moment the reader has committed to writing the
		 * message it belongs to, and focus left on this button is not neutral: it
		 * silently discarded the next keystrokes (measured: typing after a press left
		 * the textarea empty and the characters nowhere in the document) and turned
		 * Enter - which everywhere else in this composer means "send" - into a second
		 * press of this button, staging a duplicate quote (measured: replies 1 -> 2).
		 * A control that eats the reader's next words and then repeats itself on the
		 * key that sends is the defect, not the styling.
		 *
		 * Slack and Linear return focus to the composer for this same reason. The
		 * hand-off is the composer's own `focusInput` (through `composer-field`)
		 * rather than a `.focus()` here, so the "the user took the box" flag the ask
		 * gate reads is cleared by the one function that owns it.
		 */
		focusComposer();
	}, [addReply, conversationId, turnRef]);

	// Absent, not hidden: with no highlight of this turn's there is nothing to
	// operate, so the control leaves the DOM and with it the tab order.
	if (!owns) return null;

	return (
		<div
			{...{ [QUOTE_TOOLKIT_ATTR]: "" }}
			ref={controlRef}
			/*
			 * `invisible` rather than an unmount, for the frames before the first
			 * measurement and while the highlight's own first line is off screen:
			 * the position is computed from this element's measured box, and a
			 * `display: none` control measures as zero. `visibility: hidden` keeps
			 * the layout and still takes the control out of the tab order, so
			 * there is no orphaned stop in that window either.
			 */
			className={cn(
				// Slack's and Linear's floating selection toolbar: a small group
				// that covers nothing, rather than a strip reserved beside every
				// message, so nothing is reserved and the turn rhythm is unchanged
				// whether or not the control is up. The `elevated` ground plus a
				// hairline is what makes it read as floating over the prose - § 2
				// keeps the one shadow for objects that genuinely leave the flow.
				"absolute z-10 flex h-8 items-center rounded-md border border-hairline bg-elevated px-1",
				!placement && "invisible",
			)}
			style={
				placement ? { top: placement.top, left: placement.left } : undefined
			}
			onMouseDown={(event) => event.preventDefault()}
		>
			<Tooltip
				content="Quote"
				/*
				 * The tooltip takes the opposite side to the control, because the
				 * control sits BELOW the highlight when there was no room above it -
				 * and a tooltip that always opened upwards would cover the very text
				 * the reader just highlighted.
				 */
				side={placement?.placement === "below" ? "bottom" : "top"}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Quote"
					className="text-ink-dim hover:bg-accent-wash hover:text-accent"
					onClick={handleQuote}
				>
					<Quote />
				</Button>
			</Tooltip>
		</div>
	);
};
