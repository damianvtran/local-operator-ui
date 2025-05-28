import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Enhanced hook to handle scroll-to-bottom functionality with CSS-based approach
 *
 * This hook tracks if the user has scrolled away from the bottom to show/hide
 * the scroll-to-bottom button. The actual scrolling is handled by CSS using
 * flex-direction: column-reverse.
 *
 * Improvements:
 * - Checks initial scroll position when component mounts
 * - Handles cases where user might not be at bottom on page load
 * - More robust scroll position detection
 * - Properly handles resize events
 * - Supports external ref for the container
 *
 * @param buttonThreshold - Distance from bottom (in pixels) to show the scroll button (default: 50)
 * @param externalContainerRef - Optional external ref to use instead of creating a new one
 * @param contentKey - An optional key that changes when the main content changes (e.g., conversation ID)
 * @returns An object containing:
 *   - containerRef: A ref to attach to the scrollable container (only if externalContainerRef is not provided)
 *   - isFarFromBottom: Whether the user is far enough from the bottom to show the scroll button
 *   - scrollToBottom: Function to manually scroll to the bottom with smooth behavior
 */
export const useScrollToBottom = (
	buttonThreshold = 50,
	externalContainerRef?: React.RefObject<HTMLDivElement>,
	contentKey?: unknown, // Added contentKey parameter
) => {
	// Use the external ref if provided, otherwise create a new one
	const internalContainerRef = useRef<HTMLDivElement | null>(null);
	const containerRef = externalContainerRef || internalContainerRef;

	// State for button visibility
	const [isFarFromBottom, setIsFarFromBottom] = useState(false);

	// Ref to track if we're handling a scroll event to prevent recursive updates
	const isHandlingScrollRef = useRef(false);

	// Ref to track the last update time to throttle state updates
	const lastUpdateTimeRef = useRef(0);

	// Ref to track if initial position check has been performed
	const initialCheckPerformedRef = useRef(false);
	const prevContentKeyForScrollEffectRef = useRef(contentKey); // For the main scroll listener effect

	// Debounce scroll handling to improve performance
	const scrollTimeoutRef = useRef<number | null>(null);

	/**
	 * Calculate the current scroll position and update button visibility state
	 * Returns true if the position was updated, false otherwise
	 */
	const updateScrollPosition = useCallback(() => {
		if (!containerRef.current || isHandlingScrollRef.current) return false;

		isHandlingScrollRef.current = true;
		let localPositionUpdated = false;

		try {
			const container = containerRef.current;

			// In a column-reverse layout, scrollTop of 0 means we're at the bottom
			// and higher values mean we've scrolled up (away from the bottom)
			const { scrollTop } = container;

			// Handle both positive and negative scrollTop values
			// For negative scrollTop (which happens in some browsers with column-reverse):
			// - The most negative value is at the top (oldest messages)
			// - 0 is at the bottom (newest messages)

			// Calculate how far we are from the bottom
			// For negative scrollTop: we're at the bottom when scrollTop is close to 0
			// For positive scrollTop: we're at the bottom when scrollTop is close to 0
			const absScrollTop = Math.abs(scrollTop);
			const distanceFromBottom =
				scrollTop < 0
					? absScrollTop // For negative scrollTop
					: scrollTop; // For positive scrollTop

			// Check if the container is actually scrollable
			const canScroll = container.scrollHeight > container.clientHeight;

			// Show button only if scrollable and scrolled away from bottom
			const shouldShowButton =
				canScroll && distanceFromBottom > buttonThreshold;

			// Only update state if value changed and throttled
			const now = Date.now();
			// Use functional update to access previous state without adding it to dependencies
			setIsFarFromBottom((prevIsFarFromBottom) => {
				if (
					shouldShowButton !== prevIsFarFromBottom &&
					now - lastUpdateTimeRef.current > 100
				) {
					lastUpdateTimeRef.current = now;
					localPositionUpdated = true;
					return shouldShowButton;
				}
				return prevIsFarFromBottom;
			});
		} finally {
			isHandlingScrollRef.current = false;
		}

		return localPositionUpdated;
	}, [buttonThreshold, containerRef]);

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

		// Update button state after scrolling
		setTimeout(() => {
			updateScrollPosition();
		}, 100);
	}, [updateScrollPosition, containerRef]);

	/**
	 * Handle scroll events in the container - throttled for performance
	 */
	const handleScroll = useCallback(() => {
		if (!containerRef.current || isHandlingScrollRef.current) return;

		// Clear any pending timeout
		if (scrollTimeoutRef.current !== null) {
			window.clearTimeout(scrollTimeoutRef.current);
		}

		// Debounce the scroll event to reduce calculations
		scrollTimeoutRef.current = window.setTimeout(() => {
			// Use requestAnimationFrame for better performance during scrolling
			requestAnimationFrame(() => {
				updateScrollPosition();
			});

			scrollTimeoutRef.current = null;
		}, 50); // 50ms debounce
	}, [updateScrollPosition, containerRef]);

	/**
	 * Check if the user is at the bottom of the container
	 * This is used for the initial check and after content changes
	 */
	const checkInitialPosition = useCallback(() => {
		if (!containerRef.current) return;

		// Mark that we've performed the initial check
		initialCheckPerformedRef.current = true;

		// Reset throttle timer to ensure this update isn't skipped
		lastUpdateTimeRef.current = 0;

		// Update scroll position and check if button should be shown
		updateScrollPosition();
	}, [updateScrollPosition, containerRef]);

	/**
	 * Set up the scroll event listener on the container
	 */
	useEffect(() => {
		if (prevContentKeyForScrollEffectRef.current !== contentKey) {
			initialCheckPerformedRef.current = false; // Reset for new content
			prevContentKeyForScrollEffectRef.current = contentKey;
		}

		const container = containerRef.current;
		if (!container) return;

		// Use passive: true for better scroll performance
		container.addEventListener("scroll", handleScroll, { passive: true });

		// Initial check of scroll position with a slight delay to ensure content is rendered
		if (!initialCheckPerformedRef.current) {
			// First immediate check
			checkInitialPosition();

			// Second check after a short delay to account for any layout shifts
			const timeoutId = setTimeout(checkInitialPosition, 100);

			// Third check after content should definitely be loaded
			const longTimeoutId = setTimeout(checkInitialPosition, 500);

			return () => {
				clearTimeout(timeoutId);
				clearTimeout(longTimeoutId);
				if (scrollTimeoutRef.current !== null) {
					window.clearTimeout(scrollTimeoutRef.current);
					scrollTimeoutRef.current = null;
				}
				container.removeEventListener("scroll", handleScroll);
			};
		}

		return () => {
			if (scrollTimeoutRef.current !== null) {
				window.clearTimeout(scrollTimeoutRef.current);
				scrollTimeoutRef.current = null;
			}
			container.removeEventListener("scroll", handleScroll);
		};
	}, [handleScroll, checkInitialPosition, containerRef, contentKey]); // Added contentKey

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

	/**
	 * Re-check scroll position when content changes
	 * This effect runs on every render to catch any content changes
	 * but uses refs to prevent unnecessary work
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Use ResizeObserver to detect changes in content size affecting scrollHeight
		const observer = new ResizeObserver(() => {
			if (!isHandlingScrollRef.current) {
				// Debounce or throttle if ResizeObserver fires too rapidly for some content
				requestAnimationFrame(() => {
					updateScrollPosition();
				});
			}
		});

		observer.observe(container);
		let initialCheckTimeoutId: number | undefined;

		// This effect re-runs when contentKey changes.
		// Schedule a check for the scroll position.
		if (!isHandlingScrollRef.current) {
			initialCheckTimeoutId = window.setTimeout(() => {
				if (containerRef.current && !isHandlingScrollRef.current) {
					updateScrollPosition();
				}
			}, 50); // Delay to allow layout to settle
		}

		return () => {
			if (initialCheckTimeoutId) {
				clearTimeout(initialCheckTimeoutId);
			}
			observer.disconnect();
		};
	}, [containerRef, updateScrollPosition]); // Removed contentKey, its role is handled by the other useEffect

	return {
		containerRef,
		isFarFromBottom,
		scrollToBottom,
	};
};
