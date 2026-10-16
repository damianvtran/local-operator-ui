import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/*
 * `resolve-package-union.mjs` is the tool the NEXT person reaches for when a
 * `package.json` rebase conflict appears, so its two load-bearing properties are
 * pinned here, on real conflicted trees built in a scratch repo:
 *
 *  1. it produces the test:desktop UNION (both sides' files present) and the
 *     result PARSES - the check whose absence let a hand resolution commit
 *     conflict markers into package.json on 2026-10-16;
 *  2. it REFUSES a conflict that is not that union (here, a `version` clash),
 *     exiting non-zero and writing nothing, so it cannot silently mangle a
 *     package.json conflict it does not understand.
 *
 * A throwaway git repo is built per test because the tool reads the merge
 * STAGES, which only exist mid-conflict; nothing touches the real worktree.
 */
const RESOLVER = new URL("./resolve-package-union.mjs", import.meta.url)
	.pathname;
const MARKER = /<<<<<<< |>>>>>>> /;
const TOOL_OUTPUT = /resolve-package-union/;
const REFUSED = /refused/;

function git(cwd, ...args) {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function writePkg(cwd, mutate) {
	const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
	mutate(pkg);
	writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

/** A scratch repo whose `ta`/`tb` branches each append a test file, left mid-rebase. */
function conflictedRepo(mutateA, mutateB) {
	const dir = mkdtempSync(join(tmpdir(), "pkg-union-"));
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "t@t.t");
	git(dir, "config", "user.name", "t");
	writeFileSync(
		join(dir, "package.json"),
		`${JSON.stringify({ name: "x", version: "1.0.0", scripts: { "test:desktop": "a b" } }, null, 2)}\n`,
	);
	git(dir, "add", "package.json");
	git(dir, "commit", "-qm", "base");

	git(dir, "checkout", "-q", "-b", "ta");
	writePkg(dir, mutateA);
	git(dir, "commit", "-qam", "a");

	git(dir, "checkout", "-q", "main");
	git(dir, "checkout", "-q", "-b", "tb");
	writePkg(dir, mutateB);
	git(dir, "commit", "-qam", "b");

	git(dir, "checkout", "-q", "ta");
	try {
		git(dir, "rebase", "tb");
	} catch {
		/* the conflict is the setup, not a failure */
	}
	return dir;
}

test("resolves a test:desktop conflict as a union and writes parseable JSON", () => {
	const dir = conflictedRepo(
		(p) => {
			p.scripts["test:desktop"] += " c";
		},
		(p) => {
			p.scripts["test:desktop"] += " d";
		},
	);
	try {
		// The conflict is real and carries markers before the tool runs.
		assert.match(readFileSync(join(dir, "package.json"), "utf8"), MARKER);

		const out = execFileSync("node", [RESOLVER], {
			cwd: dir,
			encoding: "utf8",
		});
		assert.match(out, TOOL_OUTPUT);

		const resolved = readFileSync(join(dir, "package.json"), "utf8");
		assert.doesNotMatch(resolved, MARKER, "no markers survive");
		const pkg = JSON.parse(resolved); // the parse the 2026-10-16 corruption lacked
		const list = pkg.scripts["test:desktop"].split(/\s+/);
		for (const entry of ["a", "b", "c", "d"]) {
			assert.ok(list.includes(entry), `union kept ${entry}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("refuses a package.json conflict that is not the test:desktop union", () => {
	const dir = conflictedRepo(
		(p) => {
			p.version = "9.9.9";
		},
		(p) => {
			p.version = "8.8.8";
		},
	);
	try {
		const before = readFileSync(join(dir, "package.json"), "utf8");
		let code = 0;
		let stderr = "";
		try {
			execFileSync("node", [RESOLVER], { cwd: dir, encoding: "utf8" });
		} catch (error) {
			code = error.status ?? 1;
			stderr = String(error.stderr ?? "");
		}
		assert.notEqual(code, 0, "a non-union conflict must exit non-zero");
		assert.match(stderr, REFUSED);
		assert.equal(
			readFileSync(join(dir, "package.json"), "utf8"),
			before,
			"nothing was written",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
