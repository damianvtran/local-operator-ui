/**
 * Whether the answering server has the run card's `Logs` and `Results` routes.
 *
 * THE PROBLEM THIS SOLVES. Those two routes land in a follow-up release, and the
 * card must not draw a control that 404s. There is no capability flag for them on
 * either read this family has (the capability read carries the family's switch, the
 * runs read carries rows), so the only authority is the route itself: ask it once
 * and read the answer.
 *
 * THE PROBE IS ONE REQUEST PER RUN, NEVER A POLL. It runs when a run first reaches a
 * state where an artifact could exist (a settled run, or one that has been metered),
 * and the verdict is kept in this module's own map, keyed by run id, so re-opening a
 * conversation does not re-ask. A 2xx is "offered"; a 404 (or the transport's
 * `not_found`) is "not offered"; anything else is "unknown", which renders nothing -
 * a refusal this client cannot interpret is not evidence that the route exists, and
 * drawing `Logs` on a network blip is exactly the press this exists to prevent.
 *
 * WHY NOT A STORE WITH PERSISTENCE: a server's route set can change under a live
 * window (an update replaces the backend), so a verdict must not outlive the session.
 * The map is module state for that reason - it resets with the window, which is the
 * same lifetime as the backend this window talks to.
 *
 * NOTHING IN v1 RENDERS THE PAYLOAD. The two reads are declared in the contract and
 * probed here so the affordance is honest and the follow-up PR has a seam: it turns
 * "offered" into a pane rather than inventing the check it should have had.
 */

import {
	DesktopControlError,
	desktopRequest,
} from "@shared/api/local-operator/desktop-api";
import { useEffect, useState } from "react";
import type { DesktopRequest } from "../../../../shared/desktop-contract";

export type RemoteArtifactsOffer = "unknown" | "offered" | "absent";

const offers = new Map<string, RemoteArtifactsOffer>();
const inFlight = new Set<string>();

/** The verdict this window has for one run, if it asked. */
export function remoteArtifactsOffer(runId: string): RemoteArtifactsOffer {
	return offers.get(runId) ?? "unknown";
}

async function probe(request: DesktopRequest, runId: string): Promise<void> {
	if (inFlight.has(runId) || offers.has(runId)) return;
	inFlight.add(runId);
	try {
		const response = await desktopRequest(request);
		if (response.status >= 200 && response.status < 300) {
			offers.set(runId, "offered");
			return;
		}
		// 404 and 405 are the two answers a server without the route gives; 401/403
		// mean it exists but this credential may not read it, which is still a route
		// this server has, so the affordance is offered and the read will say why.
		if (response.status === 404 || response.status === 405) {
			offers.set(runId, "absent");
			return;
		}
		if (response.status === 401 || response.status === 403) {
			offers.set(runId, "offered");
			return;
		}
		// Anything else (5xx, a proxy) says nothing about the route set: the verdict
		// stays unknown and the probe may be repeated later.
	} catch (error) {
		if (error instanceof DesktopControlError && error.status === 404) {
			offers.set(runId, "absent");
		}
	} finally {
		inFlight.delete(runId);
	}
}

/**
 * Probe one run's artifact routes, when `enabled`.
 *
 * `enabled` is the card's own gate (a settled or metered run) rather than a timer:
 * the card passes `true` once and the hook does not re-ask for that id.
 */
export function useRemoteArtifactsOffer(
	runId: string,
	enabled: boolean,
): RemoteArtifactsOffer {
	const [offer, setOffer] = useState<RemoteArtifactsOffer>(() =>
		remoteArtifactsOffer(runId),
	);
	useEffect(() => {
		if (!enabled) return;
		const known = remoteArtifactsOffer(runId);
		if (known !== "unknown") {
			setOffer(known);
			return;
		}
		let live = true;
		void probe({ op: "remote_compute.logs", runId }, runId).finally(() => {
			if (live) setOffer(remoteArtifactsOffer(runId));
		});
		return () => {
			live = false;
		};
	}, [enabled, runId]);
	return offer;
}

/** Clear every verdict. For tests and for a caller that knows the backend restarted. */
export function resetRemoteArtifactsOffers(): void {
	offers.clear();
	inFlight.clear();
}
