/**
 * Which of the four raise outcomes a request for the address field takes.
 *
 * WHY THIS IS A MODULE AND NOT THREE `if`s INSIDE THE SURFACE. Round 1's MAJOR-2
 * was an ordering defect that no render can show: `raiseAddress` checked the
 * start page and "already open", but never the Tier 2 fallback, so a raise under
 * the fallback set `popout` — a row that does not render — and the strip went
 * invisible and inert under nothing. The decision has four branches with a fixed
 * precedence, and the surface's job is the EFFECT of each; keeping the order in
 * one pure function is what makes "every raise is gated on the fallback" a thing
 * a test can hold instead of a thing a reader has to notice.
 *
 * THE ORDER IS THE CONTRACT:
 * 1. the start page has its own field, so a popout over it would be a second
 *    address field on top of one the user can already type into;
 * 2. Tier 2 is permanent — once the fallback is on, the in-flow field is the
 *    only field there is, and every entry point (Cmd+L, the trigger, a printable
 *    seed, the menu) must focus THAT one and never create a popout;
 * 3. an open row re-selects itself (a second raise must not remount it);
 * 4. otherwise the row is raised.
 */
export type AddressRaisePlan = "start-page" | "fallback" | "refocus" | "raise";

export interface AddressRaiseState {
	/** The active tab is the start page (it keeps its own field). */
	startPage: boolean;
	/** Tier 2 has been entered for the rest of this surface's life. */
	fallback: boolean;
	/** The popout row is currently raised. */
	open: boolean;
}

export function planAddressRaise(state: AddressRaiseState): AddressRaisePlan {
	if (state.startPage) return "start-page";
	if (state.fallback) return "fallback";
	if (state.open) return "refocus";
	return "raise";
}
