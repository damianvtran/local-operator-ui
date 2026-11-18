/**
 * One ticking clock, shared by the surfaces that print an elapsed time.
 *
 * WHY NOT `Date.now()` IN A RENDER. A run card's elapsed line and the picker's
 * aggregate age both move, and a component that read the wall clock during render
 * would print a number that only changes when something else re-renders it - the
 * "frozen 0s" defect, which reads as a stalled run. So one interval per mounted
 * surface drives `now`, and the surfaces are cheap to re-render: a row and a card
 * of text.
 *
 * WHY A SECOND IS THE FLOOR AND NOT THE CADENCE OF EVERY SURFACE. A card prints
 * seconds, so it asks for 1,000 ms; the picker's aggregate is allowed to be up to
 * ten seconds stale because its unit is a minute. Both are mounted only while they
 * are on screen: nothing here runs in a background window, because React unmounts
 * the picker's content when the menu closes and the card when its conversation
 * leaves the viewport.
 */

import { useEffect, useState } from "react";

/** The wall clock, republished every `ms`. */
export function useNow(ms: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(timer);
	}, [ms]);
	return now;
}
