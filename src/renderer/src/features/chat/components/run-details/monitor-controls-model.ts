/**
 * The monitor controls' model: the write's retry policy and the shapes the
 * section and its stories speak, out of the React hook for the wake family's own
 * reason (`scheduled-task-model.ts`, whose `retryWakeWrite` lives in the model):
 * a verification surface has to be able to CONSTRUCT the policy rather than
 * approximate it, and a module with no React in its graph is what `node --test`
 * can bundle and drive.
 */
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { DESKTOP_REFUSAL_CODE } from "../../../../../../shared/desktop-contract";

/**
 * The contended per-session lock's refusal code, the ONE 503 this route family
 * carries that the core itself calls retryable: `monitors/arm.py` raises it on
 * a timed-out lock acquisition whose comment states the contract - "a timed-out
 * acquire is a REFUSAL rather than 'carry on unlocked': the failure that would
 * follow is the lost cancel, and a retryable 503 is the honest answer to
 * contention" - and the status table names the 503 class "nothing was written;
 * retrying is what fixes it". It is transient by construction (the lock spans
 * one write), which is what makes a single re-send a repair rather than a
 * delay.
 *
 * A literal rather than a `DESKTOP_REFUSAL_CODE` member, because it is not one:
 * that table is the app's vocabulary for the desktop PLANE's refusals (pairing
 * conditions, each with an authored sentence), while this is the route's own
 * category, rendered from the backend's message verbatim. The literal is scoped
 * here because this predicate is its only reader on this side of the wire.
 */
const MONITOR_WRITE_BUSY_CODE = "monitor_write_busy";

/**
 * Whether a failed monitor write is one a re-send can repair.
 *
 * NARROWER THAN THE WAKE FAMILY'S on purpose (`scheduled-task-model.ts`
 * retries `isServerUnreachable`, which counts every 503), because the 503s of
 * this route are two different kinds of event under one status, and the narrow
 * reading is the one the data supports:
 *
 * 1. A request that never got an answer IS retried once: `null` (the IPC call
 *    rejected, or main never replied within its own deadline) and the 503 main
 *    SYNTHESISES when the fetch itself failed (`transport.failed`: a refused
 *    socket, a reset, an abort that never got a response) - the app's real
 *    spelling of "no response". Re-sending is how the outcome is learned, and a
 *    retried cancel is safe: an already-gone watch answers an honest `no
 *    monitor with id` refusal rather than a second write.
 * 2. The contended-lock 503 (`monitor_write_busy`) is retried once: the core
 *    marks it retryable in its own words (see the code's note).
 * 3. EVERY 503 that carries the owner's ANSWER is NOT retried - the
 *    `monitor_owner_present` / `monitor_owner_wedged` refusals and the
 *    `pairing.plane-closed` reading of a bare 503 are the outcome itself. A
 *    re-send cannot repair an owner that stands: measured against a hosted
 *    conversation, the owner-present 503 never cleared across ~10 minutes of
 *    presses, and the blanket 503 retry only sent the same DELETE twice while
 *    holding the sentence back by the retry's second (UX review round 1, U3).
 *    The first answer's sentence is what surfaces, verbatim.
 *
 * That is the ONE story this module, the dialog's busy window and the tests
 * tell: one press is one request against an answering writer, and a refusal's
 * own sentence is never replaced by a transport story or a second attempt.
 */
const isRetryableMonitorWrite = (error: unknown): boolean => {
	if (!(error instanceof DesktopControlError)) return false;
	if (error.status === null) return true;
	return (
		error.status === 503 &&
		(error.code === MONITOR_WRITE_BUSY_CODE ||
			error.code === DESKTOP_REFUSAL_CODE.transportFailed)
	);
};

/**
 * The write's retry policy: exactly one retry, over the boundary above.
 *
 * `failureCount < 1` is exactly one retry: TanStack v5 calls the callback first
 * with `failureCount === 0`.
 */
export const retryMonitorWrite = (
	failureCount: number,
	error: Error,
): boolean => (isRetryableMonitorWrite(error) ? failureCount < 1 : false);

/** What a cancel answered: applied, or the sentence to render where it was asked. */
export type MonitorCancelOutcome = { ok: true } | { ok: false; detail: string };

/** What the section needs to offer the cancel. */
export type MonitorControls = {
	/**
	 * Cancel one monitor by its handle (`m1`..). Resolves the outcome rather
	 * than throwing, because a refusal is a rendered state on this surface (see
	 * `use-monitor-controls.ts`).
	 */
	cancel: (monitorId: string) => Promise<MonitorCancelOutcome>;
};
