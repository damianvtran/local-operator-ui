import { useEffect, useRef, useState, useCallback } from "react";
import type { DependencyList } from "react";

/**
 * Custom hook to scroll to the bottom of a container when the content changes
 * Only scrolls to bottom if the user is already near the bottom
 * Optimized to reduce unnecessary re-renders and calculations
 * 
 * @param dependencies - Array of dependencies that trigger scrolling when changed
 * @param threshold - Distance from bottom (in pixels) to consider "near bottom" (default: 300)
 * @param screenHeightThreshold - Number of screen heights to consider "far from bottom" for showing the scroll button (default: 1)
 * @returns An object containing:
 *   - ref: A ref to attach to the element to scroll to
 *   - isNearBottom: Whether the user is near the bottom
 *   - isFarFromBottom: Whether the user is far enough from the bottom to show the scroll button
 *   - scrollToBottom: Function to manually scroll to the bottom
 */
export const useScrollToBottom = (
  dependencies: DependencyList = [], 
  threshold = 300,
  screenHeightThreshold = 1
) => {
	const ref = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);
	const [isFarFromBottom, setIsFarFromBottom] = useState(false);
	
	// Use a ref to track the last scroll position to avoid unnecessary state updates
	const lastScrollPositionRef = useRef<number>(0);
	const scrollTimeoutRef = useRef<number | null>(null);

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

	// Throttled scroll handler to improve performance
	// Only updates state if the scroll position has changed significantly
	const handleScroll = useCallback(() => {
		if (!containerRef.current) return;
		
		// Clear any pending timeout
		if (scrollTimeoutRef.current !== null) {
			window.clearTimeout(scrollTimeoutRef.current);
		}
		
		// Debounce the scroll event to reduce calculations
		scrollTimeoutRef.current = window.setTimeout(() => {
			if (!containerRef.current) return;
			
			const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
			const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
			
			// Only update state if the scroll position has changed significantly
			// or if the shouldScrollToBottom value would change
			const currentShouldScroll = distanceFromBottom <= threshold;
			
			// Check if user is far enough from bottom to show the scroll button
			// Use screen height as a reference for better UX
			// Make it more sensitive by using a lower threshold
			const isFarEnough = distanceFromBottom > clientHeight;
			
			if (
				Math.abs(lastScrollPositionRef.current - scrollTop) > 50 || 
				currentShouldScroll !== shouldScrollToBottom ||
				isFarEnough !== isFarFromBottom
			) {
				lastScrollPositionRef.current = scrollTop;
				setShouldScrollToBottom(currentShouldScroll);
				setIsFarFromBottom(isFarEnough);
			}
			
			scrollTimeoutRef.current = null;
		}, 100); // 100ms debounce
	}, [threshold, shouldScrollToBottom, isFarFromBottom, screenHeightThreshold]);

	// Set up scroll event listener with passive option for better performance
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Use passive: true for better scroll performance
		container.addEventListener("scroll", handleScroll, { passive: true });
		return () => {
			if (scrollTimeoutRef.current !== null) {
				window.clearTimeout(scrollTimeoutRef.current);
			}
			container.removeEventListener("scroll", handleScroll);
		};
	}, [handleScroll]);

	// Memoize the scroll to bottom effect
	useEffect(() => {
		// Skip if we shouldn't scroll to bottom
		if (!shouldScrollToBottom || !ref.current) return;
		
		// Use requestAnimationFrame for smoother scrolling
		const animationFrame = requestAnimationFrame(() => {
			if (ref.current) {
				ref.current.scrollIntoView({ behavior: "smooth" });
			}
		});
		
		return () => cancelAnimationFrame(animationFrame);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...dependencies, shouldScrollToBottom]);

	// Set containerRef to the parent of the ref element
	// This only needs to run once after the ref is set
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
				containerRef.current = parent as HTMLDivElement;
				break;
			}
			parent = parent.parentElement;
		}
	}, []);

	return {
		ref,
		isNearBottom: shouldScrollToBottom,
		isFarFromBottom,
		scrollToBottom
	};
};
