/**
 * Whether this process has begun quitting — and has not been cancelled since.
 *
 * WHY IT IS ITS OWN MODULE. The state gates three different decisions in
 * `index.ts` (the `second-instance` target, the macOS `activate` handler, and
 * the window-CREATE path) and it has TWO transitions that must stay
 * discoverable: set at `before-quit`'s first entry, released when the one quit
 * that can be cancelled is cancelled. As a bare boolean those transitions
 * lived as one assignment each, 700 lines apart, and round 1's finding (F-1)
 * is what the arrangement cost: the release did not exist, so a cancellation
 * left the flag set and refused every later second launch and Dock click for
 * the process's life. Here the contract is one small object a test can drive
 * without booting the app, the same reason `session-cookie-quit-hold.ts` is a
 * module of its own.
 *
 * THE DEFECT THE STATE ANSWERS (#636). Cmd+Q closes the window at once, but the
 * teardown keeps running — the session-cookie hold in `before-quit` (bounded at
 * 1500 ms) and the owned backend's stop in `will-quit` (seconds of it) — with
 * the single-instance lock still held. A relaunch inside that window loses the
 * lock and forwards its request to the dying instance, and before this state
 * existed that instance answered it with a window of its own, which appeared
 * over the teardown and died with it: "the relaunched app opens onto the app
 * still shutting down." Once `isQuitting()` is true, no request that would
 * create or raise a window is answered with one (`applied=skipped+quitting`).
 *
 * WHEN IT IS SET, AND WHY THAT INSTANT. At the FIRST `before-quit` entry,
 * ahead of the session-cookie hold: the hold can wait for up to 1500 ms while
 * the operator's window is already doomed, and that is exactly the state the
 * operator's report describes — a relaunch answered by a process whose window
 * is gone but whose lock and teardown are not. Anything set later would miss
 * the hold's whole duration.
 *
 * THE ONE CANCELLATION, AND WHY THE RELEASE EXISTS (round-1 review, F-1).
 * `app.quit()`'s contract stops a quit when a window refuses its close. This
 * app has exactly ONE such refusal that can land inside a running quit: the
 * setup window's close interception during a backend install, whose "Quit
 * without setup?" answered "Keep setting up" (`cancelId: 0`, the default) lets
 * the quit abort and leaves the run exactly where it was — the process serving,
 * setup continuing. Every other close guard cannot cancel a running quit: the
 * mini view's close-to-hide interception is stood down by `miniView.dispose()`
 * in `before-quit` before any window is asked to close, and the two quit
 * holders (the session-cookie hold and the `will-quit` owned-cleanup pass)
 * RE-ISSUE the quit they held rather than cancelling it. A cancellation that
 * left this state set would refuse every later request for the process's life
 * although the app is running normally — so `cancel()` is the one way back,
 * the installer calls it through `onQuitCancelled` from the declined dialog,
 * and both halves are pinned: the setter/release sites at the source in
 * `scripts/window-mode.test.mjs`, and the declined-answer behaviour by
 * `scripts/python-bytecode-cache.test.mjs` driving the shipped installer.
 *
 * WHERE IT MUST NOT BE RELEASED. A quit that PROCEEDS keeps it set: the
 * handed-over dialog answer ("Quit without setup") exits the process, the
 * close-during-the-terminal-hold path lets the quit run to completion, and
 * both holder passes re-quit — every one of those ends in a shutdown a window
 * created now could not survive, which is the whole reason the state exists.
 * The declined confirmation is the only release.
 */
export interface QuitState {
	/** A quit has begun — called at `before-quit`'s first entry, never later. */
	begin(): void;
	/** The quit was CANCELLED — the one release (see the note above). */
	cancel(): void;
	/** Whether a request must be refused rather than answered with a window. */
	isQuitting(): boolean;
}

export function createQuitState(): QuitState {
	let quitting = false;
	return {
		begin: () => {
			quitting = true;
		},
		cancel: () => {
			quitting = false;
		},
		isQuitting: () => quitting,
	};
}
