import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
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

/**
 * How long one identity probe may take, and why it is not shorter.
 *
 * The probe pays a cold import of `local_operator`: QA measured 1.7 s with no
 * cached bytecode against 0.3 s warm on an idle box, and on a loaded one (load
 * average 165) watched three launches exceed the previous 5 s ceiling and fail
 * closed behind a blocking modal. A slow first run on a busy machine is not a
 * broken installation, so the ceiling is the 30 s the readiness wait already
 * tolerates, and a probe that times out is retried once: the attempt that timed
 * out still warmed the bytecode cache, so a second timeout means an interpreter
 * that is not starting rather than one that is starting slowly.
 */
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_ATTEMPTS = 2;

/** `execFile` reports its own timeout kill with this shape, and it is the only
 * probe failure a retry can plausibly turn around; every other failure (the
 * entrypoint does not import, the interpreter does not exist) is deterministic
 * and is reported on the first attempt. */
const probeTimedOut = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	((error as { killed?: boolean }).killed === true ||
		(error as { signal?: string | null }).signal === "SIGTERM");

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Probe one interpreter, retrying a timeout once, and never reporting a slow
 * start as an identity failure. */
async function probe(
	interpreter: string,
	env: NodeJS.ProcessEnv,
): Promise<InterpreterIdentity> {
	for (let attempt = 1; ; attempt++) {
		try {
			const { stdout } = await execFileAsync(
				interpreter,
				["-c", PROBE_SCRIPT],
				{ env, timeout: PROBE_TIMEOUT_MS, windowsHide: true },
			);
			const [executable, baseExecutable, callable, prefixPaths] = JSON.parse(
				stdout.trim(),
			) as [string, string, boolean, string[]];
			return { executable, baseExecutable, callable, prefixPaths };
		} catch (error) {
			if (attempt < PROBE_ATTEMPTS && probeTimedOut(error)) continue;
			throw new Error(
				probeTimedOut(error)
					? `Backend interpreter did not answer an identity probe within ${PROBE_TIMEOUT_MS} ms on ${PROBE_ATTEMPTS} attempts: ${interpreter}. The interpreter is not starting - reinstall the backend or pair an external one.`
					: `Backend interpreter identity probe failed: ${interpreter}: ${describe(error)}`,
			);
		}
	}
}

/** Console wrappers and Windows venv redirectors may wait for another process.
 * Owning the wrapper does not own serve. Probe only an explicit interpreter and
 * reject opaque launchers rather than broadening cleanup to their descendants.
 *
 * Returns the environment to spawn with as well as the command: a venv's base
 * interpreter needs the venv's import paths, and the caller must not have to
 * reconstruct that decision from the plan. */
export async function ownedServeLaunch(
	python: string,
	port: number,
	env: NodeJS.ProcessEnv,
	platform = process.platform,
): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> {
	if (!isAbsolute(python))
		throw new Error("Backend interpreter must be absolute");
	const identity = await probe(python, env);
	if (!identity.callable || !isAbsolute(identity.executable))
		throw new Error(
			`Backend CLI entrypoint is unavailable in ${identity.executable || python}; install the Local Operator backend or pair an external one.`,
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
	 * Windows, where the interpreter this app resolves is a venv launcher.
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
	 * would not be the server. If it cannot, the error says so in the terms a
	 * user can act on, instead of the app being unusable on the platform.
	 */
	if (
		identity.executable.toLowerCase() === identity.baseExecutable.toLowerCase()
	)
		return { command: identity.executable, args, env };
	if (!isAbsolute(identity.baseExecutable))
		throw new Error(
			`Cannot own a Windows backend interpreter: ${python} is a venv redirector whose base interpreter is not an absolute path (${identity.baseExecutable || "nothing"}). Install the backend with a supported tool or pair an external one.`,
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
	const base = await probe(identity.baseExecutable, baseEnv);
	const baseIsDirect =
		base.callable &&
		base.executable.toLowerCase() === identity.baseExecutable.toLowerCase();
	if (!baseIsDirect)
		throw new Error(
			`Cannot own a Windows backend interpreter: ${identity.baseExecutable} did not answer as this app's own serve interpreter (${
				base.callable
					? `it reported itself as ${base.executable || "nothing"}`
					: "it cannot import local_operator.cli even with the venv's own import paths"
			}), so the PID this app would capture is not the serving process. Pair the backend externally instead.`,
		);
	return { command: identity.baseExecutable, args, env: baseEnv };
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
