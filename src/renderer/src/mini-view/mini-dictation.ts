/**
 * The mini view's dictation controller — the §F seam, now riding the shared
 * speech-to-text stack (`use-speech-to-text-manager.ts`, #633).
 *
 * WHAT THE SEAM IS. `start()`, `stop(reason)`, `cancel()`, a `state` read, and
 * two callbacks (`onState`, `onResult`). The shared layer's frozen registration
 * contract is the `{start, stop}` pair (its `HoldActionHandler` type): `start`
 * begins a take, `stop` ends it — and the REASON is load-bearing, because a
 * release confirms what was said while an abort means the press was never a
 * hold at all and its capture is discarded. `cancel()` is that abort door under
 * the name the composer's own Esc gesture has always called it by. The
 * composer registers this same pair with the shared manager, which is what
 * makes this surface and the main composer ONE dictation stack rather than two.
 *
 * WHAT THE BODY IS TODAY. The recording primitives are the three the design
 * names — `getUserMedia`, `MediaRecorder`, `TranscriptionApi.createTranscription`
 * — in the same order and with the same failure sentences the composer already
 * uses (both reused verbatim, see `mini-copy.ts` and
 * `transcription-failure.ts`). What is NOT here: any dispatch of its own. The
 * hold binding and the IPC toggle live in the shared manager; this file never
 * installs a listener, and its `{start, stop}` is meaningful only through that
 * one dispatcher.
 *
 * TWO RULES COPIED FROM THE CONTRACT, stated because they are the edges a
 * naively small controller gets wrong:
 *
 * 1. A RELEASE THAT BEATS `getUserMedia` ENDS THE TAKE THE MOMENT IT EXISTS.
 *    The manager dispatches `stop` on the key release, which can land inside
 *    the recorder's async bring-up; a take whose release arrived first must end
 *    as soon as it starts — never an orphan recording nothing can stop.
 * 2. TAPS BELOW `MIN_DICTATION_CLIP_MS` ARE DISCARDED AFTER THE FACT, which is
 *    the composer's own rule (`message-input.tsx`): a clip that short is the
 *    tail of a press that was never speech, and the discard happens once the
 *    capture is over rather than by delaying the engage.
 *
 * WHAT THIS FILE DOES NOT DO: no streaming, no partial transcripts. Press the
 * mic, speak, press again — or hold the binding the manager dispatches — one
 * gesture, one transcript appended to the draft.
 */

import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import { transcriptionFailureMessage } from "@shared/api/local-operator/transcription-failure";
import { apiConfig } from "@shared/config/api-config";
import {
	DICTATION_UNAVAILABLE_COPY,
	MICROPHONE_DENIED_COPY,
} from "./mini-copy";

/** How a take ends: what a release keeps the abort discards. */
export type MiniDictationStopReason = "release" | "abort";

/** What the mic control draws from. */
export type MiniDictationState =
	| "idle"
	| "recording"
	| "transcribing"
	| "error";

export interface MiniDictationCallbacks {
	onState: (state: MiniDictationState) => void;
	/**
	 * A finished transcript, not a partial one. The composer appends it to the
	 * draft and marks the send's provenance at this callback (`sawDictation`,
	 * its `wireInputMode`); nothing else about the transcript is signalled here.
	 */
	onResult: (text: string) => void;
	/** A sentence to show in the hint row, already user-facing. */
	onError: (sentence: string) => void;
}

export interface MiniDictationController {
	readonly state: MiniDictationState;
	start(): Promise<void>;
	/**
	 * End the take in progress. `release` (the default) confirms it — subject
	 * to the minimum-clip rule — and `abort` discards it. Both are no-ops when
	 * no take is in flight, so a stray dispatch can never throw.
	 */
	stop(reason?: MiniDictationStopReason): void;
	/** Discard the capture in progress; nothing is transcribed. */
	cancel(): void;
	dispose(): void;
}

/**
 * The minimum take, in milliseconds (the composer's `MIN_DICTATION_CLIP_MS`,
 * same value and same reason): below it the capture is the tail of a press that
 * was never speech — a tap of the binding, or a hold released before the
 * recorder came up — and it is discarded once the capture is over.
 */
const MIN_DICTATION_CLIP_MS = 250;

/**
 * The take in flight, if any. `startedAt` stays `null` until the recorder is
 * actually running, because a release that lands inside the `getUserMedia`
 * window must find something to mark; `released`/`aborted` are that mark.
 */
interface MiniDictationAttempt {
	startedAt: number | null;
	released: boolean;
	aborted: boolean;
}

export function createMiniDictation(
	callbacks: MiniDictationCallbacks,
): MiniDictationController {
	let state: MiniDictationState = "idle";
	let recorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let discarding = false;
	let attempt: MiniDictationAttempt | null = null;
	/*
	 * A generation counter, because every step here is asynchronous and a
	 * disposed controller (the window hid, the component unmounted) must not
	 * deliver a transcript or a state change into a surface that is gone.
	 */
	let generation = 0;

	function setState(next: MiniDictationState): void {
		if (state === next) return;
		state = next;
		callbacks.onState(next);
	}

	function releaseStream(): void {
		if (stream !== null) {
			for (const track of stream.getTracks()) track.stop();
			stream = null;
		}
		recorder = null;
	}

	async function start(): Promise<void> {
		/*
		 * ONE RECORDER AT A TIME, the contract's rule (`start` is reachable
		 * without any control's `disabled` being consulted — the manager
		 * dispatches it): while a take is resolving or running, a second start
		 * would overwrite the only reference to the first recorder, leaving a
		 * live microphone the UI no longer shows. Transcribing is excluded too:
		 * the previous take's words are still in flight.
		 */
		if (attempt !== null || state === "transcribing") return;
		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia ||
			typeof MediaRecorder === "undefined"
		) {
			setState("error");
			callbacks.onError(DICTATION_UNAVAILABLE_COPY);
			return;
		}
		const mine = generation;
		/*
		 * The local reference is the same object `stop` marks: a release that
		 * lands inside the `getUserMedia` window mutates THIS take, and the
		 * narrow type here is what lets the check below read the mark without
		 * re-reading the nullable module slot.
		 */
		const take: MiniDictationAttempt = {
			startedAt: null,
			released: false,
			aborted: false,
		};
		attempt = take;
		try {
			const obtained = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			if (mine !== generation) {
				for (const track of obtained.getTracks()) track.stop();
				return;
			}
			stream = obtained;
			chunks = [];
			discarding = false;
			const mediaRecorder = new MediaRecorder(obtained);
			mediaRecorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) chunks.push(event.data);
			};
			mediaRecorder.onstop = () => {
				void finish(mine);
			};
			mediaRecorder.start();
			recorder = mediaRecorder;
			take.startedAt = performance.now();
			setState("recording");
			/*
			 * RELEASED BEFORE THE RECORDER EXISTED (rule 1): end it now rather
			 * than orphan it. The take is ~0 ms old, so the minimum-clip rule
			 * discards it — the correct outcome for a press that captured
			 * nothing.
			 */
			if (take.released) {
				settle(take.aborted ? "abort" : "release");
			}
		} catch (error) {
			attempt = null;
			releaseStream();
			setState("error");
			/*
			 * The permission arm, verbatim from the composer's toast: a refused
			 * or absent microphone is the same fact on both surfaces.
			 */
			console.error("Error accessing microphone:", error);
			callbacks.onError(MICROPHONE_DENIED_COPY);
		}
	}

	/**
	 * End the current take with the contract's REASON. The reason is what both
	 * the release and the abort door below funnel into, so there is one settle
	 * path rather than two that can drift.
	 */
	function stop(reason: MiniDictationStopReason = "release"): void {
		const current = attempt;
		if (current === null) return;
		if (current.startedAt === null) {
			/*
			 * The release/abort beat `getUserMedia` (rule 1): mark the attempt
			 * and let `start` finish the job the moment the recorder exists.
			 */
			current.released = true;
			current.aborted = reason === "abort";
			return;
		}
		settle(reason);
	}

	function cancel(): void {
		stop("abort");
	}

	/**
	 * Settle a take whose recorder is up. A release keeps the words (subject to
	 * rule 2), an abort discards them; either way the busy state — "transcribing"
	 * for a kept take — goes up with the STOP, not with the response, because
	 * the reader pressed a control that must answer immediately.
	 */
	function settle(reason: MiniDictationStopReason): void {
		const current = recorder;
		if (current === null) return;
		const startedAt = attempt?.startedAt ?? null;
		const elapsed =
			startedAt === null
				? Number.POSITIVE_INFINITY
				: performance.now() - startedAt;
		attempt = null;
		if (reason === "abort" || elapsed < MIN_DICTATION_CLIP_MS) {
			discarding = true;
			setState("idle");
			try {
				current.stop();
			} catch {
				releaseStream();
			}
			return;
		}
		discarding = false;
		setState("transcribing");
		try {
			current.stop();
		} catch {
			// A recorder already stopping fires `onstop` on its own; `finish`
			// owns what happens next either way.
		}
	}

	async function finish(mine: number): Promise<void> {
		/*
		 * The recorder reference is read BEFORE the release: `onstop` is the only
		 * caller and it fires from the recorder itself, so what the check below
		 * actually guards is a finish that raced a dispose — the generation
		 * counter's job — and the release clears the reference on every path.
		 */
		const blob = new Blob(chunks, { type: "audio/webm" });
		chunks = [];
		releaseStream();
		if (mine !== generation) return;
		if (discarding || blob.size === 0) {
			/*
			 * A cancel, a tap below the minimum clip, or a stop with nothing
			 * captured: no request, no transcript, no sentence. All are the
			 * user's own act, not a failure to report.
			 */
			discarding = false;
			setState("idle");
			return;
		}
		setState("transcribing");
		try {
			const response = await TranscriptionApi.createTranscription(
				apiConfig.baseUrl,
				{
					file: new File([blob], "recording.webm", { type: "audio/webm" }),
				},
			);
			if (mine !== generation) return;
			const text = response.result?.text;
			if (text) callbacks.onResult(text);
			setState("idle");
		} catch (error) {
			if (mine !== generation) return;
			/*
			 * The sentence is the shared module's, so the mini view and the
			 * composer can never disagree about why a transcription failed.
			 */
			console.error("Error transcribing audio:", error);
			setState("error");
			callbacks.onError(transcriptionFailureMessage(error));
		}
	}

	return {
		get state() {
			return state;
		},
		start,
		stop,
		cancel,
		dispose(): void {
			generation += 1;
			attempt = null;
			if (recorder !== null) {
				try {
					recorder.stop();
				} catch {
					// Already stopped; releasing below is the part that matters.
				}
			}
			releaseStream();
			state = "idle";
		},
	};
}
