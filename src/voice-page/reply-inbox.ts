import type { PlayMessage } from "./channels";

/**
 * Where the voice page holds the segments main has pushed, keyed by reply and
 * index (plan D3). The scheduler pulls from here one segment at a time.
 *
 * Two rules live here because both were bugs when they were loose variables in
 * `main.ts`:
 *  - A pending pull is a one-shot resolver. Aborting it (stop, barge-in) MUST
 *    forget it, or the next reply's first segment is handed to the dead
 *    resolver and lost, and playback then waits on segment 0 forever.
 *  - A segment only counts if its `replyId` is the current reply. A stop
 *    retires the reply's id, so a segment still in flight from main after the
 *    stop is dropped instead of starting playback of a reply nobody wants.
 */
export class ReplyInbox {
	private replyId: string | null = null;
	private readonly retired = new Set<string>();
	private segments = new Map<number, Uint8Array>();
	private lastIndex: number | null = null;
	private waiter: {
		index: number;
		resolve(bytes: Uint8Array | null): void;
	} | null = null;

	/**
	 * Offer a message. `fresh` means it opened a new reply (the caller restarts
	 * playback); `accepted` false means it was stale and was dropped.
	 */
	push(message: PlayMessage): { accepted: boolean; fresh: boolean } {
		const { replyId, index } = message.id;
		const { bytes, last } = message;
		if (this.retired.has(replyId)) return { accepted: false, fresh: false };
		let fresh = false;
		if (replyId !== this.replyId) {
			// A new reply resets everything the old one left behind.
			this.reset();
			this.replyId = replyId;
			fresh = true;
		}
		if (last) this.lastIndex = index;
		if (this.waiter && this.waiter.index === index) {
			const { resolve } = this.waiter;
			this.waiter = null;
			resolve(bytes);
		} else this.segments.set(index, bytes);
		return { accepted: true, fresh };
	}

	/** The scheduler's `fetchSegment`: bytes for `index`, or null at the end. */
	pull(index: number, signal: AbortSignal): Promise<Uint8Array | null> {
		return new Promise((resolve) => {
			const ready = this.segments.get(index);
			if (ready) {
				this.segments.delete(index);
				return resolve(ready);
			}
			if (this.lastIndex !== null && index > this.lastIndex)
				return resolve(null);
			const waiter = { index, resolve };
			this.waiter = waiter;
			signal.addEventListener("abort", () => {
				// Only forget it if it is still the pending one.
				if (this.waiter === waiter) this.waiter = null;
				resolve(null);
			});
		});
	}

	/**
	 * The reply ends early at `lastIndex` (-1: nothing was made). Used when a
	 * later segment cannot be synthesized, so the schedule drains instead of
	 * waiting for audio that will never come.
	 */
	end(replyId: string, lastIndex: number): void {
		if (replyId !== this.replyId) return;
		this.lastIndex = lastIndex;
		if (this.waiter && this.waiter.index > lastIndex) {
			const { resolve } = this.waiter;
			this.waiter = null;
			resolve(null);
		}
	}

	/** Stop or barge-in: drop the reply and refuse its late segments. */
	stop(): void {
		this.retire();
		this.reset();
	}

	/** The reply played to its end; its id is spent. */
	drained(): void {
		this.retire();
		this.reset();
	}

	private retire(): void {
		if (this.replyId !== null) this.retired.add(this.replyId);
		this.replyId = null;
	}

	private reset(): void {
		this.segments = new Map();
		this.lastIndex = null;
		// Release a pending pull rather than leaving it to eat the next bytes.
		const waiter = this.waiter;
		this.waiter = null;
		waiter?.resolve(null);
	}
}
