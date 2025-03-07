import { useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

/**
 * Custom hook to scroll to the bottom of a container when the content changes
 * Only scrolls to bottom if the user is already near the bottom
 * 
 * @param dependencies - Array of dependencies that trigger scrolling when changed
 * @param threshold - Distance from bottom (in pixels) to consider "near bottom" (default: 300)
 * @returns A ref to attach to the element to scroll to
 */
export const useScrollToBottom = (dependencies: DependencyList = [], threshold = 300) => {
	const ref = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true);

	// Check if user is near bottom when scrolling
	const handleScroll = () => {
		if (!containerRef.current) return;
		
		const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
		
		// Only auto-scroll if user is near the bottom
		setShouldScrollToBottom(distanceFromBottom <= threshold);
	};

	// Set up scroll event listener
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.addEventListener("scroll", handleScroll);
		return () => {
			container.removeEventListener("scroll", handleScroll);
		};
	}, []);

	// Scroll to bottom when dependencies change, but only if shouldScrollToBottom is true
	useEffect(() => {
		if (ref.current && shouldScrollToBottom) {
			ref.current.scrollIntoView({ behavior: "smooth" });
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...dependencies, shouldScrollToBottom]);

	// Set containerRef to the parent of the ref element
	useEffect(() => {
		if (ref.current) {
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
		}
	}, []);

	return ref;
};
