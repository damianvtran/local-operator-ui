/**
 * The voicing availability report, as one query.
 *
 * `GET /v1/tts/paths` (the daemon's `resolve_voice_path`): every rung of the
 * text-to-speech cascade in order, whether a persisted credential exists for it,
 * and the sentence the resolver wrote for the reader — plus `servable`, the
 * surface's own enable/explain bit. It is the twin of the STT cascade report and
 * exists for the same reason: a speak control must be able to ask "can this
 * machine speak aloud, and through what?" without spending a synthesis to find
 * out.
 *
 * WHY IT IS ONE QUERY AND NOT A POLL, which is the daemon's own accounting
 * rather than this file's preference: the resolver withdrew its 30 s TTL, so
 * EVERY call re-probes the credential store and, on the canonical Radient
 * destination, can attempt and persist an OAuth refresh — one network round trip
 * per call. A cached-long read would advertise a credential the reader may have
 * just removed; an interval would spend that round trip on a settings page
 * nobody is looking at. So the read is taken when the group mounts, and again
 * when the account answers differently (the transition the group can actually
 * see, wired by its caller), and never on focus or on a timer.
 */

import {
	desktopResult,
	type VoicePathResolution,
} from "@shared/api/local-operator/desktop-api";
import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { useQuery } from "@tanstack/react-query";

export const speechPathsKeys = {
	all: ["desktop", "tts-path-resolution"] as const,
};

/**
 * @param enabled - the caller's capability gate. A backend that predates the
 *   voicing surface does not serve the route, and asking it would surface a 404
 *   as a failure of the reader's own account rather than as the version gap it
 *   is, so the surface only asks when `features.tts` is advertised.
 */
export function useSpeechPaths(enabled: boolean) {
	return useQuery({
		queryKey: speechPathsKeys.all,
		queryFn: () => desktopResult<VoicePathResolution>({ op: "tts.paths" }),
		enabled,
		// See the module docstring: an invalidation is the only refresh this read
		// is allowed, and the caller owns when.
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: retryDesktopQuery,
	});
}
