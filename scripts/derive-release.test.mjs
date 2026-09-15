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
	assertVersionSurface,
	bumpVersion,
	classifyCommit,
	classifyCommits,
	deriveRelease,
	parseLog,
	readCommits,
	readLandings,
	releaseLineOf,
	renderNotes,
} from "./derive-release.mjs";

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
