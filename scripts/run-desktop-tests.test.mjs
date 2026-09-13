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
 *     reviewer.
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
 * Two throwaway test files: one that passes and one that fails. They live in the
 * OS temp directory, never in the repo, so a run of this file cannot leave the
 * suite's own tree dirty (the CI job asserts exactly that).
 */
const scratch = mkdtempSync(join(tmpdir(), "desktop-runner-"));
const PASSES = join(scratch, "passes.test.mjs");
const FAILS = join(scratch, "fails.test.mjs");
writeFileSync(
	PASSES,
	'import { test } from "node:test";\ntest("passes", () => {});\n',
);
writeFileSync(
	FAILS,
	'import { test } from "node:test";\ntest("fails", () => { throw new Error("deliberate"); });\n',
);
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/**
 * Run the runner and return its status, stdout and stderr.
 *
 * `NODE_TEST_CONTEXT` is deliberately scrubbed, and this is not defensive
 * tidiness: node's test runner exports it into every test-file process, and an
 * inherited copy makes a NESTED `node --test` report its results to the
 * grandparent's reporter instead of setting its own exit status. Measured
 * directly (node 26.5.0): `node --test fails.test.mjs` exits 1, the same command
 * with `NODE_TEST_CONTEXT=child-v8` in the environment exits **0**. Without the
 * scrub these tests pass in a plain shell and fail — wrongly, and for the wrong
 * reason — inside this very suite, which is the "a local failure CI does not have
 * is usually your shell" class this repo already documents in AGENTS.md.
 */
function runRunner(args) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
	);
	const result = spawnSync(process.execPath, [RUNNER, ...args], {
		encoding: "utf8",
		env,
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
	]) {
		const { status, stdout, stderr } = runRunner([...args, PASSES]);
		// 9 is node's own invalid-argument status, so a caller keying off it sees
		// the same class of failure it saw before this check existed.
		assert.equal(status, 9, `args ${JSON.stringify(args)}: ${stdout}${stderr}`);
		assert.match(stderr, USAGE_ERROR, `args ${JSON.stringify(args)}`);
		// And crucially: no evidence line claiming a cap that does not exist.
		assert.equal(stdout.trim(), "", `args ${JSON.stringify(args)}: ${stdout}`);
	}
});
