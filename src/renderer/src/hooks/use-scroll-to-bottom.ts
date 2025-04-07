import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

/**
 * Custom hook to scroll to the bottom of a container when the content changes
 * Only scrolls to bottom if the user is already near the bottom
 * Optimized to reduce unnecessary re-renders and calculations
 *
 * @param dependencies - Array of dependencies that trigger scrolling when changed
 * @param threshold - Distance from bottom (in pixels) to consider "near bottom" (default: 300)
 * @param buttonThreshold - Distance from bottom (in pixels) to show the scroll button (default: 100)
 * @returns An object containing:
 *   - ref: A ref to attach to the element to scroll to
 *   - isNearBottom: Whether the user is near the bottom
 *   - isFarFromBottom: Whether the user is far enough from the bottom to show the scroll button
 *   - scrollToBottom: Function to manually scroll to the bottom
 *   - forceScrollToBottom: Function to force scroll to bottom regardless of current position
 *   - containerRef: A ref to the scrollable container
 */
export const useScrollToBottom = (
	dependencies: DependencyList = [],
	threshold = 150,
	buttonThreshold = 50, // Reduced from 100 to make the button appear more readily
) => {
	const ref = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
	const [isFarFromBottom, setIsFarFromBottom] = useState(false);

	// Use a ref to track the last scroll position to avoid unnecessary state updates
	const lastScrollPositionRef = useRef<number>(0);
	const scrollTimeoutRef = useRef<number | null>(null);

	// Track if we're currently processing a scroll event
	const isProcessingScrollRef = useRef<boolean>(false);

	/**
	 * Function to manually scroll to the bottom
	 * Uses requestAnimationFrame for smoother scrolling
	 */
	const scrollToBottom = useCallback(() => {
		if (!ref.current) return;

		requestAnimationFrame(() => {
			if (ref.current) {
				ref.current.scrollIntoView({ behavior: "smooth" });
			}
		});
	}, []);

	/**
	 * Function to force scroll to the bottom regardless of current scroll position
	 * This bypasses the normal "near bottom" check and directly scrolls
	 * Uses multiple techniques to ensure scrolling works in all scenarios
	 */
	const isForcedScrollRef = useRef(false);
	const forceScrollToBottom = useCallback(() => {
		if (!containerRef.current) return;

		// Set forced scroll flag
		isForcedScrollRef.current = true;

		// Use container scroll for better reliability
		containerRef.current.scrollTop = containerRef.current.scrollHeight;

		// Clear forced scroll flag after animation frame
		requestAnimationFrame(() => {
			isForcedScrollRef.current = false;
		});
	}, []);

	/**
	 * Function to check if we should show the scroll button
	 * This is called both on scroll events and when dependencies change
	 */
	const checkScrollPosition = useCallback(() => {
		if (!containerRef.current || isProcessingScrollRef.current) return;

		isProcessingScrollRef.current = true;

		const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

		// Only update state if the scroll position has changed significantly
		// or if the shouldScrollToBottom value would change
		const currentShouldScroll = distanceFromBottom <= threshold;

		// Show the button when we're more than buttonThreshold pixels from the bottom
		const shouldShowButton = distanceFromBottom > buttonThreshold;

		if (
			Math.abs(lastScrollPositionRef.current - scrollTop) > 20 ||
			currentShouldScroll !== shouldScrollToBottom ||
			shouldShowButton !== isFarFromBottom
		) {
			lastScrollPositionRef.current = scrollTop;
			setShouldScrollToBottom(currentShouldScroll);
			setIsFarFromBottom(shouldShowButton);
		}

		isProcessingScrollRef.current = false;
	}, [threshold, buttonThreshold, shouldScrollToBottom, isFarFromBottom]);

	// Throttled scroll handler to improve performance
	const handleScroll = useCallback(() => {
		if (!containerRef.current) return;

		// Clear any pending timeout
		if (scrollTimeoutRef.current !== null) {
			window.clearTimeout(scrollTimeoutRef.current);
		}

		// Debounce the scroll event to reduce calculations
		scrollTimeoutRef.current = window.setTimeout(() => {
			checkScrollPosition();
			scrollTimeoutRef.current = null;
		}, 50); // 50ms debounce (reduced from 100ms for more responsive updates)
	}, [checkScrollPosition]);

	// Set up scroll event listener with passive option for better performance
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Use passive: true for better scroll performance
		container.addEventListener("scroll", handleScroll, { passive: true });

		// Initial check of scroll position
		checkScrollPosition();

		return () => {
			if (scrollTimeoutRef.current !== null) {
				window.clearTimeout(scrollTimeoutRef.current);
			}
			container.removeEventListener("scroll", handleScroll);
		};
	}, [handleScroll, checkScrollPosition]);

	// Check scroll position when dependencies change
	useEffect(() => {
		// Use requestAnimationFrame to ensure DOM has updated
		const animationFrame = requestAnimationFrame(() => {
			checkScrollPosition();
		});

		return () => cancelAnimationFrame(animationFrame);
	}, [...dependencies, checkScrollPosition]);

	// Memoize the scroll to bottom effect
	useEffect(() => {
		// Skip if:
		// - We shouldn't scroll to bottom
		// - User is far from bottom (scrolled up reading)
		// - Forced scroll is active
		// - No ref available
		if (
			!shouldScrollToBottom ||
			isFarFromBottom ||
			isForcedScrollRef.current ||
			!ref.current
		)
			return;

		// Use requestAnimationFrame for smoother scrolling
		const animationFrame = requestAnimationFrame(() => {
			if (ref.current) {
				ref.current.scrollIntoView({ behavior: "smooth" });
			}
		});

		return () => cancelAnimationFrame(animationFrame);
	}, [...dependencies, shouldScrollToBottom, isFarFromBottom]); // eslint-disable-line react-hooks/exhaustive-deps

	// Dynamically update containerRef whenever the bottom ref changes
	useEffect(() => {
		if (!ref.current) return;

		// Find the scrollable parent
		let parent = ref.current.parentElement;
		while (parent) {
			const { overflow, overflowY } = window.getComputedStyle(parent);
			if (
				overflow === "auto" ||
				overflow === "scroll" ||
				overflowY === "auto" ||
				overflowY === "scroll"
			) {
				// Only update if different to avoid unnecessary resets
				if (containerRef.current !== parent) {
					containerRef.current = parent as HTMLDivElement;
					checkScrollPosition();

					// Re-attach scroll event listener to new container
					parent.addEventListener("scroll", handleScroll, { passive: true });
				}
				break;
			}
			parent = parent.parentElement;
		}

		// Cleanup: remove scroll listener from old container if it changed
		return () => {
			if (containerRef.current) {
				containerRef.current.removeEventListener("scroll", handleScroll);
			}
		};
	}, [checkScrollPosition, handleScroll]);

	return {
		ref,
		containerRef,
		isNearBottom: shouldScrollToBottom,
		isFarFromBottom,
		scrollToBottom,
		forceScrollToBottom,
	};
};
