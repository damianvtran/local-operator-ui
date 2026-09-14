import { useEffect, useState } from "react";

/**
 * Whether `ms` has passed since `active` last became true.
 *
 * Exists for the slow-load case in issue 89: bounding a stalled request means
 * the user reaches an error state, but they still watch an identical, silent
 * spinner until the deadline expires, and a spinner that never changes reads
 * as a hung app long before it actually gives up. This lets a waiting surface
 * say something at a threshold without polling a clock on every render.
 *
 * Deliberately a single boolean crossing rather than a live elapsed counter: a
 * ticking number invites a per-second re-render of whatever is waiting, and a
 * countdown would promise a deadline the user cannot act on. One state change,
 * one timer, cleared when the wait ends.
 */
export function useElapsedSince(active: boolean, ms: number): boolean {
	const [elapsed, setElapsed] = useState(false);

	useEffect(() => {
		// A finished wait must reset, otherwise a later load starts already in
		// the "slow" state and asserts a delay that has not happened yet.
		if (!active) {
			setElapsed(false);
			return;
		}
		const timer = setTimeout(() => setElapsed(true), ms);
		return () => clearTimeout(timer);
	}, [active, ms]);

	return elapsed;
}
