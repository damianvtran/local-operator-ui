import { SESSION_COOKIE_QUIT_BUDGET_MS } from "./browser/session-cookie-quit-hold";

/**
 * The hard deadline every quit carries, so the quit's one terminal-less phase
 * gets a terminal.
 *
 * WHY IT EXISTS (2026-10-11 incident). The operator's 23:52 install quit like
 * every other one - the session-cookie snapshot was saved, the owned backend's
 * generation stopped, the browser and console hosts stopped, `before-quit`'s
 * pass 2 logged "App is about to quit" - and then the process sat alive with no
 * window for 26 m 49 s, logging nothing, until the operator killed its pid by
 * hand. A read-only post-mortem accounted for every holder and refuser in the
 * quit path (the cookie hold had released, the owned cleanup was complete, the
 * mini view had stood down and been destroyed, no renderer refused its close,
 * and every watchdog/spawn is detached, ignored and unref'd), so the stall lived
 * in the one phase with no terminal, no bound and no log: between "Electron
 * closes the windows when `before-quit`'s synchronous part returns" and
 * `will-quit`. `will-quit` itself has a terminal once reached (its failsafe and
 * its `app.exit`), but a quit that never reaches it had nothing - and tonight's
 * post-mortem could not even say which stage it died in. This module is the
 * missing terminal, and the phase marker is the missing line in the record.
 *
 * WHY IT IS A MODULE, and not a bare `setTimeout` in `index.ts` where the
 * will-quit failsafe lives: `index.ts` cannot be booted by a test, and the
 * fired deadline is precisely the evidence a post-mortem reads - that it fired
 * ONCE, with the RIGHT phase, and that the one cancellation releases it instead
 * of letting a stale timer kill a healthy process. The same reason
 * `quit-state.ts` and `browser/session-cookie-quit-hold.ts` are modules.
 *
 * THE CONTRACT, which `index.ts`'s call sites implement and
 * `scripts/window-mode.test.mjs` pins at the source:
 *
 * - ARMED in `before-quit`'s SYNCHRONOUS part, beside `quitState.begin()` and
 *   BEFORE the session-cookie hold can wait - the hold can sit for its whole
 *   budget while the window is already doomed, and a deadline armed after it
 *   would miss exactly the waits the quit's contract already bounds.
 * - UNREF'D. The deadline exists for a process that is FAILING to leave, so it
 *   must never be a reason for the process to stay. Same rule as the will-quit
 *   failsafe and the headless exit deadline.
 * - NEVER cleared by the ordinary teardown. A `will-quit` continuation that
 *   reassures the deadline is the 2026-10-11 shape read backwards: the
 *   completion it would report is the one that never arrived. The ONLY release
 *   is `quitState.cancel()` - the setup dialog's declined answer, the quit's one
 *   cancellation - because a cancelled quit runs on into normal life, and a
 *   stale deadline must not later kill it.
 * - ON FIRE the caller names the phase in the log, completes the quit's exit
 *   obligations (the reopen record: `scheduleReopenAtQuitTerminal`, idempotent,
 *   which already stands down when the update lane owns the relaunch) and exits
 *   with FAILURE: the quit is being abandoned mid-teardown, which is what
 *   `app.exit(1)` says everywhere else on this path.
 *
 * The phase marker is deliberately small: four strings over the quit's life,
 * updated by the quit's own sites, purely so the next post-mortem can NAME the
 * stage the deadline fired in.
 */

/**
 * Headroom between the deadline and the bounds it contains.
 *
 * The deadline must not fire inside a step that is legitimately at its own
 * bound: the session-cookie hold gets `SESSION_COOKIE_QUIT_BUDGET_MS`, and the
 * owned cleanup gets `QUIT_CLEANUP_FAILSAFE_MS` twice over (once for
 * `before-quit`'s stop, once for `will-quit`'s). The sum below is the shape the
 * will-quit failsafe already uses: a term per bounded wait plus a margin so the
 * two cannot land in the same millisecond. 5 s matches `QUIT_FAILSAFE_MARGIN_MS`
 * for the same reason it exists there.
 */
export const QUIT_EXIT_DEADLINE_MARGIN_MS = 5_000;

/**
 * The deadline's duration, derived - never restated - from the bounds in front
 * of the phase it bounds.
 *
 * TERMS: the session-cookie hold (`SESSION_COOKIE_QUIT_BUDGET_MS`), and the
 * quit's own cleanup failsafe (`QUIT_CLEANUP_FAILSAFE_MS`, passed in because its
 * terms live in `index.ts` next to the handler that owns them), plus the margin
 * above. On the incident build those terms resolve to ~116.5 s:
 *
 *   1_500 + (38_000 + 63_000 + 8_000 + 1_000 + 5_000) + 5_000 = 121_500 ms.
 *
 * The deep-dive that designed this deadline estimated "~40 s" from a stale
 * "~34 s" comment beside the headless deadline; the failure that matters is
 * fixed either way (the wedge was 26 m 49 s of silence), and the derivation
 * above is the one that cannot cut off a quit working through bounds the repo
 * itself sized. A future bound change moves the deadline because it moves a
 * term, which is why the suite ties the two numerically rather than restating
 * the number.
 */
export function quitExitDeadlineMs(input: {
	quitCleanupFailsafeMs: number;
}): number {
	return (
		SESSION_COOKIE_QUIT_BUDGET_MS +
		input.quitCleanupFailsafeMs +
		QUIT_EXIT_DEADLINE_MARGIN_MS
	);
}

export interface QuitExitDeadline {
	/**
	 * Arm for a quit that has begun, with the stage its first phase goes by.
	 * Idempotent for the quit: a re-entrant `before-quit` (the hold's re-quit,
	 * the window-close path) must not restart the clock or lose the stage.
	 */
	arm(stage: string): void;
	/** Move the phase marker to the stage the quit has reached. */
	phase(stage: string): void;
	/** Release it - ONLY for a quit that was cancelled (`quitState.cancel()`). */
	release(): void;
}

export function createQuitExitDeadline(input: {
	timeoutMs: number;
	/** The caller's fire body: log the phase, complete the exit, `app.exit(1)`. */
	onFire(firedInStage: string): void;
}): QuitExitDeadline {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stage = "";
	return {
		arm(next) {
			if (timer) return;
			stage = next;
			timer = setTimeout(() => {
				// One shot: whatever the fire body does, this deadline is spent -
				// re-arming would need a new quit, which only `arm` can start.
				timer = null;
				input.onFire(stage);
			}, input.timeoutMs);
			/*
			 * Never a reason for the process to stay alive by itself: the deadline
			 * exists for a process that is already failing to leave, so keeping it
			 * up is the one thing it must not do.
			 */
			timer.unref();
		},
		phase(next) {
			stage = next;
		},
		release() {
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
}
