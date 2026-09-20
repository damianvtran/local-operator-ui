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

/** How long main waits for the page to say it has painted. Bounded so a wedged
 * renderer cannot hold a tool call open; a tripped bound is a typed refusal. */
const SETTLE_TIMEOUT_MS = 8_000;

/** The frame's size floor, in bytes, below which a PNG is treated as blank. The
 * design's measurement is the calibration: 9,866 B was the stale frame and 27,869 B
 * the settled one at 100x30, so a floor between them discriminates the case this
 * exists for without asserting anything about content. */
const MIN_FRAME_BYTES = 14_000;

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
			const settled = await waitForCapture(
				contents,
				"console-capture-settled",
				() =>
					contents.send("console-capture-feed", {
						nonce: attempt,
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
			if (png.length >= MIN_FRAME_BYTES && hasVariation(image.toBitmap())) {
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

/** Whether any pixel differs from the first one. `getBitmap` is BGRA and every
 * channel is included: a frame that is uniform in any one of them is not a
 * terminal. */
const hasVariation = (bitmap: Buffer): boolean => {
	if (bitmap.length < 8) return false;
	const first = bitmap.subarray(0, 4);
	for (let i = 4; i + 4 <= bitmap.length; i += 4) {
		if (
			bitmap[i] !== first[0] ||
			bitmap[i + 1] !== first[1] ||
			bitmap[i + 2] !== first[2] ||
			bitmap[i + 3] !== first[3]
		)
			return true;
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
