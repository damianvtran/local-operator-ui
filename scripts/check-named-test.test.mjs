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
 *     instead of exiting zero having verified nothing.
 *
 * Every case builds its fixture in a temp dir, so the suite never depends on,
 * or mutates, the real test file. Duration assertions are generous caps whose
 * only job is to distinguish "fail fast" from "wait for the job timeout".
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

const HELPER = new URL("./check-named-test.mjs", import.meta.url).pathname;
const FAST_MS = 20_000;

// Hoisted: the repo's Biome config warns on regex literals created in a scope
// (useTopLevelRegex), and these are all fixed assertions.
const RE_NOT_PRESENT = /is not present in/;
const RE_PREDATES = /predates that test/;
const RE_UPDATE_FROM_BASE = /update it from the base branch/;
const RE_VERIFIED_ROW = /verified exact passing row: the guarded test/;
const RE_KILLED = /did not finish within 2s and was killed/;
const RE_NOT_A_HANG = /failure, not a pass, and not a hang/;
const RE_NO_EXACT_ROW = /without an exact passing row/;
const RE_UNKNOWN_OPTION = /unknown option/;

function fixture(name, source) {
	const dir = mkdtempSync(join(tmpdir(), "check-named-test-"));
	const file = join(dir, name);
	writeFileSync(file, source);
	return file;
}

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
const NAME_ONLY_IN_COMMENT = `import test from "node:test";
// the guarded test: renamed below, the old name survives only in this comment
test("the renamed test", () => {});
`;

test("a revision without the named test fails fast and says to update the branch", () => {
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
	assert.match(result.stderr, RE_PREDATES);
	assert.match(result.stderr, RE_UPDATE_FROM_BASE);
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
