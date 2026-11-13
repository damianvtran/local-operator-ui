import { createContext } from "react";
import {
	type JobCancelSection,
	MUSIC_JOB_TYPE,
	jobRowCanCancel,
} from "../components/run-details/job-controls-model";
import {
	type SubagentRow,
	isOpenRow,
} from "../components/run-details/run-detail-model";
import { isMusicGenTool, musicJobIdOf } from "./music-gen-tool";
import type { MusicReceipt } from "./music-receipt-model";
import { soundCostCaption } from "./sound-cost-caption";
import type { TranscriptRecord } from "./transcript-reducer";

/*
 * THE IN-CHAT MUSIC GENERATING CARD'S STATE, derived from facts the chat
 * already holds rather than from a new channel (operator decision a-69e7:
 * "Show the generating motif inline in chat").
 *
 * WHY THIS EXISTS. `generate_music`/`modify_music` register a detached
 * `AsyncJob` and return a receipt in milliseconds (`details: {job_id, stage:
 * "queued", material: "music"}`), exactly like `generate_video` — so the call's
 * own record settles long before minutes of paid provider work finish. Before
 * this card the transcript painted only a collapsed "1 action" row while the
 * job ran; the waveform motif lived solely on the Jobs row. The card keeps the
 * work visible at the call's own place and settles there.
 *
 * THREE SOURCES, IN AUTHORITY ORDER:
 *   1. The settlement — the durable `job_result` row Core appends when the job
 *      ends (`Session._job_result_message`: `details.job_id`, the music
 *      receipt merged in, and the frozen sentence `background job '<label>'
 *      <status>…`). Once it exists it wins: it survives reloads, and the live
 *      Jobs row is swept five minutes after settling.
 *   2. The live Jobs row (`RunDetails.jobs`, the same `SubagentRow` the Jobs
 *      panel paints, with `music.{stage,total,completed}` from the job's
 *      `latest_details`). This is the only source of per-track progress and of
 *      the cancel affordance, and it is the SAME row the panel cancels — so the
 *      inline Cancel can never target a different job.
 *   3. The call's own receipt (`stage: "queued"`). With neither of the above
 *      (a transcript mounted without run details, or the instant before the
 *      first Jobs snapshot) the last fact Core stated is "queued", and that is
 *      what is painted — never a guessed progress figure.
 *
 * Absent `job_id` (a refusal before registration, an older runtime) the call
 * is not a detached job and the ordinary tool row renders unchanged.
 */

// The tool-name and job-id predicates live in a dependency-free module so the
// transcript fold model can use them without bundling this file's React /
// run-details graph into the condense parity pin (R16-1). Re-exported here so
// existing importers of the card model keep one entry point.
export {
	MUSIC_GEN_TOOL_NAMES,
	isMusicGenTool,
	musicJobIdOf,
} from "./music-gen-tool";

/**
 * The status word Core's frozen job_result sentence carries
 * (`background job '<label>' <status>[ (pinned …)][:\n…|.| — …]`). The label
 * is quoted and may itself contain quotes, so the match is anchored on the
 * LAST `' ` before the status word rather than the first — but only on the
 * HEADER line. The summary after `:\n` is free text (a provider error can say
 * "track 'Dawn' completed early"), so a match allowed to cross the newline
 * would read the summary's last quoted word as the job's status (R15-1).
 */
export function jobResultStatus(text: string): string | null {
	const match =
		/^background job '[^\n]*' (completed|failed|cancelled|paused)\b/.exec(text);
	return match ? match[1] : null;
}

export type MusicJobSettlement = {
	status: string | null;
	receipt: MusicReceipt | null;
	/**
	 * The settlement of the SUCCESSOR observer job that carried this music job
	 * on after a cancel, when one has landed (see `musicJobSettlementsOf`).
	 */
	successor?: { status: string | null; receipt: MusicReceipt | null };
};

/*
 * WHY A MUSIC JOB CAN SETTLE TWICE. Core's music runner (`music/jobs.py`,
 * `runner`'s `CancelledError` arm, Core 859729bd) treats a cancel as a REQUEST:
 * it asks the provider to stop, then registers a NEW observer `AsyncJob` (the
 * record's `watcher`) because a running provider can still finish and bill. So
 * the job the call registered settles `cancelled` - true of that task - while
 * the paid outcome, if any, settles later on a different job id whose receipt
 * still names the original music job (`music_receipt.job`, and
 * `latest_details.music.job` on the live row). Native run 42779240064 showed
 * exactly this: job 8b1723b0f326 cancelled, its observer 5d2b5eecaee0 finished
 * track aud_serving_8, billed. Keying the card by the call's job id alone told
 * the operator "cancelled" for music they were charged for. The successor is
 * found through that receipt/live `job` field, never guessed from timing.
 */

/**
 * Settled detached jobs by the music job they belong to, from the transcript's
 * `job_result` rows. A row whose receipt names a different music job than its
 * own `job_id` is that job's successor observer and is attached as
 * `successor` (in either arrival order), so it never overwrites the call's own
 * settlement nor masquerades as a separate job.
 */
export function musicJobSettlementsOf(
	records: readonly TranscriptRecord[],
): Map<string, MusicJobSettlement> {
	const own = new Map<string, MusicJobSettlement>();
	const successors = new Map<
		string,
		NonNullable<MusicJobSettlement["successor"]>
	>();
	for (const record of records) {
		if (record.kind !== "custom" || !record.jobId) continue;
		const settled = {
			status: jobResultStatus(record.text),
			receipt: record.music ?? null,
		};
		const musicJob = record.music?.job;
		if (musicJob && musicJob !== record.jobId)
			successors.set(musicJob, settled);
		else own.set(record.jobId, settled);
	}
	for (const [musicJob, successor] of successors) {
		// A successor with no own settlement yet (the cancelled row has not been
		// delivered) still settles its job: status unknown, receipt absent.
		own.set(musicJob, {
			...(own.get(musicJob) ?? { status: null, receipt: null }),
			successor,
		});
	}
	return own;
}

/**
 * The Jobs rows a chat's music cards read: by job id, plus successor observer
 * rows by the music job they carry (`music.job` differs from the row's id).
 */
export function musicJobsLiveRowsOf(rows: readonly SubagentRow[]): {
	rows: Map<string, SubagentRow>;
	successors: Map<string, SubagentRow>;
} {
	const byId = new Map<string, SubagentRow>();
	const successors = new Map<string, SubagentRow>();
	for (const row of rows) {
		if (row.jobType !== MUSIC_JOB_TYPE) continue;
		const musicJob = row.music?.job;
		if (musicJob && musicJob !== row.id) successors.set(musicJob, row);
		else byId.set(row.id, row);
	}
	return { rows: byId, successors };
}

/** What a chat mount knows live about music jobs; null = no run details here. */
export type MusicJobsLive = {
	rows: ReadonlyMap<string, SubagentRow>;
	/** Successor observer rows by the music job they carry (`musicJobsLiveRowsOf`). */
	successors?: ReadonlyMap<string, SubagentRow>;
	/** The chat's own confirm flow (`useJobCancel`); absent = no control. */
	request: JobCancelSection["request"] | null;
	/**
	 * Whether the chat holds a run-details snapshot at all. With one, a job id
	 * that has neither a live row nor a settlement is a job this runtime no
	 * longer knows (e.g. lost across a restart): the card says its status is
	 * unavailable instead of repeating "queued" forever (R15-4). Without one
	 * there is nothing to contradict the call's own queued receipt.
	 */
	loaded: boolean;
};

export const MusicJobsLiveContext = createContext<MusicJobsLive | null>(null);
export const MusicJobSettlementsContext = createContext<
	ReadonlyMap<string, MusicJobSettlement>
>(new Map());

export type MusicGeneratingState =
	| "queued"
	| "generating"
	| "cancel_requested"
	| "done"
	| "failed"
	| "cancelled"
	/**
	 * A cancel was requested but the provider finished anyway: tracks exist and
	 * were billed (the cancel confirmation warns this can happen). Distinct
	 * from `cancelled` so the card never says "cancelled" over a paid track.
	 */
	| "finished_after_cancel"
	/** Nothing current states this job's status (see `MusicJobsLive.loaded`). */
	| "unavailable";

export type MusicGeneratingView = {
	jobId: string;
	state: MusicGeneratingState;
	/** `modify_music` names its act differently; nothing else changes. */
	modify: boolean;
	/**
	 * Tracks SETTLED, the number the motif's "{completed}/{total} tracks
	 * settled" label states (D1, design r17). In flight it is Core's own
	 * `music.completed`; once the job has settled every track has too - ready,
	 * failed, or ended by the cancel - so it equals `total`. Counting only
	 * tracks with audio here made a finished failed/partial card read "0/1" or
	 * "1/2 tracks settled", as if work were still pending. Which outcome each
	 * track had is the result row's job (`MusicResult`), not this counter's.
	 */
	completed: number;
	total: number;
	/** The settled receipt's billed/estimated caption; null = none stated. */
	cost: string | null;
	/** The live Jobs row this card's Cancel requests; null = no control. */
	cancelRow: SubagentRow | null;
};

/**
 * One caption for the whole job, only when every track states the same basis:
 * a mix of billed and estimated amounts summed under one word would misstate
 * one of them, so the per-track captions on the result row stay authoritative
 * and the card says nothing.
 */
function receiptCost(receipt: MusicReceipt | null): string | null {
	if (!receipt || receipt.tracks.length === 0) return null;
	let sum = 0;
	let basis: unknown;
	for (const track of receipt.tracks) {
		const cost = track.cost;
		if (!cost || typeof cost.amount_usd !== "number") return null;
		if (basis !== undefined && cost.basis !== basis) return null;
		basis = cost.basis;
		sum += cost.amount_usd;
	}
	return soundCostCaption({ cost_usd: sum, billing_basis: basis });
}

/**
 * The card after a cancel request whose job was carried on by a successor
 * observer (see "WHY A MUSIC JOB CAN SETTLE TWICE"); null when there is no
 * successor or no cancel behind it. The successor is the only source of the
 * outcome: audio means the provider finished anyway (billed — the cost caption
 * stays), no audio means the cancel took effect ("cancelled", with the
 * receipt's own `$0` caption). While the successor still works the state is
 * `cancel_requested`, never the original task's premature "cancelled", and no
 * second Cancel is offered: the provider has already been asked.
 */
function successorOutcome(
	base: Pick<MusicGeneratingView, "jobId" | "modify" | "cancelRow">,
	{
		settlement,
		row,
		successorRow,
	}: {
		settlement: MusicJobSettlement | undefined;
		row: SubagentRow | undefined;
		successorRow: SubagentRow | undefined;
	},
): MusicGeneratingView | null {
	const settled = settlement?.successor;
	if (!settled && !successorRow) return null;
	const cancelRequested =
		settlement?.status === "cancelled" ||
		row?.status === "cancelled" ||
		row?.music?.stage === "cancel_requested" ||
		successorRow?.music?.stage === "cancel_requested";
	if (!cancelRequested) return null;
	if (settled) {
		const tracks = settled.receipt?.tracks ?? [];
		const completed = tracks.filter((track) => track.images.length > 0).length;
		return {
			...base,
			state: completed > 0 ? "finished_after_cancel" : "cancelled",
			completed: tracks.length,
			total: tracks.length,
			cost: receiptCost(settled.receipt),
		};
	}
	const live = successorRow as SubagentRow;
	const completed = live.music?.completed ?? 0;
	const total = live.music?.total ?? 0;
	if (isOpenRow(live))
		return { ...base, state: "cancel_requested", completed, total, cost: null };
	// Settled live, durable row not landed yet: Core's `completed` means audio
	// was registered (`jobs.py` raises when nothing is playable), so it states
	// the paid outcome; anything else is the cancel having taken effect.
	// `live` is a `SubagentRow`, whose status `foldStatus` (run-detail-model)
	// has already folded from the wire's `completed` to `done` - so `done` IS
	// Core's `completed` here, unlike the raw roster `settled-job-rows.ts` reads.
	return {
		...base,
		state: live.status === "done" ? "finished_after_cancel" : "cancelled",
		completed: total,
		total,
		cost: null,
	};
}

export function musicGeneratingView({
	toolName,
	details,
	row,
	settlement,
	successorRow,
	liveLoaded = false,
}: {
	toolName: string;
	details: unknown;
	row: SubagentRow | undefined;
	settlement: MusicJobSettlement | undefined;
	/** The live successor observer row carrying this music job, if any. */
	successorRow?: SubagentRow;
	/**
	 * Run details are loaded and have had time to list this job (the hook
	 * applies a grace window so a just-launched job is not called lost before
	 * its first row arrives). Absent/false keeps the receipt's "queued".
	 */
	liveLoaded?: boolean;
}): MusicGeneratingView | null {
	if (!isMusicGenTool(toolName)) return null;
	const jobId = musicJobIdOf(details);
	if (jobId === null) return null;
	const modify = toolName === "modify_music";
	const base = { jobId, modify, cost: null, cancelRow: null };
	const afterCancel = successorOutcome(base, {
		settlement,
		row,
		successorRow,
	});
	if (afterCancel) return afterCancel;
	if (settlement?.successor || successorRow) {
		// A successor with no cancel behind it (Core's session-reopen recovery
		// observes an unfinished job the same way): it simply IS the job now.
		return musicGeneratingView({
			toolName,
			details,
			row: successorRow ?? row,
			settlement:
				settlement?.successor ??
				(settlement
					? { status: settlement.status, receipt: settlement.receipt }
					: undefined),
			liveLoaded,
		});
	}
	if (settlement) {
		const tracks = settlement.receipt?.tracks ?? [];
		const completed = tracks.filter((track) => track.images.length > 0).length;
		/*
		 * "done" needs a positive fact (R15-2): Core's own `completed`, or tracks
		 * that actually carry bytes. A status the parse could not read, or one
		 * that is not terminal (`paused`), with no audio is not "Music ready" —
		 * it is a status the card cannot state.
		 */
		const state: MusicGeneratingState =
			settlement.status === "cancelled"
				? "cancelled"
				: settlement.status === "failed" ||
						(tracks.length > 0 && completed === 0)
					? "failed"
					: settlement.status === "completed" || completed > 0
						? "done"
						: "unavailable";
		return {
			...base,
			state,
			completed: tracks.length,
			total: tracks.length,
			cost: state === "done" ? null : receiptCost(settlement.receipt),
		};
	}
	if (row) {
		const completed = row.music?.completed ?? 0;
		const total = row.music?.total ?? 0;
		if (!isOpenRow(row)) {
			// Settled live but the durable row has not landed yet: state the
			// outcome the Jobs row states, never a lingering "generating".
			const state: MusicGeneratingState =
				row.status === "cancelled"
					? "cancelled"
					: row.status === "failed"
						? "failed"
						: "done";
			return { ...base, state, completed: total, total };
		}
		const stage = row.music?.stage;
		const state: MusicGeneratingState =
			stage === "cancel_requested"
				? "cancel_requested"
				: stage === "polling" || row.status === "running"
					? "generating"
					: "queued";
		return {
			...base,
			state,
			completed,
			total,
			cancelRow: jobRowCanCancel(row) ? row : null,
		};
	}
	return {
		...base,
		state: liveLoaded ? "unavailable" : "queued",
		completed: 0,
		total: 0,
	};
}
