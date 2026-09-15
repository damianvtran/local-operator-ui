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
 * notifier reads (`isSupported`, and a constructed notification's `show`/`on`),
 * records what was raised, and does nothing else. `scripts/*-fixture` files of
 * the same shape are used by the other suites that need one part of an external
 * package.
 */
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
