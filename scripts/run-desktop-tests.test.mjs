import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

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
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

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
function runRunner(args, extraEnv = {}) {
	const result = spawnSync(process.execPath, [RUNNER, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
		timeout: 60000,
	});
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
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
	 * A default, not an override. Someone who exports `0` — an operator
	 * debugging why a banner went missing — means it, and an `1` set to silence a
	 * specific run must not be re-derived either. Both are passed through
	 * untouched, which is what keeps a deliberate choice from being silently
	 * inverted by tooling.
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
