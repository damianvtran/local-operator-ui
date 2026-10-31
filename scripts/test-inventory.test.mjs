import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { EXEMPT } from "./desktop-test-inventory.mjs";
import { inventory } from "./desktop-test-shards.mjs";

/*
 * Every `scripts/*.test.mjs` runs somewhere CI runs, or says why not.
 *
 * WHY THIS EXISTS. Two suites added by round 2 — the conflict-marker guard that
 * closed a BLOCKER and the receipt guard — were in no `run:` step of any
 * workflow, so both were inert: a guard that cannot fail is a comment. The
 * inverse gap is the same defect seen from the other side, because
 * `test:desktop` is a hand-kept list: dropping a file from it leaves the
 * neighbouring suites green and the drop invisible.
 *
 * The rule: every test file under `scripts/` (recursively) is either in the
 * desktop inventory `pnpm test:desktop` and the CI shards run, or named in
 * `EXEMPT` (`desktop-test-inventory.mjs`) with the reason it runs elsewhere (or
 * nowhere, which is itself worth recording).
 *
 * SINCE THE INVENTORY IS DERIVED (2026-10-31) the "dropped from a hand list"
 * half cannot happen by construction, so this gate now pins the derivation
 * against an INDEPENDENT walk instead of trusting it: the planner's inventory
 * must equal "every test file minus EXEMPT", exactly, and EXEMPT may not rot.
 * The walk is recursive on purpose: the old top-level-only `readdirSync` never
 * saw `scripts/i18n/`, which is how nine i18n suites ran in no CI step at all.
 *
 * INDEPENDENT MEANS SHARES NO CODE. `treeTestFiles` below must never import or
 * call `walkTestFiles` (the planner's walk): with both sides on one function, a
 * bug in it (a wrong file filter, a skipped dirent type) changes both lists the
 * same way and cancels out. Review round 1, R1-1 proved it: a walk patched to
 * skip `catalogue-*` dropped three nested suites and this gate stayed green.
 * Node's own recursive `readdirSync` plus a plain suffix check is the second
 * opinion; `lane-registration` cannot be it, since it only looks at the top
 * level of `scripts/`. Reason-length rules are NOT checked here: the planner
 * owns them (`MIN_EXEMPT_REASON`) and refuses a short one, which fails this
 * gate through `inventory()` anyway (R1-2).
 */

/** Every `scripts/**\/*.test.mjs`, by a route deliberately unlike the planner's. */
function treeTestFiles() {
	return readdirSync("scripts", { recursive: true })
		.map((name) => `scripts/${name.split("\\").join("/")}`)
		.filter((path) => path.endsWith(".test.mjs"))
		.sort();
}

test("every scripts/**/*.test.mjs is run by test:desktop or exempt with a reason", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const listed = new Set(inventory(pkg.scripts["test:desktop"]));
	const files = treeTestFiles();
	assert.ok(
		files.some((file) => file.startsWith("scripts/i18n/")),
		"the walk must reach nested directories, or a whole subtree drops out unseen",
	);
	const missing = files.filter(
		(file) => !listed.has(file) && !(file in EXEMPT),
	);
	assert.deepEqual(
		missing,
		[],
		`a test file no CI step runs is a guard that cannot fail — it must be in the desktop inventory or in EXEMPT with its reason:\n${missing.join("\n")}`,
	);
	// Exactly once: nothing exempt still runs, nothing outside the tree is run.
	const extra = [...listed].filter(
		(file) => !files.includes(file) || file in EXEMPT,
	);
	assert.deepEqual(extra, [], "the inventory runs an exempt or absent file");
	assert.equal(listed.size, files.length - Object.keys(EXEMPT).length);
	// The table may not rot either: an exemption for a file that no longer
	// exists is a stale claim about where it runs (the planner also refuses it).
	const stale = Object.keys(EXEMPT).filter((file) => !files.includes(file));
	assert.deepEqual(
		stale,
		[],
		"an EXEMPT entry must name an existing test file",
	);
});
