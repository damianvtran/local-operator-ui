/*
 * THE WAVEFORM INDICATOR'S MICROPHONE SESSION, as a framework-free lifecycle.
 *
 * WHY THIS LIVES APART FROM THE COMPONENT. The indicator opens its own
 * microphone stream for the level meter (the recorder's stream belongs to the
 * composer and the canvas inline edit; this component is not its owner -
 * handing one across surfaces is its own change). The acquisition is
 * asynchronous, and the recording can end INSIDE it: Escape, a push-to-talk
 * release shorter than `MIN_DICTATION_CLIP_MS`, or a conversation switch all
 * clean up the effect before `getUserMedia` settles. That used to strand the
 * stream - the resolution arm stored it in a ref whose cleanup had already
 * run and started an `AudioContext` beside it, so the microphone stayed open
 * for the life of the window while no recording showed and no control could
 * stop it (issue #930).
 *
 * THE CONTRACT THIS MODULE IMPLEMENTS is the composer's own cancellation /
 * identity pattern (the recording attempt in
 * `shared/components/composer/message-input.tsx`): an acquisition is OWNED by
 * the session that started it, and a session that has been stopped releases
 * everything it acquires, WHENEVER it arrives:
 *
 * - settles before `stop()`: the stream and context become the session's, and
 *   `stop()` releases them - the component cleanup's normal path;
 * - settles after `stop()`: the resolution arm sees the released session and
 *   stops the arriving tracks at once, BEFORE any `AudioContext` exists -
 *   nothing is stood up that would later have to be closed;
 * - rejects after `stop()`: silent no-op. A refusal on an abandoned attempt
 *   belongs to nobody, and `onError`'s fallback loop would otherwise start
 *   after the cleanup that exists to cancel it.
 *
 * Ownership is exact in both directions: `stop()` releases only what ITS
 * session acquired, and two sessions cannot cross-release, because the async
 * body closes over its own `stream`/`context` variables rather than sharing
 * refs. `scripts/audio-meter-stream.test.mjs` drives the arrival orderings
 * this contract names, including the late one the defect was made of.
 */

export type AudioMeterStreamHandle = {
	/**
	 * Release the session: stop every track it has acquired - including one
	 * still in flight, on arrival - and close its `AudioContext`. Idempotent.
	 */
	stop(): void;
};

export type AudioMeterStreamOptions = {
	/** The mic acquisition, injected so the lifecycle is testable without a device. */
	getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
	/** The context factory, injected for the same reason (the webkit fallback stays in the component). */
	createAudioContext(): AudioContext;
	/** Called once the analyser is wired - only while the session is still owed. */
	onAnalyser(analyser: AnalyserNode): void;
	/** Called when the acquisition or the wiring fails - only while the session is still owed. */
	onError(error: unknown): void;
};

export const acquireAudioMeterStream = (
	options: AudioMeterStreamOptions,
): AudioMeterStreamHandle => {
	/*
	 * The session's own state, closed over rather than held in refs: this is
	 * what makes ownership exact per acquisition, and what lets a resolution
	 * landing after `stop()` still be released by the arm that receives it.
	 */
	let stopped = false;
	let stream: MediaStream | null = null;
	let context: AudioContext | null = null;

	const stopTracks = (target: MediaStream) => {
		for (const track of target.getTracks()) {
			track.stop();
		}
	};

	const session: AudioMeterStreamHandle = {
		stop: () => {
			// Idempotent: a second release has nothing left to unwind.
			if (stopped) {
				return;
			}
			stopped = true;
			if (stream) {
				stopTracks(stream);
				stream = null;
			}
			if (context && context.state !== "closed") {
				context.close().catch(console.error);
			}
			context = null;
		},
	};

	void (async () => {
		let acquired: MediaStream;
		try {
			acquired = await options.getUserMedia({ audio: true });
		} catch (error) {
			/*
			 * A refusal (or a `mediaDevices` that is not there) on an abandoned
			 * attempt is nobody's: reporting it would start the fallback loop
			 * after the cleanup that cancels it.
			 */
			if (!stopped) {
				options.onError(error);
			}
			return;
		}
		if (stopped) {
			/*
			 * THE RACE (issue #930): the session was released while this
			 * acquisition was in flight. Release what arrived, here - and
			 * before any `AudioContext` exists, so nothing is created that
			 * would have to be closed later.
			 */
			stopTracks(acquired);
			return;
		}
		stream = acquired;
		try {
			const audioCtx = options.createAudioContext();
			context = audioCtx;
			const analyser = audioCtx.createAnalyser();
			/*
			 * The time-domain window, `fftSize` samples (~23 ms at 44.1 kHz):
			 * long enough that a frame's RMS reads as speech loudness rather
			 * than as one cycle of the waveform's phase. `smoothingTimeConstant`
			 * is not set: it shapes the FREQUENCY data's smoothing, and this
			 * pipeline reads raw samples - the smoothing lives in the level
			 * reducer's release now, where it is testable.
			 */
			analyser.fftSize = 1024;
			const source = audioCtx.createMediaStreamSource(acquired);
			source.connect(analyser);
			options.onAnalyser(analyser);
		} catch (error) {
			/*
			 * Wiring failed while the session was still owed: the component
			 * falls back (its random loop), and the stream and any context
			 * stay the session's, so its cleanup releases them with the rest.
			 * The resolution arm above is the one that must leave nothing
			 * behind; a live session has a cleanup coming either way.
			 */
			options.onError(error);
		}
	})();

	return session;
};
