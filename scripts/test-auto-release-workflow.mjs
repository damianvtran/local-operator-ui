#!/usr/bin/env node
/**
 * The automatic release's contract, asserted against the checked-in YAML.
 *
 * WHAT THIS GUARDS, in the order the failures cost most:
 *
 *  - the derivation is a script the unit suite drives (`derive-release.test.mjs`),
 *    not arithmetic inside a `run:` block nobody can test;
 *  - a push that is this workflow's own release commit does not release again,
 *    which is the loop that would spend a version per run;
 *  - a dry run cannot push the bump, in either direction — a dispatch defaults to
 *    one, and the release job must be unreachable from it;
 *  - the tag names the **bump commit**, because `validate-release.mjs` reads
 *    `package.json` at the tag and refuses a tag whose version disagrees with it;
 *    tagging `main`'s head instead is the exact mistake that publishes the
 *    previous release's code under the new number;
 *  - the publish workflow is handed the release explicitly, because a Release
 *    created with `GITHUB_TOKEN` starts no run by itself and a pipeline that
 *    relied on that would publish nothing while looking green.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");
const read = (name) =>
	load(
		readFileSync(
			new URL(`../.github/workflows/${name}`, import.meta.url),
			"utf8",
		),
	);

const autoRelease = read("auto-release.yml");
const publish = read("publish.yml");
const signedUpdate = read("signed-update-candidate.yml");
const steps = (workflow, job) => workflow.jobs[job].steps;
const runStep = (workflow, job, fragment) => {
	const found = steps(workflow, job).find((step) =>
		step.run?.includes(fragment),
	);
	assert.ok(found, `no step in ${job} runs ${fragment}`);
	return found.run;
};
/** Evaluate a job `if:` the way the runner does, over the contexts a job-level
 * condition may read. Status functions are deliberately unsupported: they can
 * bypass GitHub's skip gate, which is the property `test-publish-workflow.mjs`
 * also refuses to let in. */
function condition(expression, context) {
	if (!expression) return true;
	const code = expression
		.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
		.replace(/needs\.([\w-]+)\.outputs\.([\w-]+)/g, 'needs["$1"].outputs["$2"]')
		.replace(/needs\.([\w-]+)\.result/g, 'needs["$1"].result');
	return Boolean(
		Function(
			...Object.keys(context),
			`return (${code})`,
		)(...Object.values(context)),
	);
}

test("it releases on a push to main, and by hand it defaults to a dry run", () => {
	assert.deepEqual(autoRelease.on.push.branches, ["main"]);
	const dispatch = autoRelease.on.workflow_dispatch.inputs;
	assert.equal(dispatch.dry_run.type, "boolean");
	assert.equal(dispatch.dry_run.default, true);
	assert.equal(dispatch.bump.default, "auto");
	// One release at a time, and never cancelled in flight: a run killed between
	// the bump commit and the tag is a version nothing can reuse.
	assert.match(autoRelease.concurrency.group, /\S/);
	assert.equal(autoRelease.concurrency["cancel-in-progress"], false);
});

test("the version is derived by a script, not by arithmetic in the YAML", () => {
	const derive = runStep(
		autoRelease,
		"derive",
		"node scripts/derive-release.mjs",
	);
	// The workflow passes the commits to the script and applies what it prints: it
	// must not compute a version itself, which is what makes the derivation
	// untestable and is why it lives in the script.
	assert.match(derive, /--json/);
	assert.doesNotMatch(derive, /semver|major\s*\+|minor\s*\+|patch\s*\+/);
	// The escape hatch is passed through, never invented here.
	assert.match(derive, /--force-bump/);
});

test("this workflow's own release commit is not a release input", () => {
	// The bump commit carries `chore(release): bump version to X.Y.Z`. The push is
	// made with GITHUB_TOKEN, which starts no run by itself — this guard is what
	// stops a loop if the repository ever switches to an App or PAT credential.
	//
	// The GUARD is a script, and `release-push-guard.test.mjs` executes it over every
	// shape a bump lands in (a direct commit, a merge whose second parent is the
	// bump, a squash, a bump whose Release does not exist yet, and the commit that
	// reverts one) in real throwaway repositories. This test asserts only that the
	// YAML runs THAT script and that its answer is what the step acts on: a
	// structural test was all there was before, and it passed while the guard
	// answered the wrong question for every release this repository ever cut.
	const derive = runStep(
		autoRelease,
		"derive",
		"node scripts/release-push-guard.mjs",
	);
	assert.match(derive, /node scripts\/release-push-guard\.mjs --json/);
	assert.match(derive, /jq -r \.skip/);
});

/**
 * The derive step's `run:` block, executed as the runner executes it, in a
 * throwaway repository.
 *
 * WHY THE GUARD IS STUBBED HERE. Its own logic is exercised for real, against the
 * shipped script, in `release-push-guard.test.mjs`; what cannot be driven without
 * a forge is the anchor it resolves from the release list, and a test that read the
 * live API would fail the day another session cut a release. So this drives the
 * half that lives in the YAML — the answer `skip` short-circuits before anything is
 * derived, and a push with content reaches the derivation — with a stub guard whose
 * only property is the answer under test, and a stub derivation that records
 * whether it was called at all.
 */
function runDeriveStep({ skip }) {
	const dir = mkdtempSync(join(tmpdir(), "auto-release-step-"));
	mkdirSync(join(dir, "scripts"), { recursive: true });
	const derived = join(dir, "derivation-ran");
	writeFileSync(
		join(dir, "scripts", "release-push-guard.mjs"),
		`console.log(JSON.stringify({ skip: ${skip}, message: "stub guard: ${skip ? "nothing to release" : "content"}" }));\n`,
	);
	writeFileSync(
		join(dir, "scripts", "derive-release.mjs"),
		`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(derived)}, "ran");\nconsole.log(JSON.stringify({ release: true, version: "9.9.9", bump: "minor", windowBase: "v0.24.0", reason: "stubbed derivation", notes: "# stubbed", unclassified: [] }));\n`,
	);
	const output = join(dir, "github-output");
	const summary = join(dir, "github-summary");
	writeFileSync(output, "");
	writeFileSync(summary, "");
	let status = 0;
	let stderr = "";
	try {
		execFileSync("bash", ["-c", runStep(autoRelease, "derive", "set -euo pipefail")], {
			cwd: dir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				GITHUB_OUTPUT: output,
				GITHUB_STEP_SUMMARY: summary,
				FORCED_BUMP: "auto",
				GH_TOKEN: "stubbed",
			},
		});
	} catch (error) {
		status = error.status;
		stderr = error.stderr;
	}
	const result = {
		status,
		stderr,
		output: readFileSync(output, "utf8"),
		summary: readFileSync(summary, "utf8"),
		derivationRan: existsSync(derived),
	};
	rmSync(dir, { recursive: true, force: true });
	return result;
}

test("a push the guard calls empty never reaches the derivation", () => {
	const run = runDeriveStep({ skip: true });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.output, /^release=false$/m);
	assert.doesNotMatch(run.output, /^release=true$/m);
	assert.match(run.summary, /### No release/);
	assert.match(run.summary, /stub guard: nothing to release/);
	// The property that matters: nothing downstream ran, so no version can be
	// derived, committed or tagged from a push that has nothing to release.
	assert.equal(run.derivationRan, false);
});

test("a push with content reaches the derivation and its outputs", () => {
	const run = runDeriveStep({ skip: false });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.output, /^release=true$/m);
	assert.match(run.output, /^version=9\.9\.9$/m);
	assert.match(run.output, /^bump=minor$/m);
	assert.match(run.output, /^base=v0\.24\.0$/m);
	assert.match(run.summary, /### Derivation: minor -> v9\.9\.9/);
	assert.equal(run.derivationRan, true);
});

test("a dry run cannot reach the release job, and a push always can", () => {
	const guard = autoRelease.jobs.release.if;
	const reachable = (event, dryRun, release = "true") =>
		condition(guard, {
			needs: { derive: { outputs: { release } } },
			github: { event_name: event },
			inputs: dryRun === undefined ? {} : { dry_run: dryRun },
		});
	assert.equal(
		reachable("workflow_dispatch", true),
		false,
		"a dry run must not release",
	);
	assert.equal(
		reachable("workflow_dispatch", false),
		true,
		"an explicit run must release",
	);
	assert.equal(reachable("push", undefined), true, "a push must release");
	assert.equal(
		reachable("push", undefined, "false"),
		false,
		"nothing to release is not a release",
	);
});

test("the bump is one line, one file, committed and pushed without force", () => {
	const bump = runStep(
		autoRelease,
		"release",
		"node scripts/apply-release-bump.mjs",
	);
	// The script asserts the change is exactly the version line before the commit
	// exists, rather than asking a reviewer to notice afterwards.
	assert.match(bump, /--version "\$VERSION"/);
	assert.match(bump, /git add package\.json/);
	assert.match(
		bump,
		/git commit -m "chore\(release\): bump version to \$VERSION"/,
	);
	// A fast-forward or nothing: a non-fast-forward fails loudly, and no run of
	// this workflow may force anything.
	assert.match(bump, /git push origin HEAD:main/);
	assert.doesNotMatch(bump, /--force/);
});

test("the tag names the bump commit, never main's head", () => {
	const tag = runStep(autoRelease, "release", "gh release create");
	// `validate-release.mjs` reads `package.json` at the tag and requires it to
	// equal the tag's number, so the tag has to be on the commit that carries the
	// bump. Tagging `main`'s head would ship the previous version's code under the
	// new number, and every artifact would agree with every other about it.
	assert.match(tag, /sha="\$\(git rev-parse HEAD\)"/);
	assert.match(tag, /--target "\$sha"/);
	assert.doesNotMatch(tag, /rev-parse origin\/main|refs\/heads\/main/);
	// The pre-release hold is what keeps an asset-less Release out of the feed
	// every running app reads.
	assert.match(tag, /--prerelease/);
	assert.match(tag, /--notes-file release-notes\.md/);
});

test("the notes are re-derived against the tagged commit, and a moved repository fails loudly", () => {
	const rederive = runStep(
		autoRelease,
		"release",
		"node scripts/derive-release.mjs",
	);
	assert.match(rederive, /--base "\$BASE"/);
	// The window is re-read immediately before the tag, and the version must equal
	// the one the dry run printed: a repository that moved mid-run is a re-run, not
	// a release nothing derived.
	assert.match(rederive, /EXPECTED_VERSION/);
	assert.match(rederive, /::error title=Version changed::/);
});

test("the publish workflow is dispatched explicitly, because the Release event cannot be", () => {
	const dispatch = runStep(
		autoRelease,
		"release",
		"repos/$GITHUB_REPOSITORY/dispatches",
	);
	assert.match(dispatch, /event_type=release-published/);
	assert.match(dispatch, /client_payload\[release_tag\]=\$TAG/);
	assert.match(dispatch, /client_payload\[source_sha\]=\$SOURCE_SHA/);
	assert.match(dispatch, /client_payload\[release_id\]=\$release_id/);
	// The other half of that contract lives in publish.yml: the trigger that
	// receives it, and the pins it validates before building anything.
	assert.deepEqual(publish.on.repository_dispatch.types, ["release-published"]);
	const validate = steps(publish, "validate-release").find(
		(step) => step.id === "validate",
	);
	assert.match(validate.env.RELEASE_TAG, /client_payload\.release_tag/);
	assert.match(validate.env.EXPECTED_SOURCE_SHA, /client_payload\.source_sha/);
	assert.match(validate.env.EXPECTED_RELEASE_ID, /client_payload\.release_id/);
	// A manual repair still cannot promote, and still pins its own SHA.
	assert.equal(
		validate.env.IS_MANUAL_DISPATCH,
		"${{ github.event_name == 'workflow_dispatch' }}",
	);
});

test("the verification is started by the publish run, not by workflow_run", () => {
	// A run started from a `GITHUB_TOKEN` event is not documented to produce a
	// `workflow_run` event, and a verification that silently never fires reads as
	// success. The chain is therefore an explicit dispatch on both hops.
	const dispatch = runStep(
		publish,
		"dispatch-signed-verification",
		"dispatches",
	);
	assert.match(dispatch, /event_type=verify-signed-update/);
	assert.match(dispatch, /client_payload\[release_tag\]=\$RELEASE_TAG/);
	assert.deepEqual(publish.jobs["dispatch-signed-verification"].needs, [
		"validate-release",
		"attach-to-release",
	]);
	assert.deepEqual(signedUpdate.on.repository_dispatch.types, [
		"verify-signed-update",
	]);
	// Nothing may depend on the promotion, so a failed promotion stays terminal.
	assert.ok(
		!Object.values(publish.jobs).some((job) =>
			[job.needs ?? []].flat().includes("finalize-release"),
		),
	);
	assert.equal(Object.keys(publish.jobs).at(-1), "finalize-release");
});

test("the verification derives its own inputs and needs no approval", () => {
	const build = signedUpdate.jobs.build;
	// The pin that still protects the signing key: the tree that receives it must
	// be the commit this run resolved, proved against its own HEAD.
	const guard = steps(signedUpdate, "build").find((step) =>
		step.name?.startsWith("Refuse unpinned"),
	);
	assert.equal(guard.env.EXPECTED, "${{ needs.derive.outputs.source_sha }}");
	assert.match(guard.run, /git rev-parse HEAD/);
	// The candidate is read from the release, not from the payload.
	const derive = runStep(
		signedUpdate,
		"derive",
		"node scripts/release-candidate.mjs",
	);
	assert.match(derive, /--release-tag "\$RELEASE_TAG"/);
	// The environment stays attached, and what it holds is a branch policy on the
	// DISPATCH ref — not a gate on who may reach the key. The pin above is what
	// bounds this job on the automated path; on the manual path the candidate is a
	// free-form SHA, so write access to `main` is the boundary (AGENTS.md states it,
	// and the change that would narrow it is deferred there rather than implied).
	assert.equal(build.environment, "signed-update-candidate");
	assert.doesNotMatch(JSON.stringify(signedUpdate), /required reviewer/);
});
