/*
 * The one teardown a rig that booted the app `detached: true` has to run.
 *
 * WHY IT IS A MODULE RATHER THAN A COPY. Two rigs boot the app the same way -
 * `notification-hop-proof.mjs` and `mentioned-files-app-proof.mjs` - and each
 * carried its own copy of "signal the group, escalate, then reap what escaped by
 * exact pid". The copies had already drifted twice in ways a reader could not
 * see from either file: one failed OPEN when `ps` was unreadable while the other
 * failed closed, and only one of them registered the interruption signals, so an
 * interrupted run of the other left its tree behind. Both rigs still RENDER their
 * own way (their output formats differ on purpose), but the decision of what is
 * clean, and every kill, is taken here once.
 *
 * THE SHAPE, and why each part is load-bearing:
 *
 *   1. THE GROUP IS SIGNALLED FIRST (`process.kill(-pid, …)`, never the pid). The
 *      app is spawned `detached`, so it leads its own process group and a signal
 *      to the pid alone would leave Electron's helpers (GPU, network, renderer,
 *      utility) running - `detached` is what makes the group signal possible, and
 *      the group signal is what makes `detached` safe.
 *   2. SIGKILL FOLLOWS A DEADLINE. A wedged app that ignores SIGTERM must not keep
 *      the run alive; 5 s is the grace the rigs measured and the value both had.
 *   3. THE PROFILE REAP IS THE BACKSTOP, for the failure this class exists for: an
 *      app re-parented OUT of the group answers to no pid the run holds, and only
 *      its command line names it. `--user-data-dir` is matched for DETECTION and
 *      the pids it returns are then killed one at a time - never `pkill`, never a
 *      bare pattern. The profile path carries the run's own tag, so a match cannot
 *      belong to the operator's app or to a sibling session.
 *   4. IT FAILS CLOSED. An unreadable `ps` means the backstop could not run, which
 *      is not evidence of cleanliness; and a surviving process, or the app's own
 *      pid still answering, means the run leaked. `clean` is false in all three
 *      cases, so the caller exits non-zero and the leak fails the run that made it
 *      rather than the next one.
 *
 * A rig that boots the app also has to stop it on EVERY exit path, and this module
 * only supplies the stop. `onInterrupted` covers the interruption, because a run
 * stopped by hand is exactly when a tree is left behind; the rigs wrap their
 * post-spawn body in `try/finally` for the throw, and call the stop before each
 * explicit `process.exit` - `process.exit` does not run `finally` blocks, which is
 * why the explicit exits cannot rely on the wrapper.
 */

import { spawnSync } from "node:child_process";

/** One `ps` row, split into pid, parent and command line. */
const PS_ROW = /^(\d+)\s+(\d+)\s+(.*)$/;

/**
 * Every process whose command line names THIS run's profile, with its parent.
 *
 * DETECTION ONLY: callers kill the pids this returns, one at a time. The match is
 * anchored on the flag and closed by whitespace or end of line, because
 * `--user-data-dir=/tmp/x/user-data` is a PREFIX of `…/user-data-2`, and the value
 * the spawn used is what has to come back (`ps` truncates no column on this host).
 * Measured in every leak this change reproduced, on Electron 44.3.0 / macOS: the
 * flag appears on the app's MAIN process only; its GPU/network/renderer helpers do
 * not carry it, and they are reached by the group signal rather than by this scan.
 *
 * Returns `null` when `ps` could not be read, which is NOT the same as clean.
 */
export function thisRunProfile(userData) {
	const ps = spawnSync("ps", ["-eo", "pid,ppid,command"], { encoding: "utf8" });
	if (ps.error || ps.status !== 0) return null;
	const pattern = new RegExp(
		`(?:^|\\s)--user-data-dir=${userData.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`,
	);
	return ps.stdout
		.split("\n")
		.slice(1)
		.map((line) => line.trim().match(PS_ROW))
		.filter((match) => match && pattern.test(match[3]))
		.map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]) }));
}

/** Whether a pid is gone, asked of the kernel rather than of `ps`. */
export const alreadyGone = (pid) => {
	try {
		process.kill(pid, 0);
		return false;
	} catch {
		return true;
	}
};

/** The grace between SIGTERM and SIGKILL, in milliseconds. */
export const STOP_DEADLINE_MS = 5000;

/**
 * Stop the app this run booted, and answer whether the tree is actually gone.
 *
 * `isExited` is the caller's own view of the child (`exitCode`/`signalCode` for a
 * `ChildProcess`, or the flag its `exit` listener sets), because the two rigs
 * observe the child differently and the poll below must not invent a second
 * answer. `wait` is injectable so a test can drive the escalation without a real
 * 5 s grace.
 *
 * The result carries what the caller prints as well as `clean`: `reaped` and
 * `reparented` are the difference between "the group kill worked" and "the
 * backstop found two orphans", which are different facts about the run.
 */
export async function stopAppTree({
	pid,
	userData,
	isExited,
	deadlineMs = STOP_DEADLINE_MS,
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
	const killGroup = (signal) => {
		try {
			process.kill(-pid, signal);
			return true;
		} catch {
			// The group is already gone: the ordinary case when the app exited on
			// its own, and not an error to report.
			return false;
		}
	};

	const groupSignalled = !isExited() && killGroup("SIGTERM");
	const deadline = Date.now() + deadlineMs;
	while (!isExited() && Date.now() < deadline) await wait(100);
	let escalated = false;
	if (!isExited()) {
		escalated = true;
		killGroup("SIGKILL");
		await wait(500);
	}
	const groupExited = isExited();

	await wait(500);
	const found = thisRunProfile(userData);
	if (found === null) {
		return {
			groupSignalled,
			groupExited,
			escalated,
			profileUnreadable: true,
			reaped: [],
			reparented: 0,
			survivors: [],
			clean: false,
		};
	}
	const reaped = [];
	for (const entry of found) {
		let killed = false;
		try {
			process.kill(entry.pid, "SIGKILL");
			killed = true;
		} catch {
			// Already gone between the scan and the kill.
		}
		reaped.push({ ...entry, killed });
	}
	if (found.length > 0) await wait(500);
	const survivors = thisRunProfile(userData) ?? [];
	return {
		groupSignalled,
		groupExited,
		escalated,
		profileUnreadable: false,
		reaped,
		reparented: reaped.filter((entry) => entry.ppid === 1).length,
		survivors,
		clean: survivors.length === 0 && alreadyGone(pid),
	};
}

/**
 * The last-resort pass, for a path that reaches the end without the async one.
 *
 * `try/finally` covers a throw out of the awaited body and the signal handlers cover
 * an interruption, but neither covers an uncaught exception raised in a callback the
 * body never awaits - a `setInterval` flush, a socket error - and `process.exit` runs
 * no `finally` block at all. An `exit` handler is the only code that still runs for
 * those, and it is synchronous: no awaiting, so this signals the group and reaps the
 * profile with `spawnSync` and no grace period. It is the same mechanism as
 * `renderer-driver.mjs`'s `process.on("exit")` reaper, for the same reason.
 *
 * It skips the kill when the app's own pid is already gone, so an ordinary exit - and
 * a pid the OS has since recycled - is never signalled.
 */
export function reapOnExit({ pid, userData }) {
	process.on("exit", () => {
		if (alreadyGone(pid)) return;
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// The group has already gone away.
		}
		for (const entry of thisRunProfile(userData) ?? []) {
			try {
				process.kill(entry.pid, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
	});
}

/**
 * Run `teardown` once per interruption, for the two signals a stopped run gets.
 *
 * Ctrl-C and `killpg` are the ordinary ways a rig is stopped by hand, and a run
 * stopped that way must leave the same tree behind as one that finishes - it is
 * exactly the case where a tree is otherwise abandoned. `teardown(signal)` returns
 * the exit code, which stays the caller's decision.
 */
export function onInterrupted(teardown) {
	let running = false;
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, async () => {
			if (running) return;
			running = true;
			process.exit(await teardown(signal));
		});
	}
}
