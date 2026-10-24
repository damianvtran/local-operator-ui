/**
 * Local Operator API - Transcription Endpoints
 */
import { UserFacingError, desktopMedia, mediaError } from "./desktop-api";
import {
	TranscriptionRequestError,
	isTransientTranscriptionFailure,
} from "./transcription-failure";
import type {
	CRUDResponse,
	CreateTranscriptionParams,
	RadientTranscriptionResponseData,
} from "./types";

/**
 * How many times one take is sent before the last failure is the answer.
 *
 * Three attempts, because the class this retries is a transient hop fault and not
 * a flaky read: one retry rides over a single gateway hiccup, and a second rides
 * over two inside one call before the user is told to press the control.
 */
export const TRANSIENT_TRANSCRIPTION_ATTEMPTS = 3;

/**
 * The wait before each retry, indexed by the attempt that just failed.
 *
 * 500 ms then 1500 ms: long enough that a probe of a recovering hop has moved on,
 * short enough that the composer's "processing audio" state is still plausible
 * feedback for the wait rather than a stall. Two delays for three attempts is the
 * bound, so the worst case this adds is 2 s.
 */
export const TRANSIENT_TRANSCRIPTION_RETRY_DELAYS_MS: readonly number[] = [
	500, 1500,
];

/** What a caller may observe about a retry, and the clock the tests drive it on. */
export interface TranscriptionRetryOptions {
	/**
	 * Called before each retry is waited out. The composer logs the attempt so a
	 * support log shows the hop was tried more than once; the tests count it.
	 */
	onRetry?: (retry: {
		attempt: number;
		total: number;
		delayMs: number;
		error: unknown;
	}) => void;
	/** The wait itself. Tests inject one that resolves immediately. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/**
	 * The surface's lifetime. A retry burst stops at the next check when this
	 * aborts, and a wait in progress resolves at once rather than leaving its
	 * timer armed (#1087 review round 1, F4).
	 */
	signal?: AbortSignal;
}

/**
 * The wait, with the abort honoured for its whole duration.
 *
 * The timer is cleared on abort rather than left to fire: the caller has gone,
 * and a timer that outlives it is the thing F4 was about even when the promise
 * it would resolve is already settled.
 */
const defaultSleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const settle = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", settle);
			resolve();
		};
		const timer = setTimeout(settle, ms);
		signal?.addEventListener("abort", settle, { once: true });
	});

/** What the policy decided about one failure: wait this long, then send again. */
export interface TranscriptionRetryPlan {
	/** The attempt that just failed, 1-based. */
	attempt: number;
	/** The bound the plan is inside. */
	total: number;
	/** The wait before the retry, in milliseconds. */
	delayMs: number;
}

/**
 * THE RETRY DECISION, pure, and the only place a retry is allowed.
 *
 * WHY IT IS A FUNCTION RATHER THAN THREE CONDITIONS IN THE LOOP. The loop below
 * is the one path a take travels, so a rule written inline there can only be
 * tested by running a request; extracted, the same rule is asserted directly AND
 * the loop calls it - one implementation, two readers, no copy that can drift.
 * The repo's convention is that a decision with a table of cases lives in a
 * function with that table beside it (see `transcriptionFailureMessage`).
 *
 * `null` IS THE WHOLE STOPPING CONDITION: no further request and no wait. It
 * answers null in three cases, in this order:
 * - the bound is spent - `TRANSIENT_TRANSCRIPTION_ATTEMPTS` sends are all a take
 *   gets, so the caller's error is the LAST attempt's, with its own words;
 * - there is no delay for this attempt (the delay list is shorter than the
 *   bound);
 * - the failure is not the transient class. `isTransientTranscriptionFailure`
 *   owns that table, and it excludes every REFUSAL - 402/401/403, the desktop
 *   plane's coded refusals, and the daemon's relayed upstream 4xx - because
 *   re-sending a decision spends the reader's time and the account's rate limit
 *   on a request that cannot start working.
 *
 * The class check runs LAST so the cheap bounds answer without touching the
 * error; the order is otherwise immaterial because every arm yields the same
 * null, and the table in the test pins each arm separately.
 */
export function planTranscriptionRetry(
	error: unknown,
	attempt: number,
): TranscriptionRetryPlan | null {
	if (attempt >= TRANSIENT_TRANSCRIPTION_ATTEMPTS) return null;
	const delayMs = TRANSIENT_TRANSCRIPTION_RETRY_DELAYS_MS[attempt - 1];
	if (delayMs === undefined) return null;
	if (!isTransientTranscriptionFailure(error)) return null;
	return { attempt, total: TRANSIENT_TRANSCRIPTION_ATTEMPTS, delayMs };
}

/**
 * Transcription API client for the Local Operator API
 */
export const TranscriptionApi = {
	/**
	 * Transcribe Audio File
	 *
	 * Transcribes an audio file using the specified model and parameters.
	 * The audio file is sent as `multipart/form-data`.
	 * @param baseUrl - The base URL of the Local Operator API.
	 * @param params - The parameters for the transcription request.
	 * @returns A promise that resolves to the transcription result.
	 * @throws {TranscriptionRequestError} When the request fails. The error keeps
	 * the server's own `detail` as its message AND the HTTP status beside it, so
	 * the caller can turn `insufficient_quota` and a 402 into different sentences
	 * (`transcriptionFailureMessage`) instead of the one generic line both
	 * surfaces used to show.
	 */
	async createTranscription(
		_baseUrl: string,
		params: CreateTranscriptionParams,
	): Promise<CRUDResponse<RadientTranscriptionResponseData>> {
		// Multipart is rebuilt by the relay from bytes plus string fields; the
		// renderer never assembles an authenticated request itself.
		const fields: Record<string, string> = {};
		if (params.model !== undefined) fields.model = params.model;
		if (params.prompt !== undefined) fields.prompt = params.prompt;
		if (params.response_format !== undefined)
			fields.response_format = params.response_format;
		if (params.temperature !== undefined)
			fields.temperature = params.temperature.toString();
		if (params.language !== undefined) fields.language = params.language;
		if (params.provider !== undefined) fields.provider = params.provider;
		const bytes = new Uint8Array(await params.file.arrayBuffer());
		const result = await desktopMedia(
			{
				op: "transcription.create",
				fileName: params.file.name || "audio",
				mimeType: params.file.type || "application/octet-stream",
				fields,
			},
			bytes,
		);
		if (result.kind !== "json") {
			/*
			 * THE PLATE'S OWN REFUSAL TRAVELS WITH ITS CODE (#1087). A 503 the desktop
			 * plane wrote ("this app is not paired", "the server did not answer") and a
			 * 503 the daemon answered are the same status on this wire, and only the
			 * code tells them apart. `isTransientTranscriptionFailure` refuses to
			 * retry the first kind, so dropping the code here would turn a pairing
			 * fact into two waits and a sentence about a fault that never happened.
			 */
			const failure = mediaError(result);
			throw new TranscriptionRequestError(
				result.status,
				failure.message,
				failure instanceof UserFacingError ? failure.code : undefined,
			);
		}
		return result.body as CRUDResponse<RadientTranscriptionResponseData>;
	},

	/**
	 * Transcribe a take, retrying a TEMPORARY upstream fault.
	 *
	 * WHY THE LOOP LIVES AT THIS SEAM rather than in a surface. Both surfaces that
	 * transcribe - the composer (`message-input.tsx`) and the canvas's inline editor
	 * (`inline-edit.tsx`) - already hand this client the bytes and show whatever it
	 * throws, so one loop here keeps their behaviour identical by construction
	 * instead of leaving a copy of the policy in each. It is also the one place the
	 * premise is visible: THE BYTES ARE IN HAND. An attempt costs a request and none
	 * of the user's speech, which is what makes a retry the right answer to a
	 * fault that clears on its own (#1087 - before this, the take was stranded in
	 * the caller's state and the user had to record again).
	 *
	 * BOUNDED, and only for the transient class. `planTranscriptionRetry` owns the
	 * bound and the waits, and `isTransientTranscriptionFailure` owns the
	 * classification and its rationale; everything deterministic - 402, 401, 403, a
	 * relayed upstream 4xx, either refusal family - is thrown on the first attempt,
	 * because retrying a refusal only delays the sentence the reader needs.
	 *
	 * `params.file` is re-read per attempt from the same immutable `File`, so the
	 * bytes are the SAME bytes and nothing is re-encoded or re-recorded between
	 * attempts.
	 *
	 * THE BURST BELONGS TO THE SURFACE THAT STARTED IT (#1087 review round 1, F4).
	 * `options.signal` is checked before every send and before every wait, so a
	 * closed editor or a navigated-away composer stops the burst instead of issuing
	 * the remaining requests and applying their result to state nobody is watching.
	 * The failure the caller sees is the abort itself, not the last refusal: the
	 * surface checks its own signal and stays silent.
	 */
	async createTranscriptionWithRetry(
		baseUrl: string,
		params: CreateTranscriptionParams,
		options: TranscriptionRetryOptions = {},
	): Promise<CRUDResponse<RadientTranscriptionResponseData>> {
		const sleep = options.sleep ?? defaultSleep;
		const { signal } = options;
		for (let attempt = 1; ; attempt += 1) {
			signal?.throwIfAborted();
			try {
				return await TranscriptionApi.createTranscription(baseUrl, params);
			} catch (error) {
				/*
				 * ONE QUESTION, ASKED OF THE POLICY rather than answered here: another
				 * send or the caller's error. The wait it returns is what is slept, so
				 * the backoff the test measures is the backoff the app waits.
				 */
				const plan = planTranscriptionRetry(error, attempt);
				if (plan === null) throw error;
				options.onRetry?.({ ...plan, error });
				await sleep(plan.delayMs, signal);
				signal?.throwIfAborted();
			}
		}
	},
};
