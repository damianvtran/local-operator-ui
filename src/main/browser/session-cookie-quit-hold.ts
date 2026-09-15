/**
 * The hold that lets the browser host's session-cookie snapshot land before the
 * app exits.
 *
 * WHY IT IS A MODULE OF ITS OWN: the failure this guard exists for is in the
 * error path of an Electron event handler, and the only honest way to cover that
 * path is to drive the handler. Booting the app to do it would take the
 * operator's focus and make the app's logger write to their real log directory,
 * so the handler's decision is factored out here, dependency-injected and free of
 * any Electron import, and `scripts/session-cookies.test.mjs` bundles it and
 * drives it directly — including the rejection case.
 *
 * WHY THE BOUND IS HERE AND NOT AROUND THE SNAPSHOT: the hold is the only place
 * the user's quit is waiting, so it is the only place the promise "the quit is not
 * delayed by the snapshot" can be kept — whichever step of the stop turns out to
 * be the slow one. The stop's own steps are local and measured at 3 ms combined
 * on a loaded host; the snapshot is the part that reads over CDP, and it is the
 * part a spent budget costs.
 *
 * WHY THE `finally` IS THE FIX, not a style choice: `app.quit()` sat after the
 * `await`, so a rejected stop meant the rest of the handler never ran and the
 * quit was cancelled with nothing logged (measured in Electron 44.3.0: an
 * unhandled rejection in the main process fires `unhandledRejection` and does
 * NOT become an `uncaughtException`, so the app stayed alive with no window).
 * Because the hold had already been spent, the user's NEXT quit then bypassed it
 * and exited without the snapshot the hold exists to protect. The stop failing is
 * a reason to log and leave — never a reason to keep the app running.
 *
 * WHY THE HOLD'S STATE IS THE IN-FLIGHT WAIT rather than a spent boolean: the
 * boolean could only say "a hold has happened", so it answered two calls that are
 * not the same thing the same way — the re-entrant quit this hold issues once the
 * stop has settled (which must not be held again, or the app would never exit)
 * and a second quit from the user while the stop is still running (which must be
 * held, or that snapshot dies with the process). Measured in the pinned runtime against the boolean's shape: a quit at 168 ms, a second `app.quit()` at
 * 269 ms, and the process was gone at 269 ms with the stop and its snapshot still
 * running — this run's session cookies lost, and the next start reporting a crash
 * that never happened, which is the same misattribution an unavailable channel
 * used to produce. Two things make it a defect rather than a trade-off: the
 * second quit is the expected reflex exactly when the app looks stuck — and the
 * budget is not what answers that reflex, because the hold is cheap when the host
 * answers: round 1's 68-8776 ms is process-EXIT latency, while the hold this
 * module owns measured 13-29 ms over six quits in round 2 — and nothing in the log
 * distinguished "quit twice" from "crashed".
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
	/** Overrides `SESSION_COOKIE_QUIT_BUDGET_MS`. Injectable so a test can drive
	 * the expiry without waiting out the shipped budget. */
	budgetMs?: number;
}

/**
 * The most the quit may wait for the browser host's stop, and so for the
 * session-cookie snapshot inside it.
 *
 * WHY A BUDGET, measured rather than assumed: the snapshot reads the cookie jar
 * over CDP, so the stop's duration is the host's to inflate. What this bound
 * governs is the HOLD, and the hold is cheap whenever the host answers: round 2
 * measured 13-29 ms from SIGTERM to `host stopped` over six quits, with this
 * budget never firing. Round 1's 68-8776 ms against 47-70 ms on the control tree
 * is a different phase — process-EXIT latency — which this bound neither bounds
 * nor claims to. It exists for the host that withholds the CDP read, the case QA
 * constructed by SIGSTOPping the network service: there the stop never settles,
 * and without a bound the quit waits on the transport's own 15 s per-call ceiling.
 *
 * WHAT THE EXPIRY IS, and is not: it RELEASES the hold and asks for the quit
 * again — the log line says "quitting anyway" — and it is not an exit. Nothing in
 * a frozen teardown can promise one: QA's SIGSTOPped run logged the abandonment,
 * released the hold, and the process was still alive 42 s later, which is the
 * pre-existing teardown stall this host exposes rather than anything this hold
 * does. What the expiry guarantees is what the hold exists for: the user's quit is
 * no longer waiting on the snapshot, and this run's snapshot is abandoned.
 *
 * WHAT MAKES THAT SAFE: the marker rule, unchanged. The marker is written when a
 * run starts browsing and removed only after a complete snapshot, so a run whose
 * snapshot was abandoned leaves it behind, and the next start discards what is on
 * disk and says so. An incomplete snapshot is never trusted, and this path cannot
 * fall back to plaintext — it falls back to losing this run's session cookies,
 * which is the outcome the crash path already handles.
 *
 * WHY 1500 ms: the hold's own cost is about 20 ms when the host answers — 24 ms
 * for the whole stop on a loaded host, 21 ms of it the snapshot, and 13-29 ms
 * across round 2's six app quits — so this sits more than an order of magnitude
 * above the cost it is bounding and only fires on a host that is genuinely hostile
 * to the CDP read, where the alternative is waiting on the transport's 15 s
 * per-call ceiling. The abandoned
 * stop is NOT cancelled: it keeps running while the app tears down, and if it
 * completes before the process is gone the snapshot lands anyway (the write is
 * atomic, so the file is either the new sealed one or the previous one).
 */
export const SESSION_COOKIE_QUIT_BUDGET_MS = 1_500;

/**
 * Await `work` for at most `budgetMs`, reporting the expiry with its consequence.
 *
 * A rejection stays the caller's to handle — a failed stop must keep bouncing
 * through the caller's catch, not be swallowed here — while an expiry resolves,
 * because there is nothing left to wait for. The rejection handler is attached
 * even when the budget wins, so a failure arriving after the quit was released
 * cannot become an unhandled rejection.
 */
async function boundedByQuitBudget(
	work: Promise<void>,
	budgetMs: number,
	log: (message: string) => void,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<"budget-spent">((resolve) => {
		timer = setTimeout(() => resolve("budget-spent"), budgetMs);
		// The quit is what this wait precedes, so the timer must never be the reason
		// the process is still alive.
		timer.unref?.();
	});
	const outcome = await Promise.race([
		work.then(
			() => "settled" as const,
			(error: unknown) => error,
		),
		expired,
	]);
	if (timer) clearTimeout(timer);
	if (outcome === "budget-spent") {
		log(
			`the browser host did not stop within ${budgetMs} ms, so this run's session-cookie snapshot was abandoned and its session cookies are not saved (the next start will discard what is on disk); quitting anyway`,
		);
		return;
	}
	if (outcome !== "settled") throw outcome;
}

/** Returns true when this call held the quit (the caller must then return without
 * doing the rest of its shutdown work, which the re-quit will reach). */
export type SessionCookieQuitHold = (event: {
	preventDefault(): void;
}) => Promise<boolean>;

export function createSessionCookieQuitHold(
	deps: QuitHoldDeps,
): SessionCookieQuitHold {
	// The bounded wait every holder shares, i.e. the stop this hold is waiting on.
	// Held here rather than as a boolean because a boolean cannot tell the two
	// calls apart that this guard has to answer differently (see the module header).
	let wait: Promise<void> | null = null;
	// Set while this hold's own `deps.quit()` is in flight, and left set until the
	// stop it released against is no longer owed: that re-quit is the only call
	// that may return false.
	let released = false;
	return async (event) => {
		if (!deps.isPending()) {
			// Nothing is owed, so there is nothing to hold for — and the stop the
			// previous hold released against is over, so forget it: a later owed stop is
			// a new snapshot and gets a full budget rather than inheriting a spent one.
			wait = null;
			released = false;
			return false;
		}
		if (released) return false;
		// The hold is the holder's only while it is the one that started the wait:
		// every later quit re-holds against the stop already running (Electron's
		// cancelled flag is per emission, so it still has to cancel its own), while
		// the single quit that releases them all is issued once, by this caller.
		const ownsWait = wait === null;
		// Must be synchronous, before the first await: Electron reads the cancelled
		// flag when the listener's synchronous part has run, so a hold that deferred
		// this would not cancel the quit it thinks it is holding.
		event.preventDefault();
		try {
			// `stopBrowserHost()` hands every caller the first caller's promise, so a
			// second quit joins the stop already running instead of starting another —
			// and, because every holder awaits this one bounded wait, cannot extend it.
			let holding = wait;
			if (ownsWait) {
				holding = boundedByQuitBudget(
					deps.stop(),
					deps.budgetMs ?? SESSION_COOKIE_QUIT_BUDGET_MS,
					deps.log,
				);
				wait = holding;
			}
			if (holding) await holding;
		} catch (error) {
			deps.log(
				`the browser host stop failed while the quit was held for the session-cookie snapshot (${String(error)}); quitting anyway`,
			);
		} finally {
			if (ownsWait) {
				released = true;
				deps.quit();
			}
		}
		return true;
	};
}
