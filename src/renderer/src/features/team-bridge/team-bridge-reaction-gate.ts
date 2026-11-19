import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "../../../../shared/team-bridge-notify";

/**
 * The renderer half of the reactions hold.
 *
 * WHY A BUILD CONSTANT AS WELL AS A CAPABILITY. local-operator PR #3149
 * publishes `team_bridge_reactions` with required account/tenant guards, and
 * this build satisfies them in the desktop request contract. A capability
 * appearing alone is still not clearance: the constant lives beside the
 * threads one in `team-bridge-notify.ts`, and both must permit the surface.
 *
 * FAIL CLOSED. The surface mounts only when the constant is true AND the
 * capability answers exactly `enabled`; `unknown` (no answer yet, or the read
 * errored), `below-version` and `unpaired` all hide it.
 */
export { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD };

/**
 * May the reaction chips, react button and picker mount?
 *
 * `state` is `desktopFeatureState(capabilities.data, "team_bridge_reactions")`.
 * `shipped` keeps the capability half independently testable; no production
 * call site passes it.
 */
export function teamBridgeReactionsAvailable(
	state: DesktopFeatureState | null | undefined,
	shipped: boolean = TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD,
): boolean {
	if (!shipped) return false;
	return state === "enabled";
}
