/**
 * Live display bridge for a browser page that an app overlay has suppressed.
 *
 * WHY THIS EXISTS. The page is a native `WebContentsView`, and Electron paints a
 * window's own web contents (the shell DOM) BEFORE its `contentView` children,
 * so a presented page covers every dialog, menu and popover the shell draws. The
 * registry therefore detaches the active view while an overlay is open
 * (`TabRegistry.hiddenByOverlay`, `view-presentation.ts`), and the shell used to
 * show a "Paused while a dialog… is open" note in its place. The operator asked
 * for the page to keep rendering underneath instead.
 *
 * HOW. A detached, hidden view is still composited while its owner window is
 * shown: an Electron 45.1.0 spike (shown-inactive owner) received 71 full frames
 * with 71 distinct pixel hashes in 2.5 s from a hidden+detached view, median gap
 * 31.8 ms, max 108.7 ms, with the page viewport (800x450) and resize count
 * unchanged. This controller subscribes to those frames in main and forwards
 * them to the owning shell, which paints them into a display-only canvas in the
 * content rect, beneath the overlay. Nothing about the overlay policy, the
 * view's bounds or input ownership changes: the composite is a picture.
 *
 * CONSTRAINTS, each load-bearing:
 * - FULL FRAMES ONLY (`beginFrameSubscription(false, …)`). `onlyDirty = true`
 *   delivers patches; the backpressure below drops frames, and dropping a patch
 *   would corrupt the picture until the next full repaint.
 * - SUBSCRIBE BEFORE DETACH. `sync()` runs at the top of every registry layout
 *   pass (`TabRegistry`'s `onBeforeLayout`), while the view is still attached and
 *   visible, so the compositor has a live sink when presentation is withdrawn.
 * - BACKPRESSURE, NOT A TIMER: at most one frame in flight to the renderer plus
 *   one replaceable latest frame. The renderer ACKs after drawing; the next send
 *   waits for that ACK. No FPS cap and no capture timer — the stream runs exactly
 *   as fast as the renderer can draw and never queues.
 * - IDENTITY: every frame carries {generation, tabId, webContentsId,
 *   documentEpoch, frameSeq, width, height}. Any eligibility change (overlay
 *   closed, tab switched, rect moved, navigation, crash, close, consumer reset,
 *   host stop) ends the generation and sends a CLEAR, so a stale frame can never
 *   be shown as live. ACKs for any frame other than the one in flight in the
 *   current generation are refused (stale, duplicate or forged). The CLEAR's
 *   `reason` lets the renderer pick what the gap looks like: "resized" (same
 *   tab and document, only the rect moved) may keep the last picture; every
 *   other reason must drop it.
 * - THE SUBSCRIPTION DOES NOT WAIT FOR A CONSUMER. Skipping it until the canvas
 *   registers was considered (review F1) and rejected: the consumer's IPC can
 *   land after the layout pass that detaches the view, which would break
 *   SUBSCRIBE BEFORE DETACH. Frames that arrive with no consumer only replace
 *   `latest` (a reference, no pixel copy), so waiting would save nothing on
 *   main's thread.
 * - HEADLESS COMPOSITES NOTHING: a never-shown window is never composited
 *   (`address-overlay.ts`), so a headless launch receives zero frames and the
 *   renderer keeps its honest paused note. That is expected, not a bug.
 * - PRIVACY: pixels go ONLY to the owner shell's webContents through `target`.
 *   They are never logged, persisted, projected, captured or sent to any other
 *   window, and every buffer is dropped on teardown.
 *
 * Written against narrow structural interfaces so its logic is unit-testable
 * without Electron (`scripts/browser-composite-bridge.test.mjs`).
 */

/** Main → owner shell: one full composited frame. */
export const BROWSER_COMPOSITE_FRAME = "browser-composite-frame";
/** Main → owner shell: drop whatever is drawn; the generation ended. */
export const BROWSER_COMPOSITE_CLEAR = "browser-composite-clear";

/** The subset of a `NativeImage` this controller reads. */
export interface CompositeImage {
	isEmpty(): boolean;
	getSize(): { width: number; height: number };
	/** Raw pixels in the platform's native order (BGRA on macOS/Windows). */
	toBitmap(): Uint8Array;
}

/** The subset of a page's `webContents` this controller drives. */
export interface CompositeSource {
	readonly id: number;
	isDestroyed(): boolean;
	beginFrameSubscription(
		onlyDirty: boolean,
		callback: (image: CompositeImage) => void,
	): void;
	endFrameSubscription(): void;
	/** Asks the compositor for a repaint so a static page produces a first frame. */
	invalidate?(): void;
	on(event: string, listener: (...args: never[]) => void): unknown;
	removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

/** The owner shell's `webContents`: the ONLY place pixels are sent. */
export interface CompositeTarget {
	isDestroyed(): boolean;
	send(channel: string, payload: unknown): void;
}

/** What the registry says right now about the one tab that may be composited. */
export interface CompositeEligibility {
	tabId: number;
	source: CompositeSource;
	documentEpoch: number;
	rect: { x: number; y: number; width: number; height: number };
}

export interface CompositeFrame {
	generation: number;
	tabId: number;
	webContentsId: number;
	documentEpoch: number;
	frameSeq: number;
	width: number;
	height: number;
	/** BGRA, `width * height * 4` bytes. */
	pixels: Uint8Array;
}

export interface CompositeClear {
	generation: number;
	reason: string;
}

export interface CompositeBridgeOptions {
	/**
	 * The composite target, or null when nothing may be composited: no active tab,
	 * the view is presented, the hide is the browser's own state page or a route
	 * teardown. The host answers this from `TabRegistry.hiddenByOverlay`.
	 */
	eligible: () => CompositeEligibility | null;
	/** The owner shell, or null once its window is gone. */
	target: () => CompositeTarget | null;
	log?: (message: string) => void;
}

interface Stream {
	generation: number;
	tabId: number;
	source: CompositeSource;
	webContentsId: number;
	documentEpoch: number;
	rectKey: string;
	nextSeq: number;
	/** The frame sent and not yet ACKed. */
	inFlight: number | null;
	/**
	 * The newest full frame received, still as the compositor's image; replaced,
	 * never queued. Kept UNCONVERTED on purpose (review F1): `toBitmap()` is a
	 * full-size BGRA copy on main's thread (2240x1588x4 = 14,228,480 bytes for
	 * QA's 1120x794 CSS content rect at DPR 2), and most frames are replaced
	 * before they are sent because one is already in flight. Only the frame
	 * `pump()` actually sends is ever copied.
	 */
	latest: { frameSeq: number; image: CompositeImage } | null;
	/** `latest.frameSeq` the renderer has already been sent. */
	sentSeq: number;
	detach: () => void;
}

const rectKeyOf = (rect: CompositeEligibility["rect"]): string =>
	`${rect.x},${rect.y},${rect.width},${rect.height}`;

export class CompositeBridge {
	private generation = 0;
	private stream: Stream | null = null;
	private consumerReady = false;
	private disposed = false;

	constructor(private readonly options: CompositeBridgeOptions) {}

	/** The live generation, or null. Exposed for tests and evidence only. */
	get activeGeneration(): number | null {
		return this.stream?.generation ?? null;
	}

	/**
	 * Reconcile with the registry. Called before every layout pass and on every
	 * epoch bump; cheap when nothing changed.
	 */
	sync(): void {
		if (this.disposed) return;
		const want = this.options.eligible();
		const current = this.stream;
		if (!want) {
			if (current) this.stop("ineligible");
			return;
		}
		if (
			current &&
			current.tabId === want.tabId &&
			current.source === want.source &&
			current.webContentsId === want.source.id &&
			current.documentEpoch === want.documentEpoch &&
			current.rectKey === rectKeyOf(want.rect)
		)
			return;
		// A rect-only change (window resize, a dock opening) on the same tab and
		// document is still the same page: "resized" lets the renderer keep the
		// last picture stretched until the next one arrives (UX U2) instead of
		// wiping to the paused note mid-drag. Anything else is a different page or
		// document and must not be preceded by the old pixels.
		if (current) {
			const resizedOnly =
				current.tabId === want.tabId &&
				current.source === want.source &&
				current.webContentsId === want.source.id &&
				current.documentEpoch === want.documentEpoch;
			this.stop(resizedOnly ? "resized" : "changed");
		}
		this.start(want);
	}

	/** End the current generation and, if still eligible, start a fresh one. */
	invalidate(reason: string): void {
		if (this.disposed || !this.stream) return;
		this.stop(reason);
		this.sync();
	}

	/**
	 * The renderer's canvas mounted (true) or went away (false). A fresh consumer
	 * has drawn nothing, so whatever was in flight is forgotten and the latest
	 * frame is resent: a static page may never produce another one.
	 */
	setConsumer(ready: boolean): void {
		if (this.disposed) return;
		this.consumerReady = ready;
		const stream = this.stream;
		if (!stream) return;
		stream.inFlight = null;
		stream.sentSeq = 0;
		if (ready) this.pump(stream);
	}

	/**
	 * The renderer drew a frame. Refused (false) unless it names the current
	 * generation and the exact frame in flight: a late ACK from an ended
	 * generation, a repeated ACK and a made-up one must not release a send.
	 */
	ack(payload: unknown): boolean {
		const stream = this.stream;
		if (!stream || typeof payload !== "object" || payload === null)
			return false;
		const { generation, frameSeq } = payload as Record<string, unknown>;
		if (
			generation !== stream.generation ||
			typeof frameSeq !== "number" ||
			frameSeq !== stream.inFlight
		)
			return false;
		stream.inFlight = null;
		this.pump(stream);
		return true;
	}

	/** Host stop, retry or window teardown. Idempotent. */
	dispose(): void {
		if (this.disposed) return;
		if (this.stream) this.stop("disposed");
		this.disposed = true;
		this.consumerReady = false;
	}

	private start(want: CompositeEligibility): void {
		const source = want.source;
		if (source.isDestroyed()) return;
		this.generation += 1;
		const generation = this.generation;
		// A cross-document navigation START ends the generation and restarts it at
		// once (`invalidate` → `sync`), so the renderer wipes the outgoing page's
		// picture; frames of the outgoing document can still stream until the
		// commit bumps the document epoch (another restart), which is honest
		// because that is still the live page (review F4). A crash and the page's
		// own destruction end the picture: a dead renderer produces no more.
		const onNavigation = (details: {
			isMainFrame?: boolean;
			isSameDocument?: boolean;
		}): void => {
			if (details?.isMainFrame && !details.isSameDocument)
				this.invalidateIf(generation, "navigation");
		};
		const onGone = (): void => this.invalidateIf(generation, "page-gone");
		const onDestroyed = (): void => {
			if (this.stream?.generation === generation) this.stop("page-destroyed");
		};
		source.on("did-start-navigation", onNavigation as never);
		source.on("render-process-gone", onGone as never);
		source.on("destroyed", onDestroyed as never);
		const stream: Stream = {
			generation,
			tabId: want.tabId,
			source,
			webContentsId: source.id,
			documentEpoch: want.documentEpoch,
			rectKey: rectKeyOf(want.rect),
			nextSeq: 1,
			inFlight: null,
			latest: null,
			sentSeq: 0,
			detach: () => {
				source.removeListener("did-start-navigation", onNavigation as never);
				source.removeListener("render-process-gone", onGone as never);
				source.removeListener("destroyed", onDestroyed as never);
			},
		};
		this.stream = stream;
		try {
			source.beginFrameSubscription(false, (image) =>
				this.onFrame(generation, image),
			);
			source.invalidate?.();
		} catch (error) {
			this.options.log?.(
				`[browser] composite: subscription failed for tab ${want.tabId}: ${(error as Error)?.message ?? error}`,
			);
			this.stop("subscribe-failed");
		}
	}

	private onFrame(generation: number, image: CompositeImage): void {
		const stream = this.stream;
		if (!stream || stream.generation !== generation) return;
		if (image.isEmpty()) return;
		stream.latest = { frameSeq: stream.nextSeq++, image };
		this.pump(stream);
	}

	/** Send the latest frame if the renderer is ready and nothing is in flight. */
	private pump(stream: Stream): void {
		if (!this.consumerReady || stream.inFlight !== null) return;
		const latest = stream.latest;
		if (!latest || latest.frameSeq <= stream.sentSeq) return;
		const target = this.options.target();
		if (!target || target.isDestroyed()) return;
		// The one copy per SENT frame (see `Stream.latest`). No resize: the frame is
		// already the content rect's CSS size x the owner's DPR (QA A1: 2240x1588
		// for 1120x794 at DPR 2), so `NativeImage.resize` to that size would be a
		// second full copy that changes nothing.
		const { width, height } = latest.image.getSize();
		const pixels = latest.image.toBitmap();
		// Consumed either way, so a malformed image is not re-read on every pump.
		stream.sentSeq = latest.frameSeq;
		if (width <= 0 || height <= 0 || pixels.byteLength !== width * height * 4)
			return;
		const frame: CompositeFrame = {
			generation: stream.generation,
			tabId: stream.tabId,
			webContentsId: stream.webContentsId,
			documentEpoch: stream.documentEpoch,
			frameSeq: latest.frameSeq,
			width,
			height,
			pixels,
		};
		stream.inFlight = frame.frameSeq;
		target.send(BROWSER_COMPOSITE_FRAME, frame);
	}

	private invalidateIf(generation: number, reason: string): void {
		if (this.stream?.generation === generation) this.invalidate(reason);
	}

	private stop(reason: string): void {
		const stream = this.stream;
		if (!stream) return;
		this.stream = null;
		stream.detach();
		stream.latest = null;
		if (!stream.source.isDestroyed()) {
			try {
				stream.source.endFrameSubscription();
			} catch {
				// Ending a subscription on a contents mid-teardown can throw; the
				// generation is already over, which is what matters.
			}
		}
		const target = this.options.target();
		if (target && !target.isDestroyed()) {
			const clear: CompositeClear = { generation: stream.generation, reason };
			target.send(BROWSER_COMPOSITE_CLEAR, clear);
		}
	}
}
