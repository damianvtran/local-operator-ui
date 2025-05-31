import { useEffect, useState } from "react";

/**
 * Custom hook to debounce a value.
 * @param value The value to debounce.
 * @param delay The debounce delay in milliseconds.
 * @returns The debounced value.
 */
export function useDebounce<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value);

	useEffect(() => {
		// Set debouncedValue to value (passed in) after the specified delay
		const handler = setTimeout(() => {
			setDebouncedValue(value);
		}, delay);

		// Return a cleanup function that will be called every time ...
		// ... useEffect is re-called or on unmount.
		// This is important to clear the timeout if the value changes ...
		// ... within the delay period, or if the component unmounts.
		return () => {
			clearTimeout(handler);
		};
	}, [value, delay]); // Only re-call effect if value or delay changes

	return debouncedValue;
}
