import type { VadEventKind } from "./channels";
import { encodeWav } from "./wav";

/**
 * The seam the real voice-activity detector plugs into (plan D2). The real one
 * is `@ricky0123/vad-web`'s `MicVAD`, added in a later step; everything here is
 * built against this interface and a fake. The factory takes the callbacks so
 * an implementation can hand them straight to its library.
 */
export interface VoiceActivityDetector {
	start(): Promise<void>;
	pause(): void;
	/** Release the microphone. */
	destroy(): Promise<void> | void;
}

export type VadCallbacks = {
	/**
	 * Speech that proved real (vad-web's `onSpeechRealStart`), not the first
	 * positive frame: a cough or a key click is a misfire and must not cut a reply.
	 */
	onSpeechStart(): void;
	/** 16 kHz mono samples of the finished utterance. */
	onSpeechEnd(samples: Float32Array): void;
	/** Speech that was too short to count; no take is sent. */
	onMisfire?(): void;
	/**
	 * The microphone stopped delivering after the detector started: the track
	 * ended (unplugged, permission revoked) or its device went away.
	 */
	onMicrophoneLost(): void;
};

export type VadFactory = (
	callbacks: VadCallbacks,
) => Promise<VoiceActivityDetector>;

export type VadControllerDeps = {
	createVad: VadFactory;
	sendTake(wav: Uint8Array): void;
	sendVad(kind: VadEventKind): void;
	/** Whether a reply is audible right now. */
	isPlaying(): boolean;
	/** Stop playback and drop the schedule (barge-in). */
	stopPlayback(): void;
};

/**
 * Turns detector events into the page's upward messages, plus barge-in: a
 * `speech_start` while a reply plays stops it. A `speech_end` becomes one WAV
 * take. After `close()` nothing is sent, so a late event from a torn-down
 * detector cannot leak audio.
 *
 * It is also the page's only proof of life: `ready` goes up once the detector
 * has STARTED (a live microphone, the model loaded), and `failed` when it never
 * does or the microphone is lost later, so main never says "Listening" for a
 * page that is deaf.
 */
export class VadController {
	private readonly deps: VadControllerDeps;
	private vad: VoiceActivityDetector | null = null;
	private closed = false;
	private failedSent = false;
	/** A `speech_start` went up and has not yet ended or been cancelled. */
	private announced = false;

	constructor(deps: VadControllerDeps) {
		this.deps = deps;
	}

	async start(): Promise<void> {
		if (this.vad || this.closed) return;
		let vad: VoiceActivityDetector;
		try {
			vad = await this.deps.createVad({
				onSpeechStart: () => {
					if (this.closed) return;
					if (this.deps.isPlaying()) this.deps.stopPlayback();
					this.announced = true;
					this.deps.sendVad("speech_start");
				},
				onSpeechEnd: (samples) => {
					if (this.closed) return;
					this.announced = false;
					this.deps.sendVad("speech_end");
					this.deps.sendTake(encodeWav(samples));
				},
				onMisfire: () => {
					// Only a start main heard needs undoing; otherwise it would clear
					// a "Speaking" state this misfire has nothing to do with.
					if (this.closed || !this.announced) return;
					this.announced = false;
					this.deps.sendVad("speech_cancel");
				},
				onMicrophoneLost: () => this.fail(),
			});
		} catch (error) {
			this.fail();
			throw error;
		}
		if (this.closed) {
			await vad.destroy();
			return;
		}
		this.vad = vad;
		try {
			await vad.start();
		} catch (error) {
			this.fail();
			throw error;
		}
		if (!this.closed && !this.failedSent) this.deps.sendVad("ready");
	}

	async close(): Promise<void> {
		this.closed = true;
		const vad = this.vad;
		this.vad = null;
		await vad?.destroy();
	}

	/** One `failed` per page: main closes it on the first. */
	private fail(): void {
		if (this.closed || this.failedSent) return;
		this.failedSent = true;
		this.deps.sendVad("failed");
	}
}
