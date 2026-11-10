import { type JobDelta, applyJobDeltas } from "./job-deltas";
import type { TranscriptRecord } from "./transcript-reducer";

/**
 * WHY A SETTLED JOB OWES THE PANE A HISTORY READ.
 *
 * A detached job's result reaches the transcript as a `job_result` CUSTOM row
 * (`Session._job_result_message`), and Core never streams custom rows as live
 * message events: `_run_turn` announces only user `Message`s, and the loop
 * emits `message_start`/`message_end` only for assistant messages. What Core
 * publishes instead is a `frontend.update` whose `changes.history_cursor` names
 * the newest transcript entry - "the field a viewer's history reconciliation
 * reads" (`Session._on_job_completed`, Core 859729bd). The pane, however, read
 * history only on a snapshot that does not connect, an attention frame naming
 * an unpainted anchor, or a label gap. So a result that landed while the pane
 * was open stayed invisible until a reload or navigate re-read the page.
 *
 * It was latent for ordinary completions because something else usually forced
 * a read soon after (the harness reloads; an operator's next action re-reads).
 * Music that finishes AFTER a cancel exposed it: Core settles the original job
 * `cancelled`, then a successor observer job delivers the billed track in its
 * own `job_result` row (native run 42862983641, entry 96: job_id 96de655246c3,
 * job a911f847e12e). The inline card read `finished_after_cancel` from the live
 * Jobs row, but the track row never painted in 30 s - while the same row loaded
 * from history rendered fine.
 *
 * THE RULE, deliberately narrow: a read is owed only when the published cursor
 * moved to an entry this pane has not painted AND the roster holds a SETTLED
 * job with no painted `job_result` row. A cursor move alone is not enough -
 * Core advances it for rows no viewer paints (music progress records, spend
 * rows, checkpoints), and reading on each would put a history request behind
 * every tick. The job condition clears itself the moment the row paints, and
 * the caller bounds attempts per job so a result that never becomes visible
 * (filtered, or swept from the roster) cannot drip reads.
 */

/** Roster statuses after which Core has written (or is writing) the result row. */
const SETTLED_STATUSES = new Set([
	"done",
	"failed",
	"cancelled",
	"interrupted",
]);

/** Job ids whose roster row is settled but whose `job_result` row is not painted. */
export function settledJobsWithoutResult(
	jobs: ReadonlyArray<Record<string, unknown>>,
	records: readonly TranscriptRecord[],
): string[] {
	const painted = new Set<string>();
	for (const record of records)
		if (record.kind === "custom" && record.jobId) painted.add(record.jobId);
	const owed: string[] = [];
	for (const row of jobs) {
		const id = row.id == null ? "" : String(row.id);
		if (!id || painted.has(id)) continue;
		if (SETTLED_STATUSES.has(String(row.status ?? ""))) owed.push(id);
	}
	return owed;
}

/** The slice of a `frontend.update` frame this decision reads. */
export type CursorUpdate = {
	changes?: { history_cursor?: unknown; jobs?: unknown } | null;
	job_deltas?: JobDelta | null;
};

/**
 * The settled jobs one batch of `frontend.update` payloads owes a read for, or
 * an empty list when none is owed. `jobs` is the roster the pane held before
 * the batch; the batch's own roster changes are folded in so a settle and its
 * cursor move arriving together still count. `isPainted` answers for the
 * cursor's entry id.
 */
export function jobResultsOwedRead(
	updates: readonly CursorUpdate[],
	jobs: ReadonlyArray<Record<string, unknown>>,
	records: readonly TranscriptRecord[],
	isPainted: (id: string) => boolean,
): string[] {
	let roster = jobs;
	let cursorMoved = false;
	for (const update of updates) {
		const changes = update.changes ?? {};
		if (Array.isArray(changes.jobs))
			roster = changes.jobs as Array<Record<string, unknown>>;
		else if (update.job_deltas)
			roster = applyJobDeltas(roster, update.job_deltas);
		const cursor = changes.history_cursor;
		if (typeof cursor === "string" && cursor !== "" && !isPainted(cursor))
			cursorMoved = true;
	}
	return cursorMoved ? settledJobsWithoutResult(roster, records) : [];
}
