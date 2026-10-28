import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "../../../../shared/team-bridge-notify";

/**
 * The renderer half of the reactions hold.
 *
 * WHY A BUILD SWITCH AS WELL AS A CAPABILITY GATE. The old reaction path carried
 * only a tenant, never the captured-owner receipt, so it was held closed whatever
 * a runtime advertised: a capability appearing is not a release. The switch is
 * now `true` because the fix ships on both sides (the runtime advertises
 * `team_bridge_reactions` only with receipt-REQUIRED reaction routes; the
 * renderer sends the owner captured at the click). The constant lives beside
 * the threads one in `team-bridge-notify.ts` and stays the kill switch.
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
 * `shipped` exists ONLY so tests can prove each half independently: no
 * production call site passes it, and it defaults to the module constant.
 */
export function teamBridgeReactionsAvailable(
	state: DesktopFeatureState | null | undefined,
	shipped: boolean = TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD,
): boolean {
	if (!shipped) return false;
	return state === "enabled";
}
