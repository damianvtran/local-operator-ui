import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

const SHEBANG = /^#!([^\r\n]+)\r?\n/;
const PYTHON_NAME = /[/\\]python(?:\d+(?:\.\d+)*)?$/;
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
 * the thing we are looking for; it never gets the probe's budget. */
const DISCOVERY_TIMEOUT_MS = 5_000;

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
				const detail = stderr.trim().split("\n")[0];
				reject(
					new Error(
						`exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}${detail ? `: ${detail}` : ""}`,
					),
				);
			}),
		);
	});
}

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
): Promise<LaunchPlan> {
	const candidates = [...new Set(interpreters)];
	const bounds: Required<InterpreterBudget> = {
		...DEFAULT_BUDGET,
		...budget,
	};
	if (candidates.length === 0)
		throw new Error(
			"No backend interpreter was resolved. Install the Local Operator backend (`uv tool install local-operator`) or pair an external backend.",
		);
	const deadline = Date.now() + bounds.totalMs;
	const rejected: string[] = [];
	for (const interpreter of candidates) {
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
	throw new Error(
		`No backend interpreter could be proven. Tried ${candidates.length}: ${rejected.join("; ")}. Install the backend with a supported installer (\`uv tool install local-operator\`) or pair an external backend.`,
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
 *    `PIPX_HOME`/default `pipx\venvs\<tool>` for the same reason;
 * 3. `where python.exe` - the first interpreter on PATH. It is usually a system
 *    Python that cannot import `local_operator`, and that is exactly what the
 *    probe is for: it is admitted only if it really is the backend;
 * 4. `py -3` - the Windows launcher is a command, not a path, so its own answer
 *    to "where is my interpreter" is the candidate, proven like the rest.
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

	const onPath = await firstLine("where", ["python.exe"], env);
	if (onPath) candidates.push(onPath);
	const viaLauncher = await firstLine(
		"py",
		["-3", "-c", "import sys; print(sys.executable)"],
		env,
	);
	if (viaLauncher) candidates.push(viaLauncher);

	return [...new Set(candidates)].filter(
		(candidate) => isAbsolute(candidate) && existsSync(candidate),
	);
}

/** Accept the installed Python console entrypoint, not arbitrary shell shims.
 * Keep the existing PATH resolver authoritative; this only proves its identity. */
export function consoleInterpreter(consolePath: string): string {
	const script = readFileSync(consolePath, "utf8");
	const shebang = SHEBANG.exec(script)?.[1];
	if (
		!shebang ||
		!isAbsolute(shebang) ||
		!PYTHON_NAME.test(shebang) ||
		!script.includes("from local_operator.cli import main")
	) {
		throw new Error(
			"Cannot safely own this backend launcher; use a directly paired external backend",
		);
	}
	return shebang;
}
