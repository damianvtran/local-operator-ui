import type { Speaker } from "./engine";
import { EngineError } from "./engine";
import { encodeWav } from "./wav";

export type LocalReplyDeps = {
	speaker: Speaker;
	/** Hand one segment's WAV to the inbox. */
	push(index: number, wav: Uint8Array, last: boolean): void;
	/** The reply ends at `lastIndex` (-1: nothing was made). */
	end(lastIndex: number): void;
	/** The speaker is too slow; the verdict bites from the next reply. */
	onTooSlow(): void;
	onError?(error: unknown): void;
};

/**
 * Synthesizes one reply's sentences (L3, L6): segment n+1 is made while n
 * plays, never further ahead, so a barge-in wastes at most one sentence of
 * work. `noteStarted` is the scheduler's "segment n began" and is what lets the
 * next one run. Environment-free: the page supplies Web Audio and the engine.
 */
export class LocalReply {
	private started = -1;
	private wake: (() => void) | null = null;
	private stopped = false;

	constructor(
		private readonly deps: LocalReplyDeps,
		private readonly segments: readonly string[],
	) {}

	noteStarted(index: number): void {
		if (index > this.started) this.started = index;
		this.wake?.();
	}

	stop(): void {
		this.stopped = true;
		this.wake?.();
	}

	async run(): Promise<void> {
		const { segments, deps } = this;
		let made = -1;
		for (let i = 0; i < segments.length; i++) {
			// One ahead: segment i is made once segment i-1 has begun to play.
			while (!this.stopped && i - this.started > 1)
				await new Promise<void>((resolve) => {
					this.wake = resolve;
				});
			this.wake = null;
			if (this.stopped) return;
			let result: { samples: Float32Array; rate: number };
			try {
				result = await deps.speaker.synthesize(segments[i]);
			} catch (error) {
				if (this.stopped) return;
				if (error instanceof EngineError && error.code === "speech_too_slow")
					deps.onTooSlow();
				else deps.onError?.(error);
				break;
			}
			if (this.stopped) return;
			if (result.samples.length === 0) continue;
			const last = i === segments.length - 1;
			made += 1;
			deps.push(made, encodeWav(result.samples, result.rate), last);
		}
		if (!this.stopped) deps.end(made);
	}
}
