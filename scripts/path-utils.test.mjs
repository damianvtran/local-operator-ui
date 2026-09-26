/**
 * The two path rules the chat header and the composer's chip share, driven
 * against the SHIPPED module.
 *
 * WHY THIS FILE EXISTS (agent review round 1, R3 and R10). Both defects were
 * reachable, were found by reading the module rather than by a test, and
 * `grep -rn middleTruncatePath scripts/` returned nothing at all - so the join
 * between "the contract in the docblock" and "what the function returns" had no
 * witness on either side. `formatDirectory` had the same gap from the other
 * direction: its every existing caller ships a path that happens to be under the
 * home directory, so the one input that tells "under home" from "starts with the
 * same characters" was never passed.
 *
 * The module is bundled rather than re-implemented, for the reason the file
 * beside it gives: a second copy of a rule is a second rule, and this repository
 * treats the copy as the defect.
 *
 * AND THE SUITE DISCRIMINATES, proved against the PRE-FIX module rather than
 * argued: `git show HEAD:src/renderer/src/shared/utils/path-utils.ts` bundled the
 * same way returns 42 characters for `middleTruncatePath("~/a/" + "b".repeat(38), 40)`,
 * `…bbbbbbbb` for a budget of 1, `~/x/project` for `/Users/damianx/project` and
 * `~/Other/src` for `C:\\Users\\DamianOther\\src` - so each assertion below
 * fails on the tree this change fixes and passes on the tree it ships.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/utils/path-utils";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { formatDirectory, middleTruncatePath } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* ---- middleTruncatePath: the budget is a BOUND, not a target ------------- */

/**
 * Every path shape the header can hand this function, and every budget from 0 to
 * 60 - because the defect R3 found was a budget-dependent one: the last-resort
 * branch only overran when the LAST SEGMENT was long enough to reach it, and the
 * `max <= 1` case only misbehaved at the small end. A single example would have
 * missed at least one of the two.
 */
const PATHS = [
	"/Users/damian/.local-operator/sessions/d81d04d3fd9c",
	"~/.local-operator/sessions/d81d04d3fd9c/scratchpad",
	"~/dev/projects/local-operator-ui",
	`~/a/${"b".repeat(38)}`,
	"~/a/bbbbbbbb",
	"A single segment with no separator at all",
	"~/",
	"~",
	"",
];

test("middleTruncatePath never returns more characters than its budget", () => {
	for (const path of PATHS) {
		for (let max = 0; max <= 60; max += 1) {
			const out = middleTruncatePath(path, max);
			assert.ok(
				out.length <= max || path.length <= max,
				`middleTruncatePath(${JSON.stringify(path).slice(0, 48)}…, ${max}) returned ${out.length} characters: ${JSON.stringify(out)}`,
			);
		}
	}
});

test("the shapes R3 measured are the shapes it now bounds", () => {
	// The reported input: a last segment that IS longer than the budget leaves for it.
	assert.equal(middleTruncatePath(`~/a/${"b".repeat(38)}`, 40).length, 40);
	// `max === 1`: the old `slice(-(max - 1))` is `slice(0)`, i.e. the whole segment.
	assert.equal(middleTruncatePath("~/aaaa/bbbbbbbb", 1), "…");
	// `max === 0`: `slice(-0)` is `slice(0)` too, so this was the same nine characters.
	assert.equal(middleTruncatePath("~/aaaa/bbbbbbbb", 0), "");
	// And nothing that already fits is touched, at any budget.
	for (const path of PATHS) {
		if (path.length <= 60)
			assert.equal(middleTruncatePath(path, path.length), path);
	}
});

/* ---- formatDirectory: "under home" means under home ---------------------- */

test("formatDirectory abbreviates a CHILD of home, and leaves a sibling alone", () => {
	const home = "/Users/damian";
	assert.equal(
		formatDirectory("/Users/damian/projects/x", home),
		"~/projects/x",
	);
	assert.equal(formatDirectory("/Users/damian", home), "~");
	// The sibling whose name merely STARTS with the account's (R10): the old
	// `startsWith(home)` rendered this as `~/x/project`.
	assert.equal(
		formatDirectory("/Users/damianx/project", home),
		"/Users/damianx/project",
	);
	assert.equal(formatDirectory("/Users/damia", home), "/Users/damia");
	// Backslashes: a Windows sibling of the home directory, and a real child.
	assert.equal(
		formatDirectory("C:\\Users\\DamianOther\\src", "C:\\Users\\Damian"),
		"C:/Users/DamianOther/src",
	);
	assert.equal(
		formatDirectory("C:\\Users\\Damian\\src", "C:\\Users\\Damian"),
		"~/src",
	);
	// Prose and agent names reach this slot too, and neither is a path.
	assert.equal(
		formatDirectory("Your on-device AI assistant", home),
		"Your on-device AI assistant",
	);
	// A home directory the bridge has not answered with yet shortens nothing.
	assert.equal(formatDirectory("/Users/damian/x", null), "/Users/damian/x");
});
