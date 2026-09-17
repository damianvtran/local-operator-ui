import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	CATEGORIES,
	FLAGS,
	JOB_COMMANDS,
	JOB_FLAGS,
	LOCAL_EXCLUSIONS,
	PERMISSIVE_DEPS,
	ScopeError,
	UNGATED_JOBS,
	classify,
	flagValue,
	flagsFor,
	isPermissiveDependency,
} from "./ci-scope.mjs";

/*
 * The contract of the change-scope classifier, in the form CI and
 * `pnpm check-changed` both depend on.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS THIS LONG. The classifier decides which
 * jobs run. A defect in it does not look like a failure - it looks like a green
 * pull request with fewer checks - so nothing in a passing run would reveal it.
 * The backend repository shipped the first version of this design with its
 * repository root derived from the module's own path, and because the `changes`
 * job runs a COPY of the module from `$RUNNER_TEMP` the root resolved outside
 * the checkout, every git call failed, the fail-open branch answered "run
 * everything", and the gate never engaged on any pull request - while its own
 * run passed 17 of 17 assertions. Every assertion below therefore names the
 * DEFECT it catches and the MUTATION that must make it fail, and the ones that
 * cannot be seen in the module's values are driven against real repositories
 * and a real copy of the module instead.
 *
 * This suite rides in TWO places - the `check-types` job's release-contract step
 * and `package.json`'s `test:desktop` list - so it cannot silently stop running
 * the way the suites it guards once did.
 *
 * The workflow is read with js-yaml through the builder that already depends on
 * it, exactly as `scripts/test-publish-workflow.mjs` and
 * `scripts/check-build-env.mjs` do: a second YAML parser in `devDependencies`
 * for one script is a copy that can drift from the one the tree already runs.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");

const CI_YML = ".github/workflows/ci.yml";
const workflow = load(readFileSync(join(repoRoot, CI_YML), "utf8"));
const jobs = workflow.jobs;
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const MODULE = "scripts/ci-scope.mjs";

const jobIf = (job) => String(jobs[job]?.if ?? "");
const jobNeeds = (job) => {
	const needs = jobs[job]?.needs;
	if (needs === undefined) return [];
	return Array.isArray(needs) ? needs : [needs];
};
/** Every `run:` body of one job, in order, with the empty ones dropped. */
const runBlocks = (job) =>
	(jobs[job]?.steps ?? [])
		.map((step) => step.run)
		.filter((run) => typeof run === "string" && run.trim().length > 0);
const gatedJobs = Object.keys(JOB_FLAGS);

/** The jobs in `ci.yml` whose `if:` reads the classifier's output at all. */
const flagged = (job) => jobIf(job).includes("needs.changes.outputs.");

// ---------------------------------------------------------------------------
// A1 - every job is either gated on flags that exist, or declared ungated
// ---------------------------------------------------------------------------

/*
 * Defect: a job that takes no flag still runs on every pull request (the whole
 * cost this change exists to remove) and nobody notices, because a job that
 * always runs looks exactly like a job that decided to run; and a gate on a
 * flag the module never writes runs the job forever for the same reason.
 * Mutation: delete one gated job's `if:`; or add a job to `ci.yml` alone.
 */
test("A1: every job is gated on flags that exist, or is declared ungated", () => {
	for (const [job, flags] of Object.entries(JOB_FLAGS)) {
		assert.ok(jobs[job], `${job} is in JOB_FLAGS and not in ${CI_YML}`);
		assert.ok(
			jobNeeds(job).includes("changes"),
			`${job} is gated but does not \`needs: changes\`, so its flags are read from nothing`,
		);
		assert.ok(flags.length > 0, `${job} is gated on an empty flag list`);
		for (const flag of flags) {
			assert.ok(
				FLAGS.includes(flag),
				`${job} is gated on '${flag}', which is not in FLAGS: the module never writes that output, so the gate can never read it`,
			);
			assert.ok(
				jobIf(job).includes(`needs.changes.outputs.${flag}`),
				`${job}'s \`if:\` does not read needs.changes.outputs.${flag}`,
			);
		}
	}
	const declared = new Set([...gatedJobs, ...Object.keys(UNGATED_JOBS)]);
	for (const job of Object.keys(jobs)) {
		assert.ok(
			declared.has(job),
			`${job} is in ${CI_YML} and in neither JOB_FLAGS nor UNGATED_JOBS: an ungated job pays full price unnoticed`,
		);
	}
	for (const job of declared) {
		assert.ok(jobs[job], `${job} is declared here and absent from ${CI_YML}`);
	}
	for (const [job, reason] of Object.entries(UNGATED_JOBS)) {
		assert.ok(
			reason.trim().length > 0,
			`${job} is ungated with no reason recorded`,
		);
	}
});

// ---------------------------------------------------------------------------
// A2 - no job inherits a collateral skip, and no gate is `== 'true'`
// ---------------------------------------------------------------------------

/*
 * Defect: `needs:` skips a job whose dependency was SKIPPED, and GitHub applies
 * an implicit `success()` to any `if:` containing no status-check function. So
 * a deliberately skipped cheap gate silently skips the expensive job it guards
 * - `lint` skipped on an inert diff would skip `npx-sanity-check` - and a
 * missing `.result` clause on a FAILED dependency runs the expensive job
 * anyway.
 * Mutation: remove `!cancelled()` from a gated job; then remove a
 * `needs.<dep>.result == 'success'` clause.
 */
test("A2: every gate escapes the implicit success() and names its dependencies", () => {
	for (const job of Object.keys(jobs)) {
		if (!flagged(job)) continue;
		assert.match(
			jobIf(job),
			/!\s*cancelled\(\)/,
			`${job} is gated without a status-check function, so GitHub's implicit success() applies and a skipped dependency skips it`,
		);
		for (const dependency of jobNeeds(job)) {
			if (dependency === "changes") continue;
			assert.ok(
				jobIf(job).includes(`needs.${dependency}.result`),
				`${job} needs ${dependency} without naming its result, so a FAILED ${dependency} would still run it`,
			);
		}
	}
	for (const job of Object.keys(jobs)) {
		assert.doesNotMatch(
			jobIf(job),
			/always\(\)/,
			`${job} uses always(): it would run over a skipped dependency's missing artifacts (the shape D6 pins for coverage-report)`,
		);
	}
});

// ---------------------------------------------------------------------------
// A3 - `!= 'false'`, never `== 'true'`, and no empty output is ever written
// ---------------------------------------------------------------------------

/*
 * Defect: the single highest-severity one in this design. An output that was
 * never written is EMPTY, `'' == 'true'` is false, so a classifier that died
 * would produce a fully green pull request that ran nothing.
 * Mutation: flip one gate to `== 'true'`; make `flagValue` return '' for an
 * unknown value instead of raising.
 */
test("A3: every gate reads != 'false', and the writer refuses to emit a non-decision", () => {
	for (const job of gatedJobs) {
		for (const flag of JOB_FLAGS[job]) {
			assert.ok(
				jobIf(job).includes(`needs.changes.outputs.${flag} != 'false'`),
				`${job}'s gate on '${flag}' is not written as \`!= 'false'\`, so an output that was never written would skip it`,
			);
		}
		assert.doesNotMatch(
			jobIf(job),
			/==\s*'true'/,
			`${job} compares against 'true': a crashed classifier reads as a green PR that ran nothing`,
		);
	}
	// The writer is the second half of the same guarantee, so it is driven
	// rather than read: only a real boolean may reach `$GITHUB_OUTPUT`.
	assert.equal(flagValue("lint", { lint: true }), "true");
	assert.equal(flagValue("lint", { lint: false }), "false");
	for (const bad of ["", undefined, null, 0, 1, "true"]) {
		assert.throws(
			() => flagValue("lint", { lint: bad }),
			ScopeError,
			`flagValue accepted ${JSON.stringify(bad)}; an empty or malformed output is indistinguishable from a classifier that never ran`,
		);
	}
	assert.throws(() => flagValue("typo", { lint: true }), ScopeError);
});

// ---------------------------------------------------------------------------
// A4 - D8a: a skipped dependency must not be able to skip the job it guards
// ---------------------------------------------------------------------------

/*
 * Defect: `npx-sanity-check` needs three jobs. A job whose PREDICATE does not
 * imply its dependency's can be skipped by that dependency's intentional skip,
 * which silently disarms the expensive job.
 *
 * The implication is proved over the module's own predicates, by EVALUATING
 * `flagsFor` over every subset of the categories rather than by comparing flag
 * names - `pack`, `lint` and `types` are three names for one predicate, so a
 * name-subset test would answer "not implied" and demand a permissive clause
 * where none is needed. Only the predicate can answer the question.
 *
 * Mutation: widen `pack` so it no longer implies `lint` (e.g. release_bump-style
 * narrowing); or delete the reason string on the permissive pair.
 */
test("A4: dependency clauses match the implication the module actually guarantees", () => {
	const vectors = flagVectors();
	const runs = (job, flags) => JOB_FLAGS[job].every((flag) => flags[flag]);
	for (const job of gatedJobs) {
		for (const dependency of jobNeeds(job)) {
			if (dependency === "changes") continue;
			const implied = vectors.every(
				(flags) => !runs(job, flags) || runs(dependency, flags),
			);
			const permissive = isPermissiveDependency(job, dependency);
			if (implied) {
				assert.ok(
					!permissive,
					`${job} -> ${dependency}: types(${job}) implies types(${dependency}) for every flag vector, so the STRICT clause is required and the pair must not be in PERMISSIVE_DEPS`,
				);
				assert.ok(
					jobIf(job).includes(`needs.${dependency}.result == 'success'`) &&
						!jobIf(job).includes(`needs.${dependency}.result == 'skipped'`),
					`${job} -> ${dependency} must be the strict \`== 'success'\` clause`,
				);
			} else {
				assert.ok(
					permissive,
					`${job} -> ${dependency}: a flag vector exists where ${job} runs and ${dependency} was deliberately skipped, so the pair must be declared in PERMISSIVE_DEPS with a reason, and it is not`,
				);
				assert.ok(
					jobIf(job).includes(
						`(needs.${dependency}.result == 'success' || needs.${dependency}.result == 'skipped')`,
					),
					`${job} -> ${dependency} is declared permissive and the workflow uses the strict clause, so a deliberately skipped ${dependency} skips ${job}`,
				);
			}
		}
	}
	for (const pair of PERMISSIVE_DEPS) {
		assert.ok(
			pair.reason.trim().length > 0,
			`the permissive pair ${pair.job} -> ${pair.dependency} carries no reason`,
		);
		assert.ok(
			gatedJobs.includes(pair.job) && gatedJobs.includes(pair.dependency),
			`PERMISSIVE_DEPS names a job that is not gated: ${pair.job} -> ${pair.dependency}`,
		);
	}
	// The declaration is load-bearing only if the vector it was written for
	// exists: a `src/**`-only diff runs the pack and not the audit. Without this
	// the pair could survive as an unexercised exception.
	assert.ok(
		vectors.some((flags) => flags.pack && !flags.audit),
		"no flag vector runs `pack` without `audit`, so the permissive pair is not the shape it claims to describe",
	);
});

// ---------------------------------------------------------------------------
// A5 - the classification itself: prose is inert, source is not
// ---------------------------------------------------------------------------

/*
 * Defect: the classification regressing in either direction - to "everything
 * always runs" (the state this change removes) or to "nothing runs" (a guard
 * that cannot fail).
 * Mutation: drop `other` from the live categories; or add `docs` to the
 * evidence branch so prose keeps the desktop suite.
 */
test("A5: a prose-only diff selects nothing, and source selects the code suite", () => {
	const docsOnly = classify(["docs/BUILD.md"]);
	for (const flag of FLAGS) {
		assert.equal(
			docsOnly[flag],
			false,
			`a docs-only diff set '${flag}': prose is the one category no job in this workflow reads`,
		);
	}
	assert.equal(docsOnly.release_bump, false);

	const withSource = classify(["docs/BUILD.md", "src/main/app.ts"]);
	for (const flag of ["lint", "types", "unit", "pack"]) {
		assert.equal(
			withSource[flag],
			true,
			`adding src/main/app.ts left '${flag}' false: a source change must keep the code suite`,
		);
	}
	// `runtime_deps` and `audit` stay false here, and that is the design rather
	// than a hole: they read `package.json` and the lockfile, neither of which
	// moved, so running them would be a check about a file this diff did not
	// touch. A9 pins the direction that cannot be traded away - an unrecognised
	// path still runs the code suite.
	assert.equal(withSource.runtime_deps, false);
	assert.equal(withSource.audit, false);

	// The motivating shape, front to back: a manifest the gates read is live, a
	// root-level markdown file is prose, and the workflow that does the gating
	// runs everything.
	const rootMarkdown = classify(["README.md"]);
	assert.equal(rootMarkdown.unit, false);
	assert.equal(rootMarkdown.lint, false);
	assert.equal(classify([".github/workflows/ci.yml"]).pack, true);
});

// ---------------------------------------------------------------------------
// A8 - release_bump is the LINE PAIR, never the filename
// ---------------------------------------------------------------------------

const VERSION_BUMP_DIFF = [
	"diff --git a/package.json b/package.json",
	"--- a/package.json",
	"+++ b/package.json",
	"@@ -3,7 +3,7 @@",
	'   "private": true,',
	'-  "version": "0.26.9",',
	'+  "version": "0.27.0",',
	'   "type": "module",',
	"",
].join("\n");

const DEPENDENCY_EDIT_DIFF = [
	"diff --git a/package.json b/package.json",
	"--- a/package.json",
	"+++ b/package.json",
	"@@ -30,6 +30,7 @@",
	'   "dependencies": {',
	'+    "electron-updater": "^6.3.9",',
	'     "electron": "^31.0.0"',
	"   },",
	"",
].join("\n");

/*
 * Defect: a dependency, metadata or `scripts` edit read as a release bump,
 * which silently drops the audit, the typecheck, the whole desktop suite and
 * the pack from the pull request that changed what gets INSTALLED.
 * Mutation: match the filename rather than the line pair; or accept a diff in
 * which only SOME body lines are version lines.
 */
test("A8: only a version-line-only package.json diff is a release bump", () => {
	const bump = classify(["package.json"], VERSION_BUMP_DIFF);
	assert.equal(bump.release_bump, true);
	for (const flag of FLAGS) {
		assert.equal(
			bump[flag],
			false,
			`a version-only bump set '${flag}': the version-bump guard is the only check that can read it`,
		);
	}

	const edit = classify(["package.json"], DEPENDENCY_EDIT_DIFF);
	assert.equal(
		edit.release_bump,
		false,
		"a dependency edit was read as a release bump, which would drop the audit and the suite from the PR that changed the install",
	);
	for (const flag of FLAGS) {
		assert.equal(
			edit[flag],
			true,
			`a dependency edit left '${flag}' false; a manifest change keeps every gate a manifest change earns`,
		);
	}

	// A bump in company with any other path is not a bump either.
	assert.equal(
		classify(["package.json", "src/a.ts"], VERSION_BUMP_DIFF).release_bump,
		false,
	);
	// Same file, a version line AND a metadata line: not a bump.
	assert.equal(
		classify(["package.json"], `${VERSION_BUMP_DIFF}+  "description": "x",\n`)
			.release_bump,
		false,
		"a diff with a version line and another changed line was read as a version-only bump",
	);
	// A manifest edit with no diff at all cannot be read as a bump.
	assert.equal(classify(["package.json"], "").release_bump, false);
	assert.equal(classify(["package.json"], undefined).release_bump, false);
});

// ---------------------------------------------------------------------------
// A9 - fail open, loudly, on every path where the answer is unknown
// ---------------------------------------------------------------------------

/*
 * Defect: a silent all-false on infrastructure trouble - the "green pipeline
 * that did nothing" failure `scripts/entry-point.mjs` documents - and the
 * inverse, an unrecognised path quietly skipping the code suite.
 * Mutation: make main() return all-false in the unresolvable-base branch; drop
 * the `::warning::`.
 */
test("A9: an unknown path runs the code suite", () => {
	for (const unknown of ["foo.bar", "newdir/x", "assets/logo.svg"]) {
		const flags = classify([unknown]);
		for (const flag of ["lint", "types", "unit", "pack"]) {
			assert.equal(
				flags[flag],
				true,
				`'${unknown}' is unrecognised and did not set '${flag}': unrecognised must fail OPEN`,
			);
		}
	}
});

test("A9: an unresolvable base runs every job, warns, and exits 0", () => {
	const { repo, base } = scratchRepo();
	// A SHA that is not in this repository at all: `resolveBase` tries the merge
	// base and then the revision itself, and both fail.
	const run = runClassifier(
		["--event", "pull_request", "--base", "0".repeat(40)],
		repo,
	);
	assert.equal(run.status, 0, "an unresolvable base must not fail the run");
	assert.match(
		run.stdout,
		/::warning title=Change classification unavailable::/,
	);
	assert.match(run.stdout, /every job runs/);
	for (const flag of FLAGS) {
		assert.match(
			run.stdout,
			new RegExp(`\`${flag}\` = \\*\\*true\\*\\*`),
			`'${flag}' was not left true on an unresolvable base`,
		);
	}
	assert.notEqual(base, "");
});

test("A9: no repository at all runs every job, warns, and exits 0", () => {
	// The shape the fail-open branch exists for, and the one a `git diff`
	// failure takes: nothing about the change can be read, so everything runs.
	// The module is the $RUNNER_TEMP COPY, outside the checkout, because a
	// module run from inside this repository would legitimately fall back to the
	// tree it ships in (see `defaultRoot`) - that fallback is the second of the
	// two independent fixes, and it is not the shape under test here.
	const { dir } = scratchRepo();
	const copy = copyModuleOutside(dir);
	const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: dir,
		encoding: "utf8",
	});
	assert.notEqual(
		probe.status,
		0,
		`${dir} is inside a repository (${tmpdir()} is not a neutral scratch location on this host), so this test would not be driving the no-repository shape`,
	);
	const run = runClassifier(
		["--event", "pull_request", "--base", "HEAD"],
		dir,
		copy,
	);
	assert.equal(run.status, 0);
	assert.match(
		run.stdout,
		/::warning title=Change classification unavailable::/,
	);
	for (const flag of FLAGS) {
		assert.match(run.stdout, new RegExp(`\`${flag}\` = \\*\\*true\\*\\*`));
	}
});

// ---------------------------------------------------------------------------
// A10 - a rename is classified on BOTH sides
// ---------------------------------------------------------------------------

/*
 * Defect: a rename OUT of the inert set classified on its destination alone, so
 * a diff that MOVED prose into source reads as a prose diff and skips the code
 * suite.
 * Mutation: classify only the new path in `parseNameStatus`.
 */
test("A10: a rename out of the inert set keeps the code suite", () => {
	const { repo, base } = scratchRepo();
	mkdirSync(join(repo, "src"), { recursive: true });
	mv(join(repo, "docs/BUILD.md"), join(repo, "src/BUILD.md"), repo);
	commitAll(repo, "move the doc into src");
	const run = runClassifier(
		[
			"--event",
			"pull_request",
			"--base",
			base,
			"--summary",
			join(repo, ".summary"),
		],
		repo,
	);
	assert.equal(run.status, 0);
	assert.match(
		run.stdout,
		/`docs\/BUILD.md` -> `docs`/,
		"the rename's OLD path was not classified",
	);
	assert.match(run.stdout, /`src\/BUILD.md` -> `other`/);
	assert.match(run.stdout, /`lint` = \*\*true\*\*/);
});

// ---------------------------------------------------------------------------
// A11 + A12 - the module, the workflow and the local command are one opinion
// ---------------------------------------------------------------------------

/*
 * Defect: `pnpm check-changed` (or a job's own commands) drifting from what CI
 * runs, so the local gate is green about a different set of checks than the one
 * that gates the merge.
 * Mutation: change the module's lint command; drop a job from JOB_COMMANDS
 * without recording an exclusion.
 */
test("A11: every job's local commands exist and match the workflow's own steps", () => {
	for (const [job, commands] of Object.entries(JOB_COMMANDS)) {
		assert.ok(
			gatedJobs.includes(job),
			`JOB_COMMANDS names '${job}', which is not a gated job`,
		);
		assert.ok(
			!Object.hasOwn(LOCAL_EXCLUSIONS, job),
			`'${job}' is in JOB_COMMANDS and in LOCAL_EXCLUSIONS`,
		);
		assert.ok(
			commands.length > 0,
			`'${job}' has no local command, so it must be in LOCAL_EXCLUSIONS with a reason`,
		);
		const blocks = runBlocks(job);
		for (const command of commands) {
			// The FIRST TWO TOKENS rather than the whole string: the local spelling
			// of a step may carry a prefix CI does not (`pnpm lint:scripts` is run
			// in CI with `LINT_SINCE=... ` in front of it), which is exactly the
			// point of the shared module. Comparing the pair is what catches a
			// command drifting to a different tool, and two tokens is the
			// strongest check that the prefix cannot defeat.
			const [tool, argument] = command.split(/\s+/);
			assert.ok(
				blocks.some(
					(block) => block.includes(tool) && block.includes(argument),
				),
				`'${job}' claims the local command \`${command}\`, and no \`run:\` block of that job in ${CI_YML} invokes both \`${tool}\` and \`${argument}\`: the local gate and CI have drifted into two opinions`,
			);
		}
	}
	const known = new Set([
		...Object.keys(JOB_COMMANDS),
		...Object.keys(LOCAL_EXCLUSIONS),
	]);
	for (const job of gatedJobs) {
		assert.ok(
			known.has(job),
			`'${job}' is gated and has neither a local command nor a recorded reason it cannot have one`,
		);
	}
	for (const [job, reason] of Object.entries(LOCAL_EXCLUSIONS)) {
		assert.ok(
			reason.trim().length > 0,
			`'${job}' is excluded locally with no reason recorded`,
		);
	}
});

/*
 * Defect: a second, hand-written mapping growing in the workflow or in
 * `package.json`, which is how the two answers come to disagree.
 * Mutation: add a flag to the module and not to the `changes` job's `outputs:`;
 * inline a job list in `package.json`.
 */
test("A12: one module is named by both entry points, and FLAGS is the outputs list", () => {
	const outputs = Object.keys(jobs.changes.outputs).sort();
	assert.deepEqual(
		outputs,
		[...FLAGS].sort(),
		"the `changes` job's outputs and the module's FLAGS disagree, so a flag exists on one side only",
	);
	const changesRun = runBlocks("changes").join("\n");
	assert.ok(
		changesRun.includes("ci-scope.mjs"),
		`the \`changes\` job does not run ${MODULE}`,
	);
	const checkChanged = String(pkg.scripts["check-changed"] ?? "");
	assert.ok(
		checkChanged.includes(MODULE),
		"`pnpm check-changed` does not name the classifier module",
	);
	assert.ok(
		checkChanged.includes("--since") && checkChanged.includes("--run"),
		"`pnpm check-changed` must classify from a base ref and run the selected gates",
	);
	assert.ok(
		checkChanged.includes("merge-base"),
		"`pnpm check-changed` must name the merge base it compares against",
	);
});

// ---------------------------------------------------------------------------
// A13 - the gates cannot be disarmed by the diff they gate, and the copied
//       module can still find the repository
// ---------------------------------------------------------------------------

/*
 * Defect (the expensive one): the `changes` job runs a COPY of the module from
 * `$RUNNER_TEMP`, outside the checkout. A module that resolves its repository
 * from its own path, or that imports a sibling the step does not copy, dies
 * before writing an output - and behind `!= 'false'` that is SILENT, presenting
 * as "every job ran" on every pull request. Nothing in a green CI run reveals
 * it: the backend repository shipped exactly this and its own run passed every
 * assertion while the gate was dead.
 * Mutations: (a) resolve the root from the module's own path; (b) drop
 * `version-bump-guard.mjs` from the step's `git show` lines; (c) run the head
 * copy instead of the base revision.
 */
test("A13: the classifier is read from the base revision, and every copied file with it", () => {
	const step = (jobs.changes.steps ?? []).find(
		(candidate) => typeof candidate.run === "string",
	);
	assert.ok(step, "the `changes` job has no `run:` step");
	const run = step.run;
	for (const required of [
		"git rev-parse HEAD^1",
		"git cat-file -e",
		"git show",
		"--all",
	]) {
		assert.ok(
			run.includes(required),
			`the classifier step does not contain \`${required}\`: a PR could disarm the gates that classify it`,
		);
	}
	// Belt-and-braces with `defaultRoot`, and required for the same reason: the
	// step runs a copy from outside the checkout, so the root is named rather
	// than inferred.
	assert.ok(
		run.includes('--root "$GITHUB_WORKSPACE"'),
		"the classifier step must pass --root explicitly; the module resolves it from the invocation directory as well, and two independent fixes beat one clever default",
	);

	// The transitive relative-import closure, derived from the module rather than
	// from a list in the workflow: a list is the thing that rots.
	const closure = relativeImportClosure(MODULE);
	assert.ok(
		closure.size > 0,
		`${MODULE} imports nothing relative; expected its reuse set`,
	);
	for (const file of closure) {
		assert.ok(
			run.includes(file),
			`the classifier step does not copy ${file}, which ${MODULE} imports: node cannot resolve it from $RUNNER_TEMP, the classifier dies before writing an output, and behind \`!= 'false'\` every job runs on every PR forever`,
		);
	}
});

test("A13: the copied module classifies from the invocation directory, not its own path", () => {
	const { dir, repo, base } = scratchRepo();
	// A prose-only change: the answer this test reads is a FALSE, because a
	// module that looked for its repository beside itself would fail every git
	// call and answer "everything runs" instead.
	append(join(repo, "docs/BUILD.md"), "more prose\n");
	commitAll(repo, "docs only");
	const copy = copyModuleOutside(dir);
	const run = runClassifier(
		["--event", "pull_request", "--base", base, "--verbose"],
		repo,
		copy,
	);
	assert.equal(run.status, 0, "the copied classifier failed to run");
	assert.match(
		run.stderr,
		new RegExp(`ci-scope: root=${escapeRegExp(repo)}`),
		"the copied module did not resolve its repository from the invocation directory: this is the exact defect that made the backend gate dead while its own run passed",
	);
	assert.match(
		run.stdout,
		/`docs\/BUILD.md` -> `docs`/,
		"the copied module classified no path, so its git calls were answered by something other than this repository",
	);
	for (const flag of FLAGS) {
		assert.match(
			run.stdout,
			new RegExp(`\`${flag}\` = \\*\\*false\\*\\*`),
			`a prose-only diff on the copied module left '${flag}' true, which is what a broken root looks like: fail-open, silently, forever`,
		);
	}
	// And the wiring the workflow adds on top resolves the same repository from a
	// cwd that is not in it at all, which is what `--root "$GITHUB_WORKSPACE"`
	// buys: the step is independent of `defaultRoot`'s cleverness.
	const elsewhere = join(dir, "elsewhere");
	mkdirSync(elsewhere, { recursive: true });
	const explicit = runClassifier(
		["--event", "pull_request", "--base", base, "--root", repo],
		elsewhere,
		copy,
	);
	assert.equal(explicit.status, 0);
	assert.match(explicit.stdout, /`docs\/BUILD.md` -> `docs`/);
});

// ---------------------------------------------------------------------------
// A16 (UI) - committed evidence is TEST INPUT, not prose
// ---------------------------------------------------------------------------

/*
 * Defect: treating `docs/**` as one inert block, which stops running the
 * desktop suite on a change to that suite's own input - `evidence-manifest.
 * test.mjs` reads `docs/evidence/manifest.json`, `clear-search.test.mjs`,
 * `new-chat-row-evidence.test.mjs` and `evidence-run-guard.test.mjs` read their
 * captured frames, and `chrome-keychain.test.mjs` walks the tree. A green PR
 * that tested nothing.
 * Mutation: return `docs` for `docs/evidence/**`.
 */
test("A16: docs/evidence/** keeps the suite and nothing else", () => {
	const flags = classify(["docs/evidence/manifest.json"]);
	assert.equal(
		flags.unit,
		true,
		"a change to committed evidence must run the suite that reads it",
	);
	assert.equal(flags.pack, false, "committed evidence is not built or packed");
	assert.equal(flags.lint, false);
	assert.equal(flags.types, false);
	assert.equal(flags.runtime_deps, false);
	assert.equal(flags.audit, false);
	// A frame under a *sub*directory, and the directory itself, are the same
	// category: the prefix rule is what decides, not a depth.
	assert.equal(classify(["docs/evidence/usage/01-loaded.png"]).unit, true);
	assert.equal(classify(["docs/evidence/README.md"]).unit, true);
	assert.equal(classify(["docs/evidence"]).unit, true);
});

// ---------------------------------------------------------------------------
// A17 (UI) - the desktop suite runs ONCE per job, and the step fails closed
// ---------------------------------------------------------------------------

/*
 * Defect: the `test` job invoked `pnpm test:desktop` twice - once for its exit
 * status and again inside the count assertions - so the dominant cost of the
 * job was paid twice for no signal. `pipefail` gives the first half; the counts
 * give the second (a renamed script or a glob matching nothing still exits 0).
 * Mutation: re-add the second `pnpm test:desktop`.
 */
test("A17: exactly one desktop-suite invocation, behind a failing-closed step", () => {
	const invocations = runBlocks("test")
		.join("\n")
		.match(/pnpm test:desktop\b/g);
	assert.equal(
		invocations?.length ?? 0,
		1,
		`the 'test' job invokes \`pnpm test:desktop\` ${invocations?.length ?? 0} times; the suite is the job's dominant cost and one run plus the count assertions is the whole signal`,
	);
	const blocks = runBlocks("test");
	const suite = blocks.find((block) => block.includes("pnpm test:desktop"));
	assert.match(
		suite,
		/set -o pipefail/,
		"the single suite step does not set pipefail, so a red suite would be swallowed by the pipe into tee",
	);
	// The assertions that stop a renamed script or a glob matching nothing from
	// reading as a pass have to survive the collapse.
	assert.match(suite, /-lt 60/, "the pass-count floor is gone");
	assert.match(suite, /"\$FAIL" != "0"/, "the fail-count assertion is gone");
	assert.ok(
		blocks.some((block) => block.includes("git status --porcelain")),
		"the 'the run left the tree clean' assertion is gone",
	);
	assert.ok(
		JOB_COMMANDS.test.some((command) => command.includes("pnpm test:desktop")),
		"the module's local command for the 'test' job no longer names the suite CI runs",
	);
});

// ---------------------------------------------------------------------------
// A18 (UI) - the local command and CI share the module, and this suite is
//             wired into BOTH of the places that run it
// ---------------------------------------------------------------------------

/*
 * Defect: this suite itself becoming a guard nothing runs - the failure mode
 * every other file in this tree names. It rides in the `check-types` job's
 * release-contract step AND in `test:desktop`, and `scripts/test-inventory.
 * test.mjs` refuses a test file that is in neither.
 * Mutation: drop it from the release-contract step; or from `test:desktop`.
 */
test("A18: this suite is wired into a CI step and the desktop list", () => {
	const contracts = runBlocks("check-types").join("\n");
	assert.ok(
		contracts.includes("scripts/ci-scope.test.mjs"),
		"the release-contract step does not run this suite, so nothing would notice it becoming a guard nothing runs",
	);
	const desktopList = String(pkg.scripts["test:desktop"]);
	assert.ok(
		desktopList.includes("scripts/ci-scope.test.mjs"),
		"`test:desktop` does not list this suite",
	);
	assert.ok(
		contracts.includes("node scripts/check-build-env.mjs"),
		"the release-contract step lost the build-environment contract this suite reads the workflow for",
	);
});

// ---------------------------------------------------------------------------
// A19 - the local shape sees the index, the working tree and untracked files
// ---------------------------------------------------------------------------

/*
 * Defect: `pnpm check-changed` reporting on a committed diff only, so a
 * developer's own uncommitted work - the case it exists for - is invisible and
 * the local gate passes over a change CI will then fail on.
 * Mutation: drop the `git ls-files --others` half of `collectPaths`.
 */
test("A19: a local run sees untracked and uncommitted work", () => {
	const { repo, base } = scratchRepo();
	mkdirSync(join(repo, "src"), { recursive: true });
	writeFileSync(join(repo, "src/untracked.ts"), "export const x = 1;\n");
	const local = runClassifier(["--since", base], repo);
	assert.equal(local.status, 0);
	assert.match(
		local.stdout,
		/`src\/untracked.ts` -> `other`/,
		"an untracked file was not classified, so a local run would report on a diff the developer has not got",
	);
	assert.match(local.stdout, /`lint` = \*\*true\*\*/);

	// The CI shape deliberately does NOT see it: `--base` names the revision the
	// checkout was built on, and an uncommitted file is not part of it.
	const ci = runClassifier(["--event", "pull_request", "--base", base], repo);
	assert.doesNotMatch(ci.stdout, /src\/untracked\.ts` -> /);
});

// ---------------------------------------------------------------------------
// A20 - `main(["--all"])` is the fallback the workflow depends on
// ---------------------------------------------------------------------------

/*
 * Defect: the no-classifier-at-the-base fallback quietly narrowing instead of
 * widening, so the one code path that is never exercised on a normal PR is also
 * the one nothing checks.
 * Mutation: make `--all` return false for one flag.
 */
test("A20: --all writes every flag true", () => {
	const { repo } = scratchRepo();
	const output = join(repo, ".github-output");
	const run = runClassifier(
		["--all", "--github-output", output, "--summary", join(repo, ".summary")],
		repo,
	);
	assert.equal(run.status, 0);
	const written = readFileSync(output, "utf8").trim().split("\n");
	assert.deepEqual(
		written,
		FLAGS.map((flag) => `${flag}=true`),
		"--all did not write every flag as true, so the fallback would skip jobs",
	);
	assert.match(readFileSync(join(repo, ".summary"), "utf8"), /### Jobs/);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const git = (args, cwd) => {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(
		result.status,
		0,
		`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`,
	);
	return result.stdout;
};

/**
 * A throwaway repository with one commit, plus the directory that contains it -
 * so a copy of the module can be placed BESIDE the checkout, which is the shape
 * `$RUNNER_TEMP` has in CI.
 */
function scratchRepo() {
	// `realpathSync` because a git top level is PHYSICAL while `tmpdir()` is not
	// on macOS (`/var/folders/...` is a symlink into `/private/var/folders/...`),
	// so an expectation written from the unresolved path would compare two
	// spellings of one directory.
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "ci-scope-")));
	const repo = join(dir, "repo");
	mkdirSync(join(repo, "docs"), { recursive: true });
	git(["init", "-q", "-b", "main"], repo);
	git(["config", "user.email", "test@example.invalid"], repo);
	git(["config", "user.name", "ci-scope test"], repo);
	git(["config", "commit.gpgsign", "false"], repo);
	writeFileSync(join(repo, "docs/BUILD.md"), "# build\n");
	git(["add", "-A"], repo);
	git(["commit", "-qm", "base"], repo);
	return { dir, repo, base: git(["rev-parse", "HEAD"], repo).trim() };
}

const append = (file, text) =>
	writeFileSync(file, readFileSync(file, "utf8") + text);

/** A path as a literal, for the assertions that match a resolved directory. */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every flag vector the module can produce, over every combination that can
 * change one: each subset of the categories, each of the named-script
 * witnesses, and both values of the `release_bump` refinement. `flagsFor` uses
 * `paths` only for the named-script rules, so the witnesses ARE the paths.
 */
function flagVectors() {
	// Built with loops rather than a `reduce` whose accumulator is spread, which
	// allocates the whole running list on every step; the enumeration is the
	// proof's input, so its cost is worth keeping obviously small.
	let subsets = [[]];
	for (const category of CATEGORIES) {
		subsets = subsets.concat(subsets.map((subset) => [...subset, category]));
	}
	const vectors = [];
	for (const categories of subsets) {
		for (const paths of [
			[],
			["scripts/check-runtime-deps.mjs"],
			["scripts/require-report.sh"],
		]) {
			for (const releaseBump of [false, true]) {
				vectors.push(flagsFor(categories, paths, releaseBump));
			}
		}
	}
	return vectors;
}

const commitAll = (repo, message) => {
	git(["add", "-A"], repo);
	git(["commit", "-qm", message], repo);
};

const mv = (from, to, cwd) => git(["mv", from, to], cwd);

/**
 * The module's transitive relative-import closure, derived from the SOURCE
 * rather than listed here: a hardcoded list is exactly what rots when someone
 * adds an import, and the failure it causes is silent.
 */
function relativeImportClosure(entry) {
	const seen = new Set();
	const pending = [entry];
	while (pending.length) {
		const file = pending.pop();
		const source = readFileSync(join(repoRoot, file), "utf8");
		for (const match of source.matchAll(
			/^import\s[^;]*from\s+"(\.[^"]+)";?$/gm,
		)) {
			const sibling = resolve(join(repoRoot, file), "..", match[1]).slice(
				repoRoot.length + 1,
			);
			if (seen.has(sibling)) continue;
			seen.add(sibling);
			pending.push(sibling);
		}
	}
	return seen;
}

/** The module plus its closure, copied to a directory OUTSIDE the checkout. */
function copyModuleOutside(dir) {
	const copy = join(dir, "ci-scope.mjs");
	cpSync(join(repoRoot, MODULE), copy);
	for (const file of relativeImportClosure(MODULE)) {
		cpSync(join(repoRoot, file), join(dir, file.slice("scripts/".length)));
	}
	return copy;
}

/**
 * Drive the CLI the way the workflow does, with an environment that cannot
 * answer for it: an inherited `GITHUB_EVENT_NAME` would decide the run's shape,
 * and an inherited Actions channel variable would redirect its output.
 */
function runClassifier(args, cwd, module = join(repoRoot, MODULE)) {
	// Built rather than inherited-and-pruned, so nothing this suite's environment
	// carries can decide the run's shape: an inherited `GITHUB_EVENT_NAME` would
	// pick the event branch for the module, an inherited Actions channel variable
	// would redirect its output, and a `CMUX_*` variable would leak this suite's
	// host into a child that must not see it.
	const DROPPED = new Set([
		"GITHUB_EVENT_NAME",
		"GITHUB_OUTPUT",
		"GITHUB_STEP_SUMMARY",
	]);
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("CMUX_") || DROPPED.has(key)) continue;
		env[key] = value;
	}
	const result = spawnSync("node", [module, ...args], {
		cwd,
		env,
		encoding: "utf8",
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}
