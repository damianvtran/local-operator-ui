import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Simplified hook to handle scroll-to-bottom functionality with CSS-based approach
 *
 * This hook only tracks if the user has scrolled away from the bottom to show/hide
 * the scroll-to-bottom button. The actual scrolling is handled by CSS using
 * flex-direction: column-reverse.
 *
 * @param buttonThreshold - Distance from bottom (in pixels) to show the scroll button (default: 50)
 * @returns An object containing:
 *   - containerRef: A ref to attach to the scrollable container
 *   - isFarFromBottom: Whether the user is far enough from the bottom to show the scroll button
 *   - scrollToBottom: Function to manually scroll to the bottom with smooth behavior
 */
export const useScrollToBottom = (buttonThreshold = 50) => {
	// Ref for the scrollable container
	const containerRef = useRef<HTMLDivElement | null>(null);

	// State for button visibility
	const [isFarFromBottom, setIsFarFromBottom] = useState(false);

	// Ref to track if we're handling a scroll event to prevent recursive updates
	const isHandlingScrollRef = useRef(false);

	// Ref to track the last update time to throttle state updates
	const lastUpdateTimeRef = useRef(0);

	/**
	 * Calculate the current scroll position and update button visibility state
	 */
	const updateScrollPosition = useCallback(() => {
		if (!containerRef.current || isHandlingScrollRef.current) return;

		isHandlingScrollRef.current = true;

		try {
			// In a column-reverse layout, scrollTop of 0 means we're at the bottom
			// and higher values mean we've scrolled up (away from the bottom)
			const { scrollTop } = containerRef.current;

			// Show button when scrolled away from bottom by more than the threshold
			const shouldShowButton = scrollTop > buttonThreshold;

			// Only update state if value changed and throttled
			const now = Date.now();
			if (
				shouldShowButton !== isFarFromBottom &&
				now - lastUpdateTimeRef.current > 100
			) {
				// Throttle to max 10 updates per second
				setIsFarFromBottom(shouldShowButton);
				lastUpdateTimeRef.current = now;
			}
		} finally {
			isHandlingScrollRef.current = false;
		}
	}, [buttonThreshold, isFarFromBottom]);

	/**
	 * Scroll to bottom with smooth animation
	 */
	const scrollToBottom = useCallback(() => {
		if (!containerRef.current) return;

		// In a column-reverse layout, scrolling to bottom means setting scrollTop to 0
		containerRef.current.scrollTo({
			top: 0,
			behavior: "smooth",
		});
	}, []);

	/**
	 * Handle scroll events in the container - throttled for performance
	 */
	const handleScroll = useCallback(() => {
		if (isHandlingScrollRef.current) return;

		// Use requestAnimationFrame for better performance during scrolling
		requestAnimationFrame(() => {
			updateScrollPosition();
		});
	}, [updateScrollPosition]);

	/**
	 * Set up the scroll event listener on the container
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Use passive: true for better scroll performance
		container.addEventListener("scroll", handleScroll, { passive: true });

		// Initial check of scroll position
		updateScrollPosition();

		return () => {
			container.removeEventListener("scroll", handleScroll);
		};
	}, [handleScroll, updateScrollPosition]);

	/**
	 * Handle window resize events to update scroll position - throttled
	 */
	useEffect(() => {
		let resizeTimeoutId: number | null = null;

		const handleResize = () => {
			if (isHandlingScrollRef.current) return;

			// Clear any existing timeout
			if (resizeTimeoutId !== null) {
				window.clearTimeout(resizeTimeoutId);
			}

			// Debounce resize events
			resizeTimeoutId = window.setTimeout(() => {
				updateScrollPosition();
				resizeTimeoutId = null;
			}, 100);
		};

		window.addEventListener("resize", handleResize, { passive: true });

		return () => {
			window.removeEventListener("resize", handleResize);
			if (resizeTimeoutId !== null) {
				window.clearTimeout(resizeTimeoutId);
			}
		};
	}, [updateScrollPosition]);

	return {
		containerRef,
		isFarFromBottom,
		scrollToBottom,
	};
};
