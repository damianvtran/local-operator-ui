#!/usr/bin/env node
/**
 * Run the i18n gates that can be fooled by a dirty working tree against an
 * EXPORT OF HEAD, not against the checkout.
 *
 * WHY THIS EXISTS. Twice in one day a gate was green because the local worktree
 * was dirty in the helpful direction, and both times the clean checkout - CI, or
 * a peer's clone - disagreed:
 *
 *   1. a ledger row pointed at a receipt path that existed only as an UNTRACKED
 *      file in one worktree, so `ledger-check` passed locally and failed on a
 *      clean checkout;
 *   2. an untracked test probe was swept into a commit and turned two required
 *      checks red.
 *
 * Neither is a defect in `ledger-check`, `check-added-strings` or
 * `check-coverage`: each reads the working tree, which is correct for a
 * developer-facing check. The defect is that NOBODY asked them what they would
 * say about the commit. This runner asks exactly that. `git archive HEAD` is
 * the answer to "what will the merge actually contain", so a verdict from here
 * is the verdict a clean checkout gives.
 *
 * WHAT IS EXPORTED, AND WHY THAT SET.
 *   - `src`                  - `SCAN_ROOTS` is `["src", "scripts/i18n"]`, so the
 *                              added-copy guard parses product code under ALL of
 *                              `src`, not just `src/i18n`. An export narrowed to
 *                              `src/i18n` would list every `src/renderer` change
 *                              as a deletion, `--diff-filter=ACMR` would drop
 *                              them, and the guard would pass VACUOUSLY on a
 *                              branch full of hardcoded copy. That is the one
 *                              failure mode a gate like this must not have.
 *   - `scripts/i18n`         - the gates themselves, and the scanner scripts the
 *                              ratchet counts.
 *   - `i18n`                 - ledger, language manifest, both allowances, the
 *                              allowlist and every audit receipt the ledger
 *                              cites (552 of them under `i18n/receipts/`).
 *   - the two `tsconfig.*`   - `openSnapshot` opens `tsconfig.app.json` and
 *                              `tsconfig.node.json`; without them the added-copy
 *                              guard cannot build a program at all.
 * Nothing else is copied: no `node_modules`, no `.git`, no whole-repo export.
 *
 * HOW GIT STILL WORKS INSIDE A HEADLESS EXPORT. All three gates compare against
 * a BASE ref (`--base`, `--allowance-base`) through `git`, and the export has no
 * `.git`. So the child processes get a git view wired to the real repository's
 * objects while their WORK TREE is the export:
 *
 *   GIT_DIR        the real repo's git dir (`rev-parse --absolute-git-dir`, so a
 *                  linked worktree's indirection is honoured rather than guessed
 *                  at as `<repo>/.git`),
 *   GIT_WORK_TREE  the export - this is what makes `git diff <base>` describe
 *                  the COMMIT, and what makes `ls-files --others` unable to see
 *                  the checkout's stray files,
 *   GIT_INDEX_FILE a throwaway index (`read-tree HEAD`) so no gate can rewrite
 *                  the shared checkout's index. This tree is shared with ~25
 *                  concurrent sessions; a check that silently refreshes their
 *                  index is a check that corrupts someone else's `git status`.
 *
 * Usage:
 *   node scripts/i18n/check-clean-view.mjs [--base <ref>] [--allowance-base <ref>]
 *
 * Both default to `origin/main`, and each may also come from the environment
 * (`CLEAN_VIEW_BASE`, `CLEAN_VIEW_ALLOWANCE_BASE`) for CI, which passes the pull
 * request's base explicitly.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_BASE = "origin/main";

/**
 * The export surface, as git pathspecs. See the module docstring for why each
 * one is load-bearing; narrowing this set is how the runner would quietly stop
 * checking anything, so a test asserts the surface rather than trusting it.
 */
export const EXPORT_PATHS = [
	"src",
	"scripts/i18n",
	"i18n",
	"tsconfig.app.json",
	"tsconfig.node.json",
];

/**
 * The gates, in run order, with the flag each takes its base ref from.
 * `ledger-check` takes none: it compares the ledger against the catalogues in
 * the same tree, which is the whole reason it can be fooled by a stray receipt
 * and the whole reason it is worth running here.
 */
export const GATES = [
	{ name: "ledger-check.mjs", script: "ledger-check.mjs", baseFlag: undefined },
	{
		name: "check-added-strings.mjs",
		script: "check-added-strings.mjs",
		baseFlag: "--base",
	},
	{
		name: "check-coverage.mjs",
		script: "check-coverage.mjs",
		baseFlag: "--allowance-base",
	},
];

function git(args, options = {}) {
	const result = spawnSync("git", args, {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		env: cleanGitEnv(),
		...options,
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${
				result.error?.message ||
				(result.stderr ?? "").trim() ||
				`exit ${result.status}`
			}`,
		);
	}
	return result.stdout;
}

/**
 * The `GIT_*` keys that aim git at a particular repository, work tree or index.
 *
 * These are dropped from every child, and from this runner's own git calls. An
 * inherited `GIT_DIR` or `GIT_INDEX_FILE` would aim the gates at the caller's
 * repository or index - the exact class of accident this runner exists to make
 * impossible - and a fixture test that leaks one would silently grade another
 * tree. Keys that only affect CONFIG or PROMPTING (`GIT_CONFIG_SYSTEM`,
 * `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`) are deliberately KEPT: a rig that set
 * them to keep git away from the operator's keychain would otherwise re-arm the
 * prompt it silenced.
 */
const AIMING_GIT_VARS = new Set([
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_NAMESPACE",
	"GIT_PREFIX",
	"GIT_CEILING_DIRECTORIES",
	"GIT_DISCOVERY_ACROSS_FILESYSTEM",
]);

/** The parent environment minus every repository-aiming `GIT_*` key. */
function cleanGitEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !AIMING_GIT_VARS.has(key) && key !== "GIT_CONFIG_PARAMETERS",
		),
	);
}

/** The child environment: cleaned, plus the three keys this runner owns. */
function gateEnv({ gitDir, workTree, indexFile }) {
	const env = cleanGitEnv();
	env.GIT_DIR = gitDir;
	env.GIT_WORK_TREE = workTree;
	env.GIT_INDEX_FILE = indexFile;
	return env;
}

/**
 * Export HEAD's committed content under `tmpRoot` and return the directory.
 * `git archive -o` writes the tarball without a shell pipeline, so a large
 * export cannot deadlock on a pipe buffer.
 */
export function exportHead({
	repo = REPO,
	tmpRoot,
	paths = EXPORT_PATHS,
	label = "export",
}) {
	const dir = realpathSync(mkdtempSync(join(tmpRoot, `${label}-`)));
	const tarPath = join(dir, "export.tar");
	git(
		[
			"archive",
			"--format=tar",
			"-o",
			tarPath,
			"HEAD",
			"--",
			...paths.filter((path) => existsSync(join(repo, path))),
		],
		{ cwd: repo },
	);
	const extracted = join(dir, "tree");
	mkdirSync(extracted, { recursive: true });
	const tar = spawnSync("tar", ["-xf", tarPath, "-C", extracted], {
		encoding: "utf8",
	});
	if (tar.error || tar.status !== 0) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(
			`tar -xf failed: ${tar.error?.message || tar.stderr?.trim() || `exit ${tar.status}`}`,
		);
	}
	rmSync(tarPath, { force: true });
	return { dir, tree: extracted };
}

/**
 * Run every gate against the export and collect each verdict.
 *
 * Every gate runs even after an earlier one fails: a reader who fixes one gate
 * should not have to re-run three times to discover the next. The result names
 * the export and the base refs, so a printed verdict can never be mistaken for
 * one computed in the checkout.
 */
export function runCleanView({
	repo = REPO,
	base = DEFAULT_BASE,
	allowanceBase = base,
	paths = EXPORT_PATHS,
	tmpRoot = tmpdir(),
} = {}) {
	const { dir, tree } = exportHead({ repo, tmpRoot, paths });
	const modules = join(tree, "node_modules");
	/* A clean checkout of this commit has its dependencies INSTALLED - CI runs
	 * `pnpm install --frozen-lockfile` before these gates - so the export gets a
	 * symlink to the checkout's installed tree rather than a copy. What the
	 * export must not carry is the checkout's own source: uncommitted edits and
	 * stray untracked files, which is the entire point of the gate. Without this
	 * the added-copy guard cannot import `typescript` from a temp directory at
	 * all (ERR_MODULE_NOT_FOUND) and would be a gate in name only.
	 *
	 * A symlink, never a copy: ~25 sessions share this disk, and duplicating the
	 * install for a check would make the gate cost more than it saves. */
	const installed = join(repo, "node_modules");
	if (existsSync(installed)) symlinkSync(installed, modules, "dir");
	try {
		const gitDir = git(["rev-parse", "--absolute-git-dir"], {
			cwd: repo,
		}).trim();
		const indexFile = join(dir, "index");
		/* A throwaway index that matches HEAD, so `git diff <base>` describes
		 * base..export and nothing in the shared checkout is touched. -u is
		 * deliberately absent: this must not check anything out. */
		const env = gateEnv({ gitDir, workTree: tree, indexFile });
		const readTree = spawnSync("git", ["read-tree", "HEAD"], {
			cwd: tree,
			env,
			encoding: "utf8",
		});
		if (readTree.error || readTree.status !== 0) {
			throw new Error(
				`git read-tree HEAD failed: ${
					readTree.error?.message || readTree.stderr.trim()
				}`,
			);
		}

		const gates = [];
		for (const gate of GATES) {
			const scriptPath = join(tree, "scripts", "i18n", gate.script);
			if (!existsSync(scriptPath)) {
				throw new Error(
					`the export is missing scripts/i18n/${gate.script}; the export surface (${paths.join(", ")}) no longer covers what the gates read`,
				);
			}
			const args = [scriptPath];
			if (gate.baseFlag !== undefined) {
				const ref = gate.baseFlag === "--base" ? base : allowanceBase;
				args.push(gate.baseFlag, ref);
			}
			const result = spawnSync(process.execPath, args, {
				cwd: tree,
				env,
				encoding: "utf8",
				maxBuffer: 256 * 1024 * 1024,
			});
			const stdout = result.stdout ?? "";
			const stderr =
				result.stderr ??
				(result.error ? `spawn failed: ${result.error.message}` : "");
			/* A gate that printed NOTHING and still exited 0 did not run.
			 *
			 * Measured, not hypothesised: every one of the three gates ends with
			 * `import.meta.url === pathToFileURL(resolve(process.argv[1])).href`, and
			 * `mkdtempSync(tmpdir())` returns `/var/folders/...` while Node reports
			 * `import.meta.url` as `/private/var/folders/...` on macOS. The paths differ,
			 * the guard falls through, `main()` never runs, and the process exits 0
			 * silently - a clean-view run that reports three PASSes without executing a
			 * line of any gate. `realpathSync` above fixes the cause; this check makes a
			 * recurrence loud instead of green. All three gates print a verdict line on
			 * success, so silence is never a legitimate pass. */
			if (result.status === 0 && stdout.trim() === "" && stderr.trim() === "") {
				gates.push({
					name: gate.name,
					code: 1,
					signal: result.signal,
					stdout,
					stderr: `clean-view: ${gate.name} exited 0 but printed nothing, so it did not run its checks. Refusing to report that as a pass.`,
				});
				continue;
			}
			gates.push({
				name: gate.name,
				code: result.status,
				signal: result.signal,
				stdout,
				stderr,
			});
		}
		return {
			exportDir: tree,
			base,
			allowanceBase,
			paths,
			gates,
			failed: gates.filter((gate) => gate.code !== 0),
		};
	} finally {
		/* Unlink the shared install FIRST and by name: `rmSync` on a directory
		 * holding a symlink must never be the thing that decides whether the
		 * operator's node_modules survives. */
		rmSync(modules, { force: true });
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Render one run as the two streams it prints and the exit code it returns, so
 * `main()` prints exactly these lines and a test can read them without parsing
 * a child process's combined output.
 */
export function formatReport(result) {
	const standard = [
		`clean-view: ran on the HEAD export at ${result.exportDir} (surface: ${result.paths.join(", ")}; removed at exit), not on the working tree`,
		`clean-view: base ${result.base}${
			result.allowanceBase === result.base
				? ""
				: `, allowance base ${result.allowanceBase}`
		}`,
	];
	const error = [];
	for (const gate of result.gates) {
		const verdict = gate.code === 0 ? "PASS" : `FAIL (exit ${gate.code})`;
		standard.push(`clean-view: ${gate.name} ${verdict}`);
		for (const line of `${gate.stdout}${gate.stderr}`.split("\n")) {
			if (line.trim() !== "") standard.push(`  ${line}`);
		}
	}
	if (result.failed.length > 0) {
		/* Which gate, and where the verdict came from. Both halves matter: a
		 * failure read as a checkout failure sends the reader to the wrong tree,
		 * and a failure that does not name its gate sends them to the wrong gate. */
		const names = result.failed.map((gate) => gate.name).join(", ");
		error.push(
			`FAIL: ${names} failed on the HEAD EXPORT, not on the working tree. This is the verdict a clean checkout of this commit gives, so untracked or uncommitted local state cannot make it pass.`,
		);
		return { standard, error, code: 1 };
	}
	standard.push(
		`PASS: ${result.gates.length} i18n gate(s) passed on the HEAD export, not on the working tree.`,
	);
	return { standard, error, code: 0 };
}

export function main(argv = process.argv.slice(2)) {
	let base = process.env.CLEAN_VIEW_BASE || DEFAULT_BASE;
	let allowanceBase = process.env.CLEAN_VIEW_ALLOWANCE_BASE || base;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--base" && argv[index + 1]) {
			base = argv[++index];
		} else if (arg === "--allowance-base" && argv[index + 1]) {
			allowanceBase = argv[++index];
		} else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: node scripts/i18n/check-clean-view.mjs [--base <ref>] [--allowance-base <ref>]\n\n" +
					"Runs ledger-check, check-added-strings and check-coverage against `git archive HEAD`\n" +
					"rather than the working tree, so untracked or uncommitted local state cannot turn\n" +
					"any of them green. Both refs default to origin/main.\n",
			);
			return 0;
		} else {
			throw new Error(`Unknown or incomplete argument: ${arg}`);
		}
	}
	/* A resolved ref is the only way `git diff <base>` describes a real commit. */
	for (const [flag, ref] of [
		["--base", base],
		["--allowance-base", allowanceBase],
	]) {
		const resolved = spawnSync(
			"git",
			["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
			{ cwd: REPO, encoding: "utf8" },
		);
		if (resolved.status !== 0) {
			process.stderr.write(
				`clean-view: cannot resolve ${flag} ${ref} to a commit; refusing to report a verdict against a ref that does not exist\n`,
			);
			return 2;
		}
	}
	const { standard, error, code } = formatReport(
		runCleanView({ base, allowanceBase }),
	);
	for (const line of standard) console.log(line);
	for (const line of error) console.error(line);
	return code;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(`check-clean-view.mjs: ${error.message}`);
		process.exitCode = 2;
	}
}
