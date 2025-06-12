import { useCallback, useEffect, useRef } from "react";

type DebouncedFunction<T extends (...args: unknown[]) => unknown> = (
	...args: Parameters<T>
) => void;

/**
 * Custom hook to debounce a function.
 * @param func The function to debounce.
 * @param delay The debounce delay in milliseconds.
 * @returns The debounced function.
 */
export function useDebounce<T extends (...args: unknown[]) => unknown>(
	func: T,
	delay: number,
): DebouncedFunction<T> {
	const timeoutRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		// Cleanup the timeout on unmount
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const debouncedFunction = useCallback(
		(...args: Parameters<T>) => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}

			timeoutRef.current = setTimeout(() => {
				func(...args);
			}, delay);
		},
		[func, delay],
	);

	return debouncedFunction;
}
