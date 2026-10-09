/**
 * The reads a conversation needs started the moment it OPENS, so the chrome that
 * depends on them rides the first contentful commit instead of arriving after it.
 *
 * WHY THE PANE, AND NOT THE COMPONENTS THAT READ THEM. Both readers below live
 * deep in the transcript, which mounts once the pane's stream, the sidebar's
 * catalogue and the route have settled — measured on the first-paint bench at
 * ~115 ms after the click, against a snapshot that had already begun to paint
 * (first byte ~92-106 ms). Starting the same reads from the pane that opens the
 * conversation moves them ~90 ms earlier for free, because the pane mounts with
 * its stream (measured at ~26 ms). This is not a second opinion about what those
 * reads are: `backendSettingsQueryOptions()` is the transcript's own query
 * options, and `loadCheckpointManifest` is the transcript's own loader, with an
 * in-flight map so the two asks share ONE request.
 *
 * WHY NEITHER READ IS CONDITIONAL ON ANYTHING BUT THE PLANE. Both payloads are
 * reads the transcript's own mount would make anyway, so moving them here adds
 * no request — only a start time — and the registry's 10 s `staleTime` means a
 * conversation opened within ten seconds of the last one is a cache read, not a
 * fetch (the app already reads this same registry once per launch for the
 * push-to-talk binding). Gating the registry read on the persisted seed was the
 * first shape of this, and it was wrong in the direction that matters: a window
 * with no seed — a fresh profile, or the first open after a launch — would fall
 * back to the transcript's late read, which is exactly the flicker the read is
 * moved for. The seed's job is the first RENDER (`display-settings.ts`), not the
 * moment the read starts.
 *
 * AND WHY NEITHER WAITS FOR ANYTHING. Both are fired and forgotten: a failure is
 * the readers' own business (the hook logs it, the rail hides, the flag falls
 * back to the last known value), and nothing here delays a paint.
 */
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DesktopCapabilities } from "../../../../../shared/desktop-contract";
import { loadCheckpointManifest } from "./checkpoint-manifest-cache";
import { backendSettingsQueryOptions } from "./use-display-flag";

export function useOpenPrefetch(
	sessionId: string | undefined,
	capabilities: DesktopCapabilities | undefined,
): void {
	const client = useQueryClient();
	useEffect(() => {
		if (!sessionId) return;
		/*
		 * `prefetchQuery` does not honour `enabled` (that option is the
		 * observer's), so the capability arm has to be this caller's: a plane
		 * that does not advertise `settings` answers such a read with a 404/422,
		 * which would leave an error in the cache the transcript then has to
		 * clear before it can read the key it was actually asking about.
		 */
		if (desktopFeatureEnabled(capabilities, "settings")) {
			void client.prefetchQuery(backendSettingsQueryOptions());
		}
		/*
		 * Caught and dropped: the hook that owns this read reports its own
		 * failures once per conversation, and a prefetch that logged would make
		 * the same failure say the same thing twice.
		 */
		void loadCheckpointManifest(sessionId).catch(() => {});
	}, [sessionId, capabilities, client]);
}
