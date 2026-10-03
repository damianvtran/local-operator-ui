/**
 * Names the lane that stops making progress, so one never-settling test file
 * cannot turn a whole-suite verdict into an unreadable cancellation.
 *
 * THE WORKED EXAMPLE, and why a bound is the fix rather than a bigger job cap.
 * `scripts/projects-board-focus.test.mjs` passed its first test in ~55 ms and then
 * left a promise suspended forever: no per-test timeout fired (the hang is not
 * inside a test body), node's own diagnostic at the kill was `Promise resolution is
 * still pending but the event loop has already resolved`, and it reproduced on Node
 * 22.22.0 and Node 26.5.0. That one file held the CI `Desktop Tests` job from 14m24s
 * green to CANCELLED at the 35-minute cap, and again at a raised 60-minute cap, on
 * four consecutive heads. A cancelled job carries no test line at all - the run's
 * annotations were only the cap's own and its log was a truncation - so a verdict
 * over 6300 tests became unreadable because ONE file never returned. Raising the cap
 * was measured to buy nothing (it cancelled at 60 minutes too); naming the lane is
 * what makes the run actionable.
 *
 * HOW THE LANE IS FOUND. `node --test` gives every test FILE its own process, so the
 * stall is one pid inside the suite child's process group. This watchdog samples that
 * group, times each lane from the first tick its process appears, and when one passes
 * the bound SIGKILLs THAT PID - nothing else, so the other lanes keep running.
 *
 * THE KILL IS SCOPED TWICE, and neither test is a name match: the pid must share the
 * suite child's process group, and its command line must carry the LANE'S OWN PATH as
 * a whole argument (`scripts/foo.test.mjs`, exactly as this runner was invoked). The
 * suite child itself is excluded by pid, because its argv carries EVERY lane path and
 * would otherwise always match; and where several rows carry one lane's path, the
 * DIRECT-child row (`ppid === leaderPid`, the file process node spawned) wins over a
 * deeper descendant that merely repeats the argument.
 *
 * WHAT THE SUITE DOES THEN, MEASURED RATHER THAN ASSUMED: node's runner records the
 * killed file as a failed subtest and runs the REST to completion, so the verdict
 * still lands. Proven on a fixture pair (`hang.test.mjs` + `ok.test.mjs`, the hang
 * held open by a live timer so its event loop could not drain): killing only the hang
 * lane's pid produced `ok 3 - a neighbouring lane that must still report` and
 * `# tests 3 / # pass 2 / # fail 1 / # cancelled 0`, with the parent exiting on its
 * own, rc=1 - a red run that says which file -, not a killed run.
 *
 * WHAT THIS IS NOT: a performance gate. The bound is deliberately far above measured
 * lanes (see `_DEFAULT_BOUND_MS`: ~2.7x the slowest lane measured ON THIS HOST, which
 * is the honest form of that claim - the CI figure beside it is a whole-suite
 * aggregate over 361 lanes and does not bound any individual lane), because its job
 * is to catch a file that will never return, not to police duration. A lane that
 * legitimately runs longer than the bound is killed and named like any other; that is
 * a false trip by this module's own definition, and the answer is a larger bound or
 * `off` - both named in the line this prints at startup, so the reader is never left
 * guessing which bound ran.
 *
 * LIMITS, stated because a bound that overclaims is worse than none:
 *
 *  - It bounds the LANE'S OWN PROCESS, not descendants the lane spawned. A lane that
 *    leaves a rig or a backend behind is the memory watchdog's and the death-watch
 *    keeper's business, not this module's.
 *  - A lane whose process cannot be seen (the process table is unreadable, or `ps`
 *    is starved) is not bounded for that tick; that is announced once, like the
 *    memory watchdog's own blind warning.
 *  - It does not change the suite's exit status arithmetic: node already reports the
 *    killed file as a failure, and the runner forwards the child's status unchanged.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Milliseconds for one lane, or `off` (announced loudly) to bound none. */
export const LANE_BOUND_OVERRIDE_ENV = "LOCAL_OPERATOR_UI_LANE_BOUND_MS";

/**
 * The bound a lane may run before it is killed and named.
 *
 * MEASURED, 2026-10-03, and set as a STALL DETECTOR rather than a ceiling on slow
 * work. Two readings, and they answer different questions: the whole 361-lane suite
 * completes in ~16 minutes on CI (`Desktop Tests` 16m36s at concurrency 8-12, run
 * 37094834731) - an AGGREGATE, so it does not bound any single lane - while timing
 * individual heavy lanes on this host put `update-robustness.test.mjs` at 225.7 s
 * (a lane that also fails here on environment grounds), `credential-composer.test.mjs`
 * at 69.7 s, `daemon-observation.test.mjs` at 27.1 s, and the rest in single-digit
 * seconds. Ten minutes is therefore ~2.7x the slowest lane measured ON THIS HOST; no
 * CI-side per-lane reading exists yet, so that margin is the standing claim and this
 * note is where a future measurement should replace it. It is enough for the purpose:
 * the lane that held four heads' CI (see the header) never finished at all, so a
 * bound anywhere in this range separates it from every lane that does.
 */
export const _DEFAULT_BOUND_MS = 600_000;

/**
 * Milliseconds between the end of one sample and the start of the next, so a starved
 * `ps` can never make the samples overlap. Five seconds is far finer than the bound it
 * enforces (minutes) while keeping the process-table read off the suite's critical
 * path; the memory watchdog's 2 s cadence is set by its own tighter arithmetic.
 */
export const _TICK_INTERVAL_MS = 5_000;

/** Per-sample timeout, above the memory watchdog's `ps` read so both can be in flight. */
export const _PROBE_TIMEOUT_MS = 10_000;

/** Consecutive failed samples before the one "blind" warning, so a flake is not a warning. */
export const _BLIND_TICKS_WARN = 5;

/**
 * One `ps -axo pid=,ppid=,pgid=,command=` row: three numeric fields and the command.
 * At module scope because the sampler runs on a timer and would otherwise rebuild the
 * literal on every tick.
 */
const TABLE_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/;

/** argv is whitespace-separated by definition, so one split is the whole tokenisation. */
const WHITESPACE = /\s+/;

/**
 * Resolve the bound from an override string, in the same vocabulary the memory
 * watchdog uses: `off` disables it, a positive whole number of milliseconds overrides
 * it, anything else is a typo that is reported and ignored rather than silently
 * becoming a bound nobody chose.
 */
export function computeLaneBound({ override = null } = {}) {
	const text =
		override === null || override === undefined ? "" : String(override).trim();
	if (text.toLowerCase() === "off") {
		return { boundMs: null, arm: "off" };
	}
	if (text !== "") {
		const value = Number.parseInt(text, 10);
		// `parseInt` reads "5min" as 5; both that and 0 are typos, not bounds.
		if (Number.isInteger(value) && value >= 1 && String(value) === text) {
			return { boundMs: value, arm: "override" };
		}
		console.warn(
			`${LANE_BOUND_OVERRIDE_ENV} is not a positive whole number of milliseconds or "off": ${text}. Ignoring it.`,
		);
	}
	return { boundMs: _DEFAULT_BOUND_MS, arm: "default" };
}

export function resolveLaneBound(env = process.env) {
	return computeLaneBound({ override: env[LANE_BOUND_OVERRIDE_ENV] ?? null });
}

function human(ms) {
	const seconds = Math.round(ms / 1000);
	if (seconds < 90) return `${seconds}s`;
	return `${Math.round(seconds / 60)} min`;
}

/** The startup line: what the bound is, where it came from, and how to change it. */
export function formatLaneBoundLine(decision) {
	if (decision.arm === "off") {
		return `desktop tests: WARNING — per-lane bound OFF (${LANE_BOUND_OVERRIDE_ENV}=off); a lane that never settles will NOT be killed and named, and the run can still be cancelled unreadably`;
	}
	const why =
		decision.arm === "override"
			? `explicit ${LANE_BOUND_OVERRIDE_ENV}`
			: "default, 2.7x the slowest lane measured on this host";
	return `desktop tests: per-lane bound ${human(decision.boundMs)} (${why}); sampled every ${_TICK_INTERVAL_MS / 1000}s over the suite's process group`;
}

/**
 * The one loud line a reader needs: which lane, how long, against what bound - and
 * what actually happened to the pid, because a line that claims a kill it did not
 * make is evidence of the wrong thing.
 */
export function formatLaneTripLine({ lane, pid, elapsedMs, boundMs, killed }) {
	const outcome = killed
		? `killed pid ${pid} and left the rest of the suite running, so its verdict still lands`
		: `pid ${pid} was already gone when the bound fired, so nothing was signalled and the suite's own verdict stands`;
	return `desktop tests: LANE BOUND EXCEEDED — ${lane} ran ${human(elapsedMs)} without finishing (bound ${human(boundMs)}); ${outcome} (raise or disable with ${LANE_BOUND_OVERRIDE_ENV})`;
}

/**
 * Parse `ps -axo pid=,ppid=,pgid=,command=`.
 *
 * A pure function rather than a probe, so the matching rules below can be asserted
 * without a process table. Lines that do not carry four fields are dropped: a command
 * containing spaces is the norm, not a parse failure, which is why the command is
 * taken as "everything after the third number".
 */
export function parseGroupTable(text) {
	const rows = [];
	for (const line of String(text).split("\n")) {
		const match = TABLE_ROW.exec(line);
		if (match === null) continue;
		rows.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			pgid: Number(match[3]),
			command: match[4],
		});
	}
	return rows;
}

/**
 * The running lanes in a sampled table: lane path -> pid.
 *
 * The lane argument is matched as a WHOLE argv token, not as a substring, so a lane
 * whose path is a prefix of another lane's (`scripts/projects-card-click.test.mjs`
 * against a hypothetical `...-click-more.test.mjs`) cannot be confused for it - and a
 * test file that merely mentions another lane's path in a string argument is not a
 * match at all.
 *
 * THE TWO GUARDS BELOW ARE THE SAFETY PROPERTY - a kill must never reach a process
 * this runner did not start - so each is asserted by a case where its row is the ONLY
 * carrier of the token: the group test by an out-of-group row alone, the suite-child
 * exclusion by the leader's own row alone. Both return an empty match, which is what
 * stops the bound from signalling a process outside the suite; a fixture that carried
 * those rows alongside a valid one would let either guard be deleted silently, because
 * the valid row would answer for the token anyway.
 */
export function laneProcesses(rows, { leaderPid, lanes }) {
	const wanted = new Set(lanes);
	const byLane = new Map();
	for (const row of rows) {
		if (row.pgid !== leaderPid) continue;
		if (row.pid === leaderPid) continue;
		for (const token of row.command.split(WHITESPACE)) {
			if (!wanted.has(token)) continue;
			const current = byLane.get(token);
			// Prefer the suite child's own child - that is the file process node
			// spawned - over a deeper descendant repeating the argument.
			if (
				current === undefined ||
				(row.ppid === leaderPid && current.ppid !== leaderPid)
			) {
				byLane.set(token, { pid: row.pid, ppid: row.ppid });
			}
		}
	}
	return byLane;
}

/** The default sampler: one `ps` read of the whole table, bounded by its own timeout. */
export async function sampleLaneProcesses(leaderPid, lanes) {
	const { stdout } = await execFileAsync(
		"ps",
		["-axo", "pid=,ppid=,pgid=,command="],
		{ timeout: _PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
	);
	return laneProcesses(parseGroupTable(stdout), { leaderPid, lanes });
}

/**
 * The watchdog. Every dependency a test needs to drive it deterministically is
 * injectable, exactly as the memory watchdog's are: the sample, the clock, the kill
 * and the timer.
 */
export function createLaneBoundWatchdog({
	leaderPid,
	lanes,
	boundMs,
	sample = () => sampleLaneProcesses(leaderPid, lanes),
	kill = (pid) => {
		try {
			process.kill(pid, "SIGKILL");
			return true;
		} catch {
			// The lane may have exited between the sample and the signal. The outcome is
			// REPORTED rather than swallowed - the trip line says what happened, and a
			// line that claimed a kill it did not make would be evidence of the wrong
			// thing.
			return false;
		}
	},
	now = () => Date.now(),
	onTrip = () => {},
	onBlind = () => {},
	intervalMs = _TICK_INTERVAL_MS,
	setTimer = setTimeout,
	clearTimer = clearTimeout,
}) {
	/** lane -> { pid, firstSeenAt }. Dropped when the lane's process disappears, so a
	 * lane that finishes and a lane that is killed both stop being timed. */
	const running = new Map();
	let timer = null;
	let stopped = false;
	let sampling = false;
	let blindTicks = 0;

	async function tick() {
		if (stopped || sampling) return;
		sampling = true;
		let seen;
		try {
			seen = await sample();
			blindTicks = 0;
		} catch {
			blindTicks += 1;
			if (!stopped && blindTicks === _BLIND_TICKS_WARN) onBlind(blindTicks);
			sampling = false;
			rearm();
			return;
		}
		sampling = false;
		// `stop()` is AUTHORITATIVE, including for a sample already in flight: the suite
		// has finished, so nothing may be signalled on its behalf by a tick that was
		// mid-`ps` when the child exited.
		if (stopped) return;

		for (const lane of [...running.keys()]) {
			if (!seen.has(lane)) running.delete(lane);
		}
		for (const [lane, { pid }] of seen) {
			const entry = running.get(lane);
			if (entry === undefined) {
				running.set(lane, { pid, firstSeenAt: now() });
				continue;
			}
			// A lane whose process changed is a new process: re-time it rather than
			// charge the new pid with the old one's elapsed time.
			if (entry.pid !== pid) {
				running.set(lane, { pid, firstSeenAt: now() });
				continue;
			}
			const elapsedMs = now() - entry.firstSeenAt;
			if (elapsedMs < boundMs) continue;
			// Forget the lane so one stall is named once, then kill and report: the line
			// carries the OUTCOME, and it is this process's own stderr, so the child's
			// death cannot swallow it.
			running.delete(lane);
			const killed = kill(pid) === true;
			onTrip({ lane, pid, elapsedMs, killed });
		}
		rearm();
	}

	function rearm() {
		if (stopped) return;
		timer = setTimer(tick, intervalMs);
	}

	return {
		start() {
			if (stopped || timer !== null) return;
			rearm();
		},
		stop() {
			stopped = true;
			if (timer !== null) clearTimer(timer);
			timer = null;
		},
		/** Exposed for tests: one sample's worth of the loop. */
		_tick: tick,
		_running: running,
	};
}
