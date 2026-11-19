import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "../../../../shared/team-bridge-notify";

/**
 * The renderer half of the thread-surface hold.
 *
 * THE CONSTANT LIVES IN THE SHARED NOTIFY MODULE because it guards both ends
 * of the notification path (main parks a click target, the renderer turns it
 * into a route). local-operator PR #3149 publishes the guarded capability;
 * this build supplies the required account and tenant receipts on reads and
 * replies. A runtime advertising the route is not clearance by itself: the
 * capability answer below must still be exactly `enabled`.
 *
 * Re-exported here so every renderer surface reads one spelling of the hold.
 */
export { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD };

/**
 * May the thread pane and its reply affordance mount?
 *
 * `state` is `desktopFeatureState(capabilities.data, "team_bridge_threads")`,
 * so an absent or failed capabilities read arrives here as `unknown` and stays
 * hidden. FAIL CLOSED: `unknown`, `below-version` and `unpaired` all hide the
 * surface - there is no path from "no error" to "enabled". Only that exact
 * answer together with the shipped build constant returns it.
 *
 * `shipped` keeps the capability half independently testable; no production
 * call site passes it.
 */
export function teamBridgeThreadsAvailable(
	state: DesktopFeatureState | null | undefined,
	shipped: boolean = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD,
): boolean {
	if (!shipped) return false;
	return state === "enabled";
}
