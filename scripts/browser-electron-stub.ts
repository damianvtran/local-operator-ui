/**
 * A stand-in for Electron's `electron` module, for the desktop suite's
 * in-memory bundles.
 *
 * WHY IT EXISTS. `src/main/browser/consent-notifier.ts` imports `Notification`
 * from Electron as a VALUE, which is the one browser module in this repo that
 * does — every other one reaches Electron through a type-only import, and the
 * desktop suite's bundles rely on that ("no fixture is needed"). The unaliased
 * import resolves, in plain Node, to the electron package's own `index.js`, which
 * calls `getElectronPath()` at module scope and throws when the binary's
 * `path.txt` is not where it expects it. So a test that wants to exercise the
 * banner rule at all — and the rule is "one banner per count change", which the
 * live app can only ever show a human, and a headless run never shows anybody —
 * has to substitute the module.
 *
 * WHAT IT IS NOT: it is not a fake of Electron. It models the two members the
 * notifier reads (`isSupported`, and a constructed notification's `show`/`on`)
 * plus the one member the browser IPC module needs to be registrable
 * (`ipcMain.handle`), records what was raised, and does nothing else.
 * `scripts/*-fixture` files of the same shape are used by the other suites that
 * need one part of an external package.
 *
 * WHY `ipcMain` IS HERE (added with the conversation-attribution change): the
 * `browser-new-tab` argument is validated AT THE BOUNDARY, and a boundary that
 * is only tested through the function behind it is not tested at all. Registering
 * the real handlers against this registry lets a test invoke a channel the way the
 * renderer's `ipcRenderer.invoke` does — through the same `authorize` gate, the
 * same sender checks and the same validators the app runs.
 */

/**
 * `ipcMain`, as far as this repo's main process uses it: `handle`, with the
 * handlers reachable so a test can invoke one.
 *
 * The stored handler is what the channel's REAL registration passed, so a test
 * that invokes `browser-new-tab` exercises the shipped authorize gate and the
 * shipped validator rather than a copy of them.
 */
export const ipcMain = {
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),

	handle(
		channel: string,
		handler: (event: unknown, ...args: unknown[]) => unknown,
	): void {
		ipcMain.handlers.set(channel, handler);
	},

	/** Between registrations, so one test's handlers do not answer another's. */
	reset(): void {
		ipcMain.handlers.clear();
	},
};
export class Notification {
	/** What was raised, most recent last, so a test can assert the copy and the
	 * COUNT rather than only that something happened. */
	static raised: Array<{ title: string; body: string; silent: boolean }> = [];

	/** Flipped by tests that need the platform answer to be "no". */
	static supported = true;

	static isSupported(): boolean {
		return Notification.supported;
	}

	static reset(): void {
		Notification.raised = [];
		Notification.supported = true;
	}

	readonly options: { title: string; body: string; silent: boolean };

	#clickListeners: Array<() => void> = [];

	constructor(options: { title: string; body: string; silent: boolean }) {
		this.options = options;
	}

	on(event: "click", listener: () => void): void {
		if (event === "click") this.#clickListeners.push(listener);
	}

	show(): void {
		Notification.raised.push(this.options);
	}

	/** What a real click on the banner does. */
	click(): void {
		for (const listener of this.#clickListeners) listener();
	}
}
