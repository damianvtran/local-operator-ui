#!/usr/bin/env node
/**
 * Wire this clone's git pushes through `.githooks/pre-push`.
 *
 * WHY A TRACKED HOOKS DIRECTORY AND NOT A HOOK FRAMEWORK. This repository has
 * lived without one: there is no `.husky/`, no `core.hooksPath` and no hook in
 * `.git/hooks` beyond git's own `*.sample` files (measured 2026-10-01 on the
 * primary checkout). A framework would add a dependency, a version to keep in
 * step with the install and a second place that decides what runs; three lines
 * of `git config` and a tracked shell script do the same job, and the script is
 * reviewable in the pull request that changes it. If a framework ever earns its
 * place here, that argument has to beat this one rather than assume it.
 *
 * WHY THE INDIRECTION, AND WHY IT IS THE POINT OF THIS FILE. The obvious wiring
 * is `git config core.hooksPath .githooks`. It is also the wiring that fails
 * SILENTLY in exactly the place this fleet works: git skips a hook file that is
 * not there, without a word, so a worktree whose branch predates `.githooks/`
 * pushes ungated and nobody learns that it did. A relative `core.hooksPath` is
 * resolved against the working directory, so an absolute one is required before
 * anything else can be trusted.
 *
 * `core.hooksPath` therefore names a directory THIS SCRIPT OWNS inside the
 * clone's SHARED git directory (`<common>/lop-hooks`), whose `pre-push` is a
 * dispatcher with two properties a plain `core.hooksPath=.githooks` cannot have:
 *
 * 1. It always exists, in every worktree of this clone, on every branch. Config
 *    is shared across worktrees, so one install wires all of them; a worktree
 *    does NOT run `pnpm install` (the fleet links the primary checkout's
 *    `node_modules` instead), so an install-time hook alone would never reach
 *    it.
 * 2. It decides PER WORKTREE: it runs the hook the worktree's OWN checkout
 *    carries, so a branch that changes the gate is gated by its own version of
 *    it, and a worktree that carries no gate is REFUSED LOUDLY instead of
 *    pushing ungated. That refusal is the failure this file exists to remove -
 *    it names the two ways forward (fold `origin/main` in, or run the legs by
 *    hand) instead of leaving a green push that checked nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not run in `bin/postinstall.js`,
 * which owns the install's other two duties and whose contract is the opposite
 * of this one's ("THIS SCRIPT MUST NEVER FAIL THE INSTALL"): a wiring that
 * cannot be verified has to say so, and an install that cannot be wired must
 * not be reported as a success. It runs from `prepare` instead - the hook that
 * fires on `pnpm install` in a checkout and on a git-based install, and never
 * for a published tarball's consumer, which has no repository to wire.
 *
 * IT IS IDEMPOTENT. A second run rewrites nothing, reports "already current",
 * and is safe to run at any time - `pnpm hooks:install`. `pnpm hooks:check` is
 * the read-only form: it exits non-zero and says what to run, for anyone (or
 * any rig) that wants to know whether pushes from this clone are actually
 * gated before trusting a green push.
 *
 * WHAT IT CANNOT SEE. It wires THIS CLONE only: a second clone has its own
 * config until someone installs there too. It cannot make a worktree on a
 * branch without `.githooks/pre-push` pushable - it can only make that state
 * loud, which the dispatcher does. And `core.hooksPath` is a shared value, so
 * two checkouts of the same clone cannot disagree about it: whichever
 * installed last owns the path, which is why the path it names is inside the
 * shared git directory rather than inside any one checkout.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

/** The directory this script owns inside the clone's shared git directory. */
const HOOKS_DIR_NAME = "lop-hooks";

/** The one hook wired today. `pre-push` is the last cheap moment before CI. */
const HOOK_NAME = "pre-push";

/**
 * The environment variable that turns a refusal into a DISCLOSED bypass. It is
 * read in two places - here, in the dispatcher this file writes, and in
 * `scripts/pre-push-gate.mjs` - because either can be the thing that cannot
 * run. Its contract is in both: non-empty reason or it is not a bypass.
 */
const BYPASS_VAR = "PREPUSH_BYPASS";

const USAGE = [
	"usage: node scripts/hooks-install.mjs [--check] [--tolerate-failure] [--help]",
	"",
	"  --check   report whether this clone's pushes are wired, and exit",
	"            non-zero with what to run when they are not. Writes nothing.",
	"  --tolerate-failure",
	"            print a loud warning instead of failing. This is how `prepare`",
	"            invokes it: an install must never be broken by a hook helper.",
	"            `pnpm hooks:install` and `pnpm hooks:check` are the spellings",
	"            that DO fail, and the warning states exactly what is not gated.",
	"  --help    print this.",
	"",
	"Writes <common-git-dir>/lop-hooks/pre-push: a dispatcher that runs the",
	"hook the CURRENT worktree carries, and refuses when it carries none.",
	`${BYPASS_VAR}=<reason> turns that refusal into a disclosed bypass, in the`,
	"dispatcher and in the gate.",
].join("\n");

/**
 * The dispatcher. Kept in POSIX `sh` - no bashisms, no node - because it runs
 * before anything has been installed, in worktrees where `node_modules` may not
 * exist, and its job is to decide whether the real gate can run at all.
 *
 * Line by line, because each line is a decision: the first block is the
 * disclosed bypass (see both files' headers); the second resolves the worktree
 * the push is happening IN, so the gate that runs is that branch's own; the
 * third refuses when that branch carries no gate, naming the ways forward.
 */
const DISPATCHER_LINES = [
	"#!/bin/sh",
	"# Generated by scripts/hooks-install.mjs. DO NOT EDIT: edit .githooks/pre-push",
	"# (the gate) or scripts/hooks-install.mjs (this file) and re-run",
	"# `pnpm hooks:install`.",
	"#",
	"# This file exists because git skips a missing hook file in silence, and a",
	"# worktree on a branch that predates .githooks/ would otherwise push",
	"# ungated. It runs the gate the CURRENT worktree carries, and refuses when",
	"# there is none. The clone's shared config points core.hooksPath here.",
	"set -u",
	"",
	`if [ -n "\${${BYPASS_VAR}:-}" ]; then`,
	"\t# A bypass must NAME a reason. Whitespace is not one, and a gate that",
	"\t# accepted it would be a bypass nobody had to think about - the point of",
	"\t# the variable is that the disclosed path stays disclosed.",
	`\tcase "\${${BYPASS_VAR}}" in`,
	"\t*[![:space:]]*)",
	`\t\tprintf '%s\\n' "pre-push: BYPASSED by ${BYPASS_VAR}=[\${${BYPASS_VAR}}] - nothing was checked. CI is still the authority, and a bypass is an unverified push; say so in the PR rather than leaving it implicit." >&2`,
	"\t\texit 0",
	"\t\t;;",
	"\t*)",
	`\t\tprintf '%s\\n' "${BYPASS_VAR} is set but names no reason (whitespace only), so it is NOT a bypass: nothing was checked and this push is refused. Name the reason, or unset it." >&2`,
	"\t\texit 1",
	"\t\t;;",
	"\tesac",
	"fi",
	"",
	"top=$(git rev-parse --show-toplevel 2>/dev/null) || {",
	"	# A bare repository, or git too old to answer. Neither is a state this",
	"	# clone's gate can run in, so it is reported rather than skipped.",
	`	printf '%s\\n' "pre-push: this is not a git work tree, so the gate cannot run (a bare repository cannot host one). Pushing anyway would be an UNGATED push: run the equivalent legs where the tree is, or set ${BYPASS_VAR}=<reason> to say so out loud." >&2`,
	"	exit 1",
	"}",
	"",
	'hook="$top/.githooks/pre-push"',
	'if [ ! -f "$hook" ]; then',
	`	printf '%s\\n' "pre-push: this worktree carries no .githooks/pre-push, so the gate cannot run - and git would have skipped it silently. The hook is tracked in origin/main: fold it in (git merge origin/main, or rebase onto it) and push again. To push without it, run the legs by hand (node scripts/pre-push-gate.mjs from a checkout that has it, or the job commands in scripts/ci-scope.mjs) and record that you did - or set ${BYPASS_VAR}=<reason>, which says so out loud. Do NOT reach for --no-verify." >&2`,
	"	exit 1",
	"fi",
	'if [ ! -x "$hook" ]; then',
	"	printf '%s\\n' \"pre-push: $hook is not executable, so git cannot run it. Fix with: chmod +x .githooks/pre-push\" >&2",
	"	exit 1",
	"fi",
	"",
	'exec "$hook" "$@"',
	"",
].join("\n");

/** The dispatcher's text, as written to disk. A trailing newline is part of it. */
const DISPATCHER = DISPATCHER_LINES;

/** Run git, keeping its output apart from ours. `status` is null when it could not start. */
function git(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return {
		status: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error ?? null,
	};
}

/** The trimmed stdout of a git command, or `null` when it failed or said nothing. */
function gitProbe(args, cwd) {
	const result = git(args, cwd);
	if (result.status !== 0) return null;
	const value = result.stdout.trim();
	return value || null;
}

function parseArguments(argv) {
	const options = { check: false, tolerateFailure: false, help: false };
	for (const argument of argv) {
		if (argument === "--help" || argument === "-h") options.help = true;
		else if (argument === "--check") options.check = true;
		else if (argument === "--tolerate-failure") options.tolerateFailure = true;
		else throw new Error(`unknown argument '${argument}'\n\n${USAGE}`);
	}
	return options;
}

/**
 * The clone's shared git directory, absolute. `--git-common-dir` is already
 * absolute in a worktree on the git versions this repository runs, and is
 * resolved against the root when it is not, because a relative `core.hooksPath`
 * is the silent failure this file is about.
 */
function sharedGitDirectory(top) {
	const dir = gitProbe(["rev-parse", "--git-common-dir"], top);
	if (!dir)
		throw new Error(
			`git could not name the shared git directory of ${top}, so there is nothing safe to wire`,
		);
	return isAbsolute(dir) ? dir : resolve(top, dir);
}

/** Whether this file's content and mode are already on disk at `path`. */
function dispatcherIsCurrent(path) {
	if (!existsSync(path)) return false;
	if (readFileSync(path, "utf8") !== DISPATCHER) return false;
	return (statSync(path).mode & 0o111) !== 0;
}

function main(argv) {
	const options = parseArguments(argv);
	if (options.help) {
		console.log(USAGE);
		return 0;
	}
	if (!options.tolerateFailure) return wire(options);

	// `prepare` runs inside `pnpm install`, and AN INSTALL MUST NEVER BE BROKEN BY
	// A HOOK HELPER: a repository whose install fails because a git directory was
	// read-only has a worse defect than an ungated push. The failure is still
	// LOUD - it names exactly what is not gated - and `pnpm hooks:check` is the
	// spelling that exits non-zero.
	try {
		return wire(options);
	} catch (error) {
		console.warn(
			`hooks: WARNING - this clone's pushes are NOT gated: ${error.message}`,
		);
		console.warn(
			"hooks: this is the `prepare` path, so the install is NOT failed by it. Run `pnpm hooks:check` for the read-only answer, and `pnpm hooks:install` once the cause is fixed.",
		);
		return 0;
	}
}

/** The wiring itself: strict about every step it cannot verify. */
function wire(options) {
	const cwd = process.cwd();
	const top = gitProbe(["rev-parse", "--show-toplevel"], cwd);
	if (!top) {
		// A published tarball, a vendored copy, a `--ignore-scripts` install in a
		// directory git does not know: there is no repository here to wire, and
		// this is not a failure of the install. Said out loud rather than
		// silently, because "nothing to wire" and "could not wire" are the two
		// answers this whole design refuses to conflate.
		const version = git(["--version"], cwd);
		console.log(
			version.status === 0
				? "hooks: not inside a git work tree, so there is no push to gate here (nothing to do)."
				: "hooks: git is not available here, so no push hook can be wired (nothing to do).",
		);
		return 0;
	}

	const commonDir = sharedGitDirectory(top);
	const hooksDir = join(commonDir, HOOKS_DIR_NAME);
	const dispatcher = join(hooksDir, HOOK_NAME);
	const tracked = join(top, ".githooks", HOOK_NAME);

	if (options.check) {
		return check({ top, hooksDir, dispatcher, tracked });
	}

	mkdirSync(hooksDir, { recursive: true });
	if (dispatcherIsCurrent(dispatcher)) {
		console.log(`hooks: the dispatcher at ${dispatcher} is already current.`);
	} else {
		writeFileSync(dispatcher, DISPATCHER);
		// `mode` above only applies on creation, and an existing file keeps its
		// own bits: an unwritable hook is a silent skip, which is the failure
		// this file is about, so the mode is set explicitly every time.
		chmodSync(dispatcher, 0o755);
		console.log(`hooks: wrote the dispatcher at ${dispatcher}.`);
	}
	if (!dispatcherIsCurrent(dispatcher)) {
		throw new Error(
			`the dispatcher at ${dispatcher} is not the content this script ships (or is not executable), so a push would be gated by something other than this checkout's script`,
		);
	}

	// THE LOCAL SCOPE, NAMED EXPLICITLY. A bare `git config core.hooksPath X`
	// writes wherever the ambient configuration points - a rig's
	// `GIT_CONFIG_GLOBAL`, or another repository's config - which is how a nested
	// checkout can poison the OUTER repository's pushes instead of wiring its own.
	// `--local` is this repository's own config file, shared by its worktrees,
	// which is what makes one install wire all of them.
	const local = gitProbe(["config", "--local", "--get", "core.hooksPath"], top);
	const effective = gitProbe(["config", "--get", "core.hooksPath"], top);
	if (local === hooksDir) {
		console.log(`hooks: core.hooksPath already points at ${hooksDir}.`);
	} else {
		const set = git(["config", "--local", "core.hooksPath", hooksDir], top);
		if (set.status !== 0) {
			throw new Error(
				`git config --local core.hooksPath failed (${(set.stderr || "").trim() || "no output"}), so pushes from this clone would stay ungated`,
			);
		}
		console.log(
			local
				? `hooks: the local core.hooksPath was ${local}; it now points at ${hooksDir}.`
				: `hooks: set the local core.hooksPath to ${hooksDir}.`,
		);
		if (effective && effective !== local) {
			// Replaced in the open rather than in silence: the local value wins, so
			// whatever configured hooksPath elsewhere is now inert for this clone.
			console.warn(
				`hooks: WARNING - a core.hooksPath is ALSO configured elsewhere (${effective}); the local value takes precedence, so this clone's pushes run this repository's hook and not that one.`,
			);
		}
		const disowned = join(commonDir, "hooks", HOOK_NAME);
		if (existsSync(disowned)) {
			// git ignores the hooks directory entirely once core.hooksPath is set,
			// so a pre-push that used to run there is not chained, it is disowned.
			console.warn(
				`hooks: WARNING - ${disowned} exists, and git IGNORES the whole hooks directory once core.hooksPath is set: that hook is disowned, not chained. Move it to .githooks/${HOOK_NAME} if it still needs to run.`,
			);
		}
	}
	if (
		gitProbe(["config", "--local", "--get", "core.hooksPath"], top) !== hooksDir
	) {
		throw new Error(
			`the local core.hooksPath does not read back as ${hooksDir} after writing it; pushes from this clone would run the wrong hook or none at all`,
		);
	}

	if (existsSync(tracked)) {
		console.log(
			`hooks: pre-push is wired for this clone - every worktree's push runs its own .githooks/${HOOK_NAME}, and a worktree whose branch carries none is refused rather than skipped.`,
		);
	} else {
		// Not fatal: the install is correct and the state is transient (a branch
		// that predates the hook), and failing an install for it would teach
		// people to skip the install. The push is where it has to be loud.
		console.warn(
			`hooks: WARNING - this checkout carries no .githooks/${HOOK_NAME}, so pushes FROM IT will be refused until its branch has one (fold origin/main in). The clone is wired; this worktree cannot be gated.`,
		);
	}
	return 0;
}

/** `--check`: report, change nothing, exit non-zero when pushes are not gated. */
function check({ top, hooksDir, dispatcher, tracked }) {
	const wired = gitProbe(["config", "--local", "--get", "core.hooksPath"], top);
	const problems = [];
	if (wired !== hooksDir) {
		problems.push(
			`core.hooksPath is ${wired ?? "unset"}, not ${hooksDir} - run: pnpm hooks:install`,
		);
	}
	if (!dispatcherIsCurrent(dispatcher)) {
		problems.push(
			`the dispatcher at ${dispatcher} is missing, stale or not executable - run: pnpm hooks:install`,
		);
	}
	if (!existsSync(tracked)) {
		problems.push(
			`this checkout carries no .githooks/${HOOK_NAME}, so pushes from it are refused - fold origin/main in`,
		);
	}
	if (problems.length) {
		console.error("hooks: FAILED - pushes from this checkout are not gated:");
		for (const problem of problems) console.error(`  - ${problem}`);
		return 1;
	}
	console.log(
		`hooks: OK - pushes from this checkout run .githooks/${HOOK_NAME} via ${dispatcher}.`,
	);
	return 0;
}

if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(`hooks: FAILED to run: ${error.message}`);
		process.exitCode = 1;
	}
}
