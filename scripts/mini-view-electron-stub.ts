/**
 * A stand-in for Electron's `electron` module, for the mini view's unit tests.
 *
 * WHY IT EXISTS. `src/main/mini-view.ts` imports `BrowserWindow`, `ipcMain`,
 * `screen` and `app` as VALUES, and the desktop suite bundles the shipped
 * TypeScript in memory (the same harness `console-host.test.mjs` uses), where
 * an unaliased `electron` resolves to a package that throws when the binary's
 * `path.txt` is not where it expects it. The alias substitutes this module so
 * the module's PURE half — `miniViewUrlFor` — can be exercised against the real
 * bytes, and so a test can assert that importing the module registers nothing.
 *
 * WHAT IT MODELS. The import surface, and `ipcMain`'s handler registry, because
 * the dismiss channel is the module's only registration and a test may want to
 * see it appear. `new BrowserWindow(...)` DELIBERATELY THROWS: window
 * construction is not faked here, because a fake would be a second description
 * of the options the real window is built with. The real window's options,
 * geometry and presentation sequence are the evidence scene's business
 * (`scripts/renderer-driver.mjs --scene mini-view`, driven against the built
 * app), and this stub points there rather than inventing a second answer.
 */

export class BrowserWindow {
	constructor() {
		throw new Error(
			"the mini-view electron stub does not construct windows; window behaviour is covered by `--scene mini-view` against the built app",
		);
	}
}

/** The handler registry, keyed by channel, so a test can see registrations. */
export const ipcMain = {
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
	handle(
		channel: string,
		handler: (event: unknown, ...args: unknown[]) => unknown,
	) {
		if (ipcMain.handlers.has(channel)) {
			throw new Error(`a handler for ${channel} is already registered`);
		}
		ipcMain.handlers.set(channel, handler);
	},
	removeHandler(channel: string) {
		ipcMain.handlers.delete(channel);
	},
};

/** The positions and displays a test may seed; never read by the pure halves. */
export const screen = {
	cursor: { x: 0, y: 0 },
	getCursorScreenPoint() {
		return screen.cursor;
	},
	getDisplayNearestPoint() {
		return {
			workArea: { x: 0, y: 0, width: 1440, height: 900 },
		};
	},
};

/** The quit path's focus-return half; recorded rather than performed. */
export const app = {
	hidden: 0,
	hide() {
		app.hidden += 1;
	},
};

/**
 * The channels currently registered against this stub, so a test can assert
 * that IMPORTING `src/main/mini-view.ts` registers none — the module-level
 * purity its whole design rests on. Real registrations (the dismiss channel)
 * happen inside `createMiniView`, which unit tests never call.
 */
export function __registeredChannels(): string[] {
	return [...ipcMain.handlers.keys()];
}
