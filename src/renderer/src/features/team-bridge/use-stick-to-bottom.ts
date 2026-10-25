import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
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
 */
const NEAR_BOTTOM_PX = 48;
const VIEWPORT = "[data-radix-scroll-area-viewport]";

export function useStickToBottom<T extends HTMLElement = HTMLDivElement>({
	resetKey,
	contentKey,
}: {
	resetKey: string;
	contentKey: string;
}): { rootRef: RefObject<T>; pin: () => void; hold: () => void } {
	const rootRef = useRef<T>(null);
	// A ref, not state: following the bottom must not re-render the timeline.
	const pinned = useRef(true);
	const viewport = useCallback(
		() => rootRef.current?.querySelector<HTMLElement>(VIEWPORT) ?? null,
		[],
	);
	const toBottom = useCallback(() => {
		const element = viewport();
		if (element) element.scrollTop = element.scrollHeight;
	}, [viewport]);
	const pin = useCallback(() => {
		pinned.current = true;
		toBottom();
	}, [toBottom]);
	/*
	 * Unpin WITHOUT moving: for an action the reader takes at the bottom that
	 * appends content they mean to read from where they are - the thread's
	 * forward-paging "Load more replies" (review r8 m2). Pinned, the new page
	 * would scroll past every reply it just loaded.
	 */
	const hold = useCallback(() => {
		pinned.current = false;
	}, []);

	// Layout effects: the jump happens before paint, so nothing flashes at the top.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey IS the trigger.
	useLayoutEffect(() => {
		pinned.current = true;
		toBottom();
	}, [resetKey, toBottom]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: contentKey IS the trigger.
	useLayoutEffect(() => {
		if (pinned.current) toBottom();
	}, [contentKey, toBottom]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey re-binds the listeners - a new conversation can mount a new viewport.
	useEffect(() => {
		const element = viewport();
		if (!element) return;
		const onScroll = () => {
			pinned.current =
				element.scrollHeight - element.scrollTop - element.clientHeight <=
				NEAR_BOTTOM_PX;
		};
		// `load` does not bubble; capture sees every image inside the viewport.
		const onLoad = (event: Event) => {
			if (pinned.current && event.target instanceof HTMLImageElement)
				toBottom();
		};
		element.addEventListener("scroll", onScroll, { passive: true });
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
			element.removeEventListener("load", onLoad, true);
			resize?.disconnect();
		};
	}, [viewport, toBottom, resetKey]);

	return { rootRef, pin, hold };
}
