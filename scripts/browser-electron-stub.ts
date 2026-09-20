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

	/**
	 * The unregistration side. A namespace that can be registered twice in one
	 * process (the console's host can be stopped and restarted, and the evidence rig
	 * does exactly that) has to be able to remove its handlers, and a stub without
	 * this made that half of the shipped code untestable — which is how
	 * `unregisterConsoleIpc` came to be called by nothing in the suite.
	 */
	removeHandler(channel: string): void {
		ipcMain.handlers.delete(channel);
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

/**
 * `app`, as far as this repo's main process uses it in a bundled test.
 *
 * Added with the WebAuthn work: `src/main/webauthn.ts` imports `app` as a VALUE,
 * because the platform authenticator is configured once per process through
 * `app.configureWebAuthn`. The two members modelled are the two that module
 * reads — `isPackaged` (the gate's "unpackaged" arm) and the configuration call
 * itself, recorded so a test can assert WHAT was configured and, just as
 * importantly, that nothing was configured when the gate said no.
 *
 * `configureWebAuthn` is deliberately silent and non-throwing, which is what the
 * real call does when the entitlement is missing (measured; see the module's
 * header): a stub that threw would make the gate look load-bearing for a reason
 * the platform does not provide.
 */
export const app = {
	/** Flipped by tests: the gate's first check after the platform. */
	isPackaged: false,
	/** What was configured, most recent last. */
	webauthnConfigured: [] as Array<{
		touchID: { keychainAccessGroup: string; promptReason: string };
	}>,
	configureWebAuthn(options: {
		touchID: { keychainAccessGroup: string; promptReason: string };
	}): void {
		app.webauthnConfigured.push(options);
	},
	reset(): void {
		app.isPackaged = false;
		app.webauthnConfigured = [];
	},
};

/**
 * `contextBridge` and `ipcRenderer`, as far as `src/preload/index.ts` needs them
 * to LOAD.
 *
 * WHY THEY ARE HERE. The preload is where every inbound IPC payload is validated
 * — including the passkey chooser's, which is parsed by `parseWebauthnRequest` —
 * and a validator tested through a copy of itself is not tested. Importing the
 * real module is what makes the test bind the shipped parser, and the module
 * calls `contextBridge.exposeInMainWorld` at its own module scope, so the stub
 * has to answer that call. `ipcRenderer` is present for the same reason: the
 * module reads it at import time, and the channels that USE it are driven
 * elsewhere (through `ipcMain`'s handler registry, as the renderer's `invoke`
 * would).
 *
 * WHAT THEY ARE NOT: neither is a fake of Electron's bridge. `exposeInMainWorld`
 * records nothing and returns nothing — the exposed object is reachable in a real
 * renderer and is not simulated here — and `ipcRenderer.invoke` deliberately
 * REJECTS, so a test that reaches for the real transport by accident fails loudly
 * instead of silently talking to a stub.
 */
export const contextBridge = {
	exposeInMainWorld(): void {
		// Nothing to model: the exposure is a wiring step, and the wiring is
		// covered by the desktop-transport contract tests that boot the preload.
	},
};

export const ipcRenderer = {
	on(): void {},
	removeListener(): void {},
	async invoke(channel: string): Promise<never> {
		throw new Error(
			`the electron stub has no transport: ${channel} was invoked directly`,
		);
	},
};

/**
 * `webFrame`, which `@electron-toolkit/preload` imports at its module scope.
 *
 * Present so the preload MODULE loads. Nothing in this repo's own code calls a
 * member of it, and the suite never reaches a zoom or routing call, so an empty
 * object is the honest model rather than a set of methods that pretend to work.
 */
export const webFrame = {};
