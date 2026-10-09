/**
 * The desktop transcript's read of `display.hide_cross_session` — and the reason
 * it is a THREE-state read rather than the boolean it used to be.
 *
 * WHERE THE VALUE COMES FROM. One query, the backend registry's own key object
 * (`backendSettingsKeys.all`, imported rather than respelled) and the same
 * `settings.list` op the Settings page runs, so there is one fetch and one cache
 * entry: a save in Settings refetches it (the save path calls
 * `settingsQuery.refetch()`) and every open transcript re-renders in both
 * directions while the records underneath never change. The read itself, the
 * capability arm and the persisted seed live in `use-display-flag.ts`, shared
 * with the answer rail's flag — one payload, two lookups.
 *
 * FAIL-CLOSED, and that is still the whole safety story: an absent key (a
 * backend that predates it), an unanswered or failed query, and a desktop plane
 * that does not advertise `settings` all resolve to "nothing is hidden". Only an
 * explicit boolean `true` from the registry hides anything, so an old backend —
 * or a test host with no bridge — renders exactly what it rendered before the
 * key existed.
 *
 * WHY "pending" EXISTS (first-paint audit, F10). The registry read starts with
 * the transcript, not before it, so its answer can land a commit AFTER the rows
 * the filter governs. With the option on, a peer receipt or a `send` row painted
 * with the page and was REMOVED one commit later — the "it loads and then
 * corrects itself" flicker this project exists to remove. The `pending` state is
 * that window, and it is produced ONLY when the last known value was `true`
 * (`displayFlagReading`): the transcript withholds the records it would have to
 * take back, and paints them — filtered — in the commit the answer lands in. An
 * operator whose flag is off never sees the state, and their first paint waits
 * for nothing.
 */
import { HIDE_CROSS_SESSION_KEY } from "./display-settings";
import { useDisplayFlag } from "./use-display-flag";

/**
 * The registry key, re-exported at the seam that reads it - the string itself is
 * spelled once, in `display-settings.ts`, and the PR that introduced the flag
 * freezes it there.
 */
export { HIDE_CROSS_SESSION_KEY };

/** What the transcript's filter may read this commit. */
export type CrossSessionVisibility = "hidden" | "visible" | "pending";

export function useCrossSessionVisibility(): CrossSessionVisibility {
	const { reading } = useDisplayFlag(HIDE_CROSS_SESSION_KEY);
	if (reading === "on") return "hidden";
	if (reading === "pending") return "pending";
	return "visible";
}
