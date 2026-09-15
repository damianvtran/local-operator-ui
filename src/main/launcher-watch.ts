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
 * Why two consecutive misses and not one: the launcher pid stopping and the pid
 * being *absent* are the same observation, but a pid observed once can race a
 * launcher that is still winding down (or a `kill(pid, 0)` that fails for a
 * reason other than absence — a permission answer is "alive" and the caller's
 * probe is what decides that). One interval of patience costs at most
 * `missesBeforeGone * intervalMs` of an abandoned instance and removes the
 * possibility of quitting on a single misread while the launcher is still
 * there. A reparent (`process.ppid` no longer naming the launcher) is the
 * launcher's own death certificate and is counted the same way, because it is
 * the same fact seen from the child's side.
 */

/** How many consecutive misses mean the launcher is gone. See the note above. */
export const LAUNCHER_MISSES_BEFORE_GONE = 2;

export interface LauncherWatch {
	/** Stop asking. Idempotent, and safe to call after the watch has fired. */
	stop(): void;
}

/**
 * Poll `launcherPid` until it goes, then call `onLauncherGone` once.
 *
 * The probe and the parent read are injected rather than read from `process`
 * here so the state machine can be tested directly — with a fake clock and a
 * fake pid, not by forking something and killing it — while the shipped call
 * site in `index.ts` passes the real ones.
 */
export function startLauncherWatch(input: {
	/** The pid that launched this app; never 1 (see `resolveLauncherWatchPlan`). */
	launcherPid: number;
	/** How often to ask. */
	intervalMs: number;
	/** Whether a pid is still there. `false` is the only answer that counts as gone. */
	isAlive: (pid: number) => boolean;
	/** This process's current parent, read fresh each poll. */
	parentPid: () => number;
	/** Called once, with a line saying what was observed. */
	onLauncherGone: (detail: string) => void;
	missesBeforeGone?: number;
}): LauncherWatch {
	const threshold = input.missesBeforeGone ?? LAUNCHER_MISSES_BEFORE_GONE;
	let misses = 0;
	let fired = false;
	const timer = setInterval(() => {
		if (fired) return;
		const parent = input.parentPid();
		const reparented = parent !== input.launcherPid;
		misses = reparented || !input.isAlive(input.launcherPid) ? misses + 1 : 0;
		if (misses < threshold) return;
		fired = true;
		clearInterval(timer);
		input.onLauncherGone(
			reparented
				? `pid ${input.launcherPid} is gone (this process was reparented to pid ${parent})`
				: `pid ${input.launcherPid} is gone`,
		);
	}, input.intervalMs);
	/*
	 * Never a reason for the app to stay alive by itself: the watch exists to
	 * END a run, so it must not be the thing holding one open.
	 */
	timer.unref?.();
	return {
		stop: () => {
			fired = true;
			clearInterval(timer);
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
