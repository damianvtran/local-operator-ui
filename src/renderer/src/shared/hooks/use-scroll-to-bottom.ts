import {
	type ActivityFingerprint,
	advanceNewActivity,
	chipVisibleAt,
	followsTail,
	initialActivityState,
} from "@features/chat/canonical/new-activity";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserTailScrollEnv, scrollToTail } from "./scroll-to-tail";

/**
 * The jump-to-latest control's inputs.
 *
 * `contentKey` identifies the CONVERSATION, not its length. It used to be the
 * record count, which meant every arriving record re-ran the reset branch and
 * blanked the chip for a frame before the position was re-derived - a reader
 * who was scrolled up saw the control flash out under them each time an answer
 * grew. A conversation switch is the only thing that should reset it.
 *
 * `activity` is the transcript's tail fingerprint (`new-activity.ts`). A host
 * that does not pass one keeps today's behaviour: the chip shows on position
 * alone and never grows the new-activity label.
 */
export type ScrollToBottomOptions = {
	contentKey?: unknown;
	activity?: ActivityFingerprint;
};

export const useScrollToBottom = (
	externalContainerRef?: React.RefObject<HTMLDivElement>,
	options: ScrollToBottomOptions = {},
) => {
	const { contentKey, activity } = options;
	const internalContainerRef = useRef<HTMLDivElement | null>(null);
	const containerRef = externalContainerRef || internalContainerRef;

	const [isFarFromBottom, setIsFarFromBottom] = useState(false);
	const [hasNewActivity, setHasNewActivity] = useState(false);
	const isHandlingScrollRef = useRef(false);
	const prevContentKeyRef = useRef<unknown>(contentKey);
	const registerRef = useRef(initialActivityState(activity));
	/*
	 * Read through a ref rather than closing over the value, because the same
	 * `updateScrollPosition` is called from the scroll listener, the resize
	 * observer and the timers - all installed once per conversation - and a
	 * closure would freeze the fingerprint at install time.
	 */
	const activityRef = useRef(activity);
	activityRef.current = activity;
	/*
	 * The running flight's cancel, or null. While a flight is running the
	 * reader is, by their own request, on their way to the tail: the position
	 * readings below treat them as there (see `updateScrollPosition`).
	 */
	const flightRef = useRef<(() => void) | null>(null);

	/**
	 * Recalculate whether we're far from bottom, and fold the transcript's
	 * latest tail into the new-activity register.
	 *
	 * Both readings come from ONE geometry sample and ONE following predicate:
	 * |scrollTop| <= `TAIL_EPS_PX`, the same epsilon `use-scroll-paging.ts`
	 * follows the tail by. The previous 50px threshold left a band where paging
	 * refused to follow the tail while the chip stayed hidden.
	 */
	const updateScrollPosition = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		const { scrollHeight, clientHeight } = container;
		/*
		 * MID-FLIGHT THE DESTINATION IS THE READING. A scroll-to-tail flight
		 * passes through every offset between the reader and the tail; read
		 * literally, the chip would stay up for most of it and retire only at the
		 * landing, and the register would keep counting the reader as away while
		 * they travel toward the very rows it is counting. The reader asked for the
		 * tail, so the chip retires as the flight starts - the same tick
		 * `snapToBottom` retires it in. A gesture that cancels the flight clears
		 * the ref first, so the real offset is read again from then on.
		 */
		const scrollTop = flightRef.current ? 0 : container.scrollTop;
		const following = followsTail(scrollTop);
		setIsFarFromBottom(chipVisibleAt(scrollTop, scrollHeight, clientHeight));

		const next = activityRef.current;
		if (next) {
			registerRef.current = advanceNewActivity(
				registerRef.current,
				next,
				following,
			);
			const pending = registerRef.current.pending;
			setHasNewActivity((prev) => (prev === pending ? prev : pending));
		}
	}, [containerRef]);

	/**
	 * Carry the reader to the tail (scrollTop = 0 in column-reverse layouts).
	 *
	 * A frame-driven flight whose duration grows with the distance
	 * (`scroll-to-tail.ts` holds the model and the reasons). It replaced
	 * `scrollTo({ behavior: "smooth" })`, whose browser-chosen timing could not
	 * be tuned and which a layout change mid-flight - a streaming token - could
	 * cancel, leaving the reader short of the tail. Reduced motion snaps.
	 *
	 * Used by both the send (via the composer) and the jump-to-latest chip, so
	 * the two reach the tail the same way. A second request replaces a running
	 * flight from wherever it has got to.
	 */
	const scrollToBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;
		flightRef.current?.();
		let cancel: (() => void) | null = null;
		let done = false;
		cancel = scrollToTail(container, browserTailScrollEnv(), () => {
			done = true;
			if (flightRef.current === cancel) flightRef.current = null;
			updateScrollPosition();
		});
		// A synchronous settle (no motion, or a snap) has already run above.
		if (!done) {
			flightRef.current = cancel;
			updateScrollPosition();
		}
	}, [containerRef, updateScrollPosition]);

	/**
	 * Put the newest row under the reader NOW, without an animation.
	 *
	 * Sending is the reader asking for the newest row, and a send has to land
	 * with the echo visible in the same commit that clears the box - a smooth
	 * scroll would spend the first frames of the reader's own message still
	 * travelling down through the turn above it. The chip also retires in this
	 * same tick rather than chasing the animation.
	 */
	const snapToBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;
		container.scrollTop = 0;
		updateScrollPosition();
	}, [containerRef, updateScrollPosition]);

	/**
	 * Handle user-initiated scroll events.
	 * Uses requestAnimationFrame to batch updates and avoid recursion.
	 */
	const handleScroll = useCallback(() => {
		if (!containerRef.current || isHandlingScrollRef.current) return;
		isHandlingScrollRef.current = true;
		requestAnimationFrame(() => {
			updateScrollPosition();
			isHandlingScrollRef.current = false;
		});
	}, [containerRef, updateScrollPosition]);

	/**
	 * Set up the scroll listener and reset on conversation switch.
	 *
	 * The reset no longer blanks the chip: it seeds the register from the
	 * fingerprint the pane is showing and lets the synchronous position read
	 * decide. Blanking first and re-deriving on the next animation frame is what
	 * made the control flicker for a scrolled-up reader whenever the transcript
	 * changed.
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		if (prevContentKeyRef.current !== contentKey) {
			prevContentKeyRef.current = contentKey;
			// A flight belongs to the conversation it was asked in.
			flightRef.current?.();
			registerRef.current = initialActivityState(activityRef.current);
			setHasNewActivity(false);
		}

		container.addEventListener("scroll", handleScroll, { passive: true });

		// Re-derive from the CURRENT geometry rather than assuming "at bottom":
		// a restored deep-jump position or an already-scrolled pane is the truth.
		updateScrollPosition();

		// Re-check while layout settles around a conversation open or a restore.
		const rafId = requestAnimationFrame(updateScrollPosition);
		const timeoutId = window.setTimeout(updateScrollPosition, 100);
		const longTimeoutId = window.setTimeout(updateScrollPosition, 500);

		return () => {
			container.removeEventListener("scroll", handleScroll);
			// Never leave a flight writing a scroller that is being torn down.
			flightRef.current?.();
			cancelAnimationFrame(rafId);
			clearTimeout(timeoutId);
			clearTimeout(longTimeoutId);
		};
	}, [containerRef, contentKey, handleScroll, updateScrollPosition]);

	/**
	 * Fold in new tail content.
	 *
	 * Every record append and every streaming token reaches this effect through
	 * the fingerprint, which is O(1) on the last row (`activityFingerprint`).
	 * A reader who is away from the tail keeps the chip; a reader who is on it
	 * clears the register - no scroll event is required for either.
	 */
	useEffect(() => {
		if (activity) updateScrollPosition();
	}, [activity, updateScrollPosition]);

	/**
	 * Recalculate on window resize.
	 */
	useEffect(() => {
		const onResize = () => {
			updateScrollPosition();
		};
		window.addEventListener("resize", onResize, { passive: true });
		return () => {
			window.removeEventListener("resize", onResize);
		};
	}, [updateScrollPosition]);

	/**
	 * Recalculate whenever content size changes.
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver(() => {
			updateScrollPosition();
		});
		observer.observe(container);

		return () => {
			observer.disconnect();
		};
	}, [containerRef, updateScrollPosition]);

	return {
		containerRef,
		isFarFromBottom,
		hasNewActivity,
		scrollToBottom,
		snapToBottom,
	};
};
