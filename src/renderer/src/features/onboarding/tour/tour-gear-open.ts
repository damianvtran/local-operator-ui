/**
 * Whether the tour's "navigate-settings" step must click the gear.
 *
 * WHY THIS IS ITS OWN MODULE. The step used to click unconditionally, which was
 * safe while the gear only ever navigated. The gear is now a TOGGLE (operator,
 * 2026-11-23: "gear_closes: Yes, gear toggles"), so the same click closes the
 * page when the tour reaches this step a second time through its own Back -
 * the "General settings" step then floats over whichever route was underneath,
 * with no anchor (QA round 1: Q-2).
 *
 * The reading is the APP's own statement of where it is, not the tour's memory
 * of where it has been: `aria-current="page"` is what the gear sets while
 * Settings is open. It lives here, free of Shepherd and of the theme graph, so
 * the rule can be asserted without booting a tour.
 */
export function tourGearNeedsClick(gear: Element | null): boolean {
	return gear !== null && gear.getAttribute("aria-current") !== "page";
}
