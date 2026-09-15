#!/usr/bin/env node
/**
 * The loop guard's contract, asserted by EXECUTING it.
 *
 * What this replaces, and why that matters. The guard used to be a `case` inside the
 * workflow's `run:` block, and the test for it asserted that the `case` and the
 * `git log -1 --format=%s` were present in the YAML. Both were present, and the guard
 * was still wrong for this repository: a `case` on the pushed head's subject
 * classifies one landing shape, while every release in this repository's history
 * landed the bump as a **merge** commit — `8f80697c8` is `Merge pull request #202 from
 * …/release-next-0236`, whose second parent is `d7e7d63b7 chore(release): bump version
 * to 0.24.0`. The guard fell through, `assertVersionSurface` then answered a different
 * question and returned yes once the tag existed, and the run derived a second release
 * of a window that had already shipped.
 *
 * So these cases are run against the SHIPPED script, in real throwaway repositories,
 * one per shape a bump actually lands in — a direct commit, a merge whose second
 * parent is the bump (including the REAL topology, where the window's content landed
 * before the bump did), a squash, a bump whose Release does not exist yet, and the
 * commit that reverts one — plus the cases that must still release and the cases that
 * must refuse rather than answer. A test that read the source would have passed on the
 * broken guard; this one cannot.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PushGuardError, pushVerdict } from "./release-push-guard.mjs";

/** The script as the workflow runs it, not an import of its internals.
 *
 * The URL the module loader reports is already resolved to a physical path, which
 * matters here: reached through a symlinked checkout (`/tmp` on macOS) the script's
 * own `import.meta.url === argv[1]` guard disagrees with itself and does nothing at
 * all — silently, which is the one failure a guard test must not paper over. */
const GUARD = fileURLToPath(
	new URL("./release-push-guard.mjs", import.meta.url),
);

/** A `package.json` shaped like this repository's: tab-indented, one version line,
 * other fields around it. `isVersionOnlyChange` counts lines, so a one-line fixture
 * would not prove anything about the real file. */
const packageJson = (version) =>
	`{\n\t"name": "local-operator-ui",\n\t"version": "${version}",\n\t"private": true\n}\n`;

/** A scratch repository already at the released state: `v0.24.0` tagged on a tree
 * whose `package.json` says `0.24.0`. */
function scratch() {
	const dir = mkdtempSync(join(tmpdir(), "release-push-guard-"));
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: dir,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@example.com",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@example.com",
			},
		});
	/** The workflow's bump commit: one line in one file. */
	const bump = (version = "0.25.0") => {
		writeFileSync(join(dir, "package.json"), packageJson(version));
		git("add", "package.json");
		git("commit", "--quiet", "-m", `chore(release): bump version to ${version}`);
		return git("rev-parse", "HEAD").trim();
	};
	/** A landing with real content, merged the way this repository merges. */
	const land = (number, branch, file, subject) => {
		git("checkout", "--quiet", "-b", branch, "main");
		writeFileSync(join(dir, file), "content\n");
		git("add", "-A");
		git("commit", "--quiet", "-m", subject);
		git("checkout", "--quiet", "main");
		git(
			"merge",
			"--quiet",
			"--no-ff",
			"-m",
			`Merge pull request #${number} from t/${branch}`,
			branch,
		);
	};
	git("init", "--quiet", "-b", "main");
	writeFileSync(join(dir, "package.json"), packageJson("0.24.0"));
	writeFileSync(join(dir, "file.txt"), "one\n");
	git("add", "-A");
	git("commit", "--quiet", "-m", "chore: the released state");
	git("tag", "v0.24.0");
	return { dir, git, bump, land };
}

/** The shipped guard's verdict, run the way the workflow runs it, in `dir`. */
function verdict(dir, releasedTag = "v0.24.0") {
	const out = execFileSync(
		process.execPath,
		[GUARD, "--json", "--released-tag", releasedTag],
		{ cwd: dir, encoding: "utf8" },
	);
	return JSON.parse(out);
}

/** The shipped guard's refusal, which must be loud and must not be a skip. */
function refusal(dir, args) {
	try {
		execFileSync(process.execPath, [GUARD, "--json", ...args], {
			cwd: dir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		return { status: error.status, stderr: error.stderr };
	}
	throw new Error("the guard answered instead of refusing");
}

/** Run `body` against a scratch repository and clean it up. */
function withScratch(body) {
	const repo = scratch();
	try {
		body(repo);
	} finally {
		rmSync(repo.dir, { recursive: true, force: true });
	}
}

test("a bump committed directly at HEAD is not a release input", () => {
	withScratch(({ dir, git, bump }) => {
		bump();
		const result = verdict(dir);
		assert.equal(result.skip, true);
		assert.equal(result.shape, "version-line-only");
		assert.equal(result.releasedTag, "v0.24.0");
		// The tag the bump would get does not exist yet: the state after a run died
		// between its push and its tag. The guard does not consult it.
		assert.equal(git("tag", "-l", "v0.25.0").trim(), "");
		assert.match(result.message, /version line/);
	});
});

test("the real hand-cut shape: a bump merged on top of an already-landed window", () => {
	withScratch(({ dir, git, bump, land }) => {
		// The topology `8f80697c8` has: the window's content is on `main` first, the
		// release PR (whose only commit is the bump) is merged on top, and the tag
		// does not exist yet. The newest released tag is therefore a whole window
		// behind, so a comparison against it sees a hundred files of content where
		// this push landed one line.
		land(205, "feat/window", "feature.txt", "feat(panels): the feature");
		git("checkout", "--quiet", "-b", "release-next-025x");
		bump();
		git("checkout", "--quiet", "main");
		git(
			"merge",
			"--quiet",
			"--no-ff",
			"-m",
			"Merge pull request #206 from t/release-next-025x",
			"release-next-025x",
		);
		const subject = git("log", "-1", "--format=%s").trim();
		// The defect, as an assertion: the head's subject is a landing, not a bump, so
		// the `case` this guard used to be classified it as an ordinary push.
		assert.match(subject, /^Merge pull request #206 from /);
		assert.doesNotMatch(subject, /^chore\(release\): bump version to /);
		// ... and the second parent really is the bump.
		assert.equal(
			git("log", "-1", "--format=%s", "HEAD^2").trim(),
			"chore(release): bump version to 0.25.0",
		);
		// Which is why the reading that matters is the push's own diff: against
		// v0.24.0 this push looks like content, against its first parent it is one
		// line in one file.
		assert.ok(
			git("diff", "--name-only", "v0.24.0", "HEAD").trim().split("\n").length > 1,
		);
		assert.equal(
			git("diff", "--name-only", "HEAD^", "HEAD").trim(),
			"package.json",
		);
		const result = verdict(dir);
		assert.equal(result.skip, true);
		assert.equal(result.shape, "release-commit");
		assert.match(result.message, /0\.24\.0 -> 0\.25\.0/);
	});
});

test("the automated shape: the window landed, then the bump is pushed directly on top", () => {
	withScratch(({ dir, bump, land }) => {
		// What the workflow itself produces on every release: the window's content is
		// on `main` and untagged, and the release job pushes the bump as a direct
		// commit. The tag cannot exist yet — it is created after this push — so the
		// unreleased reading sees the whole window and only the landing reading sees
		// the release commit.
		land(209, "feat/window", "feature.txt", "feat(panels): the feature");
		bump();
		const result = verdict(dir);
		assert.equal(result.skip, true);
		assert.equal(result.shape, "release-commit");
	});
});

test("a bump landed by squash is skipped", () => {
	withScratch(({ dir, git, bump }) => {
		bump();
		// GitHub's squash button writes the PR title, and the PR is titled
		// `chore(release): bump version to X.Y.Z` by this repository's own runbook.
		git(
			"commit",
			"--quiet",
			"--amend",
			"-m",
			"chore(release): bump version to 0.25.0 (#206)",
		);
		const result = verdict(dir);
		assert.equal(result.skip, true);
		// Either reading answers the same question here — nothing is unreleased but the
		// version line, and the push landed nothing but it — which is the point: the
		// shapes differ, the answer does not.
		assert.ok(["version-line-only", "release-commit"].includes(result.shape));
	});
});

test("the commit that reverts a bump has nothing to release either", () => {
	withScratch(({ dir, git, bump }) => {
		const bumpSha = bump();
		// `git revert` writes `Revert "…"` — the undo of the bump, left on `main` when
		// a human decides against the version a dead run pushed. The tree it leaves is
		// the released one, so there is nothing to release.
		git("revert", "--no-edit", bumpSha);
		assert.equal(
			git("log", "-1", "--format=%s").trim(),
			'Revert "chore(release): bump version to 0.25.0"',
		);
		const result = verdict(dir);
		assert.equal(result.skip, true);
		assert.equal(result.shape, "nothing-unreleased");
	});
});

test("a bump whose Release already exists is skipped by the other reading", () => {
	withScratch(({ dir, git, bump }) => {
		bump();
		git("tag", "v0.25.0");
		// Once the Release exists, the anchor the workflow resolves is the bump's own
		// tag, and nothing has landed since it.
		const result = verdict(dir, "v0.25.0");
		assert.equal(result.skip, true);
		assert.equal(result.shape, "nothing-unreleased");
		assert.equal(result.releasedTag, "v0.25.0");
	});
});

test("an ordinary feature merge still releases", () => {
	withScratch(({ dir, land }) => {
		land(207, "feat/thing", "file.txt", "feat(panels): a real feature");
		const result = verdict(dir);
		assert.equal(result.skip, false);
		assert.equal(result.shape, "content");
	});
});

test("a push that carries a bump AND content is not swallowed", () => {
	withScratch(({ dir, git, bump }) => {
		bump();
		writeFileSync(join(dir, "file.txt"), "two\n");
		git("commit", "--quiet", "-am", "fix(chat): a real fix");
		// Skipping here would silently drop a landed fix until the next push. The
		// derivation refuses loudly instead (`assertVersionSurface`: the tree
		// advertises a version no tag explains), which is the documented recovery.
		const result = verdict(dir);
		assert.equal(result.skip, false);
		assert.equal(result.shape, "content");
	});
});

test("a commit that changes package.json without the version line is content", () => {
	withScratch(({ dir, git }) => {
		writeFileSync(
			join(dir, "package.json"),
			packageJson("0.24.0").replace('"private": true', '"private": false'),
		);
		git("commit", "--quiet", "-am", "chore(deps): a metadata change");
		const result = verdict(dir);
		assert.equal(result.skip, false);
		assert.equal(result.shape, "content");
	});
});

test("a push that lands nothing while content is unreleased still releases", () => {
	withScratch(({ dir, git, land }) => {
		land(208, "fix/thing", "file.txt", "fix(mcp): a real fix");
		git("commit", "--quiet", "--allow-empty", "-m", "ci: an empty housekeeping commit");
		// Landing nothing is not the same as landing the version line: the fix above
		// is still owed a release, and a guard that read an empty diff as "the release
		// commit" would stall it.
		const result = verdict(dir);
		assert.equal(result.skip, false);
		assert.equal(result.shape, "content");
	});
});

test("a push landing several commits with the bump at its tip is skipped (documented limit)", () => {
	withScratch(({ dir, git, bump }) => {
		writeFileSync(join(dir, "file.txt"), "two\n");
		git("add", "-A");
		git("commit", "--quiet", "-m", "fix(chat): a real fix");
		bump();
		const result = verdict(dir);
		// The workflow never pushes more than one commit, and the state this leaves is
		// the orphaned-version one the next push refuses loudly on, so the limit is
		// recorded here rather than left to be discovered. See the header of
		// `release-push-guard.mjs`.
		assert.equal(result.skip, true);
		assert.equal(result.shape, "release-commit");
	});
});

test("a released tag this clone does not carry is a refusal, not a skip", () => {
	withScratch(({ dir }) => {
		const { status, stderr } = refusal(dir, ["--released-tag", "v9.9.9"]);
		assert.notEqual(status, 0);
		assert.match(stderr, /Push guard refused: v9\.9\.9 or HEAD is not a ref/);
		// Named, and not git's own words: the run summary is read by whoever has to act
		// on it.
		assert.doesNotMatch(stderr, /fatal: ambiguous argument/);
	});
});

test("no released tag at all is a refusal rather than a skip", () => {
	// The anchor is resolved by the same module the derivation uses, so this is the
	// one case the pure function has to state: with nothing released there is no
	// window to measure a push against.
	assert.throws(
		() =>
			pushVerdict({
				releasedTag: null,
				unreleased: { files: [], packageAtFrom: "", packageAtTo: "" },
				landed: null,
			}),
		PushGuardError,
	);
});
