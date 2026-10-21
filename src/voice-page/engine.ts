/**
 * The provider seam (local-voice plan S2), shared with the Groq variant: the
 * coordinator speaks to a `Listener` and a `Speaker`, and which engine sits
 * behind them is the provider. Nothing here imports a runtime.
 */
export interface Listener {
	/** 16 kHz mono samples of one finished utterance -> its text. */
	transcribe(samples: Float32Array): Promise<string>;
}

export interface Speaker {
	synthesize(text: string): Promise<{ samples: Float32Array; rate: number }>;
}

export type VoiceProvider = "local" | "cloud";

/** Why an engine refused or failed; the coordinator (S3) maps these to copy. */
export type EngineErrorCode =
	| "audio_too_short"
	| "audio_too_long"
	| "speech_too_slow"
	| "not_started";

export class EngineError extends Error {
	constructor(readonly code: EngineErrorCode) {
		super(code);
		this.name = "EngineError";
	}
}
