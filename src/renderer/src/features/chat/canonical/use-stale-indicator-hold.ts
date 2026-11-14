import { useEffect, useState } from "react";

/**
 * How long a cached paint stands before the pane announces it is revalidating.
 *
 * THE DEFECT (operator report, 2026-11-12: "when i switch between team bridge
 * and session, it has some sort of loading mechanism to load conversation? looks
 * like it always does this"). The rows were already on screen in the switch's
 * first frame, so the indicator was not saying anything the reader could not
 * see; it flashed on every return and read as a load that was not happening.
 *
 * THE DISTRIBUTION (QA, 2026-11-12, 60 cached returns on the mock daemon): the
 * indicator stood on 60 of 60 returns, and the authoritative snapshot landed a
 * median of 165 ms after the paint, p90 300 ms, max 434 ms. On this machine's
 * real daemon the same wait is a median of 0.96 s (283 settled opens, p90 1.9 s;
 * `transcript-pane.ts`'s retired-hold note carries the measurement). So 500 ms
 * sits above every mock return measured - the common switch paints no loader at
 * all - and below the real median, where the wait is long enough that the
 * reader is owed an honest "this is a cache" signal. An unbounded delay would
 * make a slow server look settled; a zero one is what this change removes.
 */
export const STALE_INDICATOR_DELAY_MS = 500;

/**
 * Whether a cached paint should say it is being revalidated YET.
 *
 * One timer, no polling: the flag rises `delayMs` after the paint appears and
 * the effect's cleanup clears it, so a snapshot that lands first means the
 * indicator never renders at all rather than rendering and vanishing. A delay of
 * `0` or less states the signal immediately (no timer), which is the honest
 * value for a caller that knows its page is owed - and it is how the rendered
 * markup tests exercise the post-threshold state without a clock.
 *
 * ONCE SHOWN, STAYS SHOWN FOR THIS STALE EPISODE (agent review C3). The delay is
 * not constant in practice: a remote conversation's `hydrationProven` can flip
 * while the snapshot is still owed, moving the caller's delay from 0 to 500. A
 * plain `elapsed` flag resets on that change - so the caption the reader was
 * already looking at vanished for half a second and then returned. A stale
 * episode is one observation: the hold decides WHEN it starts announcing it and
 * never takes the announcement back; only `stale` clearing ends it.
 */
export function useStaleIndicatorHold(
	stale: boolean,
	delayMs: number = STALE_INDICATOR_DELAY_MS,
): boolean {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		if (!stale) {
			// Reset rather than leave a raised flag behind: the next cached paint
			// must wait its own delay, not inherit the previous one's clock.
			setShown(false);
			return;
		}
		// Already announcing this episode: the delay changing cannot un-announce it.
		if (shown) return;
		if (delayMs <= 0) {
			// Remembered as well as returned, so the 0 -> 500 flip above is a no-op
			// rather than a disappearance.
			setShown(true);
			return;
		}
		const timer = window.setTimeout(() => setShown(true), delayMs);
		return () => window.clearTimeout(timer);
	}, [stale, delayMs, shown]);
	return stale && (delayMs <= 0 || shown);
}
