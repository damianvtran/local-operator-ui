/**
 * Whether this app's organization surfaces may render at all, and what they owe
 * the reader when they may not (design §8.4; agent review round 1's M2).
 *
 * WHY A MODULE. The two surfaces that use it — the hub's scope row and the
 * publish dialog's target picker — draw on the same backend capability, and the
 * capability can be absent for two different reasons with two different sentences.
 * The merged backend advertises `radient_org` for exactly these four operations
 * (local-operator `capabilities.py`), and its own comment gives the reason a
 * client must read it: a backend that predates them answers the unknown
 * operations with a MASKED 422 ("The request has invalid fields."), which is
 * indistinguishable from a malformed call, so a surface that simply attempted
 * them would report a mistake the user did not make. Gating here means the reads
 * are never attempted against a backend that cannot answer them, and that the one
 * sentence the user sees names the remedy that works.
 *
 * THE TWO ABSENCES, and why they are not one sentence: `below-version` is about
 * THIS app being newer than the server it is driving — the user updates the
 * backend — while `unpaired` is a fact about the app's own pairing, which the app
 * manages and the user does not. `backendPairingSentence` is the house seam for
 * the second (the banner and the sidebar catalogue gate read the same table), so
 * this module composes with it rather than restating it. `below-version` returns
 * null there by design — the sentence for it belongs to the surface, because it
 * is what THAT surface cannot do — which is the one this file authors.
 *
 * `unknown` — no capability answer has arrived yet — returns NOTHING, on the
 * rule the feature state's own comment states: a surface must not assert either
 * cause before main has answered. That is why the sentence is a nullable return
 * rather than a string with a default.
 */

import { backendPairingSentence } from "@shared/api/local-operator/backend-error";
import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import type { DaemonPairingCause } from "../../../../shared/backend-status";

/**
 * What an org surface says when the backend predates the org operations.
 *
 * "Update the backend and try again", not "try again in a moment": the older
 * backend will answer the same thing forever, and a retry-named remedy sends the
 * user to do the one thing that cannot work (the same reasoning the hub page's
 * outage arm records for itself).
 */
export const ORG_SURFACE_BELOW_VERSION =
	"Sharing agents with an organization needs a newer Local Operator backend. Update the backend and try again.";

/** Whether the org reads may be issued at all. */
export const orgSurfaceReady = (state: DesktopFeatureState): boolean =>
	state === "enabled";

/**
 * The one sentence an org surface owes this condition, or null when it owes
 * none — either because the surface is enabled, or because no answer has arrived.
 */
export const orgSurfaceNotice = (
	state: DesktopFeatureState,
	cause: DaemonPairingCause | null,
): string | null => {
	if (state === "enabled" || state === "unknown") return null;
	return backendPairingSentence(state, cause) ?? ORG_SURFACE_BELOW_VERSION;
};
