/**
 * Local Operator API - the SESSION job rail's desktop client.
 *
 * WHY NOT `jobs-api.ts`. That module is the LEGACY agent-server's jobs client
 * (`legacy.job.get` / `legacy.job.cancel` / a bound-base-URL API surface whose
 * rows never appear in a session's transcript). This module addresses the
 * runtime's own background jobs — the `frontend.jobs` rows the run pane's Jobs
 * section draws (`bash` detaches, and the video lane's detached jobs) — through
 * the desktop contract, and it exists beside `wakes-api.ts` and
 * `monitors-api.ts` because it is their sibling: one per-item cancel per
 * surface, the same bearer and same-origin gate, the same refusal semantics.
 *
 * The write's route lands on the engine's EXISTING cancel path — the same
 * `AsyncJobManager.cancel` that `jobs op='cancel'` reaches — never a second
 * mechanism (design spec §2.2 / contract §4.1). A press is acknowledged; only
 * the job's own settle paints `cancelled` (the honesty rule every surface
 * keeps), which is also why this client reads no receipt: the row's next wire
 * state is the outcome's evidence, and there is no fact here for the UI to
 * paint beyond the acknowledgement.
 *
 * The READ is deliberately not here. The pane's section and the composer's jobs
 * chip render the SESSION's own canonical field (`frontend.jobs`, through
 * `run-detail-model.ts`'s partition), so a listing op would have no reader.
 */
import { desktopResult } from "./desktop-api";

export const SessionJobsApi = {
	/**
	 * Cancel one of the session's runtime jobs by its id, leaving the
	 * conversation in place.
	 *
	 * The response is consumed for its outcome alone (2xx = acknowledged;
	 * anything else throws the refusal with its sentence), and the caller
	 * re-reads the conversation's canonical state either way: a refusal can be
	 * the face of a write that LANDED (a retried cancel whose first attempt was
	 * answered and whose response was lost gets an honest refusal about a job
	 * that is already gone), and the re-read is what makes the list agree with
	 * the runtime in both cases.
	 */
	async cancel(sessionId: string, jobId: string): Promise<void> {
		await desktopResult<unknown>({
			op: "jobs.cancel",
			sessionId,
			jobId,
		});
	},
};
