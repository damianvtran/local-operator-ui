import { BrowserWindow, type WebContents, ipcMain } from "electron";
import { ConsoleError } from "./errors";

/**
 * The offscreen capture view: a hidden renderer that reconstructs one surface's
 * record and is photographed (design 13.2's second and third rows, 13.3).
 *
 * WHY THIS EXISTS AT ALL. `console_screenshot` has three cases, and only the first
 * is a photograph of something a person can see: a displayed pane is
 * `capturePage` of the app's own window cropped to the pane's rect, an agent-only
 * surface has no pane at all, and a surface restored from history has nothing
 * running. The last two are answered by replaying the record into a renderer that
 * nobody is looking at, and `rendered: "offscreen"` is what keeps that honest:
 * it is a faithful RECONSTRUCTION from the record, not a photograph of a live
 * screen.
 *
 * THE THREE MEASURED TRAPS SHAPE THIS FILE, and each one costs a line of code:
 *
 *  1. A WebGL CANVAS CANNOT BE READ BACK. `toDataURL` on the xterm WebGL canvas
 *     returned a blank PNG, byte-identical with `preserveDrawingBuffer` both ways.
 *     Nothing here reads pixels from a canvas' own bitmap — the capture is a
 *     compositor capture (`capturePage`) — and the page PINS the DOM renderer
 *     (§13.2's third row: it captured correctly on the first attempt, which is why
 *     the capture path uses it and the pane does not have to). The page reports
 *     which renderer it ended up with, and `assertDomRenderer` refuses a frame that
 *     would have been blank for a reason nobody could see.
 *  2. THE FIRST FRAME OF A HIDDEN WINDOW CAN BE STALE. Measured: the first capture
 *     came back blank at 9,866 B against 27,869 B for the settled frame. So every
 *     capture asserts a NON-BLANK frame and retries exactly once, and the retry is
 *     part of the contract rather than a hopeful `setTimeout`.
 *  3. A FRAME IS A FUNCTION OF `(record bytes, grid, theme, font, renderer)`, all
 *     pinned, so a retry re-feeds the SAME settled state rather than re-reading a
 *     live surface. That is what makes two captures comparable, which is what makes
 *     a before/after pair evidence at all.
 *
 * WHY A HIDDEN `BrowserWindow` RATHER THAN AN UNATTACHED `WebContentsView` (§13.3's
 * wording, and a reported divergence): a view that is never attached to a window is
 * never laid out and — measured against this Electron — never painted, so there is
 * no frame to photograph. A window with `show: false` satisfies everything the
 * design's sentence is for (nothing is laid out where a user can see it, nothing is
 * focused, nothing can be raised) and is the same configuration trap 2 above was
 * measured on, which is why its staleness is a known quantity here.
 *
 * ONE AT A TIME, APP-WIDE. Each capture view is a renderer process, so its cost is
 * real: a second concurrent request is refused with `console_capture_full` — cmux's
 * `input_queue_full` honesty, applied to this resource — rather than queued, because
 * a queue would hold a tool call open behind an unbounded predecessor.
 */

/** How long the view survives after a capture before it is reaped. The design's
 * 30 s: a caller that captures twice in a row pays one launch, and nothing lingers
 * for a session that has stopped asking. */
const DEFAULT_IDLE_MS = 30_000;

/**
 * How long main waits for the page to say it has painted. Bounded so a wedged
 * renderer cannot hold a tool call open; a tripped bound is a typed refusal.
 *
 * IT IS A COLD-RENDERER BOOT BUDGET, NOT A PAINT DEADLINE, and 30 s is what that
 * measurement supports. The wait covers a whole new process: a `BrowserWindow` is
 * constructed, its document loads, React mounts and xterm boots and measures — then
 * the feed is written and two animation frames elapse. Nothing in that chain is
 * warm on the first call, and none of it is the app's own window's work.
 *
 * MEASURED, and the reason this number is not 8 s: on this machine at a fleet load
 * of ~200 (the repo is worked through ~20 concurrent worktrees), an 8 s bound fired
 * on the FIRST capture — `the capture view did not report console-capture-settled
 * within 8000 ms`, with the app and its console host otherwise healthy and 19 of the
 * live rig's other cells already passing. A bound that trips on a busy machine is a
 * bound that reports a product failure where there is only a queue, which is the one
 * thing a typed refusal must not do. The 30 s idle window that reaps the view is the
 * floor this cannot exceed and stay coherent, so it lands there.
 */
const SETTLE_TIMEOUT_MS = 30_000;

/**
 * What "this frame is blank" means, in PIXELS rather than in PNG bytes (Q-7, Q-6).
 *
 * The byte floor that used to stand here was content-dependent, and QA round 2 measured
 * how badly: sweeping `seq 1 N` at 100x30 with no pane, N=1 came back 6,931 B and was
 * REFUSED, N=4 8,505 B refused, N=8 10,825 B refused, N=16 16,186 B accepted — and a bare
 * prompt was refused at 9,655 B, which the app's own log called "came back blank". A small
 * output is the COMMON case for an agent looking at a TUI, and any console showing less
 * than about a screenful could not be photographed offscreen at all. The floor was
 * measuring how much text a program had printed, not whether the capture worked.
 *
 * Two questions replace it, and both are about the picture:
 *
 *  - `MIN_CONTENT_DISTINCT_COLOURS` catches the frame that is one or two solid fields —
 *    the genuinely blank capture (1 colour: measured, 1 distinct colour and 0 of 427,200
 *    sampled pixels off background) AND the two-solid-band glyph-free frame QA round 2
 *    measured passing at 4,417-5,628 B (Q-6). A rendered terminal is never a flat field:
 *    the measured offscreen frame for a live surface carried 252 distinct colours, and the
 *    threshold of 8 sits two orders of magnitude below that and well above the bands.
 *  - `MIN_CONTENT_PIXELS` catches the speck: a handful of pixels that differ from the
 *    frame's ground is not a screenshot of anything, whatever its palette.
 *
 * Both must hold. The reference is the frame's FIRST pixel, which for a terminal is the
 * pane's ground — the same reference the blank-frame measurement above used.
 */
const MIN_CONTENT_DISTINCT_COLOURS = 8;
const MIN_CONTENT_PIXELS = 32;

/** How long to wait before re-capturing a frame that came back blank. */
const RETRY_DELAY_MS = 120;

export interface ConsoleCaptureRequest {
	surface: string;
	cols: number;
	rows: number;
	/** The theme the pane last reported, so the reconstruction is the same
	 * function of its inputs as the pane's own paint. `null` keeps the document's
	 * current theme. */
	theme: string | null;
	/** The record's retained bytes, in order. */
	bytes: Uint8Array;
}

export interface ConsoleCaptureResult {
	png: Buffer;
	/** Which renderer painted: `dom` is the pinned one. Reported rather than
	 * assumed, because a silent switch to WebGL would turn every offscreen frame
	 * blank. */
	renderer: string;
	attempts: number;
}

export interface ConsoleCaptureOptions {
	/** The capture page's URL: the renderer's own `console-capture.html`, in the
	 * dev server or in the packaged bundle. */
	url: string;
	/** The preload every renderer gets, so the page can be fed at all. */
	preload: string;
	log: (message: string) => void;
	idleMs?: number;
}

/** The payload the page settles with. */
interface CaptureSettledReport {
	renderer?: unknown;
}

export class ConsoleCaptureView {
	private window: BrowserWindow | null = null;
	private busy = false;
	private reapTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly options: ConsoleCaptureOptions) {}

	/** Whether a capture is in flight right now, for the refusal's own message. */
	get inFlight(): boolean {
		return this.busy;
	}

	async capture(request: ConsoleCaptureRequest): Promise<ConsoleCaptureResult> {
		if (this.busy) {
			throw new ConsoleError(
				"console_capture_full",
				"a console capture is already running; one capture view exists at a time",
				{ surface: request.surface },
			);
		}
		this.busy = true;
		try {
			const window = await this.ensureWindow();
			return await this.feed(window.webContents, request);
		} finally {
			this.busy = false;
		}
	}

	/** Release the view now. Called on quit, and by the idle timer. */
	dispose(): void {
		if (this.reapTimer) {
			clearTimeout(this.reapTimer);
			this.reapTimer = null;
		}
		const window = this.window;
		this.window = null;
		if (window && !window.isDestroyed()) window.destroy();
	}

	/**
	 * Create the view if it is not up, and hand back its window.
	 *
	 * The size is a placeholder: the page measures its own cell and the window is
	 * resized to the grid before the bytes are fed, because the frame's determinism
	 * depends on the grid being the record's rather than on the window's default.
	 */
	private async ensureWindow(): Promise<BrowserWindow> {
		if (this.reapTimer) {
			clearTimeout(this.reapTimer);
			this.reapTimer = null;
		}
		if (this.window && !this.window.isDestroyed()) return this.window;
		const window = new BrowserWindow({
			// `show: false` and `paintWhenInitiallyHidden` (Electron's default) is the
			// measured-working pair: the page paints so there is a frame to capture,
			// and nothing is ever presented, focused or raised - which is the whole
			// requirement the design states for the capture view.
			show: false,
			width: 1000,
			height: 600,
			webPreferences: {
				preload: this.options.preload,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false,
				// The reconstruction is unattended and single-shot: a throttled
				// background renderer would make the settle wait a matter of luck.
				backgroundThrottling: false,
			},
		});
		this.window = window;
		/*
		 * THE VIEW'S OWN CONSOLE, FORWARDED INTO MAIN'S LOG (QA round 1, Q-4).
		 *
		 * The capture view is invisible by construction — `show: false`, not on the
		 * app's debugging port — so a warning it emits reaches nobody: the design
		 * round's whole point about an unknown theme was that it must be LOUD, and the
		 * loud half was unverifiable because the only place it could be seen was a
		 * renderer nobody can read. One line here puts it in the app log, which is the
		 * channel a person and a rig both already read.
		 *
		 * WARNINGS AND ERRORS ONLY: this is the app's log, and a renderer's info-level
		 * chatter is not a diagnostic. Both current and previous Electron shapes are
		 * accepted — newer versions pass a single event object with the fields on it
		 * and warn that the positional arguments are deprecated, so the positional form
		 * is the fallback rather than the primary.
		 */
		window.webContents.on("console-message", (...args: unknown[]) => {
			const event = args[0] as
				| { level?: string | number; message?: string }
				| undefined;
			const level = event?.level ?? (args[1] as string | number | undefined);
			const message =
				(typeof event?.message === "string" ? event.message : undefined) ??
				(typeof args[2] === "string" ? (args[2] as string) : undefined) ??
				"";
			const severity = String(level ?? "info").toLowerCase();
			if (severity !== "warning" && severity !== "error" && severity !== "2") {
				return;
			}
			this.options.log(`[console] capture view: ${message}`);
		});
		await window.loadURL(this.options.url);
		/*
		 * THE MEASUREMENT HANDSHAKE, once per window rather than once per attempt.
		 *
		 * The page owns the cell metrics, because it owns the font: main has no way to
		 * measure a face, and the frame is a function of (bytes, grid, theme, font,
		 * renderer), so the grid's pixel size has to come from the same place the
		 * glyphs do. Cached for the life of the view - a second capture in the idle
		 * window pays neither the launch nor the measurement.
		 */
		const measured = await waitForCapture(
			window.webContents,
			"console-capture-measured",
			() => window.webContents.send("console-capture-measure"),
		);
		this.cellWidth = numberOr(measured.cellWidth, 8);
		this.cellHeight = numberOr(measured.cellHeight, 16);
		return window;
	}

	private cellWidth = 8;
	private cellHeight = 16;

	/**
	 * THE FEED'S IDENTITY, and it is what makes the frame a function of the record (Q-11).
	 *
	 * The capture page remounts the mirror on this number, which is the whole of the
	 * reconstruction's determinism: the page's terminal is built from a record, so a SECOND
	 * feed must start from a fresh terminal rather than write into the first one's. A number
	 * that identifies the ATTEMPT (`1`, then `2` on a retry) is not an identity across
	 * requests — it repeats — so the page never remounted and the new bytes were appended to
	 * the old grid. QA measured what that produced: a 1-line surface captured after an 8-line
	 * one came back as both (212 rows = 192 + 20), a repeat capture appended again (232), and
	 * three different surfaces — one of them with an empty record — returned BYTE-IDENTICAL
	 * frames. Main is the only authority for a surface (§3(a)), and this counter is how the
	 * mirror is told which one it is looking at.
	 */
	private feedSeq = 0;

	/**
	 * Feed one surface's record, wait for the page to paint, and photograph it.
	 *
	 * Two attempts at most, and the SECOND attempt re-feeds the same bytes rather
	 * than capturing again: a stale first frame is a paint that had not landed, but a
	 * frame that is still blank after a re-feed is a real failure and is reported as
	 * one instead of being retried until it works.
	 */
	private async feed(
		contents: WebContents,
		request: ConsoleCaptureRequest,
	): Promise<ConsoleCaptureResult> {
		// The window is sized to the GRID BEFORE the bytes arrive: the frame's
		// determinism is "the record at this grid", not "whatever size the last
		// capture left behind". `setContentSize` rather than `setSize` because the
		// frame's extent is the terminal's and this window shows no title bar.
		const window = this.window;
		if (window && !window.isDestroyed()) {
			window.setContentSize(
				Math.max(1, Math.round(request.cols * this.cellWidth)),
				Math.max(1, Math.round(request.rows * this.cellHeight)),
			);
		}
		let last = { bytes: 0, renderer: "unknown" };
		for (let attempt = 1; attempt <= 2; attempt++) {
			// One number per FEED, not per attempt: see `feedSeq` above.
			const nonce = (this.feedSeq += 1);
			const settled = await waitForCapture(
				contents,
				"console-capture-settled",
				() =>
					contents.send("console-capture-feed", {
						nonce,
						surface: request.surface,
						cols: request.cols,
						rows: request.rows,
						theme: request.theme,
						bytes_base64: Buffer.from(request.bytes).toString("base64"),
					}),
			);
			const renderer = stringOr(
				(settled as CaptureSettledReport).renderer,
				"unknown",
			);
			// The pin, asserted rather than assumed (§13.3): the capture view exists so a
			// frame can be reconstructed offscreen, and a canvas renderer is the one
			// measured case where that frame is blank.
			if (renderer !== "dom") {
				throw new ConsoleError(
					"capture_unavailable",
					`the capture view painted with the ${renderer} renderer; this path requires the DOM renderer`,
					{ rendered: "offscreen" },
				);
			}
			const image = await contents.capturePage();
			const png = image.toPNG();
			last = { bytes: png.length, renderer };
			/*
			 * A ZERO-BYTE RECORD IS ACCEPTED WITHOUT THE CONTENT GUARD, because the guard is
			 * about a failed PAINT and there is nothing here for a paint to be wrong about:
			 * a surface that has emitted nothing has an empty terminal as its correct frame,
			 * and `hasTerminalContent` cannot tell that frame from a stale one (a fresh
			 * capture view and a stuck one both show the ground). Refusing it would make an
			 * empty surface's screenshot a `capture_unavailable` — a finding of its own —
			 * while the record's own emptiness is already the honest answer to "what is on
			 * this screen". The guard still applies to every record with bytes in it, which
			 * is where Q-6 and Q-7's cases live.
			 */
			const recordIsEmpty = request.bytes.length === 0;
			if (recordIsEmpty || hasTerminalContent(image.toBitmap())) {
				this.scheduleReap();
				this.options.log(
					`[console] captured surface ${request.surface} offscreen at ${request.cols}x${request.rows} (${renderer} renderer, ${png.length} B, attempt ${attempt})`,
				);
				return { png, renderer, attempts: attempt };
			}
			this.options.log(
				`[console] offscreen capture of ${request.surface} came back blank (${png.length} B, attempt ${attempt}); re-feeding the record`,
			);
			await delay(RETRY_DELAY_MS);
		}
		throw new ConsoleError(
			"capture_unavailable",
			`the offscreen capture of this surface produced a blank frame twice (last ${last.bytes} B, renderer ${last.renderer})`,
			{ rendered: "offscreen" },
		);
	}

	/** Reap the view after the idle window, so a session that has stopped capturing
	 * does not keep a renderer process alive for the life of the app. */
	private scheduleReap(): void {
		if (this.reapTimer) clearTimeout(this.reapTimer);
		this.reapTimer = setTimeout(() => {
			this.reapTimer = null;
			const window = this.window;
			this.window = null;
			if (window && !window.isDestroyed()) window.destroy();
		}, this.options.idleMs ?? DEFAULT_IDLE_MS);
	}
}

/**
 * Wait for one named message, and hold the timeout that bounds it.
 *
 * A promise per message rather than a queue: the two messages this protocol has
 * (`measured`, `settled`) are each expected exactly once per attempt, and a
 * listener left behind would answer the NEXT attempt with the previous one's
 * report — the shape of bug that makes a retry silently capture the first frame's
 * size.
 */
const waitForCapture = (
	contents: WebContents,
	channel: string,
	onWaiting: () => void,
): Promise<Record<string, unknown>> =>
	new Promise((resolve, reject) => {
		/*
		 * `ipcMain`, because the capture page ANSWERS on `ipcRenderer.send`: an
		 * answer is a message to the main process, not an event on a webContents.
		 * The sender is checked, and only this view's own webContents is accepted —
		 * the same rule the console's renderer namespace applies to the app's
		 * window, for the same reason: a channel main listens on globally is a
		 * channel any renderer could answer.
		 */
		const listener = (
			event: { sender: WebContents },
			payload: Record<string, unknown>,
		) => {
			if (event.sender !== contents) return;
			clearTimeout(timer);
			ipcMain.removeListener(channel, listener);
			resolve(payload ?? {});
		};
		const timer = setTimeout(() => {
			ipcMain.removeListener(channel, listener);
			reject(
				new ConsoleError(
					"capture_unavailable",
					`the capture view did not report ${channel} within ${SETTLE_TIMEOUT_MS} ms`,
					{ rendered: "offscreen" },
				),
			);
		}, SETTLE_TIMEOUT_MS);
		ipcMain.on(channel, listener);
		onWaiting();
	});

/**
 * Whether a frame carries anything a terminal painted.
 *
 * ONE predicate for both capture paths, which is what keeps them from drifting into
 * disagreeing about what a frame is. The displayed path used to ask only about the frame's
 * SIZE (QA round 1, Q-2): a blank 1600x800 capture is a few kilobytes of one colour, which
 * clears any byte floor comfortably, so the cell certifying "a screenshot is the app's own
 * window, cropped to the pane's rect" was green on a uniform field. The offscreen path had
 * the same weakness from the other side (Q-7): too SMALL was refused, so a live sparse
 * console could not be photographed. `MIN_CONTENT_*` above is the replacement, and this
 * function is where both paths ask it.
 *
 * `getBitmap` is BGRA; alpha counts, because a frame that differs only in alpha is not a
 * terminal either. The scan returns as soon as both thresholds are met — a frame with
 * content costs a few thousand pixels' worth of work, and only a genuinely flat frame is
 * read to the end.
 */
export const hasTerminalContent = (bitmap: Buffer): boolean => {
	if (bitmap.length < 8) return false;
	const first = bitmap.subarray(0, 4);
	const colours = new Set<number>();
	let nonModal = 0;
	for (let i = 0; i + 4 <= bitmap.length; i += 4) {
		colours.add(
			(bitmap[i] << 24) |
				(bitmap[i + 1] << 16) |
				(bitmap[i + 2] << 8) |
				bitmap[i + 3],
		);
		if (
			bitmap[i] !== first[0] ||
			bitmap[i + 1] !== first[1] ||
			bitmap[i + 2] !== first[2] ||
			bitmap[i + 3] !== first[3]
		) {
			nonModal += 1;
		}
		if (
			colours.size >= MIN_CONTENT_DISTINCT_COLOURS &&
			nonModal >= MIN_CONTENT_PIXELS
		) {
			return true;
		}
	}
	return false;
};

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;

const stringOr = (value: unknown, fallback: string): string =>
	typeof value === "string" && value ? value : fallback;

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
