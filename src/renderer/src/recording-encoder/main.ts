/**
 * The hidden H.264 encoder document for `record_start {quality: "high"}`
 * (design D15-D17, `docs/design/browser-recording.md`).
 *
 * WHAT RUNS HERE AND WHY HERE. WebCodecs (`createImageBitmap`, `VideoFrame`,
 * `VideoEncoder`) is a renderer API; Electron's `utilityProcess` has none (probe
 * evidence 3). Main hands this document one screencast frame at a time, base64 PNG
 * exactly as Chromium sent it, and gets H.264 chunks back. Nothing is painted.
 *
 * THE ENCODER CONFIG IS THE MEASURED ONE: High profile, `latencyMode: "realtime"`
 * (`"quality"` cost 2.4x the bitrate for +0.5 dB), constant bitrate, no B-frames
 * (a chunk whose timestamp does not advance is an error, because the muxer has no
 * `ctts`), `avc: {format: "avc"}` so chunks are length-prefixed and the decoder
 * config carries the `avcC` record the container needs.
 *
 * ORDER IS BY CONSTRUCTION. Commands run through one promise chain, so a `flush`
 * can never overtake a frame that is still being decoded, which is what makes
 * "frames, then flush" in main mean every frame sent is in the clip.
 *
 * BACKPRESSURE. `frame-done` is sent only once the encoder's queue is short, and
 * main withholds Chromium's `Page.screencastFrameAck` until it arrives, so a slow
 * encoder slows the SOURCE instead of growing a queue of 4K bitmaps here.
 */
import type {
	EncoderCommand,
	EncoderConfigRequest,
	EncoderEvent,
	EncoderUnavailableWhy,
} from "../../../shared/recording-encoder";

interface EncoderBridge {
	on(callback: (message: EncoderCommand) => void): void;
	send(message: EncoderEvent): void;
}

declare global {
	interface Window {
		recordingEncoder?: EncoderBridge;
	}
}

/** The encoder queue depth at which `frame-done` waits. Two keeps the hardware
 * pipeline full without holding more than a frame ahead. */
const MAX_ENCODE_QUEUE = 2;

/** `avc1.640028` is High @ 4.0, enough for 1920x1088 at this frame rate; it is
 * tried first where it applies and `avc1.640033` (High @ 5.1) is the measured
 * answer at every size up to 4K. */
const LEVEL_40 = "avc1.640028";
const LEVEL_51 = "avc1.640033";
const LEVEL_40_MAX_AREA = 1920 * 1088;
/** The same ceiling main applies: software is allowed up to 1920x1080 only. */
const SMALL_PROBE = { width: 640, height: 360 };

const bridge = window.recordingEncoder;

let encoder: VideoEncoder | null = null;
let request: EncoderConfigRequest | null = null;
let sentFirstChunk = false;
let lastKeyTs = Number.NEGATIVE_INFINITY;
let framesEncoded = 0;
let canvas: OffscreenCanvas | null = null;
let failed = false;

const send = (message: EncoderEvent): void => bridge?.send(message);

function reportError(error: unknown): void {
	if (failed) return;
	failed = true;
	send({
		evt: "error",
		message: error instanceof Error ? error.message : String(error),
	});
}

function baseConfig(
	codec: string,
	width: number,
	height: number,
	bitrate: number,
	fps: number,
	acceleration: "prefer-hardware" | "prefer-software" | "no-preference",
): VideoEncoderConfig {
	return {
		codec,
		width,
		height,
		bitrate,
		framerate: fps,
		hardwareAcceleration: acceleration,
		bitrateMode: "constant",
		latencyMode: "realtime",
		avc: { format: "avc" },
	};
}

async function supported(config: VideoEncoderConfig): Promise<boolean> {
	try {
		return (await VideoEncoder.isConfigSupported(config)).supported === true;
	} catch {
		return false;
	}
}

/** The first codec string the engine accepts at this size and preference. */
async function pick(
	req: EncoderConfigRequest,
	acceleration: "prefer-hardware" | "prefer-software" | "no-preference",
): Promise<string | null> {
	const candidates =
		req.width * req.height <= LEVEL_40_MAX_AREA
			? [LEVEL_40, LEVEL_51]
			: [LEVEL_51];
	for (const codec of candidates) {
		if (
			await supported(
				baseConfig(
					codec,
					req.width,
					req.height,
					req.bitrate,
					req.fps,
					acceleration,
				),
			)
		) {
			return codec;
		}
	}
	return null;
}

/**
 * Choose hardware, else software where the caller allows it, else say why not.
 *
 * NEVER A SILENT DEGRADE (D20): a refusal names the reason so the caller can retry
 * without `quality` knowingly, instead of receiving the smeared clip it asked not
 * to get.
 */
async function chooseEncoder(
	req: EncoderConfigRequest,
): Promise<
	| { ok: true; encoder: "hardware" | "software"; codec: string }
	| { ok: false; why: EncoderUnavailableWhy; detail: string }
> {
	if (
		typeof VideoEncoder === "undefined" ||
		typeof VideoFrame === "undefined"
	) {
		return {
			ok: false,
			why: "no_h264_encoder",
			detail: "this engine has no WebCodecs VideoEncoder",
		};
	}
	const hardware = await pick(req, "prefer-hardware");
	if (hardware) return { ok: true, encoder: "hardware", codec: hardware };
	const software = await pick(req, "prefer-software");
	if (software) {
		if (req.softwareAllowed) {
			return { ok: true, encoder: "software", codec: software };
		}
		return {
			ok: false,
			why: "software_over_1080p",
			detail: `only a software H.264 encoder is available, and it is not used above 1920x1080 (${req.width}x${req.height})`,
		};
	}
	// Neither works at THIS size: is it the size, or is there no encoder at all?
	const anywhere = await supported(
		baseConfig(
			LEVEL_40,
			SMALL_PROBE.width,
			SMALL_PROBE.height,
			req.bitrate,
			req.fps,
			"no-preference",
		),
	);
	return anywhere
		? {
				ok: false,
				why: "size_unsupported",
				detail: `the H.264 encoder does not accept ${req.width}x${req.height}`,
			}
		: {
				ok: false,
				why: "no_h264_encoder",
				detail: "this engine cannot encode H.264",
			};
}

async function configure(req: EncoderConfigRequest): Promise<void> {
	const chosen = await chooseEncoder(req);
	if (!chosen.ok) {
		send({
			evt: "configured",
			id: req.id,
			ok: false,
			why: chosen.why,
			detail: chosen.detail,
		});
		return;
	}
	request = req;
	canvas = null;
	sentFirstChunk = false;
	lastKeyTs = Number.NEGATIVE_INFINITY;
	framesEncoded = 0;
	try {
		encoder = new VideoEncoder({
			output: (chunk, metadata) => {
				const data = new Uint8Array(chunk.byteLength);
				chunk.copyTo(data);
				const description = metadata?.decoderConfig?.description;
				send({
					evt: "chunk",
					data,
					ts: chunk.timestamp,
					key: chunk.type === "key",
					...(!sentFirstChunk && description
						? {
								description: new Uint8Array(
									description as ArrayBuffer | ArrayBufferView as ArrayBuffer,
								),
							}
						: {}),
				});
				if (description) sentFirstChunk = true;
			},
			error: reportError,
		});
		encoder.configure(
			baseConfig(
				chosen.codec,
				req.width,
				req.height,
				req.bitrate,
				req.fps,
				chosen.encoder === "hardware" ? "prefer-hardware" : "prefer-software",
			),
		);
	} catch (error) {
		send({
			evt: "configured",
			id: req.id,
			ok: false,
			why: "encoder_start",
			detail: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	send({
		evt: "configured",
		id: req.id,
		ok: true,
		encoder: chosen.encoder,
		codec: chosen.codec,
		width: req.width,
		height: req.height,
	});
}

/** base64 -> bytes without `fetch` (the CSP has `connect-src 'none'`). The native
 * decoder (Chromium 140+) is used where it exists: it is a memcpy-speed call, where
 * the `atob` loop is a per-byte JS loop on a multi-megabyte 4K frame. */
function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
	const native = (
		Uint8Array as unknown as {
			fromBase64?: (text: string) => Uint8Array<ArrayBuffer>;
		}
	).fromBase64;
	if (native) return native.call(Uint8Array, base64);
	const binary = atob(base64);
	const out = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		out[index] = binary.charCodeAt(index);
	}
	return out;
}

/** The frame the encoder is configured for: the bitmap itself when it already
 * has the coded size, a CROP when it is at most one pixel larger on a side (an
 * odd-sized first frame: H.264 needs even coded sides, so the odd pixel goes), else
 * a letterboxed copy on a fixed-size canvas. A frame at another size means an
 * unsized tab was resized mid-clip, which must not change the coded size or the
 * file would be undecodable. */
function frameFor(
	bitmap: ImageBitmap,
	req: EncoderConfigRequest,
	timestamp: number,
): VideoFrame {
	if (bitmap.width === req.width && bitmap.height === req.height) {
		return new VideoFrame(bitmap, { timestamp });
	}
	if (!canvas) canvas = new OffscreenCanvas(req.width, req.height);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("no 2d context for the resize fallback");
	context.fillStyle = "#000";
	context.fillRect(0, 0, req.width, req.height);
	const oddPixel =
		bitmap.width - req.width >= 0 &&
		bitmap.width - req.width <= 1 &&
		bitmap.height - req.height >= 0 &&
		bitmap.height - req.height <= 1;
	if (oddPixel) {
		context.drawImage(
			bitmap,
			0,
			0,
			req.width,
			req.height,
			0,
			0,
			req.width,
			req.height,
		);
	} else {
		const scale = Math.min(
			req.width / bitmap.width,
			req.height / bitmap.height,
		);
		const drawWidth = Math.round(bitmap.width * scale);
		const drawHeight = Math.round(bitmap.height * scale);
		context.drawImage(
			bitmap,
			Math.floor((req.width - drawWidth) / 2),
			Math.floor((req.height - drawHeight) / 2),
			drawWidth,
			drawHeight,
		);
	}
	return new VideoFrame(canvas, { timestamp });
}

async function encodeFrame(
	seq: number,
	data: string,
	ts: number,
): Promise<void> {
	const current = encoder;
	const req = request;
	if (!current || !req || failed) {
		// Nothing to encode into, but main is waiting on this frame's ack.
		send({ evt: "frame-done", seq });
		return;
	}
	const bitmap = await createImageBitmap(
		new Blob([bytesOf(data)], { type: "image/png" }),
	);
	let frame: VideoFrame;
	try {
		frame = frameFor(bitmap, req, ts);
	} finally {
		bitmap.close();
	}
	const key = framesEncoded === 0 || ts - lastKeyTs >= req.keyIntervalUs;
	if (key) lastKeyTs = ts;
	current.encode(frame, { keyFrame: key });
	frame.close();
	framesEncoded += 1;
	while (current.encodeQueueSize > MAX_ENCODE_QUEUE && !failed) {
		await new Promise<void>((resolve) =>
			current.addEventListener("dequeue", () => resolve(), { once: true }),
		);
	}
	send({ evt: "frame-done", seq });
}

let chain: Promise<void> = Promise.resolve();

bridge?.on((message) => {
	chain = chain
		.then(async () => {
			if (message.cmd === "configure") await configure(message);
			else if (message.cmd === "frame") {
				await encodeFrame(message.seq, message.data, message.ts);
			} else if (message.cmd === "flush") {
				if (encoder && !failed) await encoder.flush();
				send({ evt: "flushed", id: message.id });
			}
		})
		.catch(reportError);
});

send({ evt: "ready" });
