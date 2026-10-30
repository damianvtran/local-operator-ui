import { TranscriptionApi } from "@shared/api/local-operator/transcription-api";
import {
	emptyTranscriptionMessage,
	isTransientTranscriptionFailure,
	transcriptionFailureMessage,
	transcriptionFailureRowMessage,
} from "@shared/api/local-operator/transcription-failure";
import { apiConfig } from "@shared/config/api-config";
import {
	SpeechToTextPriority,
	setDictationActive,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { t } from "@shared/i18n";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation for Team Bridge's own composer: hold-to-talk, the recording state,
 * and the one transcription request a take makes.
 *
 * WHY THIS IS A HOOK AND NOT THE SHARED COMPOSER'S MACHINERY. The chat pane's
 * dictation is written inside `MessageInput`, entangled with that assembly's
 * own state (its refusal, its credential capture, its `appendTranscriptText`
 * writer and its auto-send effect keyed on a retained blob). The Bridge bar is
 * not that assembly, so what is shared between the two surfaces is the
 * CAPABILITY and the manager - `useSpeechToTextManager`, the push-to-talk
 * binding it resolves, and the one transcription API with its retry and copy -
 * not the component that hosts it. That is the same split
 * `canvas/inline-edit.tsx` already takes for the canvas, and this is its
 * smallest form: the recorder owns nothing but itself, and the transcript is
 * handed to whoever mounted the hook.
 *
 * THE ATTEMPT IS ITS OWN IDENTITY, and that is the one non-obvious rule here.
 * A push-to-talk release can land while `getUserMedia` is still resolving. If
 * the release only marked a flag, a resolving stream could start a recorder
 * nobody can end - a live microphone with no control on screen. So a release
 * ABANDONS the attempt (the ref goes null) and the resolving arm discards a
 * stream whose attempt is no longer the ref's.
 */

/**
 * The minimum take, in milliseconds: below it the capture is the tail of a
 * press that was never speech (a modifier tap, a hold released before the
 * recorder came up). Discarded AFTER the fact rather than by delaying every
 * real recording behind a hold timer.
 */
export const MIN_DICTATION_CLIP_MS = 250;

/** The elapsed reading's cadence: a tenth of a second is finer than the eye. */
const ELAPSED_TICK_MS = 200;

export type TeamBridgeDictation = {
	/** The recorder is running: the strip is up and the field takes no keys. */
	isRecording: boolean;
	/** The microphone is still being acquired: said out loud, never silent. */
	isPreparing: boolean;
	/** A take is in flight to the transcription service. */
	isTranscribing: boolean;
	/**
	 * The take outlived a failure that time can fix, so the bytes are offered
	 * back; `null` when there is nothing to offer.
	 */
	failure: string | null;
	/** Milliseconds since this take's recorder started; 0 when idle. */
	elapsedMs: number;
	/** Begin a take (the mic's press, or the push-to-talk hold's start). */
	start: () => Promise<void>;
	/** The hold contract's release (`release` keeps the take, `abort` drops it). */
	stop: (reason?: "release" | "abort") => void;
	/** End the take and transcribe it. */
	confirm: () => void;
	/** End the take and discard it, keeping no bytes. */
	cancel: () => void;
	/** Send the retained take again. */
	retry: () => void;
};

export function useTeamBridgeDictation(args: {
	/**
	 * The manager registration id. The manager is keyed by id because two live
	 * composers (this pane and the chat pane) must not overwrite each other's
	 * push-to-talk handler.
	 */
	id: string;
	/** The composer accepts input, and the account can transcribe at all. */
	canRecord: boolean;
	/** Where a finished transcript goes: the host's own draft writer. */
	onTranscript: (text: string) => void;
}): TeamBridgeDictation {
	const { id, canRecord, onTranscript } = args;
	const [isPreparing, setIsPreparing] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [elapsedMs, setElapsedMs] = useState(0);

	/*
	 * THE TAKE IN FLIGHT: the attempt (which may exist before a recorder does),
	 * the recorder that attempt produced, its chunks, and the retained bytes a
	 * failed transcription may offer back.
	 */
	const attempt = useRef<{ startedAt: number | null } | null>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const chunks = useRef<Blob[]>([]);
	const retained = useRef<Blob | null>(null);
	/*
	 * THE BURST BELONGS TO THIS COMPOSER: a second transcription supersedes the
	 * first, and an unmount aborts rather than applying words to a box nobody is
	 * looking at.
	 */
	const burst = useRef<AbortController | null>(null);

	/*
	 * The callback rides a ref so an inline host closure cannot re-create the
	 * transcription path (and re-fire a retained take) on every render.
	 */
	const onTranscriptRef = useRef(onTranscript);
	useEffect(() => {
		onTranscriptRef.current = onTranscript;
	});

	const transcribe = useCallback(async (blob: Blob) => {
		burst.current?.abort();
		const controller = new AbortController();
		burst.current = controller;
		retained.current = blob;
		try {
			setIsTranscribing(true);
			const response = await TranscriptionApi.createTranscriptionWithRetry(
				apiConfig.baseUrl,
				{ file: new File([blob], "recording.webm", { type: "audio/webm" }) },
				{
					signal: controller.signal,
					/*
					 * The retry is written down where support looks: "the hop was
					 * tried three times" is the fact that separates a transient fault
					 * from a refusal when both wear the same sentence on screen.
					 */
					onRetry: ({ attempt: n, total, delayMs, error }) => {
						console.warn(
							`Transcription attempt ${n}/${total} failed with a transient upstream fault; retrying in ${delayMs} ms.`,
							error,
						);
					},
				},
			);
			if (response.result?.text) {
				onTranscriptRef.current(response.result.text);
			} else {
				/*
				 * A SUCCESSFUL, EMPTY TRANSCRIPT IS SAID OUT LOUD: the strip
				 * disappearing in silence reads as a gesture that did not work. Info
				 * rather than error - the request succeeded, the take held no speech.
				 */
				showInfoToast(emptyTranscriptionMessage());
			}
			retained.current = null;
			setFailure(null);
		} catch (error) {
			// An aborted burst is not a failure to report: the surface that owned
			// it is gone, or a newer take replaced it.
			if (controller.signal.aborted) return;
			console.error("Error transcribing audio:", error);
			/*
			 * THE TAKE STAYS WHEN TIME COULD FIX IT: a transient upstream fault is
			 * the class where sending the same bytes again is an action a person
			 * can take, so the row offers it. A refusal keeps the old behaviour -
			 * re-sending a decision cannot change it.
			 */
			if (isTransientTranscriptionFailure(error)) {
				setFailure(transcriptionFailureRowMessage(error));
			} else {
				setFailure(null);
				retained.current = null;
				showErrorToast(transcriptionFailureMessage(error));
			}
		} finally {
			if (burst.current === controller) setIsTranscribing(false);
		}
	}, []);

	/*
	 * THE TAKE'S OWN END. Stop the recorder, keeping it only when it is long
	 * enough to hold words and was not aborted. The discard arm replaces
	 * `onstop` before stopping, so the bytes never reach a transcription request.
	 */
	const settle = useCallback((reason: "release" | "abort") => {
		setIsPreparing(false);
		const live = recorder.current;
		if (!live) return;
		const startedAt = attempt.current?.startedAt ?? null;
		const elapsed =
			startedAt === null
				? Number.POSITIVE_INFINITY
				: performance.now() - startedAt;
		attempt.current = null;
		/*
		 * A SECOND SETTLE IS A NO-OP: one press can reach here twice inside
		 * one dispatch (the manager's abort and this composer's own Escape
		 * listener both answer the same key), and `stop()` on an
		 * already-inactive recorder throws `InvalidStateError` out of a window
		 * listener. There is nothing left to stop or discard, so only the
		 * state flag is settled.
		 */
		if (live.state === "inactive") {
			setIsRecording(false);
			setElapsedMs(0);
			return;
		}
		if (reason === "abort" || elapsed < MIN_DICTATION_CLIP_MS) {
			live.onstop = () => {
				for (const track of live.stream?.getTracks() ?? []) track.stop();
				chunks.current = [];
			};
		}
		live.stop();
		setIsRecording(false);
		setElapsedMs(0);
	}, []);

	const stop = useCallback(
		(reason: "release" | "abort" = "release") => {
			const live = attempt.current;
			if (!live) return;
			if (live.startedAt === null) {
				/*
				 * THE RELEASE INSIDE THE ACQUISITION ABANDONS THE ATTEMPT: nulling
				 * the ref is what makes the resolving arm discard its stream, and
				 * the acknowledgment ends now rather than when the promise lands -
				 * a cancel that leaves the ring up for another 800 ms reads as a
				 * key that did not work.
				 */
				attempt.current = null;
				setIsPreparing(false);
				return;
			}
			settle(reason);
		},
		[settle],
	);

	const start = useCallback(async () => {
		/*
		 * The button's own gate, the hold contract's, and the manager's: this
		 * callback is reachable without any control's `disabled` being consulted.
		 */
		if (!canRecord || attempt.current || isTranscribing) return;
		if (!navigator?.mediaDevices?.getUserMedia) {
			console.error("This runtime exposes no MediaRecorder");
			/* Not "your browser": this is a desktop app, and the person reading
			   this did not choose a browser and cannot change it. */
			showErrorToast(
				t("ui.canvas.inline_edit.dictation_is_not_available_on_this_device"),
			);
			return;
		}
		const mine: { startedAt: number | null } = { startedAt: null };
		attempt.current = mine;
		/*
		 * THE PRESS'S OWN FRAME: set before the first `await`, so the
		 * acknowledgment is committed in the click's own frame. The acquisition
		 * stays as long as it is (830 ms to over 2.6 s cold) but is no longer
		 * silent.
		 */
		setIsPreparing(true);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			/*
			 * THE STREAM BELONGS TO THE PRESS THAT ASKED FOR IT. An identity
			 * check rather than a flag: a released attempt nulls the ref, and a
			 * stream nothing owns is stopped here - an orphan recorder is a live
			 * microphone nothing can end.
			 */
			if (attempt.current !== mine) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			const live = new MediaRecorder(stream);
			recorder.current = live;
			chunks.current = [];
			live.ondataavailable = (event) => {
				if (event.data.size > 0) chunks.current.push(event.data);
			};
			live.onstop = () => {
				const take = new Blob(chunks.current, { type: "audio/webm" });
				chunks.current = [];
				for (const track of stream.getTracks()) track.stop();
				// A new take supersedes any offer to resend the last one.
				setFailure(null);
				void transcribe(take);
			};
			live.start();
			mine.startedAt = performance.now();
			// One commit, both flags: the acknowledgment is replaced by the
			// recording state, never shown beside it.
			setIsPreparing(false);
			setIsRecording(true);
			setElapsedMs(0);
		} catch (error) {
			/*
			 * THE SAME OWNERSHIP GUARD AS THE RESOLVE ARM: a refusal belongs to
			 * the press that asked for it, so an abandoned attempt's rejection
			 * must not clear the ref its SUCCESSOR put there.
			 */
			if (attempt.current !== mine) return;
			attempt.current = null;
			setIsPreparing(false);
			console.error("Error accessing microphone:", error);
			showErrorToast(
				t(
					"ui.canvas.inline_edit.error_accessing_microphone_please_ensure_microphone_permissions_are_gran",
				),
			);
		}
	}, [canRecord, isTranscribing, transcribe]);

	const confirm = useCallback(() => {
		if (!isRecording) return;
		settle("release");
	}, [isRecording, settle]);

	const cancel = useCallback(() => {
		if (!isRecording) return;
		settle("abort");
	}, [isRecording, settle]);

	const retry = useCallback(() => {
		const take = retained.current;
		if (!take || isTranscribing) return;
		// The offer is withdrawn in the same commit, so a second press cannot
		// queue a send nothing asked for.
		setFailure(null);
		void transcribe(take);
	}, [isTranscribing, transcribe]);

	/*
	 * THE MANAGER'S REGISTRATION, so the push-to-talk chord resolved from the
	 * keymap registry reaches this box. The gate is the box being writable -
	 * not a turn being idle: a mid-turn message rides the steer path, and
	 * dictation is a state OF the box.
	 */
	useSpeechToTextManager(
		id,
		SpeechToTextPriority.MESSAGE_INPUT,
		{ start, stop },
		() => Boolean(canRecord && !isRecording && !isTranscribing),
	);

	/*
	 * THE PRESENCE COVERS THE PRESS, NOT THE TAKE, and it is keyed by this
	 * composer so the page's Escape ladder can tell a live dictation from a live
	 * turn.
	 */
	useEffect(() => {
		setDictationActive(id, isRecording || isPreparing);
		return () => setDictationActive(id, false);
	}, [id, isRecording, isPreparing]);

	/*
	 * THE ELAPSED READING, only while a take is live: a timer that kept ticking
	 * at rest would re-render the bar forever for a number nobody is showing.
	 */
	useEffect(() => {
		if (!isRecording) return undefined;
		const started = performance.now();
		const tick = window.setInterval(
			() => setElapsedMs(performance.now() - started),
			ELAPSED_TICK_MS,
		);
		return () => window.clearInterval(tick);
	}, [isRecording]);

	/*
	 * ESCAPE AND ENTER DURING A TAKE. Escape cancels, Enter confirms - the two
	 * doors the strip's controls already are, reachable from the keys a person's
	 * hands are already on. Claimed only while a take exists, so neither key is
	 * taken from the field in any other state.
	 */
	useEffect(() => {
		if (!isRecording && !isPreparing) return undefined;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (isRecording && event.key === "Enter") {
				event.preventDefault();
				confirm();
				return;
			}
			if (event.key !== "Escape") return;
			event.preventDefault();
			// Preparing has no recorder to settle, so the cancel is the stop
			// contract's abandon - the same arm a push-to-talk release takes.
			if (isRecording) cancel();
			else stop("abort");
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isRecording, isPreparing, confirm, cancel, stop]);

	/*
	 * AN UNMOUNT SETTLES THE PRESS THIS HOOK OWNS: nulling the attempt is the
	 * abandon that makes the resolving arm discard an in-flight stream, and a
	 * running recorder is settled through the same abort arm Escape takes. The
	 * attempt is null at mount, so StrictMode's double-invoke is a no-op.
	 */
	useEffect(() => {
		return () => {
			attempt.current = null;
			const live = recorder.current;
			if (live && live.state !== "inactive") {
				live.onstop = () => {
					for (const track of live.stream?.getTracks() ?? []) track.stop();
					chunks.current = [];
				};
				live.stop();
			}
			burst.current?.abort();
		};
	}, []);

	return {
		isRecording,
		isPreparing,
		isTranscribing,
		failure,
		elapsedMs,
		start,
		stop,
		confirm,
		cancel,
		retry,
	};
}
