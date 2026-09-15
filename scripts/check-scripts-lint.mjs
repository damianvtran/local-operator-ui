#!/usr/bin/env node
/**
 * The lint gate's hole: it names the paths it checks, and `scripts/` was not one of them.
 *
 * WHY THIS FILE EXISTS. `pnpm lint` runs `biome check src bin
 * scripts/linux-sandbox.test.mjs` — a hand-written list, so the formatter and
 * linter contracts stop at whichever paths somebody remembered to add, and the
 * tree whose whole job is producing and verifying other people's evidence was not
 * on it. Measured, not assumed: a formatting error introduced by a merged pull
 * request rode through CI green and was found by hand instead, and on that same
 * `main` `biome check scripts/` reports 245 errors across 106 files (88 formatter,
 * 18 organizeImports, 139 lint rules) plus 1417 lint warnings.
 *
 * WHY THE SCOPE IS `scripts/` AND NOT EVERYTHING. Widening to the whole tree is not
 * the same fix. `docs/evidence/**` holds recorded evidence pinned by
 * `docs/evidence/manifest.json`: reformatting a captured reading rewrites a record
 * of what was measured, so those files must stay outside a formatter contract on
 * purpose, and the `tsconfig.*.json` files belong to the TypeScript project rather
 * than to this gate. The hole is the scripts tree, which is where this repository
 * keeps its proof harnesses, evidence rigs and release gates — the code that
 * decides whether other things are verified.
 *
 * WHY THE FILES A CHANGE TOUCHES, AND NOT THE WHOLE TREE YET. Turning 106 files
 * green in one commit is a burn-down of its own, and mechanically reformatting the
 * 88 of them that carry formatter errors would collide with every worktree in
 * flight. So this gate is a ratchet over the change: a violation can no longer ride
 * in with the diff that introduces it, a file that gets fixed stays fixed, and the
 * backlog cannot grow. The cost of touching a file that carries pre-existing
 * violations is cleaning it — 66 of the 106 carry a single formatter wrap, 25 carry
 * two, and 10 carry more (worst: 27) — so debt only goes down. The follow-up is to
 * burn the rest down and let `pnpm lint` name `scripts/` outright, at which point
 * this gate has nothing left to add.
 *
 * IT ENFORCES THE SAME CONTRACT AS `pnpm lint` — the whole of `biome check`, not
 * the formatter alone. A second, weaker rule set for `scripts/` would be the same
 * hole with more configuration.
 *
 * WHAT IT CANNOT SEE, SAID OUT LOUD RATHER THAN IMPLIED. Pre-existing violations in
 * files this change does not touch (by design above), and nothing outside
 * `scripts/`. It does see untracked files under `scripts/` that git does not
 * ignore, so it bites before the first commit and not only in CI.
 *
 * THE COMPARISON. `--since <ref>` or `LINT_SINCE` (how the CI step spells it),
 * defaulting to `origin/main` and then `main`. The diff runs from the merge base of
 * that ref and HEAD, so a branch that has fallen behind its base is not credited
 * with — or charged for — main's own commits, and it runs against the WORKING TREE,
 * so staged and unstaged edits count. A base ref that does not resolve, or a merge
 * base that cannot be found, is a failure and never a pass: a gate that cannot tell
 * "nothing changed" from "I could not look" is the exact failure mode the rest of
 * this directory exists to remove.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

/** The tree this gate covers. Root-relative, because every path it prints is. */
const SCOPE = "scripts";

/** Where the base ref comes from when `--since` and `LINT_SINCE` are both absent. */ const DEFAULT_BASES =
	["origin/main", "main"];

const USAGE = [
	"usage: node scripts/check-scripts-lint.mjs [--since <ref>] [--biome <path>]",
	"",
	"  --since <ref>   compare against this ref (default: origin/main, then main;",
	"                  LINT_SINCE is the environment spelling of the same thing)",
	"  --biome <path>  the biome executable to run (default: node_modules/.bin/biome,",
	"                  and the seam the test drives this gate through)",
].join("\n");

/**
 * Run a command and keep its output apart from our own report. `status` is null
 * when the command could not be started at all, which is a different failure from
 * a non-zero exit and is reported as such.
 */
function run(command, args, options = {}) {
	return spawnSync(command, args, { encoding: "utf8", ...options });
}

function parseArguments(argv) {
	const options = {
		base: process.env.LINT_SINCE ?? "",
		biome: "",
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
		} else if (argument === "--since" || argument === "--biome") {
			const value = argv[index + 1] ?? "";
			if (!value) throw new Error(`'${argument}' needs a value\n\n${USAGE}`);
			index += 1;
			if (argument === "--since") options.base = value;
			else options.biome = value;
		} else if (argument.startsWith("--since=")) {
			options.base = argument.slice(8);
		} else if (argument.startsWith("--biome=")) {
			options.biome = argument.slice(8);
		} else {
			throw new Error(`unknown argument '${argument}'\n\n${USAGE}`);
		}
	}
	return options;
}

function git(args, cwd) {
	const result = run("git", args, { cwd });
	if (result.error)
		throw new Error(`could not run git: ${result.error.message}`);
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim() || "no output"}`,
		);
	}
	return result.stdout;
}

/** The repository the gate is being run in, whatever directory the caller stood in. */
const repoTop = () => git(["rev-parse", "--show-toplevel"], undefined).trim();

/** The base ref, resolved to a commit, or a failure naming what was tried. */
function resolveBase(top, requested) {
	const candidates = requested ? [requested] : DEFAULT_BASES;
	for (const ref of candidates) {
		const probe = run(
			"git",
			["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
			{
				cwd: top,
			},
		);
		if (probe.status === 0 && probe.stdout.trim()) {
			return { ref, commit: probe.stdout.trim() };
		}
	}
	throw new Error(
		requested
			? `the base ref '${requested}' does not resolve to a commit here (fetch it, or drop --since)`
			: `neither ${DEFAULT_BASES.join(" nor ")} resolves to a commit here; name one with --since <ref> (a shallow CI clone needs the base commit fetched)`,
	);
}

/**
 * The merge base, because `git diff <base>` alone would charge this change for
 * everything the base branch has done since they diverged. In a CI checkout of a
 * pull request's merge commit the base is a direct parent, so this resolves to the
 * base itself.
 */
function mergeBase(top, baseCommit) {
	const result = run("git", ["merge-base", baseCommit, "HEAD"], { cwd: top });
	if (result.status !== 0 || !result.stdout.trim()) {
		throw new Error(
			`no merge base between ${baseCommit.slice(0, 7)} and HEAD — fetch enough history for it (a depth-1 clone of both sides has none)`,
		);
	}
	return result.stdout.trim();
}

/**
 * Every file under `scripts/` this change touches, deduplicated and sorted: the
 * committed, staged and unstaged edits against the merge base, plus untracked
 * files git does not ignore (a harness the author has written but not yet staged
 * is still a harness this change introduces).
 */
function changedFiles(top, base) {
	const tracked = git(
		["diff", "--name-only", "--diff-filter=ACMR", base, "--", SCOPE],
		top,
	).split("\n");
	const untracked = git(
		["ls-files", "--others", "--exclude-standard", "--", SCOPE],
		top,
	).split("\n");
	const paths = [...new Set([...tracked, ...untracked])]
		.map((line) => line.trim())
		.filter(
			(path) => path.startsWith(`${SCOPE}/`) && existsSync(join(top, path)),
		);
	return paths.sort();
}

/**
 * The files among `files` that biome reports an ERROR for, by name. Asked as a
 * second, quiet pass only once the first one has failed, because the fix command
 * this gate prints has to name the offenders and nothing else: `--write` over a
 * file that was already clean can still reorder its imports, which is a change to
 * somebody else's file in a pull request about something else.
 */
function failingFiles(biome, top, files) {
	const result = run(biome, ["check", "--reporter=json", ...files], {
		cwd: top,
	});
	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		// A report we cannot read is not a reason to withhold the verdict: fall back
		// to naming the files, which is what the caller has without this.
		return files;
	}
	const failing = new Set(
		(report.diagnostics ?? [])
			.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) =>
				(diagnostic.location?.path?.file ?? "").replace(/^\.\//, ""),
			),
	);
	return files.filter((file) => failing.has(file));
}
function main(argv) {
	const options = parseArguments(argv);
	if (options.help) {
		console.log(USAGE);
		return 0;
	}

	const top = repoTop();
	const { ref, commit } = resolveBase(top, options.base);
	const base = mergeBase(top, commit);
	const files = changedFiles(top, base);
	const against = `${ref} (${base.slice(0, 7)})`;

	if (files.length === 0) {
		console.log(
			`check-scripts-lint: no file under ${SCOPE}/ changed since ${against} - nothing to check.`,
		);
		return 0;
	}

	const biome = options.biome || join(top, "node_modules", ".bin", "biome");
	if (!existsSync(biome)) {
		throw new Error(
			`biome is not installed at ${biome}; run pnpm install, or name one with --biome <path>`,
		);
	}

	console.log(
		`check-scripts-lint: checking ${files.length} changed file(s) under ${SCOPE}/ against ${against}`,
	);
	for (const file of files) console.log(`  ${file}`);
	const result = run(biome, ["check", ...files], {
		cwd: top,
		stdio: "inherit",
	});
	if (result.error)
		throw new Error(`could not run ${biome}: ${result.error.message}`);

	if (result.status !== 0) {
		// A failed run whose report names nothing is still a failure: name every file
		// the gate looked at rather than an empty fix command.
		const offenders = failingFiles(biome, top, files);
		const named = offenders.length ? offenders : files;
		console.error(
			`check-scripts-lint: FAILED - ${named.length} of those ${files.length} file(s) are not lint-clean, and ${SCOPE}/ is outside \`pnpm lint\`'s path list, so nothing else will say so:`,
		);
		for (const file of named) console.error(`  ${file}`);
		console.error(
			`check-scripts-lint: most of this is mechanical: pnpm exec biome check --write ${named.join(" ")}`,
		);
		return 1;
	}

	console.log(
		`check-scripts-lint: ${files.length} changed file(s) under ${SCOPE}/ are lint-clean against ${against}.`,
	);
	return 0;
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(`check-scripts-lint: FAILED to run: ${error.message}`);
		process.exitCode = 1;
	}
}
