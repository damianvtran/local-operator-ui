import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "../../../../shared/team-bridge-notify";

/**
 * The renderer half of the thread-surface hold.
 *
 * THE CONSTANT LIVES IN THE SHARED NOTIFY MODULE because it has to close both
 * ends of the notification path (main parks a click target, the renderer turns
 * it into a route). Read it there for the full rationale: the thread cache and
 * retry paths carry reported cross-account isolation defects inherited from
 * #1304, a runtime advertising the route is not security clearance, and
 * flipping the constant is the feature's return rather than a cleanup.
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
 * surface - there is no path from "no error" to "enabled" - and so does
 * `enabled` while the build constant is false.
 *
 * `shipped` exists ONLY so the return-path test can prove the capability half:
 * no production call site passes it, and it defaults to the module constant,
 * which is what closes the surface today.
 */
export function teamBridgeThreadsAvailable(
	state: DesktopFeatureState | null | undefined,
	shipped: boolean = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD,
): boolean {
	if (!shipped) return false;
	return state === "enabled";
}
