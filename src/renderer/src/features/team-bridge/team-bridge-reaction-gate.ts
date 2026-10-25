import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "../../../../shared/team-bridge-notify";

/**
 * The renderer half of the reactions hold.
 *
 * WHY THIS IS A BUILD HOLD, NOT A CAPABILITY GATE. The shipped runtime serves no
 * reaction route (its OpenAPI schema carries none; a reaction GET answers 404),
 * and the old reaction path has NOT been reviewed for account/retry safety. A
 * backend advertising `team_bridge_reactions` must not be able to wake it up:
 * a capability appearing is not a release. The constant lives beside the
 * threads one in `team-bridge-notify.ts`, and enabling reactions is a deliberate
 * flip in a release that carries the verified fix.
 *
 * FAIL CLOSED. The surface mounts only when the constant is true AND the
 * capability answers exactly `enabled`; `unknown` (no answer yet, or the read
 * errored), `below-version`, `unpaired` and `enabled`-while-held all hide it.
 */
export { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD };

/**
 * May the reaction chips, react button and picker mount?
 *
 * `state` is `desktopFeatureState(capabilities.data, "team_bridge_reactions")`.
 * `shipped` exists ONLY so the return-path test can prove the capability half:
 * no production call site passes it, and it defaults to the module constant,
 * which is what closes the surface today.
 */
export function teamBridgeReactionsAvailable(
	state: DesktopFeatureState | null | undefined,
	shipped: boolean = TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD,
): boolean {
	if (!shipped) return false;
	return state === "enabled";
}
