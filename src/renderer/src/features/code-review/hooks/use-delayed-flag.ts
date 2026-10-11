import { useEffect, useState } from "react";

/**
 * `active`, after it has been continuously true for `delayMs`.
 *
 * WHY IT EXISTS (design §4's no-flicker rule): a row whose first fetch
 * resolves in under the delay must never paint a loading line - the flash
 * reads as a glitch and, worse, as two different states for one fetch. So the
 * timer is armed while `active` and cleared the moment it goes false: only a
 * row still active at the threshold ever returns true, and the caller renders
 * the loading line ONLY on true.
 *
 * One `setState` at the threshold (no polling, no re-arm while active); a
 * delay of 0 - the stories' `pendingRevealMs={0}` - reveals on the first
 * effect-settled frame, pinning the revealed state without a timer.
 * Deactivation and unmount both clear the timer and drop the flag, so a row
 * that resolves early or unmounts leaves nothing behind.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
	const [flag, setFlag] = useState(false);
	useEffect(() => {
		if (!active) {
			setFlag(false);
			return;
		}
		if (delayMs <= 0) {
			setFlag(true);
			return;
		}
		const id = window.setTimeout(() => setFlag(true), delayMs);
		return () => window.clearTimeout(id);
	}, [active, delayMs]);
	return flag;
}
