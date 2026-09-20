/**
 * The OSC 133 scanner: the per-command completion signal, read off the surface's
 * own byte stream.
 *
 * Design: docs/design/ui-console-tab.md 12.1 (the completion ladder's rung 2) and
 * 19.2 (what its tests must cover: marks, exit codes, a spoof, and a mark split
 * across chunks). Rung 1 — the process exited — is `node-pty`'s `onExit` and
 * lives with the surface; this scanner exists because a *persistent shell* (the
 * default surface) keeps running for the whole surface's life, so "the command
 * finished" needs a signal the shell itself emits.
 *
 * WHY A BYTE SCAN AND NOT AN EMULATOR FEATURE. The pinned `@xterm/headless`
 * exposes no OSC-133 event, and reaching into its parser would tie the seam of
 * §5.4 to one implementation. A scan over the same bytes the log already keeps is
 * independent of the emulator, survives the seam swap, and is testable against a
 * recorded stream with no terminal at all.
 *
 * WHAT IT CANNOT SEE, stated where the code is rather than only in the doc: the
 * shell must emit prompt marks (bash/zsh need a documented integration snippet,
 * fish emits them natively — whether the operator's shell does is probe P7), and
 * a program can print a 133 sequence itself. The worst case of the latter is one
 * spurious completion blip for that surface, which is the accepted bound — this
 * scanner decides *when to say something finished*, never what may run.
 *
 * THE SPLIT is the bug this class of scanner always has: a pty read can end
 * anywhere, including between `ESC` and `]`, and between `D ; 0` and its
 * terminator. The scanner therefore keeps a bounded partial-sequence state across
 * `feed` calls instead of scanning each chunk independently.
 */

/** The OSC introducer the scanner recognises: `ESC ] 133 ;`. */
const OSC_133_PREFIX = [0x1b, 0x5d, 0x31, 0x33, 0x33, 0x3b] as const;

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;

/** Bytes of `133;<body>` accepted before a sequence is treated as malformed. A
 * legitimate body is a letter and an optional status — anything longer is a
 * different OSC that happened to begin with `133;`, and retaining it would make
 * the scanner's memory a function of a program's output. */
const MAX_BODY_BYTES = 64;

export type Osc133Kind =
	| "prompt-start"
	| "command-start"
	| "output-start"
	| "command-finished";

export interface Osc133Mark {
	kind: Osc133Kind;
	/** The `D;<status>` payload, or null when the shell omitted it or it was not
	 * a number. Only `command-finished` can carry one. */
	exitCode: number | null;
	/** Absolute offset of the sequence's first byte, counted from the first byte
	 * ever fed. It is the same coordinate space as the byte log's offsets when the
	 * two are fed the same stream, which is how a caller can point a notification
	 * at the output that produced it. */
	offset: number;
}

export interface Osc133ScannerOptions {
	maxBodyBytes?: number;
}

const KINDS: Record<string, Osc133Kind> = {
	A: "prompt-start",
	B: "command-start",
	C: "output-start",
	D: "command-finished",
};

export class Osc133Scanner {
	private readonly maxBodyBytes: number;
	/** How much of `OSC_133_PREFIX` has matched, 0 when not inside one. */
	private matched = 0;
	/** The body accumulated since the prefix matched, or null when not inside a
	 * sequence. Kept as a number array because a body is a handful of ASCII bytes. */
	private body: number[] | null = null;
	/** Whether the previous byte was an ESC that may terminate the body. */
	private escaped = false;
	/** Whether the retained body already exceeded `maxBodyBytes`. Such a sequence
	 * is abandoned rather than truncated, so a long non-133 OSC cannot produce a
	 * mark from its tail. */
	private overflowed = false;
	/** Bytes fed so far, i.e. the offset of the next byte. */
	private consumed = 0;
	/** Absolute offset of the sequence currently being read, or null. */
	private sequenceStart: number | null = null;

	constructor(options: Osc133ScannerOptions = {}) {
		this.maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
	}

	/** Absolute offset of the next byte this scanner will be given. */
	get offset(): number {
		return this.consumed;
	}

	feed(bytes: Uint8Array): Osc133Mark[] {
		const marks: Osc133Mark[] = [];
		for (const byte of bytes) {
			const mark = this.step(byte);
			if (mark) marks.push(mark);
			this.consumed += 1;
		}
		return marks;
	}

	/** Forget a partial sequence (called when a surface is reset). The offset is
	 * not rewound: offsets are absolute for the surface's life. */
	reset(): void {
		this.matched = 0;
		this.body = null;
		this.escaped = false;
		this.overflowed = false;
		this.sequenceStart = null;
	}

	private step(byte: number): Osc133Mark | null {
		if (this.body !== null) return this.stepBody(byte);
		if (byte === OSC_133_PREFIX[this.matched]) {
			this.matched += 1;
			if (this.matched === OSC_133_PREFIX.length) {
				this.body = [];
				// The prefix's last byte is the one being examined, so the sequence began
				// `OSC_133_PREFIX.length` bytes back.
				this.sequenceStart = this.consumed - (OSC_133_PREFIX.length - 1);
				this.matched = 0;
				this.escaped = false;
				this.overflowed = false;
			}
			return null;
		}
		// No proper suffix of the prefix is also a prefix of it, so a mismatch
		// restarts the match rather than shifting it — except for a byte that could
		// itself begin one, which is the `ESC` case.
		this.matched = byte === OSC_133_PREFIX[0] ? 1 : 0;
		return null;
	}

	private stepBody(byte: number): Osc133Mark | null {
		if (this.escaped) {
			this.escaped = false;
			if (byte === BACKSLASH) return this.finish();
			// `ESC \` is the string terminator; any other byte after an ESC means this
			// sequence was abandoned — and that ESC can itself begin a new one, so it is
			// re-examined rather than swallowed. (Measured on a real shell's stream:
			// marks arrive back to back, `…133;B` immediately followed by `ESC ] 133;C`,
			// so an ESC that is only an abort would drop the mark after it.)
			this.abandon();
			this.step(ESC);
			return this.step(byte);
		}
		if (byte === BEL) return this.finish();
		if (byte === ESC) {
			this.escaped = true;
			return null;
		}
		if (this.body === null) return null;
		if (this.body.length >= this.maxBodyBytes) {
			this.overflowed = true;
			this.body = null;
			return null;
		}
		this.body.push(byte);
		return null;
	}

	private finish(): Osc133Mark | null {
		const body = this.body;
		const offset = this.sequenceStart ?? 0;
		this.body = null;
		this.escaped = false;
		this.sequenceStart = null;
		if (body === null || this.overflowed) {
			this.overflowed = false;
			return null;
		}
		return parseBody(body, offset);
	}

	private abandon(): void {
		this.body = null;
		this.overflowed = false;
		this.sequenceStart = null;
	}
}

function parseBody(body: number[], offset: number): Osc133Mark | null {
	const text = String.fromCharCode(...body);
	const [kind, status] = text.split(";");
	const mapped = KINDS[kind];
	if (!mapped) return null;
	if (status === undefined || status === "") {
		return { kind: mapped, exitCode: null, offset };
	}
	const parsed = Number.parseInt(status, 10);
	const exitCode =
		Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
	return { kind: mapped, exitCode, offset };
}
