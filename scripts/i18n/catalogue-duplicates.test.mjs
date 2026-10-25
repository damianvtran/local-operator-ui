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
