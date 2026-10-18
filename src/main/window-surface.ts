import type { BrowserWindow } from "electron";
import {
	type WindowChromeController,
	type WindowChromeOptions,
	attachWindowChrome,
} from "./window-chrome";
import {
	type ResolvedLaunchGlass,
	type WindowGlassController,
	type WindowGlassOptions,
	attachWindowGlass,
} from "./window-glass";

/**
 * The window's two style owners, attached in the one order that is correct.
 *
 * WHY THIS IS A MODULE AND NOT TWO LINES IN `index.ts`. The order is the fix for a
 * visible defect (review R2 / QA Q3): `attachWindowChrome` paints the ground
 * synchronously and asks `isGlassActive` which colour to paint, so the glass
 * controller must exist BEFORE it - otherwise a window just built transparent is
 * repainted opaque and stays so until the renderer's first colour report (measured
 * 250-625 ms). `index.ts` cannot be driven by a test, and a regex over its source
 * proves a spelling, not a behaviour; this function can be driven with Electron
 * stubbed (`scripts/window-glass-main.test.mjs`), so the property is pinned where it
 * is made.
 *
 * `restoreGround` reaches the chrome controller lazily because the glass is
 * attached first and the chrome does not exist yet; it is only called on a
 * teardown, long after both are attached.
 */
export function attachWindowSurface(options: {
	window: BrowserWindow;
	glass: ResolvedLaunchGlass;
	userDataDir: string;
	chrome: Omit<WindowChromeOptions, "window" | "isGlassActive" | "userDataDir">;
	log: (line: string) => void;
	/** Forwarded to the glass controller: the popout's second window. */
	onGlassState?: WindowGlassOptions["onState"];
}): { glass: WindowGlassController; chrome: WindowChromeController } {
	let chromeController: WindowChromeController | null = null;
	const glass = attachWindowGlass({
		window: options.window,
		initial: options.glass,
		userDataDir: options.userDataDir,
		restoreGround: () => chromeController?.sync(),
		log: options.log,
		onState: options.onGlassState,
	});
	chromeController = attachWindowChrome({
		...options.chrome,
		window: options.window,
		userDataDir: options.userDataDir,
		isGlassActive: () => glass.isActive(),
	});
	return { glass, chrome: chromeController };
}
