import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain, session } from "electron";
import {
	type EncoderCommand,
	type EncoderConfigRequest,
	type EncoderEvent,
	RECORDING_ENCODER_CMD_CHANNEL,
	RECORDING_ENCODER_EVT_CHANNEL,
} from "../../../shared/recording-encoder";
import { BrowserHostError } from "../errors";
import type {
	ConfigureAnswer,
	EncoderHost,
	EncoderSink,
	RecordingEncoderService,
} from "./recording-hq";

/**
 * The hidden per-recording window that runs the H.264 encoder (design D15, D21).
 *
 * WHY A WINDOW AND WHY ONE PER RECORDING. WebCodecs is a renderer API, and a
 * `BrowserWindow` is the one hidden renderer this app already creates for work
 * that must not be seen (the console capture view is the precedent). One window
 * per recording means a crash, a hang or a leak belongs to ONE clip, and
 * destroying the window is a complete teardown: there is nothing in it to clean.
 *
 * THE WINDOW IS INERT BY CONSTRUCTION, the same posture as the approvals card:
 * `sandbox`, `contextIsolation`, no Node, an in-memory partition of its own,
 * navigation and popups and permissions and downloads all denied, and a preload
 * that exposes two channels (`src/preload/recording-encoder.ts`). Its document is
 * the app's own bundled page. `backgroundThrottling` is off because an encoder
 * that is throttled when nobody looks at it is an encoder that drops frames.
 *
 * MAIN PINS EVERY MESSAGE TO THE WINDOW IT CREATED. One `ipcMain` listener serves
 * every window and routes by the sender's `webContents.id`; a message from any
 * other sender, or from a subframe, is dropped. What the window then says is
 * checked for shape (chunk bytes, a finite timestamp) and for honesty (the
 * configured size must be the one asked for) before it reaches the session.
 */

/** A hidden encoder that stops answering is a dead clip, but a busy 4K encode is
 * not a hang: `unresponsive` only fails the recording if the window has not
 * recovered by then. */
const UNRESPONSIVE_GRACE_MS = 5_000;

/** Every live encoder window, so `before-quit` can dispose them all. */
const live = new Set<() => void>();

/** Dispose every live encoder window, synchronously. Called at quit and by the
 * host's stop; each recording's own dispose is idempotent. */
export function disposeAllRecordingEncoders(): void {
	for (const dispose of [...live]) {
		try {
			dispose();
		} catch {
			// Quit must not stop on one window that is already gone.
		}
	}
}

interface Route {
	windowId: number;
	handle: (event: EncoderEvent) => void;
}

const routes = new Map<number, Route>();
let listening = false;

function listen(): void {
	if (listening) return;
	listening = true;
	ipcMain.on(RECORDING_ENCODER_EVT_CHANNEL, (event, message: unknown) => {
		const route = routes.get(event.sender.id);
		if (!route) return;
		// Only the window's own main frame speaks for it.
		if (event.senderFrame && event.senderFrame !== event.sender.mainFrame)
			return;
		if (!message || typeof message !== "object") return;
		route.handle(message as EncoderEvent);
	});
}

export interface RecordingEncoderHostOptions {
	/** The app's own bundled `recording-encoder.html`. Never caller-supplied. */
	documentUrl: string;
	/** `out/preload/recording-encoder.js`. */
	preloadPath: string;
	log: (message: string) => void;
}

export function createRecordingEncoderService(
	options: RecordingEncoderHostOptions,
): RecordingEncoderService {
	return {
		open: (sink) => openWindow(options, sink),
	};
}

async function openWindow(
	options: RecordingEncoderHostOptions,
	sink: EncoderSink,
): Promise<EncoderHost> {
	listen();
	// No `persist:` prefix: an in-memory partition, so the window leaves no profile
	// on disk and shares nothing with the app's or the driven tabs' sessions.
	const partition = `recording-encoder-${randomUUID()}`;
	const childSession = session.fromPartition(partition);
	childSession.setPermissionRequestHandler((_contents, _permission, callback) =>
		callback(false),
	);
	childSession.setPermissionCheckHandler(() => false);
	childSession.on("will-download", (event) => event.preventDefault());

	const window = new BrowserWindow({
		// Never shown, focused or raised: `show: false` with Electron's default
		// `paintWhenInitiallyHidden` is the measured-working pair for the console
		// capture view, and an encoder needs no pixels of its own.
		show: false,
		width: 320,
		height: 240,
		webPreferences: {
			partition,
			preload: options.preloadPath,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			javascript: true,
			backgroundThrottling: false,
		},
	});
	const contents = window.webContents;
	const windowId = contents.id;
	let disposed = false;
	/** What each configure asked for, to hold the answer to it. */
	const requested = new Map<number, { width: number; height: number }>();
	let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;

	const waiters = {
		ready: null as null | { resolve: () => void; reject: (e: Error) => void },
		configure: new Map<number, (answer: ConfigureAnswer) => void>(),
		flush: new Map<
			number,
			{ resolve: () => void; reject: (e: Error) => void }
		>(),
	};

	const failWaiters = (reason: string): void => {
		const error = new BrowserHostError("internal", reason, {
			reason: "record_failed",
		});
		waiters.ready?.reject(error);
		waiters.ready = null;
		for (const waiter of waiters.flush.values()) waiter.reject(error);
		waiters.flush.clear();
		// A pending configure resolves as an unavailable encoder: the start has not
		// produced a clip yet, so it is the start's refusal and not a failed clip.
		for (const [, resolve] of waiters.configure) {
			resolve({ ok: false, why: "encoder_start", detail: reason });
		}
		waiters.configure.clear();
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		live.delete(dispose);
		routes.delete(windowId);
		if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
		unresponsiveTimer = null;
		failWaiters("the encoder window was closed");
		try {
			if (!window.isDestroyed()) window.destroy();
		} catch {
			// Already gone.
		}
		try {
			void childSession.clearStorageData().catch(() => undefined);
		} catch {
			// An in-memory partition has nothing worth clearing past the window.
		}
	};
	live.add(dispose);

	const died = (reason: string): void => {
		if (disposed) return;
		options.log(`[browser] recording encoder window: ${reason}`);
		failWaiters(reason);
		sink.onFailure(reason);
	};

	routes.set(windowId, {
		windowId,
		handle: (event) => {
			if (disposed) return;
			switch (event.evt) {
				case "ready":
					waiters.ready?.resolve();
					waiters.ready = null;
					return;
				case "configured": {
					const resolve = waiters.configure.get(event.id);
					waiters.configure.delete(event.id);
					if (!resolve) return;
					// The answer must describe what was asked for: a coded size that is
					// not the requested one would be written into the file's headers.
					const asked = requested.get(event.id);
					requested.delete(event.id);
					if (
						event.ok &&
						(!asked ||
							event.width !== asked.width ||
							event.height !== asked.height ||
							(event.encoder !== "hardware" && event.encoder !== "software"))
					) {
						resolve({
							ok: false,
							why: "encoder_start",
							detail: "the encoder answered with a size that was not asked for",
						});
						return;
					}
					resolve(
						event.ok
							? {
									ok: true,
									encoder: event.encoder,
									codec: event.codec,
									width: event.width,
									height: event.height,
								}
							: {
									ok: false,
									why: event.why,
									detail: String(event.detail).slice(0, 300),
								},
					);
					return;
				}
				case "chunk": {
					// The document is the app's own, but a message is only as trusted as
					// its shape: the cap sums `data.length`, so a non-bytes payload would
					// make it `NaN` and the cap would never fire.
					if (
						!(event.data instanceof Uint8Array) ||
						!Number.isFinite(event.ts) ||
						typeof event.key !== "boolean" ||
						(event.description !== undefined &&
							!(event.description instanceof Uint8Array))
					) {
						died("the encoder sent a malformed chunk");
						return;
					}
					sink.onChunk({
						data: event.data,
						ts: event.ts,
						key: event.key,
						description: event.description,
					});
					return;
				}
				case "frame-done":
					if (!Number.isInteger(event.seq)) return;
					sink.onFrameDone(event.seq);
					return;
				case "flushed": {
					const waiter = waiters.flush.get(event.id);
					waiters.flush.delete(event.id);
					waiter?.resolve();
					return;
				}
				case "error":
					died(`the encoder reported an error: ${event.message}`);
					return;
			}
		},
	});

	contents.setWindowOpenHandler(() => ({ action: "deny" }));
	const base = options.documentUrl.split("?")[0];
	const pin = (event: Electron.Event, url: string): void => {
		if (url.split("?")[0] !== base) event.preventDefault();
	};
	contents.on("will-navigate", pin);
	contents.on("will-redirect", pin);
	contents.on("render-process-gone", (_event, details) =>
		died(`the encoder process exited (${details?.reason ?? "unknown"})`),
	);
	contents.on("unresponsive", () => {
		if (unresponsiveTimer || disposed) return;
		unresponsiveTimer = setTimeout(() => {
			unresponsiveTimer = null;
			died("the encoder window stopped responding");
		}, UNRESPONSIVE_GRACE_MS);
		unresponsiveTimer.unref?.();
	});
	contents.on("responsive", () => {
		if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
		unresponsiveTimer = null;
	});

	const send = (message: EncoderCommand): void => {
		if (disposed || contents.isDestroyed()) return;
		contents.send(RECORDING_ENCODER_CMD_CHANNEL, message);
	};

	try {
		const ready = new Promise<void>((resolve, reject) => {
			waiters.ready = { resolve, reject };
		});
		// The listener is registered before the load, so a `ready` that arrives with
		// the document's first script is not missed.
		const loaded = contents.loadURL(options.documentUrl);
		await Promise.all([ready, loaded]);
	} catch (error) {
		dispose();
		throw error;
	}

	let configureId = 0;
	let flushId = 0;
	return {
		configure(request: Omit<EncoderConfigRequest, "id">) {
			configureId += 1;
			const id = configureId;
			return new Promise<ConfigureAnswer>((resolve) => {
				waiters.configure.set(id, resolve);
				requested.set(id, { width: request.width, height: request.height });
				send({ cmd: "configure", id, ...request });
			});
		},
		frame(seq, data, ts) {
			send({ cmd: "frame", seq, data, ts });
		},
		flush() {
			flushId += 1;
			const id = flushId;
			return new Promise<void>((resolve, reject) => {
				if (disposed) {
					reject(
						new BrowserHostError("internal", "the encoder window is gone", {
							reason: "record_failed",
						}),
					);
					return;
				}
				waiters.flush.set(id, { resolve, reject });
				send({ cmd: "flush", id });
			});
		},
		dispose,
	};
}
