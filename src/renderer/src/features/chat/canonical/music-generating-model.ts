import { createContext } from "react";
import {
	type JobCancelSection,
	jobRowCanCancel,
} from "../components/run-details/job-controls-model";
import {
	type SubagentRow,
	isOpenRow,
} from "../components/run-details/run-detail-model";
import { isMusicGenTool, musicJobIdOf } from "./music-gen-tool";
import type { MusicReceipt } from "./music-receipt-model";
import { soundCostCaption } from "./sound-cost-caption";

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
};

/** What a chat mount knows live about music jobs; null = no run details here. */
export type MusicJobsLive = {
	rows: ReadonlyMap<string, SubagentRow>;
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
	/** Nothing current states this job's status (see `MusicJobsLive.loaded`). */
	| "unavailable";

export type MusicGeneratingView = {
	jobId: string;
	state: MusicGeneratingState;
	/** `modify_music` names its act differently; nothing else changes. */
	modify: boolean;
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

export function musicGeneratingView({
	toolName,
	details,
	row,
	settlement,
	liveLoaded = false,
}: {
	toolName: string;
	details: unknown;
	row: SubagentRow | undefined;
	settlement: MusicJobSettlement | undefined;
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
			completed,
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
			return { ...base, state, completed, total };
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
