/**
 * The Jobs section's control model: which rows may be cancelled, the words a
 * refusal speaks, and the write's retry policy.
 *
 * Pure by construction, like `monitor-controls-model.ts` and for its reason: a
 * verification surface has to be able to CONSTRUCT the policy rather than
 * approximate it, and a module with no React in its graph is what
 * `node --test` can bundle and drive. The pane's rows, the confirmation and the
 * stories all read their verdict from here, so the surfaces cannot come to
 * disagree about a row the way two spellings of one rule do.
 *
 * ## The one family the control is offered on
 *
 * A VIDEO job row, and only a video job row. The post-turn cancel rail is the
 * video phase's designed control (design spec §2.2): the detached provider job
 * is the one class whose stop has no in-turn path — its card never offers
 * Cancel, because an in-turn press cannot cancel a job that outlives the call
 * (contract §4.2). The tool jobs beside it deliberately have no rail here: a
 * running bash job is left alone by design (backgrounding exists so a build
 * survives, `desktop_sessions.py`'s own note), and a task row's stop is a
 * different mechanism with its own instrument. Drawing this control on those
 * families would be inventing a second stop for them, which is the thing the
 * contract forbids. The discriminator is the wire's own `type` word, read once
 * onto `SubagentRow.jobType`.
 *
 * ## The refusal sentence
 *
 * The engine's wording map is frozen (`tools/image_tool.py`'s
 * `_CANCEL_PHRASES`), and its `not_found` phrase is what a refused/unknown-job
 * cancel speaks: the press asked about a job the provider no longer knows, and
 * the sentence states exactly that rather than a generic error. This constant
 * is the FALLBACK the UI supplies when a refusal arrives without the engine's
 * own words; when the route's refusal envelope carries its sentence, THAT
 * sentence is rendered instead — it comes from the same map, and the engine's
 * words always outrank this one.
 */
import {
	DESKTOP_REFUSAL_PLACEHOLDER,
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { t } from "../../../../../../i18n/messages";
import type { CancelCardAnchor } from "./cancel-card-placement";
import { type SubagentRow, isOpenRow } from "./run-detail-model";

/** The wire's own `type` word for the video lane's detached jobs (contract §1.7 G1). */
export const VIDEO_JOB_TYPE = "video";

/**
 * Whether a job row offers the pane's cancel control.
 *
 * TWO clauses, both load-bearing: the row is the video family's (the only
 * family the design attaches the rail to) and it is still OPEN (a settled job's
 * cancel is nothing — the section's own `isOpenRow` slice states the same rule,
 * and a control drawn over a settled row would send a request whose honest
 * answer is "nothing was left to cancel"). A row the wire stated no type for is
 * NOT cancellable: the control is withheld rather than guessed onto it.
 */
export const jobRowCanCancel = (row: SubagentRow): boolean =>
	row.jobType === VIDEO_JOB_TYPE && isOpenRow(row);

/**
 * The frozen `not_found` phrase, as the fallback for a refusal that arrived
 * without the engine's own sentence (see the header). Spelled with the map's
 * own words, em dash included, because it is quoted copy rather than ours.
 */
export const JOB_CANCEL_NOT_FOUND_COPY = t(
	"ui.chat.run_details.job_controls_model.not_cancelled_the_provider_no_longer_knows_the_job",
);

/** What a cancel answered: acknowledged, or the sentence to render where it was asked. */
export type JobCancelOutcome = { ok: true } | { ok: false; detail: string };

/** What the section and the confirmation need to offer the cancel. */
export type JobControls = {
	/**
	 * Cancel one job by its runtime id. Resolves the outcome rather than
	 * throwing, because a refusal is a rendered state on this surface (see
	 * `use-job-controls.ts`).
	 */
	cancel: (jobId: string) => Promise<JobCancelOutcome>;
};

/** What the section consumes from the pane body. */
export type JobCancelSection = {
	/**
	 * Ask to cancel this row; the pane body owns the confirmation and the
	 * write. The anchor rides the request as the frozen rect captured at the
	 * press (the row can unmount under the canonical re-read, so the card must
	 * not be anchored to the control itself).
	 */
	request: (row: SubagentRow, anchor: CancelCardAnchor) => void;
};

/**
 * Whether a failed job write is one a re-send can repair.
 *
 * NARROWER THAN ITS SIBLINGS, and narrowly the honest answer: ONLY a request
 * that never got an answer is retried — `status === null`, which is the IPC
 * call rejecting or main never replying within its own deadline. Re-sending is
 * how the outcome is learned, and a retried cancel is safe because a job that
 * is already gone answers an honest refusal rather than a second write. An
 * answered refusal — any status the backend actually sent — is the outcome
 * itself, and the first answer's sentence is what surfaces verbatim; the
 * route's own retryable codes, when it grows any, arrive with it rather than
 * being guessed from a status here (the monitor model's measured lesson).
 */
const isRetryableJobWrite = (error: unknown): boolean =>
	error instanceof DesktopControlError && error.status === null;

/** The write's retry policy: exactly one retry, over the boundary above. */
export const retryJobWrite = (failureCount: number, error: Error): boolean =>
	isRetryableJobWrite(error) ? failureCount < 1 : false;

/**
 * The sentence for a refused job cancel, per the header's rules.
 *
 * ONE case needs a substitution first: a refused/unknown-job cancel that
 * arrived WITHOUT a sentence is the class the frozen wording map already
 * names (`tools/image_tool.py`'s `not_found`), so the map's phrase is
 * rendered instead of the transport's bare placeholder — the design spec's
 * "the frozen `not_found`-class phrase, never a generic error". An authored
 * sentence always wins over it: surfaces render the engine's words, never a
 * claim of their own — and the landed route's `jobs_not_found` refusal IS
 * this map's phrase, arriving as the engine's copy, so both arms agree on
 * the rendered sentence by construction, not by coincidence.
 *
 * Lives HERE rather than in the hook so the verification surface can drive
 * the exact mapping the pane runs (agent review round 1, F3): the hook
 * imports it below the React boundary, and the suite bundles this module
 * without React, the way its siblings are driven.
 */
export const refusalDetail = (error: unknown): string => {
	if (
		error instanceof DesktopControlError &&
		error.status === 404 &&
		error.message === DESKTOP_REFUSAL_PLACEHOLDER
	)
		return t(
			"ui.chat.run_details.job_controls_model.not_cancelled_the_provider_no_longer_knows_the_job",
		);
	return userFacingMessage(
		error,
		t("ui.chat.run_details.job_controls_model.could_not_cancel_the_job"),
	);
};
