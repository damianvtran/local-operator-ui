import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The user's own PATH: how it is asked for, what is accepted as an answer, and
 * that the two consumers actually use it.
 *
 * WHY THE RESOLVER EXISTS is measured, not aesthetic, and it lives in the
 * module's own docstring (`src/main/shell-path.ts`): the app is launchd-started
 * from Finder, so its process PATH is `/usr/bin:/bin:/usr/sbin:/sbin`, and a
 * console surface asked to run `brew` cannot find it. The cases below are the
 * ways that resolution can go wrong on a real machine, each made deterministic
 * by injecting the shell runner:
 *
 *   - the user's rc prints a banner (a version manager's notice) around the
 *     value: an answer that is not the value must not be read as one;
 *   - the value itself is unusual (an empty element, a trailing `:`) and must
 *     survive byte for byte, because trimming a PATH corrupts it;
 *   - the shell prints nothing, is not executable, or never returns at all;
 *   - `$SHELL` is unset or is not an absolute path - the same rule
 *     `defaultShell` applies, asserted here so the two cannot disagree;
 *   - Windows, where this module must not start a shell at all.
 *
 * The bundle is the shipped TypeScript, in memory, the way
 * `python-bytecode-cache.test.mjs` and `console-host.test.mjs` do it, so what
 * runs here is the code that ships rather than a copy of its rules. One case
 * goes further and drives a REAL shell process, because a fake runner can only
 * prove the parsing and never the plumbing that carries the bytes back.
 *
 * WHAT THIS FILE DOES NOT CLAIM: that a real console surface in the running app
 * resolves `brew`. That requires the built app as the console host, and the
 * operator's own app owns the machine's single instance; the wiring that would
 * make it true is pinned structurally below instead, and the PR body records
 * what was and was not exercised.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/shell-path";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	SHELL_PATH_ANSWER_GRACE_MS,
	SHELL_PATH_ARGS,
	SHELL_PATH_BEGIN,
	SHELL_PATH_END,
	SHELL_PATH_TIMEOUT_MS,
	USER_SHELL_PATH_MAX_ATTEMPTS,
	createUserShellPath,
	defaultShell,
	mergeShellPath,
	resolveLoginShellPath,
	withUserShellPath,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/** A runner a test drives by hand, recording what the resolver asked it. */
function fakeRunner(answer) {
	const calls = [];
	return {
		calls,
		run: async (input) => {
			calls.push(input);
			return answer(input);
		},
	};
}

/** What a shell would print for `path`, sentinels and all. */
function wrapped(path) {
	return `${SHELL_PATH_BEGIN}${path}${SHELL_PATH_END}`;
}

test("the shell is asked as a LOGIN and INTERACTIVE shell, printing only $PATH", async () => {
	const { calls, run } = fakeRunner(() => ({
		stdout: wrapped("/opt/homebrew/bin:/usr/bin:/bin"),
	}));
	const result = await resolveLoginShellPath({
		env: { SHELL: "/bin/zsh" },
		run,
	});

	assert.equal(result.ok, true);
	assert.equal(result.path, "/opt/homebrew/bin:/usr/bin:/bin");
	assert.equal(result.shell, "/bin/zsh");
	assert.equal(calls.length, 1);
	// Both halves matter, and each is a different file: `-l` reads `.zprofile`,
	// where Homebrew's `shellenv` line lives on Apple silicon, and `-i` reads
	// `.zshrc`, where the version managers put theirs. The terminal a user types
	// in is both, so a resolution missing either is a PATH the user does not
	// have - which was the defect.
	assert.deepEqual(calls[0].args, [...SHELL_PATH_ARGS]);
	assert.ok(calls[0].args.includes("-l"), "the login half was dropped");
	assert.ok(calls[0].args.includes("-i"), "the interactive half was dropped");
	assert.equal(calls[0].args.at(-1).includes("$PATH"), true);
	// The child is given a bound of its own; the answer has a longer one, and the
	// ordering is what makes "timeout" mean the same thing whichever fires.
	assert.equal(calls[0].timeoutMs, SHELL_PATH_TIMEOUT_MS);
	assert.ok(SHELL_PATH_ANSWER_GRACE_MS > 0);
});

test("a banner around the value is not part of the value", async () => {
	// Both sides: a version manager notice before the sentinels and a closing
	// remark after them. An rc writing to stdout is normal, not an error.
	const { run } = fakeRunner(() => ({
		stdout: [
			"Now using node v24.18.1 (npm v11)",
			`${wrapped("/opt/homebrew/bin:/usr/bin:/bin")}`,
			"pyenv: shell integration was installed",
			"",
		].join("\n"),
	}));
	const result = await resolveLoginShellPath({
		env: { SHELL: "/bin/zsh" },
		run,
	});
	assert.equal(result.ok, true);
	assert.equal(result.path, "/opt/homebrew/bin:/usr/bin:/bin");
});

test("the value survives byte for byte, empty elements and all", async () => {
	// A PATH may legitimately begin or end with `:` (an empty element means the
	// current directory) and may contain spaces in a directory name. Trimming it,
	// or splitting and re-joining it, would be a silent corruption of the user's
	// environment rather than a tidy-up.
	for (const path of [
		"/usr/bin:/opt/homebrew/bin:",
		":/usr/bin",
		"/Applications/My App/bin:/usr/bin",
		"/usr/bin::/bin",
	]) {
		const { run } = fakeRunner(() => ({ stdout: wrapped(path) }));
		const result = await resolveLoginShellPath({
			env: { SHELL: "/bin/zsh" },
			run,
		});
		assert.equal(result.ok, true, `${path} was refused`);
		assert.equal(result.path, path);
	}
});

test("a shell that answers with nothing is not an answer", async () => {
	// Three shapes of "no": an empty stream (a shell killed by its rc), a banner
	// and no more, and the sentinels with an empty value between them (an rc that
	// unsets PATH). Each keeps the caller on the PATH it already had.
	for (const stdout of ["", "zsh: command not found: nvm\n", wrapped("")]) {
		const { run } = fakeRunner(() => ({ stdout }));
		const result = await resolveLoginShellPath({
			env: { SHELL: "/bin/zsh" },
			run,
		});
		assert.equal(result.ok, false, `${JSON.stringify(stdout)} was accepted`);
		assert.equal(result.reason, "empty");
		assert.equal(result.path, undefined);
	}
});

test("a stream that repeats a sentinel is refused, not read as its first pair", async () => {
	/*
	 * THE FISH SHAPE (round-1 review R1-2), reproduced as bytes rather than as a
	 * shell: where `$PATH` is a LIST, `"$PATH"` expands to one argument per element
	 * and `printf` recycles its format - sentinels included - once per surplus
	 * argument, so the stream looks like this. Reading the first BEGIN..END pair
	 * would return ONE DIRECTORY and hand it to the backend and to every surface,
	 * which is worse than the bug this module fixes because nothing downstream can
	 * tell it is wrong. The answer is refused instead.
	 */
	const { run } = fakeRunner(() => ({
		stdout: [
			`${SHELL_PATH_BEGIN}/Users/someone/.local/bin${SHELL_PATH_END}`,
			`${SHELL_PATH_BEGIN}/usr/bin${SHELL_PATH_END}`,
			`${SHELL_PATH_BEGIN}/bin${SHELL_PATH_END}`,
		].join(""),
	}));
	const result = await resolveLoginShellPath({
		env: { SHELL: "/bin/zsh" },
		run,
	});
	assert.equal(result.ok, false);
	assert.equal(result.reason, "unparsable");
	assert.equal(result.path, undefined);
	// One pair is still read, so the guard is about repetition and not about the
	// sentinels themselves.
	const once = fakeRunner(() => ({ stdout: wrapped("/usr/bin:/bin") }));
	assert.equal(
		(await resolveLoginShellPath({ env: { SHELL: "/bin/zsh" }, run: once.run }))
			.path,
		"/usr/bin:/bin",
	);
});

test("a shell whose dialect this module does not speak is refused, not asked", async () => {
	// The other half of the same finding: the cheapest way to never mis-read a
	// list-valued or non-POSIX dialect is to not ask it at all. Each of these is a
	// shell whose PATH (or whose command syntax) this module cannot read, and the
	// answer is "no answer" - the caller keeps the PATH it already had.
	for (const shell of [
		"/opt/homebrew/bin/fish",
		"/usr/bin/nu",
		"/bin/tcsh",
		"/usr/local/bin/xonsh",
		"/opt/homebrew/bin/elvish",
		"/usr/bin/pwsh",
	]) {
		const { calls, run } = fakeRunner(() => ({ stdout: wrapped("/usr/bin") }));
		const result = await resolveLoginShellPath({ env: { SHELL: shell }, run });
		assert.equal(result.ok, false, `${shell} was asked`);
		assert.equal(result.reason, "unsupported-shell");
		assert.equal(calls.length, 0);
	}
	// The POSIX family IS asked, including the ones that are not macOS defaults.
	for (const shell of [
		"/bin/sh",
		"/bin/bash",
		"/bin/dash",
		"/bin/zsh",
		"/bin/ksh",
	]) {
		const { calls, run } = fakeRunner(() => ({ stdout: wrapped("/usr/bin") }));
		const result = await resolveLoginShellPath({ env: { SHELL: shell }, run });
		assert.equal(result.ok, true, `${shell} was refused`);
		assert.equal(calls.length, 1);
	}
});

test("a shell that never returns is bounded, and the bound is reported", async () => {
	// The pathological rc: it never finishes, so nothing it may have printed can
	// be trusted and the only honest answer is "no answer". The fake never
	// settles, which is what makes this the test of the ANSWER's own timer rather
	// than of the child's kill.
	const started = Date.now();
	const result = await resolveLoginShellPath({
		env: { SHELL: "/bin/zsh" },
		run: () => new Promise(() => {}),
		timeoutMs: 20,
	});
	const elapsed = Date.now() - started;
	assert.equal(result.ok, false);
	assert.equal(result.reason, "timeout");
	assert.ok(
		elapsed < SHELL_PATH_TIMEOUT_MS,
		`the bound did not fire: ${elapsed}ms`,
	);
});

test("a runner that never settles still answers, even when nothing else holds the loop", () => {
	/*
	 * IN A CHILD PROCESS, because that is the only environment where this is
	 * observable on every node: the first CI run this branch ever had failed here,
	 * as `cancelledByParent` with "Promise resolution is still pending but the
	 * event loop has already resolved". The cause was an `unref()` on the answer
	 * timer, which read like hygiene and is the opposite of what that timer is for
	 * - the caller is AWAITING the promise it settles, so an unreferenced one lets
	 * the loop drain with nobody left to settle it. This machine's Node 26 hid it
	 * (the test runner keeps a handle alive past that point); CI's Node 22 did not.
	 *
	 * A child with nothing else pending asks the question directly: the timer must
	 * hold the loop and the answer must arrive. With the unref restored, the child
	 * exits with no output at all and this case is red.
	 */
	const dir = mkdtempSync(join(tmpdir(), "lo-shell-path-bound-"));
	try {
		writeFileSync(join(dir, "shell-path.mjs"), bundle.outputFiles[0].text);
		writeFileSync(
			join(dir, "runner.mjs"),
			[
				'const { resolveLoginShellPath } = await import("./shell-path.mjs");',
				"const started = Date.now();",
				"const result = await resolveLoginShellPath({",
				'\tenv: { SHELL: "/bin/zsh" },',
				"\ttimeoutMs: 120,",
				"\trun: () => new Promise(() => {}),",
				"});",
				"process.stdout.write(",
				"\tJSON.stringify({ result, elapsed: Date.now() - started }),",
				");",
			].join("\n"),
		);
		const child = spawnSync(process.execPath, ["runner.mjs"], {
			cwd: dir,
			encoding: "utf8",
			timeout: 30_000,
		});
		assert.equal(child.stdout, child.stdout, "sanity: the child ran");
		assert.notEqual(
			child.stdout,
			"",
			`the child exited before the bound could answer (status ${child.status}, stderr ${child.stderr}) - the answer timer is not holding the event loop`,
		);
		const { result, elapsed } = JSON.parse(child.stdout);
		assert.equal(result.ok, false);
		assert.equal(result.reason, "timeout");
		assert.ok(
			elapsed >= 120,
			`the bound answered in ${elapsed}ms, before the timeout it was given`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a run the runner cut short at the bound is a timeout, not an answer", async () => {
	// The runner is what knows its own deadline fired (see `ShellRunnerResult`),
	// and a shell killed mid-rc is not a shell that spoke nothing - nor is a
	// half-initialised PATH worth preferring to the one the app already had, so a
	// complete-looking value from a timed-out run is refused rather than used.
	const { run } = fakeRunner(() => ({
		stdout: wrapped("/partial/bin:/usr/bin"),
		timedOut: true,
	}));
	const result = await resolveLoginShellPath({
		env: { SHELL: "/bin/zsh" },
		run,
	});
	assert.equal(result.ok, false);
	assert.equal(result.reason, "timeout");
	assert.equal(result.path, undefined);
});

test("the bound ends a real hanging login shell, and reaps what it started", async (t) => {
	/*
	 * The two properties a fake cannot show, on a real `/bin/sh` and a real rc:
	 * the bound ENDS the run, and nothing the shell started outlives it.
	 *
	 * The second is why the runner spawns detached and kills the process GROUP,
	 * and it is measured rather than assumed: the thing that hangs is a GRANDCHILD
	 * (`sleep`, here), and a kill aimed at the shell alone leaves it running -
	 * reproduced on this machine, where a `sleep` in the rc was still listed after
	 * its shell was SIGKILLed, and for its full remaining duration. `/bin/sh` is
	 * the one login shell every runner this repo builds on has.
	 */
	if (process.platform === "win32") {
		t.skip("win32 has no login shell of this shape");
		return;
	}
	const shell = "/bin/sh";
	if (!existsSync(shell)) {
		t.skip(`${shell} is missing, so there is no login shell to hang`);
		return;
	}
	// A duration nothing else on this host would be running, so the search below
	// cannot match a stranger's process.
	const seconds = 300 + (process.pid % 100);
	const home = mkdtempSync(join(tmpdir(), "lo-shell-path-hang-"));
	writeFileSync(join(home, ".profile"), `sleep ${seconds}\n`);
	try {
		const started = Date.now();
		const result = await resolveLoginShellPath({
			env: { ...process.env, HOME: home, SHELL: shell },
			timeoutMs: 800,
		});
		const elapsed = Date.now() - started;
		assert.equal(result.ok, false);
		assert.equal(result.reason, "timeout");
		assert.ok(elapsed < 5_000, `the bound did not end the run: ${elapsed}ms`);
		// The kill is asynchronous with respect to this process, so give it a beat
		// before asking; a leaked child would still be there well beyond it.
		await new Promise((resolve) => setTimeout(resolve, 500));
		assert.deepEqual(
			sleepers(seconds),
			[],
			`the hanging child outlived the bound: ${sleepers(seconds).join(", ")}`,
		);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

/** This host's processes whose full command line is `sleep <seconds>`.
 *
 * `-f` on purpose: `pgrep -x` matches the process NAME, and `sleep` is a name
 * every `sleep` has, so a name match would report a stranger's process (and did,
 * while this case was being written). A missing `pgrep` answers nothing, which
 * this case treats as no evidence rather than as a pass.
 */
function sleepers(seconds) {
	const found = spawnSync("pgrep", ["-fl", `sleep ${seconds}`], {
		encoding: "utf8",
	});
	if (found.status !== 0 || !found.stdout) return [];
	return found.stdout.trim().split("\n").filter(Boolean);
}

test("a shell that cannot be started is a named reason, never a throw", async () => {
	const cases = [
		["ENOENT", "missing"],
		["EACCES", "not-executable"],
		["EPERM", "not-executable"],
		["UNKNOWN", "failed"],
	];
	for (const [code, reason] of cases) {
		const error = new Error(`spawn failed (${code})`);
		error.code = code;
		const { run } = fakeRunner(() => {
			throw error;
		});
		const result = await resolveLoginShellPath({
			env: { SHELL: "/bin/zsh" },
			run,
		});
		assert.equal(result.ok, false);
		assert.equal(result.reason, reason);
		assert.equal(result.shell, "/bin/zsh");
	}
	// A runner that rejects with something that is not an Error is still a
	// reason, not an exception escaping into the app's startup.
	const { run } = fakeRunner(() => Promise.reject("not an error"));
	const result = await resolveLoginShellPath({
		env: { SHELL: "/bin/zsh" },
		run,
	});
	assert.equal(result.ok, false);
	assert.equal(result.reason, "failed");
});

test("$SHELL unset, empty, or not absolute falls back to the same shell defaultShell names", async () => {
	// One answer to "which shell is the user's", asserted by comparing the two
	// callers rather than by restating the fallback: the shell the resolver asks
	// is the shell a surface would run.
	for (const env of [
		{ SHELL: undefined },
		{ SHELL: "" },
		{ SHELL: "   " },
		// Relative: a shell resolved against whatever directory the app happens to
		// be in is not a shell this app will exec.
		{ SHELL: "zsh" },
	]) {
		const { calls, run } = fakeRunner(() => ({ stdout: wrapped("/usr/bin") }));
		await resolveLoginShellPath({ env, run });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].shell, defaultShell(env));
		// The fallback is a real shell on this machine, not a literal this test
		// restates (round-1 review R1-3 changed it per platform).
		assert.ok(calls[0].shell.startsWith("/bin/"));
	}
	// And a shell that IS named absolutely is the one asked, fallback or not.
	const { calls, run } = fakeRunner(() => ({ stdout: wrapped("/usr/bin") }));
	await resolveLoginShellPath({ env: { SHELL: "/opt/homebrew/bin/zsh" }, run });
	assert.equal(calls[0].shell, "/opt/homebrew/bin/zsh");
});

test("the fallback shell is the platform's own, and only one that is actually there", () => {
	// Round-1 review R1-3 / QA's Q-6: `/bin/zsh` was the fallback everywhere, which
	// on a Linux box without zsh meant ENOENT, a `missing` line and the whole
	// resolution doing nothing. The probe is injected here so the policy is
	// asserted over filesystems this machine does not have.
	const only =
		(...present) =>
		(path) =>
			present.includes(path);
	assert.equal(
		defaultShell({}, { platform: "darwin", exists: only("/bin/zsh") }),
		"/bin/zsh",
	);
	assert.equal(
		defaultShell({}, { platform: "linux", exists: only("/bin/bash") }),
		"/bin/bash",
	);
	// No zsh, no bash: the POSIX shell is the last resort rather than an ENOENT.
	assert.equal(
		defaultShell({}, { platform: "linux", exists: only("/bin/sh") }),
		"/bin/sh",
	);
	// zsh present on linux is still used, because it is what the user's session has.
	assert.equal(
		defaultShell(
			{},
			{ platform: "linux", exists: only("/bin/bash", "/bin/zsh") },
		),
		"/bin/bash",
	);
	// An absolute `$SHELL` outranks every candidate, wherever it points.
	assert.equal(
		defaultShell(
			{ SHELL: "/opt/homebrew/bin/fish" },
			{ platform: "darwin", exists: () => false },
		),
		"/opt/homebrew/bin/fish",
	);
});

test("Windows is not this module's platform: no shell is started", async () => {
	// The backend keeps its registry and user-profile resolution there, and
	// starting a POSIX login shell on win32 would be a second, wrong answer.
	const { calls, run } = fakeRunner(() => ({ stdout: wrapped("/usr/bin") }));
	const result = await resolveLoginShellPath({ platform: "win32", run });
	assert.equal(result.ok, false);
	assert.equal(result.reason, "unsupported-platform");
	assert.equal(result.shell, null);
	assert.equal(calls.length, 0);
});

test("one resolver, one shell: the second ask is answered from the first", async () => {
	const { calls, run } = fakeRunner(() => ({
		stdout: wrapped("/x/bin:/usr/bin"),
	}));
	const resolver = createUserShellPath({ run, env: { SHELL: "/bin/zsh" } });
	assert.equal(await resolver.resolve(), "/x/bin:/usr/bin");
	assert.equal(await resolver.resolve(), "/x/bin:/usr/bin");
	// The app asks twice - the backend and the console host - and a second shell
	// per ask would be a second answer waiting to differ.
	assert.equal(calls.length, 1);
});

test("a failure is retried on a later ask, and the retries are capped", async () => {
	/*
	 * Round-1 review R1-5: a FAILED first resolution used to be memoized for the
	 * life of the process, so one launch whose rc was slow (an `nvm`/`conda` init
	 * fetching, a cold cache) kept the launchd PATH until the app quit - the very
	 * failure this module exists to remove, made permanent and invisible. A success
	 * is still memoized forever; a failure is retried, up to
	 * `USER_SHELL_PATH_MAX_ATTEMPTS`, so a permanently broken shell cannot start a
	 * child per ask for the rest of the session.
	 */
	let attempts = 0;
	const lines = [];
	const recovering = createUserShellPath({
		run: async () => {
			attempts += 1;
			return attempts === 1
				? { stdout: "" }
				: { stdout: wrapped("/x/bin:/usr/bin") };
		},
		env: { SHELL: "/bin/zsh" },
		log: (message) => lines.push(message),
	});
	assert.equal(await recovering.resolve(), null);
	// The second ask is a NEW shell rather than the memoized failure.
	assert.equal(await recovering.resolve(), "/x/bin:/usr/bin");
	assert.equal(attempts, 2);
	assert.match(lines[0], /attempt 1\/3/);
	assert.match(lines[0], /a later ask will retry/);

	let brokenAttempts = 0;
	const broken = createUserShellPath({
		run: async () => {
			brokenAttempts += 1;
			throw Object.assign(new Error("no such shell"), { code: "ENOENT" });
		},
		env: { SHELL: "/bin/zsh" },
	});
	for (let ask = 0; ask < 5; ask += 1) {
		assert.equal(await broken.resolve(), null);
	}
	assert.equal(brokenAttempts, USER_SHELL_PATH_MAX_ATTEMPTS);

	// Concurrent askers still share ONE in-flight shell.
	let started = 0;
	const shared = createUserShellPath({
		run: async () => {
			started += 1;
			return { stdout: wrapped("/usr/bin") };
		},
		env: { SHELL: "/bin/zsh" },
	});
	await Promise.all([shared.resolve(), shared.resolve(), shared.resolve()]);
	assert.equal(started, 1);
});

test("a failed resolution still answers, with null, and says why", async () => {
	const lines = [];
	const error = new Error("no such shell");
	error.code = "ENOENT";
	const resolver = createUserShellPath({
		run: async () => {
			throw error;
		},
		env: { SHELL: "/bin/zsh" },
		log: (message) => lines.push(message),
	});
	assert.equal(await resolver.resolve(), null);
	assert.equal(await resolver.resolve(), null);
	// One line per ATTEMPT (the retry policy of R1-5), each naming the shell and
	// the reason rather than a bare null.
	assert.equal(lines.length, 2);
	for (const line of lines) {
		assert.match(line, /\/bin\/zsh/);
		assert.match(line, /missing/);
	}
});

test("withUserShellPath changes PATH and nothing else, and never the input", async () => {
	const base = { PATH: "/usr/bin:/bin", HOME: "/Users/someone", TERM: "xterm" };
	const resolver = { resolve: async () => "/opt/homebrew/bin:/usr/bin:/bin" };
	const env = await withUserShellPath(base, resolver);
	assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin:/bin");
	assert.equal(env.HOME, "/Users/someone");
	assert.equal(env.TERM, "xterm");

	/*
	 * AND THE LAUNCH PATH'S OWN ENTRIES SURVIVE (round-1 review Q-2). A launcher,
	 * installer or managed desktop can put a directory into an app's PATH so the
	 * app finds what it ships; replacing PATH outright would take it away from
	 * every surface, which is a regression from a change whose purpose is to make
	 * MORE tools reachable. The resolved entries keep priority, so a tool the user
	 * installed in their shell is never shadowed by an app-injected copy, and the
	 * launch-only directory ends up after them.
	 */
	const launchOnly = await withUserShellPath(
		{ ...base, PATH: "/qa-launch-only:/usr/bin:/bin" },
		resolver,
	);
	assert.equal(
		launchOnly.PATH,
		"/opt/homebrew/bin:/usr/bin:/bin:/qa-launch-only",
	);
	// The union itself, for the shapes an environment cannot easily produce here.
	assert.equal(mergeShellPath("/a:/b", undefined), "/a:/b");
	assert.equal(mergeShellPath("/a:/b", ""), "/a:/b");
	assert.equal(mergeShellPath("/a:/a:/b", "/b:/c"), "/a:/b:/c");
	// A copy, and the input untouched: the caller for the console is
	// `process.env`, and a mutation there would rewrite the app's own environment
	// for every other consumer.
	assert.notEqual(env, base);
	assert.equal(base.PATH, "/usr/bin:/bin");

	// No answer, or no resolver: the environment is handed on exactly as it was.
	for (const resolverOrNothing of [{ resolve: async () => null }, undefined]) {
		const untouched = await withUserShellPath(base, resolverOrNothing);
		assert.deepEqual(untouched, base);
		assert.notEqual(untouched, base);
	}

	// And the app's real environment is not what gets written to.
	const before = process.env.PATH;
	await withUserShellPath(process.env, resolver);
	assert.equal(process.env.PATH, before);
});

test("the shipped runner reports what a real shell printed", async () => {
	// A real child, a real shell, the real argument vector and the real parse -
	// the only case here that can fail on the plumbing (a dropped stdout chunk, a
	// child killed early, a shell that refuses the flags) rather than on the
	// reading of an answer. `/bin/sh` because it is the one shell every runner
	// this repo builds on has, and the flags are POSIX.
	const shell = "/bin/sh";
	assert.ok(
		existsSync(shell),
		`${shell} is missing; cannot drive a real shell`,
	);
	const env = { ...process.env, SHELL: shell };
	const result = await resolveLoginShellPath({ env, timeoutMs: 10_000 });
	assert.equal(result.ok, true, `the real shell answered ${result.reason}`);
	assert.equal(result.shell, shell);
	assert.ok(result.path.length > 0);
	assert.ok(result.path.includes("/"), `not a PATH: ${result.path}`);

	// The same command, run by hand, must agree: this is what makes the case
	// above evidence about the runner rather than about the parse.
	const direct = spawnSync(shell, [...SHELL_PATH_ARGS], {
		env,
		encoding: "utf8",
	});
	const from =
		direct.stdout.indexOf(SHELL_PATH_BEGIN) + SHELL_PATH_BEGIN.length;
	const to = direct.stdout.indexOf(SHELL_PATH_END, from);
	assert.equal(result.path, direct.stdout.slice(from, to));
});

/*
 * And the half a unit test cannot reach: that the app's two consumers ask this
 * module rather than resolving a PATH of their own. Read off the source, the way
 * `notification-launch.test.mjs` pins `backendSpawnEnv` and `console-wiring.mjs`
 * pins the construction site - a seam-injected test builds the option object
 * itself, so it can stay green while the app's copy drifts.
 */

/** The body of a method or function, by brace matching from the `{` that opens it.
 *
 * The parameter list is skipped first: a default such as
 * `options: StartOptions = {}` puts a brace INSIDE the signature, and a search
 * for the first brace after the name would return that empty pair instead of the
 * body (measured: it made this pin read `-1`). */
function bodyOf(source, opener, label) {
	const start = source.indexOf(opener);
	assert.notEqual(start, -1, `${label} is gone; this pin reads it`);
	let depth = 0;
	let i = source.indexOf("(", start);
	for (; i < source.length; i += 1) {
		if (source[i] === "(") depth += 1;
		else if (source[i] === ")") {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	depth = 0;
	i = source.indexOf("{", i);
	const bodyStart = i;
	for (; i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}") {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	return source.slice(bodyStart, i + 1);
}

test("the backend folds the resolver's PATH before it builds a spawn environment", () => {
	const source = readFileSync("src/main/backend/backend-service.ts", "utf8");
	// The fold exists, and it is the shared composition rather than a second
	// resolution written here.
	const settle = bodyOf(
		source,
		"private async settleUserShellPath(",
		"settleUserShellPath()",
	);
	assert.match(
		settle,
		/withUserShellPath\(this\.shellEnv, this\.userShellPath\)/,
	);
	// It is applied inside `loadShellEnvironment`, for every other reader of
	// `shellEnv`.
	assert.match(
		bodyOf(
			source,
			"private async loadShellEnvironment(",
			"loadShellEnvironment()",
		),
		/await this\.settleUserShellPath\(\)/,
	);
	// And it is AWAITED BEFORE the spawn environment is built, which is the whole
	// point: `loadShellEnvironment` is started un-awaited from the constructor, so
	// a fold that only happens there leaves the first spawn with the launchd PATH
	// on exactly the machines whose rc is slowest.
	const start = bodyOf(source, "private async startOwned(", "startOwned()");
	const folded = start.indexOf("await this.settleUserShellPath()");
	const built = start.indexOf("const env = this.backendSpawnEnv();");
	assert.notEqual(
		folded,
		-1,
		"startOwned() must fold the PATH before spawning",
	);
	assert.notEqual(built, -1, "the spawn environment is built elsewhere now");
	assert.ok(
		folded < built,
		"the PATH must be settled BEFORE the spawn environment is built",
	);
	// The other two terms of the spawn environment are untouched by this change:
	// the prefix is still applied at the spawn, and the kill switch still comes
	// from the launch snapshot last.
	const spawnEnv = bodyOf(
		source,
		"private backendSpawnEnv(",
		"backendSpawnEnv()",
	);
	assert.match(spawnEnv, /withPythonBytecodeCache\(this\.shellEnv/);
	assert.match(spawnEnv, /\.\.\.resolveNotificationLaunch\(launchEnv\)/);
});

test("the console host is handed an environment with the resolver's PATH", () => {
	const source = readFileSync("src/main/console/index.ts", "utf8");
	// The host's own `env` is what `surfaceEnvironment` builds a surface from, so
	// this is the one line that decides what a surface can run.
	assert.match(
		source,
		/env: await withUserShellPath\(process\.env, options\.userShellPath\)/,
		"startConsoleHost must hand ConsoleHost an env carrying the resolved PATH",
	);
	// Declared as an option at all: an option the host never names cannot be
	// forwarded by the app's call site, and the drift check reads this interface.
	assert.match(source, /userShellPath\?: UserShellPath;/);
});

test("the app builds ONE resolver and gives it to both consumers", () => {
	const source = readFileSync("src/main/index.ts", "utf8");
	const built = source.match(/createUserShellPath\(/g) ?? [];
	assert.equal(
		built.length,
		1,
		"one resolver per process: a second construction is a second shell and a second answer",
	);
	assert.match(source, /new BackendServiceManager\(\{ userShellPath \}\)/);
	// The console receives it through the browser host, which forwards it to the
	// console host (pinned by `scripts/console-wiring.mjs`, which fails on a
	// declared option the construction site does not forward).
	assert.match(source, /userShellPath,\n\t*\s*log: \(message\) =>/);
});
