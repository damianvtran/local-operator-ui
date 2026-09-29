/**
 * The mini view's dictation controller — the §F seam, kept deliberately small
 * so the speech-to-text overhaul can replace its BODY without touching a
 * single call site in the composer.
 *
 * WHAT THE SEAM IS. `start()`, `stop()`, `cancel()`, a `state` read, and two
 * callbacks (`onState`, `onResult`). The overhaul's shared layer is being built
 * to the same shape, so when it lands this module keeps its interface and its
 * body swaps to their primitives; the composer imports
 * `createMiniDictation` and nothing else, which is what makes that swap one
 * commit (design §F).
 *
 * WHAT THE BODY IS TODAY, and why it is not an import from `message-input.tsx`:
 * the composer's recorder is inline state in a file the redesign owns, and
 * importing a component's internals is not a seam. So the three primitives the
 * design names are used directly — `getUserMedia`, `MediaRecorder`,
 * `TranscriptionApi.createTranscription` — in the same order and with the same
 * failure sentences the composer already uses (both reused verbatim, see
 * `mini-copy.ts`).
 *
 * WHAT THIS FILE DOES NOT DO: no streaming, no partial transcripts, no
 * push-to-talk (that is the STT stream's own key, and Electron's
 * `globalShortcut` cannot even observe key-up). Press the mic, speak, press
 * again — one gesture, one transcript appended to the draft.
 */

import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import { transcriptionFailureMessage } from "@shared/api/local-operator/transcription-failure";
import { apiConfig } from "@shared/config/api-config";
import {
	DICTATION_UNAVAILABLE_COPY,
	MICROPHONE_DENIED_COPY,
} from "./mini-copy";

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
	 * draft; whether it also marks the send as dictated is the overhaul's flag
	 * (`meta.dictated`, design §F) and deliberately absent here.
	 */
	onResult: (text: string) => void;
	/** A sentence to show in the hint row, already user-facing. */
	onError: (sentence: string) => void;
}

export interface MiniDictationController {
	readonly state: MiniDictationState;
	start(): Promise<void>;
	stop(): void;
	/** Discard the capture in progress; nothing is transcribed. */
	cancel(): void;
	dispose(): void;
}

export function createMiniDictation(
	callbacks: MiniDictationCallbacks,
): MiniDictationController {
	let state: MiniDictationState = "idle";
	let recorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let discarding = false;
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
		if (state === "recording" || state === "transcribing") return;
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
			setState("recording");
		} catch (error) {
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

	function stop(): void {
		if (recorder === null || state !== "recording") return;
		discarding = false;
		/*
		 * The busy state goes up with the STOP, not with the response: the
		 * machine's own `onstop` may be a tick away and the reader pressed a
		 * control that must answer immediately.
		 */
		setState("transcribing");
		try {
			recorder.stop();
		} catch {
			// A recorder already stopping fires `onstop` on its own; `finish`
			// owns what happens next either way.
		}
	}

	function cancel(): void {
		if (recorder === null) return;
		discarding = true;
		setState("idle");
		try {
			recorder.stop();
		} catch {
			releaseStream();
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
			 * A cancel, or a stop with nothing captured: no request, no
			 * transcript, no sentence. Both are the user's own act, not a
			 * failure to report.
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
