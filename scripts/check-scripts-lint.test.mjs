#!/usr/bin/env node
/**
 * The scope gate's own cases.
 *
 * WHY THIS FILE EXISTS. The gate answers with an exit status, and both of its
 * failure directions are silent if it is wrong: a gate that reads the wrong base, or
 * that cannot find a merge base in a shallow clone, exits 0 having checked nothing —
 * which is exactly the hole it was written to close. So each rule below is driven
 * end to end against a real scratch repository with a real `biome` binary, and the
 * two properties that make it a ratchet rather than a wall are pinned: a violation
 * in a file the change TOUCHES fails, and pre-existing dirt in a file it does not
 * touch does not.
 *
 * The scratch repositories are real `git init` trees in a temp directory, removed at
 * the end of each case. `--biome` is the seam that lets a scratch tree run the
 * repository's own biome without a `node_modules` of its own — the same shape as
 * `check-vendored`'s injectable root.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(REPO_ROOT, "scripts", "check-scripts-lint.mjs");
const BIOME = join(REPO_ROOT, "node_modules", ".bin", "biome");

/** biome's own defaults, so a case's verdict is decided by the file, not the config. */
const BIOME_CONFIG = `${JSON.stringify(
	{
		$schema: "https://biomejs.dev/schemas/1.9.4/schema.json",
		vcs: { enabled: false, clientKind: "git", useIgnoreFile: false },
		formatter: { enabled: true, indentStyle: "tab" },
		linter: { enabled: true, rules: { recommended: true } },
		javascript: { formatter: { quoteStyle: "double" } },
	},
	null,
	"\t",
)}\n`;

/** Formatting-stable, so the clean cases are clean for a reason. */
const CLEAN = "export const value = 1;\nexport const doubled = value * 2;\n";

/** A pre-existing formatter error, committed on the base branch and never touched. */
const DIRTY = "export const other = () => {\n\t\treturn 1;\n};\n";

/** The violation this gate was written for: a re-indented block in a touched file. */
const INDENTED = "export const value = 1;\n\texport const doubled = 2;\n";

/** A lint-rule violation rather than a formatting one (useConst: never reassigned). */
const LINT_DIRTY = "let value = 1;\nexport const doubled = value * 2;\n";

function scratch() {
	const dir = mkdtempSync(join(tmpdir(), "lo-scripts-lint-"));
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
	writeFileSync(join(dir, "biome.json"), BIOME_CONFIG);
	mkdirSync(join(dir, "scripts"), { recursive: true });
	writeFileSync(join(dir, "scripts", "clean.mjs"), CLEAN);
	writeFileSync(join(dir, "scripts", "dirty.mjs"), DIRTY);
	writeFileSync(join(dir, "README.md"), "not a file this gate covers\n");
	git("init", "-q");
	git("add", "-A");
	git("commit", "-qm", "base");
	git("branch", "-M", "main");
	git("checkout", "-q", "-b", "feature");
	return {
		dir,
		git,
		write: (name, text) => writeFileSync(join(dir, "scripts", name), text),
		done: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** Run the gate the way CI and a developer both do: from the repository under test. */
function gate(dir, ...args) {
	return gateEnv(dir, {}, ...args);
}

/**
 * The same run with environment overrides, for the contract the gate reads from
 * `LINT_SINCE` - which is the spelling CI uses, and the one whose empty value must
 * not be read as "not requested".
 */
function gateEnv(dir, env, ...args) {
	const result = spawnSync(
		process.execPath,
		[GATE, "--biome", BIOME, ...args],
		{
			cwd: dir,
			encoding: "utf8",
			env: { ...process.env, ...env },
		},
	);
	return { status: result.status, out: result.stdout, err: result.stderr };
}

/**
 * The `actions/checkout` shape behind the base-resolution rule: a pull request's
 * merge ref, built on a base branch that MOVED after the pull request was
 * recorded.
 *
 * `scratch()` leaves the base commit on `main` and the change on `feature`. The
 * change lands on the branch, `main` then lands dirt of its own under `scripts/`
 * that this change never opens, and the merge is made the way GitHub makes it -
 * ON `main`, so its FIRST parent is the new base and its second is the change.
 * That ordering is the fixture: `HEAD^1` is the base branch as of this run, while
 * the `github.event.pull_request.base.sha` a payload would carry is `frozenBase`,
 * which is now an ancestor of `HEAD^1`.
 */
function mergeCheckout() {
	const repo = scratch();
	const frozenBase = repo.git("rev-parse", "main").trim();
	repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
	repo.git("add", "-A");
	repo.git("commit", "-qm", "feat(scripts): the change under test");
	repo.git("checkout", "-q", "main");
	repo.write("main-only.mjs", DIRTY);
	repo.git("add", "-A");
	repo.git("commit", "-qm", "main lands dirt of its own");
	repo.git(
		"merge",
		"--no-ff",
		"-q",
		"-m",
		"Merge feature into main",
		"feature",
	);
	return { ...repo, frozenBase };
}

test("a clean change under scripts/ passes, and says what it read", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		const { status, out } = gate(repo.dir, "--since", "main");
		assert.equal(status, 0, out);
		assert.match(out, /checking 1 changed file/);
		assert.match(out, /scripts\/clean\.mjs/);
		assert.match(out, /are lint-clean/);
	} finally {
		repo.done();
	}
});

test("a formatter error in a touched file fails, and prints the fix", () => {
	const repo = scratch();
	try {
		// The shape of the violation this gate was written for: a re-indented block
		// that no `pnpm lint` run can see, in a file this change edits.
		repo.write("clean.mjs", INDENTED);
		const { status, out, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1);
		assert.match(out, /scripts\/clean\.mjs/);
		assert.match(`${out}${err}`, /Formatter would have printed/);
		assert.match(err, /FAILED/);
		assert.match(err, /biome check --write scripts\/clean\.mjs/);
	} finally {
		repo.done();
	}
});

test("a lint-rule violation in a touched file fails too, not only the formatter", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", LINT_DIRTY);
		const { status, out, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1);
		assert.match(`${out}${err}`, /useConst/);
	} finally {
		repo.done();
	}
});

test("the fix command names the failing file and not the clean one beside it", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		repo.write("new-proof.mjs", INDENTED);
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1);
		assert.match(err, /1 of those 2 file\(s\)/);
		assert.match(err, /biome check --write scripts\/new-proof\.mjs/);
		assert.doesNotMatch(err, /--write scripts\/clean\.mjs/);
	} finally {
		repo.done();
	}
});

test("pre-existing dirt in an untouched file does not fail the change", () => {
	const repo = scratch();
	try {
		// `scripts/dirty.mjs` has carried a formatter error since the base commit and
		// this branch does not go near it: the ratchet must not charge this change for
		// the backlog, or the first pull request after this gate lands is red for a
		// file it never opened.
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		const { status, out, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 0, `${out}${err}`);
		assert.doesNotMatch(out, /scripts\/dirty\.mjs/);
	} finally {
		repo.done();
	}
});

test("an uncommitted violation is caught, so it bites before the first commit", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", INDENTED);
		// Nothing staged, nothing committed: the working tree is the whole change.
		assert.match(repo.git("status", "--porcelain"), /clean\.mjs/);
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, err);
	} finally {
		repo.done();
	}
});

test("a committed violation is caught, which is the shape CI sees", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", INDENTED);
		repo.git("add", "-A");
		repo.git("commit", "-qm", "a harness nobody checked");
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, err);
	} finally {
		repo.done();
	}
});

test("a new untracked file under scripts/ is checked", () => {
	const repo = scratch();
	try {
		repo.write(
			"new-proof.mjs",
			"export const proof = () => {\n\t\treturn 1;\n};\n",
		);
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, err);
	} finally {
		repo.done();
	}
});

test("a change that touches nothing under scripts/ passes and says so", () => {
	const repo = scratch();
	try {
		writeFileSync(join(repo.dir, "README.md"), "a change outside the scope\n");
		const { status, out } = gate(repo.dir, "--since", "main");
		assert.equal(status, 0, out);
		assert.match(out, /nothing to check/);
	} finally {
		repo.done();
	}
});

test("a base ref that does not resolve is a failure, never a pass", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		const { status, err } = gate(repo.dir, "--since", "no-such-branch");
		assert.equal(status, 1);
		assert.match(err, /does not resolve to a commit/);
	} finally {
		repo.done();
	}
});

test("the usage is printed on request", () => {
	const { status, stdout } = spawnSync(process.execPath, [GATE, "--help"], {
		encoding: "utf8",
	});
	assert.equal(status, 0);
	assert.match(stdout, /usage: node scripts\/check-scripts-lint\.mjs/);
});

/* ---- a path git quotes, which is a path it still meant ------------------- */

test("a quoted path in the change is checked, not silently dropped", () => {
	const repo = scratch();
	try {
		// git QUOTES any path holding a byte >= 0x80 (or a quote, or a backslash), so
		// `git diff --name-only` prints "scripts/caf\303\251.mjs" - a string that names
		// nothing on disk. Reading that list line-wise and filtering it by existence
		// dropped the file without a word: a committed formatter error in exactly this
		// file made the gate answer "no file under scripts/ changed ... nothing to
		// check" and exit 0.
		repo.write("café.mjs", INDENTED);
		repo.git("add", "-A");
		repo.git("commit", "-qm", "a harness with a formatter error");
		const { status, out, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, `${out}${err}`);
		assert.match(out, /checking 1 changed file/);
		assert.match(err, /1 of those 1 file\(s\)/);
		assert.match(err, /biome check --write scripts\/café\.mjs/);
	} finally {
		repo.done();
	}
});

test("a quoted path that is not committed yet is checked too", () => {
	const repo = scratch();
	try {
		// The other half of the same read: `git ls-files --others` quotes too, so an
		// untracked harness with an exotic name has to arrive intact for the gate to
		// bite before the first commit.
		repo.write("naïve.mjs", INDENTED);
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, err);
		assert.match(err, /scripts\/naïve\.mjs/);
	} finally {
		repo.done();
	}
});

test("a path git names that cannot be read is a failure, not a subtraction", () => {
	const repo = scratch();
	try {
		// A dangling symlink git does not ignore is a path in the change with nothing
		// readable behind it. Dropping it would report a verdict over a change the gate
		// could not look at, which is the failure direction this file forbids outright.
		symlinkSync("nowhere.mjs", join(repo.dir, "scripts", "ghost.mjs"));
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, err);
		assert.match(err, /cannot be read/);
		assert.match(err, /ghost\.mjs/);
	} finally {
		repo.done();
	}
});

/* ---- the base the checkout was built on, not the one the payload remembers -- */

test("the frozen payload base is refused, and the merge's first parent is the answer", () => {
	const repo = mergeCheckout();
	try {
		// (a) what `github.event.pull_request.base.sha` would name: an ancestor of
		// HEAD^1 once the base branch moved, so the diff from it sweeps in the commits
		// the base itself landed - here, the dirt this change never opened.
		const frozen = gate(repo.dir, "--since", repo.frozenBase);
		assert.equal(frozen.status, 1, frozen.out);
		assert.match(frozen.err, /behind/);
		assert.match(frozen.err, /LINT_SINCE=\$\(git rev-parse HEAD\^1\)/);
		assert.doesNotMatch(frozen.err, /main-only\.mjs/);

		// (b) the base the checkout was actually built on: the change is judged on its
		// own file, and main's dirt is not in scope.
		const built = gate(repo.dir, "--since", "HEAD^1");
		assert.equal(built.status, 0, `${built.out}${built.err}`);
		assert.match(built.out, /checking 1 changed file/);
		assert.match(built.out, /scripts\/clean\.mjs/);
		assert.doesNotMatch(built.out, /main-only\.mjs/);
	} finally {
		repo.done();
	}
});

test("a base branch that has moved on is compared from the fork point, and says so", () => {
	const repo = scratch();
	try {
		// The local shape of the same question, where nothing is charged in either
		// direction: main lands its own dirt after the change branched, and the gate
		// states which two commits it compared instead of leaving it implicit.
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		repo.git("add", "-A");
		repo.git("commit", "-qm", "the change");
		repo.git("checkout", "-q", "main");
		repo.write("landed-on-main.mjs", DIRTY);
		repo.git("add", "-A");
		repo.git("commit", "-qm", "main lands dirt of its own");
		repo.git("checkout", "-q", "feature");
		const { status, out } = gate(repo.dir, "--since", "main");
		assert.equal(status, 0, `${out}`);
		assert.match(out, /fork point/);
		assert.match(out, /checking 1 changed file/);
		assert.doesNotMatch(out, /landed-on-main\.mjs/);
	} finally {
		repo.done();
	}
});

/* ---- a file biome has no handler for is not a violation ------------------- */

test("a change whose only scripts/ file biome cannot check is not called unformatted", () => {
	const repo = scratch();
	try {
		// 15 of this tree's committed files are .html, .sh or .py, and biome has no
		// handler for any of them: as the whole list it exits 1 with "No files were
		// processed in the specified paths", which this gate used to answer with
		// `FAILED ... are not lint-clean` and a fix command that itself exits 1.
		repo.write("require-report.sh", "#!/usr/bin/env sh\necho report\n");
		const { status, out, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 0, `${out}${err}`);
		assert.match(out, /no handler for the one file/);
		assert.match(out, /scripts\/require-report\.sh/);
		assert.doesNotMatch(err, /FAILED/);
		assert.doesNotMatch(err, /--write/);
	} finally {
		repo.done();
	}
});

test("a change mixing a checkable file with an uncheckable one is judged on the checkable one", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		repo.write("evidence.html", "<p>a harness biome cannot parse</p>\n");
		const clean = gate(repo.dir, "--since", "main");
		assert.equal(clean.status, 0, `${clean.out}${clean.err}`);
		assert.match(
			clean.out,
			/1 of those 2 file\(s\) under scripts\/ are lint-clean/,
		);
		assert.match(clean.out, /did not process the other 1/);

		// And when the checkable file is the offender, the fix command names it and
		// not the one biome was never able to read.
		repo.write("clean.mjs", INDENTED);
		const dirty = gate(repo.dir, "--since", "main");
		assert.equal(dirty.status, 1, dirty.out);
		assert.match(dirty.err, /1 of those 2 file\(s\)/);
		assert.match(dirty.err, /biome check --write scripts\/clean\.mjs\s*$/m);
	} finally {
		repo.done();
	}
});

/* ---- the config the verdict is actually decided by ------------------------ */

test("the repository's own biome.json still fails a formatter error under scripts/", () => {
	const repo = scratch();
	try {
		// Every other case builds its own config, so nothing pinned the real one: an
		// `overrides` entry disabling the formatter and linter for `scripts/**` leaves
		// all of them green while the gate goes green over committed dirt. Driving the
		// repository's own config is what closes that.
		copyFileSync(join(REPO_ROOT, "biome.json"), join(repo.dir, "biome.json"));
		repo.write("clean.mjs", INDENTED);
		const { status, err } = gate(repo.dir, "--since", "main");
		assert.equal(status, 1, err);
		assert.match(err, /biome check --write scripts\/clean\.mjs/);
	} finally {
		repo.done();
	}
});

/* ---- a base nobody named -------------------------------------------------- */

test("an empty base is refused rather than read as the default", () => {
	const repo = scratch();
	try {
		repo.write("clean.mjs", `${CLEAN}export const extra = 2;\n`);
		// A fallback to `origin/main`/`main` would exit 0 here - the change is clean -
		// and that is the point: a CI step whose base lookup produced nothing must not
		// be answered with a comparison against a ref nobody named.
		const viaFlag = gate(repo.dir, "--since=");
		assert.equal(viaFlag.status, 1, viaFlag.out);
		assert.match(viaFlag.err, /base ref is empty/);

		const viaEnvironment = gateEnv(repo.dir, { LINT_SINCE: "" });
		assert.equal(viaEnvironment.status, 1, viaEnvironment.out);
		assert.match(viaEnvironment.err, /base ref is empty/);
	} finally {
		repo.done();
	}
});
