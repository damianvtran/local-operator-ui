/**
 * The run panel's job write: cancelling one runtime job, and the policy around
 * it.
 *
 * A PROP-BUILT control, taken in `chat-page.tsx` and threaded to the pane
 * exactly as `monitorControls` and `wakeControls` are: the page owns the
 * session identity and the section stays presentational, which is also what
 * lets the story set inject a recorder instead of pressing a real route.
 *
 * ## Why the outcome is RETURNED rather than reported through a read
 *
 * The monitors' own argument, unchanged: a cancel has no read on this surface
 * that reports its outcome, and a refusal must land in the card that asked —
 * a refusal shown over a card that has already closed reads as "it happened
 * and something else went wrong". So `cancel` resolves the outcome and the
 * pane body's one confirmation decides: stay open with the sentence, or close
 * and let the canonical re-read settle the row.
 *
 * ## What a success does NOT do
 *
 * It does not paint `cancelled`. The honesty rule every surface keeps (design
 * spec §2.1): a press is acknowledged, and only the job's own settle moves the
 * row's state — the receipt here carries no fact the UI may render as an
 * outcome. What the success DOES fire is the canonical re-read, either way, so
 * the row converges with the runtime rather than waiting for some later push.
 *
 * ## The refusal sentence
 *
 * `userFacingMessage` resolves the authored sentence (the engine's own words
 * through the refusal envelope) and never a stack-trace fragment. ONE case
 * needs a substitution first: a refused/unknown-job cancel that arrived
 * WITHOUT a sentence is the class the frozen wording map already names
 * (`tools/image_tool.py`'s `not_found`), so the map's phrase is rendered
 * instead of the transport's bare "did not answer" placeholder — the design
 * spec's "the frozen `not_found`-class phrase, never a generic error". An
 * authored sentence always wins over it: surfaces render the engine's words,
 * never a claim of their own.
 */
import {
	DESKTOP_REFUSAL_PLACEHOLDER,
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { SessionJobsApi } from "@shared/api/local-operator/session-jobs-api";
import { resyncCanonicalSession } from "@shared/hooks/use-canonical-session";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	JOB_CANCEL_NOT_FOUND_COPY,
	type JobCancelOutcome,
	type JobControls,
	retryJobWrite,
} from "./job-controls-model";

/** The sentence for a refused job cancel, per the header's rules. */
const refusalDetail = (error: unknown): string => {
	if (
		error instanceof DesktopControlError &&
		error.status === 404 &&
		error.message === DESKTOP_REFUSAL_PLACEHOLDER
	)
		return JOB_CANCEL_NOT_FOUND_COPY;
	return userFacingMessage(error, "Could not cancel the job.");
};

/**
 * Re-exported so a consumer of this module reads one import for one control:
 * the shapes' single home is `job-controls-model.ts` (where the test can reach
 * them without React), and this is the path the pane and the stories speak.
 */
export type { JobCancelOutcome, JobControls } from "./job-controls-model";

export const useJobControls = ({
	sessionId,
}: {
	sessionId?: string | null;
}): JobControls => {
	const cancel = useMutation<void, Error, string>({
		mutationFn: (jobId) => {
			/*
			 * The section renders only off a session's own canonical field, so a
			 * press without a session is unreachable through the app; the guard
			 * is here so the impossible case resolves a truthful sentence instead
			 * of sending a request against an empty id.
			 */
			if (!sessionId)
				return Promise.reject(
					new Error("There is no conversation to cancel a job on."),
				);
			return SessionJobsApi.cancel(sessionId, jobId);
		},
		retry: retryJobWrite,
	});
	const { mutateAsync } = cancel;
	return {
		cancel: useCallback(
			async (jobId: string): Promise<JobCancelOutcome> => {
				try {
					await mutateAsync(jobId);
					return { ok: true };
				} catch (error) {
					return { ok: false, detail: refusalDetail(error) };
				} finally {
					/*
					 * Converge the list EITHER WAY, the monitors' own reason: a
					 * refusal can be the face of a write that LANDED (a retried
					 * cancel whose first attempt was answered and whose response
					 * was lost gets the honest "no longer knows the job" about a
					 * job that is already gone), while a transport failure changes
					 * nothing anywhere. The canonical re-read is what makes the
					 * list agree with the runtime in both cases.
					 */
					if (sessionId) resyncCanonicalSession(sessionId);
				}
			},
			[mutateAsync, sessionId],
		),
	};
};
