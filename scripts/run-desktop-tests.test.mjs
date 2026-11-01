import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OVERRIDE_ENV } from "./desktop-test-concurrency.mjs";

/*
 * `scripts/run-desktop-tests.mjs`'s own behaviour as a process: what it forwards
 * to node, what it prints, and what status it leaves behind.
 *
 * Why this file exists at all. The governor's arithmetic is covered by
 * `desktop-test-concurrency.test.mjs`, but the runner around it is the part a
 * caller actually interacts with, and every one of the behaviours below is a
 * silent-failure shape rather than a loud one:
 *
 *   - a wrapper that swallows the child's exit code reports success for a suite
 *     that failed (the single worst thing a test wrapper can do);
 *   - an explicit `--test-concurrency=N` that the governor overrides anyway is
 *     an escape hatch that does not open;
 *   - a valueless flag that is reported as a cap prints a number that means
 *     nothing before node fails, which is how `concurrency undefined` reached a
 *     reviewer;
 *   - and an ambient `NODE_TEST_CONTEXT` reaching the child makes the whole suite
 *     exit 0 without running a single file, which is why the runner filters that
 *     one key out of the environment it hands the child.
 *
 * The tests spawn the real runner over real (tiny) test files rather than
 * mocking `spawn`, because the thing under test is the process contract. Signals
 * are deliberately NOT covered here: QA proved that path by hand against the
 * live runner, and re-deriving it would need a fixture that outlives a kill.
 */

const RUNNER = join(process.cwd(), "scripts", "run-desktop-tests.mjs");

/** The bypass line, at module scope like every other pattern in this repo's
 * script tests (biome's `useTopLevelRegex`). */
const BYPASS_LINE =
	/^desktop tests: 2 files, concurrency 3 \(explicit --test-concurrency=3 in argv; governor bypassed\)$/;
/*
 * The diagnostic switch's own evidence line, pinned literally rather than built
 * from `OVERRIDE_ENV`: the line a human greps out of a CI log IS the deliverable,
 * so a rename or a rewording that still "passes" would defeat its purpose.
 */
const ONE_WORKER_LINE =
	/^desktop tests: 1 file, concurrency 1 \(explicit LOCAL_OPERATOR_UI_TEST_CONCURRENCY; governor bypassed\)$/;
/** The number in the evidence line, so a case can prove the line and the command
 * agree instead of trusting either alone. */
const CAPPED_LINE = /^desktop tests: 1 file, concurrency (\d+) /;
/** What a rejected override says on stderr, so "ignored" can never be silent. */
const TYPO_WARNING = /is not a positive whole number: 01\. Ignoring it\./;
const ONE_FILE_LINE = /^desktop tests: 1 file, /;
const USAGE_ERROR = /needs a positive whole number/;
/*
 * "The child ran and reported its own result", in either reporter's spelling.
 * Not the summary line, and this took a CI failure to learn: node's default
 * reporter is the spec one on this machine (`✖ fails`, `ℹ tests 1`) and TAP
 * under CI (`not ok 1 - fails`, `# tests 549` — which is what the Desktop Tests
 * job greps for), so asserting on `ℹ tests` passed locally and reddened the
 * runner. A skipped run writes 0 bytes to stdout and matches neither form.
 */
const FAIL_REPORTED = /^(?:✖|not ok \d+ -) fails/m;
const PASS_REPORTED = /^(?:✔|ok \d+ -) passes/m;
/** What the reporting file saw, in either reporter's spelling of a pass. */
const REPORTS_ENV_PATTERN = /NOTIFICATIONS_ENV=(.+)$/m;

/*
 * Three throwaway test files: one that passes, one that fails, and one that
 * reports the notification switch it was handed. They live in the OS temp
 * directory, never in the repo, so a run of this file cannot leave the suite's
 * own tree dirty (the CI job asserts exactly that).
 */
const scratch = mkdtempSync(join(tmpdir(), "desktop-runner-"));
const PASSES = join(scratch, "passes.test.mjs");
const FAILS = join(scratch, "fails.test.mjs");
/*
 * Prints what it RECEIVED, rather than what the runner's source says it should
 * have: the claim is about the environment a suite's test files — and, through
 * them, every app and backend they spawn — are actually handed. `(unset)` is
 * printed for the missing case so a failed assertion says which shape arrived
 * instead of just showing an empty line.
 */
const REPORTS_ENV = join(scratch, "reports-env.test.mjs");
/*
 * Reports the flags ITS OWN process was started with, so the claim "the suite
 * really ran at this width" is observed from inside the suite rather than read
 * back out of the runner's source. A runner that resolves a number and then
 * forgets to pass it - or that passes a different one than it prints - is
 * exactly the silent failure this fixture exists to catch, and neither shows up
 * in the runner's own source.
 */
const DUMPS_ARGV = join(scratch, "dumps-argv.test.mjs");
const ARGV_OUT_ENV = "DESKTOP_RUNNER_ARGV_OUT";
writeFileSync(
	PASSES,
	'import { test } from "node:test";\ntest("passes", () => {});\n',
);
writeFileSync(
	FAILS,
	'import { test } from "node:test";\ntest("fails", () => { throw new Error("deliberate"); });\n',
);
writeFileSync(
	REPORTS_ENV,
	'import { test } from "node:test";\ntest("reports the switch it received", () => {\n\tconst value = process.env.LOCAL_OPERATOR_NO_NOTIFICATIONS;\n\tconsole.log(`NOTIFICATIONS_ENV=${value === undefined ? "(unset)" : value}`);\n});\n',
);
writeFileSync(
	DUMPS_ARGV,
	'import { writeFileSync } from "node:fs";\nimport { test } from "node:test";\ntest("dumps the flags it was started with", () => {\n\twriteFileSync(process.env.DESKTOP_RUNNER_ARGV_OUT, JSON.stringify(process.execArgv));\n});\n',
);
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/** The neighbour's own line, in either reporter's spelling. */
const NEIGHBOUR_REPORTED = /^(?:✔|ok \d+ -) passes/m;
/** The verdict's failure count, in either reporter's spelling. */
const ONE_FAILURE = /^(?:ℹ fail|# fail) 1\b/m;

/**
 * Run the runner and return its status, stdout and stderr.
 *
 * The environment is passed through UNFILTERED, deliberately. This harness used
 * to scrub `NODE_TEST_CONTEXT` itself, which made its exit-code assertions pass
 * whether or not the runner scrubbed anything — they were proving the harness,
 * not the runner, and QA caught exactly that. The scrub now lives in
 * `run-desktop-tests.mjs` (`_TEST_CONTEXT_ENV`) where it belongs, so every case
 * below runs with the variable genuinely present in the ambient environment, as
 * node exports it into this very test file.
 *
 * `timeout` is not decoration either: node's default test timeout is infinite,
 * so a runner that hangs instead of failing — which is what a malformed argv
 * used to do before the value check existed — would block the suite until CI's
 * job limit rather than reddening an assertion.
 */
function runRunner(args, extraEnv = {}, dropEnv = []) {
	// `dropEnv` exists because a case about the switch being ABSENT has to ask for
	// absence: the diagnostic experiment exports `LOCAL_OPERATOR_UI_TEST_CONCURRENCY`
	// into every step of its CI job, so a test that merely omitted the variable
	// would inherit it and assert the opposite of what it claims. Inherited values
	// are otherwise untouched, which is the point of the paragraph above.
	const env = { ...process.env, ...extraEnv };
	for (const key of dropEnv) delete env[key];
	const result = spawnSync(process.execPath, [RUNNER, ...args], {
		encoding: "utf8",
		env,
		timeout: 60000,
	});
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

/**
 * Run the runner over the argv-dumping fixture and hand back both what it
 * printed and the flags the SUITE'S OWN process was started with.
 *
 * The file is read rather than parsed from stdout because the child's argv is
 * the only witness to the command the runner actually built: node consumes
 * `--test` in the parent, so nothing the child can print would show the whole
 * command either way, but it does show the width the suite was given.
 */
function spawnedSuite(extraEnv, dropEnv = []) {
	const out = join(scratch, `argv-${process.pid}-${Math.random()}.json`);
	const run = runRunner(
		[DUMPS_ARGV],
		{ ...extraEnv, [ARGV_OUT_ENV]: out },
		dropEnv,
	);
	return { run, args: JSON.parse(readFileSync(out, "utf8")) };
}

test("the runner forwards the child's exit code", () => {
	const passing = runRunner([PASSES]);
	assert.equal(passing.status, 0, passing.stdout);

	const failing = runRunner([FAILS]);
	// 1, node's own status for a failing test file. A wrapper that returned 0
	// here would make every CI job green.
	assert.equal(failing.status, 1, failing.stdout);
});

test("an explicit --test-concurrency is forwarded and the governor stands aside", () => {
	const { status, stdout } = runRunner(["--test-concurrency=3", PASSES, FAILS]);
	const [line] = stdout.split("\n");
	// The bypass is visible in the line AND in the status: the cap did not
	// silently replace the number the caller asked for, and the failing file
	// still decided the outcome.
	assert.match(line, BYPASS_LINE);
	assert.equal(status, 1, stdout);
});

test("the governor's switch pins the suite to one worker, and the suite is told", () => {
	// `CI=1` is the arm this experiment runs in, so the switch has to outrank the
	// CI stand-down rather than be quietly dropped for being on a hosted runner.
	const { run, args } = spawnedSuite({ CI: "1", [OVERRIDE_ENV]: "1" });
	const [line] = run.stdout.split("\n");
	assert.equal(run.status, 0, run.stdout);
	assert.match(line, ONE_WORKER_LINE);
	// The line and the command have to agree, and both are checked: the line is
	// the only evidence a reader of the CI log has that the experiment ran the
	// mode it claimed, and the child's own argv is the only witness that the width
	// reached the suite at all.
	assert.ok(
		args.includes("--test-concurrency=1"),
		`the suite was not told to run one file at a time: ${JSON.stringify(args)}`,
	);
});

test("with the switch absent the suite gets the governor's number, and no other", () => {
	// DELETED, not merely omitted: the experiment exports the variable into every
	// step of its job, so inheriting it here would make this case assert the
	// opposite of what it claims.
	const { run, args } = spawnedSuite({ CI: "1" }, [OVERRIDE_ENV]);
	const [line] = run.stdout.split("\n");
	assert.equal(run.status, 0, run.stdout);
	assert.ok(!line.includes(OVERRIDE_ENV), line);
	const printed = CAPPED_LINE.exec(line);
	assert.ok(printed, `the governed run must still name its number: ${line}`);
	// Which term binds depends on the host, so the NUMBER is not pinned - the
	// invariant is. OFF adds no flag of its own, passes exactly the number it
	// printed, and never widens the pool behind the governor's back.
	assert.deepEqual(
		args.filter((arg) => arg.startsWith("--test-concurrency=")),
		[`--test-concurrency=${printed[1]}`],
	);
});

test("a mistyped switch is ignored out loud, not applied quietly", () => {
	// `01` is not the spelling `parseOverride` accepts, so the run is UNCAPPED by
	// the value somebody believes they set. That degradation is allowed; what is
	// not allowed is a line that reads as if the value had been applied, which is
	// how a diagnostic run ends up claiming a mode it never ran.
	const { run, args } = spawnedSuite({ CI: "1", [OVERRIDE_ENV]: "01" });
	const [line] = run.stdout.split("\n");
	assert.equal(run.status, 0, run.stdout);
	assert.ok(!line.includes(OVERRIDE_ENV), line);
	assert.match(
		run.stderr,
		TYPO_WARNING,
		`a rejected override has to say so: ${run.stderr}`,
	);
	const printed = CAPPED_LINE.exec(line);
	assert.ok(printed, line);
	assert.deepEqual(
		args.filter((arg) => arg.startsWith("--test-concurrency=")),
		[`--test-concurrency=${printed[1]}`],
	);
});

test("a single file is counted as one file, not one files", () => {
	const { status, stdout } = runRunner([PASSES]);
	const [line] = stdout.split("\n");
	// Which arm produces the cap depends on the host and the CI environment, so
	// only the count is pinned here.
	assert.match(line, ONE_FILE_LINE);
	assert.equal(status, 0, stdout);
});

test("a --test-concurrency with no value fails loudly instead of inventing a line", () => {
	for (const args of [
		["--test-concurrency"],
		["--test-concurrency="],
		["--test-concurrency=abc"],
		// Node ACCEPTS this one and runs the suite at its default width; being
		// stricter than node is the point, since `0` is not a worker count.
		["--test-concurrency=0"],
	]) {
		const { status, stdout, stderr } = runRunner([...args, PASSES]);
		// 9 is the status node itself uses for a missing value; for a non-numeric
		// or zero value this check is deliberately stricter than node.
		assert.equal(status, 9, `args ${JSON.stringify(args)}: ${stdout}${stderr}`);
		assert.match(stderr, USAGE_ERROR, `args ${JSON.stringify(args)}`);
		// And crucially: no evidence line claiming a cap that does not exist.
		assert.equal(stdout.trim(), "", `args ${JSON.stringify(args)}: ${stdout}`);
	}

	// The truly empty value slot, on its own because it is a different shape: the
	// flag is the last argument, so there is nothing in the slot at all. Without
	// this case the guard's `value === undefined` arm is uncovered — with a file
	// after the flag the slot holds that path and the pattern arm catches it
	// instead, which is how removing the whole disjunct survived the suite.
	const empty = runRunner(["--test-concurrency"]);
	assert.equal(empty.status, 9, empty.stdout);
	assert.match(empty.stderr, USAGE_ERROR);
	assert.equal(empty.stdout.trim(), "");
});

test("an ambient NODE_TEST_CONTEXT cannot make a failing suite report success", () => {
	/*
	 * Node exports this variable into every test-file process, and a nested
	 * `node --test` that inherits it warns (`node:test run() is being called
	 * recursively within a test file. skipping running files.`), skips running
	 * the files entirely — 0 bytes of stdout — and exits 0. Before the runner
	 * filtered it, this invocation returned 0. QA reproduced it on the gate
	 * command itself: `env NODE_TEST_CONTEXT=child-v8 pnpm test:desktop` over a
	 * sabotaged tree exited 0 in 0.41 s with no summary lines. That is the
	 * false-green class this whole change exists to remove, one level up.
	 */
	const failing = runRunner([FAILS], { NODE_TEST_CONTEXT: "child-v8" });
	assert.equal(failing.status, 1, failing.stdout);
	// The failing file really ran: the child reported the failure itself, which a
	// skipped run (0 bytes of stdout) cannot do. Without this the status
	// assertion alone could be satisfied by some other route to a non-zero exit.
	assert.match(failing.stdout, FAIL_REPORTED);

	// And the same variable must not disturb a passing suite.
	const passing = runRunner([PASSES], { NODE_TEST_CONTEXT: "child-v8" });
	assert.equal(passing.status, 0, passing.stdout);
	assert.match(passing.stdout, PASS_REPORTED);
});

test("the children the runner spawns are handed the notification kill switch", () => {
	/*
	 * The window this closes. `pnpm test:desktop` boots the real app; the app
	 * spawns a real backend; a session parking on a gate announces itself through
	 * `local_operator/tui/notify.py`, which on macOS is `osascript -e 'display
	 * notification ...'` — attributed to Script Editor, delivered to the
	 * operator's ACTUAL Notification Center. Roughly 46 of those arrived in six
	 * minutes mid-run and buried whatever he was reading. The switch that stops
	 * it is read at that path's source (`notifications_enabled()`); nothing in
	 * this repo set it, so the default was "banner".
	 *
	 * AMBIENT REMOVED FIRST, and that is the whole difference between a real
	 * test and a tautology: the runner passes the caller's environment through
	 * unfiltered apart from NODE_TEST_CONTEXT, so on a machine that exports the
	 * variable — the machine the incident happened on — a bare read of the child
	 * would pass with the runner doing nothing at all. `undefined` drops the key
	 * from the child environment, which is what makes this case about the
	 * DEFAULT rather than about the harness's own shell.
	 *
	 * The assertion is on what the CHILD PRINTED, not on the runner's source:
	 * the claim is about the environment a suite's test files — and, through
	 * them, every app and backend they spawn — actually receive.
	 */
	const { status, stdout } = runRunner([REPORTS_ENV], {
		LOCAL_OPERATOR_NO_NOTIFICATIONS: undefined,
	});
	assert.equal(status, 0, stdout);
	assert.equal(
		stdout.match(REPORTS_ENV_PATTERN)?.[0],
		"NOTIFICATIONS_ENV=1",
		stdout,
	);
});

test("a notification setting someone made deliberately survives the runner", () => {
	/*
	 * A default, not an override. Someone who exports a value — an operator
	 * silencing one run, say — means it, and a value this runner re-derived would
	 * be tooling deciding something about the operator's desktop without telling
	 * them. Both `0` and `1` are passed through untouched. That is NOT the same as
	 * saying `0` means "banners back on": the consumer silences on any non-empty
	 * value (`os.environ.get()`, see `notifications-off.mjs`), so `0` is off like
	 * `1`, and unsetting the key is the only way back on.
	 */
	for (const value of ["0", "1", "yes"]) {
		const { status, stdout } = runRunner([REPORTS_ENV], {
			LOCAL_OPERATOR_NO_NOTIFICATIONS: value,
		});
		assert.equal(status, 0, stdout);
		assert.equal(
			stdout.match(REPORTS_ENV_PATTERN)?.[0],
			`NOTIFICATIONS_ENV=${value}`,
			stdout,
		);
	}

	/*
	 * Empty is NOT a deliberate choice. The backend reads this variable with
	 * `os.environ.get()`, where `""` is falsy, i.e. still "notifications on": an
	 * empty value is what a stale export or a shell mishap leaves behind, and
	 * honouring it would leave every banner armed behind a variable that looks
	 * switched off. It takes the default, so the two cases agree about what "off"
	 * means.
	 */
	const empty = runRunner([REPORTS_ENV], {
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "",
	});
	assert.equal(empty.status, 0, empty.stdout);
	assert.equal(
		empty.stdout.match(REPORTS_ENV_PATTERN)?.[0],
		"NOTIFICATIONS_ENV=1",
		empty.stdout,
	);
});

/*
 * The per-lane bound, END TO END through the real runner - the proof the module's own
 * unit tests cannot give, because they inject the sampler, the clock and the kill, and
 * therefore never exercise "a real child of a real suite, found in a real process
 * table, then signalled".
 *
 * WHY THE BOUND IS 1 ms. The watchdog samples every 5 s and trips on the SECOND sample
 * that sees a lane (the first sighting starts its clock), so a tiny bound puts the trip
 * on the sampler's own schedule instead of adding a wait of its own.
 *
 * WHY THE FIXTURE SELF-LIMITS. This test asserts that a never-settling lane is killed,
 * so if the bound regressed, the fixture WOULD hang - two guards keep a failing case
 * from leaving a process behind: `spawnSync`'s own 60 s timeout inside `runRunner`, and
 * the fixture's refed 120 s timer, which ends it even if nothing kills it.
 */
const HANG_LANE = join(scratch, "lane-bound-hang.test.mjs");
writeFileSync(
	HANG_LANE,
	[
		'import { test } from "node:test";',
		'test("the hanging lane\'s own first test", () => {});',
		"// A live interval keeps this file from ever settling; the refed timer is its",
		"// self-limit, so even an unkilled fixture ends on its own.",
		"setTimeout(() => process.exit(0), 120000);",
		"setInterval(() => {}, 1000);",
		"await new Promise(() => {});",
		"",
	].join("\n"),
);

test("the per-lane bound names the lane it kills, and the rest of the suite still reports", () => {
	const result = runRunner([HANG_LANE, PASSES], {
		LOCAL_OPERATOR_UI_LANE_BOUND_MS: "1",
	});
	assert.equal(result.status, 1, result.stdout);
	assert.match(
		result.stdout,
		/per-lane bound [^;]*explicit LOCAL_OPERATOR_UI_LANE_BOUND_MS/,
		"the run must say which bound it used, not just which one shipped",
	);
	assert.ok(
		result.stderr.includes("LANE BOUND EXCEEDED"),
		"the bound must say what it did, or a reader is back to a truncated log",
	);
	assert.ok(
		result.stderr.includes(HANG_LANE),
		"and it must name the lane it killed",
	);
	assert.match(result.stderr, /killed pid \d+/);
	assert.match(
		result.stdout,
		NEIGHBOUR_REPORTED,
		"the neighbouring lane must still report its verdict",
	);
	assert.match(
		result.stdout,
		ONE_FAILURE,
		"and the killed lane is the one that fails",
	);
});
