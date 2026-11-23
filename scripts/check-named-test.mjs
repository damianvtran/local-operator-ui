#!/usr/bin/env node
/**
 * Run ONE named test out of a test file and prove it actually passed.
 *
 * WHY THIS EXISTS
 * ---------------
 * A CI job that runs `node --test --test-name-pattern=<name> <file>` can sit for
 * the job's whole timeout instead of failing when <name> matches nothing: Node
 * still loads the module, and the module's own teardown usually lives inside a
 * test body, so a module-scope handle (timer, server, watcher) is never released
 * and the run never exits. Measured: a file whose only test clears a module-scope
 * `setInterval` exits 0 in <1s when the filter matches and hangs indefinitely
 * when it does not; a plain file exits promptly either way. Two pull requests cut
 * before the regression test landed were cancelled at the 10 minute job timeout
 * for exactly this reason.
 *
 * Two separate hazards, both real:
 *   1. the filtered name does not exist at that revision  -> hang (above);
 *   2. the filtered name exists but emits no passing row   -> Node can exit 0
 *      with nothing run (a name that appears only in a comment, a skipped row,
 *      a renamed test).
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   - An absent name fails IMMEDIATELY and says what to do about it, instead of
 *     burning the job timeout (exit 2).
 *   - A run that outlives its own bound is killed, its process group with it, and
 *     reported as a timeout rather than a hang (exit 3).
 *   - Success requires the exact numbered passing row `ok <n> - <name>`, with no
 *     `# SKIP`/`# TODO` directive, so hazard 2 cannot pass silently (exit 1).
 *
 * CONSTRAINTS
 * -----------
 * - Dependency-free on purpose: it runs before `pnpm install` in some jobs, and
 *   it must not add weight to the CI surface it is guarding.
 * - The name is matched literally and anchored; a newline or a regex
 *   metacharacter in the name is rejected rather than silently reinterpreted.
 * - The child runs in its own process group so a timeout kills any grandchildren
 *   the test file spawned; a plain `child.kill()` leaves those holding the pipe.
 *
 * Usage:
 *   node scripts/check-named-test.mjs --file scripts/browser-host.test.mjs \
 *     --name "owner_finish stays pending during a passkey prompt and retries the exact allocation" \
 *     [--timeout-ms 300000]
 *
 * Exit codes: 0 exact passing row found; 1 run finished without that row;
 * 2 name absent from the file (stale revision); 3 timeout; 64 usage error.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const EXIT_OK = 0;
const EXIT_NO_ROW = 1;
const EXIT_NAME_ABSENT = 2;
const EXIT_TIMEOUT = 3;
const EXIT_USAGE = 64;

/** Parse `--key value` pairs; unknown or missing keys are usage errors. */
function parseArgs(argv) {
	const allowed = new Set(["file", "name", "timeout-ms"]);
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			throw new Error(`unexpected argument: ${token}`);
		}
		const key = token.slice(2);
		if (!allowed.has(key)) throw new Error(`unknown option: ${token}`);
		const value = argv[i + 1];
		if (value === undefined) throw new Error(`missing value for ${token}`);
		out[key] = value;
		i += 1;
	}
	if (!out.file || !out.name) throw new Error("--file and --name are required");
	if (out.name.includes("\n")) throw new Error("--name must be a single line");
	const timeoutMs =
		out["timeout-ms"] === undefined ? 300_000 : Number(out["timeout-ms"]);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("--timeout-ms must be a positive number");
	}
	return { file: out.file, name: out.name, timeoutMs };
}

function fail(code, message) {
	console.error(`::error::${message}`);
	process.exit(code);
}

/**
 * Escape a literal test name for use inside an anchored regular expression.
 * The name is data from a caller's source, not a pattern.
 */
function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The child's environment: this process's, minus the marker a parent test
 * runner leaves behind. With it set, `node --test` inside the child skips every
 * file and exits zero, which would turn this check into a guaranteed false pass.
 */
function childEnv() {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key !== "NODE_TEST_CONTEXT") env[key] = value;
	}
	return env;
}

/**
 * Kill the child and anything it spawned. The child is detached into its own
 * process group, so a negative pid reaches the whole tree.
 */
function killTree(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		// Already gone, or the group id was reaped: nothing left to kill.
	}
}

function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		fail(
			EXIT_USAGE,
			`${error.message}\nusage: check-named-test.mjs --file <path> --name <exact test name> [--timeout-ms <ms>]`,
		);
		return;
	}

	let source;
	try {
		source = readFileSync(args.file, "utf8");
	} catch (error) {
		fail(EXIT_USAGE, `cannot read ${args.file}: ${error.message}`);
		return;
	}

	// Hazard 1, caught before a single test runs: the name this job exists to
	// prove is not in this revision at all, so the revision is simply older than
	// the test. Say so instead of hanging until the job timeout.
	if (!source.includes(args.name)) {
		fail(
			EXIT_NAME_ABSENT,
			`the test "${args.name}" is not present in ${args.file} at this revision, so there is nothing to verify. This branch predates that test - update it from the base branch (merge the base in) and let the job run again.`,
		);
		return;
	}

	const child = spawn(
		process.execPath,
		[
			"--test",
			"--test-reporter=tap",
			`--test-name-pattern=^${escapeRegex(args.name)}$`,
			args.file,
		],
		{
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			// If this helper is itself started by a test runner, the inherited
			// marker makes the child refuse to run any file ("node:test run() is
			// being called recursively ... skipping running files") and exit 0 -
			// a false pass that reports no row. Drop it so the nested run is real.
			env: childEnv(),
		},
	);

	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		killTree(child);
	}, args.timeoutMs);

	child.on("close", (code, signal) => {
		clearTimeout(timer);

		if (timedOut) {
			process.stderr.write(stdout);
			process.stderr.write(stderr);
			fail(
				EXIT_TIMEOUT,
				`node --test for "${args.name}" did not finish within ${Math.round(args.timeoutMs / 1000)}s and was killed (signal ${signal ?? "none"}). A run that outlives its bound is a failure, not a pass, and not a hang.`,
			);
			return;
		}

		// Hazard 2: require the exact numbered passing row, so a filter that
		// matched nothing, a skipped row, or a renamed test cannot look green.
		const rowPattern = new RegExp(
			`^ok [0-9]+ - ${escapeRegex(args.name)}$`,
			"m",
		);
		if (!rowPattern.test(stdout)) {
			process.stderr.write(stdout);
			process.stderr.write(stderr);
			fail(
				EXIT_NO_ROW,
				`node --test finished (exit ${code ?? "none"}) without an exact passing row "ok <n> - ${args.name}". A filtered run that reports no such row has not verified anything, even when it exits zero.`,
			);
			return;
		}

		process.stdout.write(`verified exact passing row: ${args.name}\n`);
		process.exit(EXIT_OK);
	});
}

main();
