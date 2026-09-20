/**
 * A stand-in for `@xterm/xterm`, for the desktop suite's in-memory bundles.
 *
 * WHY IT EXISTS. The pane's input path — the one line that carries a DOM keystroke
 * to the pty — shipped missing, and nothing in CI noticed because every test of the
 * pane either stubbed the bridge and asserted the projection, or drove the main
 * process. Reproducing a REAL `Terminal` in Node means a DOM, and xterm's renderer
 * needs layout that jsdom does not have: measured while writing this, `term.open()`
 * behind a jsdom document throws inside the renderer before a single event can be
 * dispatched, and a shim thick enough to get past it would be a second renderer to
 * keep in step.
 *
 * SO THIS MODELS THE ONE CONTRACT THE PANE DEPENDS ON, and nothing else: that a
 * terminal emits the bytes a key produces through `onData`, and 8-bit sequences
 * through `onBinary`. The bytes it emits are the ones design §10.5 pins for those
 * keys, and the encoder that really produces them is xterm's own DOM handler — this
 * file does not re-implement it, it *names* the sequences a keystroke yields so a
 * test can assert they reach the bridge unchanged.
 *
 * WHAT IT IS NOT: not a fake of a terminal. It paints nothing, parses nothing and
 * has no buffer. `write`/`resize`/`dispose` are honest no-ops, because the tests
 * that use it are about the WIRE between a keystroke and `api.input`, and the
 * terminal's own correctness is xterm's and is proven by the rendered frames.
 */

/** One keystroke, and the bytes a real xterm emits for it in normal cursor mode. */
export const KEYSTROKE_BYTES: Record<string, string> = {
	a: "a",
	"1": "1",
	Enter: "\r",
	Backspace: "\x7f",
	Tab: "\t",
	Escape: "\x1b",
	ArrowUp: "\x1b[A",
	ArrowDown: "\x1b[B",
	ArrowRight: "\x1b[C",
	ArrowLeft: "\x1b[D",
	Home: "\x1b[H",
	End: "\x1b[F",
	"ctrl+c": "\x03",
};

/** Every terminal this stub has constructed, so a test can drive one. */
export const __terminals: Terminal[] = [];

/*
 * A buffer of the shape the pane's report reads, and no more. It is empty on
 * purpose: the tests here are about the wire between a keystroke and `api.input`,
 * and an empty buffer is the honest value for a terminal the test never writes to.
 * (Written as a plain field rather than a constructor parameter property, because a
 * class field initializer runs BEFORE a parameter property is assigned and the first
 * version of this read `this.lines` while it was still undefined.)
 */
class StubBuffer {
	active = {
		viewportY: 0,
		baseY: 0,
		length: 0,
		getLine() {
			return { translateToString: () => "" };
		},
	};
}

/**
 * The class the component imports as `Terminal`. Named for what it stands in for
 * rather than for what it is, because the import site is what a reader greps for.
 */
export class Terminal {
	cols = 80;
	rows = 24;
	options: Record<string, unknown> = {};
	unicode = { activeVersion: "" as string };
	buffer = new StubBuffer([]);
	readonly written: Uint8Array[] = [];
	readonly resized: Array<{ cols: number; rows: number }> = [];
	readonly addons: unknown[] = [];
	private readonly dataHandlers: Array<(data: string) => void> = [];
	private readonly binaryHandlers: Array<(data: string) => void> = [];
	private disposed = false;

	constructor(options: Record<string, unknown> = {}) {
		this.options = options;
		if (typeof options.cols === "number") this.cols = options.cols;
		if (typeof options.rows === "number") this.rows = options.rows;
		__terminals.push(this);
	}

	loadAddon(addon: unknown): void {
		this.addons.push(addon);
	}
	open(): void {}
	write(data: Uint8Array | string): void {
		this.written.push(
			typeof data === "string" ? new TextEncoder().encode(data) : data,
		);
	}
	resize(cols: number, rows: number): void {
		this.cols = cols;
		this.rows = rows;
		this.resized.push({ cols, rows });
	}
	dispose(): void {
		this.disposed = true;
		this.dataHandlers.length = 0;
		this.binaryHandlers.length = 0;
	}
	focus(): void {}
	refresh(): void {}

	onData(handler: (data: string) => void) {
		this.dataHandlers.push(handler);
		return {
			dispose: () => {
				const i = this.dataHandlers.indexOf(handler);
				if (i >= 0) this.dataHandlers.splice(i, 1);
			},
		};
	}
	onBinary(handler: (data: string) => void) {
		this.binaryHandlers.push(handler);
		return {
			dispose: () => {
				const i = this.binaryHandlers.indexOf(handler);
				if (i >= 0) this.binaryHandlers.splice(i, 1);
			},
		};
	}
	onKey(): { dispose: () => void } {
		return { dispose: () => {} };
	}
	onTitleChange() {
		return { dispose: () => {} };
	}

	/** Whether anything is still listening — a disposed terminal must not be. */
	get listening(): number {
		return this.dataHandlers.length + this.binaryHandlers.length;
	}
	get wasDisposed(): boolean {
		return this.disposed;
	}

	/** One keystroke, exactly as the DOM handler would deliver it. */
	typeKey(key: keyof typeof KEYSTROKE_BYTES | string): void {
		const bytes = KEYSTROKE_BYTES[key] ?? key;
		for (const handler of [...this.dataHandlers]) handler(bytes);
	}

	/** One 8-bit sequence, which is the `onBinary` path. */
	sendBinary(value: string): void {
		for (const handler of [...this.binaryHandlers]) handler(value);
	}
}
