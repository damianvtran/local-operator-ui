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
 * ITS SUBJECT IS THE PUSHED REF, NOT `HEAD`, AND NOT ITS OWN ARGUMENTS. Git
 * writes the refs being pushed to stdin and a false green is one `git push
 * origin other` away from a gate that diffs `HEAD`. The two positional arguments
 * git appends (the remote's name and URL) are accepted, named in the report and
 * ignored rather than refused: an earlier revision of this file threw on them,
 * and because the dispatcher forwards what git gave the hook, that refused EVERY
 * push.
 *
 * AND IT ONLY SPEAKS WHEN IT IS READING WHAT IS BEING PUSHED. The legs run the
 * repository's tools over files on disk, so every case where those files would
 * not be the pushed blobs REFUSES instead of judging: a subject that is not the
 * commit this checkout IS (a foreign branch, a tag, or an ancestor whose files
 * the worktree has since changed - pushing an old violating commit from a fixed
 * worktree used to report a pass), a file a leg would read that has uncommitted
 * edits, a stdin that exists but cannot be read, a base or tool that cannot be
 * reached. "I could not look" never reads as "nothing to see" anywhere in this
 * file; that is the property the whole exercise is about, and it is the property
 * each round of review has found one step narrower.
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	JOB_COMMANDS,
	LOCAL_EXCLUSIONS,
	categoryOf,
	classify,
	parseNameStatus,
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
	"usage: node scripts/pre-push-gate.mjs [--since <ref>] [--ref <sha>] [--help]",
	"",
	"  Git invokes this as a pre-push hook and writes the refs being pushed to",
	"  stdin, one '<local ref> <local sha> <remote ref> <remote sha>' per line;",
	"  that line is the SUBJECT of this gate. The two positional arguments git",
	"  appends (the remote's name and URL) are accepted and ignored: a gate that",
	"  dies on its own harness's arguments refuses every push, which is the",
	"  failure this gate exists to remove.",
	"",
	"  --since <ref>  the base to compare against (default: origin/main, then",
	"                 main - the same base `pnpm check-changed` uses), each",
	"                 reduced to its merge base with the pushed commit.",
	"  --ref <sha>    gate this commit instead of the refs on stdin. This is the",
	"                 by-hand spelling for a checkout with no push in flight;",
	"                 what a push carries is what its refs name, never HEAD.",
	"",
	"env:",
	'  PREPUSH_BYPASS="<reason>"  print the reason and let the push through.',
	"                             Only for a leg that could not run - never for a",
	"                             leg that failed. An empty reason is refused.",
].join("\n");

function parseArguments(argv) {
	const options = {
		base: "",
		requested: false,
		ref: "",
		positional: [],
		help: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
		} else if (argument === "--ref") {
			const value = argv[index + 1] ?? "";
			if (!value) throw new Error(`'--ref' needs a value\n\n${USAGE}`);
			index += 1;
			options.ref = value;
		} else if (argument.startsWith("--ref=")) {
			options.ref = argument.slice(6);
		} else if (argument === "--since") {
			const value = argv[index + 1] ?? "";
			if (!value) throw new Error(`'--since' needs a value\n\n${USAGE}`);
			index += 1;
			options.base = value;
			options.requested = true;
		} else if (argument.startsWith("--since=")) {
			options.base = argument.slice(8);
			options.requested = true;
		} else if (argument.startsWith("-")) {
			// A flag this gate does not know is a request it cannot honour, so it
			// is refused rather than dropped.
			throw new Error(`unknown argument '${argument}'\n\n${USAGE}`);
		} else {
			// POSITIONAL ARGUMENTS ARE GIT'S, NOT THIS GATE'S. `pre-push` receives
			// the remote's name and URL; git's own hook contract says so, and a
			// version of this file that threw on them refused EVERY push - the
			// exact failure this gate exists to remove - because the dispatcher
			// forwards them. They are accepted and ignored, and more than the two
			// the contract names is refused rather than quietly dropped.
			options.positional.push(argument);
		}
	}
	if (options.positional.length > 2) {
		throw new GateRefused(
			`${options.positional.length} positional arguments ('${options.positional.join("', '")}') were given, but git's pre-push contract names two (the remote's name and its URL): refusing rather than guessing which of them this gate should have understood\n\n${USAGE}`,
		);
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
 * The base this gate compares against, resolved to a commit (not yet merged with
 * anything: the merge base belongs to a SUBJECT, and there is one subject per
 * pushed ref).
 *
 * `origin/main` then `main`. A base that does not resolve refuses: substituting
 * "no base" for a change set would report a clean gate over a comparison this run
 * never made.
 */
function resolveBaseRef(top, requested) {
	const candidates = requested ? [requested] : ["origin/main", "main"];
	for (const ref of candidates) {
		const commit = gitProbe(
			["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
			top,
		);
		if (commit) return { ref, commit };
	}
	throw new GateRefused(
		requested
			? `the base ref '${requested}' does not resolve to a commit here (fetch it, or drop --since)`
			: "neither origin/main nor main resolves to a commit here; run `git fetch origin main`, or name a base with --since <ref>",
	);
}

/**
 * What the push is actually carrying, from git's own pre-push input.
 *
 * THE SUBJECT OF THIS GATE IS THE PUSHED REF, NOT `HEAD`. Gating `HEAD` against
 * the base is a false green the moment they differ - `git push origin other`,
 * `--all`, a tag, or a worktree whose `HEAD` is another branch - because the run
 * then answers a question about a commit nobody is pushing (and answers it with
 * "no changed path", which reads as a pass). Git writes the answer to stdin as
 * `<local ref> <local sha> <remote ref> <remote sha>` per line, so the gate reads
 * it, one subject per line, and refuses a line it cannot read rather than
 * guessing.
 *
 * A DELETION (`(delete)` or an all-zero local sha) carries no content, so it has
 * nothing for the lint or typecheck legs to read: it is named and skipped, not
 * passed to tools that would fail on a file that no longer exists.
 *
 * A TTY IS NOT WAITED ON. Run by hand there are no refs to read, and reading a
 * terminal would block until EOF, so a TTY is answered as "no refs" and the caller
 * decides what that means - `--ref <sha>` for a named commit, or HEAD with the
 * report saying so. A stdin that exists but CANNOT BE READ is a different answer
 * and gets one: this gate does not know what is being pushed, so it refuses rather
 * than answering about HEAD.
 */
function pushedSubjects() {
	if (process.stdin.isTTY)
		return { subjects: [], source: "a terminal", readable: true };
	let text = "";
	try {
		text = readFileSync(0, "utf8");
	} catch (error) {
		// NOT a fallback to HEAD. git wrote refs this gate could not read, so it
		// does not know what is being pushed - and a gate that answers about HEAD
		// because it could not look is the defect class this file is about.
		return {
			subjects: [],
			source: `${error.code ?? error.message}`,
			readable: false,
		};
	}
	const subjects = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		const fields = line.split(/\s+/);
		if (fields.length < 2) {
			throw new GateRefused(
				`git's pre-push input line '${line}' does not have the shape '<local ref> <local sha> <remote ref> <remote sha>', so this gate cannot tell which commit it is being asked about`,
			);
		}
		const [localRef, localSha, remoteRef = "(unknown)"] = fields;
		subjects.push({
			localRef,
			localSha,
			remoteRef,
			deletion: localRef === "(delete)" || /^0+$/.test(localSha),
		});
	}
	return {
		subjects,
		source: subjects.length
			? "stdin"
			: "a pipe git wrote nothing to (a by-hand run)",
		readable: true,
	};
}

/**
 * One subject, resolved to the commits this gate will actually diff: the pushed
 * commit itself (peeled, so a tag naming a commit is a commit), and its merge
 * base with the base ref - so a branch that has fallen behind is charged for its
 * own work and not for main's.
 */
function resolveSubject(top, baseCommit, subject) {
	const commit = gitProbe(
		["rev-parse", "--verify", "--quiet", `${subject.localSha}^{commit}`],
		top,
	);
	if (!commit) {
		throw new GateRefused(
			`${subject.localRef} -> ${subject.remoteRef} names ${subject.localSha.slice(0, 7)}, which is not a commit this checkout can read: there is nothing for this gate to diff, so it refuses rather than reporting a pass over a push it could not look at`,
		);
	}
	const mergeBase = gitProbe(["merge-base", baseCommit, commit], top);
	if (!mergeBase) {
		throw new GateRefused(
			`there is no merge base between the base and ${subject.localRef} (${commit.slice(0, 7)}) - fetch enough history for it (an unrelated branch has none against a base it never forked from)`,
		);
	}
	return { ...subject, commit, mergeBase };
}

/**
 * The files one subject changes, or `null` when git could not answer.
 *
 * `collectPaths` in `ci-scope.mjs` cannot be reused here: it diffs against `HEAD`
 * by construction, and the whole point of this path is that the subject may be
 * some other commit. The PARSING is reused (`parseNameStatus`), because git's
 * `--name-status` output - renames, and the path-quoting hazard - is exactly
 * what that helper exists to read.
 */
function pathsForSubject(top, resolved) {
	const result = run(
		"git",
		["diff", "--name-status", "-M", resolved.mergeBase, resolved.commit],
		top,
	);
	if (result.status !== 0) return null;
	return [...new Set(parseNameStatus(result.stdout))];
}

/** The `package.json` diff for one subject, or `null` when git could not answer. */
function manifestDiffForSubject(top, resolved) {
	const result = run(
		"git",
		["diff", resolved.mergeBase, resolved.commit, "--", "package.json"],
		top,
	);
	return result.status === 0 ? result.stdout : null;
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
 * Refuse a push whose commits this worktree cannot read.
 *
 * THE LEGS READ FILES ON DISK, SO THE ONLY COMMIT THEY CAN JUDGE IS THE ONE THE
 * CHECKOUT IS: `HEAD`. Anything else is refused, and the ANCESTOR case is the one
 * worth stating because it looks safe and is not - a commit reachable from `HEAD`
 * is "carried" by the checkout in the sense that its objects are here, but the
 * worktree holds what came AFTER it, so pushing an old violating commit from a
 * worktree holding its fix reported a pass over the fixed copies and published the
 * violating blobs. A foreign ref (`git push origin other`, a tag of a commit on no
 * branch here, `--all`) is refused for the plainer reason: its bytes are not in
 * this checkout at all. Either way the verdict would be about bytes other than the
 * ones being pushed, which is the false green this gate exists to prevent, so it
 * refuses, names the ref, and names the way to get a real verdict.
 */
function assertSubjectsReadable(top, resolved) {
	const head = gitProbe(
		["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
		top,
	);
	if (!head) {
		throw new GateRefused(
			"HEAD is not a commit here, so this gate cannot tell whether the pushed commits are the ones this checkout carries",
		);
	}
	// EXACTLY HEAD, NOT "AN ANCESTOR OF HEAD". An ancestor once looked safe -
	// the checkout carries it, so the bytes are here - and it is not: the legs
	// read the WORKING TREE, so pushing an older commit while the worktree holds
	// its fix reports a pass over the fixed copies and publishes the violating
	// blobs (reproduced: commit V breaks formatting, commit F fixes it, and
	// `git push <V>:refs/heads/x` reported "lint (scripts/) passed"). Only the
	// commit the checkout IS can be judged from the files on disk, so anything
	// else is refused with the reason.
	const refused = resolved.filter((subject) => subject.commit !== head);
	if (!refused.length) return head;
	throw new GateRefused(
		`this push carries ${refused
			.map((subject) => `${subject.localRef} (${subject.commit.slice(0, 7)})`)
			.join(
				", ",
			)}, and the only commit this checkout can be judged from is HEAD (${head.slice(0, 7)}): the lint and typecheck legs read files on disk, so any other commit - a foreign branch, a tag, or an ANCESTOR whose files the working tree has since changed - would be checked against bytes other than the ones being pushed. Check that ref out in a worktree that has it and push from there, or run the legs by hand over it and record that - and if you must push from here anyway, say so with PREPUSH_BYPASS="<reason>" rather than --no-verify.`,
	);
}

/**
 * Refuse when a file a leg would read is not the file being pushed.
 *
 * The same class as the subject rule above, one step narrower: a file the push
 * changes but that has UNCOMMITTED edits means biome or `tsc` reads the worktree's
 * copy while the push carries the committed blob - a verdict about bytes nobody
 * is pushing, in either direction (a false pass when the fix is uncommitted, a
 * false refusal when the breakage is). So the paths a leg would hand its tool are
 * required to match the subject exactly.
 *
 * THE `scripts/` LEG ADDS FILES RATHER THAN SUBSTITUTING THEM, and that asymmetry
 * is deliberate rather than a hole: that leg IS `scripts/check-scripts-lint.mjs`,
 * the repository's worktree-scoped ratchet and the same spelling `pnpm
 * lint:scripts` runs, so it also lints untracked scripts. Those can only ADD
 * files to the check - never remove one - so they can refuse about a file you
 * have not committed, and can never pass about a file you are pushing. Said in
 * `docs/hooks.md` rather than left for a reader to discover.
 */
function assertLegsReadTheSubject(top, head, paths, flags) {
	const targets = [];
	if (flags.lint) {
		targets.push(...onDisk(top, paths, ["scripts/"]).present);
		targets.push(...onDisk(top, paths, SOURCE_PREFIXES).present);
	}
	if (flags.types) {
		targets.push(
			...paths.filter(
				(path) => TYPESCRIPT_RE.test(path) && existsSync(join(top, path)),
			),
		);
	}
	const wanted = [...new Set(targets)];
	if (!wanted.length) return;
	const result = run(
		"git",
		["diff", "--name-only", head, "--", ...wanted],
		top,
	);
	if (result.status !== 0) {
		throw new GateRefused(
			`git could not compare the working tree with ${head.slice(0, 7)} for the files this gate would read (${(result.stderr || "").trim() || "no output"}), so this gate will not guess which bytes it would be judging`,
		);
	}
	const dirty = result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (!dirty.length) return;
	throw new GateRefused(
		`the working tree differs from ${head.slice(0, 7)} for ${dirty.length} file(s) this gate would read: ${dirty.join(", ")}. Those legs read files on disk, so they would judge a version that is not the one being pushed - commit or stash them, or run the legs by hand over the pushed commit and record that - and if you must push with them as they are, say so with PREPUSH_BYPASS="<reason>" rather than --no-verify.`,
	);
}

/**
 * The legs, in the order they run. Each returns whether it passed, having already
 * printed its own account; the caller stops at the first failure and names the
 * legs that therefore did not run.
 */
function buildLegs({ top, since, paths, flags }) {
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
						["scripts/check-scripts-lint.mjs", "--since", since],
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
	if (options.positional.length) {
		// Said out loud rather than dropped in silence: git appends these, they are
		// not this gate's arguments, and a reader of the report is entitled to know
		// what was ignored on their behalf.
		console.log(
			`pre-push gate: ignoring git's ${options.positional.length} pre-push argument(s) (${options.positional.join(", ")}): they name the remote, not the subject - the refs on stdin do.`,
		);
	}
	const { ref, commit: baseCommit } = resolveBaseRef(top, options.base);
	const against = `${ref} (${baseCommit.slice(0, 7)})`;

	// THE SUBJECT: the refs git says are being pushed, or the commit a by-hand run
	// named. See `pushedSubjects` for why HEAD is only ever the last resort.
	// A caller who NAMES the subject does not need stdin at all, so `--ref` does
	// not read it (reading a closed descriptor would otherwise refuse a by-hand run
	// over a stream it never needed).
	const pushed = options.ref
		? { subjects: [], source: "--ref names the subject", readable: true }
		: pushedSubjects();
	if (!pushed.readable) {
		throw new GateRefused(
			`git's pre-push refs could not be read from stdin (${pushed.source}), so this gate cannot tell which commit it is being asked about - and it will not fall back to HEAD, because a verdict about a commit nobody queried is worse than no verdict. Name the commit with --ref <sha>, or run the legs by hand over the pushed commit and record that, or bypass deliberately with PREPUSH_BYPASS="<reason>".`,
		);
	}
	const named = options.ref
		? [
				{
					localRef: options.ref,
					localSha: options.ref,
					remoteRef: "(named by --ref)",
				},
			]
		: [];
	const raw = named.length ? named : pushed.subjects;

	if (!raw.length) {
		if (named.length) {
			// `--ref` and stdin cannot both be the subject; `raw` already says which.
			throw new GateRefused("unreachable: --ref and stdin are exclusive");
		}
		const head = gitProbe(
			["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
			top,
		);
		if (!head) {
			throw new GateRefused(
				`there are no refs on stdin (${pushed.source}) and HEAD is not a commit here, so this gate has no subject to check - name one with --ref <sha>`,
			);
		}
		console.log(
			`pre-push gate: no refs on stdin (${pushed.source}), so the subject is HEAD (${head.slice(0, 7)}) - a push names its own refs, and this is a by-hand run.`,
		);
		raw.push({ localRef: "HEAD", localSha: head, remoteRef: "(by hand)" });
	}

	for (const subject of raw) {
		console.log(
			`pre-push gate: push subject ${subject.localRef} ${subject.localSha.slice(0, 7)} -> ${subject.remoteRef} against ${against}`,
		);
	}
	const deletions = raw.filter((subject) => subject.deletion);
	if (deletions.length) {
		console.log(
			`pre-push gate: ${deletions.length} deletion(s) carry no content for a lint or typecheck leg to read, so they are named and skipped: ${deletions.map((subject) => `${subject.localRef} -> ${subject.remoteRef}`).join(", ")}.`,
		);
	}
	const live = raw.filter((subject) => !subject.deletion);
	if (!live.length) {
		console.log(
			"pre-push gate: this push carries nothing but deletions, so there is nothing for the local legs to check.",
		);
		return 0;
	}

	const resolved = live.map((subject) =>
		resolveSubject(top, baseCommit, subject),
	);
	const paths = [];
	let manifestDiff = null;
	let manifestSubjects = 0;
	for (const subject of resolved) {
		const changed = pathsForSubject(top, subject);
		if (changed === null) {
			throw new GateRefused(
				`git could not list what ${subject.localRef} (${subject.commit.slice(0, 7)}) changes, so this gate has no verdict to give - and an empty change list is not the same answer`,
			);
		}
		for (const path of changed) if (!paths.includes(path)) paths.push(path);
		if (changed.includes("package.json")) {
			manifestSubjects += 1;
			// The classifier refines a `package.json` change into `release_bump`
			// only when the diff is nothing but the version line pair. Two subjects
			// both moving the manifest is not that shape, so `null` keeps the
			// manifest live - the fail-closed direction.
			manifestDiff =
				manifestSubjects === 1 ? manifestDiffForSubject(top, subject) : null;
		}
	}

	const flags = classify(paths, manifestDiff);

	console.log(`pre-push gate: ${paths.length} changed path(s) in that push`);
	for (const path of paths) console.log(`  ${path} -> ${categoryOf(path)}`);

	if (paths.length === 0) {
		console.log(
			"pre-push gate: git reports no changed path for this push - there is nothing to check. That is a real answer about a diff git could read, and not the refusal an unreachable base or tool produces.",
		);
		return 0;
	}

	if (!flags.lint && !flags.types) {
		console.log(
			"pre-push gate: the classifier selects no local leg for this diff (prose, committed evidence, or a version-only bump it says belongs to the version-bump guard) - nothing to do.",
		);
		return 0;
	}

	// The accepted subject IS HEAD and its files are the worktree's own
	// (assertSubjectsReadable, assertLegsReadTheSubject), so the window the legs run
	// over - the base, reduced to its merge base with HEAD, to the working tree - is
	// exactly this branch's delta and no larger than what a push from here carries.
	const head = assertSubjectsReadable(top, resolved);
	assertLegsReadTheSubject(top, head, paths, flags);
	const since = gitProbe(["merge-base", baseCommit, head], top) ?? baseCommit;
	const legs = buildLegs({ top, since, paths, flags });
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
