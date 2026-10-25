/**
 * TESTS FOR THE CATALOGUE DUPLICATE-KEY GATE (`check-duplicates.mjs`).
 *
 * The gate reads raw catalogue text because `JSON.parse` silently keeps the
 * last of two same-named keys. These tests hold both halves of that claim:
 * the detector must SEE a duplicate that the parser swallows (a guard that
 * cannot fail is theatre), and the shipped catalogues must contain none.
 *
 * The negative control is the important half. A detector that always returned
 * `[]` would pass the second test forever.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	catalogueFiles,
	duplicateKeys,
	findDuplicates,
} from "./check-duplicates.mjs";

test("the detector catches a duplicate that JSON.parse would swallow", () => {
	// Planted duplicate: the parser keeps "second" and forgets "first".
	const planted = '{"a":1,"b":{"c":"first","c":"second"},"d":2}';
	assert.deepEqual(duplicateKeys(planted), ["c"]);
	assert.equal(JSON.parse(planted).b.c, "second");

	// The same key in DIFFERENT objects is not a duplicate.
	assert.deepEqual(duplicateKeys('{"a":{"title":"x"},"b":{"title":"y"}}'), []);

	// An escaped quote inside a value must not desynchronise the scan.
	assert.deepEqual(duplicateKeys('{"a":"say \\"hi\\"","b":1}'), []);

	// Strings in an array are values, never keys.
	assert.deepEqual(duplicateKeys('["a","b"]'), []);

	// Duplicates are found at any depth, not only at the top level.
	assert.deepEqual(duplicateKeys('{"a":{"b":{"c":1,"c":2}}}'), ["c"]);
});

test("no shipped catalogue contains a duplicate key", () => {
	const files = catalogueFiles();
	assert.ok(files.length > 0, "no catalogue files were found to scan");

	const { scanned, offenders } = findDuplicates(files);
	assert.ok(scanned > 0, "the scan reached zero files, which is not a pass");
	assert.deepEqual(offenders, [], "catalogue files with duplicate keys");
});

test("a backslash-u escaped key is the same key", () => {
	// JSON.parse folds these two into one key; the raw-text scan must too, or a
	// duplicate written with an escape is a false negative.
	assert.deepEqual(duplicateKeys('{"a":1,"\\u0061":2}'), ["a"]);
});

test("the CLI fails on a planted duplicate and passes on clean input", async () => {
	// The exit decision is the whole gate, and no CI job runs this suite — so the
	// failure path is exercised here rather than assumed. `--dir` exists for
	// this test; without it the guard would only ever see clean catalogues.
	const { spawnSync } = await import("node:child_process");
	const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");

	const scratch = mkdtempSync(join(tmpdir(), "dupes-"));
	const checker = new URL("./check-duplicates.mjs", import.meta.url).pathname;
	const run = (dir) =>
		spawnSync(process.execPath, [checker, "--dir", dir], { encoding: "utf8" });

	try {
		const dirty = join(scratch, "dirty");
		const clean = join(scratch, "clean");
		rmSync(dirty, { recursive: true, force: true });
		rmSync(clean, { recursive: true, force: true });
		// mkdtemp already made `scratch`; create the two children.
		const { mkdirSync } = await import("node:fs");
		mkdirSync(dirty);
		mkdirSync(clean);
		writeFileSync(join(dirty, "ui.x.json"), '{"a":1,"a":2}');
		writeFileSync(join(clean, "ui.x.json"), '{"a":1,"b":2}');

		const dirtyRun = run(dirty);
		assert.equal(dirtyRun.status, 1, dirtyRun.stderr);
		assert.match(dirtyRun.stderr, /duplicate key\(s\) a/);

		const cleanRun = run(clean);
		assert.equal(cleanRun.status, 0, cleanRun.stderr);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
