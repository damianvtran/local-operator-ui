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
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
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
 * The scripts this file drives, and for each: an invocation that decides something
 * without a forge or a network, and what the PHYSICAL run of it does.
 *
 * The invocation matters as much as the assertion. Every one of these either
 * succeeds with a line only that script prints, or refuses in its own words —
 * both of which prove the script RAN, rather than merely that a process exited.
 *
 * The last four are the gates a WORKFLOW runs with nothing but an exit status to
 * read, which is why they are here rather than only in the release tables: QA
 * reproduced a genuinely failing gate becoming a passing one by reaching
 * `check-packaged-closure.mjs` and `verify-macos-artifacts.mjs` through a symlinked
 * spelling, and `ci.yml`'s Runtime Dependencies job read `check-runtime-deps.mjs`'s
 * silence the same way. `scripts/require-report.sh` now refuses that shape in the
 * steps themselves; this table is what proves the scripts can no longer produce it.
 */
function cases(root) {
	const featRepo = scratchRepo(root, { tip: "feat" });
	const bumpRepo = scratchRepo(root, { tip: "bump" });
	const plain = join(root, "plain");
	mkdirSync(plain, { recursive: true });
	writeFileSync(join(plain, "package.json"), packageJson("0.24.1"));
	// An empty build output: what a gate sees when the packaging step that should
	// have filled `dist` did not run. Each of the three build gates below must refuse
	// it rather than report success over an artifact set that is not there.
	const emptyDist = join(root, "empty-dist");
	mkdirSync(emptyDist, { recursive: true });
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
			// The published gate the guard was fixed alone in #204 for: kept in the table
			// so the refactor onto `entry-point.mjs` is covered the same way as the eight
			// beside it.
			script: "release-push-guard.mjs",
			args: ["--json", "--released-tag", "v0.24.0"],
			cwd: bumpRepo,
			env: {},
			status: 0,
			stdout: /"skip": true/,
			stderr: /^$/,
		},
		{
			// `publish.yml` runs this three times and `signed-update-candidate.yml`
			// once, over the artifact set the build produced; an empty `dist` is the
			// refusal every one of those steps must see rather than a silent pass.
			script: "check-packaged-closure.mjs",
			args: ["--dist", emptyDist],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /^$/,
			stderr: /no app\.asar under/,
		},
		{
			// The same gate over the same empty output: `publish.yml` and
			// `signed-update-candidate.yml` both call it through `pnpm
			// verify-macos-artifacts`, whose consumer is the exit status.
			script: "verify-macos-artifacts.mjs",
			args: ["--dist", emptyDist],
			cwd: plain,
			env: {},
			status: 1,
			stdout: /No packaged app found under/,
			stderr: /^$/,
		},
		{
			// `pnpm notarize-dmg` in both release workflows. On a macOS runner with no
			// `NOTARIZE=true` and no `.env.build` it skips loudly, which is the line
			// that keeps `require-report.sh` from reading a skip as a silence; on the
			// Linux runner this file's contract step uses, it skips for not being macOS.
			// Either way it ANSWERS, which is the property this table is about.
			script: "notarize-artifacts.mjs",
			args: ["--dist", emptyDist],
			cwd: plain,
			env: {},
			status: 0,
			stdout: /Skipping disk image notarization/,
			stderr: /^$/,
		},
		{
			// `ci.yml`'s Runtime Dependencies job. Reads this repository's own manifest
			// through an absolute path derived from its module URL, so the answer is the
			// allowlist summary whatever the working directory is.
			script: "check-runtime-deps.mjs",
			args: [],
			cwd: plain,
			env: {},
			status: 0,
			stdout: /production dependencies, all on the runtime allowlist/,
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

test("a script reached through a symlinked NAME answers too, not just a symlinked directory", () => {
	// The other spelling of the same defect, and the one the table above does not
	// cover: `ln -s scripts/check-runtime-deps.mjs /tmp/alias.mjs && node
	// /tmp/alias.mjs`. Node loads the module through its REAL path while
	// `process.argv[1]` is the alias, so a lexical comparison disagrees for the same
	// reason a symlinked directory makes it disagree — measured on the commit this
	// branch starts from: exit 0, no output, against 610 bytes of allowlist summary
	// when the same script is reached by its own name.
	const root = mkdtempSync(join(tmpdir(), "release-entry-point-alias-"));
	try {
		const bin = stubBin(root);
		const target = join(SCRIPTS, "check-runtime-deps.mjs");
		const alias = join(root, "aliased-check-runtime-deps.mjs");
		symlinkSync(target, alias);
		assert.equal(
			lstatSync(alias).isSymbolicLink(),
			true,
			"the fixture has to be a symlink, or this case exercises nothing",
		);
		const kase = { script: "check-runtime-deps.mjs", args: [], cwd: root, env: {} };
		const byName = run(target, kase, bin, root);
		const byAlias = run(alias, kase, bin, root);
		assert.match(
			byAlias.stdout,
			/production dependencies, all on the runtime allowlist/,
			"the aliased invocation has to produce the script's own answer",
		);
		assert.equal(byAlias.status, byName.status);
		assert.equal(byAlias.stdout, byName.stdout);
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

// ---------------------------------------------------------------------------
// The class, rather than the instances
// ---------------------------------------------------------------------------

/** A script's lines with its comment-only lines dropped.
 *
 * WHY SUITES AND COMMENTS ARE OUT OF SCOPE. A `*.test.mjs` file is not a gate: no
 * consumer reads its exit status as a verdict, and a suite has to be able to NAME
 * the comparison it is about (this is the second one that does). So the scan covers
 * the scripts a consumer runs, and, inside those, only code: the suites that
 * describe this defect quote the old comparison in prose, and so does
 * `entry-point.mjs` itself (`WHY NOT \`import.meta.url === pathToFileURL(process.argv[1]).href\``)
 * along with the two scripts whose guards now name the spelling they moved away
 * from. A rule that could not tell a quotation from a comparison would be turned
 * off the first time somebody wrote about it; the cost is that a comment naming the
 * comparison has to sit on its own line, which is where the prose in these files
 * keeps it. */
function codeLines(source) {
	return source
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line !== "" &&
				!line.startsWith("//") &&
				!line.startsWith("*") &&
				!line.startsWith("/*"),
		);
}

/** Every `scripts/*.mjs` a checked-in workflow invokes... */
const INVOCATION = /\bnode\s+(?:[\w./-]*\/)?scripts\/([\w.-]+\.m?js)/g;
const WORKFLOWS = join(SCRIPTS, "..", ".github", "workflows");

/**
 * The scripts the workflows actually run, direct or one hop away.
 *
 * WHY ONE HOP. `publish.yml` runs `pnpm verify-macos-artifacts` and
 * `pnpm notarize-dmg`, which are `node scripts/...` in `package.json` — a scan of
 * the workflow text alone would not see the two scripts that carry the release's
 * artifact gate, which is exactly the pair QA reproduced a failing-to-passing flip
 * in. WHY A TEXT SCAN AND NOT A YAML PARSE. The property being asserted is "this
 * name is here and the script behind it is covered"; a parse would be the better
 * tool if the list were the product, and it is not (see
 * `scripts/verify-signed-update.mjs`, which the checked-out payload supplies).
 */
function workflowInvokedScripts() {
	const scripts = new Set();
	const pnpmScripts = new Set();
	for (const file of readdirSync(WORKFLOWS).sort()) {
		if (!/\.ya?ml$/.test(file)) continue;
		const text = readFileSync(join(WORKFLOWS, file), "utf8");
		for (const match of text.matchAll(INVOCATION)) scripts.add(match[1]);
		for (const match of text.matchAll(/\bpnpm\s+([\w:.-]+)/g))
			pnpmScripts.add(match[1]);
	}
	const pkg = JSON.parse(readFileSync(join(SCRIPTS, "..", "package.json"), "utf8"));
	for (const name of pnpmScripts) {
		const body = pkg.scripts?.[name];
		if (typeof body !== "string") continue;
		for (const match of body.matchAll(INVOCATION)) scripts.add(match[1]);
	}
	return [...scripts].sort();
}

/**
 * A workflow-invoked script that carries no entry-point comparison at all, and
 * therefore cannot take the silent-zero shape: it runs at import. Every entry is
 * asserted below to be exactly that, so this list cannot become a place to hide.
 */
const NO_ENTRY_POINT_COMPARISON = {
	"check-edit-diffs.mjs": "`pnpm check-edit-diffs`; runs at import, and exits on its own result",
	"npx-smoke-test.mjs": "`ci.yml`'s npx smoke test; runs at import",
	"run-desktop-tests.mjs": "`pnpm test:desktop`'s runner; runs at import",
	"verify-signed-update.mjs": "`signed-update-candidate.yml`; runs at import",
};

test("no script anywhere resolves its own entry point by anything but the shared helper", () => {
	// The rule that would have caught this class in one pass instead of one script
	// per round: the comparison lives in `entry-point.mjs` or nowhere. A script whose
	// top level runs unconditionally is fine — it has no comparison to get wrong —
	// and this says nothing about it; a script that compares `process.argv[1]`
	// itself, in any of the four spellings this repository has now written, fails
	// here. That is how `release-push-guard.mjs`, then the eight beside it, then
	// three more, then four more were each found separately.
	const offenders = readdirSync(SCRIPTS)
		.sort()
		.filter((name) => /\.m?js$/.test(name) && name !== "entry-point.mjs")
		.filter((name) => !name.endsWith(".test.mjs") && !name.startsWith("test-"))
		.filter((name) =>
			codeLines(readFileSync(join(SCRIPTS, name), "utf8")).some((line) =>
				line.includes("process.argv[1]"),
			),
		);
	assert.deepEqual(
		offenders,
		[],
		`these scripts resolve their own entry point instead of using scripts/entry-point.mjs: ${offenders.join(", ")}`,
	);
});

test("every script a workflow invokes is driven here, or says why it needs no entry-point", () => {
	// The enumeration that used to have to be rebuilt by hand every round, asserted
	// rather than described: a workflow-invoked script is either one of the cases
	// above (driven through BOTH spellings, with its physical answer pinned) or named
	// in `NO_ENTRY_POINT_COMPARISON` with a reason. A new workflow that reaches a new
	// script fails here until somebody answers that question for it — which is the
	// point, because "found one script at a time for three rounds" is the history this
	// file exists to end.
	const root = mkdtempSync(join(tmpdir(), "release-entry-point-roster-"));
	const driven = new Set();
	const covered = [];
	const unaccounted = [];
	try {
		for (const kase of cases(root)) driven.add(kase.script);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	for (const script of workflowInvokedScripts()) {
		// A `node --test` file is a suite, not a gate: it has no CLI to resolve and
		// no verdict to print, and the rule above already covers its source.
		const isSuite = script.endsWith(".test.mjs") || script.startsWith("test-");
		if (driven.has(script) || isSuite) covered.push(script);
		else if (script in NO_ENTRY_POINT_COMPARISON) covered.push(script);
		else unaccounted.push(script);
	}
	assert.ok(
		covered.length >= 10,
		`only ${covered.length} workflow-invoked scripts found; the scan has stopped seeing them`,
	);
	assert.deepEqual(
		unaccounted,
		[],
		`workflow-invoked, not driven by this file's table and not a script that runs at import: ${unaccounted.join(", ")} — add a case above, or an entry in NO_ENTRY_POINT_COMPARISON with the reason`,
	);
	// The exemption list is only an exemption while it is true: each named script
	// must genuinely carry no entry-point comparison of its own.
	for (const name of Object.keys(NO_ENTRY_POINT_COMPARISON)) {
		assert.ok(
			readdirSync(SCRIPTS).includes(name),
			`${name} is exempt in this file but no longer exists`,
		);
		assert.ok(
			!codeLines(readFileSync(join(SCRIPTS, name), "utf8")).some((line) =>
				line.includes("process.argv[1]"),
			),
			`${name} is exempt here as a script with nothing to resolve, but it compares process.argv[1] itself`,
		);
	}
});
