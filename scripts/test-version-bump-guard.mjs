#!/usr/bin/env node
/**
 * Tests for the version-bump guard: the decision matrix, and the real CLI run
 * against synthetic git repositories.
 *
 * Two layers on purpose. The matrix runs in-process against
 * `decideVersionBump`, so every branch of the verdict is pinned without git or
 * network. The CLI layer then drives the actual script the workflow invokes, in
 * throwaway repositories whose `origin` is a local bare repo — so the merge
 * shape CI checks out (`HEAD^1` base, `HEAD^2` PR side), the real
 * `git diff HEAD^1 HEAD`, and the real `git ls-remote` tag read are all
 * exercised rather than described. A guard whose only test is the pure function
 * has never proved it can read a repository.
 *
 * No network: the bare origin is a directory.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import { fileURLToPath } from "node:url";
import {
	compareVersions,
	decideVersionBump,
	listReleaseTags,
	newVersionFrom,
	versionLineChanges,
} from "./version-bump-guard.mjs";

const GUARD = fileURLToPath(
	new URL("./version-bump-guard.mjs", import.meta.url),
);

/** A `git diff` of a JSON version edit: the removed line, then the added one. */
function versionDiff(from, to) {
	return [
		"diff --git a/package.json b/package.json",
		"--- a/package.json",
		"+++ b/package.json",
		"@@ -1,5 +1,5 @@",
		'   "name": "local-operator-ui",',
		`-  "version": "${from}",`,
		`+  "version": "${to}",`,
		'   "productName": "Local Operator",',
		"",
	].join("\n");
}

/** A `package.json` diff that touches no version line: the passing direction. */
const DEPENDENCY_DIFF = [
	"diff --git a/package.json b/package.json",
	"--- a/package.json",
	"+++ b/package.json",
	"@@ -20,6 +20,7 @@",
	'     "electron-updater": "^6.6.2",',
	'+    "picomatch": "^4.0.2",',
	"   },",
	"",
].join("\n");

// ---------------------------------------------------------------------------
// The diff reader
// ---------------------------------------------------------------------------

test("versionLineChanges reads the JSON version line and ignores other edits", () => {
	assert.deepEqual(versionLineChanges(versionDiff("0.19.5", "0.19.6")), [
		'-  "version": "0.19.5",',
		'+  "version": "0.19.6",',
	]);
	// A `package.json` edit with no version line is the case the guard must pass,
	// so it must not be read as a change by this function either.
	assert.deepEqual(versionLineChanges(DEPENDENCY_DIFF), []);
});

test("versionLineChanges survives an empty diff", () => {
	assert.deepEqual(versionLineChanges(""), []);
});

test("newVersionFrom takes the added side only", () => {
	assert.equal(
		newVersionFrom(versionLineChanges(versionDiff("0.19.5", "0.19.6"))),
		"0.19.6",
	);
	// A removal with no addition is unreadable, and must not be reported as the
	// removed value — that would validate a version the PR does not set.
	assert.equal(newVersionFrom(['-  "version": "0.19.5",']), null);
});

// ---------------------------------------------------------------------------
// compareVersions: what "sorts above" has to mean
// ---------------------------------------------------------------------------

test("compareVersions is numeric, not lexicographic", () => {
	// The trap a string compare walks into: "0.19.10" < "0.19.5" character by
	// character, so a version BELOW the newest tag would read as above it.
	assert.equal(compareVersions("0.19.10", "0.19.5"), 1);
	assert.equal(compareVersions("0.19.5", "0.19.10"), -1);
	assert.equal(compareVersions("0.19.5", "0.19.5"), 0);
	assert.equal(compareVersions("0.20.0", "0.19.99"), 1);
});

test("compareVersions follows semver precedence for prereleases", () => {
	// An rc must be promotable to its own release. GNU `sort -V` orders
	// `1.0.0-rc.1` ABOVE `1.0.0`, which would call that promotion a rewind.
	assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
	assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
	assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.1"), 1);
	assert.equal(compareVersions("1.0.0-rc.10", "1.0.0-rc.9"), 1);
	assert.equal(compareVersions("1.0.0-beta", "1.0.0-alpha"), 1);
	assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
});

test("compareVersions reports unreadable input rather than guessing", () => {
	assert.equal(compareVersions("v0.19.5", "0.19.5"), null);
	assert.equal(compareVersions("0.19", "0.19.5"), null);
	// Leading zeros: `git tag v01.2.3` is permitted by git and rejected by
	// validate-release's TAG_RE, so a loose `\d+` here would let one junk tag
	// read as version 1.2.3 and become "the highest tag".
	assert.equal(compareVersions("01.2.3", "0.19.5"), null);
	assert.equal(compareVersions("1.0.0-alpha..1", "1.0.0"), null);
});

// ---------------------------------------------------------------------------
// The verdict matrix
// ---------------------------------------------------------------------------

test("a feature PR that bumps the version fails", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "feat: remember the last window size",
		diff: versionDiff("0.19.5", "0.19.6"),
		tags: ["0.19.5"],
	});
	assert.equal(ok, false);
	assert.match(
		lines.join("\n"),
		/A feature PR must not change the project version/,
	);
	assert.match(
		lines.join("\n"),
		/package\.json stays at the last released version/,
	);
});

test("a release PR bumping above the newest tag passes", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.20.0",
		diff: versionDiff("0.19.5", "0.20.0"),
		tags: ["0.19.1", "0.19.10", "0.19.5"],
	});
	assert.equal(ok, true);
	assert.match(
		lines.join("\n"),
		/sorts above the highest release tag v0\.19\.10/,
	);
});

test("a release-titled PR with no version change fails", () => {
	// The mirror image, and the more dangerous one: it ships the previous
	// release's code under a new number, and every signal looks green.
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.19.6",
		diff: DEPENDENCY_DIFF,
		tags: ["0.19.5"],
	});
	assert.equal(ok, false);
	assert.match(
		lines.join("\n"),
		/A release PR must actually change the version/,
	);
	assert.match(lines.join("\n"), /detached HEAD/);
});

test("the window's claim PR carries no version change and still passes", () => {
	// `chore(release): claim release window` is a legitimate long-lived PR with
	// an empty commit. Only the *bump* title means "this PR is the release", so
	// the mirror-image rule must not fire on the claim.
	const { ok } = decideVersionBump({
		prTitle: "chore(release): claim release window",
		diff: "",
		tags: ["0.19.5"],
	});
	assert.equal(ok, true);
});

test("a package.json edit with no version line passes", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(deps): add picomatch",
		diff: DEPENDENCY_DIFF,
		tags: ["0.19.5"],
	});
	assert.equal(ok, true);
	assert.match(lines.join("\n"), /No version change in package\.json/);
});

test("a PR that touches package.json not at all passes", () => {
	const { ok } = decideVersionBump({
		prTitle: "fix: correct the empty-state copy",
		diff: "",
		tags: ["0.19.5"],
	});
	assert.equal(ok, true);
});

test("a release PR reusing the highest tag fails", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.19.5",
		diff: versionDiff("0.19.4", "0.19.5"),
		tags: ["0.19.5"],
	});
	assert.equal(ok, false);
	assert.match(
		lines.join("\n"),
		/does not sort above the highest release tag 'v0\.19\.5'/,
	);
});

test("a release PR rewinding below the highest tag fails", () => {
	// The 0.19.10-style trap: only a numeric compare catches this.
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.19.6",
		diff: versionDiff("0.19.5", "0.19.6"),
		tags: ["0.19.10"],
	});
	assert.equal(ok, false);
	assert.match(lines.join("\n"), /highest release tag 'v0\.19\.10'/);
});

test("a release PR whose version line cannot be read fails", () => {
	const unreadable = [
		"diff --git a/package.json b/package.json",
		"@@ -1,3 +1,3 @@",
		'-  "version": "0.19.5",',
		'+  "version": 0.19.6,',
		"",
	].join("\n");
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.19.6",
		diff: unreadable,
		tags: ["0.19.5"],
	});
	assert.equal(ok, false);
	assert.match(lines.join("\n"), /Could not parse the new version/);
});

test("a release PR that deletes the version line fails", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.19.6",
		diff: '-  "version": "0.19.5",\n',
		tags: ["0.19.5"],
	});
	assert.equal(ok, false);
	assert.match(lines.join("\n"), /Could not parse the new version/);
});

test("with no remote tags the ordering check is skipped, not failed", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.1.0",
		diff: versionDiff("0.0.1", "0.1.0"),
		tags: [],
	});
	assert.equal(ok, true);
	assert.match(lines.join("\n"), /No release tags found on the remote/);
});

test("non-version tags on the remote are ignored, not treated as the highest", () => {
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.20.0",
		diff: versionDiff("0.19.5", "0.20.0"),
		tags: ["nightly", "latest", "0.19.5"],
	});
	assert.equal(ok, true);
	assert.match(lines.join("\n"), /above the highest release tag v0\.19\.5/);
});

test("a leading-zero tag is ignored, not treated as the highest tag", () => {
	// `v01.2.3` sorts above `v0.19.5` under the loose form and would fail every
	// subsequent release PR until it was deleted; it is not a tag this repo can
	// publish from, so it must be skipped the way `nightly` is.
	const { ok, lines } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.19.6",
		diff: versionDiff("0.19.5", "0.19.6"),
		tags: ["01.2.3", "0.19.5"],
	});
	assert.equal(ok, true);
	assert.match(lines.join("\n"), /above the highest release tag v0\.19\.5/);
	assert.doesNotMatch(lines.join("\n"), /01\.2\.3/);
});

test("a release PR may promote a prerelease to its own release", () => {
	const { ok } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.20.0",
		diff: versionDiff("0.20.0-rc.1", "0.20.0"),
		tags: ["0.20.0-rc.1"],
	});
	assert.equal(ok, true);
});

test("a release PR below an existing prerelease of the same version fails", () => {
	const { ok } = decideVersionBump({
		prTitle: "chore(release): bump version to 0.20.0-rc.1",
		diff: versionDiff("0.19.5", "0.20.0-rc.1"),
		tags: ["0.20.0"],
	});
	assert.equal(ok, false);
});

// ---------------------------------------------------------------------------
// The real CLI, against real repositories
// ---------------------------------------------------------------------------

const GIT_ENV = {
	...process.env,
	// The operator's own git config must not decide what these repositories look
	// like: a global hooksPath, signing key or init.defaultBranch would change
	// the shape the guard reads.
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Version Bump Guard Test",
	GIT_AUTHOR_EMAIL: "guard@example.invalid",
	GIT_COMMITTER_NAME: "Version Bump Guard Test",
	GIT_COMMITTER_EMAIL: "guard@example.invalid",
	GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
	GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function git(cwd, args, { allow = false } = {}) {
	const res = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
	if (!allow && res.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${res.stderr}`);
	}
	return res;
}

function writePackageJson(dir, version) {
	writeFileSync(
		join(dir, "package.json"),
		`${JSON.stringify({ name: "local-operator-ui", version, productName: "Local Operator" }, null, 2)}\n`,
	);
}

/**
 * A throwaway clone whose `origin` is a local bare repo, plus the merge commit
 * shape CI checks out: a commit on `main`, a commit on a branch carrying
 * `change`, and `--no-ff` merge so `HEAD^1` is the base side and `HEAD^2` the PR
 * side. `diff HEAD^1 HEAD` is then exactly "what this PR introduces".
 */
function fixtureRepo({
	base = "0.19.5",
	tag = `v${base}`,
	change = () => {},
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "version-bump-guard-"));
	const remote = join(root, "origin.git");
	const work = join(root, "work");
	mkdirSync(remote);
	mkdirSync(work);
	git(root, ["init", "--bare", "--initial-branch=main", remote]);
	git(work, ["init", "--initial-branch=main"]);
	git(work, ["remote", "add", "origin", remote]);
	writePackageJson(work, base);
	writeFileSync(join(work, "README.md"), "fixture\n");
	git(work, ["add", "-A"]);
	git(work, ["commit", "-m", "chore: fixture base"]);
	if (tag) git(work, ["tag", tag]);
	git(work, ["push", "-u", "origin", "main", "--tags"]);

	git(work, ["checkout", "-b", "feature"]);
	change(work);
	git(work, ["add", "-A"]);
	git(work, ["commit", "-m", "feat: fixture change"]);
	git(work, ["checkout", "main"]);
	git(work, [
		"merge",
		"--no-ff",
		"feature",
		"-m",
		"Merge pull request #1 from feature",
	]);
	return {
		root,
		work,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

/** Run the real guard CLI in `cwd`, exactly as the workflow does. */
function spawnGuard(cwd, env) {
	const res = spawnSync(process.execPath, [GUARD], {
		cwd,
		encoding: "utf8",
		env,
	});
	return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function runGuard(cwd, title, { env = {} } = {}) {
	const childEnv = { ...GIT_ENV, ...env };
	// An explicitly `undefined` title means "as if the variable were never set".
	// That key is OMITTED rather than assigned undefined or removed afterwards:
	// GIT_ENV carries this process's own environment, so a PR_TITLE left over in
	// the caller's shell would make the unset-title test pass for the wrong
	// reason.
	if (title === undefined) {
		const withoutTitle = {};
		for (const [key, value] of Object.entries(childEnv)) {
			if (key !== "PR_TITLE") withoutTitle[key] = value;
		}
		return spawnGuard(cwd, withoutTitle);
	}
	return spawnGuard(cwd, { ...childEnv, PR_TITLE: title });
}

test("CLI: a feature branch that bumps the version exits non-zero", () => {
	const fx = fixtureRepo({
		change: (dir) => writePackageJson(dir, "0.19.6"),
	});
	try {
		const { status, out } = runGuard(fx.work, "feat: add the thing");
		assert.equal(status, 1);
		assert.match(out, /A feature PR must not change the project version/);
		assert.match(out, /\+ {2}"version": "0\.19\.6",/);
	} finally {
		fx.cleanup();
	}
});

test("CLI: a release bump above the newest tag exits zero", () => {
	const fx = fixtureRepo({
		base: "0.19.5",
		change: (dir) => writePackageJson(dir, "0.19.6"),
	});
	try {
		const { status, out } = runGuard(
			fx.work,
			"chore(release): bump version to 0.19.6",
		);
		assert.equal(status, 0);
		assert.match(out, /Release PR, version change allowed/);
		assert.match(out, /sorts above the highest release tag v0\.19\.5/);
	} finally {
		fx.cleanup();
	}
});

test("CLI: a release title with no version change exits non-zero", () => {
	const fx = fixtureRepo({
		change: (dir) => writeFileSync(join(dir, "README.md"), "fixture, edited\n"),
	});
	try {
		const { status, out } = runGuard(
			fx.work,
			"chore(release): bump version to 0.19.6",
		);
		assert.equal(status, 1);
		assert.match(out, /A release PR must actually change the version/);
	} finally {
		fx.cleanup();
	}
});

test("CLI: a package.json edit without the version line exits zero", () => {
	const fx = fixtureRepo({
		change: (dir) => {
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			pkg.dependencies = { picomatch: "^4.0.2" };
			writeFileSync(
				join(dir, "package.json"),
				`${JSON.stringify(pkg, null, 2)}\n`,
			);
		},
	});
	try {
		const { status, out } = runGuard(fx.work, "chore(deps): add picomatch");
		assert.equal(status, 0);
		assert.match(out, /No version change in package\.json/);
	} finally {
		fx.cleanup();
	}
});

test("CLI: a release bump that rewinds below the newest tag exits non-zero", () => {
	const fx = fixtureRepo({
		base: "0.19.5",
		change: (dir) => writePackageJson(dir, "0.19.6"),
		tag: "v0.19.10",
	});
	try {
		const { status, out } = runGuard(
			fx.work,
			"chore(release): bump version to 0.19.6",
		);
		assert.equal(status, 1);
		assert.match(out, /highest release tag 'v0\.19\.10'/);
	} finally {
		fx.cleanup();
	}
});

test("CLI: an unreadable diff fails the guard instead of reading as no change", () => {
	// The fail-open guard. A single-commit repository has no `HEAD^1`, which is
	// the same failure a shallow checkout or a wrong ref produces. The verdict
	// must be "I could not read it", never "nothing changed" — the latter lets a
	// real bump through unexamined.
	const root = mkdtempSync(join(tmpdir(), "version-bump-guard-norev-"));
	try {
		git(root, ["init", "--initial-branch=main"]);
		writePackageJson(root, "0.19.5");
		git(root, ["add", "-A"]);
		git(root, ["commit", "-m", "chore: fixture base"]);
		const { status, out } = runGuard(root, "chore(deps): add picomatch");
		assert.equal(status, 1);
		assert.match(out, /Could not read the package\.json diff/);
		assert.doesNotMatch(out, /No version change in package\.json/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI: an unreadable tag list fails the guard instead of reading as no tags", () => {
	// The twin of the unreadable-diff test above, and the same fail-open
	// direction: an empty tag list is the "skipping the ordering check" verdict,
	// so `ls-remote` failing must throw rather than read as "no release tags".
	const fx = fixtureRepo({
		base: "0.19.5",
		change: (dir) => writePackageJson(dir, "0.19.6"),
	});
	try {
		// No `origin` at all is the shape of a checkout whose remote is gone.
		git(fx.work, ["remote", "remove", "origin"]);
		const { status, out } = runGuard(
			fx.work,
			"chore(release): bump version to 0.19.6",
		);
		assert.equal(status, 1);
		assert.match(out, /Could not read the release tags\./);
		assert.doesNotMatch(out, /No release tags found on the remote/);
		assert.doesNotMatch(out, /sorts above the highest release tag/);
	} finally {
		fx.cleanup();
	}
});

test("listReleaseTags throws rather than reporting no tags when the remote is gone", () => {
	// The unit-level pin on the same branch: the function must not swallow the
	// `ls-remote` failure and hand `decideVersionBump` an empty list.
	const root = mkdtempSync(join(tmpdir(), "version-bump-guard-notags-"));
	try {
		git(root, ["init", "--initial-branch=main"]);
		writePackageJson(root, "0.19.5");
		git(root, ["add", "-A"]);
		git(root, ["commit", "-m", "chore: fixture base"]);
		assert.throws(
			() => listReleaseTags({ cwd: root, remote: "origin" }),
			/Could not read the release tags\./,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI: an unset PR title is refused rather than guessed", () => {
	const fx = fixtureRepo({ change: (dir) => writePackageJson(dir, "0.19.6") });
	try {
		// No PR_TITLE at all. Defaulting to "" would make every `startsWith`
		// false, turning a release PR into a rejected feature PR.
		const { status, out } = runGuard(fx.work, undefined);
		assert.equal(status, 1);
		assert.match(out, /PR_TITLE is not set/);
	} finally {
		fx.cleanup();
	}
});

// ---------------------------------------------------------------------------
// The workflow step that runs the guard
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
// Resolved through electron-builder's own tree, which is where the only `js-yaml`
// this install can see lives (pnpm's layout exposes a package's dependencies to it
// alone), exactly as `test-publish-workflow.mjs` resolves it.
const builderRequire = createRequire(
	require.resolve("electron-builder/package.json"),
);
const { load } = createRequire(builderRequire.resolve("app-builder-lib"))(
	"js-yaml",
);
const workflow = load(
	readFileSync(
		new URL("../.github/workflows/version-bump-guard.yml", import.meta.url),
		"utf8",
	),
);
const guardStep = workflow.jobs["version-bump-guard"].steps.find((step) =>
	step.name?.includes("Reject a version bump"),
);

/**
 * The guard step's `run:` block, executed as the runner executes it, over a stub
 * `scripts/version-bump-guard.mjs`.
 *
 * WHY THE STUB. The guard's own decisions are driven for real above; what is under
 * test here is the step, and the one thing the step must never do is pass a run in
 * which the guard said NOTHING. That shape used to be ordinary: the guard resolved
 * its entry point lexically, so an invocation through a symlinked directory loaded
 * the file, printed nothing and exited 0 — this job went green having checked no
 * diff at all. `scripts/entry-point.mjs` removes that cause; the step's check
 * removes the class.
 *
 * WHY THE SHELL IS `bash -e`. The runner's default for a `run:` step with no
 * `defaults.run.shell` anywhere in `.github/workflows/` is `bash -e {0}`, and that
 * `-e` is load-bearing for this step: the first version of it captured the verdict
 * with a bare `verdict="$(node ...)"`, which under `-e` aborts AT the substitution,
 * so a refused PR went red with the refusal's reason missing from the log. Driving
 * the block with `bash -c` (no `-e`), as this harness did in review round 1 of
 * #210, asserted something the runner cannot produce — the suite was green and the
 * annotation was gone. The shell here is therefore the runner's, and
 * `the step still prints the guard's refusal under the runner's shell` below is the
 * case that fails when the step goes back to a bare substitution.
 */
function runGuardStep({ guardScript }) {
	const dir = mkdtempSync(join(tmpdir(), "version-bump-guard-step-"));
	mkdirSync(join(dir, "scripts"), { recursive: true });
	writeFileSync(
		join(dir, "scripts", "version-bump-guard.mjs"),
		guardScript ?? `console.log("No version change in package.json.");\n`,
	);
	let status = 0;
	let stdout = "";
	try {
		stdout = execFileSync("bash", ["-e", "-c", guardStep.run], {
			cwd: dir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PR_TITLE: "feat: a feature PR" },
		});
	} catch (error) {
		status = error.status;
		// A step's `::error` line is echoed to STDOUT, which is where the runner
		// reads it from.
		stdout = error.stdout ?? "";
	}
	rmSync(dir, { recursive: true, force: true });
	return { status, stdout };
}

test("the workflow refuses a run in which the guard printed no verdict", () => {
	// An EMPTY module: valid JavaScript, exit 0, no output — the signature the
	// symlinked invocation produced. A stub that crashed would fail the step for the
	// wrong reason and would prove nothing about this refusal.
	const run = runGuardStep({ guardScript: "" });
	assert.equal(run.status, 1);
	assert.match(run.stdout, /::error title=Version bump guard produced no verdict::/);
});

test("the workflow passes a verdict through, and keeps the guard's own exit status", () => {
	const passing = runGuardStep({});
	assert.equal(passing.status, 0);
	assert.match(passing.stdout, /No version change in package\.json\./);

	// The guard's refusals are on stdout with a non-zero status, and both have to
	// survive the step: a step that swallowed the status would pass every PR.
	//
	// THIS IS THE CASE THE ROUND-1 HARNESS COULD NOT SEE. Driving the block with
	// `bash -c` (no `-e`) let a bare `verdict="$(node ...)"` look fine, while under
	// the runner's `bash -e {0}` that substitution aborts the step and this
	// assertion's output - the refusal's reason, which is the product of this job -
	// never reaches the log. `runGuardStep` now drives the block with `-e`, so a
	// step that goes back to the bare form fails here rather than on the next
	// refused PR.
	const refusing = runGuardStep({
		guardScript: `console.log("::error file=package.json::A feature PR must not change the project version.");\nprocess.exit(1);\n`,
	});
	assert.equal(refusing.status, 1);
	assert.match(refusing.stdout, /must not change the project version/);
});

test("a guard that dies with a non-zero status is passed through, not re-read as a silence", () => {
	// The status has to survive whatever it is: a guard that crashes (exit 2)
	// must not be reported as the empty-verdict case, and must not be turned into
	// a pass by the step's own bookkeeping. It prints nothing, which on the
	// success path is the refusal - on a failure path the status already fails the
	// job, and the step adds no second verdict of its own.
	const run = runGuardStep({
		guardScript: `process.exit(2);\n`,
	});
	assert.equal(run.status, 2);
	assert.doesNotMatch(run.stdout, /produced no verdict/);
});
