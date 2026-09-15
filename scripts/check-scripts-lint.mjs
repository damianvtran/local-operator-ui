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
 * two, and 15 carry more (worst: 27), a trio that sums to the same 106 — so debt
 * only goes down. The follow-up is to
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
 *
 * THE THREE ANSWERS THAT USED TO BE ONE, each found by executing the gate rather
 * than by reading it. They are why the file below is shaped the way it is.
 *
 * (1) A PATH GIT QUOTES IS A PATH IT STILL MEANT. `git diff --name-only` and `git
 * ls-files --others` quote any path holding a byte >= 0x80 (or a quote, or a
 * backslash), so `scripts/café.mjs` arrives as `"scripts/caf\303\251.mjs"` — a
 * string that does not exist on disk. Filtering the list with `existsSync` dropped
 * it with no diagnostic, and a committed formatter error in exactly that file made
 * this gate print `no file under scripts/ changed ... nothing to check` and exit 0.
 * Both git calls are now NUL-separated (`-z`), and a path git named that is not
 * readable here is an ERROR: "I could not look" must never read as "nothing to
 * see", which is this file's whole doctrine and its own worst-case failure.
 *
 * (2) THE BASE IS THE ONE THIS CHECKOUT WAS BUILT ON, NOT THE ONE THE PAYLOAD
 * REMEMBERS. Actions checks out the RECOMPUTED `refs/pull/N/merge`, whose first
 * parent is the base branch as of this run, while `github.event.pull_request.
 * base.sha` is frozen when the event fires. Once the base branch moves — which is
 * what the release window this repository works in does continuously — the frozen
 * SHA is an ancestor of `HEAD^1`, `merge-base` returns it unchanged, and the diff
 * from it sweeps in commits the base itself landed: rehearsed against this pull
 * request's own head, `--since <base>~15` charged 122 files, more than 20 of them
 * carrying dirt this change never opened. The CI step therefore passes `HEAD^1`,
 * and the gate REFUSES a base that is behind the first parent of a merge checkout
 * instead of answering with a verdict about somebody else's commits. An empty
 * `--since`/`LINT_SINCE` is refused the same way rather than falling back to the
 * default, for the same reason: a comparison the caller did not ask for is not a
 * comparison. `scripts/version-bump-guard.mjs` reads its diff the same way, for the
 * same event shape and the same reason.
 *
 * (3) A FILE BIOME HAS NO HANDLER FOR IS NOT A VIOLATION. This tree is the proof
 * harnesses and gates, so 15 of its committed files are `.html`, `.sh` or `.py`
 * (twelve, two and one, measured). biome can process none of them: with them as the
 * only entry in the list it exits 1 with `internalError/io: No files were processed
 * in the specified paths`, which this gate used to read as "not lint-clean" and
 * answer with `pnpm exec biome check --write <that file>` — a fix command that
 * itself exits 1. So the verdict is read from biome's REPORT rather than from its
 * exit status alone: error diagnostics name offenders, and a non-zero run that
 * examined no file at all is reported as what it is — a file this change touches
 * that no formatter or linter here can speak about — and never as a failure of the
 * change. `--files-ignore-unknown=true` does not close this in biome 1.9.4 (probed
 * both ways on `scripts/linux/launcher.sh`: exit 1 each time), which is why the
 * gate decides it rather than passing a flag and hoping.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

/** The tree this gate covers. Root-relative, because every path it prints is. */
const SCOPE = "scripts";

/** Where the base ref comes from when `--since` and `LINT_SINCE` are both absent. */ const DEFAULT_BASES =
	["origin/main", "main"];

/**
 * biome's own words for a run in which none of the files it was handed is one it
 * can check. See `biomeReport` for why the gate has to be able to tell that apart
 * from a file that is not lint-clean.
 */
const NOTHING_PROCESSED = /No files were processed in the specified paths/;

const USAGE = [
	"usage: node scripts/check-scripts-lint.mjs [--since <ref>] [--biome <path>]",
	"",
	"  --since <ref>   compare against this ref (default: origin/main, then main;",
	"                  LINT_SINCE is the environment spelling of the same thing).",
	"                  On a pull request's merge commit pass its first parent -",
	"                  --since HEAD^1 - which is the base the checkout was built",
	"                  on. An empty value is refused, never read as absent.",
	"  --biome <path>  the biome executable to run (default: node_modules/.bin/biome,",
	"                  and the seam the test drives this gate through)",
].join("\n");

/**
 * Run a command and keep its output apart from our own report. `status` is null
 * when the command could not be started at all, which is a different failure from
 * a non-zero exit and is reported as such.
 *
 * The buffer is generous because biome's JSON report carries every diagnostic's
 * full formatter diff: the default 1 MB trips `ENOBUFS` on a change touching a
 * handful of the tree's pre-existing offenders, and a spawned-with-no-buffer
 * failure would read as "could not run biome" rather than as the verdict it is.
 */
function run(command, args, options = {}) {
	return spawnSync(command, args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
}

function parseArguments(argv) {
	// `LINT_SINCE` set-but-empty is a request with no value, not the absence of a
	// request: reading it as "not asked" substitutes `origin/main`, i.e. a comparison
	// nobody chose, and a CI step whose base lookup produced nothing writes exactly
	// that (`LINT_SINCE="$(git rev-parse HEAD^1)"` with a checkout too shallow for
	// the parent). So the empty case is tracked and refused below, while a genuinely
	// unset variable still means "use the default".
	const options = {
		base: process.env.LINT_SINCE ?? "",
		requested: process.env.LINT_SINCE !== undefined,
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
			if (argument === "--since") {
				options.base = value;
				options.requested = true;
			} else options.biome = value;
		} else if (argument.startsWith("--since=")) {
			options.base = argument.slice(8);
			options.requested = true;
		} else if (argument.startsWith("--biome=")) {
			options.biome = argument.slice(8);
		} else {
			throw new Error(`unknown argument '${argument}'\n\n${USAGE}`);
		}
	}
	if (options.requested && !options.base.trim() && !options.help) {
		throw new Error(
			`the base ref is empty ('--since=' with no value, or LINT_SINCE=''): an empty base is a comparison nobody asked for, and falling back to the default would answer a question this run did not put\n\n${USAGE}`,
		);
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

/**
 * The same call where a non-zero status is an ANSWER rather than a failure - the
 * ancestry and counting probes below ask questions git answers with its exit code.
 * `null` means git could not answer at all (including a shallow clone with too
 * little history), which the callers must not read as either yes or no.
 */
function gitProbe(args, cwd) {
	const result = run("git", args, { cwd });
	return result.error || result.status !== 0 ? null : result.stdout;
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
 * Refuse a base that is not the one this checkout was built on, named out loud
 * instead of answered with a verdict about somebody else's commits.
 *
 * A merge checkout is the `pull_request` shape: Actions builds and checks out the
 * RECOMPUTED `refs/pull/N/merge`, so `HEAD^1` is the base branch as of this run
 * while the payload's `base.sha` is frozen when the event fires. Once the base
 * branch has moved, that frozen commit is a strict ancestor of `HEAD^1`, the merge
 * base resolves to it unchanged, and the diff from it charges this change for
 * commits the base itself landed - rehearsed against this pull request's own head
 * with `--since <base>~15`: 122 files, more than 20 of them carrying dirt this
 * change never opened. That is a spurious red today and, the moment the base's own
 * dirty files are cleaned, a growing one - so it is refused rather than endured.
 *
 * Deliberately silent in the two shapes that are not this: a merge whose parents
 * are the base and the change itself (`HEAD^1` and `HEAD^2` are the answers), and a
 * checkout that is not a merge at all - a local branch compared against `main`,
 * where the merge base below is the fork point and is the right comparison.
 */
function assertBaseIsWhatHeadWasBuiltOn(top, baseCommit) {
	const parents = gitProbe(["rev-list", "--parents", "-n1", "HEAD"], top);
	if (parents === null) return;
	const [head, firstParent, merged] = parents.trim().split(" ");
	if (!head || !firstParent || !merged) return;
	if (baseCommit === firstParent || baseCommit === merged) return;
	if (
		gitProbe(["merge-base", "--is-ancestor", baseCommit, firstParent], top) ===
		null
	)
		return;
	const count = gitProbe(
		["rev-list", "--count", `${baseCommit}..${firstParent}`],
		top,
	);
	throw new Error(
		`the base ${baseCommit.slice(0, 7)} is ${count === null ? "more than one commit" : `${count.trim()} commit(s)`} behind ${firstParent.slice(0, 7)}, the base this merge commit was built on: comparing against it would charge this change for commits it did not author. Name the first parent instead - in CI that is LINT_SINCE=$(git rev-parse HEAD^1)`,
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
	// `-z` on both calls, and NUL-separated parsing, because git's default output
	// QUOTES a path holding a byte >= 0x80 (or a quote, or a backslash): it prints
	// `"scripts/caf\303\251.mjs"`, which names nothing on disk. Reading that list
	// line-wise and filtering it with `existsSync` dropped such a file silently, and
	// the gate then reported "nothing to check" - exit 0 - over a committed
	// formatter error it never looked at. Do NOT trim: a trailing space is a legal
	// filename byte, and the empty strings here are only the separators.
	const listed = (args) => git(args, top).split("\0").filter(Boolean);
	const tracked = listed([
		"diff",
		"--name-only",
		"-z",
		"--diff-filter=ACMR",
		base,
		"--",
		SCOPE,
	]);
	const untracked = listed([
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		SCOPE,
	]);
	const paths = [...new Set([...tracked, ...untracked])];
	// The pathspec above makes both of these impossible; leaving them impossible
	// rather than improbable is the point, because the alternative to an error here
	// is a shorter file list and a verdict about a change nobody read.
	const outside = paths.filter((path) => !path.startsWith(`${SCOPE}/`));
	if (outside.length) {
		throw new Error(
			`git answered the ${SCOPE}/ pathspec with ${outside.length} path(s) outside it (${outside.join(", ")}); refusing to guess which of them this change touches`,
		);
	}
	const missing = paths.filter((path) => !existsSync(join(top, path)));
	if (missing.length) {
		throw new Error(
			`${missing.length} path(s) git reports as changed under ${SCOPE}/ cannot be read at ${top}: ${missing.join(", ")}. Reporting on the rest would be a verdict over a change this gate could not see`,
		);
	}
	return paths.sort();
}

/**
 * biome's own report for a set of files: the exit status, its stderr, and the
 * parsed JSON report when there is one.
 *
 * THE VERDICT IS READ FROM THE REPORT, NOT FROM THE EXIT STATUS ALONE, because the
 * status cannot tell the two non-zero answers apart that matter here: a file that
 * is not lint-clean, and a file biome has no handler for at all - with such a file
 * as the whole list it exits 1 with `internalError/io: No files were processed in
 * the specified paths`, having failed at nothing. `--files-ignore-unknown=true`
 * does not separate them either (biome 1.9.4, probed both ways on
 * `scripts/linux/launcher.sh`: exit 1 with and without), so the report is what
 * decides whether this change has a violation or merely no verdict to give.
 */
function biomeReport(biome, top, files) {
	const result = run(biome, ["check", "--reporter=json", ...files], {
		cwd: top,
	});
	if (result.error)
		throw new Error(`could not run ${biome}: ${result.error.message}`);
	let report = null;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		report = null;
	}
	return { status: result.status, stderr: result.stderr ?? "", report };
}

/**
 * The files among `files` biome reports an ERROR for, by name. The fix command this
 * gate prints has to name the offenders and nothing else: `--write` over a file
 * that was already clean can still reorder its imports, which is a change to
 * somebody else's file in a pull request about something else.
 */
function offendersIn(report, files) {
	const failing = new Set(
		(report.diagnostics ?? [])
			.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) =>
				(diagnostic.location?.path?.file ?? "").replace(/^\.\//, ""),
			),
	);
	return files.filter((file) => failing.has(file));
}

/**
 * How many of the files biome was handed it actually examined: `changed` is the
 * ones it would reformat, `unchanged` the ones it read and left alone, and the
 * difference from the count it was given is the files it skipped - no handler for
 * them, or reached by an ignore.
 */
function examinedBy(report) {
	return (report.summary?.changed ?? 0) + (report.summary?.unchanged ?? 0);
}

function main(argv) {
	const options = parseArguments(argv);
	if (options.help) {
		console.log(USAGE);
		return 0;
	}

	const top = repoTop();
	const { ref, commit } = resolveBase(top, options.base);
	assertBaseIsWhatHeadWasBuiltOn(top, commit);
	const base = mergeBase(top, commit);
	const against = `${ref} (${base.slice(0, 7)})`;
	if (base !== commit) {
		// Not a defect, and not a pass either: the comparison moved, and whoever
		// reads this output is entitled to know which two commits were compared.
		console.log(
			`check-scripts-lint: ${ref} (${commit.slice(0, 7)}) carries commits this change does not; comparing from their fork point ${base.slice(0, 7)}, so neither side is charged for the other's work.`,
		);
	}
	const files = changedFiles(top, base);

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

	const verdict = biomeReport(biome, top, files);
	const report = verdict.report;
	const offenders = report ? offendersIn(report, files) : [];

	if (verdict.status === 0) {
		if (!report || offenders.length) {
			throw new Error(
				`biome exited 0 over ${files.length} file(s) but ${
					report
						? `its report names ${offenders.join(", ")} as failing`
						: "its report could not be read"
				}; neither of those can be taken as a pass`,
			);
		}
		const skipped = files.length - examinedBy(report);
		if (skipped > 0) {
			// The count above is what the gate was handed, not what biome read: saying
			// "2 changed files are lint-clean" over one examined file would be the same
			// species of claim this file exists to avoid.
			console.log(
				`check-scripts-lint: ${files.length - skipped} of those ${files.length} file(s) under ${SCOPE}/ are lint-clean against ${against}, and biome did not process the other ${skipped} - no handler for them, or reached by an ignore - so those carry no lint verdict either way.`,
			);
			return 0;
		}
		console.log(
			`check-scripts-lint: ${files.length} changed file(s) under ${SCOPE}/ are lint-clean against ${against}.`,
		);
		return 0;
	}

	if (offenders.length === 0) {
		// Non-zero exit with nobody named. There is exactly one such answer this gate
		// reads as not-a-failure, and biome has to say it in its own words: nothing in
		// the list is a file it can check. Everything else is a run the gate will not
		// dress up as a pass.
		if (
			report &&
			examinedBy(report) === 0 &&
			NOTHING_PROCESSED.test(verdict.stderr)
		) {
			console.log(
				`check-scripts-lint: biome has no handler for ${files.length === 1 ? "the one file" : "any of the files"} this change touches under ${SCOPE}/ (${files.join(", ")}) and reports nothing to process, so no lint or format contract here speaks about ${files.length === 1 ? "it" : "them"} - a file biome cannot parse is not a file it found unformatted, and this is not a FAILED.`,
			);
			return 0;
		}
		run(biome, ["check", ...files], { cwd: top, stdio: "inherit" });
		throw new Error(
			`biome exited ${verdict.status} over ${files.length} file(s) and named none of them as failing; its output is above, and an exit the gate cannot interpret is a failure rather than a pass`,
		);
	}

	// biome's own account of what is wrong, in its own words, and then this gate's
	run(biome, ["check", ...files], { cwd: top, stdio: "inherit" });
	console.error(
		`check-scripts-lint: FAILED - ${offenders.length} of those ${files.length} file(s) are not lint-clean, and ${SCOPE}/ is outside \`pnpm lint\`'s path list, so nothing else will say so:`,
	);
	for (const file of offenders) console.error(`  ${file}`);
	console.error(
		`check-scripts-lint: most of this is mechanical: pnpm exec biome check --write ${offenders.join(" ")}`,
	);
	return 1;
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(`check-scripts-lint: FAILED to run: ${error.message}`);
		process.exitCode = 1;
	}
}
