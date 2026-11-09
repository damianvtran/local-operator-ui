import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/**
 * Stick-to-bottom for the Team Bridge timeline AND the thread pane (one hook,
 * so the two read the same way).
 *
 * WHY: a chat timeline is read from the bottom. Before this, both panes opened
 * at scrollTop 0, so the newest message - and the message you had just sent -
 * sat below the fold (live E2E F9: scrollTop 0, scrollHeight 1072, clientHeight
 * 728, newest tile not in view). Slack and Discord behave as below, and so
 * does this:
 * - a new `resetKey` (another conversation or thread) opens at the newest
 *   message;
 * - `pin()` - called by the composer on the author's own send - jumps to the
 *   bottom and stays pinned, so the sent message lands in view when it arrives;
 * - a new message (`contentKey` changes) keeps the view at the bottom ONLY
 *   when the reader was already within `NEAR_BOTTOM_PX` of it. Someone who
 *   scrolled up to read history is never yanked back down.
 *
 * The composer growing shrinks the viewport rather than growing the content,
 * so the viewport is observed too (D9, below).
 *
 * Image tiles reserve their box before loading (`boxFor`), so a load should
 * not move anything. In case a reflow still happens (a font swap, a localized
 * line that wraps, a placeholder swapping for its picture), image `load` events
 * and a ResizeObserver on the content re-pin - but only while pinned, so they
 * never fight a reader who has scrolled away.
 *
 * The scroll container is Radix's viewport inside our `ScrollArea`; the ref
 * goes on the ScrollArea root and the viewport is found by its data attribute,
 * the same way `team-bridge-thread-read.ts` finds it.
 *
 * UPWARD INTENT UNPINS AT ONCE; ONLY THE READER RE-PINS (the "it fights me"
 * fix). `pinned` used to be re-derived from geometry on every scroll event:
 * within `NEAR_BOTTOM_PX` of the end counted as pinned. A reader at the bottom
 * who scrolls up with small trackpad deltas spends the first several events
 * inside that band, so they stayed pinned - and the windowed timeline re-cuts
 * its mounted slice and re-measures rows as they scroll, so the content
 * resizes mid-gesture, the ResizeObserver below fires, and `toBottom()` threw
 * them back. Every gesture restarted inside the band, so they could never get
 * out. Now:
 * - a scroll that moved UP and left the reader off the very end unpins,
 *   whatever the distance (wheel, keys, scrollbar drag and touch all arrive as
 *   a scrollTop decrease; checked against the last position we observed OR
 *   wrote ourselves, so our own `toBottom()` is never mistaken for intent);
 * - a wheel tick upward unpins even before the browser applies it, because a
 *   resize can land between the wheel and its scroll event;
 * - re-pinning needs the reader's own move DOWN into the band (or `pin()`, a
 *   new `resetKey`, the live edge returning). A scroll that ends exactly at
 *   the end because content SHRANK (the browser clamps scrollTop down) keeps
 *   a pinned reader pinned - that decrease is not intent.
 * The page's windowed timeline consults this decision through `isPinned`
 * before its own end-snap, so once the reader has left, neither hook writes
 * them back to the end (its own "at bottom" lags a frame behind the scroll).
 */
const NEAR_BOTTOM_PX = 48;
/** "At the very end": one pixel, because fractional layouts settle by fractions. */
const AT_END_PX = 1;
const VIEWPORT = "[data-radix-scroll-area-viewport]";

export function useStickToBottom<T extends HTMLElement = HTMLDivElement>({
	resetKey,
	contentKey,
	scrollElement = "radix",
	preserveAnchor = false,
	rowIds,
	rowSelector = "[data-message-id]",
	liveEdgeAvailable = true,
}: {
	resetKey: string;
	contentKey: string;
	/** Audit uses a native overflow host, while member/thread panes use Radix.
	 * Opt in explicitly; never accidentally scroll a wrapper in existing panes. */
	scrollElement?: "radix" | "root";
	/** Opt-in history retention; member/thread policy is unchanged by default. */
	preserveAnchor?: boolean;
	rowIds?: readonly string[];
	/** A thread root is static context, not an anchor inside its moving reply window. */
	rowSelector?: string;
	/** A bounded older-history window is never the live edge. */
	liveEdgeAvailable?: boolean;
}): {
	rootRef: RefObject<T>;
	pin: () => void;
	hold: () => void;
	/** Read the controller, not geometry: hold() unpins without scrolling. */
	isPinned: () => boolean;
	newMessages: number;
} {
	const rootRef = useRef<T>(null);
	// A ref, not state: following the bottom must not re-render the timeline.
	const pinned = useRef(true);
	const previousLiveEdge = useRef(liveEdgeAvailable);
	const anchor = useRef<{ id: string; offset: number } | null>(null);
	const previousRows = useRef<readonly string[]>([]);
	/* The scroll position we last saw or set. Direction is judged against this,
	   and our own writes update it, so a reader's upward scroll that coalesces
	   with one of our `toBottom()` writes still reads as upward. */
	const lastTop = useRef(0);
	const [newMessages, setNewMessages] = useState(0);
	const viewport = useCallback(
		() =>
			scrollElement === "root"
				? rootRef.current
				: (rootRef.current?.querySelector<HTMLElement>(VIEWPORT) ?? null),
		[scrollElement],
	);
	/* Keep a ROW and its viewport-relative pixel position, not scrollHeight:
	 * prepends, changing disclosure height and late image loads can all move
	 * content above a reader without changing which message they are reading. */
	const captureAnchor = useCallback(() => {
		if (!preserveAnchor) return;
		const element = viewport();
		if (!element) return;
		const box = element.getBoundingClientRect();
		const row = [...element.querySelectorAll<HTMLElement>(rowSelector)].find(
			(node) => {
				const r = node.getBoundingClientRect();
				return r.bottom > box.top && r.top < box.bottom;
			},
		);
		anchor.current = row
			? {
					id: row.dataset.messageId ?? "",
					offset: row.getBoundingClientRect().top - box.top,
				}
			: null;
	}, [preserveAnchor, viewport, rowSelector]);
	const restoreAnchor = useCallback(() => {
		if (!preserveAnchor || !anchor.current) return;
		const element = viewport();
		if (!element) return;
		const row = [...element.querySelectorAll<HTMLElement>(rowSelector)].find(
			(node) => node.dataset.messageId === anchor.current?.id,
		);
		if (row) {
			element.scrollTop +=
				row.getBoundingClientRect().top -
				element.getBoundingClientRect().top -
				anchor.current.offset;
			lastTop.current = element.scrollTop;
		}
	}, [preserveAnchor, viewport, rowSelector]);
	const toBottom = useCallback(() => {
		const element = viewport();
		if (!element) return;
		element.scrollTop = element.scrollHeight;
		// Read back: the browser clamps, and the clamped value is what we compare to.
		lastTop.current = element.scrollTop;
	}, [viewport]);
	const pin = useCallback(() => {
		if (!liveEdgeAvailable) return;
		pinned.current = true;
		if (preserveAnchor) setNewMessages(0);
		toBottom();
	}, [toBottom, preserveAnchor, liveEdgeAvailable]);
	/*
	 * Unpin WITHOUT moving: for an action the reader takes at the bottom that
	 * appends content they mean to read from where they are - the thread's
	 * forward-paging "Load more replies" (review r8 m2). Pinned, the new page
	 * would scroll past every reply it just loaded.
	 */
	const hold = useCallback(() => {
		pinned.current = false;
		captureAnchor();
	}, [captureAnchor]);
	const isPinned = useCallback(
		() => pinned.current && liveEdgeAvailable,
		[liveEdgeAvailable],
	);

	// Layout effects: the jump happens before paint, so nothing flashes at the top.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey IS the trigger.
	useLayoutEffect(() => {
		pinned.current = liveEdgeAvailable;
		previousLiveEdge.current = liveEdgeAvailable;
		anchor.current = null;
		previousRows.current = rowIds ?? [];
		if (preserveAnchor) setNewMessages(0);
		toBottom();
	}, [resetKey, toBottom]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: contentKey and live-edge restoration are the triggers.
	useLayoutEffect(() => {
		const restoredLatest = liveEdgeAvailable && !previousLiveEdge.current;
		previousLiveEdge.current = liveEdgeAvailable;
		if (!liveEdgeAvailable) pinned.current = false;
		else if (restoredLatest) {
			// Explicit latest may return the same IDs: availability, not a row
			// append, must release the held range and restore the live anchor.
			pinned.current = true;
			anchor.current = null;
			if (preserveAnchor) setNewMessages(0);
		}
		if (pinned.current) toBottom();
		else {
			restoreAnchor();
			if (preserveAnchor && rowIds) {
				const previousLast = previousRows.current.at(-1);
				const index = previousLast ? rowIds.indexOf(previousLast) : -1;
				if (index >= 0 && index < rowIds.length - 1)
					setNewMessages((count) => count + rowIds.length - index - 1);
			}
		}
		previousRows.current = rowIds ?? [];
	}, [contentKey, toBottom, liveEdgeAvailable]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey re-binds the listeners - a new conversation can mount a new viewport.
	useEffect(() => {
		const element = viewport();
		if (!element) return;
		lastTop.current = element.scrollTop;
		const onScroll = () => {
			const top = element.scrollTop;
			const fromEnd = element.scrollHeight - top - element.clientHeight;
			const movedUp = top < lastTop.current - AT_END_PX;
			lastTop.current = top;
			if (!liveEdgeAvailable) pinned.current = false;
			else if (movedUp && fromEnd > AT_END_PX) pinned.current = false;
			// Moving down (or a clamp that left the reader at the very end): the
			// band decides, as it always has - entering it re-pins, and a jump
			// that lands far above the end (a restored position) is not pinned.
			else pinned.current = fromEnd <= NEAR_BOTTOM_PX;
			if (pinned.current) {
				anchor.current = null;
				if (preserveAnchor) setNewMessages(0);
			} else captureAnchor();
		};
		// `load` does not bubble; capture sees every image inside the viewport.
		const onLoad = (event: Event) => {
			if (event.target instanceof HTMLImageElement) {
				if (pinned.current) toBottom();
				else restoreAnchor();
			}
		};
		/* The wheel arrives before its scroll, and a content resize can fire in
		   between: unpin on the intent itself. A pinch-zoom (ctrlKey) is not a
		   scroll. A downward tick inside the band re-pins, so a stray upward tick
		   the browser absorbed at the end cannot strand the reader unpinned. */
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey || !liveEdgeAvailable) return;
			if (event.deltaY < 0) {
				if (pinned.current) {
					pinned.current = false;
					captureAnchor();
				}
			} else if (
				event.deltaY > 0 &&
				!pinned.current &&
				element.scrollHeight - element.scrollTop - element.clientHeight <=
					NEAR_BOTTOM_PX
			) {
				pinned.current = true;
				anchor.current = null;
				if (preserveAnchor) setNewMessages(0);
			}
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		element.addEventListener("wheel", onWheel, { passive: true });
		element.addEventListener("load", onLoad, true);
		/*
		 * Observe Radix's content wrapper AND its direct children (review r8 m1).
		 * The channel timeline forces that wrapper to `h-full`, so it never
		 * resizes there - growth happens in the inner column, which overflows it.
		 * The thread pane keeps the wrapper auto-height, so the wrapper itself
		 * carries its growth. Watching both covers either layout without the
		 * caller having to name a box.
		 */
		const content = element.firstElementChild;
		const resize =
			typeof ResizeObserver === "function" && content
				? new ResizeObserver(() => {
						if (pinned.current) toBottom();
						else restoreAnchor();
					})
				: null;
		if (resize && content) {
			resize.observe(content);
			for (const child of content.children) resize.observe(child);
		}
		/*
		 * And the VIEWPORT itself (design round 2, D9): the composer below the
		 * timeline grows (a long draft, a held attempt, a localized recovery
		 * line) by taking height from the viewport, not by growing the content,
		 * so nothing above fires and the last row slides under the composer's
		 * top edge. A pinned reader stays pinned; one who scrolled up is not
		 * moved, the same rule as every other re-pin here.
		 */
		resize?.observe(element);
		return () => {
			element.removeEventListener("scroll", onScroll);
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("load", onLoad, true);
			resize?.disconnect();
		};
	}, [
		viewport,
		toBottom,
		resetKey,
		liveEdgeAvailable,
		preserveAnchor,
		captureAnchor,
		restoreAnchor,
	]);

	return { rootRef, pin, hold, isPinned, newMessages };
}
