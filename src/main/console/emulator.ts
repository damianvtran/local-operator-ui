import { Terminal } from "@xterm/headless";

/**
 * The emulator seam, and its one implementation.
 *
 * Design: docs/design/ui-console-tab.md 5.4 (the interface, "swapping the
 * emulator must not touch the surface/registry/protocol layers") and 5.5 (the
 * decision that this seam is what keeps the xterm implementation a swap rather
 * than a rewrite). Nothing outside this file may import an emulator package:
 * the surface layer, the registry and the wire all speak `ConsoleEmulator`.
 *
 * WHAT THE SEAM GUARANTEES, and the one place the design's sketch was not
 * implementable as written: the sketch's `write(bytes): void` implies the grid
 * is readable the moment `write` returns. Measured on the pinned
 * `@xterm/headless@6.0.0`, it is not — `write` queues the bytes and parses them
 * on a later turn, so an immediate `getLine(0).translateToString(true)` returns
 * `""` and the same call after the queue drains returns the text. A host that
 * ignored that would answer `console_read` from a grid one chunk behind, which
 * is exactly the staleness an agent-driven read cannot detect. So the seam
 * carries `whenIdle()`: the pinned implementation settles it from xterm's own
 * `write(data, callback)` completion, and an implementation whose parse is
 * synchronous resolves it immediately.
 *
 * TWO OTHER MEASURED API FACTS about the headless build, because they are where
 * a reader's assumptions about `@xterm/xterm` would mislead:
 *  - there is no `buffer.active.translateToString` — text comes from
 *    `buffer.active.getLine(y).translateToString(trimRight)`, which returns
 *    `undefined` for a line past the buffer's end;
 *  - the package's README states it is experimental and that no official addons
 *    ship for it, so there is no `addon-serialize` here. The design does not
 *    need one (§7.1: replay replaces serialize), and this file must not grow a
 *    dependency on an addon that does not exist for the headless build.
 */

/** The modes the encoder and paste path read, as the design's 5.4 names them. */
export interface ConsoleModes {
	bracketedPaste: boolean;
	applicationCursorKeys: boolean;
	mouseTracking: string;
}

/** Where the cursor is and how much buffer exists, read at one instant. */
export interface ConsoleGridState {
	cols: number;
	rows: number;
	/** Index of the viewport's first row, i.e. how many lines are above it. */
	viewportTop: number;
	/** How many lines the buffer holds (scrollback + viewport). */
	lineCount: number;
	cursor: { x: number; y: number };
	modes: ConsoleModes;
}

/** Which slice of the buffer a read wants. */
export type ConsoleReadMode = "viewport" | "scrollback";

/** A windowed slice of scrollback, for `console_read`'s paging (§13.1). */
export interface ConsoleReadWindow {
	/** Absolute line index to start at. Defaults to the top of the buffer. */
	start?: number;
	/** How many lines to return. Defaults to everything to the viewport's top. */
	count?: number;
}

export interface ConsoleEmulator {
	write(bytes: Uint8Array): void;
	resize(cols: number, rows: number): void;
	text(mode: ConsoleReadMode, window?: ConsoleReadWindow): string;
	readonly grid: ConsoleGridState;
	/** Resolves once everything written so far has been parsed into the grid. */
	whenIdle(): Promise<void>;
	dispose(): void;
}

export interface XtermEmulatorOptions {
	cols: number;
	rows: number;
	/**
	 * Lines of scrollback. 5,000 per the design's §7.2 — five times xterm's own
	 * default, chosen against the 100-column default grid (a line is at most 100
	 * cells, so 5,000 lines is ~500k cells of attributes in the worst case).
	 */
	scrollback: number;
}

/**
 * The pinned implementation: `@xterm/headless`, the same emulator version the
 * pane's mirror uses (B), in the app's main process where R7 needs it — a read
 * with no view present.
 *
 * It owns no policy: no grid clamps, no retention, no pty. Every one of those is
 * a surface-layer decision (§8.1) so a swap of this file cannot change them.
 */
export function createXtermEmulator(
	options: XtermEmulatorOptions,
): ConsoleEmulator {
	// `allowProposedApi` is not optional in practice: `buffer` (and therefore all
	// text reads) is behind the proposed-API gate in the headless build, and
	// without it the first `grid` read throws.
	const terminal = new Terminal({
		cols: options.cols,
		rows: options.rows,
		scrollback: options.scrollback,
		allowProposedApi: true,
	});

	// In-flight writes, so `whenIdle` can await the drain. Counted rather than
	// polled: xterm's `write` callback fires per queued chunk, in order.
	let pending = 0;
	let idle: (() => void) | null = null;

	const settleIfIdle = (): void => {
		if (pending > 0) return;
		const resolve = idle;
		idle = null;
		resolve?.();
	};

	/** The text of one absolute line, or "" past the end of the buffer. */
	const lineText = (index: number): string => {
		const line = terminal.buffer.active.getLine(index);
		return line ? line.translateToString(true) : "";
	};

	const bufferLineCount = (): number => {
		// `length` is the whole buffer: the scrollback plus the viewport. `viewportY`
		// (xterm's `baseY` while the view is at the bottom) is how many of those
		// lines sit above the viewport, which is exactly the scrollback range the
		// design's 13.1 gives `mode: "scrollback"` — 0..baseY.
		return terminal.buffer.active.length;
	};

	return {
		write(bytes: Uint8Array): void {
			pending += 1;
			terminal.write(bytes, () => {
				pending -= 1;
				settleIfIdle();
			});
		},

		resize(cols: number, rows: number): void {
			// xterm throws on a non-integer or non-finite size; the surface layer
			// clamps before calling, so a throw here is a programming error and is
			// deliberately not caught.
			terminal.resize(cols, rows);
		},

		text(mode: ConsoleReadMode, window?: ConsoleReadWindow): string {
			const buffer = terminal.buffer.active;
			const last = bufferLineCount();
			// The viewport is the visible rows; the scrollback is everything above
			// them, which pages from line 0 so an agent can walk history outward from
			// the oldest retained line.
			const first =
				mode === "viewport"
					? Math.min(buffer.viewportY, last)
					: truncateToInt(window?.start ?? 0, 0, last);
			const wanted =
				mode === "viewport"
					? terminal.rows
					: window?.count === undefined
						? Math.max(buffer.viewportY - first, 0)
						: truncateToInt(window.count, 0, last - first);
			const end = Math.min(first + wanted, last);
			const lines: string[] = [];
			for (let index = first; index < end; index += 1) {
				lines.push(lineText(index));
			}
			return lines.join("\n");
		},

		get grid(): ConsoleGridState {
			const buffer = terminal.buffer.active;
			return {
				cols: terminal.cols,
				rows: terminal.rows,
				viewportTop: buffer.viewportY,
				lineCount: bufferLineCount(),
				cursor: { x: buffer.cursorX, y: buffer.cursorY },
				modes: {
					bracketedPaste: terminal.modes.bracketedPasteMode,
					applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
					mouseTracking: terminal.modes.mouseTrackingMode,
				},
			};
		},

		whenIdle(): Promise<void> {
			if (pending === 0) return Promise.resolve();
			return new Promise<void>((resolve) => {
				idle = resolve;
			});
		},

		dispose(): void {
			terminal.dispose();
		},
	};
}

/** Clamp a window bound without letting `NaN` reach a loop condition. */
function truncateToInt(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(Math.max(Math.trunc(value), min), max);
}
