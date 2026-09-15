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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	const result = spawnSync(
		process.execPath,
		[GATE, "--biome", BIOME, ...args],
		{
			cwd: dir,
			encoding: "utf8",
		},
	);
	return { status: result.status, out: result.stdout, err: result.stderr };
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
