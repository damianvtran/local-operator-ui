#!/usr/bin/env node
/**
 * Runs the desktop test files under a concurrency cap this machine can sustain.
 *
 *     node scripts/run-desktop-tests.mjs scripts/*.test.mjs
 *     node scripts/run-desktop-tests.mjs --test-concurrency=12 scripts/*.test.mjs
 *
 * `pnpm test:desktop` invokes this instead of `node --test` so the cap in
 * `desktop-test-concurrency.mjs` applies without every caller having to
 * remember it. The reasoning for the cap, and for every constant in it, is in
 * that file's docstring.
 *
 * Two escape hatches, and they behave differently on purpose:
 *
 *  - An explicit `--test-concurrency=N` anywhere in argv BYPASSES the governor
 *    entirely and is forwarded untouched (mirrors "an explicit `-n` bypasses
 *    the hook" in local-operator's pytest cap). Whoever passed it knows how
 *    wide they want to run; the governor has nothing to add and must not
 *    quietly override it.
 *  - `LOCAL_OPERATOR_UI_TEST_CONCURRENCY` overrides the number without bypassing
 *    the runner. Either way the resolved value is printed, so the line is
 *    evidence for what actually ran rather than a claim about what the governor
 *    would have done.
 *
 * The suite is also MEMORY-BOUNDED: the child runs in its own process group and
 * a watchdog kills the whole group, with one loud line and exit 137, if the
 * group's owned memory reaches the budget. The incident behind it (a test run
 * at ~198 GB while `ps` read 1.4 GB) and every constant are in
 * `desktop-test-memory-guard.mjs`; `LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB`
 * overrides the budget (a number of MB, or `off`, which is announced). Unlike
 * the concurrency governor this stays ACTIVE on CI.
 *
 * Each LANE is bounded too, and that is a separate guarantee: a test file that
 * never settles gets its OWN process killed and is named on stderr, while the
 * rest of the suite finishes and its verdict still lands. The bound is a stall
 * detector rather than a performance gate (`desktop-test-lane-bound.mjs` carries
 * the worked example: one such lane held this job from 14m24s green to cancelled
 * at two different caps, on four consecutive heads), and
 * `LOCAL_OPERATOR_UI_LANE_BOUND_MS` overrides it (a number of ms, or `off`, which
 * is announced). It is ACTIVE by default, for the same reason the memory guard is
 * on CI: a bound nobody enables stops nothing.
 *
 * Its DEFAULT is calibrated from CI rather than from this host, which is a lesson
 * this branch paid for: the first default killed
 * `scripts/mark-all-read-control.test.mjs` at the bound on two consecutive heads -
 * a lane whose bytes are identical on `main` (`0271b70f45db`) and which passes in
 * 447 s when run alone - so the ceiling now sits above the 18.7-minute healthy CI
 * suite, which bounds every lane that runs inside it, and inside the job's own
 * 35-minute cap. See `_DEFAULT_BOUND_MS` for the readings.
 *
 * The child's exit code is forwarded unchanged and its death by signal is
 * re-raised on this process, because a wrapper that reports success for a suite
 * that was killed is worse than no wrapper. For the same reason the child does
 * not inherit `NODE_TEST_CONTEXT`: node exports that variable into every
 * test-file process, and a nested `node --test` that sees it skips running the
 * files entirely and exits 0, so passing it through would make this runner
 * report success for a suite that never ran. See `_TEST_CONTEXT_ENV`.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	OVERRIDE_ENV,
	formatDesktopTestConcurrencyLine,
	resolveDesktopTestConcurrency,
} from "./desktop-test-concurrency.mjs";
import {
	createLaneBoundWatchdog,
	formatLaneBoundLine,
	formatLaneTripLine,
	resolveLaneBound,
} from "./desktop-test-lane-bound.mjs";
import {
	BREACH_EXIT_CODE,
	createMemoryWatchdog,
	formatBreachLine,
	formatMemoryBudgetLine,
	resolveMemoryBudget,
} from "./desktop-test-memory-guard.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

/**
 * The shared-inode write guard, preloaded into every test-file process.
 *
 * THIS LINE IS THE WHOLE PROTECTION AND IT BELONGS HERE RATHER THAN IN THE
 * FILES. On 2026-09-18 a suite in this list replaced the uv-managed interpreter
 * every 3.12 venv on this host hardlinks (23 names then, 27 now) with a 12-byte
 * text file, and the offending suite was never reduced — so there is no call
 * site to fix, only a class of write to refuse. Arming it from the one wrapper
 * `pnpm test:desktop` goes through means a test file cannot forget it, and the
 * `--import` form is required rather than stylistic: the guard patches the CJS
 * exports object, and it has to be in place BEFORE a test module's
 * `import { writeFileSync } from "node:fs"` snapshots that binding. See
 * `no-hardlink-write.mjs` and `no-hardlink-write.test.mjs`.
 *
 * WHAT THIS DOES NOT COVER, stated because the flag is per-process: a node
 * process a test file SPAWNS does not inherit `--import` and is not guarded.
 * Those children are the product's own — they hardlink an interpreter while
 * staging a runtime — and arming them with a `NODE_OPTIONS` preload was measured
 * to add refusals and no protection. The defensible claim is that a desktop
 * TEST-FILE process cannot write through a shared inode, which is what the guard
 * and the PR that added it both say.
 */
/** Set to `1` to run the suite without the guard; the runner announces it. */
const STAND_DOWN_ENV = "LOCAL_OPERATOR_UI_NO_HARDLINK_GUARD";

const GUARD_PRELOAD = new URL(
	"./no-hardlink-write-preload.mjs",
	import.meta.url,
);

/**
 * Node's test runner exports this into every test-file process. An inherited
 * copy makes a nested `node --test` treat itself as recursive: it warns
 * (`node:test run() is being called recursively within a test file. skipping
 * running files.`), runs NO files — 0 bytes on stdout — and **exits 0**.
 * Measured on node 26.5.0, and it is why this filter is not cosmetic: a caller
 * who exports the variable into `pnpm test:desktop` would get a green status
 * for a suite that nothing ran, which is the exact false-green this runner
 * exists not to propagate.
 *
 * ONLY this key is filtered. It is node's own marker for "this process is
 * already inside a test run", not a knob a test could legitimately read, and
 * filtering anything else would make a test file behave differently under this
 * runner than when node runs it directly.
 */
const _TEST_CONTEXT_ENV = "NODE_TEST_CONTEXT";

/** A positive whole number of workers, which is all node's flag accepts. */
const WORKER_COUNT_PATTERN = /^\d+$/;

const args = process.argv.slice(2);

// Both spellings node accepts. Detecting only the `=` form would let
// `--test-concurrency 12` slip past the governor and be capped anyway, which is
// exactly the silent override this branch exists to prevent.
const explicitFlag = args.find(
	(arg) =>
		arg === "--test-concurrency" || arg.startsWith("--test-concurrency="),
);

// The evidence line reports how many test files the run covers, so it must not
// count flags or the value slot of a bare `--test-concurrency 12` as a file.
const fileArgs = args.filter((arg, index) => {
	if (arg.startsWith("--test-concurrency")) return false;
	if (index > 0 && args[index - 1] === "--test-concurrency") return false;
	return !arg.startsWith("-");
});
const fileCount = fileArgs.length;

/*
 * The lane FILES the per-lane bound may match, which is a NARROWER set than the
 * arguments above: only a `*.test.mjs` argument can name a lane's own process. The
 * bound's kill is scoped to these exact strings, so anything else a caller passes (a
 * fixture, a helper, a data file) must never become a signal target just by being
 * mentioned in somebody's argv - `node --test` may run it, but it is not a lane and
 * nothing here will kill it.
 */
const laneArgs = fileArgs.filter((arg) => arg.endsWith(".test.mjs"));

const nodeArgs = ["--test"];
if (explicitFlag === undefined) {
	const decision = resolveDesktopTestConcurrency();
	// Pass no cap rather than `--test-concurrency=null` when the decision has no
	// number: the only arm that can produce one is the CI stand-down, whose whole
	// promise is to change nothing, and node's own default is exactly that.
	if (Number.isFinite(decision.concurrency)) {
		nodeArgs.push(`--test-concurrency=${decision.concurrency}`);
	}
	console.log(formatDesktopTestConcurrencyLine(decision, fileCount));
} else {
	const value = explicitFlag.includes("=")
		? explicitFlag.slice(explicitFlag.indexOf("=") + 1)
		: args[args.indexOf(explicitFlag) + 1];
	// A valueless or malformed flag is a usage error and must not be reported as
	// a cap. It used to print `concurrency undefined` / `0 files` and then hand
	// the malformed argv to node, which for the `=abc` and `=0` forms ACCEPTED
	// it, ran the suite at node's default width and exited with the suite's own
	// status — a silent, uncapped run behind a line that claimed a cap. That is
	// what this check replaces. Exit 9 is deliberate: it matches node only for
	// the absent and empty values (`node --test --test-concurrency` exits 9 with
	// "requires an argument"), and for a non-numeric or zero value we are
	// STRICTER than node on purpose, while the message names the governor's own
	// override as the way to get an uncapped run.
	if (
		value === undefined ||
		!WORKER_COUNT_PATTERN.test(value) ||
		Number(value) < 1
	) {
		console.error(
			`desktop tests: ${explicitFlag} needs a positive whole number` +
				`${value === undefined ? " (none given)" : ` (got ${JSON.stringify(value)})`}.` +
				` Use --test-concurrency=N, or set ${OVERRIDE_ENV} to override the governor's own number.`,
		);
		process.exit(9);
	}
	console.log(
		`desktop tests: ${fileCount} file${fileCount === 1 ? "" : "s"}, concurrency ${value} (explicit ${explicitFlag} in argv; governor bypassed)`,
	);
}
nodeArgs.push(`--import=${GUARD_PRELOAD.href}`);
nodeArgs.push(...args);

/*
 * A stood-down guard is announced HERE, on this process's own stderr, because
 * this is the only layer of the two where stderr is still observable.
 *
 * The preload announces it too, and that line is the one a direct child shows on
 * stderr correctly. Under this runner it cannot be: `--test` consumes the test
 * child's descriptor and re-emits what the child wrote as TAP DIAGNOSTICS ON
 * STDOUT. Measured through this runner, one `STANDING DOWN`: stdout 1, stderr 0.
 * Every route out of the child was tried and measured with the same result —
 * `process.stderr.write`, `writeSync(2, …)`, `writeSync(openSync("/dev/stderr"))`
 * and `writeFileSync("/dev/stderr", …)` each produced stdout 0 / stderr 0 for a
 * write made during a test, because the runner drops it outright.
 *
 * Reporting it from the runner is what makes "this run is UNGUARDED" survive on
 * stderr, where a consumer reading the suite's stdout cannot lose it among the
 * test output — and a notice nobody reads is the false green the guard exists to
 * prevent.
 */
if (process.env[STAND_DOWN_ENV] === "1") {
	console.error(
		`desktop tests: WARNING — the shared-inode write guard is STANDING DOWN (${STAND_DOWN_ENV}=1); a test file writing through a shared inode will NOT be refused`,
	);
}

/*
 * The suite's children get the notification kill switch set, alongside the one
 * key filtered out above, and for the same reason this runner exists at all:
 * a caller must not have to remember either of them. These test files boot the
 * real app, the app spawns a real backend, and that backend's parked-gate
 * announcement reaches macOS through `osascript`, whose banner lands in the
 * operator's Notification Center attributed to Script Editor. That is not a
 * sandbox and a suite must not be able to write there; see
 * `notifications-off.mjs` for the whole path and for the two deliberate
 * exceptions.
 *
 * `withTelemetryOff` beside it: the suite's files boot the app, and the build
 * they boot carries the live PostHog project key in both processes, so a suite
 * run is otherwise counted as a product user and recorded as a session replay.
 * Applying it to the child environment here is what covers every file the suite
 * runs, present and future, rather than the ones somebody remembered. See
 * `telemetry-off.mjs`.
 */
const childEnv = withTelemetryOff(
	withNotificationsOff(
		Object.fromEntries(
			Object.entries(process.env).filter(([key]) => key !== _TEST_CONTEXT_ENV),
		),
	),
);
/*
 * `detached` makes the child a process-group leader, which is what lets the
 * watchdog (and the signal forwarding below) address the WHOLE tree with one
 * `kill(-pgid)` and never a bare pid or this runner's own group. The costs, all
 * accepted: a terminal's Ctrl-C no longer reaches the child directly (the
 * forwarding below replaces it, to the group), and if this runner is itself
 * SIGKILLed the group is not reaped with it - the same exposure the app rigs'
 * `detached` launches already carry. The child's stdin stays inherited; node's
 * test runner does not read it.
 */
const child = spawn(process.execPath, nodeArgs, {
	stdio: "inherit",
	env: childEnv,
	detached: true,
});

/*
 * The death-watch (R1 of the PR #733 review). `detached` takes the test tree out
 * of THIS process's group, so a SIGKILL of the runner's group - what every
 * per-command guard and `timeout`-by-pgid wrapper here does - would otherwise
 * leave the tree running with its watchdog dead. The keeper is a separate-session
 * process holding the read end of a pipe only this runner writes; when the pipe
 * closes without `done` it SIGKILLs the test group. See `desktop-test-keeper.mjs`.
 * It covers a SIGKILLed runner (and any other way the runner vanishes); it does
 * not cover the keeper itself being killed, and it signals the group only.
 */
let keeper = null;
let keeperReleased = false;
if (child.pid !== undefined) {
	try {
		keeper = spawn(
			process.execPath,
			[
				fileURLToPath(new URL("./desktop-test-keeper.mjs", import.meta.url)),
				String(child.pid),
			],
			{ stdio: ["pipe", "ignore", "ignore"], detached: true },
		);
		// `URL.pathname` is percent-encoded, so a checkout under a path with a space
		// made the keeper exit 1 at once while the runner carried on believing it
		// was tethered; `fileURLToPath` is the decoded path. And because a keeper
		// that is gone is the one failure the runner cannot otherwise see, an exit
		// before the runner's own normal end is announced here.
		keeper.on("error", () => {
			keeper = null;
		});
		keeper.on("exit", (code) => {
			if (!keeperReleased && code !== 0) {
				console.error(
					`desktop tests: WARNING - the death-watch keeper exited early (status ${code}); if this runner is killed the test group will NOT be reaped`,
				);
			}
		});
		keeper.stdin.on("error", () => {});
		keeper.unref();
	} catch {
		keeper = null;
	}
}
function releaseKeeper() {
	keeperReleased = true;
	// Tell it this is a NORMAL end so it does not signal a finished suite's group.
	try {
		keeper?.stdin.end("done\n");
	} catch {
		// Already gone.
	}
}

const memoryBudget = resolveMemoryBudget();
console.log(formatMemoryBudgetLine(memoryBudget));
const laneBound = resolveLaneBound();
console.log(formatLaneBoundLine(laneBound));
let breached = false;
const watchdog =
	memoryBudget.budgetMb === null || child.pid === undefined
		? null
		: createMemoryWatchdog({
				leaderPid: child.pid,
				budgetBytes: memoryBudget.budgetMb * 1024 * 1024,
				onTrip: () => {
					// Set BEFORE the kill: the child's exit can be observed while the
					// pre-kill re-read is still in flight, and must already read as a
					// verdict rather than a signal death to re-raise.
					breached = true;
				},
				onBreach: (reading, outcome) => {
					console.error(
						formatBreachLine({
							leaderPid: child.pid,
							reading,
							budgetBytes: memoryBudget.budgetMb * 1024 * 1024,
							outcome,
						}),
					);
				},
				onBlind: (ticks) =>
					console.error(
						`desktop tests: WARNING - memory watchdog could not fully read the process group for ${ticks} consecutive ticks (the process table is unreadable or no footprint came back); the run is NOT reliably bounded`,
					),
			});
watchdog?.start();

/**
 * The per-lane bound, armed beside the memory watchdog and independent of it: the
 * memory guard answers "is this group too big", this answers "which lane stopped
 * making progress" - and only the second can end a run that never finishes while
 * holding almost no memory at all, which is the shape that cost four heads their
 * CI verdict. A lane that trips it is named on stderr and its OWN process is
 * killed; node records that file as failed and the rest of the suite still lands.
 */
const laneWatchdog =
	laneBound.boundMs === null || child.pid === undefined
		? null
		: createLaneBoundWatchdog({
				leaderPid: child.pid,
				lanes: laneArgs,
				boundMs: laneBound.boundMs,
				onTrip: ({ lane, pid, elapsedMs, killed }) =>
					console.error(
						formatLaneTripLine({
							lane,
							pid,
							elapsedMs,
							boundMs: laneBound.boundMs,
							killed,
						}),
					),
				onBlind: (ticks) =>
					console.error(
						`desktop tests: WARNING - the per-lane bound could not read the suite's process group for ${ticks} consecutive samples; a lane that never settles is NOT bounded while that lasts`,
					),
			});
laneWatchdog?.start();

// Forward the signals a user or CI actually sends, so Ctrl-C interrupts the
// suite rather than leaving it orphaned behind a killed wrapper. To the GROUP:
// the child no longer shares ours, and its own children are what hold memory.
// KNOWN LIMIT (Q3 of the PR #733 QA pass): this reaches the group only. A
// descendant that called setsid (an Electron a rig launched `detached`) survives
// Ctrl-C/SIGTERM, exactly as it did under the base runner; only the memory
// watchdog's breach path walks out-of-group descendants.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		if (child.exitCode === null && child.signalCode === null) {
			try {
				process.kill(-child.pid, signal);
			} catch {
				child.kill(signal);
			}
		}
	});
}

child.on("exit", (code, signal) => {
	watchdog?.stop();
	laneWatchdog?.stop();
	releaseKeeper();
	if (breached) {
		// The watchdog's SIGKILL is a deliberate, already-announced verdict: report
		// it as an exit status rather than re-raising, so the loud line above is
		// the last word and callers see a plain non-zero code.
		process.exitCode = BREACH_EXIT_CODE;
		return;
	}
	if (signal !== null) {
		// The child was killed. Report the same death for this process instead
		// of a fabricated exit code: `exitCode` would flatten "the suite was
		// interrupted" into an ordinary success or failure, and every caller
		// that inspects the status (CI, a shell `&&`, a signal death in a
		// pipeline) would then be told the wrong thing.
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
			process.removeAllListeners(sig);
		process.kill(process.pid, signal);
		return;
	}
	process.exitCode = code ?? 1;
});
