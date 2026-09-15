/**
 * The once-per-quit hold that lets the browser host's session-cookie snapshot
 * land before the app exits.
 *
 * WHY IT IS A MODULE OF ITS OWN: the failure this guard exists for is in the
 * error path of an Electron event handler, and the only honest way to cover that
 * path is to drive the handler. Booting the app to do it would take the
 * operator's focus and make the app's logger write to their real log directory,
 * so the handler's decision is factored out here, dependency-injected and free of
 * any Electron import, and `scripts/session-cookies.test.mjs` bundles it and
 * drives it directly — including the rejection case.
 *
 * WHY THE `finally` IS THE FIX, not a style choice: `app.quit()` sat after the
 * `await`, so a rejected stop meant the rest of the handler never ran and the
 * quit was cancelled with nothing logged (measured in Electron 44.3.0: an
 * unhandled rejection in the main process fires `unhandledRejection` and does
 * NOT become an `uncaughtException`, so the app stayed alive with no window).
 * Because the hold had already been spent, the user's NEXT quit then bypassed it
 * and exited without the snapshot the hold exists to protect. The stop failing is
 * a reason to log and leave — never a reason to keep the app running.
 */

export interface QuitHoldDeps {
	/** Whether a browser-host stop is still owed, i.e. whether there is a
	 * session-cookie snapshot to wait for (`browserHostStopPending`). */
	isPending(): boolean;
	/** `stopBrowserHost()`. */
	stop(): Promise<void>;
	/** `app.quit()`. */
	quit(): void;
	/** Called when the stop fails, so a shutdown that could not complete cleanly
	 * leaves a line behind rather than the silence the defect above produced. */
	log(message: string): void;
}

/** Returns true when this call held the quit (the caller must then return without
 * doing the rest of its shutdown work, which the re-quit will reach). */
export type SessionCookieQuitHold = (event: {
	preventDefault(): void;
}) => Promise<boolean>;

export function createSessionCookieQuitHold(
	deps: QuitHoldDeps,
): SessionCookieQuitHold {
	// One hold per quit: the re-quit this function triggers must not be held
	// again, or the app would never exit.
	let held = false;
	return async (event) => {
		if (held || !deps.isPending()) return false;
		held = true;
		// Must be synchronous, before the first await: Electron reads the cancelled
		// flag when the listener's synchronous part has run, so a hold that deferred
		// this would not cancel the quit it thinks it is holding.
		event.preventDefault();
		try {
			await deps.stop();
		} catch (error) {
			deps.log(
				`the browser host stop failed while the quit was held for the session-cookie snapshot (${String(error)}); quitting anyway`,
			);
		} finally {
			deps.quit();
		}
		return true;
	};
}
