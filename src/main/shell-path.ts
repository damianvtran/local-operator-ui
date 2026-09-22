import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";

/**
 * The PATH the user's own terminal has, resolved once, for the two places that
 * need it: a console surface's environment and the backend child's spawn
 * environment.
 *
 * WHY THIS EXISTS, MEASURED (2026-09-21, on the operator's machine). The app is
 * launched by launchd from Finder or the Dock, so it inherits the macOS default
 * environment rather than a shell's: `launchctl getenv PATH` is unset, the app's
 * own process carries `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, and its parent is pid
 * 1. Everything the user actually installed - Homebrew on Apple silicon, nvm,
 * pyenv, pnpm, cargo - lives outside that list. Concretely:
 *
 *   - a console surface started with `brew --version` cannot find `brew`;
 *   - `execute_bash` in the backend cannot either, because the backend's own
 *     resolution reads the wrong file (below). That is the false "not installed"
 *     a Homebrew-installed tool gets, and it is the enabler for acquiring tooling
 *     through the Console rather than shipping it at install time.
 *
 * WHAT WAS THERE BEFORE, AND WHY IT WAS NOT ENOUGH. `BackendServiceManager`
 * sourced the first of `~/.zshrc`/`~/.bash_profile`/`~/.bashrc`/`~/.profile`
 * through `/bin/bash` and merged the whole `env` dump it printed. Measured on the
 * same machine, its own log records
 * `PATH=/Users/damian/.bun/bin:/Users/damian/.local/bin:/Users/damian/.kimi-code/bin:/usr/bin:/bin:/usr/sbin:/sbin`
 * - the `.zshrc` exports, without Homebrew, because on Apple silicon Homebrew
 * writes its `shellenv` line into `~/.zprofile`, which only a LOGIN shell reads.
 * The user's terminal is a login AND interactive shell, and its PATH is the union
 * of both files. A PATH that differs from the terminal is the bug, so this asks
 * the shell the same way the terminal runs it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It resolves PATH and nothing else: an rc's
 * `PYTHONPATH`, proxy variables or a stray `LD_LIBRARY_PATH` reaching the backend
 * would be a new bug in the shape of a fix, so the value is extracted from
 * between sentinels rather than inherited, and only `PATH` is written back. It
 * also never throws and never rejects: a shell that is missing, broken, slow or
 * silent leaves every consumer exactly as it is today.
 *
 * AND IT IS NOT THE BACKEND'S WHOLE ENVIRONMENT (round-1 review N1, and QA's
 * Q-3, which measured the same thing). "PATH and nothing else" is a claim about
 * THIS module and the two values it writes. The backend's spawn environment is
 * still `loadShellEnvironment()`'s, and that method goes on merging the first of
 * `~/.zshrc`/`~/.bash_profile`/... into the same object, so an rc's `PYTHONPATH`,
 * proxy settings and `LD_LIBRARY_PATH` reach the backend on both sides of this
 * change. That is pre-existing, unchanged here and recorded rather than fixed:
 * scoping it is a separate change with its own blast radius (the file that does
 * it also carries variables a user's own tooling may depend on).
 *
 * AND IT RESOLVES A VALUE, NOT A SHELL. A shell this module cannot read is
 * refused rather than asked (see `isPosixShell` and `pathFromStdout`), because
 * the failure this guards against - a partial or wrong PATH - is worse than no
 * answer: no answer leaves the launch PATH, which at least resolves `/usr/bin`.
 */

/**
 * The sentinels the PATH is printed between.
 *
 * They exist because an rc file writing to stdout is NORMAL, not an error: a
 * version manager's "now using node v24" notice, a motd, a `pyenv init` warning.
 * Without them a line-orientation guess would read a banner as the answer. Printing
 * nothing on either side of the value also means nothing has to be trimmed out of
 * it - a PATH may legitimately begin or end with `:` (an empty element means the
 * current directory), so trimming would be a silent corruption.
 */
export const SHELL_PATH_BEGIN = "__LOCAL_OPERATOR_SHELL_PATH_BEGIN__";
export const SHELL_PATH_END = "__LOCAL_OPERATOR_SHELL_PATH_END__";

/**
 * How long the shell is given, in milliseconds, before it is killed.
 *
 * Measured on this machine: `zsh -l -i -c` from a clean environment answers in
 * 0.27 s (0.15 s without `-i`), so this is ~11x the observed cost. The ceiling is
 * not for the common case - it is for an rc that sources nvm, conda or pyenv,
 * which is seconds of work by design, and for the pathological rc that never
 * returns. Both consumers await this answer (see their call sites), so the number
 * is also the worst case they wait; a bound that never fires on a healthy machine
 * and always fires on a broken one is the shape wanted, rather than a generous
 * one that lets a broken rc stall the app.
 */
export const SHELL_PATH_TIMEOUT_MS = 3000;

/**
 * How much longer the ANSWER may take than the child's own bound.
 *
 * Ordered on purpose, not slack: the runner kills its child at
 * `SHELL_PATH_TIMEOUT_MS` and says so (`ShellRunnerResult.timedOut`), and this
 * second, longer timer exists only so that a runner which never settles cannot
 * hang a caller. Keeping the kill strictly first is what makes "timeout" mean the
 * same thing whichever fires - a child that was really killed, or an injected
 * runner that ignored its bound. It is also what keeps the timeout path testable
 * without waiting for a real timeout: a fake runner that never settles, plus a
 * small `timeoutMs`, exercises exactly this timer.
 */
export const SHELL_PATH_ANSWER_GRACE_MS = 500;

/**
 * What the shell is asked to run.
 *
 * `-l` for the login half and `-i` for the interactive half, which is what a
 * terminal window is, and WHICH FILES THAT ACTUALLY READS is worth naming because
 * a reader will otherwise assume the shorter list (round-1 review N2, measured
 * with a probe HOME): for zsh, `-l -i -c` reads `~/.zshenv`, `~/.zprofile`,
 * `~/.zshrc` AND `~/.zlogin`. Homebrew's `shellenv` lives in `~/.zprofile` on
 * Apple silicon and the version managers put their init lines in `~/.zshrc`,
 * which is why both halves are here - but anything a user puts in `.zshenv` or
 * `.zlogin` is part of the answer too, and that is intended: the question is what
 * the user's terminal has, not what one file has. bash reads `~/.bash_profile`
 * (or `~/.bash_login`, or `~/.profile`) and then `~/.bashrc` under the same pair
 * of flags; a POSIX `sh` reads `~/.profile`.
 *
 * `-c` means the command is given rather than read from stdin, so a closed stdin
 * cannot change the answer; stdin is /dev/null anyway (see the runner), which is
 * what stops an rc that calls `read` from blocking.
 *
 * `command printf` rather than a bare `printf`: with `-i` in effect, an rc's
 * alias or function named `printf` would otherwise be what runs. `command` is the
 * POSIX spelling that bypasses both.
 *
 * AND ONE ARGUMENT, ONE `%s` - which is a POSIX-shell fact, not a universal one.
 * A shell whose PATH is a LIST (fish expands `"$PATH"` to one argument per
 * element, and `printf` recycles its format for the surplus arguments) would make
 * this stream `BEGIN/aEND BEGIN/bEND ...`, and reading the first pair would hand
 * the app a SINGLE directory - worse than no answer, because no caller can tell
 * it is wrong. Two guards make that unreachable rather than unlikely: the shell
 * is refused by name when it is not one of the POSIX family (see
 * `isPosixShell`), and a stream that repeats a sentinel is refused outright (see
 * `pathFromStdout`), which is exactly the signature a recycled format leaves
 * behind.
 */
export const SHELL_PATH_ARGS = [
	"-l",
	"-i",
	"-c",
	`command printf '${SHELL_PATH_BEGIN}%s${SHELL_PATH_END}' "$PATH"`,
] as const;

/** Why no PATH could be read. Each is a condition a log line can name, and none
 * of them is fatal: the caller keeps the PATH it already had. */
export type ShellPathFailure =
	/** `$SHELL` could not be executed: it is not there. */
	| "missing"
	/** `$SHELL` is there and not executable (or not runnable by us). */
	| "not-executable"
	/** The shell did not answer inside the bound and was killed. */
	| "timeout"
	/** The shell ran and printed nothing between the sentinels: an rc that unsets
	 * or empties PATH, or a shell whose startup files never set one. */
	| "empty"
	/** The answer is not a single value: a sentinel appeared more than once, which
	 * is what a shell that expanded a LIST into several `printf` arguments leaves
	 * behind. Refused rather than read, because the first pair would be one
	 * directory out of many. */
	| "unparsable"
	/** `$SHELL` is not one of the POSIX-family shells whose dialect this module
	 * knows (`isPosixShell`), so it is not asked at all. */
	| "unsupported-shell"
	/** The shell could not be started at all for some other reason. */
	| "failed"
	/** Not a platform whose login shell this module speaks: win32, where the app
	 * keeps its registry/user-profile resolution. */
	| "unsupported-platform";

export type ShellPathResult =
	| { ok: true; path: string; shell: string }
	| {
			ok: false;
			reason: ShellPathFailure;
			/** The shell that was asked, or null when none was (win32). */
			shell: string | null;
			detail?: string;
	  };

/** What the runner is handed. `env` is the environment the child starts from -
 * the app's own, exactly like the terminal a user opens starts from its launch
 * environment. */
export interface ShellRunnerInput {
	shell: string;
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
}

/** What the runner must answer with. Only stdout, plus whether the run was cut
 * short at the bound: the exit status is not a verdict here, because a login
 * shell whose rc ends non-zero can still have printed the PATH, and the sentinels
 * are what decide whether it did. */
export interface ShellRunnerResult {
	stdout: string;
	/**
	 * True when this run was killed at `timeoutMs` rather than finishing.
	 *
	 * WHY THE RESOLVER IS TOLD, and not left to infer it from an empty stdout: a
	 * shell killed mid-rc is not a shell that answered nothing, and the two want
	 * different log lines. Measured with a real `/bin/zsh` whose `~/.zshrc` runs
	 * `sleep 30`: the child is killed at the bound and the pipe closes with nothing
	 * in it, so an empty stdout alone reports "empty" - a statement about the
	 * shell's output that hides the fact that this module stopped it.
	 */
	timedOut?: boolean;
}

/**
 * How a shell is started.
 *
 * Injected on purpose: this is what lets the resolver be a pure, unit-testable
 * function, and it is what makes the failure paths - a shell that is not
 * executable, one that prints a banner, one that never returns - testable without
 * a real shell or a real wait.
 */
export type ShellRunner = (
	input: ShellRunnerInput,
) => Promise<ShellRunnerResult>;

/**
 * The shells whose dialect this module speaks, by the name the shell's path ends
 * in.
 *
 * AN ALLOW-LIST ON PURPOSE (round-1 review R1-2). The question `printf '%s'
 * "$PATH"` answers correctly is a POSIX-family one: outside that family a shell
 * either expands the value differently (fish's PATH is a list, so the format is
 * recycled per element and the first sentinel pair is ONE directory) or does not
 * accept the command at all (nu, tcsh, pwsh). Listing what is known and refusing
 * everything else keeps the module's contract true for every user - "no answer"
 * is acceptable, a wrong answer is not - at the cost of leaving a shell nobody
 * has measured with the behaviour it has today.
 *
 * It matches on the NAME, so a POSIX shell reached through a non-standard name (a
 * wrapper script, a renamed binary) is refused rather than guessed at. That is
 * the same direction of error: the user keeps the PATH they already had.
 */
const POSIX_SHELL_NAMES = new Set([
	"sh",
	"bash",
	"dash",
	"zsh",
	"ksh",
	"ksh93",
	"mksh",
	"lksh",
	"pdksh",
	"ash",
	"posh",
	"yash",
	"rbash",
]);

/** Whether this module will ask this shell at all. See `POSIX_SHELL_NAMES`. */
export function isPosixShell(shell: string): boolean {
	const name = basename(shell)
		.toLowerCase()
		.replace(/\.exe$/, "");
	return POSIX_SHELL_NAMES.has(name);
}

/**
 * The shell a surface runs when the caller names no command, and the shell this
 * module asks: the user's own, falling back to the platform's own login shell.
 *
 * One answer to "which shell is the user's" for both questions, which is why this
 * lives here rather than beside either caller.
 *
 * THE FALLBACK IS PER-PLATFORM AND PROBED (round-1 review R1-3, QA's Q-6). It was
 * `/bin/zsh` unconditionally: right on macOS, where zsh has been the platform
 * default since Catalina, and wrong on Linux, where bash is the shell that is
 * present and zsh usually is not. A GUI-launched process on Linux often has no
 * `$SHELL` at all, so `/bin/zsh` there meant ENOENT, one `missing` line in the log
 * and the whole resolution quietly doing nothing - the enabler enabling nothing,
 * which is the failure mode this change exists to remove. So the fallback is the
 * first candidate that ACTUALLY EXISTS, in platform order: zsh first on darwin
 * (the platform default, and the shell whose startup files the operator's own
 * terminal reads), bash first everywhere else.
 *
 * `exists` is injected so this stays a pure function a test can drive over any
 * filesystem; a shell that is absent is skipped rather than handed to a spawn
 * that could only answer ENOENT.
 */
export function defaultShell(
	env: NodeJS.ProcessEnv,
	options: {
		platform?: NodeJS.Platform;
		exists?: (path: string) => boolean;
	} = {},
): string {
	const shell = env.SHELL?.trim();
	// A shell that is not an absolute path is not a shell this app will exec: the
	// value comes from the environment, and a relative one would resolve against
	// whatever directory the app happens to be in.
	if (shell && isAbsolute(shell)) return shell;
	const platform = options.platform ?? process.platform;
	const exists = options.exists ?? existsSync;
	const candidates =
		platform === "darwin"
			? ["/bin/zsh", "/bin/bash", "/bin/sh"]
			: ["/bin/bash", "/bin/sh", "/bin/zsh"];
	return candidates.find((candidate) => exists(candidate)) ?? "/bin/sh";
}

/**
 * The real runner: one child, stdout only, killed at the bound.
 *
 * `stdio[0]` is /dev/null rather than a pipe: an interactive rc that calls `read`
 * (a keychain prompt, a "do you want to enable X?" question) then sees end of
 * input immediately instead of waiting for an answer nobody will type. stderr is
 * drained rather than read, because an rc that writes a lot of it would otherwise
 * fill the pipe buffer and block the child - the opposite of what a bound is for.
 *
 * SIGKILL, not the default SIGTERM: a shell this module is waiting on is either
 * in a startup file that has already taken seconds or already wedged, and a
 * polite signal it can trap is a second chance to hang.
 *
 * The bound is this runner's own timer rather than `spawn`'s `timeout` option,
 * because the option kills silently: this has to know it was the deadline that
 * ended the run so the resolver can report `timeout` rather than "spoke nothing"
 * (see `ShellRunnerResult.timedOut`). The timer is cleared on close, so nothing
 * is left holding the event loop.
 *
 * AND THE TIMER KILLS THE PROCESS GROUP, not just the shell. `detached` gives the
 * child its own group, and the negative pid below names that group, because the
 * thing that hangs is almost never the shell itself: it is a `sleep`, an `nvm`
 * fetch, a `git` in a prompt function - a GRANDCHILD. Killing the leader alone
 * leaves exactly the process the bound was meant to bound (measured: a `sleep` in
 * `~/.profile` outlived its killed shell by its full remaining duration). A group
 * kill that fails - already gone, or a platform without it - falls back to the
 * plain kill rather than throwing out of a timer.
 */
export function shellPathRunner(): ShellRunner {
	return ({ shell, args, env, timeoutMs }) =>
		new Promise<ShellRunnerResult>((resolve, reject) => {
			const child = spawn(shell, [...args], {
				stdio: ["ignore", "pipe", "pipe"],
				env,
				detached: true,
			});
			let stdout = "";
			let timedOut = false;
			const deadline = setTimeout(() => {
				timedOut = true;
				try {
					if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			}, timeoutMs);
			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
			});
			// Drained, not read: see this function's own note above.
			child.stderr?.resume();
			child.on("error", (error) => {
				clearTimeout(deadline);
				reject(error);
			});
			child.on("close", () => {
				clearTimeout(deadline);
				resolve({ stdout, timedOut });
			});
		});
}

/** How many times in `value` the substring `needle` occurs. */
function countOccurrences(value: string, needle: string): number {
	let count = 0;
	let at = value.indexOf(needle);
	while (at !== -1) {
		count += 1;
		at = value.indexOf(needle, at + needle.length);
	}
	return count;
}

/** Extract the PATH from a shell's stdout, or say why there is none. */
function pathFromStdout(stdout: string, shell: string): ShellPathResult {
	const begins = countOccurrences(stdout, SHELL_PATH_BEGIN);
	const ends = countOccurrences(stdout, SHELL_PATH_END);
	if (begins === 0 || ends === 0) {
		// No sentinels at all: the shell died before the command ran (a syntax
		// error in an rc, an `exit` in one), or it printed a banner and nothing
		// else - the whole file the command would have written is empty.
		return { ok: false, reason: "empty", shell };
	}
	if (begins > 1 || ends > 1) {
		/*
		 * More than one pair is not a value, it is a formatting accident: it is what
		 * a shell that expanded the value into SEVERAL arguments leaves behind, since
		 * `printf` then recycles the format (and the sentinels are in the format)
		 * once per surplus argument. Reading the first pair would take one directory
		 * out of a list and present it as the PATH - a silent, plausible wrong answer
		 * that no caller could detect, and the one outcome worse than no answer.
		 *
		 * `isPosixShell` refuses that shell before it is asked; this is the backstop
		 * that catches the same shape arriving from a shell that looked like one (a
		 * wrapper, a renamed binary, a POSIX shell whose rc echoes the markers).
		 */
		return {
			ok: false,
			reason: "unparsable",
			shell,
			detail: `${begins} BEGIN and ${ends} END sentinels`,
		};
	}
	const start = stdout.indexOf(SHELL_PATH_BEGIN) + SHELL_PATH_BEGIN.length;
	const path = stdout.slice(start, stdout.indexOf(SHELL_PATH_END));
	if (path === "") return { ok: false, reason: "empty", shell };
	return { ok: true, path, shell };
}

/** Classify a thrown runner error. Never throws: an unknown error is `failed`,
 * not a crash, because a broken shell must leave the app working. */
function pathFromError(error: unknown, shell: string): ShellPathResult {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	const detail = error instanceof Error ? error.message : String(error);
	if (code === "ENOENT") return { ok: false, reason: "missing", shell, detail };
	if (code === "EACCES" || code === "EPERM")
		return { ok: false, reason: "not-executable", shell, detail };
	return { ok: false, reason: "failed", shell, detail };
}

export interface ResolveLoginShellPathOptions {
	/** The environment the shell is started from, and the one `$SHELL` is read
	 * from. Defaults to the app's own. */
	env?: NodeJS.ProcessEnv;
	/** How a shell is started. Defaults to a real child process. */
	run?: ShellRunner;
	/** The child's bound. Defaults to `SHELL_PATH_TIMEOUT_MS`. */
	timeoutMs?: number;
	/** Which platform's shell this is. Defaults to this one; anything but darwin
	 * and linux is answered without starting a shell at all. */
	platform?: NodeJS.Platform;
}

/**
 * Ask the user's login shell what its PATH is.
 *
 * Pure in the sense that matters: everything it touches - the shell, the way a
 * child is started, the bound, the platform - is an argument, so a test drives
 * every path through this function with a fake runner rather than by arranging a
 * real rc file. It never rejects.
 */
export async function resolveLoginShellPath(
	options: ResolveLoginShellPathOptions = {},
): Promise<ShellPathResult> {
	const platform = options.platform ?? process.platform;
	if (platform !== "darwin" && platform !== "linux") {
		// Windows has no login shell of this shape; the backend keeps its registry
		// and user-profile resolution there, and nothing is gained by starting a
		// shell none of these files describe.
		return { ok: false, reason: "unsupported-platform", shell: null };
	}
	const env = options.env ?? process.env;
	const run = options.run ?? shellPathRunner();
	const timeoutMs = options.timeoutMs ?? SHELL_PATH_TIMEOUT_MS;
	const shell = defaultShell(env, { platform });
	// Refused before it is asked, so a shell whose PATH this module cannot read
	// correctly is never given the chance to answer wrongly: the caller keeps the
	// PATH it already had, which is today's behaviour and not a new one.
	if (!isPosixShell(shell)) {
		return { ok: false, reason: "unsupported-shell", shell };
	}

	const attempt: Promise<ShellPathResult> = run({
		shell,
		args: SHELL_PATH_ARGS,
		env,
		timeoutMs,
	}).then(
		(result) =>
			// A run the runner cut short at the bound is a timeout even when the pipe
			// holds a complete-looking value: a shell killed mid-rc has a PATH that is
			// whatever the file had reached, which is not the terminal's PATH and is
			// not worth preferring to the one the app already had.
			result.timedOut
				? { ok: false, reason: "timeout", shell }
				: pathFromStdout(result.stdout ?? "", shell),
		(error) => pathFromError(error, shell),
	);

	// The answer's own bound, longer than the child's so the child's own death is
	// usually what reports the timeout (see SHELL_PATH_ANSWER_GRACE_MS). This is
	// the timer that makes a hanging runner unable to hang a caller.
	//
	// IT MUST STAY REFERENCED, and that is not the default being restated (CI
	// caught this on the first run this branch ever had, in
	// `scripts/shell-path.test.mjs`, as `cancelledByParent` with "Promise
	// resolution is still pending but the event loop has already resolved"). An
	// `unref()` here reads like hygiene - do not hold a process open for a timer
	// - and it is the opposite of what this one is for: the caller is AWAITING
	// the promise this timer settles, so an unreferenced timer lets the loop
	// drain with nobody left to settle it, and the caller is left pending
	// forever. Measured: with the unref an injected runner that never settles
	// left the answer unresolved and the file cancelled; without it the same
	// case answers `timeout` at the bound. A timer that only exists while a
	// caller waits is exactly the kind of handle that SHOULD hold the loop.
	let timer: NodeJS.Timeout | undefined;
	const expired = new Promise<"timeout">((resolve) => {
		timer = setTimeout(
			() => resolve("timeout"),
			timeoutMs + SHELL_PATH_ANSWER_GRACE_MS,
		);
	});
	try {
		const settled = await Promise.race([attempt, expired]);
		if (settled === "timeout") return { ok: false, reason: "timeout", shell };
		return settled;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * How many resolutions one process may START before it stops asking.
 *
 * WHY THERE IS A CAP AT ALL (round-1 review R1-5): a failure must not be memoized
 * for the session - a launch whose rc was slow once (an `nvm`/`conda` init
 * fetching, a cold cache) would then keep the missing PATH until the app quits,
 * with one log line and no retry on any later ask. But an unbounded retry is the
 * other mistake: a permanently broken shell would start a child per ask, and the
 * asks are not rare (the console host and every surface's environment build ask).
 *
 * Three, because the failures worth retrying are transient (a wedged fork, a
 * first-run fetch) and the process asks only a handful of times anyway; a shell
 * that cannot answer costs at most three short-lived children for the whole
 * session. The bound is per process, and a SUCCESS is still memoized forever.
 */
export const USER_SHELL_PATH_MAX_ATTEMPTS = 3;

/** The in-flight resolution, kept so concurrent askers share one shell. */
export interface UserShellPath {
	/** The user's terminal PATH, or null when the shell could not answer. A success
	 * is memoized for the process's life; a failure is retried (up to
	 * `USER_SHELL_PATH_MAX_ATTEMPTS`) and then answered null. Never rejects. */
	resolve(): Promise<string | null>;
}

export interface CreateUserShellPathOptions
	extends ResolveLoginShellPathOptions {
	/** Where the outcome is reported. A failure is a line to read, not a silent
	 * difference in behaviour. */
	log?: (message: string) => void;
}

/** Build the process-wide resolver. See `UserShellPath`. */
export function createUserShellPath(
	options: CreateUserShellPathOptions = {},
): UserShellPath {
	let answer: string | null = null;
	let pending: Promise<string | null> | null = null;
	let attempts = 0;
	return {
		resolve(): Promise<string | null> {
			if (answer) return Promise.resolve(answer);
			if (pending) return pending;
			if (attempts >= USER_SHELL_PATH_MAX_ATTEMPTS)
				return Promise.resolve(null);
			attempts += 1;
			const attempt = attempts;
			pending = resolveLoginShellPath(options)
				.then((result) => {
					try {
						if (result.ok) {
							options.log?.(
								`[shell-path] ${result.shell} reports PATH: ${result.path}`,
							);
						} else {
							options.log?.(
								`[shell-path] attempt ${attempt}/${USER_SHELL_PATH_MAX_ATTEMPTS}: ${result.shell ?? "no shell"} could not report a PATH (${result.reason}${
									result.detail ? `: ${result.detail}` : ""
								}); ${
									attempt < USER_SHELL_PATH_MAX_ATTEMPTS
										? "a later ask will retry"
										: "the PATH this app was launched with is used instead"
								}`,
							);
						}
					} catch {
						// A logging sink is not allowed to turn a resolved answer into a
						// rejection; the value is the point, the line is a courtesy.
					}
					if (result.ok) answer = result.path;
					return answer;
				})
				.finally(() => {
					// Cleared whatever the outcome, so a FAILURE can be retried on the next
					// ask while the success path above short-circuits before it is reached.
					pending = null;
				});
			return pending;
		},
	};
}

/**
 * The PATH a resolved answer and the caller's own value combine into: the
 * resolved entries first, in the shell's own order, then whatever the launch
 * environment had that the shell did not.
 *
 * WHY A UNION RATHER THAN A REPLACEMENT (round-1 review Q-2). Replacing the
 * launch PATH with the shell's is the literal reading of "the user's terminal
 * PATH", and on the machine this was built on nothing is lost by it (the launch
 * PATH is `/usr/bin:/bin:/usr/sbin:/sbin`, every entry of which the shell's PATH
 * also has - measured: 7 entries in, 22 out, none dropped). But it is not
 * guaranteed on somebody else's machine: a launcher, an installer or a managed
 * desktop can put a directory into an app's PATH precisely so the app finds what
 * it ships, and a console surface would then stop seeing it - a regression caused
 * by a change whose whole purpose is to make MORE tools reachable. A union cannot
 * do that: it adds, and the resolved entries keep priority so a tool the user
 * installed in their shell is never shadowed by an app-injected copy.
 *
 * The cost is the mirror image and is accepted: an entry only the launch
 * environment had can outlive its usefulness. Entries that are equal as strings
 * are collapsed, keeping the first occurrence, and an empty element (a PATH
 * containing `::`, which means the current directory) survives once rather than
 * being silently dropped.
 *
 * No `Path`/`PathExt` handling: the only caller that can have an answer at all is
 * darwin or linux (see the platform gate in `resolveLoginShellPath`), and on win32
 * this is handed a `null` and returns the environment untouched.
 */
export function mergeShellPath(
	resolved: string,
	base: string | undefined,
): string {
	if (!base) return resolved;
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const entry of [...resolved.split(":"), ...base.split(":")]) {
		if (seen.has(entry)) continue;
		seen.add(entry);
		merged.push(entry);
	}
	return merged.join(":");
}

/**
 * The environment to hand a child that must behave like the user's terminal: the
 * one it is given, with PATH resolved for it when the user's shell answered.
 *
 * A COPY, always - the input is never mutated, so a caller that shares
 * `process.env` cannot have the app's own environment rewritten underneath it. And
 * PATH alone: everything else in the environment stays exactly as it was, which is
 * the difference between resolving a PATH and inheriting a shell.
 */
export async function withUserShellPath(
	env: NodeJS.ProcessEnv,
	userShellPath?: UserShellPath,
): Promise<NodeJS.ProcessEnv> {
	const path = await userShellPath?.resolve();
	if (!path) return { ...env };
	return { ...env, PATH: mergeShellPath(path, env.PATH) };
}
