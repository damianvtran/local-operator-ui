#!/usr/bin/env node
/**
 * Runs the desktop test files under a concurrency cap this machine can sustain.
 *
 *     node scripts/run-desktop-tests.mjs scripts/*.test.mjs
 *     node scripts/run-desktop-tests.mjs --test-concurrency=12 scripts/*.test.mjs
 *
 * `pnpm test:desktop` invokes this instead of `node --test` so the cap in
 * `desktop-test-concurrency.mjs` applies without every caller having to
 * remember it. The reasoning for the cap, and for every constant in it, is in
 * that file's docstring.
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
 * that was killed is worse than no wrapper.
 */

import { spawn } from "node:child_process";
import {
	formatDesktopTestConcurrencyLine,
	resolveDesktopTestConcurrency,
} from "./desktop-test-concurrency.mjs";

const args = process.argv.slice(2);

// Both spellings node accepts. Detecting only the `=` form would let
// `--test-concurrency 12` slip past the governor and be capped anyway, which is
// exactly the silent override this branch exists to prevent.
const explicitFlag = args.find(
	(arg) => arg === "--test-concurrency" || arg.startsWith("--test-concurrency="),
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
	console.log(
		`desktop tests: ${fileCount} files, concurrency ${value} (explicit ${explicitFlag} in argv; governor bypassed)`,
	);
}
nodeArgs.push(...args);

const child = spawn(process.execPath, nodeArgs, { stdio: "inherit" });

// Forward the signals a user or CI actually sends, so Ctrl-C interrupts the
// suite rather than leaving it orphaned behind a killed wrapper.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		if (child.exitCode === null && child.signalCode === null) child.kill(signal);
	});
}

child.on("exit", (code, signal) => {
	if (signal !== null) {
		// The child was killed. Report the same death for this process instead
		// of a fabricated exit code: `exitCode` would flatten "the suite was
		// interrupted" into an ordinary success or failure, and every caller
		// that inspects the status (CI, a shell `&&`, a signal death in a
		// pipeline) would then be told the wrong thing.
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeAllListeners(sig);
		process.kill(process.pid, signal);
		return;
	}
	process.exitCode = code ?? 1;
});
