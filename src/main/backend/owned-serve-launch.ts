import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

const SHEBANG = /^#!([^\r\n]+)\r?\n/;
const PYTHON_NAME = /[/\\]python(?:\d+(?:\.\d+)*)?$/;

/**
 * pipx's own `-E`, appended to a shebang that already names a space-free python.
 *
 * pipx rewrites every launcher it exposes with
 * `_add_ignore_environment_to_python_shebang` (pipx's `commands/common.py`),
 * which appends ` -E` to the first line when that line starts with `#!`, names
 * a python, and holds NEITHER a space nor a tab — and skips Windows entirely.
 * A space-free `PIPX_HOME` (Linux, or a macOS `PIPX_HOME` outside the default
 * `Application Support` segment) therefore ships
 * `#!/…/venvs/local-operator/bin/python -E`, which is neither of the two
 * launcher spellings this function used to accept, so the app quit at startup
 * with "Cannot safely own this backend launcher" against the install it had
 * itself resolved and classified as pipx (QA reproduced it on both base and
 * head; the same install through pipx's spaced default home took the
 * SH_EXEC_TRICK arm and passed).
 *
 * ONLY this one argument, and only when it is the whole of what follows the
 * path. The flag is pipx's, not ours and not the backend's: the path is what
 * this arm returns, and the caller spawns that interpreter directly with its
 * own `-c` payload, so nothing here propagates `-E` to the process we own.
 * Tolerating trailing text generally would accept a launcher whose shebang
 * arguments we cannot see, which is the weakening the negative fixtures pin.
 */
const PIPX_IGNORE_ENV = / -E$/;

/**
 * The /bin/sh exec trick distlib writes when the interpreter path cannot be a
 * shebang — and on macOS, pipx's DEFAULT layout guarantees it.
 *
 * A console script's shebang normally names the venv interpreter directly,
 * which is what `consoleInterpreter` reads. But a shebang cannot carry a path
 * with spaces (or one over the kernel's length cap), so distlib's
 * `_build_shebang` — the code under pip and pipx alike — falls back to:
 *
 *     #!/bin/sh
 *     '''exec' '/path with spaces/python' "$0" "$@"
 *     ' '''
 *
 * sh reads line two and execs the interpreter on this same file; Python reads
 * the whole prefix as a string literal and falls through to the code below it.
 * pipx's default home on macOS is `~/Library/Application Support/pipx/venvs`
 * — a path WITH A SPACE — so every default pipx install on macOS produces this
 * exact launcher, and the shebang test alone rejected all of them: the app
 * quit at startup with "Cannot safely own this backend launcher" against the
 * install it had itself resolved and classified as pipx (measured on a real
 * v0.30.10 install; the same file passed once its shebang named a space-free
 * symlink to the same venv).
 *
 * The capture is the interpreter with whatever quoting distlib applied; line
 * one and the trailing `"$0" "$@"` anchor it so an arbitrary wrapper script
 * that happens to exec python does not match — only this exact two-line
 * preamble does, and the entrypoint import below is still required on top.
 */
const SH_EXEC_TRICK =
	/^#!\/bin\/sh\r?\n'''exec' ([^\r\n]+) "\$0" "\$@"\r?\n' '''/;

/** Strip the one layer of quoting distlib may have wrapped the path in. */
function unquoteExecTrickPath(captured: string): string {
	const trimmed = captured.trim();
	const first = trimmed[0];
	if ((first === "'" || first === '"') && trimmed.endsWith(first)) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}
export const SERVE_ENTRYPOINT = "from local_operator.cli import main; main()";

/** Runs in the interpreter under inspection and prints the four facts the launch
 * decision is made from (see `InterpreterIdentity`). One line, so the same
 * argument works unchanged on every platform. */
const PROBE_SCRIPT =
	"import json, sys; from local_operator.cli import main; print(json.dumps([sys.executable, getattr(sys, '_base_executable', None) or sys.executable, callable(main), [p for p in sys.path if p and p.startswith(sys.prefix)]]))";

/**
 * What one interpreter reports about itself, which is the whole basis for
 * deciding what to spawn.
 *
 * `executable` is the interpreter that actually ran (Windows venv launchers
 * rewrite this to the venv path), `baseExecutable` is the interpreter a venv
 * launcher would hand off to, `callable` is whether the CLI entrypoint imports,
 * and `prefixPaths` are the import paths the interpreter owns under its own
 * prefix - a venv's site-packages, which a base interpreter has to be told about
 * explicitly. All four come from the same probe so that no branch below has to
 * infer any of them from a name, a path shape or a platform convention.
 */
interface InterpreterIdentity {
	executable: string;
	baseExecutable: string;
	callable: boolean;
	prefixPaths: string[];
}

interface LaunchPlan {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
}

/**
 * The bounds of interpreter resolution, named so a caller - and the suite - can
 * hold each of them to something measurable.
 *
 * `totalMs` is the whole resolution: every candidate, every attempt and the
 * Windows base-interpreter check draw from it. Without it the bounds multiply -
 * two attempts at the ceiling for a redirector plus two more for its base is up
 * to 120 s before a Windows start reports failure, and `stop()` awaits that same
 * work, so a quit arriving mid-start inherits the whole number (review round 2,
 * F10).
 *
 * `attemptMs` is one probe. It is deliberately the 30 s the readiness wait
 * already tolerates: the probe pays a cold import of `local_operator`, QA
 * measured 1.7 s with no cached bytecode against 0.3 s warm on an idle box, and
 * on a loaded one (load average 165) watched three launches exceed the previous
 * 5 s ceiling and fail closed behind a blocking modal. A slow first run is not a
 * broken installation, so a probe that times out is retried once - the attempt
 * that timed out still warmed the bytecode cache - and a second timeout means an
 * interpreter that is not starting rather than one that is starting slowly.
 *
 * `graceMs` / `slackMs` bound the escalation after a ceiling is reached, which
 * `execFile`'s own timeout does not do: it signals once and then waits for
 * `close`, so an interpreter that ignores SIGTERM leaves its promise pending for
 * good (review round 2, F9). The slack is the last resort after SIGKILL and is
 * not waited for twice: a probe settles no later than attemptMs + graceMs +
 * slackMs.
 */
export interface InterpreterBudget {
	totalMs?: number;
	attemptMs?: number;
	graceMs?: number;
	slackMs?: number;
}

const DEFAULT_BUDGET: Required<InterpreterBudget> = {
	totalMs: 45_000,
	attemptMs: 30_000,
	graceMs: 2_000,
	slackMs: 2_000,
};

/** A discovery command (`where`, `py -3`) answers in milliseconds or it is not
 * the thing we are looking for, and it never gets the probe's budget. Exported
 * because the quit path's failsafe derives from it (see
 * `INTERPRETER_RESOLUTION_WORST_MS`). */
export const DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * Worst-case wall time for resolving and proving the interpreter.
 *
 * The PATH-side claims are only asked for when no earlier claim proves out
 * (round 3, F14), so the bound is one discovery pair - each with its own
 * ceiling and escalation - plus the shared probe budget. Named and exported so
 * a bound that must outlast this work derives from these numbers instead of
 * restating them in prose, which is how the quit failsafe came to be wrong by
 * arithmetic rather than by intent (round 3, F12).
 */
export const INTERPRETER_RESOLUTION_WORST_MS =
	DEFAULT_BUDGET.totalMs +
	2 * (DISCOVERY_TIMEOUT_MS + DEFAULT_BUDGET.graceMs + DEFAULT_BUDGET.slackMs);

/** The one probe failure a retry can plausibly turn around, and the one that
 * must still settle when the interpreter ignores signals. */
class ProbeTimeout extends Error {
	constructor(interpreter: string, timeoutMs: number) {
		super(
			`${interpreter} did not answer an identity probe within ${timeoutMs} ms`,
		);
		this.name = "ProbeTimeout";
	}
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Run one bounded child and return its stdout.
 *
 * Escalate the way the owned serve path already does - SIGTERM, a grace,
 * SIGKILL, then a slack after which this process stops waiting and reports -
 * because the caller's promise sits on `start()`, on `startPromise` and
 * therefore on a quit that has already prevented itself. The child is one this
 * process spawned, held as a handle, and signalled through that handle only.
 */
function runBounded(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	bounds: Required<InterpreterBudget> & { timeoutMs: number },
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child: ChildProcess = spawn(command, args, {
			env,
			// Piped, so the answer is read rather than inherited by the app.
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		let settled = false;
		let timedOut = false;
		const timers: NodeJS.Timeout[] = [];
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			timers.length = 0;
			finish();
		};

		timers.push(
			setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
				timers.push(setTimeout(() => child.kill("SIGKILL"), bounds.graceMs));
				timers.push(
					setTimeout(
						() =>
							settle(() => reject(new ProbeTimeout(command, bounds.timeoutMs))),
						bounds.graceMs + bounds.slackMs,
					),
				);
			}, bounds.timeoutMs),
		);

		// A spawn failure (ENOENT and friends) means this candidate is simply not
		// there; the caller treats it as one rejected claim among several.
		child.on("error", (error) => settle(() => reject(error)));
		child.on("close", (code, signal) =>
			settle(() => {
				// A child that dies while we are escalating is a timeout, not an exit:
				// the ceiling is what happened to it, and that is what the retry needs
				// to see.
				if (timedOut) {
					reject(new ProbeTimeout(command, bounds.timeoutMs));
					return;
				}
				if (code === 0) {
					resolve(stdout);
					return;
				}
				const detail = errorTail(stderr);
				reject(
					new Error(
						`exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}${detail ? `: ${detail}` : ""}`,
					),
				);
			}),
		);
	});
}

/** stderr's LAST lines, never its first.
 *
 * A Python failure begins with `Traceback (most recent call last):`, so keeping
 * the first line reported the shape of the failure and dropped its cause - a
 * rejected interpreter read as `exited with code 1: Traceback (most recent call
 * last):` while the `ImportError` that explains it was discarded (review round
 * 4, Q-21). The tail is where the cause is; kept to a few lines and marked when
 * it was cut, so a noisy interpreter cannot paste a whole traceback into a
 * dialog. */
/*
 * Hoisted to module scope, and the SEVERITY IS STATED CORRECTLY HERE because the first
 * version of this comment was not: `useTopLevelRegex` is `"warn"` in `biome.json` and
 * `pnpm lint` runs `biome check` with NO `--error-on-warnings`, so this literal fails no
 * gate - the rule's diagnostic is printed as a warning and the command still exits 0.
 * The hoist is kept on its own merits rather than on a gate that does not exist: a
 * literal inside a function body compiles a new `RegExp` on every call, and this one is
 * rebuilt per failed launch. */
const NEWLINES = /\r?\n/;
const errorTail = (text: string, lines = 3): string => {
	const kept = text
		.split(NEWLINES)
		.map((line) => line.trim())
		.filter(Boolean);
	if (kept.length === 0) return "";
	const tail = kept.slice(-lines).join(" | ");
	return kept.length > lines ? `\u2026 ${tail}` : tail;
};

function parseIdentity(
	stdout: string,
	interpreter: string,
): InterpreterIdentity {
	const parsed = JSON.parse(stdout.trim()) as [
		string,
		string,
		boolean,
		string[] | undefined,
	];
	const [executable, baseExecutable, callable, prefixPaths] = parsed;
	if (typeof executable !== "string" || typeof callable !== "boolean")
		throw new Error(`${interpreter} reported no usable identity`);
	return {
		executable,
		baseExecutable: baseExecutable || executable,
		callable,
		prefixPaths: Array.isArray(prefixPaths) ? prefixPaths : [],
	};
}

/** Probe one interpreter with the ceiling and the escalation applied. */
async function probeOnce(
	interpreter: string,
	env: NodeJS.ProcessEnv,
	timeoutMs: number,
	bounds: Required<InterpreterBudget>,
): Promise<InterpreterIdentity> {
	return parseIdentity(
		await runBounded(interpreter, ["-c", PROBE_SCRIPT], env, {
			...bounds,
			timeoutMs,
		}),
		interpreter,
	);
}

/** Probe with the retry and the shared budget applied. The per-attempt ceiling
 * leaves room for the escalation, so the whole call stays inside `totalMs`; when
 * the budget cannot afford another attempt, the timeout that spent it is the
 * failure worth reporting, not the arithmetic that stopped the retry. */
async function probeWithin(
	interpreter: string,
	env: NodeJS.ProcessEnv,
	deadline: number,
	bounds: Required<InterpreterBudget>,
): Promise<InterpreterIdentity> {
	let lastTimeout: ProbeTimeout | null = null;
	for (let attempt = 1; ; attempt++) {
		const remaining = deadline - Date.now() - bounds.graceMs - bounds.slackMs;
		if (remaining <= 0) {
			if (lastTimeout) throw lastTimeout;
			throw new Error(
				`the ${bounds.totalMs} ms interpreter-probe budget ran out before ${interpreter} answered`,
			);
		}
		try {
			return await probeOnce(
				interpreter,
				env,
				Math.min(bounds.attemptMs, remaining),
				bounds,
			);
		} catch (error) {
			if (error instanceof ProbeTimeout) {
				lastTimeout = error;
				if (attempt < PROBE_ATTEMPTS && Date.now() < deadline) continue;
			}
			throw error;
		}
	}
}

/** Retries a single probe once, which is the ceiling's own contract. */
const PROBE_ATTEMPTS = 2;

/**
 * The plan for one interpreter that has already answered a probe.
 *
 * Split from the candidate loop so a candidate that probes successfully but
 * cannot be owned (its base interpreter is another redirector, its entrypoint
 * does not import) is reported as one rejected claim instead of ending the
 * search - another candidate may still be the backend.
 */
async function planFor(
	identity: InterpreterIdentity,
	interpreter: string,
	port: number,
	env: NodeJS.ProcessEnv,
	platform: string,
	deadline: number,
	bounds: Required<InterpreterBudget>,
): Promise<LaunchPlan> {
	if (!identity.callable || !isAbsolute(identity.executable))
		throw new Error(
			`the CLI entrypoint does not import in ${identity.executable || interpreter}`,
		);
	const args = ["-c", SERVE_ENTRYPOINT, "serve", "--port", String(port)];
	if (platform !== "win32")
		// Positional arguments preserve spaces/metacharacters. Final exec replaces
		// bash with the interpreter; no intermediate launcher survives to own a PID.
		return {
			command: "bash",
			args: ["-c", 'exec "$@"', "owned-serve", identity.executable, ...args],
			env,
		};

	/*
	 * Windows, where the interpreter this app resolves may be a venv launcher.
	 *
	 * `Scripts\python.exe` inside a venv - every uv/pipx tool env and the bundled
	 * venv alike, since CPython 3.7.2 - is a redirector: it starts the base
	 * interpreter as its OWN child and waits. Owning that launcher does not own
	 * serve (signalling it leaves the server answering), and reaching its
	 * descendants is a process-tree sweep, which is the class of cleanup this
	 * change exists to remove. Refusing to spawn at all, as an earlier revision
	 * did, made the managed backend unreachable on Windows (review round 1, F1).
	 *
	 * So spawn the base interpreter the venv names, with the paths the venv owns
	 * on PYTHONPATH so `local_operator.cli` still resolves - and prove that
	 * choice rather than assume it. The interpreter about to be spawned must
	 * import the entrypoint and report ITSELF as the executable we asked for; one
	 * that reports something else is a further redirector, and the PID we capture
	 * would not be the server.
	 */
	if (
		identity.executable.toLowerCase() === identity.baseExecutable.toLowerCase()
	)
		return { command: identity.executable, args, env };
	if (!isAbsolute(identity.baseExecutable))
		throw new Error(
			`it is a venv redirector whose base interpreter is not an absolute path (${identity.baseExecutable || "nothing"})`,
		);
	const baseEnv: NodeJS.ProcessEnv = {
		...env,
		// Windows' own separator, deliberately independent of the host evaluating
		// the plan: the plan describes the Windows launch, not the machine that
		// built it, and the test host is not Windows.
		PYTHONPATH: [...identity.prefixPaths, env.PYTHONPATH]
			.filter(Boolean)
			.join(";"),
	};
	const base = await probeWithin(
		identity.baseExecutable,
		baseEnv,
		deadline,
		bounds,
	);
	if (
		!base.callable ||
		base.executable.toLowerCase() !== identity.baseExecutable.toLowerCase()
	)
		throw new Error(
			`its base interpreter ${identity.baseExecutable} is not the serving process (${
				base.callable
					? `it reported itself as ${base.executable || "nothing"}`
					: "it cannot import local_operator.cli even with the venv's own import paths"
			})`,
		);
	return { command: identity.baseExecutable, args, env: baseEnv };
}

/**
 * Resolve, prove and plan the launch from a LIST of claims about where the
 * backend interpreter is.
 *
 * WHY a list: `where local-operator` answers with the first launcher on PATH,
 * and the directory holding a launcher need not hold an interpreter. uv - the
 * installer this app's own update path uses - puts a shim in its executable
 * directory (`%USERPROFILE%\.local\bin`) while the tool environment lives in a
 * different tree, so `dirname(<launcher>)\python.exe` is a guess a real Windows
 * layout falsifies, and a wrong guess here is an app that cannot start (review
 * round 2, F8). Every candidate is a CLAIM; the identity probe is the only
 * admission test, so the order decides preference and never acceptance.
 */
export async function ownedServeLaunch(
	interpreters: string[],
	port: number,
	env: NodeJS.ProcessEnv,
	platform = process.platform,
	budget: InterpreterBudget = {},
	/**
	 * Claims that are only resolved if no claim above proves out.
	 *
	 * The PATH-side ones cost two discovery children (`where python.exe`, `py
	 * -3`) on every start, and on a normal install claim 1 or 2 wins, so paying
	 * them unconditionally is latency the app never uses - and it is quit-path
	 * latency, because `stop()` waits on this same promise (round 3, F14). A
	 * callback rather than a flat list, so the spawns happen after the decision
	 * that makes them unnecessary rather than before it.
	 */
	fallbackClaims?: () => Promise<string[]>,
): Promise<LaunchPlan> {
	const bounds: Required<InterpreterBudget> = {
		...DEFAULT_BUDGET,
		...budget,
	};
	const deadline = Date.now() + bounds.totalMs;
	const rejected: string[] = [];
	const attempt = async (claims: string[]): Promise<LaunchPlan | null> => {
		for (const interpreter of [...new Set(claims)]) {
			if (!isAbsolute(interpreter)) {
				rejected.push(`${interpreter || "(empty)"}: not an absolute path`);
				continue;
			}
			try {
				const identity = await probeWithin(interpreter, env, deadline, bounds);
				return await planFor(
					identity,
					interpreter,
					port,
					env,
					platform,
					deadline,
					bounds,
				);
			} catch (error) {
				rejected.push(`${interpreter}: ${describe(error)}`);
			}
		}
		return null;
	};

	if (interpreters.length === 0 && !fallbackClaims)
		throw new Error(
			"No backend interpreter was resolved. Install the Local Operator backend (`uv tool install local-operator`) or pair an external backend.",
		);
	const planned =
		(await attempt(interpreters)) ??
		(fallbackClaims ? await attempt(await fallbackClaims()) : null);
	if (planned) return planned;
	throw new Error(
		`No backend interpreter could be proven. Tried ${rejected.length}: ${rejected.join("; ")}. Install the backend with a supported installer (\`uv tool install local-operator\`) or pair an external backend.`,
	);
}

/** First line of a bounded discovery command, or null if it fails or says
 * nothing - a discovery miss is not an error, it is one fewer candidate. */
async function firstLine(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<string | null> {
	try {
		const stdout = await runBounded(command, args, env, {
			...DEFAULT_BUDGET,
			timeoutMs: DISCOVERY_TIMEOUT_MS,
		});
		const line = stdout.trim().split(/\r?\n/)[0]?.trim();
		return line ? line : null;
	} catch {
		return null;
	}
}

/**
 * The interpreters an installed console launcher could be running, in order.
 *
 * Read `ownedServeLaunch`'s note first: these are claims, and the probe decides.
 * The order runs from "the installer that wrote the launcher identifies the
 * environment" to "whatever PATH offers", because the later entries are the
 * least likely to carry this app's dependency tree:
 *
 * 1. the launcher's sibling `python.exe` - a pip/virtualenv install puts the
 *    console script and the venv's interpreter in the same `Scripts` directory;
 * 2. the uv tool environment - uv's own `UV_TOOL_DIR` (or its default under
 *    `%APPDATA%\uv\tools`) holding `<tool>\Scripts\python.exe`, and pipx's
 *    `PIPX_HOME`/default `pipx\venvs\<tool>` for the same reason.
 *
 * These two are pure path arithmetic over the environment, so they cost nothing
 * to offer. The PATH-side claims - `where python.exe` and the `py -3` launcher,
 * where a real system Python that cannot import `local_operator` is exactly what
 * the probe is for - live in `windowsPathInterpreterCandidates`, because they
 * spawn discovery children and are only worth that when nothing above proves
 * out (round 3, F14).
 *
 * Absent paths are dropped before probing (a stat is cheaper than a spawn); the
 * probe remains the only thing that can accept one.
 */
export async function windowsInterpreterCandidates(
	consolePath: string,
	env: NodeJS.ProcessEnv,
): Promise<string[]> {
	const directory = dirname(consolePath);
	const tool = basename(consolePath).replace(/\.(exe|cmd|bat)$/i, "");
	const candidates: string[] = [join(directory, "python.exe")];

	const uvTools =
		env.UV_TOOL_DIR ?? (env.APPDATA ? join(env.APPDATA, "uv", "tools") : null);
	if (uvTools) candidates.push(join(uvTools, tool, "Scripts", "python.exe"));

	const pipxHome =
		env.PIPX_HOME ??
		(env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "pipx") : null) ??
		(env.USERPROFILE ? join(env.USERPROFILE, "pipx") : null);
	if (pipxHome)
		candidates.push(join(pipxHome, "venvs", tool, "Scripts", "python.exe"));

	return [...new Set(candidates)].filter(
		(candidate) => isAbsolute(candidate) && existsSync(candidate),
	);
}

/**
 * The PATH-side claims, asked for only when nothing above proved out.
 *
 * The Windows launcher is a command rather than a path, so its own answer to
 * "where is my interpreter" is one of the claims - but each of these costs a
 * discovery child, and on a normal install the launcher's sibling or the tool
 * environment is the backend, so they are resolved after the decision that
 * makes them unnecessary (round 3, F14) rather than before it.
 */
export async function windowsPathInterpreterCandidates(
	env: NodeJS.ProcessEnv,
): Promise<string[]> {
	const found: string[] = [];
	const onPath = await firstLine("where", ["python.exe"], env);
	if (onPath) found.push(onPath);
	const viaLauncher = await firstLine(
		"py",
		["-3", "-c", "import sys; print(sys.executable)"],
		env,
	);
	if (viaLauncher) found.push(viaLauncher);
	return [...new Set(found)].filter(
		(candidate) => isAbsolute(candidate) && existsSync(candidate),
	);
}

/** Accept the installed Python console entrypoint, not arbitrary shell shims.
 * Keep the existing PATH resolver authoritative; this only proves its identity.
 *
 * Three spellings of the same launcher are accepted, and only those three:
 * a shebang naming the interpreter (distlib's normal form, with or without
 * pipx's own `-E`), and distlib's /bin/sh exec trick (its own fallback when the
 * interpreter path cannot BE a shebang — see SH_EXEC_TRICK, which is every
 * default macOS pipx install). All must still import the CLI entrypoint, and
 * the interpreter must still look like a python. An arbitrary shell wrapper
 * matches none of them. */
export function consoleInterpreter(consolePath: string): string {
	const script = readFileSync(consolePath, "utf8");
	const entrypoint = script.includes("from local_operator.cli import main");
	// The line, less pipx's flag when pipx put one there (see PIPX_IGNORE_ENV).
	// Everything else about it is held to the bar it was held to before, so a
	// shebang that is not a bare interpreter path plus at most that ONE flag -
	// `/usr/bin/env python` is the pre-existing case of this, not a new one -
	// still has to pass `isAbsolute` and `PYTHON_NAME` on the whole remainder.
	const shebang = SHEBANG.exec(script)?.[1]?.replace(PIPX_IGNORE_ENV, "");
	if (
		shebang &&
		isAbsolute(shebang) &&
		PYTHON_NAME.test(shebang) &&
		entrypoint
	) {
		return shebang;
	}
	const trick = SH_EXEC_TRICK.exec(script)?.[1];
	if (trick && entrypoint) {
		const interpreter = unquoteExecTrickPath(trick);
		if (isAbsolute(interpreter) && PYTHON_NAME.test(interpreter)) {
			return interpreter;
		}
	}
	throw new Error(
		"Cannot safely own this backend launcher; use a directly paired external backend",
	);
}
