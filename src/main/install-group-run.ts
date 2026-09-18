import { spawn, spawnSync } from "node:child_process";

/**
 * Running the install's own front end in a process group the caller can stop.
 *
 * WHY THIS IS NOT `runCommand`. That helper is `execFile` with a `timeout`, and
 * its timeout signals the DIRECT CHILD it started. `<resolved console path> update`
 * is not the installer: it is a front end that runs `uv`, `pipx` or `pip` as its
 * own child, and those are the processes that rewrite the install tree. So a
 * budget that expires signals the front end and leaves the installer running -
 * measured on the withdrawn model of this path (review round 1, M1): an orphan
 * kept writing into the install root while the run's promise never settled, and
 * the app had already told the user the update did not finish. The same shape
 * applies here: the app may declare an update failed while a real installer is
 * still replacing the tree underneath it.
 *
 * So this spawns the front end as its own GROUP LEADER (`detached: true` puts the
 * child in a new group whose id is its pid) and signals the GROUP: SIGTERM first,
 * then SIGKILL if the group is still standing after a grace. The verdict is taken
 * ON THE TIMER rather than on the child's `close` event, because `close` waits for
 * both streams, which a surviving descendant can hold open indefinitely; the
 * caller is told whether the group is still alive at that moment and keeps its own
 * guard on it.
 *
 * It is a module of its own so the group semantics can be driven directly, with
 * real children: the properties that matter here (a descendant stops, the promise
 * settles on the budget, the SIGKILL escalation lands) are properties of real
 * processes, and a fixture that only records the calls cannot show them.
 */

/** Grace between the stop signal and the escalation, so SIGTERM can work first. */
export const GROUP_SIGNAL_GRACE_MS = 5_000;

/**
 * How long a caller waits for a signalled group to disappear.
 *
 * Longer than `GROUP_SIGNAL_GRACE_MS` so the escalation always lands inside it,
 * and bounded because a group that outlives both is reported rather than waited
 * on: the caller holds a guard on this, and a hung installer must not hang the
 * next update as well.
 */
export const GROUP_EXIT_WAIT_MS = 20_000;

/** How much of each stream is kept, for the log and the failure tail. */
const MAX_STREAM_CHARS = 4 * 1024 * 1024;

/**
 * Whether a process group with this id still exists.
 *
 * `EPERM` counts as alive on purpose: a group this app may not signal is still a
 * group, and treating it as gone is how a second installer gets started beside
 * one that is running.
 */
export function isInstallGroupAlive(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * The start stamp the kernel reports for a live pid, or null when it cannot be read.
 *
 * The marker's question is not "is there a process with this pid" but "is the
 * process with this pid OURS", and a pid is only unique among live processes: once
 * the run is gone the number can be handed to anything, so a record left by a
 * crash ends up naming a stranger. Measured on the withdrawn model of this path
 * (QA round 2): a recycled pid - a root-owned group answers `EPERM`, which
 * `isInstallGroupAlive` counts as alive on purpose - made every later update on
 * every later launch refuse for ever, 8.5 hours past the record's own deadline.
 *
 * A pid plus the start time the kernel gives it is the standard pidfile identity,
 * and the recycling case answers with a DIFFERENT stamp. `lstart` is the portable
 * spelling (macOS and GNU procps both print it) and the value is never parsed - it
 * is only ever compared with another reading in the same format, so its layout and
 * the locale do not matter. An absent pid, a permission failure or a `ps` this
 * process cannot run answer null, which the caller reads as "no evidence either
 * way" rather than as "ours".
 */
export function readProcessStartStamp(pid: number): string | null {
	if (!Number.isInteger(pid) || pid <= 0) return null;
	try {
		const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf8",
			timeout: 2_000,
		});
		if (result.status !== 0 || typeof result.stdout !== "string") return null;
		const stamp = result.stdout.trim();
		return stamp.length > 0 ? stamp : null;
	} catch {
		return null;
	}
}

/** Signal a whole process group. False when there is nothing to signal. */
export function signalInstallGroup(
	pid: number,
	signal: NodeJS.Signals,
): boolean {
	try {
		process.kill(-pid, signal);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait, briefly and boundedly, for a signalled group to disappear.
 *
 * The caller holds its own guard on this: the timeout already settled the verdict,
 * so this is what lets the guard out only once nothing is left writing into the
 * install root. A group that outlives the wait is reported as such rather than
 * waited on further.
 */
export async function waitForInstallGroupGone(
	pid: number,
	timeoutMs = GROUP_EXIT_WAIT_MS,
): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (!isInstallGroupAlive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isInstallGroupAlive(pid);
}

/** What one run of the install's front end produced. */
export type GroupRunResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	/** False when the run produced no verdict: a spawn failure, or the budget. */
	ran: boolean;
	/** The group leader, so the caller can record it and hold its guard on it. */
	groupPid: number | null;
	/** True when the budget expired and the group was signalled. */
	timedOut: boolean;
	/** True when the group was still alive as the verdict was taken. */
	groupStillRunning: boolean;
};

/**
 * Spawn the command as its own group leader, stream it, and bound the wait.
 *
 * Never rejects: every outcome is a value, because the caller reports all of them
 * through the panel rather than turning one into an exception.
 */
export function runInOwnProcessGroup(input: {
	command: string;
	args: string[];
	timeoutMs: number;
	graceMs?: number;
	env?: Record<string, string | undefined>;
	cwd?: string;
	/** Called once, with the group leader, before anything else can be decided. */
	onSpawn?: (pid: number) => void;
	log?: (line: string, level?: "info" | "warn" | "error") => void;
}): Promise<GroupRunResult> {
	const graceMs = input.graceMs ?? GROUP_SIGNAL_GRACE_MS;
	const log = input.log ?? (() => {});
	return new Promise<GroupRunResult>((resolve) => {
		let settled = false;
		let timedOut = false;
		let stdout = "";
		let stderr = "";
		let groupPid: number | null = null;
		let timer: NodeJS.Timeout | null = null;
		let escalation: NodeJS.Timeout | null = null;

		const finish = (result: Omit<GroupRunResult, "groupPid">) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			/*
			 * THE ESCALATION IS NOT CLEARED HERE, and that is the whole of it: it is
			 * armed by the timeout handler to fire AFTER the verdict, because a group
			 * that ignored the stop signal is exactly what the verdict has to report and
			 * the group has to outlive. (Clearing it here was a real defect while this
			 * module was being written: the SIGKILL never fired, and the case that
			 * observes the descendant stopping is what caught it.) It is `unref`'d, so
			 * leaving it armed promises nothing about the process's lifetime, and the
			 * normal path never arms one at all.
			 */
			// Drop our ends, so a descendant that inherited them cannot hold this
			// process's event loop open after the verdict is delivered.
			dropStream(child?.stdout);
			dropStream(child?.stderr);
			resolve({ ...result, groupPid });
		};

		let child: ReturnType<typeof spawn> | null = null;
		try {
			child = spawn(input.command, input.args, {
				detached: true,
				cwd: input.cwd,
				...(input.env ? { env: input.env } : {}),
				// No inherited stdin: the front end is non-interactive, and an
				// inherited terminal on a GUI process is a handle to nothing.
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			log(
				`Could not start ${input.command}: ${(error as Error).message}`,
				"error",
			);
			finish({
				exitCode: null,
				stdout,
				stderr: (error as Error).message,
				ran: false,
				timedOut: false,
				groupStillRunning: false,
			});
			return;
		}

		groupPid = child.pid ?? null;
		if (groupPid !== null) input.onSpawn?.(groupPid);

		const record = (chunk: unknown, stream: "stdout" | "stderr") => {
			const text = String(chunk);
			if (stream === "stdout") {
				stdout = (stdout + text).slice(-MAX_STREAM_CHARS);
			} else {
				stderr = (stderr + text).slice(-MAX_STREAM_CHARS);
			}
		};
		child.stdout?.on("data", (chunk) => record(chunk, "stdout"));
		child.stderr?.on("data", (chunk) => record(chunk, "stderr"));
		// A spawn that failed to exec reports here rather than on `close`, and it
		// reports with the error that names why.
		child.on("error", (error: Error) => {
			log(`The updater could not be run: ${error.message}`, "error");
			finish({
				exitCode: null,
				stdout,
				stderr: stderr.length > 0 ? stderr : error.message,
				ran: false,
				timedOut: false,
				groupStillRunning: false,
			});
		});
		child.on("close", (code: number | null) => {
			finish({
				exitCode: code,
				stdout,
				stderr,
				ran: true,
				timedOut,
				groupStillRunning: false,
			});
		});

		timer = setTimeout(() => {
			timedOut = true;
			log(
				`The updater did not finish within ${input.timeoutMs}ms; stopping the process group this run started. Its own children (uv, pipx, pip) run inside that group, so signalling only the front end would leave the installer running`,
				"warn",
			);
			/*
			 * The only signals this module ever sends, and they go to the group the
			 * child it spawned itself leads - never to a server pid, which this module
			 * has no name for and no way to reach.
			 */
			if (groupPid !== null) signalInstallGroup(groupPid, "SIGTERM");
			escalation = setTimeout(() => {
				if (groupPid === null || !isInstallGroupAlive(groupPid)) return;
				log(
					`The updater's process group was still alive ${graceMs}ms after the stop signal; killing it`,
					"warn",
				);
				signalInstallGroup(groupPid, "SIGKILL");
			}, graceMs);
			/*
			 * The escalation is armed on its own handle and `unref`'d: this timer is
			 * the one thing that could keep the main process alive after the verdict
			 * has been delivered, and a host that expects to exit promptly otherwise
			 * waits the grace out. Unref'd timers still fire; they simply promise
			 * nothing about the process's lifetime.
			 */
			escalation.unref?.();
			finish({
				exitCode: null,
				stdout,
				stderr,
				ran: false,
				timedOut: true,
				groupStillRunning: groupPid !== null && isInstallGroupAlive(groupPid),
			});
		}, input.timeoutMs);
	});
}

/** Let go of a pipe, without assuming it is one. */
function dropStream(stream: unknown): void {
	const destroy = (stream as { destroy?: unknown } | null | undefined)?.destroy;
	if (typeof destroy === "function") (destroy as () => void).call(stream);
}
