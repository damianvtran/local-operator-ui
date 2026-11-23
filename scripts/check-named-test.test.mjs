#!/usr/bin/env node
/**
 * Regression suite for scripts/check-named-test.mjs.
 *
 * The property under test is not "the helper runs node" - it is that each of
 * the two ways a filtered `node --test` run can mislead now has a fast, loud,
 * discriminating outcome:
 *
 *   - a revision that does not carry the named test fails in SECONDS with a
 *     "this branch predates that test" message, instead of occupying the CI
 *     job until its ten-minute timeout (the incident this guards);
 *   - a revision that carries the name but emits no exact passing row fails
 *     instead of exiting zero having verified nothing;
 *   - a run that prints the row and THEN fails (a throwing `after` hook, a
 *     file-level error) fails, because the CI step this replaces ran under
 *     `bash -e -o pipefail` and a hang fix must not buy speed with that check.
 *
 * Every case builds its fixture in a temp dir and removes it afterwards, so the
 * suite never depends on, or mutates, the real test file. Duration assertions are
 * generous caps whose only job is to distinguish "fail fast" from "wait for the
 * job timeout".
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

const HELPER = new URL("./check-named-test.mjs", import.meta.url).pathname;
const FAST_MS = 20_000;

// Hoisted: the repo's Biome config warns on regex literals created in a scope
// (useTopLevelRegex), and these are all fixed assertions.
const RE_NOT_PRESENT = /is not present in/;
const RE_RENAMED_OR_REMOVED = /renamed or removed that test/;
const RE_UPDATE_NAME = /update this job's --name/;
const RE_VERIFIED_ROW = /verified exact passing row: the guarded test/;
const RE_KILLED = /did not finish within 2s and was killed/;
const RE_NOT_A_HANG = /failure, not a pass, and not a hang/;
const RE_NO_EXACT_ROW = /without an exact passing row/;
const RE_UNKNOWN_OPTION = /unknown option/;
const RE_EXITED = /exited 1/;
const RE_ROW_NOT_PASS = /did not pass even though the named row may appear/;

const fixtureDirs = [];

function fixture(name, source) {
	const dir = mkdtempSync(join(tmpdir(), "check-named-test-"));
	fixtureDirs.push(dir);
	const file = join(dir, name);
	writeFileSync(file, source);
	return file;
}

// Leave no temp directories behind: a CI runner is disposable, an operator's
// machine is not, and this suite is run locally while guarding a CI job.
test.after(() => {
	for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});

function run(args) {
	const started = Date.now();
	const result = spawnSync(process.execPath, [HELPER, ...args], {
		encoding: "utf8",
		env: { ...process.env, NODE_OPTIONS: "" },
	});
	return { ...result, elapsedMs: Date.now() - started };
}

const PASSING = `import test from "node:test";
test("the guarded test", () => {});
`;

// Module scope holds a handle; the test that would release it is the guarded
// one. With no name match the release never runs, which is precisely how a real
// suite hangs instead of exiting.
const HOLDS_HANDLE = `import test from "node:test";
const timer = setInterval(() => {}, 1000);
test("the guarded test", () => { clearInterval(timer); });
test("a different test", () => {});
`;

const HANGING = `import test from "node:test";
test("the guarded test", async () => { await new Promise(() => {}); });
`;

// The name appears only in a comment: the filter matches nothing, the file has
// no handle to hold, so node exits zero having run nothing. Without the exact
// row requirement this case would look green.
// Prints the exact passing row, then fails in an `after` hook. The old CI step
// ran under `bash -e -o pipefail` and went red; a helper that trusts the row
// alone would call this green.
const ROW_THEN_FAILING_HOOK = `import test, { after } from "node:test";
after(() => { throw new Error("hook failed after the test body"); });
test("the guarded test", () => {});
`;

const NAME_ONLY_IN_COMMENT = `import test from "node:test";
// the guarded test: renamed below, the old name survives only in this comment
test("the renamed test", () => {});
`;

test("a head without the named test fails fast and names the two real causes", () => {
	const file = fixture("absent.test.mjs", HOLDS_HANDLE);
	const result = run([
		"--file",
		file,
		"--name",
		"a name this file never carries",
		"--timeout-ms",
		"60000",
	]);

	assert.equal(result.status, 2, result.stderr);
	assert.match(result.stderr, RE_NOT_PRESENT);
	assert.match(result.stderr, RE_RENAMED_OR_REMOVED);
	assert.match(result.stderr, RE_UPDATE_NAME);
	// The whole point: seconds, not the job's timeout.
	assert.ok(
		result.elapsedMs < FAST_MS,
		`took ${result.elapsedMs}ms, expected fast fail`,
	);
});

test("the named test that exists and passes is verified by its exact row", () => {
	const file = fixture("passing.test.mjs", PASSING);
	const result = run([
		"--file",
		file,
		"--name",
		"the guarded test",
		"--timeout-ms",
		"60000",
	]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, RE_VERIFIED_ROW);
});

test("a run that outlives its bound is killed and reported, never left hanging", () => {
	const file = fixture("hanging.test.mjs", HANGING);
	const result = run([
		"--file",
		file,
		"--name",
		"the guarded test",
		"--timeout-ms",
		"2000",
	]);

	assert.equal(result.status, 3, result.stderr);
	assert.match(result.stderr, RE_KILLED);
	assert.match(result.stderr, RE_NOT_A_HANG);
	assert.ok(
		result.elapsedMs < FAST_MS,
		`took ${result.elapsedMs}ms, expected bounded`,
	);
});

test("a failing run that still printed the row is a failure, not a pass", () => {
	const file = fixture("hook-fails.test.mjs", ROW_THEN_FAILING_HOOK);
	const result = run([
		"--file",
		file,
		"--name",
		"the guarded test",
		"--timeout-ms",
		"60000",
	]);

	assert.equal(
		result.status,
		1,
		`expected 1, got ${result.status}: ${result.stderr}`,
	);
	assert.match(result.stderr, RE_EXITED);
	assert.match(result.stderr, RE_ROW_NOT_PASS);
});

test("a zero exit with no matching row is a failure, not a pass", () => {
	const file = fixture("comment-only.test.mjs", NAME_ONLY_IN_COMMENT);
	const result = run([
		"--file",
		file,
		"--name",
		"the guarded test",
		"--timeout-ms",
		"60000",
	]);

	assert.equal(
		result.status,
		1,
		`expected 1, got ${result.status}: ${result.stderr}`,
	);
	assert.match(result.stderr, RE_NO_EXACT_ROW);
});

test("usage errors are rejected instead of guessed", () => {
	const missingName = run(["--file", "scripts/browser-host.test.mjs"]);
	assert.equal(missingName.status, 64, missingName.stderr);

	const unknown = run(["--file", "x", "--name", "y", "--nope", "z"]);
	assert.equal(unknown.status, 64, unknown.stderr);
	assert.match(unknown.stderr, RE_UNKNOWN_OPTION);
});
