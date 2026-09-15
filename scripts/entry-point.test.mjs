#!/usr/bin/env node
/**
 * Every release script must reach its own entry point, whatever spelling the
 * caller used. One table, one invocation per script, driven through BOTH
 * spellings.
 *
 * WHY THIS FILE EXISTS. `release-push-guard.mjs` compared
 * `import.meta.url === pathToFileURL(process.argv[1]).href`, and through a
 * symlinked directory those two disagree — silently: the module loads, `main()`
 * never runs, nothing is printed and the process exits 0. That was fixed in the
 * guard alone (review round 2-3 of #204, R2-2) and left in the eight scripts
 * beside it in the same workflow steps, `derive-release.mjs` — the very next
 * command in that `run:` block — among them. The consequence there was not a
 * crash but an ANSWER: the workflow's `jq -r .release derivation.json` read the
 * empty file as `""`, took the "no release" branch, wrote `### No release` with
 * an empty reason and exited 0. A push carrying content was skipped behind a
 * green run.
 *
 * WHY A TABLE AND NOT ONE TEST. The defect was in nine files because it was
 * written once per file; a fix proven in one of them is what left the other
 * eight broken. `scripts/entry-point.mjs` is now the single implementation, and
 * this suite pins that every script goes through it, by exercising each script's
 * real CLI.
 *
 * WHY THE PHYSICAL HALF IS ASSERTED TOO. A test that only compared the two
 * spellings would pass if BOTH were silent no-ops — the same "passes for the
 * wrong reason" shape review round 3 caught in `release-push-guard.test.mjs`.
 * Each case therefore pins what the physical invocation actually does (its exit
 * status, and the line only that script prints), and then requires the symlinked
 * invocation to agree with it exactly.
 *
 * THE ENVIRONMENT IS HERMETIC. `gh` is stubbed on `PATH` with a fixed release
 * list and no network, the token variables are removed so no case can quietly
 * reach the API, and every case runs in a throwaway directory. Nothing here
 * reads, writes or dispatches anything.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** The shipped directory, resolved to the module loader's own (physical) URL. */
const SCRIPTS = dirname(fileURLToPath(new URL("./entry-point.mjs", import.meta.url)));

/** A `package.json` shaped like this repository's: tab-indented, one version line. */
const packageJson = (version) =>
	`{\n\t"name": "local-operator-ui",\n\t"version": "${version}",\n\t"private": true\n}\n`;

/** The release list `gh` answers with. `v0.24.0` is the newest plain release and
 * carries an arm64 archive, so it is both the version anchor (what has been
 * spent) and the incumbent (what a user could be running). */
const RELEASES = [
	{
		tag_name: "v0.24.0",
		prerelease: false,
		draft: false,
		published_at: "2026-09-15T00:00:00Z",
		assets: [
			{ name: "local-operator-ui-0.24.0-arm64.zip" },
			{ name: "local-operator-ui-0.24.0-x64.zip" },
		],
	},
];

/**
 * A stub `gh` that answers the releases page and FAILS everything else.
 *
 * Failing rather than returning an empty list is deliberate: a case that reached
 * an endpoint this stub does not model would otherwise be tested against a
 * silently empty answer, which is the defect class this whole file is about.
 */
function stubBin(root) {
	const bin = join(root, "stub-bin");
	mkdirSync(bin, { recursive: true });
	const gh = join(bin, "gh");
	writeFileSync(
		gh,
		[
			"#!/bin/sh",
			'case "$*" in',
			`  *repos/*/releases*) printf '%s' '${JSON.stringify(RELEASES)}' ;;`,
			"  *) echo \"stub gh: unmodelled call: gh $*\" >&2; exit 1 ;;",
			"esac",
			"",
		].join("\n"),
	);
	chmodSync(gh, 0o755);
	return bin;
}

/**
 * The environment every case runs in: this process's environment minus the
 * variables that would let a script reach a forge, with the stub `gh` first on
 * `PATH`. `GIT_*` is pinned so the operator's own git config cannot change what
 * these scratch repositories look like.
 */
function caseEnv(bin, extra = {}) {
	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: process.env.HOME,
		TMPDIR: process.env.TMPDIR,
		LANG: process.env.LANG,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Entry Point Test",
		GIT_AUTHOR_EMAIL: "entry-point@example.invalid",
		GIT_COMMITTER_NAME: "Entry Point Test",
		GIT_COMMITTER_EMAIL: "entry-point@example.invalid",
		GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
		GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
		...extra,
	};
	return env;
}

/** A scratch git repository: `v0.24.0` tagged on the released tree, then one
 * landing. `tip` is the landing's shape — a `feat:` commit, or a bump commit
 * (which has no parent content and must be read as the release commit). */
function scratchRepo(root, { tip }) {
	const dir = join(root, `repo-${tip}`);
	mkdirSync(dir, { recursive: true });
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: dir,
			encoding: "utf8",
			env: caseEnv(join(root, "unused")),
		});
	git("init", "--quiet", "-b", "main");
	writeFileSync(join(dir, "package.json"), packageJson("0.24.0"));
	writeFileSync(join(dir, "file.txt"), "one\n");
	git("add", "-A");
	git("commit", "--quiet", "-m", "chore: the released state");
	git("tag", "v0.24.0");
	if (tip === "bump") {
		writeFileSync(join(dir, "package.json"), packageJson("0.24.1"));
		git("commit", "--quiet", "-am", "chore(release): bump version to 0.24.1");
	} else {
		writeFileSync(join(dir, "file.txt"), "two\n");
		git("commit", "--quiet", "-am", "feat(panels): a real feature");
	}
	return dir;
}

/**
 * The nine scripts, and for each: an invocation that decides something without a
 * forge or a network, and what the PHYSICAL run of it does.
 *
 * The invocation matters as much as the assertion. Every one of these either
 * succeeds with a line only that script prints, or refuses in its own words —
 * both of which prove the script RAN, rather than merely that a process exited.
 */
function cases(root) {
	const featRepo = scratchRepo(root, { tip: "feat" });
	const bumpRepo = scratchRepo(root, { tip: "bump" });
	const plain = join(root, "plain");
	mkdirSync(plain, { recursive: true });
	writeFileSync(join(plain, "package.json"), packageJson("0.24.1"));
	return [
		{
			// The next command in the workflow's own `run:` block, and the one whose
			// silence was reported as `### No release` with an empty reason.
			script: "derive-release.mjs",
			args: ["--json"],
			cwd: featRepo,
			env: {},
			status: 0,
			stdout: /"release": true/,
			stderr: /^$/,
		},
		{
			// The only case that MUTATES its working directory: each spelling gets its
			// own, or the second would be tested against the first's edit.
			script: "apply-release-bump.mjs",
			args: ["--version", "9.9.9"],
			cwd: null,
			env: {},
			status: 0,
			stdout: /^package\.json version -> 9\.9\.9 \(one line changed\)$/m,
			stderr: /^$/,
		},
		{
			script: "release-baseline.mjs",
			args: ["--json"],
			cwd: plain,
			env: {},
			status: 0,
			stdout: /"tag": "v0\.24\.0"/,
			stderr: /^$/,
		},
		{
			// No token: the script refuses before it reaches the API, which is the
			// refusal the signed-update workflow depends on.
			script: "release-candidate.mjs",
			args: ["--release-tag", "v0.24.0"],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /^$/,
			stderr: /GH_TOKEN is required to resolve the tag/,
		},
		{
			script: "release-state.mjs",
			args: ["open"],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /^$/,
			stderr: /RELEASE_TAG must match vX\.Y\.Z/,
		},
		{
			script: "upload-release.mjs",
			args: [],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /^$/,
			stderr: /RELEASE_TAG must match vX\.Y\.Z/,
		},
		{
			script: "validate-release.mjs",
			args: [],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /^$/,
			stderr: /RELEASE_TAG must match vX\.Y\.Z/,
		},
		{
			// The guard the version-bump workflow runs. Its verdict lines go to stdout
			// and an unset title is refused on stderr, which is why the workflow can
			// tell "answered" from "said nothing".
			script: "version-bump-guard.mjs",
			args: [],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /^$/,
			stderr: /PR_TITLE is not set/,
		},
		{
			// The guard that was fixed alone, kept in the table so the refactor onto
			// `entry-point.mjs` is covered the same way as the eight beside it.
			script: "release-push-guard.mjs",
			args: ["--json", "--released-tag", "v0.24.0"],
			cwd: bumpRepo,
			env: {},
			status: 0,
			stdout: /"skip": true/,
			stderr: /^$/,
		},
	];
}

/** A directory holding one `package.json`, made fresh for a single invocation. */
function freshPackageDir(root) {
	const dir = mkdtempSync(join(root, "package-"));
	writeFileSync(join(dir, "package.json"), packageJson("0.24.1"));
	return dir;
}

/** Run one case's script, spelled either physically or through the symlinked
 * directory, and report everything a caller could act on. A case with no `cwd`
 * gets a fresh one, because it writes to it. */
function run(spelling, kase, bin, root) {
	let status = 0;
	let stdout = "";
	let stderr = "";
	try {
		stdout = execFileSync(process.execPath, [spelling, ...kase.args], {
			cwd: kase.cwd ?? freshPackageDir(root),
			encoding: "utf8",
			env: caseEnv(bin, kase.env),
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		status = error.status;
		stdout = error.stdout ?? "";
		stderr = error.stderr ?? "";
	}
	return { status, stdout, stderr };
}

test("every release script runs when it is reached through a symlinked path", () => {
	const root = mkdtempSync(join(tmpdir(), "release-entry-point-"));
	try {
		const bin = stubBin(root);
		const link = join(root, "linked-scripts");
		// The property the whole file rests on, asserted rather than assumed: the
		// spelling the process is handed is NOT the physical path. A real directory
		// here would make every case below exercise nothing while still passing.
		symlinkSync(SCRIPTS, link);
		assert.notEqual(
			realpathSync(link),
			link,
			"the symlinked spelling must differ from the physical path",
		);

		for (const kase of cases(root)) {
			const physical = run(join(SCRIPTS, kase.script), kase, bin, root);
			// The physical half first: without it, two silent no-ops would compare equal.
			assert.equal(
				physical.status,
				kase.status,
				`${kase.script}: physical invocation exited ${physical.status}, expected ${kase.status}\n${physical.stderr}`,
			);
			assert.match(physical.stdout, kase.stdout, kase.script);
			assert.match(physical.stderr, kase.stderr, kase.script);

			const linked = run(join(link, kase.script), kase, bin, root);
			assert.equal(
				linked.status,
				physical.status,
				`${kase.script} through a symlinked path exited ${linked.status} where the physical path exited ${physical.status}`,
			);
			assert.equal(linked.stdout, physical.stdout, kase.script);
			// The symlinked run's message is the same script refusing for the same
			// reason; only the paths inside it may differ, and none of these print one.
			assert.equal(linked.stderr, physical.stderr, kase.script);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a script this file drives produces its answer, not a silent zero", () => {
	// The defect's signature is exit 0 with NO output, and the table above is only
	// meaningful while that signature remains impossible for a script that ran. So
	// the property is asserted directly as well: for a case whose physical run
	// succeeds, the answer is non-empty. A future edit that made one of these
	// scripts no-op while still exiting 0 — the shape nine of these files had — fails
	// here as well as in the table, on the half that does not depend on a symlink.
	const root = mkdtempSync(join(tmpdir(), "release-entry-point-signature-"));
	try {
		const bin = stubBin(root);
		for (const kase of cases(root)) {
			const physical = run(join(SCRIPTS, kase.script), kase, bin, root);
			assert.ok(
				physical.status !== 0 || physical.stdout !== "" || physical.stderr !== "",
				`${kase.script} exited 0 and said nothing, which is indistinguishable from not having run`,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
