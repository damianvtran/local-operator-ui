import { useEffect, useState } from "react";

/**
 * How often a countdown is re-read while an open ask is on screen.
 *
 * The ask lane reads the clock in TWO places now - the panel's rows and the status
 * row's item - and they must not tick on different cadences: two intervals would
 * let the chip and the row it opens disagree about one deadline for up to a tick,
 * which is exactly the drift the copy contract exists to prevent. One constant,
 * one hook, two readers.
 */
const ASK_CLOCK_MS = 30_000;

/**
 * The ask lane's clock: wall time, advanced on an interval that is ARMED ONLY WHEN
 * SOMETHING IS COUNTABLE, and pinnable for a story.
 *
 * WHY IT IS A HOOK AND NOT A DERIVED VALUE. The countdown is the only clock read a
 * surface makes, and a value computed at render time would freeze between renders:
 * a chip reading `expires in 3m` would still say `3m` ten minutes later, which is
 * worse than saying nothing - the reader is deciding whether to hurry. It ticks at
 * `ASK_CLOCK_MS` so a reading lags the truth by at most one tick, and it ARMS ONLY
 * WHILE SOMETHING IS OPEN so a settled or absent queue costs no timer at all (a
 * queue with nothing to count down has nothing to re-read).
 *
 * `pinned` wins over every tick. A story pins the clock so its frames are
 * reproducible, and a pinned clock never installs an interval.
 *
 * EXTRACTED from `ask-surfaces.tsx` when the status row's ask item began printing
 * the same countdown on its collapsed face: the alternative was a second copy of
 * this interval in a second component, which is how two surfaces start reporting
 * different numbers for one deadline. The behaviour is unchanged; only its home is.
 */
export const useAskClock = (active: boolean, pinned?: number): number => {
	const [now, setNow] = useState(() => pinned ?? Date.now());
	useEffect(() => {
		if (pinned !== undefined || !active) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), ASK_CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [active, pinned]);
	return pinned ?? now;
};
