/**
 * The byte log: every byte a surface's pty emitted, in order.
 *
 * Design: docs/design/ui-console-tab.md 7.1 (three representations; the byte log
 * is the only lossless one and is what makes closed-pane reopen and offscreen
 * capture correct), 7.2 (the caps), 10.3 (replay-then-stream, `from_byte`).
 *
 * WHY A LOG AND NOT A SNAPSHOT. The terminal of record is a rendered grid, and a
 * grid is lossy in exactly the way that breaks the two features this design
 * promises: a pane that remounts mid-stream replays the bytes it missed, and a
 * surface whose pane was never opened can still be reconstructed. cmux's own
 * durability note says its history is "recoverable visually from a snapshot but
 * not as exact historical records"; here there is always a tap, because main is
 * the pty's only reader, so the log is exact.
 *
 * THE TWO NUMBERS, and what each is load-bearing for:
 *
 *  - `RETAIN_BYTES` (4 MiB) is the REPLAY WINDOW. A trim leaves at least this
 *    many of the newest bytes, so a subscriber that reconnects per the design's
 *    two-step replay never finds its own offset older than the window.
 *  - `CEILING_BYTES` (16 MiB) is the HARD BOUND on one surface's memory. A trim
 *    happens when an append would cross it, and drops back to `RETAIN_BYTES`
 *    rather than shaving one chunk per append: a per-byte trim copies the whole
 *    window on every byte, which at pty rates is the difference between a log
 *    and a memcpy loop. The cost of the amortised shape is that a surface may
 *    hold more than the 4 MiB window between trims — bounded, reported through
 *    `truncated`, and strictly better for a reader, since it is more history and
 *    not less.
 *
 * ABSOLUTE OFFSETS, not buffer indices. `startOffset`/`endOffset` count bytes
 * since the surface was created, so `from_byte` on the wire means the same thing
 * across a trim, a pane remount and a reconnect. `read(from)` reports whether the
 * caller asked for bytes that are already gone, which is what `console_read`'s
 * scrollback copy uses to say "showing the last N lines; earlier output was
 * dropped" instead of pretending completeness.
 *
 * APPEND-PER-READ, never a batch. Coalescing is a concern of the *delivery* path
 * (the push channel may batch frames); the log appends exactly what it was given,
 * because a log that batched would make `from_byte` a lie.
 */

/** The replay window: a trim never leaves fewer retained bytes than this. */
export const RETAIN_BYTES = 4 * 1024 * 1024;

/** The hard ceiling on one surface's log, and the point a trim is triggered. */
export const CEILING_BYTES = 16 * 1024 * 1024;

/** A slice of the log, with the offsets it actually covers. */
export interface ByteLogSlice {
	bytes: Uint8Array;
	/** Absolute offset of `bytes[0]`. */
	from: number;
	/** Absolute offset just past the last byte in `bytes`. */
	to: number;
	/**
	 * Whether any byte the caller asked for was already dropped. False for a read
	 * that starts at or after `startOffset`, and for a read of a log that has
	 * never trimmed.
	 */
	truncated: boolean;
}

interface LogChunk {
	/** Absolute offset of this chunk's first byte. */
	offset: number;
	bytes: Uint8Array;
}

export interface ByteLogOptions {
	retainBytes?: number;
	ceilingBytes?: number;
}

export class ByteLog {
	private readonly retainBytes: number;
	private readonly ceilingBytes: number;
	/** Oldest first. Chunks are the pty's own reads, so a trim drops many bytes at
	 * once without copying the ones it keeps. */
	private chunks: LogChunk[] = [];
	private retained = 0;
	/** Absolute offset just past the last byte ever appended. */
	private end = 0;
	/** Absolute offset of the oldest retained byte. */
	private start = 0;
	private dropped = 0;

	constructor(options: ByteLogOptions = {}) {
		this.retainBytes = options.retainBytes ?? RETAIN_BYTES;
		this.ceilingBytes = options.ceilingBytes ?? CEILING_BYTES;
		if (this.ceilingBytes < this.retainBytes) {
			throw new Error(
				"a byte log's ceiling must not be below its retained window",
			);
		}
	}

	/** Absolute offset of the oldest retained byte. */
	get startOffset(): number {
		return this.start;
	}

	/** Absolute offset just past the newest byte. */
	get endOffset(): number {
		return this.end;
	}

	/** How many bytes are held right now. */
	get retainedBytes(): number {
		return this.retained;
	}

	/** Whether any byte has ever been dropped, i.e. the log is not complete. */
	get truncated(): boolean {
		return this.dropped > 0;
	}

	/** How many bytes have been dropped since the surface was created. */
	get droppedBytes(): number {
		return this.dropped;
	}

	append(bytes: Uint8Array): void {
		if (bytes.length === 0) return;
		// A copy, not a view: the pty hands over a Buffer it may reuse, and the log
		// outlives the callback it arrived in.
		const copy = Uint8Array.from(bytes);
		this.chunks.push({ offset: this.end, bytes: copy });
		this.retained += copy.length;
		this.end += copy.length;
		this.trim(copy.length);
	}

	/**
	 * Read the retained bytes from `from` onward.
	 *
	 * A `from` below `startOffset` is answered with the retained window and
	 * `truncated: true` rather than an error: the caller asked "everything since
	 * N", and the honest answer is "everything since N is gone; here is the rest".
	 */
	read(from = 0): ByteLogSlice {
		const wanted = Math.max(Math.trunc(from) || 0, 0);
		const first = Math.max(wanted, this.start);
		const startIndex = Math.min(first, this.end);
		const length = Math.max(this.end - startIndex, 0);
		const out = new Uint8Array(length);
		let written = 0;
		for (const chunk of this.chunks) {
			const chunkEnd = chunk.offset + chunk.bytes.length;
			if (chunkEnd <= startIndex) continue;
			const skip = Math.max(startIndex - chunk.offset, 0);
			const slice = chunk.bytes.subarray(skip);
			out.set(slice, written);
			written += slice.length;
		}
		return {
			bytes: out,
			from: startIndex,
			to: this.end,
			truncated: wanted < this.start,
		};
	}

	/** Empty the log (a surface whose session was deleted). */
	clear(): void {
		// Counted as dropped rather than forgotten: the log's contract is that
		// `truncated` means "this log is not the whole history", and a cleared log is
		// the extreme of that rather than a log that never had history.
		this.dropped += this.retained;
		this.chunks = [];
		this.retained = 0;
		this.start = this.end;
	}

	/**
	 * Drop the oldest bytes so the next append cannot cross the ceiling.
	 *
	 * Called with the size of the append that just landed, so a single append
	 * larger than the whole ceiling is handled by the same rule: whatever the size
	 * of the newest bytes, at least the newest `retainBytes` survive, so a reader
	 * always has a window rather than an empty log.
	 */
	private trim(newestChunkBytes: number): void {
		if (this.retained <= this.ceilingBytes) return;
		// The newest bytes are kept whatever they cost: `retainBytes` is the window a
		// subscriber replays from, and dropping below it would make `from_byte`
		// unresolvable for a caller that is exactly one chunk behind.
		const keep = Math.max(this.retainBytes, newestChunkBytes);
		while (this.chunks.length > 1 && this.retained > keep) {
			const oldest = this.chunks[0];
			// Never drop the newest chunk, even when it alone exceeds `keep`.
			if (this.retained - oldest.bytes.length < keep) break;
			this.chunks.shift();
			this.retained -= oldest.bytes.length;
			this.start = oldest.offset + oldest.bytes.length;
			this.dropped += oldest.bytes.length;
		}
		if (this.chunks.length === 1 && this.retained > this.ceilingBytes) {
			// One append larger than the ceiling: keep its tail so the window is
			// still non-empty and still the newest bytes.
			const only = this.chunks[0];
			const kept = only.bytes.subarray(only.bytes.length - keep);
			this.dropped += only.bytes.length - kept.length;
			this.start = only.offset + (only.bytes.length - kept.length);
			this.chunks = [{ offset: this.start, bytes: Uint8Array.from(kept) }];
			this.retained = kept.length;
		}
	}
}
