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
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { warmCheckpointManifest } from "./checkpoint-manifest-cache";
import { backendSettingsQueryOptions } from "./use-display-flag";

export function useOpenPrefetch(
	sessionId: string | undefined,
	settingsAdvertised: boolean,
): void {
	const client = useQueryClient();
	/*
	 * TWO EFFECTS, BECAUSE THE TWO READS HAVE DIFFERENT DEPENDENCY STORIES, and
	 * sharing one effect is what agent review round 2's R3 measured: the
	 * checkpoint read is a function of the CONVERSATION, the registry prefetch of
	 * the PLANE's capability answer. With one effect keyed on both, a mount that
	 * ran before the capability answer fired the checkpoint read, the answer
	 * flipped the dep, and the second run fired `settings.list` **and a second
	 * `sessions.checkpoints`** unless the first read happened to still be in
	 * flight — `["sessions.checkpoints","settings.list","sessions.checkpoints"]`,
	 * character for character the waterfall round 1 cited, on this head and the
	 * one before it. The boolean dependency (round 1) closed the 30 s
	 * capability-refetch churn; it could not close this, because this is a real
	 * transition and not a churn.
	 *
	 * THE LATCH IS PER CONVERSATION-ID: this effect must spend one read per open
	 * even if React re-runs it (a re-render, a strict-mode double invoke), and a
	 * switch away and back is a new conversation and earns its own read. One slot
	 * is enough because the ids are visited in order by one pane.
	 */
	const warmed = useRef<string | null>(null);
	useEffect(() => {
		if (!sessionId || warmed.current === sessionId) return;
		warmed.current = sessionId;
		/*
		 * `warmCheckpointManifest`, not `loadCheckpointManifest`: this call IS the
		 * open's read, and the marker it leaves is what lets the pane's own first
		 * ask serve from it instead of re-reading (QA round 1's Q-2, and round 2's
		 * R6 for what the marker must mean). Caught and dropped: the hook that owns
		 * this read reports its own failures once per conversation, and a prefetch
		 * that logged would make the same failure say the same thing twice.
		 */
		void warmCheckpointManifest(sessionId).catch(() => {});
	}, [sessionId]);
	useEffect(() => {
		/*
		 * `prefetchQuery` does not honour `enabled` (that option is the
		 * observer's), so the capability arm has to be this caller's: a plane
		 * that does not advertise `settings` answers such a read with a 404/422,
		 * which would leave an error in the cache the transcript then has to
		 * clear before it can read the key it was actually asking about.
		 */
		if (!settingsAdvertised) return;
		void client.prefetchQuery(backendSettingsQueryOptions());
	}, [settingsAdvertised, client]);
}
