/**
 * The monitor controls' model: the write's retry policy and the shapes the
 * section and its stories speak, out of the React hook for the wake family's own
 * reason (`scheduled-task-model.ts`, whose `retryWakeWrite` lives in the model):
 * a verification surface has to be able to CONSTRUCT the policy rather than
 * approximate it, and a module with no React in its graph is what `node --test`
 * can bundle and drive.
 */
import { isServerUnreachable } from "@shared/api/local-operator/desktop-api";

/**
 * The write's retry policy, identical in shape to the wake family's
 * (`scheduled-task-model.ts::retryWakeWrite`) and for its reason: the route's
 * semantics make a retried cancel safe - an already-gone watch answers an honest
 * `no monitor with id` refusal rather than a second write - so the one retry is
 * kept for exactly the case re-sending can repair, a request that never got an
 * answer, and refused for every request the backend DID answer. That is what
 * keeps a refusal's own sentence (the owner-present 503, the cap's 409) from
 * being replaced by a transport story or a second refusal.
 *
 * `failureCount < 1` is exactly one retry: TanStack v5 calls the callback first
 * with `failureCount === 0`.
 */
export const retryMonitorWrite = (
	failureCount: number,
	error: Error,
): boolean => (isServerUnreachable(error) ? failureCount < 1 : false);

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
