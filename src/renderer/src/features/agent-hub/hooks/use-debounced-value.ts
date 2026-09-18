import { useEffect, useState } from "react";

/**
 * A value that trails its input by `delayMs` while it keeps changing.
 *
 * The hub's search box needs this rather than `useDeferredValue`: a deferred
 * value is about keeping the render responsive, and the cost here is not the
 * render but the request — one per keystroke against a list endpoint whose
 * `name` and `description` filters are unindexed regex scans on the server. The
 * box stays bound to the immediate value so typing never lags; only the query
 * waits.
 */
export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
	const [settled, setSettled] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return settled;
};
