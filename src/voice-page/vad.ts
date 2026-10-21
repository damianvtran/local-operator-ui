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
	onSpeechStart(): void;
	/** 16 kHz mono samples of the finished utterance. */
	onSpeechEnd(samples: Float32Array): void;
	/** Speech that was too short to count; nothing is sent. */
	onMisfire?(): void;
};

export type VadFactory = (
	callbacks: VadCallbacks,
) => Promise<VoiceActivityDetector>;

export type VadControllerDeps = {
	createVad: VadFactory;
	sendTake(wav: Uint8Array): void;
	/** Local mode: the raw 16 kHz samples go to the listener instead of a WAV up. */
	onUtterance?(samples: Float32Array): void;
	sendVad(kind: VadEventKind): void;
	/** Whether a reply is audible right now. */
	isPlaying(): boolean;
	/** Stop playback and drop the schedule (barge-in). */
	stopPlayback(): void;
};

/**
 * Turns detector events into the page's two upward messages, plus barge-in: a
 * `speech_start` while a reply plays stops it. A `speech_end` becomes one WAV
 * take. After `close()` nothing is sent, so a late event from a torn-down
 * detector cannot leak audio.
 */
export class VadController {
	private readonly deps: VadControllerDeps;
	private vad: VoiceActivityDetector | null = null;
	private closed = false;

	constructor(deps: VadControllerDeps) {
		this.deps = deps;
	}

	async start(): Promise<void> {
		if (this.vad || this.closed) return;
		const vad = await this.deps.createVad({
			onSpeechStart: () => {
				if (this.closed) return;
				if (this.deps.isPlaying()) this.deps.stopPlayback();
				this.deps.sendVad("speech_start");
			},
			onSpeechEnd: (samples) => {
				if (this.closed) return;
				this.deps.sendVad("speech_end");
				if (this.deps.onUtterance) this.deps.onUtterance(samples);
				else this.deps.sendTake(encodeWav(samples));
			},
		});
		if (this.closed) {
			await vad.destroy();
			return;
		}
		this.vad = vad;
		await vad.start();
	}

	async close(): Promise<void> {
		this.closed = true;
		const vad = this.vad;
		this.vad = null;
		await vad?.destroy();
	}
}
