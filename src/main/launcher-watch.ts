/**
 * The watch that keeps a headless run from outliving the process that launched
 * it.
 *
 * Why this exists. A `headless` run is a window that is never shown, launched
 * by a harness — the dev driver, a QA rig, a shell that boots the built app and
 * drives it over CDP. Nothing closes it: there is no window anyone can click,
 * and macOS keeps a windowless process alive by design, so an app whose
 * launcher died stays up indefinitely, holding its memory and (before
 * `hideDock`) a Dock tile. Measured on this repo: 13 boots in one QA round left
 * 13 survivors, all reparented to launchd, and an evidence matrix left ~30 of
 * them. `app.dock.hide()` makes the accumulation invisible rather than absent,
 * which is why the lifetime half exists as well.
 *
 * What it is not: a reason for the process to stay alive. The interval is
 * `unref`'d, so nothing here can hold the loop open, and the watch only ever
 * ASKS — the caller decides what "gone" means for the app.
 *
 * Why two consecutive misses and not one: a launcher that is stopping and a pid
 * that is absent are the same observation, but one reading can race a launcher
 * that is still winding down, and a probe can fail for a reason that is not
 * absence. One interval of patience costs at most `missesBeforeGone * intervalMs`
 * of an abandoned instance and removes the possibility of quitting on a single
 * misread while the launcher is still there. Being reparented — `process.ppid`
 * no longer naming the launcher — is the launcher's own death certificate seen
 * from the child's side, and counts the same way.
 *
 * The state machine is `createLauncherWatch`: it takes a `poll()` you can call
 * yourself, precisely so the tests drive missed polls explicitly instead of
 * racing real timers. `startLauncherWatch` is the timer that calls it in the
 * app.
 */

/** How many consecutive misses mean the launcher is gone. See the note above. */
export const LAUNCHER_MISSES_BEFORE_GONE = 2;

/** What a fired watch tells its caller. */
export interface LauncherGone {
	/**
	 * One plain sentence for a person: the thing that started this app has
	 * exited. Printed to stdout, so it says the outcome rather than the
	 * mechanism — `pid 1` is trivia to whoever ran `pnpm dev:headless`.
	 */
	message: string;
	/**
	 * The technical reading, for the backend log and for a post-mortem: which
	 * observation fired (probe or reparent) and what it saw.
	 */
	detail: string;
}

export interface LauncherWatch {
	/**
	 * Ask once, now: has the launcher gone? Returns true only on the call that
	 * FIRES it — a watch that already fired answers false, and so does a stopped
	 * one (round 2, N5: one value, one meaning). Exposed so a test can step the
	 * machine without a clock.
	 */
	poll(): boolean;
	/**
	 * Stop asking. Idempotent, and safe to call after the watch has fired. The
	 * app calls it from `before-quit`, so a quit already under way cannot have a
	 * second one stacked on top of it by a poll that lands mid-shutdown.
	 */
	stop(): void;
}

/**
 * The watch's state machine, with no timer of its own.
 *
 * `isAlive` and `parentPid` are injected rather than read from `process` here so
 * the machine can be tested directly — a fake pid, a fake probe, explicit
 * misses — while the shipped call site passes the real ones. `parentPid` is a
 * function on purpose: the answer to "who is my parent now?" changes, and that
 * change is half the signal.
 */
export function createLauncherWatch(input: {
	/** The pid that launched this app; never 1 (see `resolveLauncherWatchPlan`). */
	launcherPid: number;
	/** Whether a pid is still there. `false` is the only answer that counts as gone. */
	isAlive: (pid: number) => boolean;
	/** This process's current parent, read fresh each poll. */
	parentPid: () => number;
	/** Called once, with what was observed. */
	onLauncherGone: (gone: LauncherGone) => void;
	missesBeforeGone?: number;
}): LauncherWatch {
	const threshold = input.missesBeforeGone ?? LAUNCHER_MISSES_BEFORE_GONE;
	let misses = 0;
	let fired = false;
	let stopped = false;
	return {
		poll: () => {
			/*
			 * `true` means "this call fired the watch", not "this watch is finished"
			 * (round 2, N5): an already-fired watch and a stopped one both answer false,
			 * because neither is firing now.
			 */
			if (fired || stopped) return false;
			const parent = input.parentPid();
			const reparented = parent !== input.launcherPid;
			misses = reparented || !input.isAlive(input.launcherPid) ? misses + 1 : 0;
			if (misses < threshold) return false;
			fired = true;
			input.onLauncherGone({
				message: `the process that launched this run (pid ${input.launcherPid}) has exited`,
				detail: reparented
					? `pid ${input.launcherPid} is gone (this process was reparented to pid ${parent})`
					: `pid ${input.launcherPid} is gone`,
			});
			return true;
		},
		stop: () => {
			stopped = true;
		},
	};
}

/** `createLauncherWatch` under a timer — the shape the app runs. */
export function startLauncherWatch(input: {
	launcherPid: number;
	intervalMs: number;
	isAlive: (pid: number) => boolean;
	parentPid: () => number;
	onLauncherGone: (gone: LauncherGone) => void;
	missesBeforeGone?: number;
}): LauncherWatch {
	const watch = createLauncherWatch(input);
	const timer = setInterval(() => watch.poll(), input.intervalMs);
	/*
	 * Never a reason for the app to stay alive by itself: the watch exists to
	 * END a run, so it must not be the thing holding one open.
	 */
	timer.unref?.();
	return {
		poll: watch.poll,
		stop: () => {
			clearInterval(timer);
			watch.stop();
		},
	};
}

/**
 * The real liveness probe: `kill(pid, 0)` and read the error.
 *
 * `ESRCH` is the only answer that means gone. `EPERM` means the pid exists but
 * belongs to another user (this app runs as one user, but a probe that reported
 * "gone" on a permission error would quit a run whose launcher is alive), and
 * any other error is not evidence of absence either.
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}
