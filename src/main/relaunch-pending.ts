/**
 * A reopen the user asked for while this process was quitting, kept until the
 * quit's terminal can complete it with ONE successor instance.
 *
 * WHY IT EXISTS (#755). A relaunch that lands during teardown is refused whole
 * (#636/#639: a window created by a dying process appears over the shutdown and
 * dies with it), and the refusal used to be the end of the request: the process
 * exited and the person who relaunched the app looked at nothing until they
 * tried again ("you have to close it again... wait at least several seconds").
 * This module is the COMPLETION half of that refusal: the two refusal sites
 * that mean "the user asked for the app" — a second launch and a macOS Dock
 * click — record what was asked for, and the quit's existing terminal (the
 * `will-quit` pass that already names itself "the completion") schedules one
 * successor with `app.relaunch` just before it exits. The successor starts
 * after this process is gone, takes the freed single-instance lock, and boots
 * as an ordinary launch under the recorded plan. No window is held open, nothing
 * waits on the quit, and the loser still exits immediately.
 *
 * WHY IT IS ITS OWN MODULE, in the `quit-state.ts` way: the record is written
 * by two refusals and spent by four terminal call sites, and as loose state in
 * `index.ts` those transitions would be invisible to tests. Here the contract
 * is one small object a test can drive without booting the app.
 *
 * EXACTLY ONCE IS LOAD-BEARING, NOT TIDINESS. `app.relaunch` starts one
 * instance per CALL ("When app.relaunch is called multiple times, multiple
 * instances will be started") — verified for this build by the #755 spike,
 * which measured two calls spawning two distinct successors. `scheduled` is
 * therefore what keeps the four terminal sites (whichever one runs) from
 * multiplying the user's reopen.
 *
 * WHAT THE RECORD HOLDS, and what it deliberately does not. The show plan is
 * the REQUESTER's (already resolved by `window-raise.ts`/`window-mode.ts` — not
 * this process's own launch plan), and the argv is the losing launch's
 * `commandLine` verbatim. Both come from the refusal, so the record can never
 * drift from what was refused. A `never` request is NOT recorded: a successor
 * for a headless/tooling shape would be an invisible instance outliving the
 * request that nobody asked to keep (see `canCreateWindowFor`), so the refusal
 * stays a refusal-with-a-line and `record` answers false.
 *
 * NOTHING DURABLE, ON PURPOSE. The record is in-memory and dies with the
 * process — no file to expire, nothing to trust after a crash, zero residue.
 * A hard kill before the terminal loses the record; that residual is documented
 * (the lock is simply free, so the person's next launch opens normally) rather
 * than repaired by persisting state this module must then defend.
 *
 * COMPLETION IS THE TERMINAL'S JOB, and that timing is the point: by the time
 * `will-quit` runs, the quit can no longer be cancelled, so a record can never
 * leak a spawn into some LATER, unrelated exit. The one cancellation a running
 * quit has (the setup dialog's declined answer) clears the record beside its
 * own cancellation instead — see `index.ts`'s `onQuitCancelled`.
 */
import { WINDOW_MODE_FLAG } from "./window-mode";
import type { WindowShow } from "./window-mode";
import { MODE_OF_SHOW, canCreateWindowFor } from "./window-raise";

/** A refused reopen, as the refusal that recorded it saw it. */
export interface PendingReopen {
	/**
	 * Which refusal recorded it. `second-instance` is a launch that lost the
	 * lock (it carries an argv to replay); `activate` is the operator's own
	 * Dock click, which names nothing.
	 */
	kind: "second-instance" | "activate";
	/** The show plan the REQUEST resolved to — never this process's own plan. */
	show: WindowShow;
	/**
	 * The losing launch's full command line (argv[0] included; the successor
	 * runs `argv.slice(1)`), or null for `activate`.
	 */
	argv: readonly string[] | null;
}

export interface RelaunchPending {
	/**
	 * Record a refused reopen. Returns true when the record was TAKEN — and the
	 * refusal line says `reopen=deferred` exactly when this is true, so the log
	 * and the completion cannot drift. Newest wins: a later refusal replaces an
	 * earlier one (it is the more recent statement of what the user wants).
	 */
	record(entry: PendingReopen): boolean;
	/** The quit was CANCELLED: nothing was asked for that still applies. */
	clear(): void;
	/**
	 * The quit reached a terminal: if a record exists, schedule the single
	 * successor and then return — the CALLER exits the process (that is what
	 * `app.relaunch` needs: it relaunches "when the current instance exits", so
	 * it is scheduled before the exit, never instead of it).
	 *
	 * IDEMPOTENT, AND AN EMPTY CALL IS NOT A SCHEDULED ONE. Once a call has
	 * actually scheduled (a record existed), further calls are no-ops — the
	 * four terminal sites may run in any order or repeatedly (`app.quit()`'s
	 * re-entries), and one reopen must stay one instance. But a call that found
	 * NO record must not latch: the common sequence is `will-quit`'s synchronous
	 * part running BEFORE the refusal lands, the refusal being recorded mid-
	 * teardown, and the continuation completing it — a latched empty call would
	 * drop exactly that reopen.
	 */
	scheduleOnExit(options: {
		/**
		 * `app.relaunch({ args })`. The caller owns the failure policy: a throw
		 * must be wrapped, logged and swallowed there so it cannot escape the
		 * terminal the quit is standing on.
		 */
		relaunch: (args: readonly string[]) => void;
	}): void;
}

/**
 * The successor's argv, composed the way the shape was ratified (memo §1.2/5):
 *
 * - `activate` is a plain reopen: `[]`. Nothing asked for anything to replay.
 * - `second-instance` replays the LOSING launch's command line minus argv[0] —
 *   the same command a person's relaunch carries — and appends
 *   `--window-mode=<the recorded show plan>` only when that command line does
 *   not already name one. Why the pin exists: the loser's ENVIRONMENT never
 *   crosses the instance boundary (#755 spike, measured: a successor inherits
 *   the SPAWNER's environment), so a mode that arrived via the environment
 *   would re-resolve to this process's plan instead of the request's. The
 *   mapping is the same one the raise line prints (`MODE_OF_SHOW`), so a mode
 *   token in the log and in the successor's argv can never disagree.
 */
function successorArgs(entry: PendingReopen): readonly string[] {
	if (entry.kind === "activate" || entry.argv === null) return [];
	const args = entry.argv.slice(1);
	const namesAMode = args.some(
		(argument) =>
			argument === WINDOW_MODE_FLAG ||
			argument.startsWith(`${WINDOW_MODE_FLAG}=`),
	);
	return namesAMode
		? args
		: [...args, `${WINDOW_MODE_FLAG}=${MODE_OF_SHOW[entry.show]}`];
}

export function createRelaunchPending(): RelaunchPending {
	let pending: PendingReopen | null = null;
	let scheduled = false;
	return {
		record: (entry) => {
			if (!canCreateWindowFor(entry.show)) return false;
			pending = {
				...entry,
				argv: entry.argv === null ? null : [...entry.argv],
			};
			return true;
		},
		clear: () => {
			/*
			 * The `scheduled` latch is deliberately NOT reset here. Reaching a
			 * terminal where it latches means the quit can no longer be
			 * cancelled, so a clear can never follow it — and keeping the latch
			 * monotonic is what makes exactly-once structural rather than a
			 * property of call order.
			 */
			pending = null;
		},
		scheduleOnExit: ({ relaunch }) => {
			if (scheduled) return;
			const entry = pending;
			if (entry === null) return;
			/*
			 * Latched BEFORE the call: `relaunch` is allowed to throw (the
			 * caller wraps and logs it), and a throw must not let a later
			 * terminal site call it a second time — one reopen, one call.
			 */
			scheduled = true;
			relaunch(successorArgs(entry));
		},
	};
}
