/**
 * The Electron half of the renderer dev driver: three `ipcMain` handlers, and
 * nothing else.
 *
 * Registered ONLY when `resolveDevDriverArming` says the launch asked for the
 * driver, which is what makes the gate main-authoritative rather than a promise
 * the preload makes about itself. An unarmed process has no `dev-driver-*`
 * handler at all, so `ipcRenderer.invoke` reaches Electron's own "No handler
 * registered for 'dev-driver-capture'" — a refusal the driver script asserts on
 * in `--gate-check`, from a real boot, rather than inferring from a flag it read
 * in its own process.
 *
 * Every handler authorizes its sender the way `registerDesktopIPC` does — same
 * window, same main frame, same trusted document URL — because these are more
 * privileged than they look: `capture` writes a file, and `facts` reports window
 * geometry and focus. A remote or third-party frame that could reach them would
 * get a picture of the operator's desktop content, which is exactly the class of
 * capability the desktop namespace takes this much care over.
 *
 * `capture` uses `webContents.capturePage()` — the app capturing itself — rather
 * than a screenshot tool or a browser engine. That is what AGENTS.md requires of
 * any evidence run (macOS `screencapture` photographs the FRONTMOST window,
 * which would mean taking the operator's focus), and it is why this harness
 * needs no Playwright, no Puppeteer and no downloaded Chromium.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { trustedDesktopFrame } from "./desktop-transport";
import {
	DEV_DRIVER_CAPTURE,
	DEV_DRIVER_FACTS,
	TRANSCRIPT_OBSERVE_CHANNEL,
	TRANSCRIPT_OBSERVE_LIMITS,
	validTranscriptObservation,
} from "./dev-driver";

/**
 * A frame label becomes a file name, so it is constrained rather than sanitized.
 *
 * Lowercase, digits, dash and underscore only. `.` is excluded on purpose: it is
 * the one character that could climb out of the frames directory
 * (`../../.ssh/authorized_keys`), and a driver that can only name its own frames
 * is a driver that cannot write anywhere else.
 */
const FRAME_LABEL = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface DevDriverIPCIdentity {
	/** The `[window-mode]` line's mode, so `facts` reports what the run actually was. */
	windowMode: string;
	appVersion: string;
	platform: string;
}

export function registerDevDriverIPC(options: {
	window: () => BrowserWindow | null;
	expectedUrl: string;
	outDir: string;
	identity: DevDriverIPCIdentity;
	/** Separate startup gate; never inferred from an IPC payload. */
	observationOnly?: boolean;
}): void {
	const { window, expectedUrl, outDir, identity } = options;
	mkdirSync(outDir, { recursive: true });

	const frames: string[] = [];

	function authorize(event: IpcMainInvokeEvent): BrowserWindow {
		const owner = window();
		if (
			!owner ||
			owner.isDestroyed() ||
			event.sender !== owner.webContents ||
			event.senderFrame !== owner.webContents.mainFrame ||
			!trustedDesktopFrame(event.senderFrame.url, expectedUrl)
		) {
			throw new Error("This window cannot use the dev driver.");
		}
		return owner;
	}

	/**
	 * The preload learns that this window is armed from the `additionalArguments`
	 * entry main put on the window (`devDriverArgument`), not from a channel: an
	 * `ipcRenderer.sendSync` to a channel with no listener never answers, which
	 * hung the renderer in an unarmed launch. Nothing is registered here for the
	 * preload to ask; the channels below are the whole surface.
	 */
	function geometry(owner: BrowserWindow) {
		const bounds = owner.getContentBounds();
		return {
			windowSize: {
				width: owner.getBounds().width,
				height: owner.getBounds().height,
			},
			contentBounds: {
				width: bounds.width,
				height: bounds.height,
			},
			visible: owner.isVisible(),
			focused: owner.isFocused(),
			minimized: owner.isMinimized(),
		};
	}
	function facts(owner: BrowserWindow) {
		return {
			...identity,
			title: owner.getTitle(),
			...geometry(owner),
			frames: [...frames],
			outDir,
		};
	}

	async function capture(
		owner: BrowserWindow,
		label: unknown,
		active?: () => boolean,
	) {
		if (typeof label !== "string" || !FRAME_LABEL.test(label)) {
			throw new Error(
				"Invalid frame label: lowercase letters, digits, dash and underscore only.",
			);
		}
		// `capturePage()` with no rect is the whole visible page, not the window:
		// at devicePixelRatio 2 that is twice the CSS viewport in pixels, which is
		// why the returned size is reported next to the frame rather than assumed.
		if (active) {
			const view = await owner.webContents.executeJavaScript(
				"({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })",
				true,
			);
			if (
				!active() ||
				![view?.width, view?.height, view?.devicePixelRatio].every(
					(n) => typeof n === "number" && Number.isFinite(n) && n > 0,
				) ||
				view.width * view.height * view.devicePixelRatio ** 2 >
					TRANSCRIPT_OBSERVE_LIMITS.pixels
			)
				throw new Error("Observation pixel budget or lifetime refused capture");
		}
		const image = await owner.webContents.capturePage();
		const pixels = image.getSize();
		// Recheck after async capture: navigation/DPR can change between the
		// preallocation guard and completion. Never write an oversized/stale PNG.
		if (
			active &&
			(!active() ||
				pixels.width * pixels.height > TRANSCRIPT_OBSERVE_LIMITS.pixels)
		)
			throw new Error("Observation capture became stale or oversized");
		const png = image.toPNG();
		if (active && !active())
			throw new Error("Observation lifetime expired during encoding");
		const file = join(outDir, `${label}.png`);
		writeFileSync(file, png, active ? { flag: "wx" } : undefined);
		frames.push(label);
		const size = image.getSize();
		const viewport = await owner.webContents.executeJavaScript(
			"({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })",
			true,
		);
		if (
			active &&
			(!active() ||
				![viewport?.width, viewport?.height, viewport?.devicePixelRatio].every(
					(n) => typeof n === "number" && Number.isFinite(n) && n > 0,
				))
		)
			throw new Error("Observation viewport completion refused");
		return {
			label,
			path: file,
			bytes: png.byteLength,
			pixels: { width: size.width, height: size.height },
			// The CSS viewport at capture time, read from the page rather than
			// derived from the window: a `BrowserWindow` size includes the
			// platform's window chrome, so 1380x900 is a 1380x872 viewport on
			// macOS and a frame labelled from the window would overstate it.
			viewport,
		};
	}
	// The ordinary preload already exposes generic ipcRenderer.invoke. Hiding
	// __loDevDriver is NOT a capability boundary: observation launches must omit
	// legacy channels entirely, including when their receipt path refuses arming.
	// Otherwise legacy capture could overwrite a bounded observer PNG and bypass
	// its lifetime, pixel and serialization checks. General driver contracts stay
	// unchanged in the mutually exclusive non-observation branch.
	if (options.observationOnly) installObservation();
	else {
		ipcMain.handle(DEV_DRIVER_FACTS, (event) => facts(authorize(event)));
		ipcMain.handle(DEV_DRIVER_CAPTURE, (event, label: unknown) =>
			capture(authorize(event), label),
		);
	}

	function installObservation(): void {
		// Automatic evidence must never overwrite or append to a prior launch's
		// receipts. General user-labelled capture retains its established contract.
		try {
			writeFileSync(join(outDir, "transcript-observation.jsonl"), "", {
				flag: "wx",
			});
		} catch {
			console.warn(
				"[transcript-observation] fresh evidence path unavailable; observation refused",
			);
			return;
		}
		const limits = TRANSCRIPT_OBSERVE_LIMITS;
		let owner: BrowserWindow | null = null;
		let revoked = false;
		let seq = -1;
		let generation = 0;
		let lastT = Number.NEGATIVE_INFINITY;
		let lastLayout = Number.NEGATIVE_INFINITY;
		let captures = 0;
		let inFlight = false;
		let stage = 0;
		let stopAt = 0;
		let late: boolean | null = null;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let evidenceFailed = false;
		const record = (value: object): boolean => {
			try {
				appendFileSync(
					join(outDir, "transcript-observation.jsonl"),
					`${JSON.stringify(value)}\n`,
				);
				return true;
			} catch {
				evidenceFailed = true;
				console.warn(
					"[transcript-observation] evidence write failed; observation refused",
				);
				return false;
			}
		};
		const active = () =>
			!revoked &&
			performance.now() <= stopAt &&
			owner !== null &&
			window() === owner &&
			!owner.isDestroyed() &&
			!owner.webContents.isDestroyed();
		const revoke = () => {
			if (revoked) return;
			revoked = true;
			clearTimeout(deadline);
			owner?.webContents.removeListener("did-start-navigation", navigation);
			owner?.webContents.removeListener("destroyed", revoke);
			if (!evidenceFailed)
				record({ phase: "revoked", receivedAt: Date.now(), seq });
		};
		const navigation = (...args: unknown[]) => {
			// Hash routing is the same trusted document; its root replacement is
			// tracked by generation. A new document/main frame can never re-arm.
			if (args[2] !== true && args[3] !== false) revoke();
		};
		ipcMain.handle(TRANSCRIPT_OBSERVE_CHANNEL, (event, input: unknown) => {
			if (owner && window() !== owner) revoke();
			const current = authorize(event);
			if (!validTranscriptObservation(input))
				throw new Error("Invalid observation schema/budget");
			if (!owner) {
				if (input.seq !== 0 || input.phase !== "preload-start")
					throw new Error("Observation missed startup arming");
				owner = current;
				stopAt = performance.now() + limits.ttlMs;
				late = input.late;
				owner.webContents.on("did-start-navigation", navigation);
				owner.webContents.once("destroyed", revoke);
				deadline = setTimeout(revoke, limits.ttlMs);
				deadline.unref();
			}
			if (current !== owner) revoke();
			if (
				!active() ||
				current !== owner ||
				input.late !== late ||
				input.seq !== seq + 1 ||
				input.generation < generation ||
				input.generation > generation + 1 ||
				input.t < lastT ||
				(input.phase === "layout" && input.t - lastLayout < 8)
			)
				throw new Error("Stale, reordered or rate-exceeded observation");
			if (
				(input.phase === "preload-start" && seq !== -1) ||
				(input.phase === "observer-installed" && seq !== 0) ||
				(input.phase === "transcript-detected" && stage !== 1) ||
				(input.phase === "layout" &&
					(stage < 1 || (input.rows.length > 0 && stage < 2)))
			)
				throw new Error("Observation phase ordering refused");
			if (input.phase === "observer-installed") stage = 1;
			if (input.phase === "transcript-detected") stage = 2;
			seq = input.seq;
			generation = input.generation;
			lastT = input.t;
			if (input.phase === "layout") lastLayout = input.t;
			if (
				!record({
					receivedAt: Date.now(),
					sample: input,
					lateArmed: input.late,
					window: geometry(current),
				})
			) {
				revoke();
				throw new Error("Observation evidence unavailable");
			}
			if (
				input.phase === "layout" &&
				input.rootCount === 1 &&
				input.rows.length > 0 &&
				captures < limits.pngs &&
				!inFlight
			) {
				const number = captures++;
				const sampleSeq = seq;
				const requestedAt = Date.now();
				inFlight = true;
				// Serial snapshots only, never a queue and never a first-compositor-
				// paint claim. capturePage may return pixels from a later state.
				void capture(current, `observation-${number}`, active)
					.then((result) => {
						if (
							!record({
								phase: "capture",
								sampleSeq,
								requestedAt,
								completedAt: Date.now(),
								bytes: result.bytes,
								pixels: result.pixels,
								viewport: result.viewport,
								frameOrdinal: number,
							})
						)
							revoke();
					})
					.catch(() => {
						record({
							phase: "capture-refused",
							sampleSeq,
							requestedAt,
							completedAt: Date.now(),
							code: "capture-rejected",
						});
						revoke();
					})
					.finally(() => {
						inFlight = false;
					});
			}
			return { accepted: seq, captures };
		});
	}
}
