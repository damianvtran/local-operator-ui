import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

/**
 * Custom hook to scroll to the bottom of a container when the content changes
 * Only scrolls to bottom if the user is already near the bottom
 * Optimized for reliability and performance with minimal re-renders
 *
 * @param dependencies - Array of dependencies that trigger scrolling when changed
 * @param threshold - Distance from bottom (in pixels) to consider "near bottom" (default: 150)
 * @param buttonThreshold - Distance from bottom (in pixels) to show the scroll button (default: 50)
 * @returns An object containing:
 *   - ref: A ref to attach to the element at the bottom of the content
 *   - containerRef: A ref to attach to the scrollable container
 *   - isNearBottom: Whether the user is near the bottom
 *   - isFarFromBottom: Whether the user is far enough from the bottom to show the scroll button
 *   - scrollToBottom: Function to manually scroll to the bottom with smooth behavior
 *   - forceScrollToBottom: Function to immediately scroll to bottom without animation
 */
export const useScrollToBottom = (
	dependencies: DependencyList = [],
	threshold = 150,
	buttonThreshold = 50,
) => {
	// Refs for DOM elements
	const ref = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);

	// State for scroll position - use refs for internal state to avoid re-renders during scrolling
	const isNearBottomRef = useRef(true);
	const isFarFromBottomRef = useRef(false);

	// State for UI updates - only updated when needed to trigger re-renders
	const [isNearBottom, setIsNearBottom] = useState(true);
	const [isFarFromBottom, setIsFarFromBottom] = useState(false);

	// Ref to track if a scroll operation is in progress to prevent interference
	const isScrollingRef = useRef(false);

	// Ref to track if we're currently handling a scroll event to prevent recursive updates
	const isHandlingScrollRef = useRef(false);

	// Ref to track if we should auto-scroll on content changes
	const shouldAutoScrollRef = useRef(true);

	// Ref to track the last measured scroll height to detect content changes
	const lastScrollHeightRef = useRef(0);

	// Ref to track the last update time to throttle state updates
	const lastUpdateTimeRef = useRef(0);

	/**
	 * Calculate the current scroll position and update internal refs
	 * Only updates state (triggering re-renders) when necessary and throttled
	 */
	const updateScrollPosition = useCallback(() => {
		if (!containerRef.current || isHandlingScrollRef.current) return;

		isHandlingScrollRef.current = true;

		try {
			const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

			// Update auto-scroll flag based on how close to bottom we are
			shouldAutoScrollRef.current = distanceFromBottom <= threshold;

			// Update internal refs
			isNearBottomRef.current = distanceFromBottom <= threshold;
			isFarFromBottomRef.current = distanceFromBottom > buttonThreshold;

			// Store the current scroll height for comparison
			lastScrollHeightRef.current = scrollHeight;

			// Only update state (triggering re-renders) if values changed and throttled
			const now = Date.now();
			if (
				(isNearBottomRef.current !== isNearBottom ||
					isFarFromBottomRef.current !== isFarFromBottom) &&
				now - lastUpdateTimeRef.current > 100 // Throttle to max 10 updates per second
			) {
				setIsNearBottom(isNearBottomRef.current);
				setIsFarFromBottom(isFarFromBottomRef.current);
				lastUpdateTimeRef.current = now;
			}
		} finally {
			isHandlingScrollRef.current = false;
		}
	}, [threshold, buttonThreshold, isNearBottom, isFarFromBottom]);

	/**
	 * Scroll to bottom with smooth animation
	 */
	const scrollToBottom = useCallback(() => {
		if (!ref.current || !containerRef.current || isScrollingRef.current) return;

		isScrollingRef.current = true;
		shouldAutoScrollRef.current = true;

		ref.current.scrollIntoView({ behavior: "smooth" });

		// Reset scrolling flag after animation completes
		setTimeout(() => {
			isScrollingRef.current = false;
			updateScrollPosition();
		}, 300);
	}, [updateScrollPosition]);

	/**
	 * Immediately scroll to bottom without animation
	 * Used for initial load and when we need to ensure the scroll happens immediately
	 * Enhanced to be more robust with DOM updates
	 */
	const forceScrollToBottom = useCallback(() => {
		if (!containerRef.current) return;

		// Allow force scroll even if another scroll is in progress
		// This is important for message submission where we want to ensure scrolling happens
		isScrollingRef.current = true;
		shouldAutoScrollRef.current = true;

		// Get current scroll height before attempting to scroll
		const initialScrollHeight = containerRef.current.scrollHeight;

		// Direct scrollTop manipulation for immediate scroll
		containerRef.current.scrollTop = containerRef.current.scrollHeight;

		// Check if scroll height changed during the operation
		// This helps detect if content was added during scrolling
		const currentScrollHeight = containerRef.current.scrollHeight;
		if (currentScrollHeight > initialScrollHeight) {
			// If content height increased, scroll again to catch the new content
			containerRef.current.scrollTop = currentScrollHeight;
		}

		// Reset scrolling flag after a short delay
		setTimeout(() => {
			if (containerRef.current) {
				// Final check to ensure we're at the bottom after any DOM updates
				const finalScrollHeight = containerRef.current.scrollHeight;
				if (finalScrollHeight > currentScrollHeight) {
					containerRef.current.scrollTop = finalScrollHeight;
				}
			}

			isScrollingRef.current = false;
			updateScrollPosition();
		}, 50);
	}, [updateScrollPosition]);

	/**
	 * Handle scroll events in the container - throttled for performance
	 */
	const handleScroll = useCallback(() => {
		if (isScrollingRef.current || isHandlingScrollRef.current) return;

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
	 * Find the scrollable container when the ref changes
	 */
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
					updateScrollPosition();
				}
				break;
			}
			parent = parent.parentElement;
		}
	}, [updateScrollPosition]);

	/**
	 * Auto-scroll to bottom when dependencies change and we're near the bottom
	 * Uses internal refs instead of state to avoid unnecessary re-renders
	 *
	 * Note: We intentionally omit forceScrollToBottom and updateScrollPosition from the
	 * dependencies array to prevent infinite loops, as they would cause this effect to
	 * run again after they're called within the effect. This is safe because these
	 * functions' references are stable and only depend on refs that persist across renders.
	 */
	useEffect(() => {
		// Store references to the functions to use inside the effect
		const scrollToBottomFn = forceScrollToBottom;
		const updatePositionFn = updateScrollPosition;

		if (
			!containerRef.current ||
			isScrollingRef.current ||
			isHandlingScrollRef.current
		)
			return;

		// Check if content height has changed significantly
		const currentScrollHeight = containerRef.current.scrollHeight;
		const hasContentChanged =
			Math.abs(currentScrollHeight - lastScrollHeightRef.current) > 5;

		// Auto-scroll if we're near the bottom and content has changed
		if (shouldAutoScrollRef.current && hasContentChanged) {
			scrollToBottomFn();
		} else {
			// Just update the position state without scrolling
			updatePositionFn();
		}
	}, [...dependencies, forceScrollToBottom, updateScrollPosition]);

	/**
	 * Handle window resize events to update scroll position - throttled
	 */
	useEffect(() => {
		let resizeTimeoutId: number | null = null;

		const handleResize = () => {
			if (isScrollingRef.current || isHandlingScrollRef.current) return;

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

	// Memoize the return value to prevent unnecessary re-renders
	return {
		ref,
		containerRef,
		isNearBottom,
		isFarFromBottom,
		scrollToBottom,
		forceScrollToBottom,
	};
};
