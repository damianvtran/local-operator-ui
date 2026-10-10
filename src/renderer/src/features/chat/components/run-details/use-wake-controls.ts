import { WAKES_LIST_KEY } from "@features/schedules/hooks/use-wakes-queries";
/**
 * The run panel's wake write: cancelling one armed schedule, and the policy
 * around it.
 *
 * A PROP-BUILT control, taken in `chat-page.tsx` and threaded to the pane as
 * `monitorControls` is (`use-monitor-controls.ts`, the MCP remedies'
 * arrangement): the page owns the session identity and the pane stays
 * presentational, which is also what lets the stories set inject a recorder
 * instead of pressing a real route.
 *
 * ## Why this is not the Schedules page's `useCancelWake`
 *
 * The page's hook (`features/schedules/hooks/use-wakes-queries.ts`) converges
 * the conversation's canonical snapshot only in its `onSuccess` — fine for the
 * page, where a refusal leaves its toast and the listing poll re-reads — while
 * the pane needs convergence on a REFUSAL too (see `attemptWakeCancel` in
 * `wake-controls-model.ts` for the lost-response case that made that a rule for
 * monitors). Widening the shared hook would change the PAGE's behaviour from
 * the pane's change, and the pane cannot ride the page's hook without it. So
 * this is the pane's own write, over the same `WakesApi.remove`, the same retry
 * policy and the same listing invalidation the page's hook performs — the
 * duplication is the resync's intent, stated in both places rather than
 * restated as a second copy of the route.
 *
 * The retry policy is imported rather than restated: one boundary, one
 * definition (`retryWakeWrite`, the wake family's own rule — one re-send, and
 * only for a request that never got an answer).
 */
import { retryWakeWrite } from "@features/schedules/scheduled-task-model";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import { WakesApi } from "@shared/api/local-operator/wakes-api";
import { resyncCanonicalSession } from "@shared/hooks/use-canonical-session";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { WakeCancelOutcome, WakeControls } from "./wake-controls-model";
import { attemptWakeCancel, wakeRefusalSentence } from "./wake-controls-model";

/**
 * Re-exported so a consumer of this module reads one import for one control:
 * the shapes' single home is `wake-controls-model.ts` (where the test can
 * reach them without React), and this is the path the pane and the stories
 * already speak.
 */
export type { WakeCancelOutcome, WakeControls } from "./wake-controls-model";

export const useWakeControls = ({
	sessionId,
}: {
	sessionId?: string | null;
}): WakeControls => {
	const queryClient = useQueryClient();
	const cancelWake = useMutation<void, Error, string>({
		mutationFn: (wakeId) => {
			/*
			 * The section renders only off a session's own canonical field, so a
			 * press without a session is unreachable through the app; the guard is
			 * here so the impossible case resolves a truthful sentence instead of
			 * sending a request against an empty id (the monitors' own guard).
			 */
			if (!sessionId)
				return Promise.reject(
					new Error("There is no conversation to cancel a wake on."),
				);
			return WakesApi.remove(sessionId, wakeId);
		},
		retry: retryWakeWrite,
	});
	const { mutateAsync } = cancelWake;
	return {
		cancel: useCallback(
			(wakeId: string): Promise<WakeCancelOutcome> =>
				attemptWakeCancel({
					run: () => mutateAsync(wakeId),
					/*
					 * ONE code is the app's own sentence and every other refusal echoes the
					 * backend verbatim (U4; see `wakeRefusalSentence`).
					 */
					describe: (error) =>
						wakeRefusalSentence(error) ??
						userFacingMessage(error, "Could not cancel the wake."),
					resync: () => {
						/*
						 * The page's listing is invalidated as its own hook would
						 * (`invalidateAfterWrite`): a cancel from this pane is a write
						 * the Schedules page must not keep describing from cache. The
						 * conversation's snapshot is re-read EITHER WAY — see
						 * `attemptWakeCancel`.
						 */
						void queryClient.invalidateQueries({ queryKey: WAKES_LIST_KEY });
						if (sessionId) resyncCanonicalSession(sessionId);
					},
				}),
			[mutateAsync, queryClient, sessionId],
		),
	};
};
