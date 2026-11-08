#!/usr/bin/env node
/**
 * The clean-view runner is only worth having if its verdict comes from the
 * COMMIT. This file is the proof, and it is written the way the two incidents
 * that motivated the runner actually happened:
 *
 *   1. a ledger row citing a receipt that existed only as an untracked file in
 *      one worktree - green locally, red on a clean checkout and in CI;
 *   2. an untracked test probe swept into a commit - two required checks red.
 *
 * Both are "green because the worktree was dirty in the helpful direction", so
 * every case below builds a THROWAWAY GIT REPO and asks two questions about the
 * same dirty tree:
 *
 *   - the gate run DIRECTLY in the worktree sees the stray file and answers for
 *     the worktree, which is the wrong answer for a clean checkout;
 *   - `check-clean-view.mjs` exports HEAD and answers PASS, because the stray
 *     file was never committed.
 *
 * The negative control commits the same file: the clean-view run must then FAIL,
 * which is what makes the passing case evidence rather than a runner that is
 * simply always green. A runner that only ever said PASS would satisfy every
 * other assertion in this repo and none of the ones that matter.
 *
 * The fixture is minimal but REAL where it counts: it copies this repo's actual
 * gate scripts (stubbing their inputs, not their logic), its actual `.gitignore`,
 * and symlinks the installed `node_modules` so the gates build a TypeScript
 * program the way they do in CI. What it does not carry is this checkout's
 * source, which is why nothing here can pass accidentally.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	EXPORT_PATHS,
	GATES,
	cleanGitEnv,
	exportHead,
	formatReport,
	parseRefs,
	resolveCommit,
	runCleanView,
} from "./check-clean-view.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRATCH = mkdtempSync(join(tmpdir(), "i18n-clean-view-"));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
/* Top level, not inline at each assertion: the repo's biome config asks for it,
 * and a constant names what the assertion is looking for. */
const EXPORT_LINE_RE = /HEAD export/;
const GATE_NAME_RE = /check-added-strings\.mjs/;
const NOT_WORKTREE_RE = /HEAD EXPORT, not on the working tree/;
const BASE_FAILURE_RE = /no-such-ref|git /;
const PRINTED_NOTHING_RE = /printed nothing/;

/* The modules the three gates import, plus the gates themselves. Copied rather
 * than re-implemented: the runner's job is to prove the REAL gates, and a stub
 * gate would prove a stub. */
const GATE_MODULES = [
	"check-added-strings.mjs",
	"check-coverage.mjs",
	"check-strings.mjs",
	"ledger-check.mjs",
	"ledger-rules.mjs",
];

const STRAY_SOURCE =
	'export const s = <b title={x && "Stray local copy"} />;\n';
const STRAY_PATH = join("src", "renderer", "src", "stray.tsx");

after(() => {
	rmSync(SCRATCH, { recursive: true, force: true });
});

/* An inherited GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE aims a fixture's git at the
 * caller's repository or index; a guard reading the wrong index passes silently
 * and a fixture committed into the wrong repo is worse. Every spawn below passes
 * this env, never `process.env`. */
function gitEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
}

function git(dir, ...args) {
	const result = spawnSync("git", args, {
		cwd: dir,
		env: gitEnv(),
		encoding: "utf8",
	});
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

/**
 * A throwaway git repo that the three gates can actually run in.
 *
 * Every input the gates refuse to go without is present: a `supported` locale
 * (the coverage gate will not report success against a manifest with no target
 * language), its ledger row and audit receipt (the ledger gate will not ship an
 * unclaimed catalogue), and both tsconfigs (the added-copy guard opens them).
 * The fixture is small because the gates decide on evidence, not on size -
 * `pairs: []` matches the shape the real `i18n/coverage-allowance.json` carries
 * today, and the pair is complete, so no allowance is owed.
 */
function fixture() {
	const dir = realpathSync(mkdtempSync(join(SCRATCH, "fixture-")));
	mkdirSync(join(dir, "src", "renderer", "src"), { recursive: true });
	mkdirSync(join(dir, "src", "i18n", "catalogues", "en"), { recursive: true });
	mkdirSync(join(dir, "src", "i18n", "catalogues", "fr"), { recursive: true });
	mkdirSync(join(dir, "scripts", "i18n"), { recursive: true });
	mkdirSync(join(dir, "i18n"), { recursive: true });

	for (const name of GATE_MODULES) {
		copyFileSync(
			join(REPO, "scripts/i18n", name),
			join(dir, "scripts/i18n", name),
		);
	}
	// `openSnapshot` opens both projects; each must include `src` so a changed
	// file is inside a program, exactly as in the real checkout.
	for (const name of ["tsconfig.app.json", "tsconfig.node.json"]) {
		writeFileSync(
			join(dir, name),
			JSON.stringify({
				compilerOptions: { jsx: "preserve" },
				include: ["src"],
			}),
		);
	}
	writeFileSync(join(dir, "i18n", "allowlist.json"), '{"entries":[]}\n');
	writeFileSync(
		join(dir, "i18n", "languages.json"),
		`${JSON.stringify(
			{
				schema: 1,
				note: "clean-view fixture",
				languages: [
					{
						code: "en",
						native: "English",
						english: "English",
						dir: "ltr",
						status: "source",
					},
					{
						code: "fr",
						native: "Français",
						english: "French",
						dir: "ltr",
						status: "supported",
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(
		join(dir, "i18n", "coverage-allowance.json"),
		`${JSON.stringify({ schema: 1, note: "clean-view fixture", pairs: [] }, null, 2)}\n`,
	);

	/* One locale pair, COMPLETE and correctly audited.
	 *
	 * `check-coverage` refuses a manifest with no `supported` language outright
	 * ("a gate with no target language has nothing to compare"), and
	 * `ledger-check` refuses a shipped catalogue with no ledger row, so a fixture
	 * with only `en` cannot make either gate PASS and the passing case below
	 * would be untestable. Both are satisfied the way this repo satisfies them -
	 * identical key sets, hashes that still describe the files, an independent
	 * audit and the receipt bytes that audit cites. Mirrors the fixture in
	 * `ledger-check.test.mjs`. */
	const enText = `${JSON.stringify({ "ui.probe.title": "Committed surface" }, null, 2)}\n`;
	const frText = `${JSON.stringify({ "ui.probe.title": "Surface validée" }, null, 2)}\n`;
	writeFileSync(
		join(dir, "src", "i18n", "catalogues", "en", "ui.probe.json"),
		enText,
	);
	writeFileSync(
		join(dir, "src", "i18n", "catalogues", "fr", "ui.probe.json"),
		frText,
	);
	const receipt = JSON.stringify({
		auditor: "i18n-auditor",
		instance: "audit-run-aaaa",
		model: "test",
		namespace: "ui.probe",
		status: "passed",
		sha256: { en: sha256(enText), fr: sha256(frText) },
		findings: [],
	});
	mkdirSync(join(dir, "i18n", "receipts"), { recursive: true });
	writeFileSync(join(dir, "i18n", "receipts", "audit-run-aaaa.json"), receipt);
	writeFileSync(
		join(dir, "i18n", "ledger.json"),
		`${JSON.stringify(
			{
				schema: 1,
				note: "clean-view fixture",
				entries: [
					{
						locale: "fr",
						namespace: "ui.probe",
						source_sha256: sha256(enText),
						target_sha256: sha256(frText),
						translator: {
							agent: "i18n-translator",
							model: "test",
							date: "2026-10-13",
						},
						auditors: [
							{
								agent: "i18n-auditor",
								model: "test",
								date: "2026-10-13",
								result: "clean",
								instance: "audit-run-aaaa",
								findings: { blocker: 0, major: 0, minor: 0, nit: 0 },
								receipt: "i18n/receipts/audit-run-aaaa.json",
								receipt_sha256: sha256(receipt),
							},
						],
						status: "audited",
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(
		join(dir, "src", "renderer", "src", "a.tsx"),
		"export const a = 1;\n",
	);
	/* The real ignore rules, copied: `git ls-files --others --exclude-standard`
	 * is the added-copy guard's untracked semantics, so an ignore rule that hides
	 * a stray file has to fail here rather than in a CI shard. */
	copyFileSync(join(REPO, ".gitignore"), join(dir, ".gitignore"));
	/* The gates import `typescript`; a clean checkout has dependencies installed
	 * (CI runs `pnpm install --frozen-lockfile` first), so the fixture links the
	 * one install this machine already has instead of duplicating it. */
	const installed = join(REPO, "node_modules");
	if (existsSync(installed))
		symlinkSync(installed, join(dir, "node_modules"), "dir");

	git(dir, "init", "-q");
	git(dir, "add", ".");
	git(
		dir,
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"init",
	);
	return { dir, base: git(dir, "rev-parse", "HEAD") };
}

/* Unlink the shared-install symlink FIRST and by name: the operator's
 * `node_modules` must never be something a recursive cleanup decides about. */
function removeFixture(dir) {
	const modules = join(dir, "node_modules");
	if (existsSync(modules)) rmSync(modules, { force: true });
	rmSync(dir, { recursive: true, force: true });
}

/** Run the real added-copy gate directly in the fixture's dirty worktree. */
function runGateInWorktree(dir, base) {
	const result = spawnSync(
		process.execPath,
		[
			join(dir, "scripts", "i18n", "check-added-strings.mjs"),
			"--repo",
			dir,
			"--base",
			base,
		],
		{ cwd: dir, env: gitEnv(), encoding: "utf8" },
	);
	return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

function cleanView(dir, base) {
	/* `tmpRoot` keeps the export inside this file's scratch root, so a killed run
	 * leaves its debris where the `after` above reclaims it. */
	return runCleanView({
		repo: dir,
		base,
		allowanceBase: base,
		tmpRoot: SCRATCH,
	});
}

/**
 * The export surface is asserted, not trusted. `SCAN_ROOTS` is
 * `["src", "scripts/i18n"]`, so narrowing this list to `src/i18n` would make the
 * added-copy guard see every `src/renderer` change as a deletion,
 * `--diff-filter=ACMR` would drop them, and the gate would pass on a branch full
 * of hardcoded copy - a gate in name only, which is the failure this whole file
 * exists to prevent.
 */
test("the export surface covers every root the gates read", () => {
	assert.ok(
		EXPORT_PATHS.includes("src"),
		"src is a SCAN_ROOT, not just src/i18n",
	);
	assert.ok(EXPORT_PATHS.includes("scripts/i18n"));
	assert.ok(EXPORT_PATHS.includes("i18n"));
	for (const name of ["tsconfig.app.json", "tsconfig.node.json"]) {
		assert.ok(
			EXPORT_PATHS.includes(name),
			`${name} is what openSnapshot opens; without it the guard cannot build a program`,
		);
	}
});

test("an untracked stray file flips the direct run and cannot flip the clean view", () => {
	const { dir, base } = fixture();
	try {
		writeFileSync(join(dir, STRAY_PATH), STRAY_SOURCE);

		/* The wrong answer first: run in the worktree, the gate charges the stray
		 * file as newly added copy. That is exactly what a developer would see and
		 * exactly what a clean checkout would NOT see. */
		const direct = runGateInWorktree(dir, base);
		assert.equal(
			direct.code,
			1,
			`the direct run must see the untracked stray file:\n${direct.output}`,
		);
		assert.ok(direct.output.includes("Stray local copy"), direct.output);

		/* The committed answer: the export carries HEAD, where the file does not
		 * exist, so every gate passes. */
		const result = cleanView(dir, base);
		const report = formatReport(result);
		const failures = result.gates
			.filter((gate) => gate.code !== 0)
			.map(
				(gate) =>
					`${gate.name} (exit ${gate.code})\n${gate.stdout}${gate.stderr}`,
			);
		assert.deepEqual(
			failures,
			[],
			`the clean-view run must return the committed answer, not the worktree's:\n${failures.join("\n")}`,
		);
		assert.equal(report.code, 0);
		assert.match(report.standard[0], EXPORT_LINE_RE);
		assert.ok(
			report.standard.some((line) => line.includes("not on the working tree")),
			"the run must say which tree it answered for",
		);
	} finally {
		removeFixture(dir);
	}
});

test("committing the same file makes the clean-view run fail (negative control)", () => {
	const { dir, base } = fixture();
	try {
		writeFileSync(join(dir, STRAY_PATH), STRAY_SOURCE);
		git(dir, "add", "--", STRAY_PATH);
		git(
			dir,
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"-qm",
			"stray",
		);

		/* Same file, same bytes, same runner: the only difference from the case
		 * above is that the commit now contains it. Without this control a runner
		 * that always printed PASS would satisfy the passing case. */
		const result = cleanView(dir, base);
		const report = formatReport(result);
		const added = result.gates.find(
			(gate) => gate.name === "check-added-strings.mjs",
		);
		assert.ok(added, "the added-copy gate must have run");
		assert.equal(
			added.code,
			1,
			`a committed stray file must fail the export run:\n${added.stdout}${added.stderr}`,
		);
		assert.ok(
			`${added.stdout}${added.stderr}`.includes("Stray local copy"),
			"the failure must name the committed literal",
		);
		assert.equal(report.code, 1);
		/* Which gate failed, and that the verdict came from the export - both are
		 * required output, because a reader told the wrong tree investigates the
		 * wrong tree. */
		const failure = report.error.join("\n");
		assert.match(failure, GATE_NAME_RE);
		assert.match(failure, NOT_WORKTREE_RE);
	} finally {
		removeFixture(dir);
	}
});

test("an unresolvable base ref is refused instead of reported as a pass", () => {
	/* Fail closed: `git diff <base>` against a ref that does not exist would
	 * either throw or, worse, compare against nothing and report a clean run. */
	const { dir } = fixture();
	try {
		const result = runCleanView({ repo: dir, base: "no-such-ref" });
		/* The runner cannot resolve the ref and must not claim a verdict. It either
		 * throws from git or reports a failed gate - never code 0. */
		assert.notEqual(formatReport(result).code, 0);
	} catch (error) {
		assert.match(String(error.message), BASE_FAILURE_RE);
	} finally {
		removeFixture(dir);
	}
});

/* THE RUNNER'S OWN KNOBS, pinned where they can be seen rather than inferred
 * from a passing run (review R-3, R-5, R-6, N-4). Each assertion below fails if
 * the behaviour it names is removed, which is the point: a gate whose set,
 * environment or refs can change without a red test is a gate that quietly stops
 * checking something. */
test("the gate set is pinned, so dropping one cannot leave the run green", () => {
	/* The failure this prevents: delete `check-coverage` from `GATES` and every
	 * remaining test still passes, because the runner reports whatever gates it
	 * was handed. The set is the product here. */
	assert.deepEqual(
		GATES.map((gate) => [gate.name, gate.baseFlag]),
		[
			["ledger-check.mjs", undefined],
			["check-added-strings.mjs", "--base"],
			["check-coverage.mjs", "--allowance-base"],
		],
	);
	/* `script` is what actually gets spawned, so it is pinned too rather than
	 * assumed to track `name`. */
	assert.deepEqual(
		GATES.map((gate) => gate.script),
		["ledger-check.mjs", "check-added-strings.mjs", "check-coverage.mjs"],
	);
});

test("the cleaned env drops every repository-aiming GIT_* key and keeps the rest", () => {
	/* Kept deliberately: `GIT_CONFIG_SYSTEM`/`GIT_TERMINAL_PROMPT` are how a rig
	 * keeps git away from the operator's keychain and off a prompt. Dropped
	 * deliberately: anything that can aim git at another repository, work tree,
	 * index or config — including the `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`
	 * triple, which is git's environment spelling of `-c`. */
	assert.deepEqual(
		cleanGitEnv({
			PATH: "/bin",
			GIT_DIR: "/elsewhere",
			GIT_WORK_TREE: "/elsewhere/tree",
			GIT_INDEX_FILE: "/elsewhere/index",
			GIT_CONFIG_PARAMETERS: "'core.bare=true'",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "core.worktree",
			GIT_CONFIG_VALUE_0: "/elsewhere",
			GIT_CONFIG_KEY_7: "core.bare",
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
		}),
		{ PATH: "/bin", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
	);
});

test("ref validation is aimed at this repository, not at an inherited GIT_DIR", () => {
	const saved = process.env.GIT_DIR;
	try {
		process.env.GIT_DIR = join(SCRATCH, "no-such-repo.git");
		/* Measured: with GIT_DIR inherited, `git rev-parse` exits 128 and the
		 * runner refuses a ref it can actually resolve. The cleaned env is what
		 * makes this the same answer as the checkout's HEAD. */
		assert.equal(
			resolveCommit("HEAD"),
			git(REPO, "rev-parse", "HEAD"),
			"an inherited GIT_DIR must not aim the ref check at another repository",
		);
		assert.equal(resolveCommit("no-such-ref"), undefined);
	} finally {
		if (saved === undefined) Reflect.deleteProperty(process.env, "GIT_DIR");
		else process.env.GIT_DIR = saved;
	}
});

test("--base cascades to the allowance base unless one was named explicitly", () => {
	/* The inconsistency review R-6 filed: `runCleanView({base})` cascades (its
	 * signature defaults `allowanceBase = base`) while the flag did not, so the
	 * same intent produced two different bases depending on the entry point. */
	assert.deepEqual(parseRefs(["--base", "a"], {}), {
		base: "a",
		allowanceBase: "a",
		help: false,
	});
	assert.deepEqual(parseRefs(["--base", "a", "--allowance-base", "b"], {}), {
		base: "a",
		allowanceBase: "b",
		help: false,
	});
	assert.deepEqual(parseRefs([], { CLEAN_VIEW_BASE: "c" }), {
		base: "c",
		allowanceBase: "c",
		help: false,
	});
	assert.deepEqual(
		parseRefs(["--base", "a"], { CLEAN_VIEW_ALLOWANCE_BASE: "d" }),
		{ base: "a", allowanceBase: "d", help: false },
	);
	assert.equal(parseRefs(["--help"], {}).help, true);
});

test("a gate that exits 0 without printing is refused, not reported as a pass", () => {
	const { dir, base } = fixture();
	try {
		/* Measured, not hypothesised: all three gates end with a
		 * `import.meta.url === pathToFileURL(...)` guard, and a `/var/folders` vs
		 * `/private/var/folders` mismatch once made every one of them exit 0
		 * without running a line. This stub reproduces that state deterministically
		 * for ONE gate - the committed script prints nothing and succeeds - and the
		 * runner must refuse to call it a pass. */
		const stub = "process.exitCode = 0;\n";
		writeFileSync(join(dir, "scripts", "i18n", "ledger-check.mjs"), stub);
		git(dir, "add", "--", "scripts/i18n/ledger-check.mjs");
		git(
			dir,
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"-qm",
			"silent gate",
		);

		const result = cleanView(dir, base);
		const silent = result.gates.find(
			(gate) => gate.name === "ledger-check.mjs",
		);
		assert.ok(silent, "the silent gate must have been run");
		assert.equal(
			silent.code,
			1,
			"a gate that printed nothing did not run, so it is not a pass",
		);
		assert.match(`${silent.stdout}${silent.stderr}`, PRINTED_NOTHING_RE);
		assert.equal(formatReport(result).code, 1);
	} finally {
		removeFixture(dir);
	}
});

test("the export surface comes from HEAD, not from what the checkout happens to have", () => {
	const { dir, base } = fixture();
	try {
		/* The committed failure state first: the stray file IS in HEAD, so a
		 * clean export of this commit must fail the added-copy gate. */
		writeFileSync(join(dir, STRAY_PATH), STRAY_SOURCE);
		git(dir, "add", "--", STRAY_PATH);
		git(
			dir,
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"-qm",
			"stray",
		);
		/* Then the checkout loses `src` entirely - a sparse checkout, a partial
		 * clone, or a developer cleaning up. Deriving the surface from the working
		 * tree narrowed the export to nothing that mattered, every `src/renderer`
		 * file read as a deletion, and the gate passed VACUOUSLY. */
		rmSync(join(dir, "src"), { recursive: true, force: true });

		const result = cleanView(dir, base);
		const added = result.gates.find(
			(gate) => gate.name === "check-added-strings.mjs",
		);
		assert.ok(added, "the added-copy gate must have run");
		assert.equal(
			added.code,
			1,
			`a checkout missing src must not narrow the export to a vacuous pass:\n${added.stdout}${added.stderr}`,
		);
		assert.ok(
			`${added.stdout}${added.stderr}`.includes("Stray local copy"),
			"the failure must still name the committed literal",
		);

		/* And directly: the export carries the committed tree even though the
		 * checkout no longer has it. */
		const exported = exportHead({ repo: dir, tmpRoot: SCRATCH });
		try {
			assert.ok(
				existsSync(join(exported.tree, STRAY_PATH)),
				"the export must carry what HEAD carries",
			);
		} finally {
			rmSync(exported.dir, { recursive: true, force: true });
		}
	} finally {
		removeFixture(dir);
	}
});

test("the export directory is removed when git archive itself throws", () => {
	const { dir } = fixture();
	try {
		/* A corrupt object is the cheapest deterministic throw: `ls-tree HEAD`
		 * reads TREE objects only, so the surface resolves, and `git archive` then
		 * fails on the BLOB it cannot read. The temp directory is this function's
		 * to reap on every path, not only the `tar` one (review N-3) - this disk is
		 * shared with ~25 sessions, and a throw used to leave an export behind. */
		const blob = git(
			dir,
			"rev-parse",
			"HEAD:scripts/i18n/check-added-strings.mjs",
		);
		rmSync(join(dir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
		assert.throws(() => exportHead({ repo: dir, tmpRoot: SCRATCH }));
		assert.deepEqual(
			readdirSync(SCRATCH).filter((name) => name.startsWith("export-")),
			[],
			"a throw from git archive must reap its temp dir",
		);
	} finally {
		removeFixture(dir);
	}
});
