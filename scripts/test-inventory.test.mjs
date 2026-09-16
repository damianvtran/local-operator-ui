import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

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
 * The rule: every test file under `scripts/` is either named in
 * `package.json`'s `test:desktop`, or named in `EXEMPT` below with the reason it
 * runs elsewhere (or nowhere, which is itself worth recording).
 */

/**
 * Files that deliberately do not run in the desktop suite, and where they do run.
 *
 * Each reason names the command a reader can run to see it, or says plainly
 * that nothing runs it — which is the honest answer for ONE entry below
 * (`session-cookie-electron.test.mjs`), and a gap in the repository rather than
 * in this list. (Round 4, R4-4: this sentence said "the two at the end" while
 * exactly one entry carried that reason.)
 */
const EXEMPT = {
	"scripts/check-scripts-lint.test.mjs":
		"`node --test scripts/check-scripts-lint.test.mjs`, its own CI step (ci.yml).",
	"scripts/release-baseline.test.mjs":
		"the release-gate suite in ci.yml, run as one node --test invocation.",
	"scripts/release-candidate.test.mjs":
		"same release-gate step as release-baseline.",
	"scripts/entry-point.test.mjs": "same release-gate step as release-baseline.",
	"scripts/require-report.test.mjs":
		"same release-gate step as release-baseline.",
	"scripts/session-cookie-electron.test.mjs":
		"`pnpm test:session-cookies` — it boots the REAL Electron binary twice, which no CI step does today; a pre-existing gap, recorded rather than papered over.",
};

test("every scripts/*.test.mjs is run by test:desktop or exempt with a reason", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const listed = new Set(
		(
			pkg.scripts["test:desktop"].match(/scripts\/[\w.-]+\.test\.mjs/g) ?? []
		).map((path) => path.replace(/\\/g, "/")),
	);
	const files = readdirSync("scripts")
		.filter((name) => name.endsWith(".test.mjs"))
		.map((name) => `scripts/${name}`)
		.sort();
	const missing = files.filter(
		(file) => !listed.has(file) && !(file in EXEMPT),
	);
	assert.deepEqual(
		missing,
		[],
		`a test file no CI step runs is a guard that cannot fail — add it to test:desktop or to EXEMPT with its reason:\n${missing.join("\n")}`,
	);
	// The table may not rot either: an exemption for a file that no longer
	// exists, or that is now listed, is a stale claim about where it runs.
	const stale = Object.keys(EXEMPT).filter(
		(file) => !files.includes(file) || listed.has(file),
	);
	assert.deepEqual(
		stale,
		[],
		"an EXEMPT entry must name an existing unlisted file",
	);
});
