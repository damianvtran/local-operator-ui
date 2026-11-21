/**
 * Gap-free segment playback (plan D3). Each segment's WAV is decoded and
 * scheduled on one audio clock at the previous segment's exact end, so there is
 * no element switching to leave a gap.
 *
 * ONE REQUEST AHEAD, NEVER MORE: segment n+1 is fetched only once segment n has
 * begun to play, so an interrupted reply wastes at most one request of the
 * daily quota. A stop aborts the in-flight fetch, stops every source and drops
 * the schedule.
 *
 * Environment-free on purpose: the audio clock, decoding, sources and waiting
 * are injected, so the rules are tested as plain code and the page supplies
 * Web Audio.
 */

export interface ScheduledSource {
	stop(): void;
}

export interface SegmentAudio {
	/** The audio clock, in seconds. */
	readonly currentTime: number;
	/** Decode a segment's bytes; `duration` is in seconds. */
	decode(bytes: Uint8Array): Promise<{ duration: number; buffer: unknown }>;
	/** Start `buffer` at clock time `when`; returns a handle that can stop it. */
	start(buffer: unknown, when: number): ScheduledSource;
	/** Resolve once the clock reaches `time`, or reject if `signal` aborts. */
	waitUntil(time: number, signal: AbortSignal): Promise<void>;
}

export type SegmentSchedulerDeps = {
	audio: SegmentAudio;
	/** Bytes for segment `index`; null when there are no more. */
	fetchSegment(index: number, signal: AbortSignal): Promise<Uint8Array | null>;
	onSegmentStart?(index: number): void;
	/** The last scheduled segment has finished (not called after a stop). */
	onDrained?(): void;
	onError?(error: unknown): void;
};

export class SegmentScheduler {
	private readonly deps: SegmentSchedulerDeps;
	private controller: AbortController | null = null;
	private sources: ScheduledSource[] = [];
	/** Every start time handed to the clock, in order; exposed for tests. */
	readonly startTimes: number[] = [];

	constructor(deps: SegmentSchedulerDeps) {
		this.deps = deps;
	}

	get playing(): boolean {
		return this.controller !== null;
	}

	/** Play a reply from segment 0. A reply already playing is stopped first. */
	async play(): Promise<void> {
		this.stop();
		const controller = new AbortController();
		this.controller = controller;
		const { audio } = this.deps;
		let nextStart = 0;
		let lastEnd = 0;
		try {
			for (let index = 0; ; index += 1) {
				const bytes = await this.deps.fetchSegment(index, controller.signal);
				if (controller.signal.aborted) return;
				if (bytes === null) break;
				const decoded = await audio.decode(bytes);
				if (controller.signal.aborted) return;
				// Contiguous: exactly the previous end, or now if the queue ran dry.
				const when = Math.max(audio.currentTime, nextStart);
				this.sources.push(audio.start(decoded.buffer, when));
				this.startTimes.push(when);
				nextStart = when + decoded.duration;
				lastEnd = nextStart;
				// The one-ahead rule: the next fetch waits for this segment to begin.
				await audio.waitUntil(when, controller.signal);
				if (controller.signal.aborted) return;
				this.deps.onSegmentStart?.(index);
			}
			await audio.waitUntil(lastEnd, controller.signal);
			if (controller.signal.aborted) return;
			this.controller = null;
			this.sources = [];
			this.deps.onDrained?.();
		} catch (error) {
			if (controller.signal.aborted) return;
			this.stop();
			this.deps.onError?.(error);
		}
	}

	/** Abort the fetch, stop every source, forget the schedule. Idempotent. */
	stop(): void {
		const controller = this.controller;
		this.controller = null;
		controller?.abort();
		for (const source of this.sources) source.stop();
		this.sources = [];
		this.startTimes.length = 0;
	}
}
