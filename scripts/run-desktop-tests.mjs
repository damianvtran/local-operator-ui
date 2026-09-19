#!/usr/bin/env node
/**
 * Runs the desktop test files under a concurrency cap this machine can sustain.
 *
 *     node scripts/run-desktop-tests.mjs scripts/*.test.mjs
 *     node scripts/run-desktop-tests.mjs --test-concurrency=12 scripts/*.test.mjs
 *     node scripts/run-desktop-tests.mjs --scope=origin/main
 *
 * `pnpm test:desktop` invokes this instead of `node --test` so the cap in
 * `desktop-test-concurrency.mjs` applies without every caller having to
 * remember it. The reasoning for the cap, and for every constant in it, is in
 * that file's docstring.
 *
 * `--scope[=<ref>]` (`pnpm test:desktop:changed`) computes its own file list
 * from `desktop-test-scope.mjs` instead of taking one: the files a diff can
 * reach, or the WHOLE suite when that module refuses to narrow, or NO files when
 * nothing in the suite can be observing the diff. It is the same runner and the
 * same cap either way, and it prints which of the three it decided before the
 * first test - the line is what a reviewer reads to know what actually ran. The
 * scope decision is never allowed to shrink silently: every mode is announced,
 * and `--scope` alongside an explicit file list is a usage error rather than a
 * union nobody asked for.
 *
 * Two escape hatches, and they behave differently on purpose:
 *
 *  - An explicit `--test-concurrency=N` anywhere in argv BYPASSES the governor
 *    entirely and is forwarded untouched (mirrors "an explicit `-n` bypasses
 *    the hook" in local-operator's pytest cap). Whoever passed it knows how
 *    wide they want to run; the governor has nothing to add and must not
 *    quietly override it.
 *  - `LOCAL_OPERATOR_UI_TEST_CONCURRENCY` overrides the number without bypassing
 *    the runner. Either way the resolved value is printed, so the line is
 *    evidence for what actually ran rather than a claim about what the governor
 *    would have done.
 *
 * The child's exit code is forwarded unchanged and its death by signal is
 * re-raised on this process, because a wrapper that reports success for a suite
 * that was killed is worse than no wrapper. For the same reason the child does
 * not inherit `NODE_TEST_CONTEXT`: node exports that variable into every
 * test-file process, and a nested `node --test` that sees it skips running the
 * files entirely and exits 0, so passing it through would make this runner
 * report success for a suite that never ran. See `_TEST_CONTEXT_ENV`.
 */

import { spawn } from "node:child_process";
import {
	OVERRIDE_ENV,
	formatDesktopTestConcurrencyLine,
	resolveDesktopTestConcurrency,
} from "./desktop-test-concurrency.mjs";
import {
	SCOPE_MODES,
	formatScopeLine,
	planFromGit,
	readSuiteFiles,
} from "./desktop-test-scope.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";

/**
 * Node's test runner exports this into every test-file process. An inherited
 * copy makes a nested `node --test` treat itself as recursive: it warns
 * (`node:test run() is being called recursively within a test file. skipping
 * running files.`), runs NO files — 0 bytes on stdout — and **exits 0**.
 * Measured on node 26.5.0, and it is why this filter is not cosmetic: a caller
 * who exports the variable into `pnpm test:desktop` would get a green status
 * for a suite that nothing ran, which is the exact false-green this runner
 * exists not to propagate.
 *
 * ONLY this key is filtered. It is node's own marker for "this process is
 * already inside a test run", not a knob a test could legitimately read, and
 * filtering anything else would make a test file behave differently under this
 * runner than when node runs it directly.
 */
const _TEST_CONTEXT_ENV = "NODE_TEST_CONTEXT";

/** A positive whole number of workers, which is all node's flag accepts. */
const WORKER_COUNT_PATTERN = /^\d+$/;

const rawArgs = process.argv.slice(2);

/*
 * `--scope` is resolved BEFORE anything counts files, because it decides the
 * file list: the concurrency line has to report the number of files that will
 * actually run, and a count taken from the pre-scope argv would be a claim about
 * the suite rather than about this run.
 */
const scopeArg = rawArgs.find(
	(arg) => arg === "--scope" || arg.startsWith("--scope="),
);
const args = rawArgs.filter((arg) => arg !== scopeArg);

if (scopeArg !== undefined) {
	// A union of "the diff's files" and "the files you named" is not a scope any
	// rule here computed, and silently running it would make the printed reason
	// wrong; refusing is the only answer that keeps the line evidence.
	const named = args.filter((arg) => !arg.startsWith("-"));
	if (named.length > 0) {
		console.error(
			`desktop tests: --scope computes its own file list; pass either --scope or explicit files, not both (got ${named.length} file argument(s)).`,
		);
		process.exit(2);
	}
	const since = scopeArg.includes("=")
		? scopeArg.slice(scopeArg.indexOf("=") + 1)
		: "origin/main";
	if (!since) {
		console.error(
			"desktop tests: --scope needs a base ref (e.g. --scope=origin/main)",
		);
		process.exit(2);
	}
	const plan = planFromGit({ root: process.cwd(), since });
	console.log(formatScopeLine(plan));
	if (plan.mode === SCOPE_MODES.NONE) {
		// An empty run is a real answer here and not an error: the classifier or
		// the reachability graph proved nothing in the suite can see this diff.
		// It exits 0 with the line above saying so, rather than being flattened
		// into "the suite passed".
		console.log(
			"desktop tests: no files to run; nothing in the suite can observe this diff",
		);
		process.exit(0);
	}
	const full =
		plan.mode === SCOPE_MODES.WHOLE ? readSuiteFiles(process.cwd()) : [];
	if (plan.mode === SCOPE_MODES.WHOLE && full.length === 0) {
		console.error(
			"desktop tests: the scope refused to narrow (see the line above) and package.json's test:desktop list could not be read, so the whole suite cannot be spelled",
		);
		process.exit(2);
	}
	args.push(...(plan.mode === SCOPE_MODES.WHOLE ? full : plan.files));
	if (
		process.env.LOCAL_OPERATOR_UI_SCOPE_EXPLAIN === "1" &&
		plan.files.length > 0
	) {
		for (const [file, why] of plan.detail.reasons ?? []) {
			console.log(`desktop scope:   ${file} - ${why}`);
		}
	}
}

// Both spellings node accepts. Detecting only the `=` form would let
// `--test-concurrency 12` slip past the governor and be capped anyway, which is
// exactly the silent override this branch exists to prevent.
const explicitFlag = args.find(
	(arg) =>
		arg === "--test-concurrency" || arg.startsWith("--test-concurrency="),
);

// The evidence line reports how many test files the run covers, so it must not
// count flags or the value slot of a bare `--test-concurrency 12` as a file.
const fileCount = args.filter((arg, index) => {
	if (arg.startsWith("--test-concurrency")) return false;
	if (index > 0 && args[index - 1] === "--test-concurrency") return false;
	return !arg.startsWith("-");
}).length;

const nodeArgs = ["--test"];
if (explicitFlag === undefined) {
	const decision = resolveDesktopTestConcurrency();
	// Pass no cap rather than `--test-concurrency=null` when the decision has no
	// number: the only arm that can produce one is the CI stand-down, whose whole
	// promise is to change nothing, and node's own default is exactly that.
	if (Number.isFinite(decision.concurrency)) {
		nodeArgs.push(`--test-concurrency=${decision.concurrency}`);
	}
	console.log(formatDesktopTestConcurrencyLine(decision, fileCount));
} else {
	const value = explicitFlag.includes("=")
		? explicitFlag.slice(explicitFlag.indexOf("=") + 1)
		: args[args.indexOf(explicitFlag) + 1];
	// A valueless or malformed flag is a usage error and must not be reported as
	// a cap. It used to print `concurrency undefined` / `0 files` and then hand
	// the malformed argv to node, which for the `=abc` and `=0` forms ACCEPTED
	// it, ran the suite at node's default width and exited with the suite's own
	// status — a silent, uncapped run behind a line that claimed a cap. That is
	// what this check replaces. Exit 9 is deliberate: it matches node only for
	// the absent and empty values (`node --test --test-concurrency` exits 9 with
	// "requires an argument"), and for a non-numeric or zero value we are
	// STRICTER than node on purpose, while the message names the governor's own
	// override as the way to get an uncapped run.
	if (
		value === undefined ||
		!WORKER_COUNT_PATTERN.test(value) ||
		Number(value) < 1
	) {
		console.error(
			`desktop tests: ${explicitFlag} needs a positive whole number` +
				`${value === undefined ? " (none given)" : ` (got ${JSON.stringify(value)})`}.` +
				` Use --test-concurrency=N, or set ${OVERRIDE_ENV} to override the governor's own number.`,
		);
		process.exit(9);
	}
	console.log(
		`desktop tests: ${fileCount} file${fileCount === 1 ? "" : "s"}, concurrency ${value} (explicit ${explicitFlag} in argv; governor bypassed)`,
	);
}
nodeArgs.push(...args);

/*
 * The suite's children get the notification kill switch set, alongside the one
 * key filtered out above, and for the same reason this runner exists at all:
 * a caller must not have to remember either of them. These test files boot the
 * real app, the app spawns a real backend, and that backend's parked-gate
 * announcement reaches macOS through `osascript`, whose banner lands in the
 * operator's Notification Center attributed to Script Editor. That is not a
 * sandbox and a suite must not be able to write there; see
 * `notifications-off.mjs` for the whole path and for the two deliberate
 * exceptions.
 */
const childEnv = withNotificationsOff(
	Object.fromEntries(
		Object.entries(process.env).filter(([key]) => key !== _TEST_CONTEXT_ENV),
	),
);
const child = spawn(process.execPath, nodeArgs, {
	stdio: "inherit",
	env: childEnv,
});

// Forward the signals a user or CI actually sends, so Ctrl-C interrupts the
// suite rather than leaving it orphaned behind a killed wrapper.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		if (child.exitCode === null && child.signalCode === null)
			child.kill(signal);
	});
}

child.on("exit", (code, signal) => {
	if (signal !== null) {
		// The child was killed. Report the same death for this process instead
		// of a fabricated exit code: `exitCode` would flatten "the suite was
		// interrupted" into an ordinary success or failure, and every caller
		// that inspects the status (CI, a shell `&&`, a signal death in a
		// pipeline) would then be told the wrong thing.
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
			process.removeAllListeners(sig);
		process.kill(process.pid, signal);
		return;
	}
	process.exitCode = code ?? 1;
});
