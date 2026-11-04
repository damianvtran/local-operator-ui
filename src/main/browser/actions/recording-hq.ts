import type {
	EncoderConfigRequest,
	EncoderEvent,
	EncoderUnavailableWhy,
} from "../../../shared/recording-encoder";
import { type CdpContents, type CdpPool, PAGE_DISABLED_EVENT } from "../cdp";
import { BrowserHostError } from "../errors";
import { type Mp4Sample, muxOverheadBound, writeMp4 } from "./recording-mux";

/**
 * The high-quality capture engine behind `record_start {quality: "high"}`
 * (design D15-D21, `docs/design/browser-recording.md`).
 *
 * THE PIPELINE. `Page.startScreencast` (PNG, every frame) -> this class, in main ->
 * a hidden per-recording encoder window (`recording-encoder-host.ts`, behind the
 * `EncoderHost` seam below) -> H.264 chunks back -> `recording-mux.ts` at stop.
 * `Page.startScreenRecording` is not involved: its AV1 encoder has no quality lever,
 * and that is the whole reason this path exists. The two are SEPARATE ENGINES, and
 * `recording.ts` picks one at its branch points, so the default path stays
 * byte-identical (a golden test pins its CDP call list).
 *
 * THIS FILE HAS NO `electron` IMPORT, on purpose: the encoder is injected as an
 * `EncoderHostFactory`, so `scripts/browser-recording.test.mjs` drives the whole
 * lifecycle with a fake one and no Chromium. Production hands it the window host.
 *
 * FRAME PACING IS THE ACK. Chromium produces the next screencast frame only after
 * `Page.screencastFrameAck`, so withholding the ack throttles the SOURCE and skips
 * the PNG encode Chromium would otherwise spend on frames nobody keeps. A frame is
 * acked once the encoder has taken it AND `1/fps` has passed since the previous one
 * was sent. That is the normal case: Chromium keeps at most two frames unacked, so
 * the withheld ack is what holds the rate near 10 fps. If a second frame does arrive
 * while one waits, at most one is kept (`pending`, latest wins; the displaced one is
 * acked at once), so a slow encoder shows as a lower frame rate, never a growing
 * queue of 4K bitmaps. Timestamps are the page's own, so the clip is variable frame
 * rate and a static page costs nothing.
 *
 * EVERY EXIT DISPOSES, SYNCHRONOUSLY. `dispose` unsubscribes, destroys the encoder
 * window, drops the chunks and clears every timer; it never acks after that. It is
 * what `abortRecording` calls at all four debugger boundaries.
 */

/** The H.264 clip a finished session returns, still in memory. */
export interface HqClip {
	parts: Buffer[];
	size: number;
	frames: number;
	/** Frames per second of media time, `frames / duration`. */
	measuredFps: number;
	avgBitrateKbps: number;
	encoder: "hardware" | "software";
	/** Wall clock at the stop, for the result's `duration_ms`. */
	endedAt: number;
}

/** What an encoder window reports to its session. */
export interface EncoderSink {
	onChunk(chunk: {
		data: Uint8Array;
		ts: number;
		key: boolean;
		description?: Uint8Array;
	}): void;
	onFrameDone(seq: number): void;
	/** The window died, stopped responding or reported an encoder error. */
	onFailure(message: string): void;
}

export type ConfigureAnswer =
	| {
			ok: true;
			encoder: "hardware" | "software";
			codec: string;
			width: number;
			height: number;
	  }
	| { ok: false; why: EncoderUnavailableWhy; detail: string };

/** One encoder window as the session sees it. */
export interface EncoderHost {
	configure(
		request: Omit<EncoderConfigRequest, "id">,
	): Promise<ConfigureAnswer>;
	frame(seq: number, data: string, ts: number): void;
	/** Resolves once every frame sent so far is encoded; rejects if the window dies. */
	flush(): Promise<void>;
	/** Synchronous and idempotent. */
	dispose(): void;
}

/** Opens one encoder window and resolves when its document is ready. A rejection is
 * refused as `record_quality_unavailable` / `encoder_start`. */
export type EncoderHostFactory = (sink: EncoderSink) => Promise<EncoderHost>;

/** What the host wiring hands the actions: the factory and, for tests, the clocks. */
export interface RecordingEncoderService {
	open: EncoderHostFactory;
	timing?: Partial<HqTiming>;
}

export interface HqTiming {
	/** No screencast frame by now: take one screenshot as frame 0 (a static page
	 * may emit none until something changes). */
	nudgeMs: number;
	/** Still no frame by now: the start fails. */
	firstFrameMs: number;
	/** `Page.stopScreencast` on a tab that survives. */
	stopCaptureMs: number;
	/** The encoder's flush at stop. */
	flushMs: number;
	/** Opening the window and configuring the encoder. */
	encoderStartMs: number;
}

export const HQ_TIMING: HqTiming = {
	nudgeMs: 300,
	firstFrameMs: 3_000,
	stopCaptureMs: 2_000,
	flushMs: 10_000,
	encoderStartMs: 10_000,
};

/** High-quality clips are 10 fps, by frame pacing (D17). */
export const HQ_FPS = 10;

/** A key frame every this much media time (D17). */
const KEY_INTERVAL_US = 2_000_000;

/** The area bands of D19. Bitrate barely matters (the probe's output was 1-2.6 Mbps
 * at 32 Mbps targets); the target only has to be generous enough to never be the
 * limit, and to give the encoder a sane rate-control budget. */
const BITRATE_SMALL = 4_000_000;
const BITRATE_FULL_HD = 8_000_000;
const BITRATE_LARGE = 16_000_000;
const AREA_720P = 1280 * 720;
const AREA_1080P = 1920 * 1080;

/** Software H.264 is allowed at or below 1080p only: 4K software measured 1.38 GB
 * RSS and 88 % CPU, which is a refusal and not a clip (D19). */
const SOFTWARE_MAX_AREA = AREA_1080P;

/** The bound on everything that waits for the encoder after a stop. */
const DRAIN_MS = 3_000;

/** The PNG signature and the offsets of IHDR's width/height. Reading them from the
 * first 24 bytes saves decoding a 4K frame in main just to learn its size. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

export function bitrateFor(width: number, height: number): number {
	const area = width * height;
	if (area <= AREA_720P) return BITRATE_SMALL;
	if (area <= AREA_1080P) return BITRATE_FULL_HD;
	return BITRATE_LARGE;
}

/** The pixel size of a base64 PNG without decoding it, or null. */
export function pngSize(
	base64: string,
): { width: number; height: number } | null {
	const head = Buffer.from(base64.slice(0, 32), "base64");
	if (head.length < 24) return null;
	for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
		if (head[index] !== PNG_SIGNATURE[index]) return null;
	}
	return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function failed(message: string): BrowserHostError {
	return new BrowserHostError("internal", message, { reason: "record_failed" });
}

function unavailable(
	why: EncoderUnavailableWhy,
	detail: string,
): BrowserHostError {
	return new BrowserHostError(
		"internal",
		`high-quality recording is not available here (${detail}). Retry without quality for the standard recording; nothing was started.`,
		{ reason: "record_quality_unavailable", why, detail },
	);
}

/** A promise that rejects with `onTimeout()` after `ms`, cleared by whoever wins
 * the race. The work itself is NOT cancelled: a caller that owns something the
 * work produces must clean it up when it arrives late (see `open`). */
function bounded<T>(
	work: Promise<T>,
	ms: number,
	onTimeout: () => BrowserHostError,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(onTimeout()), ms);
		timer.unref?.();
	});
	return Promise.race([work, timeout]).finally(() => {
		if (timer !== undefined) clearTimeout(timer);
	});
}

interface Pending {
	/** The screencast session id to ack, or null for the nudge's screenshot. */
	ackId: number | null;
	data: string;
	/** The page's own timestamp in seconds, when it gave one. */
	pageSec: number | undefined;
	arrivedAt: number;
}

interface InFlight {
	seq: number;
	ackId: number | null;
	sentAt: number;
	done: boolean;
}

export interface HqStartOptions {
	cdp: CdpPool;
	contents: CdpContents;
	service: RecordingEncoderService;
	/** The screencast's ceiling: frames are scaled to fit inside it. */
	maxWidth: number;
	maxHeight: number;
	/** The confirmed size of a sized start, or null when the first frame decides. */
	size: { width: number; height: number } | null;
	maxBytes: number;
	/** Called once when the byte cap is reached; the session has stopped accepting. */
	onCap: () => void;
	/** Wall clock, for tests. */
	now?: () => number;
}

export class HqSession {
	/** Set by `start` once the encoder answered. */
	encoder: "hardware" | "software" = "hardware";
	codec = "h264";
	width = 0;
	height = 0;
	bitrate = 0;
	readonly fps = HQ_FPS;

	private readonly cdp: CdpPool;
	private readonly contents: CdpContents;
	private readonly timing: HqTiming;
	private readonly now: () => number;
	private readonly maxBytes: number;
	private readonly onCap: () => void;
	private readonly sized: { width: number; height: number } | null;
	private readonly maxWidth: number;
	private readonly maxHeight: number;

	private host: EncoderHost | null = null;
	private unsubscribe: (() => void) | null = null;
	private timers = new Set<ReturnType<typeof setTimeout>>();
	private disposed = false;
	private stopping = false;
	private captureRequested = false;
	private captureStop: Promise<void> | null = null;
	private finishing: Promise<HqClip> | null = null;
	private failure: BrowserHostError | null = null;
	private failureHandler: ((error: BrowserHostError) => void) | null = null;
	private failureWaiters = new Set<(error: BrowserHostError) => void>();

	private configured = false;
	private configuring = false;
	private pending: Pending | null = null;
	private inFlight: InFlight | null = null;
	private seq = 0;
	private gotFrame = false;
	private onFirstFrame: (() => void) | null = null;
	private restarting = false;
	private restartAgain = false;
	private lastSentAt: number | null = null;

	private firstWallMs: number | null = null;
	private anchorPageSec: number | undefined;
	private anchorRelUs = 0;
	private lastTsUs = -1000;

	private samples: Mp4Sample[] = [];
	private description: Uint8Array | null = null;
	private payload = 0;
	private capped = false;

	private constructor(options: HqStartOptions) {
		this.cdp = options.cdp;
		this.contents = options.contents;
		this.timing = { ...HQ_TIMING, ...options.service.timing };
		this.now = options.now ?? Date.now;
		this.maxBytes = options.maxBytes;
		this.onCap = options.onCap;
		this.sized = options.size;
		this.maxWidth = options.maxWidth;
		this.maxHeight = options.maxHeight;
	}

	/**
	 * Open the encoder, start the screencast and wait for a first frame.
	 *
	 * Every failure disposes before it throws, so a refused or failed start leaves no
	 * window, subscription or timer. The CALLER still owns the viewport and the
	 * reservation, as it does for the standard path.
	 */
	static async start(
		options: HqStartOptions,
		registerSession: (session: HqSession) => void,
	): Promise<HqSession> {
		const session = new HqSession(options);
		// Registered BEFORE the first await: an abort that lands while the window is
		// still opening must be able to destroy it (the reservation carries this), and
		// a failed start must be able to await the screencast's stop on the session
		// this call never returns.
		registerSession(session);
		try {
			await session.open(options);
			return session;
		} catch (error) {
			session.dispose();
			throw error;
		}
	}

	/** Called by `recording.ts` right after `start`: a failure that already happened
	 * is delivered at once, so there is no gap in which a dead encoder is unseen. */
	onFailure(handler: (error: BrowserHostError) => void): void {
		this.failureHandler = handler;
		if (this.failure && !this.disposed) handler(this.failure);
	}

	private async open(options: HqStartOptions): Promise<void> {
		const sink: EncoderSink = {
			onChunk: (chunk) => this.takeChunk(chunk),
			onFrameDone: (seq) => this.frameDone(seq),
			onFailure: (message) => this.fail(failed(message)),
		};
		const opening = options.service.open(sink);
		try {
			this.host = await bounded(opening, this.timing.encoderStartMs, () =>
				unavailable(
					"encoder_start",
					`the encoder window did not open in ${this.timing.encoderStartMs} ms`,
				),
			);
		} catch (error) {
			// A window that opens AFTER the bound has no owner: nothing holds it, so
			// nothing would ever destroy it, and it is a renderer with throttling off
			// that would live until the app quits (review round 1, M1).
			void opening.then(
				(late) => {
					try {
						late.dispose();
					} catch {
						// Already gone.
					}
				},
				() => undefined,
			);
			throw error instanceof BrowserHostError &&
				error.data?.reason === "record_quality_unavailable"
				? error
				: unavailable(
						"encoder_start",
						error instanceof Error ? error.message : String(error),
					);
		}
		if (this.disposed) {
			// An abort landed while the window was still opening: `dispose` ran with no
			// host to destroy, and its idempotence means nothing will run again, so the
			// window that arrived late is destroyed here or it would outlive the clip.
			try {
				this.host?.dispose();
			} catch {
				// A window that is already gone is the goal.
			}
			this.host = null;
			throw failed("the recording was cancelled while starting");
		}
		if (this.sized) await this.configure(this.sized);
		// An abort during the sized configure must not subscribe or start a
		// screencast on a session that is already gone (review round 1, m1).
		this.throwIfDisposed();
		// The subscription exists before the screencast starts: a first frame that
		// arrives with the start's own reply must not be missed.
		this.unsubscribe = this.cdp.subscribe(this.contents.id, (method, params) =>
			this.onEvent(method, params),
		);
		const first = new Promise<void>((resolve) => {
			this.onFirstFrame = resolve;
		});
		this.captureRequested = true;
		await this.startScreencast();
		// The failure waiters are registered by the race below, after this await, so
		// an abort during it would otherwise wait out the whole first-frame bound.
		this.throwIfDisposed();
		this.arm(this.timing.nudgeMs, () => void this.nudge());
		await this.race(first, this.timing.firstFrameMs, () =>
			failed(
				`the page produced no frame within ${this.timing.firstFrameMs / 1000} s of the recording starting, so nothing was recorded`,
			),
		);
	}

	private throwIfDisposed(): void {
		if (this.disposed)
			throw failed("the recording was cancelled while starting");
	}

	private startScreencast(): Promise<unknown> {
		return this.cdp.send(
			this.contents,
			"Page.startScreencast",
			{
				format: "png",
				maxWidth: this.maxWidth,
				maxHeight: this.maxHeight,
				everyNthFrame: 1,
			},
			{ deadlineMs: 20_000 },
		);
	}

	/** `work`, or the first failure, or a timeout. */
	private race<T>(
		work: Promise<T>,
		ms: number,
		onTimeout: () => BrowserHostError,
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let settledOnce = false;
			const timer = setTimeout(() => finish(() => reject(onTimeout())), ms);
			timer.unref?.();
			const waiter = (error: BrowserHostError) => finish(() => reject(error));
			this.failureWaiters.add(waiter);
			const finish = (action: () => void) => {
				if (settledOnce) return;
				settledOnce = true;
				clearTimeout(timer);
				this.failureWaiters.delete(waiter);
				action();
			};
			work.then(
				(value) => finish(() => resolve(value)),
				(error) => finish(() => reject(error)),
			);
		});
	}

	private arm(ms: number, action: () => void): void {
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			if (!this.disposed) action();
		}, ms);
		timer.unref?.();
		this.timers.add(timer);
	}

	/** A first frame larger than the ceiling (the nudge's unscaled screenshot of a
	 * presented tab) is configured at the size the screencast would have scaled it
	 * to, so every later frame matches and the encoder document scales this one. */
	private fitToCeiling(size: { width: number; height: number }): {
		width: number;
		height: number;
	} {
		const scale = Math.min(
			1,
			this.maxWidth / size.width,
			this.maxHeight / size.height,
		);
		return scale >= 1
			? size
			: {
					width: Math.round(size.width * scale),
					height: Math.round(size.height * scale),
				};
	}

	private async configure(size: {
		width: number;
		height: number;
	}): Promise<void> {
		if (this.configured || this.configuring || !this.host) return;
		this.configuring = true;
		// H.264 coded sides are even: an odd first frame (an unsized tab at an odd
		// scaled width) loses its odd pixel, and the encoder document crops to match.
		const width = size.width - (size.width % 2);
		const height = size.height - (size.height % 2);
		const bitrate = bitrateFor(width, height);
		let answer: ConfigureAnswer;
		try {
			answer = await bounded(
				this.host.configure({
					width,
					height,
					bitrate,
					fps: HQ_FPS,
					softwareAllowed: width * height <= SOFTWARE_MAX_AREA,
					keyIntervalUs: KEY_INTERVAL_US,
				}),
				this.timing.encoderStartMs,
				() =>
					unavailable(
						"encoder_start",
						`the encoder did not answer within ${this.timing.encoderStartMs} ms`,
					),
			);
		} catch (error) {
			throw error instanceof BrowserHostError
				? error
				: unavailable("encoder_start", String(error));
		}
		if (!answer.ok) throw unavailable(answer.why, answer.detail);
		this.encoder = answer.encoder;
		this.codec = "h264";
		this.width = answer.width;
		this.height = answer.height;
		this.bitrate = bitrate;
		this.configured = true;
		this.configuring = false;
	}

	private onEvent(method: string, params: Record<string, unknown>): void {
		if (this.disposed || this.stopping) return;
		if (method === PAGE_DISABLED_EVENT) {
			this.restartScreencast();
			return;
		}
		if (method !== "Page.screencastFrame") return;
		const data = params.data;
		if (typeof data !== "string") return;
		const sessionId =
			typeof params.sessionId === "number" ? params.sessionId : null;
		const metadata = params.metadata as { timestamp?: unknown } | undefined;
		this.take({
			ackId: sessionId,
			data,
			pageSec:
				typeof metadata?.timestamp === "number"
					? metadata.timestamp
					: undefined,
			arrivedAt: this.now(),
		});
	}

	/**
	 * `Page.disable` ENDS A RUNNING SCREENCAST and `Page.enable` does not bring it
	 * back (measured, QA round 1 Q1). The origin gate sends exactly that after every
	 * click, type, press and goto, so a clip would freeze at the first action while
	 * keeping its wall-clock length. The pool announces each `Page.disable` it sent
	 * (`PAGE_DISABLED_EVENT`) and the screencast is started again here. A watchdog on
	 * "no frames lately" could not do this job: a static page legitimately produces
	 * none. A burst is coalesced to one start in flight plus one queued (a disable
	 * that lands after the in-flight start was sent ends THAT screencast too, so it
	 * cannot simply be dropped), and a restart that fails fails the recording
	 * instead of leaving a clip that silently stopped moving.
	 *
	 * Chromium's frame-in-flight count restarts with the screencast, so an ack that
	 * was still owed for the old one is simply ignored by it; `inFlight` is left
	 * alone because the encoder, not Chromium, is what releases it.
	 */
	private restartScreencast(): void {
		if (!this.captureRequested) return;
		if (this.restarting) {
			// A `Page.disable` that lands after the in-flight start was SENT ends that
			// screencast too, so it cannot be dropped; it is remembered, and a burst
			// still costs one start in flight plus one more, not one per disable.
			this.restartAgain = true;
			return;
		}
		this.restarting = true;
		void this.startScreencast().then(
			() => {
				this.restarting = false;
				if (this.restartAgain) {
					this.restartAgain = false;
					if (!this.disposed && !this.stopping) this.restartScreencast();
				}
			},
			(error: unknown) => {
				this.restarting = false;
				this.restartAgain = false;
				if (this.disposed || this.stopping) return;
				if (error instanceof BrowserHostError && error.code === "tab_closed")
					return;
				this.fail(
					failed(
						`the page's screencast stopped and could not be restarted: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
			},
		);
	}

	/** The nudge: a static page may emit no screencast frame until something
	 * changes, so one screenshot stands in as frame 0 (D17). */
	private async nudge(): Promise<void> {
		if (this.gotFrame || this.disposed || this.stopping) return;
		try {
			const shot = await this.cdp.send<{ data?: string }>(
				this.contents,
				"Page.captureScreenshot",
				{ format: "png", captureBeyondViewport: false },
				{ deadlineMs: this.timing.firstFrameMs },
			);
			if (this.gotFrame || this.disposed || this.stopping) return;
			if (typeof shot?.data !== "string") return;
			this.take({
				ackId: null,
				data: shot.data,
				pageSec: undefined,
				arrivedAt: this.now(),
			});
		} catch {
			// The first-frame bound is what fails the start; a screenshot that cannot
			// be taken is not a second reason.
		}
	}

	private take(frame: Pending): void {
		if (!this.gotFrame) {
			this.gotFrame = true;
			const size = pngSize(frame.data);
			if (!this.configured) {
				if (!size) {
					this.fail(failed("the first frame was not a PNG image"));
					return;
				}
				void this.configure(this.fitToCeiling(size)).then(
					() => this.pump(),
					(error: unknown) =>
						this.fail(
							error instanceof BrowserHostError ? error : failed(String(error)),
						),
				);
			}
		}
		// Latest wins: the displaced frame is acked at once, so the source stays
		// paced by the one frame that is actually being kept.
		if (this.pending) this.ack(this.pending.ackId);
		this.pending = frame;
		this.pump();
	}

	private pump(): void {
		if (this.disposed || !this.configured || this.inFlight || !this.pending)
			return;
		if (this.stopping && this.capped) return;
		const frame = this.pending;
		const interval = 1000 / HQ_FPS;
		if (this.lastSentAt !== null) {
			const wait = this.lastSentAt + interval - this.now();
			if (wait > 0) {
				this.arm(wait, () => this.pump());
				return;
			}
		}
		this.pending = null;
		this.send(frame);
	}

	private send(frame: Pending): void {
		if (!this.host) return;
		const arrived = frame.arrivedAt;
		let relUs: number;
		if (this.firstWallMs === null) {
			this.firstWallMs = arrived;
			this.anchorPageSec = frame.pageSec;
			this.anchorRelUs = 0;
			relUs = 0;
		} else if (
			frame.pageSec !== undefined &&
			this.anchorPageSec !== undefined
		) {
			relUs = this.anchorRelUs + (frame.pageSec - this.anchorPageSec) * 1e6;
		} else if (frame.pageSec !== undefined) {
			// The nudge had no page timestamp: the first real frame anchors on the
			// wall clock and its deltas are the page's own from here.
			this.anchorPageSec = frame.pageSec;
			this.anchorRelUs = (arrived - this.firstWallMs) * 1000;
			relUs = this.anchorRelUs;
		} else {
			relUs = (arrived - this.firstWallMs) * 1000;
		}
		// Strictly increasing: the muxer has no `ctts`, so two frames at one instant
		// would be a zero-length sample some players drop and others stall on.
		// A millisecond is the floor: the muxer rounds to 90 kHz ticks, and two
		// timestamps closer than one tick would collapse into one.
		const ts = Math.max(Math.round(relUs), this.lastTsUs + 1000);
		this.lastTsUs = ts;
		this.seq += 1;
		this.lastSentAt = this.now();
		this.inFlight = {
			seq: this.seq,
			ackId: frame.ackId,
			sentAt: this.lastSentAt,
			done: false,
		};
		this.host.frame(this.seq, frame.data, ts);
	}

	private frameDone(seq: number): void {
		const current = this.inFlight;
		if (this.disposed || !current || current.seq !== seq) return;
		current.done = true;
		if (this.onFirstFrame) {
			this.onFirstFrame();
			this.onFirstFrame = null;
		}
		this.release();
	}

	/** Ack the frame and take the next, once the encoder has finished with it AND a
	 * frame interval has passed since it was sent. */
	private release(): void {
		const current = this.inFlight;
		if (this.disposed || !current || !current.done) return;
		const wait = current.sentAt + 1000 / HQ_FPS - this.now();
		if (wait > 0 && !this.stopping) {
			this.arm(wait, () => this.release());
			return;
		}
		this.inFlight = null;
		if (!this.stopping) this.ack(current.ackId);
		this.pump();
	}

	private ack(sessionId: number | null): void {
		if (this.disposed || this.stopping || sessionId === null) return;
		void this.cdp
			.send(
				this.contents,
				"Page.screencastFrameAck",
				{ sessionId },
				{ deadlineMs: this.timing.stopCaptureMs },
			)
			.catch(() => undefined);
	}

	private takeChunk(chunk: {
		data: Uint8Array;
		ts: number;
		key: boolean;
		description?: Uint8Array;
	}): void {
		if (this.disposed || this.capped) return;
		if (chunk.description && !this.description)
			this.description = chunk.description;
		if (!this.description) {
			this.fail(failed("the encoder produced no decoder configuration"));
			return;
		}
		const next = this.samples.length + 1;
		const total =
			this.payload +
			chunk.data.length +
			muxOverheadBound(next, this.description.length);
		if (total > this.maxBytes) {
			// The cap finalises GRACEFULLY in high mode: what is already here is a
			// complete clip, and the sample that does not fit is simply not part of it
			// (the one before it ends the clip). The caller decides what an empty clip
			// means.
			this.capped = true;
			this.onCap();
			return;
		}
		this.samples.push({ data: chunk.data, ts: chunk.ts, key: chunk.key });
		this.payload += chunk.data.length;
	}

	private fail(error: BrowserHostError): void {
		if (this.disposed || this.failure) return;
		this.failure = error;
		for (const waiter of [...this.failureWaiters]) waiter(error);
		this.failureHandler?.(error);
	}

	/** Stop the screencast, bounded; shared by every caller so Chromium is told once.
	 * On a tab that survives (`endReplaced`, a cancelled start) this is awaited. */
	stopCapture(again = false): Promise<void> {
		// `again` re-issues the stop even though one was already tried: the first may
		// have run while the attachment was gone (a cancelled start), and the caller
		// has since re-attached. Stopping a screencast that is not running is a no-op
		// in Chromium, so a second command costs nothing.
		if (this.captureStop && !again) return this.captureStop;
		this.captureStop = (async () => {
			if (!this.captureRequested || this.contents.isDestroyed()) return;
			try {
				await this.cdp.send(
					this.contents,
					"Page.stopScreencast",
					{},
					{ deadlineMs: this.timing.stopCaptureMs },
				);
			} catch {
				// A session that is gone cannot be stopped; it drops the screencast with
				// itself (`PageHandler::Disable`).
			}
		})();
		return this.captureStop;
	}

	/**
	 * End the clip: stop the capture, drain the encoder and box the samples.
	 *
	 * Shared by the timer and `record_stop`. The newest waiting frame is encoded
	 * first, because it is the page's final state and the last encoded frame is held
	 * until the stop.
	 */
	finish(): Promise<HqClip> {
		if (!this.finishing) this.finishing = this.runFinish();
		return this.finishing;
	}

	private async runFinish(): Promise<HqClip> {
		const endedAt = this.now();
		this.stopping = true;
		await this.stopCapture();
		if (this.disposed)
			throw failed("the recording was discarded while it was being saved");
		await this.waitIdle();
		if (this.pending && this.configured && !this.capped && !this.failure) {
			const last = this.pending;
			this.pending = null;
			this.send(last);
			await this.waitIdle();
		}
		if (this.failure) throw this.failure;
		if (!this.host) throw failed("the encoder is gone");
		// Chunks that arrive during the flush are in; nothing else is coming.
		await this.race(this.host.flush(), this.timing.flushMs, () =>
			failed(
				"the encoder did not finish within its time limit; nothing was saved",
			),
		);
		if (this.disposed)
			throw failed("the recording was discarded while it was being saved");
		if (this.samples.length === 0 || !this.description) {
			throw this.capped
				? new BrowserHostError(
						"internal",
						`the first frame alone does not fit the ${this.maxBytes}-byte limit; nothing was saved. Raise the size limit or record a smaller area.`,
						{ reason: "record_too_large", max_bytes: this.maxBytes },
					)
				: failed("the recording produced no frames; nothing was saved");
		}
		const endUs =
			this.firstWallMs === null
				? undefined
				: (endedAt - this.firstWallMs) * 1000;
		const out = writeMp4({
			width: this.width,
			height: this.height,
			description: this.description,
			samples: this.samples,
			endTs: endUs,
			fallbackFrameUs: 1e6 / HQ_FPS,
		});
		if (out.size > this.maxBytes) {
			throw new BrowserHostError(
				"internal",
				`the recording is larger than ${this.maxBytes} bytes; nothing was saved`,
				{ reason: "record_too_large", max_bytes: this.maxBytes },
			);
		}
		const seconds = Math.max(out.durationMs / 1000, 0.001);
		return {
			parts: out.parts,
			size: out.size,
			frames: this.samples.length,
			measuredFps: Math.round((this.samples.length / seconds) * 100) / 100,
			avgBitrateKbps: Math.round((this.payload * 8) / seconds / 1000),
			encoder: this.encoder,
			endedAt,
		};
	}

	/** Resolves when no frame is in the encoder, the encoder failed, the session was
	 * disposed, or the drain bound passed. Polled rather than signalled: it runs once
	 * per stop, and a poll cannot miss a wake-up that raced the registration. */
	private waitIdle(): Promise<void> {
		return new Promise<void>((resolve) => {
			const started = this.now();
			const check = (): void => {
				if (
					!this.inFlight ||
					this.failure ||
					this.disposed ||
					this.now() - started >= DRAIN_MS
				) {
					resolve();
					return;
				}
				const timer = setTimeout(check, 20);
				timer.unref?.();
			};
			check();
		});
	}

	/** Tear everything down, now. Idempotent, synchronous, never throws, and never acks
	 * afterwards. The best-effort `Page.stopScreencast` is fire-and-forget here; a
	 * caller whose tab survives awaits `stopCapture` itself. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = null;
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
		this.pending = null;
		this.samples = [];
		this.description = null;
		const pendingStop = this.captureRequested ? this.stopCapture() : null;
		void pendingStop?.catch(() => undefined);
		try {
			this.host?.dispose();
		} catch {
			// A window that is already gone is the goal.
		}
		this.host = null;
		for (const waiter of [...this.failureWaiters]) {
			waiter(failed("the recording was discarded"));
		}
		this.failureWaiters.clear();
		this.failureHandler = null;
	}
}

export type { EncoderEvent };
