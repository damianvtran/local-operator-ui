#!/usr/bin/env node
/**
 * The delta-scoped pre-push gate: what a push costs is what the DIFF costs.
 *
 * WHY THIS EXISTS. Two costs meet at a push. The cheap local mistakes - a file
 * the formatter would rewrite, an import TypeScript rejects - currently cost a
 * pipeline run and a round trip to find, and nothing told the pusher first.
 * Against that, a hook that runs the whole CI job set on every push is worse
 * than no hook: this fleet produced four DISCLOSED bypasses in one night, every
 * one of them a hook that could not complete inside the host's memory budget,
 * and a gate people route around is indistinguishable from no gate. So every leg
 * here is either proportional to the changed files or is deliberately narrowed
 * until it is cheap, and the one leg that cannot be proportional says so out
 * loud.
 *
 * IT DOES NOT DECIDE WHAT TO RUN. `scripts/ci-scope.mjs` is the single source of
 * truth for which CI jobs a diff can affect - the `Change Scope` workflow job and
 * `pnpm check-changed` both run it - so this file asks it for the flag vector
 * (`classify`) and the changed path list (`collectPaths`) and runs the local
 * spelling of the legs its `lint`/`types` flags select. A second, hand-written
 * mapping here would be the drift that module exists to prevent, and it is why a
 * prose-only diff, a committed-evidence-only diff and a version-only `package.json`
 * bump all run nothing rather than a hand-kept subset.
 *
 * WHAT EACH LEG COSTS, AND WHY. The lint legs' cost tracks the changed files: the
 * `scripts/` leg is a ratchet over the files this change touches, and the
 * `src/`/`bin/` leg hands biome exactly those paths. The types leg's cost tracks
 * the TREE - TypeScript has no per-file mode - so it is narrowed twice instead:
 * it runs only when the diff touches a TypeScript file, and its two projects run
 * SERIALLY, because two concurrent `tsc` processes are what this host's memory
 * budget cannot absorb (measured wall time and peak RSS for both are in
 * `AGENTS.md`, *The pre-push gate*).
 *
 * THE LINT LEGS REUSE THE REPOSITORY'S OWN GATES. Files under `scripts/` go
 * through `scripts/check-scripts-lint.mjs`, which already solves the hard parts -
 * the tree's pre-existing violation backlog as a ratchet, git's path quoting, and
 * "no biome handler for this file" - and a second implementation of any of that
 * would be a second opinion about one contract. Files under `src/`/`bin/` go
 * through the same binary `pnpm lint` names, over the changed paths instead of
 * the hand-written path list. That leg reads biome's JSON REPORT rather than its
 * exit status alone, for the reason the ratchet documents: a run over files biome
 * cannot process exits non-zero having failed at nothing, so violations, clean and
 * "no verdict to give" have to stay three answers and not collapse into two.
 *
 * WHAT IT CANNOT SEE, SAID HERE RATHER THAN IMPLIED. Pre-existing violations in
 * files this change does not touch. Anything about behaviour: no test runs here,
 * and `pnpm test:desktop` is 344 files, which no push should pay for. Deletions -
 * a deleted path is still classified (a deletion is a live change) but there is
 * nothing left to lint, so it is named and dropped rather than passed to a tool
 * that would fail on a file that does not exist. Windows, where the tracked
 * hook's shebang needs a Node-aware hook runner. And a `node_modules` this gate
 * cannot read: that is a REFUSAL naming the fix, never a silent pass, because a
 * gate that cannot tell "nothing to check" from "I could not look" is the exact
 * failure the rest of this directory exists to remove. The same rule governs the
 * base ref: a base that does not resolve refuses rather than answering about a
 * comparison nobody chose.
 *
 * THE BYPASS IS DELIBERATE AND LOUD. `PREPUSH_BYPASS="<reason>"` prints what it
 * is doing, on the push, in the pusher's own terminal, and then lets the push
 * through. Its purpose is to make the disclosed path cheaper than the silent one:
 * `--no-verify` leaves no trace, so a skipped gate and a passed gate look
 * identical in every log afterwards - which is why the rule in `AGENTS.md` is to
 * run the equivalent legs by hand and record that, never to push with
 * `--no-verify` silently. A bypass with no reason is refused: an undisclosed
 * bypass is the thing this exists to prevent.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	JOB_COMMANDS,
	LOCAL_EXCLUSIONS,
	categoryOf,
	classify,
	collectPaths,
	manifestDiff,
} from "./ci-scope.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * Refusals - "I could not look" - as opposed to a leg failing. The distinction is
 * the whole doctrine of this file, so it gets its own type rather than a flag.
 */
class GateRefused extends Error {}

/** The path prefixes `pnpm lint` covers and the ratchet does not. */
const SOURCE_PREFIXES = ["src/", "bin/"];

/** Every extension a change can carry that either tsconfig can compile. */
const TYPESCRIPT_RE = /\.(ts|tsx|mts|cts)$/i;

/** The legs the hook runs, and how CI's job set is named in the report. */
const GATE_JOBS = ["lint", "check-types"];

/** biome's own words for a run in which none of its files was one it can check. */
const NOTHING_PROCESSED = /No files were processed in the specified paths/;

const USAGE = [
	"usage: node scripts/pre-push-gate.mjs [--since <ref>] [--help]",
	"",
	"  --since <ref>  the base to compare against (default: origin/main, then",
	"                 main, resolved to its merge base with HEAD - the same base",
	"                 `pnpm check-changed` uses). The diff is taken against the",
	"                 WORKING TREE, so staged and unstaged edits count too.",
	"",
	"env:",
	'  PREPUSH_BYPASS="<reason>"  print the reason and let the push through.',
	"                             Only for a leg that could not run - never for a",
	"                             leg that failed. An empty reason is refused.",
].join("\n");

function parseArguments(argv) {
	const options = { base: "", requested: false, help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
		} else if (argument === "--since") {
			const value = argv[index + 1] ?? "";
			if (!value) throw new Error(`'--since' needs a value\n\n${USAGE}`);
			index += 1;
			options.base = value;
			options.requested = true;
		} else if (argument.startsWith("--since=")) {
			options.base = argument.slice(8);
			options.requested = true;
		} else {
			throw new Error(`unknown argument '${argument}'\n\n${USAGE}`);
		}
	}
	// An empty base is a request with no value, not the absence of a request:
	// reading it as "not asked" substitutes `origin/main`, i.e. a comparison
	// nobody chose, and a caller whose lookup produced nothing writes exactly
	// that. Refused rather than defaulted, the way `check-scripts-lint.mjs`
	// refuses the same shape for the same reason.
	if (options.requested && !options.base.trim() && !options.help) {
		throw new GateRefused(
			`the base ref is empty ('--since=' with no value): an empty base is a comparison nobody asked for, and the default would answer a question this run did not put\n\n${USAGE}`,
		);
	}
	return options;
}

/** Run a command, keeping its output apart from this gate's own report. */
function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
	return {
		status: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error ?? null,
	};
}

/** Run it with its output streamed to the pusher, which is what fixes the leg. */
function runInherited(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	return result.error ? null : result.status;
}

/** A git read that answers `null` when git fails, for probes whose failure is normal. */
function gitProbe(args, cwd) {
	const result = run("git", args, cwd);
	return result.status === 0 ? result.stdout.trim() : null;
}

const repoTop = () =>
	gitProbe(["rev-parse", "--show-toplevel"]) ?? process.cwd();

/**
 * The base this gate compares against, resolved to a commit.
 *
 * `origin/main` then `main`, and each is reduced to its MERGE BASE with HEAD, so
 * a branch that has fallen behind is charged for its own work and not for main's.
 * A base that does not resolve refuses: substituting "no base" for a change set
 * would report a clean gate over a comparison this run never made.
 */
function resolveChangeSetBase(top, requested) {
	const candidates = requested ? [requested] : ["origin/main", "main"];
	for (const ref of candidates) {
		const commit = gitProbe(
			["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
			top,
		);
		if (!commit) continue;
		const mergeBase = gitProbe(["merge-base", commit, "HEAD"], top);
		if (!mergeBase) {
			throw new GateRefused(
				`there is no merge base between ${ref} (${commit.slice(0, 7)}) and HEAD - fetch enough history for it (a depth-1 clone of both sides has none)`,
			);
		}
		return { ref, commit: mergeBase };
	}
	throw new GateRefused(
		requested
			? `the base ref '${requested}' does not resolve to a commit here (fetch it, or drop --since)`
			: "neither origin/main nor main resolves to a commit here; run `git fetch origin main`, or name a base with --since <ref>",
	);
}

/**
 * The tool a leg runs, refused by name when it is not installed.
 *
 * A worktree without `node_modules` is the ordinary case in this fleet (worktrees
 * LINK the primary checkout's tree rather than installing a second one), and the
 * wrong answer to it is the one that looks like a pass: every leg would be
 * skipped and the push would be reported as gated.
 */
function tool(top, name, fix) {
	const path = join(top, "node_modules", ".bin", name);
	if (!existsSync(path)) {
		throw new GateRefused(
			`${name} is not installed at ${path}, so no leg of this gate can run. ${fix}`,
		);
	}
	return path;
}

/** The changed paths git still has on disk, and the ones a deletion left behind. */
function onDisk(top, paths, prefixes) {
	const present = [];
	const gone = [];
	for (const path of paths) {
		if (!prefixes.some((prefix) => path.startsWith(prefix))) continue;
		if (existsSync(join(top, path))) present.push(path);
		else gone.push(path);
	}
	return { present, gone };
}

/**
 * biome's verdict over a set of files, read from its report rather than from its
 * exit status.
 *
 * The three answers this keeps apart, each of which the exit status alone
 * conflates: error diagnostics name offenders (a failure), no diagnostics over
 * files biome examined (a pass), and a non-zero run that examined nothing because
 * it has no handler for what it was handed (a file no formatter or linter here can
 * speak about, and NOT a failure of the change). `--files-ignore-unknown=true`
 * does not separate the last two in biome 1.9.4, which is why the report decides.
 */
function biomeVerdict(biome, top, files) {
	const result = run(biome, ["check", "--reporter=json", ...files], top);
	if (result.error) {
		throw new GateRefused(`could not run ${biome}: ${result.error.message}`);
	}
	let report = null;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		report = null;
	}
	if (!report) {
		runInherited(biome, ["check", ...files], top);
		console.error(
			`pre-push gate: biome exited ${result.status} over ${files.length} file(s) and its report could not be read; that is a failure rather than a pass.`,
		);
		return false;
	}
	const failing = new Set(
		(report.diagnostics ?? [])
			.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) =>
				(diagnostic.location?.path?.file ?? "").replace(/^\.\//, ""),
			),
	);
	const offenders = files.filter((file) => failing.has(file));
	const examined =
		(report.summary?.changed ?? 0) + (report.summary?.unchanged ?? 0);
	if (offenders.length) {
		runInherited(biome, ["check", ...offenders], top);
		console.error(
			`pre-push gate: ${offenders.length} of ${files.length} changed file(s) are not lint-clean (biome's own report above). The fix is usually mechanical:`,
		);
		console.error(
			`  node_modules/.bin/biome check --write ${offenders.join(" ")}`,
		);
		return false;
	}
	if (examined === 0 && result.status !== 0) {
		if (NOTHING_PROCESSED.test(result.stderr)) {
			console.log(
				`pre-push gate: biome has no handler for ${files.length === 1 ? "the one file" : `any of the ${files.length} files`} this change touches (${files.join(", ")}), so no lint or format contract here speaks about ${files.length === 1 ? "it" : "them"} - not a failure.`,
			);
			return true;
		}
		runInherited(biome, ["check", ...files], top);
		console.error(
			`pre-push gate: biome exited ${result.status} over ${files.length} file(s) and named none of them as failing; its output is above, and an exit the gate cannot interpret is a failure rather than a pass.`,
		);
		return false;
	}
	console.log(
		`pre-push gate: ${examined} of ${files.length} changed file(s) read by biome are lint-clean${examined < files.length ? `; the other ${files.length - examined} carry no lint verdict either way (no handler, or reached by an ignore)` : ""}.`,
	);
	return true;
}

/**
 * The legs, in the order they run. Each returns whether it passed, having already
 * printed its own account; the caller stops at the first failure and names the
 * legs that therefore did not run.
 */
function buildLegs({ top, base, paths, flags }) {
	const legs = [];
	if (flags.lint) {
		const scripts = onDisk(top, paths, ["scripts/"]);
		if (scripts.present.length) {
			legs.push({
				name: "lint (scripts/)",
				detail: `${scripts.present.length} changed file(s) through the scripts ratchet`,
				run: () =>
					runInherited(
						process.execPath,
						["scripts/check-scripts-lint.mjs", "--since", base.commit],
						top,
					) === 0,
			});
		}
		const source = onDisk(top, paths, SOURCE_PREFIXES);
		if (source.present.length) {
			const biome = tool(
				top,
				"biome",
				"Run `pnpm install`, or link the primary checkout's tree: `rm -rf node_modules && ln -s ../../node_modules node_modules`.",
			);
			legs.push({
				name: "lint (src/, bin/)",
				detail: `${source.present.length} changed file(s) through biome, the binary pnpm lint names`,
				run: () => biomeVerdict(biome, top, source.present),
			});
		}
		if (scripts.gone.length || source.gone.length) {
			console.log(
				`pre-push gate: ${scripts.gone.length + source.gone.length} deleted path(s) are classified but not linted (there is nothing left to read): ${[...scripts.gone, ...source.gone].join(", ")}.`,
			);
		}
	}
	const typescript = paths.filter((path) => TYPESCRIPT_RE.test(path));
	if (flags.types && typescript.length) {
		const tsc = tool(
			top,
			"tsc",
			"Run `pnpm install`, or link the primary checkout's tree: `rm -rf node_modules && ln -s ../../node_modules node_modules`.",
		);
		legs.push({
			name: "types",
			detail:
				"tsconfig.node.json then tsconfig.app.json, serially (two concurrent tsc processes are what this host cannot absorb)",
			run: () => {
				for (const project of ["tsconfig.node.json", "tsconfig.app.json"]) {
					console.log(`pre-push gate: tsc --noEmit -p ${project}`);
					if (runInherited(tsc, ["--noEmit", "-p", project], top) !== 0) {
						console.error(
							`pre-push gate: ${project} reports type errors (above).`,
						);
						return false;
					}
				}
				return true;
			},
		});
	} else if (flags.types) {
		console.log(
			"pre-push gate: the types leg is skipped - this diff changes no TypeScript file, and the leg costs the tree rather than the diff.",
		);
	}
	return legs;
}

/** The bypass, refused when it is a bypass of nothing in particular. */
function bypassReason() {
	const value = process.env.PREPUSH_BYPASS;
	if (value === undefined) return null;
	if (!value.trim()) {
		throw new GateRefused(
			"PREPUSH_BYPASS is set but empty: an undisclosed bypass is what this variable exists to prevent. Name the reason, or unset it.",
		);
	}
	return value.trim();
}

function main(argv) {
	const options = parseArguments(argv);
	if (options.help) {
		console.log(USAGE);
		return 0;
	}

	const top = repoTop();
	const { ref, commit } = resolveChangeSetBase(top, options.base);
	const against = `${ref} (${commit.slice(0, 7)})`;

	const paths = collectPaths(commit, true, top);
	if (paths === null) {
		throw new GateRefused(
			`git could not produce a change list against ${against}, so this gate has no verdict to give - and an empty change list is not the same answer`,
		);
	}
	const flags = classify(paths, manifestDiff(commit, true, top));

	console.log(
		`pre-push gate: ${paths.length} changed path(s) against ${against}`,
	);
	for (const path of paths) console.log(`  ${path} -> ${categoryOf(path)}`);

	if (paths.length === 0) {
		console.log(
			"pre-push gate: git reports no changed path against this base - there is nothing to check. That is a real answer about a diff git could read, and not the refusal an unreachable base or tool produces.",
		);
		return 0;
	}

	if (!flags.lint && !flags.types) {
		console.log(
			"pre-push gate: the classifier selects no local leg for this diff (prose, committed evidence, or a version-only bump it says belongs to the version-bump guard) - nothing to do.",
		);
		return 0;
	}

	const legs = buildLegs({ top, base: { ref, commit }, paths, flags });
	if (!legs.length) {
		console.log(
			"pre-push gate: the classifier selects lint/typecheck for this diff, but no changed path is one of their targets - nothing to run.",
		);
		return 0;
	}

	const ciOnly = Object.keys(JOB_COMMANDS).filter(
		(job) => !GATE_JOBS.includes(job),
	);
	console.log(
		`pre-push gate: running ${legs.length} leg(s) - ${legs.map((leg) => leg.name).join(", ")} - and NOT ${ciOnly.join(", ")} (CI remains the authority for those), nor ${Object.keys(LOCAL_EXCLUSIONS).join(" and ")} (no faithful local spelling at all).`,
	);

	for (let index = 0; index < legs.length; index += 1) {
		const leg = legs[index];
		console.log(`pre-push gate: ${leg.name} - ${leg.detail}`);
		const started = process.hrtime.bigint();
		const passed = leg.run();
		const seconds = Number(process.hrtime.bigint() - started) / 1e9;
		const remaining = legs.slice(index + 1).map((next) => next.name);
		console.log(
			`pre-push gate: ${leg.name} ${passed ? "passed" : "FAILED"} in ${seconds.toFixed(1)}s`,
		);
		if (passed) continue;
		if (remaining.length) {
			console.error(
				`pre-push gate: ${remaining.join(", ")} did not run - fix ${leg.name} first, then push again.`,
			);
		}
		console.error(
			'pre-push gate: do NOT push past this with `--no-verify`. If a leg cannot run in this environment, run the equivalent by hand (see docs/hooks.md) and record that in the PR - and if you must bypass deliberately, say so: PREPUSH_BYPASS="<reason>" prints the reason and lets the push through.',
		);
		return 1;
	}

	console.log(
		`pre-push gate: ${legs.length} leg(s) passed against ${against}.`,
	);
	return 0;
}

if (isEntryPoint(import.meta.url)) {
	try {
		const bypassNote = bypassReason();
		if (bypassNote) {
			console.log(
				`pre-push gate: BYPASSED - PREPUSH_BYPASS is set ("${bypassNote}"), so no leg runs and this push is ungated. The legs it skips are: ${GATE_JOBS.map((job) => JOB_COMMANDS[job].join(" && ")).join("; ")}. Run the equivalent by hand and record it in the pull request.`,
			);
			process.exitCode = 0;
		} else {
			process.exitCode = main(process.argv.slice(2));
		}
	} catch (error) {
		if (error instanceof GateRefused) {
			console.error(`pre-push gate: REFUSED - ${error.message}`);
		} else {
			console.error(`pre-push gate: FAILED to run: ${error.message}`);
		}
		process.exitCode = 1;
	}
}
