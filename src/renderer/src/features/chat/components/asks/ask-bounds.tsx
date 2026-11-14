import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { FileDiff } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
	type ProfileProposalCard,
	type ProfileProposalRef,
	profileProposalReviewPath,
} from "../../profile-proposal-ask";

/*
 * BOUNDED ASK CARDS - ONE PRIMITIVE FOR EVERY SURFACE THAT DRAWS A QUESTION.
 *
 * THE INCIDENT. A team-brief proposal arrived as an approval whose text was the
 * whole proposed brief. The inline card ("The agent is asking") grew to the text's
 * height: it filled the conversation pane, the pane could not scroll it, and the
 * answer pair and the composer were pushed off-screen - so the only way to answer
 * was gone. Nothing about that is specific to proposals: ANY long question (a
 * pasted log, a model that over-explains) does the same, on the inline dock, in
 * the Asks side panel, and in the notification drawer's detail pane (which
 * embeds the same `AskPanel`).
 *
 * THE RULE, shared so the three surfaces cannot drift:
 * - the QUESTION BODY scrolls inside a viewport-relative cap (`ASK_BODY_MAX_H`);
 * - the CONTROLS (options, the `Other` field, the actions) are siblings of that
 *   region, never inside it, so they stay where the reader can press them;
 * - a long OPTION LIST is capped too (`ASK_OPTIONS_MAX_H`), but the `Other`
 *   row and its field sit OUTSIDE that capped list, so free text is always one
 *   press away however many options the model wrote;
 * - the inline dock's card is additionally capped as a whole (`ASK_CARD_MAX_H`)
 *   with its own scroll as the last resort;
 * - the vh/rem caps are UPPER bounds only. What actually has to fit is the
 *   space the surface has (design D1/D3: a 70vh card at 1024x600 pushed the
 *   composer's send row off-screen): the dock is a shrinkable flex item of the
 *   chat column, beside a `shrink-0` composer (`chat-content.tsx`), and the
 *   notifications pane bounds its first ask by measurement (`ASK_BOUND_ATTR`);
 * - the body keeps three lines when there is room for them, but the CONTROLS
 *   WIN over that floor (QA round 2, Q1): where three lines plus the options
 *   do not fit, the body gives way (to two lines on the dock, scrolling)
 *   rather than pushing Approve/Deny out of the card (`ASK_BODY_FLOOR`);
 * - rows that are not the answer (the dock's approval-policy links and its key
 *   hint) sit in a SECONDARY region that gives way before the body does
 *   (`AskSecondary`), so they can never be what pushes the options out;
 * - THE BODY DOES NOT HOLD THE WHEEL WHEN THE CARD IS INSIDE A SCROLLER. The dock's
 *   card floats over the transcript, so its body contains the gesture
 *   (`containOverscroll`). Inside the asks drawer and the notifications pane the
 *   card is a CHILD of the scroller, which owns the scroll - there `contain`
 *   swallows a wheel over a body that has nothing to scroll (Chromium 156), so
 *   those hosts pass `containOverscroll={false}` and the gesture chains up.
 *
 * WHY `vh` AND NOT A CONTAINER UNIT for the caps. A container-relative cap would need
 * `container-type: size` on the chat column, the drawer and the notifications
 * pane - three layout owners this fix has no other reason to touch, and `size`
 * containment changes how each of them sizes. The viewport is what the bug is
 * about (the card outgrew the window), and the `rem` arm of each `min()` keeps
 * a tall monitor from handing one question most of a 1440px screen.
 */
export const ASK_BODY_CAP = "min(40vh,28rem)";
export const ASK_BODY_MAX_H = "max-h-[min(40vh,28rem)]";
/*
 * THE BODY'S FLOOR: min(three lines, the content's own height, the ROOM the
 * surface has left for the body - but never under one line).
 *
 * - `--lo-ask-content-h` is measured off the body's inner wrapper (whose height
 *   does not depend on the capped box), so a one-line question is not padded
 *   with two blank lines.
 * - `--lo-ask-room` is how much height the controls leave the body. Round 2
 *   held a flat three-line floor, and `min-height` beats `max-height`, so at
 *   1024x600 the floor plus the options outgrew the card and it was APPROVE AND
 *   DENY that scrolled out of view (QA round 2, Q1). The answer is what the card
 *   exists for, so the room term lets the controls win: the floor drops to what
 *   is left, down to one line, which still reads as "there is a question here"
 *   and carries the fade that says there is more.
 *   - the bounded notifications pane sets it to the measured fit (`fitInBound`);
 *   - the dock sets it to `2lh` (`shrinkable`), so its floor is
 *     min(two lines, content) - design round 2, D6/S4. A one-line floor (round
 *     3) left a proposal card showing a single faded line and nothing of WHAT
 *     was being approved; two lines hold a proposal's `Changes:` + `Origin:`
 *     (42 px at text-body) whole. The room for it comes from the transcript,
 *     which now only takes leftover space (`canonical-transcript.tsx`), and
 *     from inline option descriptions on short windows (`AskOptions`
 *     `inlineDescriptions`), not from the answer pair;
 *   - unset (the side panel's flowing list), it falls back to three lines.
 */
export const ASK_BODY_FLOOR =
	"min-h-[min(3lh,var(--lo-ask-content-h,0px),max(1lh,var(--lo-ask-room,3lh)))]";
/*
 * 12 px, not 20 (design round 2, D7): over a 22 px body the 20 px mask dimmed
 * the lower glyph rows of the ONLY visible line to 2.0-3.7:1. At most half a
 * line, and only on a body at least two lines tall (`AskScrollBody`'s
 * `fadeRoom`), so every fully visible line keeps its contrast.
 */
export const ASK_FADE_MASK =
	"[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]";
export const ASK_OPTIONS_MAX_H = "max-h-[min(30vh,20rem)]";
export const ASK_CARD_MAX_H = "max-h-[min(70vh,48rem)]";

/*
 * The data attribute is the structural contract the DOM tests (and design QA's
 * geometry probes) read: "the body is a scroll region and the controls are not
 * inside it" is asserted against these markers, not against class strings.
 */
export const ASK_SCROLL_ATTR = "data-lo-ask-scroll";
/**
 * A SCROLLER THAT HOSTS ASK CARDS (the asks drawer's list, the notifications
 * detail pane).
 *
 * The card is a CHILD of this element, and three behaviours belong to that
 * relationship rather than to the card: the body and option list must not
 * `overscroll-contain` the gesture away from it (`containOverscroll`); the card's
 * pinned action row publishes its height here so the host can keep Tab focus clear
 * of it (`--lo-ask-actions-h`, read by `scroll-padding-bottom`); and the host
 * carries NO BOTTOM PADDING, because a scroller clips at its padding box and
 * `sticky bottom-0` stops there - any bottom padding is a strip the pinned band
 * cannot paint, with content scrolling visibly under the bar.
 * Written on the element that owns the scroll and read by `ask-panel.tsx`, so a
 * second host cannot half-adopt the contract.
 */
export const ASK_LIST_ATTR = "data-lo-ask-list";
/**
 * THE PINNED ACTION ROW a card draws at the bottom of its own box
 * (`Send answer` / `Decline`), and the ONE number the host's
 * `scroll-padding-bottom` needs from it.
 *
 * THE HOST OWNS THE HEIGHT, NOT THE CARD (agent review round 1, m1). The row
 * used to write `--lo-ask-actions-h` on the host itself and delete the property
 * on unmount, so with two cards on screen a card whose row went away (it
 * settled, or its dismiss chooser opened) removed the value while another
 * card's row was still pinned - and the padding that keeps Tab focus clear of a
 * band vanished with a bar still drawn over the list. What the host needs is the
 * TALLEST row currently in it: the deepest band any visible card can paint over
 * a focused control.
 */
export const ASK_ACTIONS_ATTR = "data-lo-ask-actions";
export const ASK_ACTIONS_SELECTOR = `[${ASK_ACTIONS_ATTR}]`;

/** Publish the tallest pinned row's height to `list`; no row left removes the value. */
export function publishAskActionsHeight(list: HTMLElement): void {
	let tallest = 0;
	for (const row of list.querySelectorAll<HTMLElement>(ASK_ACTIONS_SELECTOR))
		tallest = Math.max(tallest, row.getBoundingClientRect().height);
	if (tallest > 0) list.style.setProperty("--lo-ask-actions-h", `${tallest}px`);
	else list.style.removeProperty("--lo-ask-actions-h");
}

/**
 * Keep `--lo-ask-actions-h` current on a host declared by `ASK_LIST_ATTR`.
 *
 * Rows mount and unmount WITH THEIR CARDS, so the observed set is rebuilt on a
 * `childList` mutation; a height change inside one mounted row (a translation
 * wraps it, the column narrows) is the `ResizeObserver`'s business. jsdom has no
 * layout and no `ResizeObserver`: the mount-time publish runs and the rest is
 * skipped, which is what an unlaid box has.
 */
export function useAskActionsHeight(ref: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const list = ref.current;
		if (!list) return;
		publishAskActionsHeight(list);
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => publishAskActionsHeight(list));
		/*
		 * Each row is observed ONCE (`observed`), so a mutation elsewhere in the list - a
		 * streamed card re-rendering - costs a querySelectorAll and no re-subscription.
		 * A row that unmounts stays in the set until this host does; it no longer
		 * resizes, and the set is bounded by the rows this drawer has ever drawn.
		 */
		const observed = new Set<Element>();
		const watch = () => {
			for (const row of list.querySelectorAll(ASK_ACTIONS_SELECTOR)) {
				if (observed.has(row)) continue;
				observed.add(row);
				observer.observe(row);
			}
			publishAskActionsHeight(list);
		};
		watch();
		const mutations =
			typeof MutationObserver === "undefined"
				? null
				: new MutationObserver(watch);
		mutations?.observe(list, { childList: true, subtree: true });
		return () => {
			mutations?.disconnect();
			observer.disconnect();
			list.style.removeProperty("--lo-ask-actions-h");
		};
	}, [ref]);
}
/** Present while the bottom fade is drawn (overflowing, not scrolled to the end). */
export const ASK_FADE_ATTR = "data-lo-ask-fade";

/*
 * A PANE THAT BOUNDS THE ASK INSIDE IT (design D3). The notifications detail
 * pane prints a header, a title and actions ABOVE the ask card, so a viewport
 * cap (40vh) on the body still ran the options, `Other` and `Send answer` past
 * the fold at 1024x576. CSS cannot express "the pane's height minus whatever
 * sits above me" for a body inside a scrolling flow column (the pane has
 * further sections below, so a flex-shrink chain would squeeze those instead),
 * so the pane marks itself and the body measures:
 *
 *   fit = pane.clientHeight - (body top within the pane's CONTENT)
 *         - (the row's height below the body: options, Other, Send) - pane padding
 *
 * Scroll-invariant (content offsets, not viewport ones) and stable: shrinking
 * the body moves the row's bottom by the same amount, so the controls' share
 * is constant and the measurement converges in one pass. Applied to the
 * pane's FIRST ask body only - the card that sits at the top of the reader's
 * view; later questions and cards are below the fold by construction and keep
 * the viewport cap, and bounding them too would make every body's fit depend
 * on every other's. The floor still wins, so a pane too short for three lines
 * plus the controls scrolls, as it did before.
 */
export const ASK_BOUND_ATTR = "data-lo-ask-bound";
export const ASK_ROW_SELECTOR = "[data-lo-ask-row]";

/*
 * Computed style read through the element's OWN window, not the bare global.
 * In the browser the two are the same object, so this changes nothing there;
 * the jsdom test setups (`scripts/ask-*.test.mjs`) install `window`/`document`
 * but not every window member as a global, so a bare `getComputedStyle` threw a
 * ReferenceError mid-measure. No window (a detached node, a stripped test
 * global) returns null and callers fall back to "no style info" - the same
 * defaults an unparseable value already takes.
 */
const computedStyleOf = (el: Element): CSSStyleDeclaration | null =>
	el.ownerDocument?.defaultView?.getComputedStyle?.(el) ?? null;

const fitInBound = (node: HTMLElement, bound: HTMLElement): number | null => {
	if (bound.querySelector(`[${ASK_SCROLL_ATTR}]`) !== node) return null;
	const pane = bound.getBoundingClientRect();
	const body = node.getBoundingClientRect();
	const row = (
		node.closest<HTMLElement>(ASK_ROW_SELECTOR) ?? node
	).getBoundingClientRect();
	const top = body.top - pane.top + bound.scrollTop;
	const below = Math.max(0, row.bottom - body.bottom);
	const pad =
		Number.parseFloat(computedStyleOf(bound)?.paddingBottom ?? "") || 0;
	// jsdom (and a pane not laid out yet) reports a zero box: no fit, keep the cap.
	if (bound.clientHeight <= 0) return null;
	return Math.max(0, Math.floor(bound.clientHeight - top - below - pad));
};

/**
 * The question body's scroll region.
 *
 * KEYBOARD. A region that overflows takes a Tab stop (`tabIndex=0`) and a name,
 * so a keyboard reader can scroll it with the arrow keys; one that fits takes
 * neither, because an empty Tab stop on every short question is noise. Chromium
 * also makes scrollers focusable on its own (keyboard-focusable scrollers), but
 * only when they contain nothing focusable - a markdown link inside the body
 * would switch that off - so the measurement here is explicit.
 *
 * Escape is untouched: the region has no key handler, so the card's own
 * Esc-collapse (the dock) and Esc-claim (the panel's chooser) still see the key.
 */
export const AskScrollBody = ({
	children,
	className,
	shrinkable = false,
	containOverscroll = true,
}: {
	children: ReactNode;
	className?: string;
	/**
	 * A flex column sizes this body (the inline dock's card): its floor drops to
	 * min(two lines, content) so the pinned controls beside it always fit. See
	 * `ASK_BODY_FLOOR`.
	 */
	shrinkable?: boolean;
	/**
	 * Stop a wheel/trackpad gesture at this body's own end (`overscroll-contain`).
	 *
	 * TRUE ON THE DOCK, and it is the dock's rule: its card floats OVER the
	 * transcript, so a reader who reaches the end of a question must not start
	 * scrolling the conversation behind a card the transcript does not own.
	 *
	 * FALSE WHERE THE CARD IS INSIDE A SCROLLER (`AskPanel` in the asks drawer and
	 * in the notifications detail pane). There the LIST is the surface that owns
	 * the scroll, and containment took the gesture away from it: Chromium 156
	 * stops the chain at a `contain` scroll container even when that container has
	 * no scrollable overflow at all, so a two-line question in the drawer swallowed
	 * a wheel (measured: the list moved 0 px; the same probe with `auto` in place
	 * of `contain` moved it to its maximum).
	 */
	containOverscroll?: boolean;
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const [overflows, setOverflows] = useState(false);
	const [atEnd, setAtEnd] = useState(true);
	/*
	 * Whether the visible box is at least two lines tall - the only bodies that
	 * may fade (design round 2, D7). A one-line box under a fade is a line the
	 * reader cannot read; there the scroll region's own Tab stop and name say
	 * "there is more". An unparseable line height (jsdom, `normal`) keeps the
	 * fade, which is the pre-D7 behaviour.
	 */
	const [fadeRoom, setFadeRoom] = useState(true);
	const [contentH, setContentH] = useState<number | null>(null);
	const [fitH, setFitH] = useState<number | null>(null);
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const pane = node.closest<HTMLElement>(`[${ASK_BOUND_ATTR}]`);
		/*
		 * Only the pane's FIRST body is fitted (`fitInBound`), so only it watches
		 * the pane: N bodies observing the pane and all its children meant N forced
		 * layouts per resize for N-1 nulls (code review round 2, M1). Decided at
		 * mount; a body that becomes first later (the one above it unmounted) keeps
		 * the viewport cap, which is the pre-fit behaviour, until it remounts.
		 */
		const bound =
			pane && pane.querySelector(`[${ASK_SCROLL_ATTR}]`) === node ? pane : null;
		const measure = () => {
			// One pixel of slack: sub-pixel line heights round differently in
			// scrollHeight and clientHeight, and a phantom Tab stop is the cost.
			setOverflows(node.scrollHeight > node.clientHeight + 1);
			setAtEnd(node.scrollTop + node.clientHeight >= node.scrollHeight - 1);
			const lh = Number.parseFloat(computedStyleOf(node)?.lineHeight ?? "");
			setFadeRoom(!(lh > 0) || node.clientHeight + 1 >= 2 * lh);
			const inner = node.firstElementChild as HTMLElement | null;
			setContentH(inner ? inner.offsetHeight : null);
			setFitH(bound ? fitInBound(node, bound) : null);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		// The content's own size changes (markdown settling, a font swap) do
		// not resize the capped box, so the first child is watched as well.
		if (node.firstElementChild) observer.observe(node.firstElementChild);
		// The pane's own height is the other input of the fit (a window resize).
		if (bound) {
			observer.observe(bound);
			// ...and so is the content above the body: a description that settles
			// after mount moves the body down without resizing either box.
			for (const child of bound.children) observer.observe(child);
		}
		return () => observer.disconnect();
	}, []);
	return (
		<div
			ref={ref}
			{...{ [ASK_SCROLL_ATTR]: overflows ? "overflow" : "fits" }}
			{...{
				[ASK_FADE_ATTR]: overflows && !atEnd && fadeRoom ? "" : undefined,
			}}
			tabIndex={overflows ? 0 : undefined}
			role={overflows ? "region" : undefined}
			aria-label={overflows ? t("ui.chat.asks.bounds.body_label") : undefined}
			onScroll={(event) => {
				const node = event.currentTarget;
				setAtEnd(node.scrollTop + node.clientHeight >= node.scrollHeight - 1);
			}}
			style={
				{
					// The floor's second operand: never taller than the content itself.
					"--lo-ask-content-h": contentH === null ? undefined : `${contentH}px`,
					// The floor's room operand (see `ASK_BODY_FLOOR`).
					"--lo-ask-room": shrinkable
						? "2lh"
						: fitH === null
							? undefined
							: `${fitH}px`,
					maxHeight:
						fitH === null ? undefined : `min(${ASK_BODY_CAP}, ${fitH}px)`,
					/*
					 * THE FLEX BASIS, ALREADY CAPPED (dock only). With `flex-basis: auto`
					 * a 10k-character body's base size is its whole content, and CSS
					 * flexbox shares a deficit by base size: the body's share is a sliver,
					 * its target stays above its max-height, and the algorithm FREEZES it
					 * at that max - leaving the secondary rows and the card's own scroll to
					 * absorb everything, which is the Q1 shape again. A basis no larger
					 * than the cap means the body never starts above its max, so it
					 * really does shrink once the secondary region is gone.
					 */
					flexBasis:
						shrinkable && contentH !== null
							? `min(${ASK_BODY_CAP}, ${contentH}px)`
							: undefined,
				} as CSSProperties
			}
			className={cn(
				ASK_BODY_MAX_H,
				ASK_BODY_FLOOR,
				/*
				 * `min-h-0` is gone in favour of the floor above: a flex parent may
				 * shrink the body (the dock's card cap), but never to nothing (code
				 * review R1, design D1: at 1024x600 the body had collapsed to 18 px
				 * while the options stayed) - one line is the least it keeps (two
				 * on the dock, see `ASK_BODY_FLOOR`). The containment is the CALLER's
				 * (`containOverscroll`: on for the dock, off inside a scroller), and
				 * `overflow-wrap:anywhere` because the payload that caused this was paths
				 * and ids with no spaces.
				 */
				"overflow-y-auto [overflow-wrap:anywhere]",
				containOverscroll && "overscroll-contain",
				/*
				 * THE "THERE IS MORE" CUE (design D5): while the body overflows and the
				 * reader has not reached its end, the last 12 px fade out (D7) - the same mask
				 * the picker list uses (`picker-host.tsx`), and the cue mobile's
				 * PendingCard draws. A clipped glyph or an overlay scrollbar that macOS
				 * hides after scrolling was the only hint before.
				 */
				overflows && !atEnd && fadeRoom ? ASK_FADE_MASK : null,
				"rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				className,
			)}
		>
			<div>{children}</div>
		</div>
	);
};

export const ASK_SECONDARY_ATTR = "data-lo-ask-secondary";

/**
 * The card's SECONDARY rows: everything that is not the question or the answer.
 *
 * On the dock that is the approval-policy links (`Approvals: Ask - ...`, `Set
 * auto for this session / all sessions`) and the key hint (`Choose Approve or
 * Deny above...`). Round 2 pinned them beside the options, so at 1024x600 their
 * ~120 px were part of what pushed Deny below the card's bottom, and at 1440x900
 * the hint was the line that got cut (QA round 2, Q1).
 *
 * They stay BELOW the options (the pair is what the card is for, and the policy
 * links are deliberately second), but this region is a flex item that GIVES WAY
 * FIRST: `shrink-[999]` against the body's `shrink` of 1 means a short card takes
 * its whole deficit from here until this region is gone, and only then from the
 * body - so the order of sacrifice is secondary rows, then body (to one line),
 * and the options never. `min-h-0` lets it reach zero; while its content does not
 * fit it scrolls under the same fade the body uses, and its links stay reachable
 * by Tab (focusing a link scrolls it into view). Measured, not toggled: the
 * region's size is set by the flex column alone, so marking it clipped cannot
 * feed back into its own height.
 */
export const AskSecondary = ({ children }: { children: ReactNode }) => {
	const ref = useRef<HTMLDivElement>(null);
	const [clipped, setClipped] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const [atEnd, setAtEnd] = useState(true);
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const measure = () => {
			setClipped(node.scrollHeight > node.clientHeight + 1);
			setAtEnd(node.scrollTop + node.clientHeight >= node.scrollHeight - 1);
			/*
			 * COLLAPSED = the visible box is shorter than the first row's bottom
			 * (its offset includes the inner `pt-2`; the region is `relative`, so
			 * it is the offset parent). A jsdom/unlaid box (clientHeight 0 with no
			 * content height either) is not collapsed: nothing was squeezed.
			 */
			const first = node.firstElementChild?.firstElementChild as
				| HTMLElement
				| null
				| undefined;
			const need = first ? first.offsetTop + first.offsetHeight : 0;
			setCollapsed(need > 0 && node.clientHeight + 1 < need);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		if (node.firstElementChild) observer.observe(node.firstElementChild);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			ref={ref}
			{...{
				[ASK_SECONDARY_ATTR]: collapsed
					? "collapsed"
					: clipped
						? "clipped"
						: "fits",
			}}
			/*
			 * INERT WHILE COLLAPSED (design round 2, D9; WCAG 2.4.11): a 0 px region
			 * kept "Set auto ..." in the Tab order, focusable under the composer
			 * where nobody could see it. React 18's DOM types have no `inert` prop,
			 * hence the string spread (`system-prompt-editor.tsx` does the same).
			 */
			{...(collapsed ? { inert: "", "aria-hidden": true } : {})}
			onScroll={(event) => {
				const node = event.currentTarget;
				setAtEnd(node.scrollTop + node.clientHeight >= node.scrollHeight - 1);
			}}
			/*
			 * NO GAP WHEN COLLAPSED (design round 2, D8/S6): the card's `gap-2`
			 * still spaced a 0 px region, so the card overflowed itself by those
			 * 8 px and painted a second scrollbar. `-mt-2` cancels the card gap and
			 * the inner `pt-2` puts it back as content - so the spacing exists
			 * exactly as far as the region is visible, and is the first thing the
			 * squeeze takes.
			 */
			className={cn(
				"relative -mt-2 min-h-0 shrink-[999] overflow-y-auto overscroll-contain",
				clipped && !atEnd && !collapsed ? ASK_FADE_MASK : null,
			)}
		>
			<div className="flex flex-col gap-2 pt-2">{children}</div>
		</div>
	);
};

/**
 * The proposal's own line: what is being changed, and the way to its real review.
 *
 * A proposal's approval is a decision about a DIFF, and the card is the wrong
 * place to read one - so instead of the full before/after the card names the
 * target and links to the Agents page's proposal review, which renders the
 * changed lines. Accept/reject stay on the card (the link is in addition to the
 * answer pair, never instead of it), and the proposal id stays in the question
 * text the agent sent, which is what spoken approval in chat matches.
 *
 * In-app navigation (`useNavigate`), the same call the sidebar's agent links
 * use, so the reader keeps the session and can come back to answer.
 */
export const ProposalReviewNotice = ({
	proposal,
	className,
	review = true,
}: {
	proposal: ProfileProposalCard;
	className?: string;
	/**
	 * Draw the Review changes button here. The inline dock passes `false` and
	 * pins `ProposalReviewButton` in its header row instead (design round 2,
	 * S2), so the link never scrolls with the body; the Asks panel keeps it here.
	 */
	review?: boolean;
}) => {
	/*
	 * THE SUMMARY IS THE CORE'S OWN LINES (design D2), each on its own line at
	 * body size, because markdown had joined them into one heading-weight run.
	 * Verbatim rather than re-worded through the catalogue: the core's line 2
	 * carries statuses the UI does not enumerate (`order changed`, `whitespace
	 * only`, `… N more`) and the question line above it is the core's English
	 * too, so a half-translated summary would read worse than a consistent one.
	 * The target is NOT named again here: line 1 of the question already says
	 * "to team 'x'", and line 3's "Review changes in Agents → x" is the button.
	 * Line 2 clamps at two lines (code review R2); the full text is the review.
	 */
	return (
		<div
			data-lo-ask-proposal={proposal.id}
			className={cn("flex flex-col gap-1", className)}
		>
			{proposal.changes ? (
				<p
					data-lo-ask-proposal-changes=""
					title={proposal.changes}
					className="line-clamp-2 text-body text-ink"
				>
					{proposal.changes}
				</p>
			) : null}
			{proposal.origin ? (
				<p data-lo-ask-proposal-origin="" className="text-ink-muted text-meta">
					{proposal.origin}
				</p>
			) : null}
			{review ? (
				<ProposalReviewButton proposal={proposal} className="self-start" />
			) : null}
		</div>
	);
};

/** The way from a proposal card to its real review (see `ProposalReviewNotice`). */
export const ProposalReviewButton = ({
	proposal,
	className,
}: {
	proposal: ProfileProposalRef;
	className?: string;
}) => {
	const navigate = useNavigate();
	return (
		<button
			type="button"
			data-lo-ask-proposal-review=""
			onClick={() => navigate(profileProposalReviewPath(proposal))}
			className={cn(
				"inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-md border border-control px-2 py-1",
				"text-ink text-xs transition-colors duration-fast ease-out-quart hover:bg-sunken",
				"outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				className,
			)}
		>
			<FileDiff aria-hidden={true} className="size-3.5 shrink-0" />
			<span>{t("ui.chat.asks.proposal.review")}</span>
		</button>
	);
};
