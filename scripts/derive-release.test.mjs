#!/usr/bin/env node
/**
 * The release derivation's contract.
 *
 * The version a release gets cannot be taken back, so the cases that matter are
 * the ones where a wrong answer looks right: a window of docs/chore commits that
 * must release NOTHING (a workflow that always releases would spend a number on
 * every merge), a single `feat:` among a hundred chores that must still be a
 * minor, and a breaking change, which is the one class a pre-1.0 repository maps
 * to a minor rather than to a major.
 *
 * The git-facing half is driven against a REAL repository built in a temp
 * directory, not a hand-written string: the parser's job is to match what `git log
 * --first-parent` actually prints, and a fixture would only prove it matches a
 * fixture.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	DerivationError,
	assertRefExists,
	assertVersionSurface,
	bumpVersion,
	classifyCommit,
	classifyCommits,
	deriveRelease,
	parseLog,
	readCommits,
	readLandings,
	releaseBases,
	releaseLineOf,
	renderNotes,
} from "./derive-release.mjs";
import { selectIncumbentAnchor } from "./release-baseline.mjs";

const subject = (text) => ({ subject: text, body: "" });

test("a feat is a minor and a fix is a patch", () => {
	assert.equal(
		classifyCommit(subject("feat(browser): a tab strip")).bump,
		"minor",
	);
	assert.equal(classifyCommit(subject("fix(mcp): say why")).bump, "patch");
	assert.equal(
		classifyCommit(subject("perf(chat): 40ms faster")).bump,
		"patch",
	);
	assert.equal(
		classifyCommit(subject("revert: undo the tab strip")).bump,
		"patch",
	);
});

test("the non-releasing types release nothing on their own", () => {
	for (const type of [
		"docs",
		"chore",
		"ci",
		"test",
		"refactor",
		"style",
		"build",
	]) {
		const verdict = classifyCommit(subject(`${type}: housekeeping`));
		assert.equal(verdict.bump, null, type);
		assert.equal(verdict.conventional, true, type);
	}
});

test("a conventional type nobody listed is read as a patch, and named", () => {
	const verdict = classifyCommit(subject("deps: bump electron"));
	assert.equal(verdict.bump, "patch");
	assert.equal(verdict.unlistedType, true);
});

test("a subject with no conventional type is unclassified, not guessed at", () => {
	for (const text of ["Merge branch 'main' into x", "wip", "Fix the thing"]) {
		const verdict = classifyCommit(subject(text));
		assert.equal(verdict.bump, null, text);
		assert.equal(verdict.conventional, false, text);
	}
});

test("a breaking change is a minor here, by both spellings", () => {
	const bang = classifyCommit(subject("feat(cli)!: drop the old flag"));
	assert.equal(bang.bump, "minor");
	assert.equal(bang.breaking, true);
	const footer = classifyCommit({
		subject: "fix(api): drop the old flag",
		body: "Some prose.\n\nBREAKING CHANGE: the old flag is gone.\n",
	});
	assert.equal(footer.bump, "minor");
	assert.equal(footer.breaking, true);
	// The hyphenated spelling is the other spelling in the wild.
	assert.equal(
		classifyCommit({ subject: "fix: y", body: "BREAKING-CHANGE: gone" })
			.breaking,
		true,
	);
});

test("the strongest type in the window wins", () => {
	const window = [
		subject("docs: readme"),
		subject("fix(chat): a real fix"),
		subject("feat(panels): a real feature"),
		subject("chore: deps"),
	];
	assert.equal(classifyCommits(window).bump, "minor");
	assert.equal(
		classifyCommits([subject("chore: deps"), subject("fix: x")]).bump,
		"patch",
	);
	assert.equal(classifyCommits([subject("chore: deps")]).bump, null);
});

test("the bump classes produce the next plain version", () => {
	assert.equal(bumpVersion("0.24.0", "minor"), "0.25.0");
	assert.equal(bumpVersion("0.24.0", "patch"), "0.24.1");
	assert.equal(bumpVersion("0.9.9", "patch"), "0.9.10");
	assert.throws(
		() => bumpVersion("v0.24.0", "patch"),
		/Not a plain X\.Y\.Z version/,
	);
});

test("a window of chores derives NO release, and says why", () => {
	const result = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [subject("docs: readme"), subject("chore(release): housekeeping")],
		landings: [],
	});
	assert.equal(result.release, false);
	assert.equal(result.version, null);
	assert.match(
		result.reason,
		/No commit in v0\.24\.0\.\.HEAD asks for a release/,
	);
	assert.match(result.reason, /2 docs|1 docs/);
	assert.match(result.reason, /do not release on their own/);
});

test("an empty window derives no release rather than repeating the last version", () => {
	const result = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [],
	});
	assert.equal(result.release, false);
	assert.match(result.reason, /the range carries no non-merge commits/);
});

test("a breaking change in the window is a minor, and is reported as breaking", () => {
	const result = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [
			subject("fix(api)!: the response shape changes"),
			subject("docs: a note about it"),
		],
	});
	assert.equal(result.release, true);
	assert.equal(result.bump, "minor");
	assert.equal(result.version, "0.25.0");
	assert.deepEqual(result.breaking, ["fix(api)!: the response shape changes"]);
});

test("a feat among chores is still a minor, and a fix alone is a patch", () => {
	const feat = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [subject("chore: a"), subject("feat(x): b"), subject("docs: c")],
	});
	assert.equal(feat.version, "0.25.0");
	const fix = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [subject("fix(x): b")],
	});
	assert.equal(fix.bump, "patch");
	assert.equal(fix.version, "0.24.1");
});

test("a forced bump overrides the types and is disclosed as forced", () => {
	const result = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [subject("docs: only docs")],
		forcedBump: "patch",
	});
	assert.equal(result.release, true);
	assert.equal(result.version, "0.24.1");
	assert.equal(result.forced, "patch");
	assert.match(result.reason, /forced to patch/);
});

test("unclassified landings are listed rather than dropped", () => {
	const result = deriveRelease({
		windowBase: "v0.24.0",
		versionBase: "0.24.0",
		commits: [subject("fix(x): b")],
		landings: [
			{
				sha: "a".repeat(40),
				subject: "Update stuff",
				bump: null,
				conventional: false,
			},
			{
				sha: "b".repeat(40),
				subject: "docs: a described landing",
				bump: null,
				conventional: true,
			},
		],
	});
	assert.deepEqual(result.unclassified, ["Update stuff"]);
});

test("the notes carry the repository's shape, and claim no gate outcome", () => {
	const notes = renderNotes({
		version: "0.25.0",
		previousTag: "v0.24.0",
		windowBase: "v0.24.0",
		bump: "minor",
		repository: "damianvtran/local-operator-ui",
		landings: [
			{
				sha: "c".repeat(40),
				number: 201,
				title: "feat(browser): the tab strip",
				subject: "feat(browser): the tab strip (#201)",
				releaseLine: "Release: minor — a browser surface inside the app.",
				bump: "minor",
				conventional: true,
			},
			{
				sha: "d".repeat(40),
				number: 202,
				title: "fix(mcp): a refusal in the user's words",
				subject: "fix(mcp): a refusal (#202)",
				releaseLine: null,
				bump: "patch",
				conventional: true,
			},
		],
		breaking: [],
		unlistedTypes: ["deps: bump electron"],
		unclassified: ["Update stuff"],
	});
	assert.match(
		notes,
		/^> Generated by `\.github\/workflows\/auto-release\.yml`/,
	);
	for (const heading of [
		"## What's new",
		"## Impact",
		"## PRs in this release",
		"## Notes on the gate",
	]) {
		assert.ok(notes.includes(heading), heading);
	}
	// The merger's own sentence, quoted; and an absent one reported as absent
	// rather than written by the workflow.
	assert.match(notes, /`Release: minor — a browser surface inside the app\.`/);
	assert.match(notes, /This PR's body carries no `Release:` line/);
	assert.match(notes, /- \*\*#201\*\*/);
	assert.match(
		notes,
		/\*\*Full Changelog\*\*: https:\/\/github\.com\/damianvtran\/local-operator-ui\/compare\/v0\.24\.0\.\.\.v0\.25\.0/,
	);
	assert.match(notes, /Nothing has been built when this body is written\./);
	assert.match(notes, /\*\*No gate outcome/);
	// The two lists of things the window could not classify.
	assert.match(notes, /`deps: bump electron`/);
	assert.match(notes, /`Update stuff`/);
	// No claim of a verification that did not happen.
	assert.doesNotMatch(notes, /verified|passed|gate: (ok|green)/i);
});

test("the notes call out a declared breaking change", () => {
	const notes = renderNotes({
		version: "0.25.0",
		previousTag: "v0.24.0",
		bump: "minor",
		repository: "damianvtran/local-operator-ui",
		breaking: ["fix(api)!: the response shape changes"],
	});
	assert.match(notes, /\*\*Breaking change declared\*\*/);
	assert.match(notes, /`fix\(api\)!: the response shape changes`/);
});

test("the derived version is refused when main already advertises an unreleased one", () => {
	// The states this exists for: a merged PR carried its own bump, or a previous
	// release died between its bump commit and its tag. Both leave a version that
	// cannot be reused, and the message has to name both numbers to be actionable.
	assert.equal(
		assertVersionSurface({ packageVersion: "0.24.0", versionBase: "0.24.0" }),
		true,
	);
	assert.throws(
		() =>
			assertVersionSurface({ packageVersion: "0.25.0", versionBase: "0.24.0" }),
		(error) => {
			assert.match(error.message, /says 0\.25\.0/);
			assert.match(error.message, /newest released tag is 0\.24\.0/);
			assert.match(
				error.message,
				/tag the orphaned commit, or drop the stray bump/,
			);
			return true;
		},
	);
});

test("releaseLineOf reads the merger's line and nothing else", () => {
	assert.equal(
		releaseLineOf("body\n\nRelease: patch — a small fix\nmore"),
		"Release: patch — a small fix",
	);
	assert.equal(releaseLineOf("no line here"), null);
	assert.equal(releaseLineOf(""), null);
});

test("parseLog reads the record format git actually produces", () => {
	const text = `abc${"\u001f"}feat(x): a subject${"\u001f"}def ghi${"\u001f"}a body\n\nmore\u001e\ndef${"\u001f"}docs: another${"\u001f"}\u001f\u001e`;
	const parsed = parseLog(text);
	assert.equal(parsed.length, 2);
	assert.deepEqual(parsed[0], {
		sha: "abc",
		subject: "feat(x): a subject",
		parents: ["def", "ghi"],
		body: "a body\n\nmore",
	});
	assert.equal(parsed[1].parents.length, 0);
});

test("a real repository's window is read as the workflow reads it", () => {
	const dir = mkdtempSync(join(tmpdir(), "derive-release-"));
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
	try {
		git("init", "--quiet", "-b", "main");
		writeFileSync(join(dir, "file.txt"), "one\n");
		git("add", ".");
		git("commit", "--quiet", "-m", "chore: initial");
		git("tag", "v0.1.0");

		// A branch landed with GitHub's merge button, carrying one real fix.
		git("checkout", "--quiet", "-b", "fix/thing");
		writeFileSync(join(dir, "file.txt"), "two\n");
		git("commit", "--quiet", "-am", "fix(chat): the thing");
		git("checkout", "--quiet", "main");
		git(
			"merge",
			"--quiet",
			"--no-ff",
			"-m",
			"Merge pull request #7 from fix/thing",
			"fix/thing",
		);

		// A PR landed with the squash button, whose subject is the PR title.
		writeFileSync(join(dir, "file.txt"), "three\n");
		git("commit", "--quiet", "-am", "feat(panels): squash-landed (#8)");

		// And a docs commit that must change nothing about the bump.
		writeFileSync(join(dir, "notes.md"), "text\n");
		git("add", ".");
		git("commit", "--quiet", "-m", "docs: a note");

		// The readers shell out to `git` in the process's working directory, which
		// is the checkout in CI and the release job. A scratch repository is
		// therefore driven the same way `git` itself is: from inside it.
		const before = process.cwd();
		process.chdir(dir);
		try {
			const commits = readCommits("v0.1.0", "HEAD");
			const landings = readLandings("v0.1.0", "HEAD");
			// The merge commit itself is not classified; its branch commit is.
			assert.deepEqual(commits.map((c) => c.subject).sort(), [
				"docs: a note",
				"feat(panels): squash-landed (#8)",
				"fix(chat): the thing",
			]);
			assert.equal(landings.length, 3);
			const merge = landings.find((l) =>
				l.subject.startsWith("Merge pull request #7"),
			);
			assert.equal(merge.bump, "patch");
			assert.equal(merge.conventional, true);
			const squash = landings.find((l) => l.subject.includes("#8"));
			assert.equal(squash.bump, "minor");
			const docs = landings.find((l) => l.subject === "docs: a note");
			assert.equal(docs.bump, null);
			assert.equal(docs.conventional, true);
			// A landings-level class can never exceed the whole-window class.
			const result = deriveRelease({
				windowBase: "v0.1.0",
				versionBase: "0.1.0",
				commits,
				landings,
			});
			assert.equal(result.bump, "minor");
			assert.equal(result.version, "0.2.0");
		} finally {
			process.chdir(before);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/* ---- the range a release describes --------------------------------------- */

/** The notes the run would publish. `main()` renders them after the derivation,
 * from the same landings, so a test that asserts on them goes through the same
 * renderer rather than asserting on `deriveRelease`'s return value. */
const notesFor = (result, landings, windowBase) =>
	renderNotes({
		version: result.version,
		previousTag: windowBase,
		windowBase,
		bump: result.bump,
		repository: "damianvtran/local-operator-ui",
		landings,
		breaking: result.breaking,
		unlistedTypes: result.unlistedTypes,
		unclassified: result.unclassified,
		forcedBump: result.forced,
	});

/**
 * A release list in the state every publish passes through, and the state a range
 * bounded by "the newest release a user could be running" gets wrong.
 *
 * `v0.25.0` was created as a pre-release by the workflow's own `gh release create`
 * and stays one until `publish.yml` promotes it at the end of a 25-50 minute
 * pipeline. That is the whole length of every release, not an edge case.
 */
const archZip = (version) => [
	{ name: `local-operator-ui-${version}-arm64.zip` },
	{ name: "latest-mac.yml" },
];
const release = (
	version,
	{ prerelease = false, assets = null } = {},
) => ({
	tag_name: `v${version}`,
	prerelease,
	draft: false,
	published_at: "2026-09-15T10:00:00Z",
	assets: assets ?? archZip(version),
});
const GOOD = [release("0.24.0"), release("0.23.5")];
const IN_FLIGHT = [release("0.25.0", { prerelease: true, assets: [] }), ...GOOD];

/** A scratch repository in the state a publish window leaves behind: the released
 * base, a feature that landed before the release, the workflow's bump commit tagged
 * as a pre-release, and a later merge that arrived while the pipeline was running.
 * Returns the subjects the derivation reads, so the assertions are about commits
 * rather than about strings. */
function publishWindow({ later }) {
	const dir = mkdtempSync(join(tmpdir(), "derive-window-"));
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
	const version = (value) =>
		writeFileSync(
			join(dir, "package.json"),
			`{\n\t"name": "local-operator-ui",\n\t"version": "${value}",\n\t"private": true\n}\n`,
		);
	const merge = (number, branch, subject) => {
		git("checkout", "--quiet", "-b", branch, "main");
		writeFileSync(join(dir, `${branch.replaceAll("/", "-")}.txt`), "x\n");
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
	version("0.24.0");
	writeFileSync(join(dir, "README.md"), "text\n");
	git("add", "-A");
	git("commit", "--quiet", "-m", "chore: the released state");
	git("tag", "v0.24.0");
	merge(205, "feat/first", "feat(panels): the feature that shipped as v0.25.0");
	// The workflow's bump, committed to `main` and tagged as the pre-release.
	version("0.25.0");
	git("add", "package.json");
	git("commit", "--quiet", "-m", "chore(release): bump version to 0.25.0");
	git("tag", "v0.25.0");
	merge(206, "docs/second", later);
	return { dir, git };
}

test("a merge that lands inside a publish window is measured against the tag, not the release", () => {
	const { dir, git } = publishWindow({ later: "docs(readme): a note" });
	const before = process.cwd();
	process.chdir(dir);
	try {
		const bases = releaseBases({ releases: IN_FLIGHT });
		assert.equal(bases.windowBase, "v0.25.0");
		assert.equal(bases.versionBase, "0.25.0");
		// The bound this replaced: the newest release a USER could run is a release
		// behind for the whole publish, so a range anchored there still holds the
		// release-in-flight's own commits.
		assert.equal(selectIncumbentAnchor(IN_FLIGHT).tag, "v0.24.0");

		const commits = readCommits(bases.windowBase, "HEAD");
		assert.deepEqual(commits.map((commit) => commit.subject), [
			"docs(readme): a note",
		]);
		const result = deriveRelease({
			windowBase: bases.windowBase,
			versionBase: bases.versionBase,
			commits,
			landings: readLandings(bases.windowBase, "HEAD"),
		});
		// A docs-only merge inside the window releases NOTHING.
		assert.equal(result.release, false);
		assert.equal(result.version, null);
		assert.match(result.reason, /1 docs/);
		// Anchored at v0.24.0 — the bound that was wrong — the same push derived
		// v0.26.0 from a feature that had already shipped: the over-called minor
		// AGENTS.md calls the worse direction, with notes that re-listed the previous
		// release. That is the defect this bound exists to prevent, and it is asserted
		// rather than described. The version base is the part that makes it a duplicate
		// of a released number: it stayed at the newest tag (0.25.0) while the window
		// base lagged one release behind, which is the mixed state the old code
		// produced in the middle of every publish.
		const oldBase = selectIncumbentAnchor(IN_FLIGHT).tag;
		const oldLandings = readLandings(oldBase, "HEAD");
		const old = deriveRelease({
			windowBase: oldBase,
			versionBase: "0.25.0",
			commits: readCommits(oldBase, "HEAD"),
			landings: oldLandings,
		});
		assert.equal(old.bump, "minor");
		assert.equal(old.version, "0.26.0");
		assert.match(notesFor(old, oldLandings, oldBase), /#205/);
	} finally {
		process.chdir(before);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("two merges in one publish window: the second is the release, and the notes do not re-list the first", () => {
	const { dir } = publishWindow({
		later: "feat(composer): the second feature",
	});
	const before = process.cwd();
	process.chdir(dir);
	try {
		const bases = releaseBases({ releases: IN_FLIGHT });
		const commits = readCommits(bases.windowBase, "HEAD");
		assert.deepEqual(commits.map((commit) => commit.subject), [
			"feat(composer): the second feature",
		]);
		const landings = readLandings(bases.windowBase, "HEAD");
		const result = deriveRelease({
			windowBase: bases.windowBase,
			versionBase: bases.versionBase,
			commits,
			landings,
		});
		assert.equal(result.bump, "minor");
		assert.equal(result.version, "0.26.0");
		const notes = notesFor(result, landings, bases.windowBase);
		// The released window's PR is NOT in this release's notes, and neither is the
		// bump commit that tagged it: both are behind the tag the range starts at.
		assert.match(notes, /#206/);
		assert.doesNotMatch(notes, /#205/);
		assert.doesNotMatch(notes, /bump version to 0\.25\.0/);
		assert.match(notes, /compare\/v0\.25\.0\.\.\.v0\.26\.0/);
	} finally {
		process.chdir(before);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the ordinary case: one merge since the newest release derives its own bump", () => {
	const dir = mkdtempSync(join(tmpdir(), "derive-normal-"));
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
	const before = process.cwd();
	try {
		git("init", "--quiet", "-b", "main");
		process.chdir(dir);
		writeFileSync(
			join(dir, "package.json"),
			'{\n\t"name": "local-operator-ui",\n\t"version": "0.24.0"\n}\n',
		);
		git("add", "-A");
		git("commit", "--quiet", "-m", "chore: the released state");
		git("tag", "v0.24.0");
		git("checkout", "--quiet", "-b", "fix/thing");
		writeFileSync(join(dir, "file.txt"), "one\n");
		git("add", "-A");
		git("commit", "--quiet", "-m", "fix(mcp): a refusal in the user's words");
		git("checkout", "--quiet", "main");
		git(
			"merge",
			"--quiet",
			"--no-ff",
			"-m",
			"Merge pull request #207 from t/fix/thing",
			"fix/thing",
		);
		const bases = releaseBases({ releases: GOOD });
		assert.equal(bases.windowBase, "v0.24.0");
		assert.equal(bases.versionBase, "0.24.0");
		assert.equal(bases.resolved, true);
		const landings = readLandings(bases.windowBase, "HEAD");
		const result = deriveRelease({
			windowBase: bases.windowBase,
			versionBase: bases.versionBase,
			commits: readCommits(bases.windowBase, "HEAD"),
			landings,
		});
		assert.equal(result.bump, "patch");
		assert.equal(result.version, "0.24.1");
		assert.match(notesFor(result, landings, bases.windowBase), /#207/);
	} finally {
		process.chdir(before);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an explicit --base replays a past window and is not the derived bound", () => {
	const bases = releaseBases({
		releases: IN_FLIGHT,
		base: "v0.23.5",
		versionBase: "0.23.5",
	});
	assert.equal(bases.windowBase, "v0.23.5");
	assert.equal(bases.versionBase, "0.23.5");
	assert.equal(bases.resolved, false);
});

test("a git revert's own subject classifies, and the release bump's undo does not", () => {
	// `git revert` writes `Revert "…"`, which the reference mapping's `revert:`
	// never matched: a window whose only landing was a revert read as a window with
	// nothing in it.
	const revert = classifyCommit(subject('Revert "fix: resolve a Tab boundary"'));
	assert.equal(revert.bump, "patch");
	assert.equal(revert.conventional, true);
	// ... except the one revert that is bookkeeping rather than a change.
	const bump = classifyCommit(
		subject('Revert "chore(release): bump version to 0.25.0"'),
	);
	assert.equal(bump.bump, null);
	assert.equal(bump.revertedReleaseBump, true);
	assert.equal(bump.conventional, true);
	// A hand-written lowercase `revert:` still means what it always did.
	assert.equal(classifyCommit(subject("revert: undo the glyph sizes")).bump, "patch");
});

test("an unresolvable --base is a named refusal, not a git error", () => {
	assert.throws(
		() => assertRefExists("v9.9.9", "--base"),
		(error) => {
			assert.ok(error instanceof DerivationError);
			assert.match(error.message, /`v9\.9\.9` \(--base\) is not a tag or commit/);
			assert.match(error.message, /A release tag looks like `v0\.24\.0`/);
			return true;
		},
	);
	assert.equal(assertRefExists("HEAD", "--ref"), undefined);
});
