/**
 * The Quote control on a canonical transcript turn: one affordance, raised by a
 * highlight, floating above the highlighted frame.
 *
 * WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT. One control, the same visual
 * object as `message-controls.tsx`'s strip on the legacy transcript, because two
 * floating toolbars that look different is a defect rather than a style choice.
 *
 * SPEAK NOW RIDES ALONG (the speak-aloud round), and the reason the old ruling
 * fell is the thing that changed rather than the ruling: the selection is the
 * second surface the operator asked to hear, and when the shared
 * `useSpeakControl`/`SpeakButton` (`@shared/components/common/speak-control.tsx`)
 * landed, reusing it here stopped being the second implementation § 9 of
 * `docs/branding.md` refuses. The press reads
 * `quoteSelectionIn(turnRef.current)?.text` AT PRESS TIME - the same clipped
 * range Quote stages and nothing else, never a timestamp or the turn's body -
 * and the store keys it `sel:<conversationId>:<fnv1a(text)>`, so two different
 * highlights cannot claim each other's busy or playing state.
 *
 * COPY STILL DOES NOT. The message strip's copy is per-message and this
 * control's subject is a Range, not a record; the selection's own copy gesture
 * is the platform's (Cmd/Ctrl+C), and inlining a second semantics here - which
 * of html/text/flavors the write carries - is the second implementation the
 * same § 9 refuses. The operator's ask for this surface was speech.
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
 * A HIGHLIGHT THAT LIES WHOLLY INSIDE A LINK IS THE LINK TOOLBAR'S, and that is
 * the one addition the link affordance made here. The rule is unchanged - one
 * control per highlight, and the row that owns it decides which - but the ROW
 * now declines to mount this control when the link toolbar is the one offering
 * the press, so the reader gets one strip with Quote on it rather than two strips
 * on top of each other. The decision lives in the row (`canonical-transcript.tsx`
 * mounts this only when `useLinkSubject` says no link owns the highlight), which
 * is what keeps this component's own gate about its own turn alone.
 *
 * `pointer-events` and focus. The shell cancels `mousedown` so a press cannot
 * collapse the very highlight it is about to quote, and so the press does not
 * move focus off the reader's highlight before the click lands; a `mousedown`
 * that defaulted would clear the selection in some engines before `click` runs,
 * which is a press that stages nothing.
 *
 * WHAT IT IS PLACED AGAINST, AND WHERE THAT LIVES NOW. The geometry - the
 * reader's own highlight's lines, the coalesced re-measure, the ignores-a-reflow
 * observer, the row-relative position - is `use-floating-control.ts`, shared with
 * the link toolbar so that the round-1 placement defects (code review M1, UX U9,
 * QA Q27) cannot be re-derived in a second copy. The PRESS is
 * `use-quote-press.ts`, for the same reason: it carries the recorded history of
 * what a press that leaves focus behind costs.
 */

import {
	SpeakButton,
	useSpeakControl,
} from "@shared/components/common/speak-control";
import { Button, Tooltip } from "@shared/components/ui";
import { clipForSpeech } from "@shared/lib/speech-clip";
import { cn } from "@shared/lib/utils";
import {
	fetchAgentSpeech,
	selectionSpeechKey,
	useSpeechStore,
} from "@shared/store/speech-store";
import { Quote } from "lucide-react";
import type { FC } from "react";
import { useEffect } from "react";
import { QUOTE_TOOLKIT_ATTR, quoteSelectionIn } from "./quote-model";
import { useFloatingControl } from "./use-floating-control";
import { useHighlightText } from "./use-highlight-text";
import { useQuotePress } from "./use-quote-press";

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

export const QuoteToolkit: FC<QuoteToolkitProps> = ({
	conversationId,
	turnRef,
}) => {
	/*
	 * The reader's highlight of this turn, through the shared gate
	 * (`use-highlight-text.ts`): TEXT rather than the boolean this used to store,
	 * because the Speak control's store key is built from the words - and the
	 * equality that protected the re-render still holds, since an unchanged
	 * highlight maps to an unchanged string. The highlight is re-read at press
	 * time by BOTH presses (Quote stages it, Speak speaks it), which is what
	 * keeps either honest if the reader drags a second time before pressing.
	 */
	const { text: highlight, clear: clearHighlight } = useHighlightText(turnRef);
	const owns = highlight !== null;
	const handleQuote = useQuotePress(conversationId, turnRef);
	const { controlRef, placement } = useFloatingControl({
		turnRef,
		visible: owns,
		// The WHOLE highlight's boxes, with no mounted control's own box among
		// them - `quoteSelectionIn` promises both, and `quote-anchor.ts` says why
		// the first line anchors the control and the last one decides the flip.
		lines: () => quoteSelectionIn(turnRef.current)?.lines ?? null,
	});
	/*
	 * The selection's Speak, through the ONE control every speech surface renders
	 * (`speak-control.tsx`). The key is this highlight's own words, clipped first
	 * so the key, the cache entry and the request all describe the same
	 * characters; the press re-reads the highlight (`getText`) for the same
	 * reason Quote does - the strip can outlive the drag that raised it.
	 */
	const { speak } = useSpeechStore();
	const speakControl = useSpeakControl({
		key:
			highlight === null
				? null
				: selectionSpeechKey(conversationId, clipForSpeech(highlight).text),
		getText: () => quoteSelectionIn(turnRef.current)?.text ?? null,
		play: ({ text }) =>
			speak(
				selectionSpeechKey(conversationId, text),
				fetchAgentSpeech(conversationId, text),
			),
	});

	/*
	 * ESCAPE DISMISSES, and it CLEARS the highlight rather than hiding the control
	 * over one: a hidden control above a lit selection is a state the reader cannot
	 * get out of, since the next scroll or selection event would raise it again -
	 * and the operator's third ask is exactly that it goes away "instead of
	 * sticking around". It does not `preventDefault()` and it does not stop
	 * propagating: this app has its own Escape (it stops a running turn), and one
	 * key answering the gesture the product documents it for is the key working,
	 * not a conflict to arbitrate here.
	 *
	 * An Escape something else has already answered - a popup closing, the
	 * composer's own - is not this control's to answer as well, so the guard is
	 * `defaultPrevented` rather than relying on listener order.
	 */
	useEffect(() => {
		if (!owns) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			window.getSelection()?.removeAllRanges();
			/*
			 * Belt and braces beside `removeAllRanges()`, which fires
			 * `selectionchange` and would take the gate down on its own: clearing
			 * the gate here means Escape cannot leave a control in the DOM over a
			 * highlight it has just dropped, whatever the engine does with the
			 * event.
			 */
			clearHighlight();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [owns, clearHighlight]);

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
				"absolute z-10 flex h-8 items-center gap-0.5 rounded-md border border-hairline bg-elevated px-1",
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
			{/*
			 * Speak rides BESIDE Quote rather than after the strip's other content:
			 * the two act on the same subject (the highlight), and the pair reads as
			 * one group of "do something with the selection" controls - the same
			 * pairing the link toolbar uses.
			 */}
			<SpeakButton
				control={speakControl}
				side={placement?.placement === "below" ? "bottom" : "top"}
			/>
		</div>
	);
};
