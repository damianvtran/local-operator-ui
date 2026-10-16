import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * NEGATIVE CONTROLS for the merge-time union-parity tool.
 *
 * A check that cannot fail on the states it exists to refuse is decoration,
 * so this suite builds a synthetic scratch repo (never the real branch, no
 * network) holding the exact three versions the tool compares, then requires:
 * (a) a correct disjoint hand-union -> exit 0; (b) the `--ours` outcome (PR
 * keys dropped) -> exit 1, keys named; (c) the `--theirs` outcome (base keys
 * lost) -> exit 1, keys named; (d) a value changed for a shared key -> exit 1.
 *
 * DISCRIMINATION PROOF: (a) fails if the tool is absent or fails everything;
 * (b)-(d) fail if it is sabotaged to pass everything. The last case makes that
 * explicit: a sabotaged always-pass wrapper and the real tool must DISAGREE
 * on the same (b) fixture commits.
 */

const TOOL = join(
	dirname(fileURLToPath(import.meta.url)),
	"catalogue-union-parity.mjs",
);
const CATALOGUE = "src/i18n/catalogues/en/ui.common.actions.json";
const CONTEXT = "src/i18n/catalogues/en/ui.common.actions.context.json";

/* Isolated git: no system config (this machine's system gitconfig carries a
 * keychain credential helper a scratch run must never reach), no prompt. */
/* NODE_TEST_CONTEXT is dropped by construction, not assignment: an inherited
 * copy makes a nested `node --test` exit 0 without running (AGENTS.md). */
const { NODE_TEST_CONTEXT: _dropped, ...inheritedEnv } = process.env;
const GIT_ENV = {
	...inheritedEnv,
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
};

function git(repo, ...args) {
	const r = spawnSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		env: GIT_ENV,
	});
	assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout.trim();
}

function commit(repo, files, message) {
	for (const [path, value] of Object.entries(files)) {
		const full = join(repo, path);
		spawnSync("mkdir", ["-p", dirname(full)]);
		writeFileSync(full, `${JSON.stringify(value, null, "\t")}\n`);
	}
	git(repo, "add", ".");
	git(
		repo,
		"-c",
		"user.name=Parity Test",
		"-c",
		"user.email=parity@test.invalid",
		"commit",
		"-q",
		"-m",
		message,
	);
	return git(repo, "rev-parse", "HEAD");
}

/* Base and PR each create the same files with disjoint keys plus one shared
 * key; `merged` hand-unions both sides on top of base. */
function buildRepo() {
	const dir = mkdtempSync(join(tmpdir(), "i18n-union-parity-"));
	git(dir, "init", "-q", "-b", "main");
	const root = commit(dir, { "README.md": {} }, "root");
	git(dir, "checkout", "-q", "-b", "base-side");
	const base = commit(
		dir,
		{
			[CATALOGUE]: {
				"ui.common.actions.save": "Save",
				"ui.common.actions.cancel": "Cancel",
				"ui.common.actions.shared": "Shared",
			},
			[CONTEXT]: { "ui.common.actions.save": { role: "verb" } },
		},
		"base creates catalogue",
	);
	git(dir, "checkout", "-q", "-b", "pr-side", root);
	const pr = commit(
		dir,
		{
			[CATALOGUE]: {
				"ui.common.actions.delete": "Delete",
				"ui.common.actions.rename": "Rename",
				"ui.common.actions.shared": "Shared",
			},
			[CONTEXT]: { "ui.common.actions.delete": { role: "verb" } },
		},
		"pr creates catalogue",
	);
	git(dir, "checkout", "-q", "base-side");
	const merged = commit(
		dir,
		{
			[CATALOGUE]: {
				"ui.common.actions.save": "Save",
				"ui.common.actions.cancel": "Cancel",
				"ui.common.actions.delete": "Delete",
				"ui.common.actions.rename": "Rename",
				"ui.common.actions.shared": "Shared",
			},
			[CONTEXT]: {
				"ui.common.actions.save": { role: "verb" },
				"ui.common.actions.delete": { role: "verb" },
			},
		},
		"hand union",
	);
	return { dir, base, pr, merged };
}

function runParity(repo, extraArgs, tool = TOOL) {
	const head = extraArgs.includes("--head") ? [] : ["--head", repo.merged];
	const r = spawnSync(
		process.execPath,
		[
			tool,
			"--repo",
			repo.dir,
			"--pr",
			"1234",
			...head,
			"--old-head",
			repo.pr,
			"--base",
			repo.base,
			...extraArgs,
		],
		{ encoding: "utf8", env: GIT_ENV },
	);
	return r;
}

const repo = buildRepo();
test.after(() => rmSync(repo.dir, { recursive: true, force: true }));
const BOTH_FILES = ["--file", CATALOGUE, "--file", CONTEXT];

/* Hoisted matchers (biome useTopLevelRegex): the counts the CLI prints. */
const BASE_KEYS_3 = /base\s+keys : 3/;
const PR_KEYS_3 = /PR\s+keys : 3/;
const MERGED_KEYS_5 = /merged keys : 5/;
const UNION_KEYS_5 = /union\s+keys : 5/;
const RESULT_PASS = /RESULT: PASS/;
const USAGE_ERROR = /catalogue-union-parity:/;

test("(a) correct disjoint union passes, counts printed per side", () => {
	const run = runParity(repo, BOTH_FILES);
	assert.equal(run.status, 0, run.stdout + run.stderr);
	assert.match(run.stdout, BASE_KEYS_3);
	assert.match(run.stdout, PR_KEYS_3);
	assert.match(run.stdout, MERGED_KEYS_5);
	assert.match(run.stdout, UNION_KEYS_5);
	assert.match(run.stdout, RESULT_PASS);
});

test("(a-json) --json reports the same counts machine-readably", () => {
	const run = runParity(repo, [...BOTH_FILES, "--json"]);
	assert.equal(run.status, 0, run.stderr);
	const parsed = JSON.parse(run.stdout);
	assert.equal(parsed.ok, true);
	assert.equal(parsed.files[0].unionCount, 5);
	assert.equal(parsed.files[1].mergedCount, 2);
	assert.deepEqual(parsed.files[0].missingFromPr, []);
});

test("(b) --ours outcome (PR keys dropped) fails and names them", () => {
	const run = runParity(repo, [...BOTH_FILES, "--head", repo.base, "--json"]);
	assert.equal(run.status, 1, run.stdout);
	const parsed = JSON.parse(run.stdout);
	assert.deepEqual(parsed.files[0].missingFromPr, [
		"ui.common.actions.delete",
		"ui.common.actions.rename",
	]);
	assert.deepEqual(parsed.files[0].missingFromBase, []);
});

test("(c) --theirs outcome (base keys dropped) fails and names them", () => {
	const run = runParity(repo, [...BOTH_FILES, "--head", repo.pr, "--json"]);
	assert.equal(run.status, 1, run.stdout);
	const parsed = JSON.parse(run.stdout);
	assert.deepEqual(parsed.files[0].missingFromBase, [
		"ui.common.actions.cancel",
		"ui.common.actions.save",
	]);
	assert.deepEqual(parsed.files[0].missingFromPr, []);
});

test("(d) a value changed for a shared key fails and names it", () => {
	git(repo.dir, "checkout", "-q", "base-side");
	const changed = commit(
		repo.dir,
		{
			[CATALOGUE]: {
				"ui.common.actions.save": "Save",
				"ui.common.actions.cancel": "Cancel",
				"ui.common.actions.delete": "Delete",
				"ui.common.actions.rename": "Rename",
				"ui.common.actions.shared": "CHANGED",
			},
		},
		"union with changed shared value",
	);
	const run = runParity(repo, [
		"--file",
		CATALOGUE,
		"--head",
		changed,
		"--json",
	]);
	assert.equal(run.status, 1, run.stdout);
	const parsed = JSON.parse(run.stdout);
	assert.deepEqual(parsed.files[0].valueDifferences, [
		{ key: "ui.common.actions.shared", differsFrom: ["base", "pr"] },
	]);
	assert.deepEqual(parsed.files[0].missingFromBase, []);
	assert.deepEqual(parsed.files[0].missingFromPr, []);
});

test("sabotage proof: an always-pass wrapper disagrees with the real tool on (b)", () => {
	const sabotaged = join(repo.dir, "sabotaged.mjs");
	writeFileSync(
		sabotaged,
		[
			`import { checkUnionParity } from ${JSON.stringify(pathToFileURL(TOOL).href)};`,
			"checkUnionParity({ repo: process.argv[2], head: process.argv[3], oldHead: process.argv[4], base: process.argv[5], files: [process.argv[6]] });",
			"process.exit(0); // SABOTAGED: parity result ignored, always passes",
			"",
		].join("\n"),
	);
	const args = [repo.dir, repo.base, repo.pr, repo.base, CATALOGUE];
	const sabotagedRun = spawnSync(process.execPath, [sabotaged, ...args], {
		encoding: "utf8",
		env: GIT_ENV,
	});
	const realRun = runParity(repo, ["--file", CATALOGUE, "--head", repo.base]);
	assert.equal(sabotagedRun.status, 0, sabotagedRun.stderr);
	assert.equal(realRun.status, 1, realRun.stdout);
	assert.notEqual(realRun.status, sabotagedRun.status);
});

test("an unresolvable ref is a usage error (exit 2), never a silent pass", () => {
	const run = runParity(repo, [
		"--file",
		CATALOGUE,
		"--head",
		"0000000000000000000000000000000000000000",
	]);
	assert.equal(run.status, 2, run.stdout + run.stderr);
	assert.match(run.stderr, USAGE_ERROR);
});

test("a catalogue absent at every ref reads as empty on all sides", () => {
	const run = runParity(repo, [
		"--file",
		"src/i18n/catalogues/en/ui.never.existed.json",
		"--json",
	]);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(JSON.parse(run.stdout).files[0].mergedCount, 0);
});
