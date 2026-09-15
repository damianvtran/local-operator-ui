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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { trustedDesktopFrame } from "./desktop-transport";
import { DEV_DRIVER_CAPTURE, DEV_DRIVER_FACTS } from "./dev-driver";

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
	ipcMain.handle(DEV_DRIVER_FACTS, (event) => {
		const owner = authorize(event);
		const bounds = owner.getContentBounds();
		return {
			...identity,
			title: owner.getTitle(),
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
			frames: [...frames],
			outDir,
		};
	});

	ipcMain.handle(DEV_DRIVER_CAPTURE, async (event, label: unknown) => {
		const owner = authorize(event);
		if (typeof label !== "string" || !FRAME_LABEL.test(label)) {
			throw new Error(
				"Invalid frame label: lowercase letters, digits, dash and underscore only.",
			);
		}
		// `capturePage()` with no rect is the whole visible page, not the window:
		// at devicePixelRatio 2 that is twice the CSS viewport in pixels, which is
		// why the returned size is reported next to the frame rather than assumed.
		const image = await owner.webContents.capturePage();
		const png = image.toPNG();
		const file = join(outDir, `${label}.png`);
		writeFileSync(file, png);
		frames.push(label);
		const size = image.getSize();
		return {
			label,
			path: file,
			bytes: png.byteLength,
			pixels: { width: size.width, height: size.height },
			// The CSS viewport at capture time, read from the page rather than
			// derived from the window: a `BrowserWindow` size includes the
			// platform's window chrome, so 1380x900 is a 1380x872 viewport on
			// macOS and a frame labelled from the window would overstate it.
			viewport: await owner.webContents.executeJavaScript(
				"({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio })",
				true,
			),
		};
	});
}
