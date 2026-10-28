import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "../../../../shared/team-bridge-notify";

/**
 * The renderer half of the thread-surface hold.
 *
 * THE CONSTANT LIVES IN THE SHARED NOTIFY MODULE because it has to close both
 * ends of the notification path (main parks a click target, the renderer turns
 * it into a route). Read it there for the full rationale: it was held for the
 * #1304 thread cache/retry isolation defects and is now `true`, because the
 * runtime requires the owner receipt on the replies read and the renderer keys
 * and fences the thread cache by account + auth epoch
 * (`team-bridge-thread-cache.ts`). It remains the kill switch.
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
 * `enabled` while the build constant is false. An older core never advertises
 * the key, so it never gets a thread control.
 *
 * `shipped` exists ONLY so tests can prove each half independently: no
 * production call site passes it, and it defaults to the module constant.
 */
export function teamBridgeThreadsAvailable(
	state: DesktopFeatureState | null | undefined,
	shipped: boolean = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD,
): boolean {
	if (!shipped) return false;
	return state === "enabled";
}
