#!/usr/bin/env node
/**
 * Every workflow that packages macOS builds ONE architecture per pass, keeps the
 * update feed whole, and gates the promotion on the artifact verification.
 *
 * WHY THIS FILE EXISTS. The v0.30.10 brick was fixed in `publish.yml` (one
 * `electron-vite build` cannot serve both architectures: `pnpm run build` emits
 * V8 bytecode against `node_modules/electron/dist`, whose arch follows the HOST,
 * so a single `electron-builder --mac --arm64 --x64` packed the arm64 runner's
 * bytecode into the x64 bundle and every launch died with
 * `cachedDataRejected`). The fix went into the workflow that was read at the
 * time - `publish.yml` - and `scripts/test-publish-workflow.mjs` grew the
 * per-architecture contract beside it.
 *
 * It did not cover the OTHER workflow that packages the same bundles.
 * `signed-update-candidate.yml` kept the one-pass shape, so its
 * `app-bytecode-loadable` check failed on the x64 candidate of every release
 * from the day the check landed - measured on v0.30.15, run 35833917102:
 * `3 of 101 artifact checks failed`, all three the same x64 `.jsc`, while the
 * released artifacts from `publish.yml` were fine. A verification that is
 * permanently red for a reason nobody ships reads exactly like a verification
 * that works, which is how a real FAIL gets ignored.
 *
 * So the contract is stated over the WHOLE workflow directory rather than over
 * the file that was under review, and it names the three properties a release
 * depends on, each of which has a measured failure behind it:
 *
 *  1. one architecture per packaging pass, with the Electron dist fetched for
 *     THAT architecture (`npm_config_arch`) in the same step - the dist is
 *     removed between passes because `ensure-electron.js`'s fast path keys on
 *     `dist/version`, so pass two would otherwise reuse pass one's runtime;
 *  2. a workflow with two macOS passes merges the update feed across them, or
 *     the second pass's `latest-mac.yml` describes only the second architecture
 *     and every user on the first is told there is no update;
 *  3. promoting a Release stays unreachable without the macOS artifact gate,
 *     and that gate is the one carrying the bytecode probe - the invariant
 *     AGENTS.md states as "the artifact gate is the safety net that makes a
 *     release from a tag defensible".
 *
 * WHAT THIS DOES NOT DO. It reads YAML and source text, so it cannot prove a
 * build produces the right bytes - only that no workflow is shaped to produce
 * the wrong ones. The rendering under test is `run:` steps; a build reached
 * through a `uses:` composite action or a script the step does not name is
 * invisible here, the same boundary `scripts/check-build-env.mjs` documents. And
 * `mac.target` is deliberately not asserted per workflow: the candidate build
 * runs on a commit the dispatch names rather than on `main`, so its config is
 * whatever that tree says - which is exactly why the ARCH FLAG, and not the
 * config, is what this file requires each pass to pin.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");

/** The workflows, keyed by file name, parsed rather than grepped. */
const WORKFLOWS = new Map(
	readdirSync(new URL("../.github/workflows/", import.meta.url))
		.filter((name) => name.endsWith(".yml"))
		.sort()
		.map((name) => [
			name,
			load(
				readFileSync(
					new URL(`../.github/workflows/${name}`, import.meta.url),
					"utf8",
				),
			),
		]),
);

/** Every `run:` step in a workflow, with the job and step it belongs to. */
function runSteps(name) {
	const steps = [];
	for (const [job, definition] of Object.entries(
		WORKFLOWS.get(name).jobs ?? {},
	)) {
		for (const step of definition.steps ?? []) {
			if (typeof step.run === "string") {
				// The index is carried rather than recovered later: the filters
				// below return NEW objects, so an identity search over this list
				// finds nothing and an ordering assertion built on it would fail
				// on a compliant workflow.
				steps.push({
					job,
					step,
					index: steps.length,
					name: step.name ?? step.run.split("\n")[0],
				});
			}
		}
	}
	return steps;
}

// The regexes, hoisted and named: each one is a claim about the tree, and a
// reader should be able to see all of them at once (biome's
// `useTopLevelRegex` is why they are not inside the functions that use them).
/** A whole-line shell comment, which the shell does not execute. */
const COMMENT_LINE = /^\s*#/;
/** An invocation that PACKAGES, as opposed to prose about packaging. */
const PACK_INVOCATION = /electron-builder\b|dist:mac\b/;
/** An invocation aimed at macOS, by platform flag or by architecture flag. */
const PACK_TARGET = /--mac\b|--(arm64|x64)\b/;
/** The architectures a pass pins. `g`-flagged, so it is only ever consumed by `matchAll`. */
const ARCH_FLAG = /--(arm64|x64)\b/g;
/** The Electron dist a pass fetches; `g`-flagged for `matchAll`. */
const FETCHED_ARCH = /npm_config_arch=([A-Za-z0-9_]+)/g;
const VERIFY_ARTIFACTS = /verify-macos-artifacts/;
const REQUIRE_REPORT = /require-report\.sh/;
const BYTECODE_CHECK_ID = /id: "app-bytecode-loadable"/;
const FEED_SAVE = /merge-update-feed\.mjs[^\n]*--save/;
const FEED_MERGE = /merge-update-feed\.mjs[^\n]*--merge/;

/**
 * The COMMANDS in a `run:` script, with whole-line shell comments dropped the way
 * the shell drops them.
 *
 * A step's prose is not its behaviour, and here the difference decides a verdict:
 * `publish.yml` discusses electron-builder and both architecture flags in comments
 * inside `run:` blocks it does not build in, and the macOS steps beside this file
 * explain the flag they pin by NAMING it. Reading the raw text would count those
 * mentions as flags and fail a compliant pass, which is how a gate gets deleted
 * rather than fixed - the argument `scripts/check-build-env.mjs` makes for
 * tokenizing instead of substringing.
 *
 * Only whole-line comments are dropped: a trailing `# ...` beside a command is
 * left in place, so a step that annotates its command can only ever be read as
 * MORE flags than it passes, never fewer - the direction that fails loudly rather
 * than silently passing a one-pass build.
 */
const commandsOf = (run) =>
	run
		.split("\n")
		.filter((line) => !COMMENT_LINE.test(line))
		.join("\n");

/**
 * The steps that PACKAGE a macOS app, i.e. the ones an architecture mistake can
 * brick. A step that only mentions electron-builder in prose is not one: the
 * command has to be in it, which is why the match is on the invocation rather
 * than on the word.
 */
const packSteps = (name) =>
	runSteps(name).filter(({ step }) => {
		const commands = commandsOf(step.run);
		return PACK_INVOCATION.test(commands) && PACK_TARGET.test(commands);
	});

/** The steps of a workflow that run `merge-update-feed.mjs` in the given mode. */
const feedSteps = (name, pattern) =>
	runSteps(name).filter(({ step }) => pattern.test(commandsOf(step.run)));

// The steps are read in order, so the feed snapshot can be asserted to sit
// BETWEEN the passes: a snapshot taken before the first pass has no feed to
// save, and one taken after the last pass is the file that already lists both.
const WORKFLOWS_THAT_PACK = [...WORKFLOWS.keys()].filter(
	(name) => packSteps(name).length > 0,
);

test("the two shipping workflows are the ones that package macOS, so this file is not vacuous", () => {
	// A rename or a restructure that took both out of scope would leave every
	// assertion below iterating an empty list and reporting success.
	assert.deepEqual(WORKFLOWS_THAT_PACK, [
		"publish.yml",
		"signed-update-candidate.yml",
	]);
});
for (const workflow of WORKFLOWS_THAT_PACK) {
	const steps = packSteps(workflow);

	test(`${workflow}: no macOS pass packages both architectures at once`, () => {
		// The defect this file exists for, stated as one assertion: the two arch
		// flags must never appear in the same pass. One pass, one architecture.
		for (const { job, step, name } of steps) {
			const commands = commandsOf(step.run);
			const flags = [...commands.matchAll(ARCH_FLAG)].map((m) => m[1]);
			assert.equal(
				flags.length,
				1,
				`${workflow}:${job}:${name} pins ${flags.length} architectures (${flags.join(", ") || "none, i.e. the host's and whatever a config-level arch pins"}). One \`pnpm run build\` emits bytecode for ONE V8, so both bundles from one pass means one of them carries the other's bytecode and dies at launch with cachedDataRejected (v0.30.10, and the x64 candidate of every release after it). Split the pass per architecture; see the macOS steps in .github/workflows/publish.yml.`,
			);
			// The fetch that decides which V8 the bytecode is compiled against. It
			// has to be in the step, and it has to agree with the flag: a pass that
			// asks for `--x64` while `npm_config_arch` says arm64 is the same brick
			// with the sign flipped.
			const fetched = [...commands.matchAll(FETCHED_ARCH)].map((m) => m[1]);
			const expected = { arm64: "arm64", x64: "x64" }[flags[0]];
			assert.ok(
				fetched.length > 0,
				`${workflow}:${job}:${name} packages ${flags[0]} without fetching an Electron dist for it. electron-vite's bytecode step runs the binary in node_modules/electron/dist, and that dist follows the HOST unless npm_config_arch is set - so the pass would compile the runner's bytecode for this architecture.`,
			);
			assert.deepEqual(
				[...new Set(fetched)],
				[expected],
				`${workflow}:${job}:${name} fetches ${fetched.join(", ")} while packaging ${flags[0]}: the bytecode would be compiled against the wrong runtime.`,
			);
		}
	});

	if (steps.length > 1) {
		test(`${workflow}: a workflow with several macOS passes merges the update feed across them`, () => {
			// `latest-mac.yml` is ONE file describing BOTH architectures, and
			// electron-builder rewrites it from scratch at the end of every pass.
			// Splitting the build without this pair trades the launch brick for a
			// silently dead update channel on whichever architecture built first.
			const runs = runSteps(workflow);
			const indexOf = (pattern) =>
				runs.findIndex(({ step }) => pattern.test(commandsOf(step.run)));
			const save = indexOf(FEED_SAVE);
			const merge = indexOf(FEED_MERGE);
			const ordered = packSteps(workflow).map((pack) => pack.index);
			assert.notEqual(
				save,
				-1,
				`${workflow} builds ${steps.length} macOS passes but never snapshots the first pass's update feed (node scripts/merge-update-feed.mjs --save).`,
			);
			assert.notEqual(
				merge,
				-1,
				`${workflow} builds ${steps.length} macOS passes but never merges the update feeds, so the shipped latest-mac.yml lists only the last architecture built.`,
			);
			assert.ok(
				save < merge,
				`${workflow}: the update feed is merged before it is saved, so the merge carries nothing.`,
			);
			// The snapshot has to fall BETWEEN the passes: taken before the first one
			// there is no feed to save, and taken after the last one it is the file
			// that already lists both, which merging changes nothing in.
			assert.ok(
				save > ordered[0] && save < ordered.at(-1),
				`${workflow}: the update feed snapshot (step ${save}) does not sit between the first (${ordered[0]}) and last (${ordered.at(-1)}) macOS pass.`,
			);
			assert.ok(
				merge > ordered.at(-1),
				`${workflow}: the update feed is merged before the last macOS pass rewrites it, so the merge is overwritten.`,
			);
		});
	}
}

test("signed-update-candidate.yml verifies the candidate with the same artifact gate a release runs", () => {
	// The audit exists to check the bytes a release ships. A verification that
	// runs a different set of checks than the release does - or none - cannot
	// say anything about it, which is the gap this file was written after.
	const runs = runSteps("signed-update-candidate.yml");
	const verification = runs.find(({ step }) => VERIFY_ARTIFACTS.test(step.run));
	assert.ok(
		verification,
		"signed-update-candidate.yml never runs verify-macos-artifacts, so its verdict is not about the artifacts a release ships.",
	);
	assert.match(
		verification.step.run,
		REQUIRE_REPORT,
		"the candidate's artifact verification must run through scripts/require-report.sh: this step reads an exit status, and a gate reached through an unresolvable path exits 0 having printed nothing, which is a PASS.",
	);
});

test("promoting a Release is unreachable without the macOS artifact gate", () => {
	const { jobs } = WORKFLOWS.get("publish.yml");
	const needs = (job) => [].concat(jobs[job].needs ?? []);
	// Transitive, because the gate is reached through attach-to-release: a job
	// whose closure drops build-macos promotes artifacts nothing verified.
	const closure = new Set();
	const walk = (job) => {
		for (const dependency of needs(job)) {
			if (closure.has(dependency)) continue;
			closure.add(dependency);
			walk(dependency);
		}
	};
	walk("finalize-release");
	assert.ok(
		closure.has("build-macos"),
		"finalize-release no longer depends on build-macos, so the Release can be promoted to latest without the macOS artifact gate ever running.",
	);
	const gate = runSteps("publish.yml").find(
		({ job, step }) => job === "build-macos" && VERIFY_ARTIFACTS.test(step.run),
	);
	assert.ok(
		gate,
		"the job finalize-release depends on no longer runs verify-macos-artifacts.",
	);
	assert.equal(
		feedSteps("publish.yml", FEED_MERGE).length,
		1,
		"publish.yml's merged update feed moved or disappeared; the macOS feed it publishes is the one both architectures are offered from.",
	);
	// And the check that failed on the candidate of every release is inside that
	// gate: asserted against the gate's own source, so removing the check is a
	// red test here rather than a silent loss of the only probe that asks a
	// bundle's own Electron to load the bytecode it ships.
	const gateSource = readFileSync(
		new URL("../scripts/verify-macos-artifacts.mjs", import.meta.url),
		"utf8",
	);
	assert.match(
		gateSource,
		BYTECODE_CHECK_ID,
		"verify-macos-artifacts no longer carries the app-bytecode-loadable probe, which is the only check that loads the bytecode a bundle ships.",
	);
});
