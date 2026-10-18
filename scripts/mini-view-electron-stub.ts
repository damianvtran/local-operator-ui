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
 * see it appear. `new BrowserWindow(...)` DELIBERATELY THROWS by default: window
 * construction is not faked here, because a fake would be a second description
 * of the options the real window is built with. The real window's options,
 * geometry and presentation sequence are the evidence scene's business
 * (`scripts/renderer-driver.mjs --scene mini-view`, driven against the built
 * app), and this stub points there rather than inventing a second answer.
 *
 * THE ONE OPT-IN (review round 2, F4): `__useFakeWindows()` swaps construction
 * for a recorder whose only job is to answer "did the live glass path call the
 * window, in what order". That question is behavioural and cannot be asked of
 * the built app from here; the fake records calls and paints nothing, so it
 * cannot be mistaken for an answer about how the window looks (which stays the
 * evidence scene's). Tests that do not opt in keep the refusal.
 */

type RecordedCall = { method: string; args: unknown[] };

const calls: RecordedCall[] = [];
let fakeWindows = false;

/** The calls the fake window has received, in order. Test-only. */
export function __windowCalls(): RecordedCall[] {
	return calls;
}

/** Opt in to the recording fake for this process. Test-only. */
export function __useFakeWindows(): void {
	fakeWindows = true;
}

export class BrowserWindow {
	destroyed = false;
	visible = false;
	readonly options: unknown;
	readonly webContents: {
		mainFrame: object;
		send: (channel: string, ...args: unknown[]) => void;
		on: (...args: unknown[]) => void;
		once: (...args: unknown[]) => void;
	};

	constructor(options?: unknown) {
		if (!fakeWindows) {
			throw new Error(
				"the mini-view electron stub does not construct windows; window behaviour is covered by `--scene mini-view` against the built app (opt in with __useFakeWindows() for the glass-call recorder)",
			);
		}
		this.options = options;
		calls.push({ method: "construct", args: [options] });
		this.webContents = {
			mainFrame: {},
			send: (channel, ...args) => {
				calls.push({ method: "webContents.send", args: [channel, ...args] });
			},
			on: () => {},
			once: () => {},
		};
	}

	isDestroyed(): boolean {
		return this.destroyed;
	}
	isVisible(): boolean {
		return this.visible;
	}
	loadURL(url: string): Promise<void> {
		calls.push({ method: "loadURL", args: [url] });
		return Promise.resolve();
	}
	on(): void {}
	once(): void {}
	hide(): void {
		this.visible = false;
		calls.push({ method: "hide", args: [] });
	}
	destroy(): void {
		this.destroyed = true;
		calls.push({ method: "destroy", args: [] });
	}
	getBounds() {
		return { x: 0, y: 0, width: 360, height: 200 };
	}
	getContentBounds() {
		return { x: 0, y: 0, width: 360, height: 200 };
	}
	setContentSize(width: number, height: number): void {
		calls.push({ method: "setContentSize", args: [width, height] });
	}
	setPosition(x: number, y: number): void {
		calls.push({ method: "setPosition", args: [x, y] });
	}
	setVisibleOnAllWorkspaces(): void {
		calls.push({ method: "setVisibleOnAllWorkspaces", args: [] });
	}
	setBackgroundColor(color: string): void {
		calls.push({ method: "setBackgroundColor", args: [color] });
	}
	setVibrancy(material: string | null): void {
		calls.push({ method: "setVibrancy", args: [material] });
	}
	setBackgroundMaterial(material: string): void {
		calls.push({ method: "setBackgroundMaterial", args: [material] });
	}
}

/** The handler registry, keyed by channel, so a test can see registrations. */
export const ipcMain = {
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
	listeners: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
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
	on(channel: string, listener: (event: unknown, ...args: unknown[]) => void) {
		ipcMain.listeners.set(channel, listener);
	},
	removeListener(channel: string) {
		ipcMain.listeners.delete(channel);
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
 * happen inside `createMiniView`, which unit tests call only with the fake
 * window opted in.
 */
export function __registeredChannels(): string[] {
	return [...ipcMain.handlers.keys()];
}
